import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Loader, LoaderContext } from 'astro/loaders';
import { z } from 'astro/zod';
import registry from '../data/registry.json';

// Both collections (plugins + activity) come from one scan of the plugin
// checkouts. Locally that is the sibling directory of this repo; in CI the
// deploy workflow clones every registry entry into PLUGINS_DIR first.
const OWNER = registry.owner;
const RECENT_PER_REPO = 12;
const CATEGORY_IDS = Object.keys(registry.categories) as [string, ...string[]];
const UNIT_SEP = String.fromCharCode(31);

export const commitSchema = z.object({
  sha: z.string(),
  date: z.string(), // ISO 8601, kept as string so it survives the data store unchanged
  type: z.string().nullable(),
  scope: z.string().nullable(),
  breaking: z.boolean(),
  subject: z.string(),
  plugin: z.string(),
  pluginName: z.string(),
});
export type Commit = z.infer<typeof commitSchema>;

const shotSchema = z.object({
  file: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  caption: z.string(),
});
export type Shot = z.infer<typeof shotSchema>;

export const pluginSchema = z.object({
  name: z.string(),
  slug: z.string(),
  owner: z.string(),
  url: z.url(),
  kind: z.enum(['plugin', 'desktop']),
  category: z.enum(CATEGORY_IDS),
  tagline: z.string(),
  description: z.string(),
  banner: z.string().nullable(),
  status: z.enum(['alpha', 'beta', 'stable', 'unknown']),
  statusNote: z.string().nullable(),
  nvimMin: z.string().nullable(),
  hasVimdoc: z.boolean(),
  docs: z.array(z.string()),
  commitCount: z.number().int().nonnegative(),
  lastCommit: z.string().nullable(),
  recent: z.array(commitSchema),
  /** doc/*.txt files: file = basename without .txt; main = the plugin's primary help file */
  vimdocs: z.array(z.object({ file: z.string(), title: z.string(), main: z.boolean() })),
  /** slugs of other registry plugins this one require()s from its lua/ tree */
  uses: z.array(z.string()),
  /** like uses, but every require() is pcall-guarded: an optional integration */
  usesOptional: z.array(z.string()),
  /** recording found in public/demos/ (fetched from the demo-assets branch) */
  demo: z.object({ webm: z.boolean(), mp4: z.boolean(), poster: z.boolean() }).nullable(),
  /** hand-picked screenshots from public/shots/<slug>/shots.json, for what a recording cannot show */
  shots: z.array(shotSchema),
});
export type PluginData = z.infer<typeof pluginSchema>;

/**
 * Screenshots a plugin page shows next to (or instead of) its recording:
 * `public/shots/<slug>/shots.json`, an ordered list of `{ file, width, height,
 * caption }` whose files sit in the same directory. Meant for features the VHS
 * recording cannot capture (images drawn into a float, a PDF page). A manifest
 * naming a file that is not there fails the build rather than shipping a
 * broken image.
 */
function readShots(slug: string): Shot[] {
  const dir = resolve(process.env.SHOTS_DIR ?? 'public/shots', slug);
  const manifest = join(dir, 'shots.json');
  if (!existsSync(manifest)) return [];
  const parsed = z.array(shotSchema).safeParse(JSON.parse(readFileSync(manifest, 'utf8')));
  if (!parsed.success) throw new Error(`${manifest}: ${parsed.error.message}`);
  for (const shot of parsed.data) {
    if (shot.file.includes('/') || shot.file.includes('\\') || !existsSync(join(dir, shot.file))) {
      throw new Error(`${manifest}: no such file ${shot.file}`);
    }
  }
  return parsed.data;
}

export const vimdocSchema = z.object({
  plugin: z.string(),
  pluginName: z.string(),
  file: z.string(),
  title: z.string(),
  main: z.boolean(),
  text: z.string(),
});
export type VimdocData = z.infer<typeof vimdocSchema>;

type Logger = LoaderContext['logger'];
interface Scanned {
  plugin: PluginData;
  commits: Commit[];
  vimdocs: VimdocData[];
}

/** First line of a help file: `*name.txt*  Description  *tag*` -> description. */
function vimdocTitle(text: string, fallback: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const t = first
    .replace(/\*[^\s*]+\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || fallback;
}

const REQUIRE = /require\(?\s*['"]([\w.-]+)/g;
// Block comments and full-line comments (including `---` doc comments, whose
// example code would otherwise count as dependencies).
const LUA_COMMENT = /--\[(=*)\[[\s\S]*?\]\1\]|^[ \t]*--.*$/gm;
const SKIP_PATH = /(^|[\\/])(tests?|spec|specs|fixtures?|TESTS)([\\/]|$)/i;

function walkLua(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (SKIP_PATH.test(p)) continue;
    if (entry.isDirectory()) walkLua(p, out);
    else if (entry.name.endsWith('.lua')) out.push(p);
  }
  return out;
}

/**
 * Module roots require()d under lua/, e.g. "lib" from require("lib.nvim.fs"),
 * mapped to whether every occurrence sits inside a pcall (an optional
 * integration rather than a hard dependency).
 */
function requiredRoots(dir: string): Map<string, boolean> {
  const roots = new Map<string, boolean>();
  for (const file of walkLua(join(dir, 'lua'))) {
    const src = readFileSync(file, 'utf8').replace(LUA_COMMENT, '');
    for (const m of src.matchAll(REQUIRE)) {
      const root = m[1]?.split('.')[0];
      if (!root) continue;
      const at = m.index ?? 0;
      const guarded = /pcall\s*\(/.test(src.slice(Math.max(0, at - 160), at));
      roots.set(root, (roots.get(root) ?? true) && guarded);
    }
  }
  return roots;
}

const execFileAsync = promisify(execFile);
const GIT_CONCURRENCY = 8;

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return stdout.trim();
}

/** Promise.all with at most `limit` tasks in flight; results keep input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Strip inline markdown (links, emphasis, code, images) down to plain text. */
function plain(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const TAGLINE_MAX = 140;

/** First sentence, or the last clause boundary before TAGLINE_MAX, or a word-boundary cut. */
function firstSentence(s: string): string {
  const sentence = s.match(/^(.{30,}?[.!?])(?:\s|$)/)?.[1];
  if (sentence && sentence.length <= TAGLINE_MAX) return sentence;
  if (s.length <= TAGLINE_MAX) return s;
  const head = s.slice(0, TAGLINE_MAX);
  const clause = Math.max(
    head.lastIndexOf(' — '),
    head.lastIndexOf(' -- '),
    head.lastIndexOf('; '),
    head.lastIndexOf(': '),
  );
  if (clause > 30) return head.slice(0, clause).trimEnd();
  return `${head.slice(0, head.lastIndexOf(' ')).trimEnd()}…`;
}

interface ReadmeFacts {
  banner: string | null;
  status: PluginData['status'];
  statusNote: string | null;
  nvimMin: string | null;
  description: string;
  tagline: string;
}

/**
 * Every plugin README follows the same shape:
 *   > **Status blockquote**
 *   # name
 *   ```ascii banner```
 *   [badges]
 *   First paragraph = pitch.
 * Nothing here is guessed from a fixed line number; each part is located by
 * its own marker so a README that drops one part still parses. The status
 * quote must be the first non-blank content, though: a quote further down is
 * prose, not status.
 */
export function parseReadme(md: string): ReadmeFacts {
  const lines = md.split(/\r?\n/);

  const quote: string[] = [];
  for (const l of lines) {
    if (l.startsWith('>')) quote.push(l.replace(/^>\s?/, ''));
    else if (l.trim() || quote.length) break; // first blank line ends the quote
  }
  const statusNote = quote.length ? plain(quote.join(' ')) : null;
  let status: PluginData['status'] = 'unknown';
  if (statusNote) {
    if (/\balpha\b/i.test(statusNote)) status = 'alpha';
    else if (/\bbeta\b/i.test(statusNote)) status = 'beta';
    else if (/\bstable\b/i.test(statusNote)) status = 'stable';
  }

  let banner: string | null = null;
  const open = lines.findIndex((l, i) => i < 40 && /^```/.test(l));
  if (open >= 0) {
    const close = lines.findIndex((l, i) => i > open && /^```/.test(l));
    if (close > open)
      banner = lines
        .slice(open + 1, close)
        .join('\n')
        .trimEnd();
  }

  const nvimMin = md.match(/Neovim-(\d+\.\d+)/)?.[1] ?? null;

  const para: string[] = [];
  let inFence = false;
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const l = raw.trim();
    if (para.length === 0) {
      if (!l || /^[>#|]/.test(l) || /^[[!]/.test(l) || l.startsWith('<')) continue;
      para.push(l);
    } else if (!l) break;
    else para.push(l);
  }
  const description = plain(para.join(' '));
  return { banner, status, statusNote, nvimMin, description, tagline: firstSentence(description) };
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

function parseCommitLine(line: string, plugin: string, pluginName: string): Commit | null {
  const [sha, date, subjectRaw] = line.split(UNIT_SEP);
  if (!sha || !date || subjectRaw === undefined) return null;
  const m = subjectRaw.match(CONVENTIONAL);
  return {
    sha,
    date,
    type: m?.[1]?.toLowerCase() ?? null,
    scope: m?.[2] || null,
    breaking: Boolean(m?.[3]),
    subject: m?.[4] ?? subjectRaw,
    plugin,
    pluginName,
  };
}

type RegistryEntry = (typeof registry.plugins)[number] & { kind?: 'plugin' | 'desktop' };

/** lua/<module>/ directory name -> plugin slug, for directories unique to one plugin. */
function moduleMap(root: string): Map<string, string> {
  const owners = new Map<string, string[]>();
  for (const entry of registry.plugins) {
    const luaDir = join(root, entry.name, 'lua');
    if (!existsSync(luaDir)) continue;
    const slug = entry.name.replace(/\.nvim$/, '');
    for (const d of readdirSync(luaDir, { withFileTypes: true })) {
      if (d.isDirectory()) owners.set(d.name, [...(owners.get(d.name) ?? []), slug]);
    }
  }
  const map = new Map<string, string>();
  for (const [mod, slugs] of owners) if (slugs.length === 1 && slugs[0]) map.set(mod, slugs[0]);
  return map;
}

async function scanOne(
  root: string,
  entry: RegistryEntry,
  modules: Map<string, string>,
  logger: Logger,
): Promise<Scanned | null> {
  const dir = join(root, entry.name);
  if (!existsSync(join(dir, '.git'))) {
    logger.warn(`skip ${entry.name}: no checkout at ${dir}`);
    return null;
  }
  const readmePath = join(dir, 'README.md');
  const facts = parseReadme(existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '');

  const slug = entry.name.replace(/\.nvim$/, '');
  const docsDir = join(dir, 'docs');
  const docs = existsSync(docsDir)
    ? readdirSync(docsDir)
        .filter((f) => f.endsWith('.md') && statSync(join(docsDir, f)).isFile())
        .sort()
    : [];
  const docDir = join(dir, 'doc');
  const txtFiles = existsSync(docDir)
    ? readdirSync(docDir)
        .filter((f) => f.endsWith('.txt'))
        .sort()
    : [];
  const hasVimdoc = txtFiles.length > 0;
  // The primary help file is the one named after the plugin (cascade.txt,
  // lib.nvim.txt); otherwise the first one.
  const mainFile =
    txtFiles.find((f) => f === `${slug}.txt` || f === `${entry.name}.txt`) ?? txtFiles[0];
  const vimdocs: VimdocData[] = txtFiles.map((f) => {
    const text = readFileSync(join(docDir, f), 'utf8').replace(/\r\n/g, '\n');
    const file = f.replace(/\.txt$/, '');
    return {
      plugin: slug,
      pluginName: entry.name,
      file,
      title: vimdocTitle(text, file),
      main: f === mainFile,
      text,
    };
  });

  const demoDir = resolve(process.env.DEMOS_DIR ?? 'public/demos');
  const has = (ext: string): boolean => existsSync(join(demoDir, `${slug}.${ext}`));
  const demo =
    has('webm') || has('mp4') ? { webm: has('webm'), mp4: has('mp4'), poster: has('png') } : null;
  const shots = readShots(slug);

  const uses: string[] = [];
  const usesOptional: string[] = [];
  for (const [mod, optional] of requiredRoots(dir)) {
    const target = modules.get(mod);
    if (!target || target === slug) continue;
    (optional ? usesOptional : uses).push(target);
  }
  uses.sort();
  usesOptional.sort();

  let commits: Commit[] = [];
  let commitCount = 0;
  try {
    const [count, log] = await Promise.all([
      git(dir, ['rev-list', '--count', 'HEAD']),
      git(dir, ['log', `-n${RECENT_PER_REPO}`, '--format=%H%x1f%cI%x1f%s']),
    ]);
    commitCount = Number(count);
    commits = log
      .split('\n')
      .map((l) => parseCommitLine(l, slug, entry.name))
      .filter((c): c is Commit => c !== null);
  } catch (e) {
    logger.warn(`git failed for ${entry.name}: ${(e as Error).message}`);
  }

  return {
    plugin: {
      name: entry.name,
      slug,
      owner: OWNER,
      url: `https://github.com/${OWNER}/${entry.name}`,
      kind: entry.kind ?? 'plugin',
      category: entry.category,
      tagline: facts.tagline,
      description: facts.description,
      banner: facts.banner,
      status: facts.status,
      statusNote: facts.statusNote,
      nvimMin: facts.nvimMin,
      hasVimdoc,
      docs,
      commitCount,
      lastCommit: commits[0]?.date ?? null,
      recent: commits,
      vimdocs: vimdocs.map(({ file, title, main }) => ({ file, title, main })),
      uses,
      usesOptional,
      demo,
      shots,
    },
    commits,
    vimdocs,
  };
}

// Both loaders of one content sync share a scan; in dev a later refresh (a
// README edit, a new commit) rescans instead of serving the process-old copy.
const CACHE_MS = 5000;
let cache: { at: number; result: Promise<Scanned[]> } | null = null;

async function scanAll(logger: Logger): Promise<Scanned[]> {
  const root = resolve(process.env.PLUGINS_DIR ?? '..');
  const modules = moduleMap(root);
  const scanned = await mapLimit(registry.plugins as RegistryEntry[], GIT_CONCURRENCY, (entry) =>
    scanOne(root, entry, modules, logger),
  );
  const out = scanned.filter((s): s is Scanned => s !== null);
  logger.info(`scanned ${out.length}/${registry.plugins.length} repositories under ${root}`);
  // A missing repo is skipped on purpose (see deploy.yml), but nothing at all
  // means the checkout step failed -- never publish an empty site from CI.
  if (process.env.CI && out.length === 0) {
    throw new Error(`no plugin checkouts found under ${root} -- refusing to build an empty site`);
  }
  return out;
}

/** One scan per build (per sync in dev), shared by both collections; git runs in parallel. */
export function scanRepos(logger: Logger): Promise<Scanned[]> {
  const now = Date.now();
  if (!cache || (import.meta.env.DEV && now - cache.at > CACHE_MS)) {
    cache = { at: now, result: scanAll(logger) };
  }
  return cache.result;
}

export function pluginsLoader(): Loader {
  return {
    name: 'wkd-plugins',
    async load({ store, parseData, generateDigest, logger }) {
      store.clear();
      for (const { plugin } of await scanRepos(logger)) {
        const data = await parseData({ id: plugin.slug, data: plugin });
        store.set({ id: plugin.slug, data, digest: generateDigest(data) });
      }
    },
  };
}

export function vimdocsLoader(): Loader {
  return {
    name: 'wkd-vimdocs',
    async load({ store, parseData, generateDigest, logger }) {
      store.clear();
      for (const { vimdocs } of await scanRepos(logger)) {
        for (const d of vimdocs) {
          const id = `${d.plugin}/${d.file}`;
          const data = await parseData({ id, data: d });
          store.set({ id, data, digest: generateDigest(data) });
        }
      }
    },
  };
}

export function activityLoader(): Loader {
  return {
    name: 'wkd-activity',
    async load({ store, parseData, generateDigest, logger }) {
      store.clear();
      for (const { commits } of await scanRepos(logger)) {
        for (const c of commits) {
          const id = `${c.plugin}-${c.sha.slice(0, 10)}`;
          const data = await parseData({ id, data: c });
          store.set({ id, data, digest: generateDigest(data) });
        }
      }
    },
  };
}
