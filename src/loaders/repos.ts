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
});
export type PluginData = z.infer<typeof pluginSchema>;

type Logger = LoaderContext['logger'];
interface Scanned {
  plugin: PluginData;
  commits: Commit[];
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
  const clause = Math.max(head.lastIndexOf(' — '), head.lastIndexOf('; '), head.lastIndexOf(': '));
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
    else if (l.trim()) break;
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

async function scanOne(
  root: string,
  entry: RegistryEntry,
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
  const hasVimdoc = existsSync(docDir) && readdirSync(docDir).some((f) => f.endsWith('.txt'));

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
    },
    commits,
  };
}

let cache: Promise<Scanned[]> | null = null;

async function scanAll(logger: Logger): Promise<Scanned[]> {
  const root = resolve(process.env.PLUGINS_DIR ?? '..');
  const scanned = await mapLimit(registry.plugins as RegistryEntry[], GIT_CONCURRENCY, (entry) =>
    scanOne(root, entry, logger),
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

/** One scan per process, shared by both collections; git runs in parallel. */
export function scanRepos(logger: Logger): Promise<Scanned[]> {
  cache ??= scanAll(logger);
  return cache;
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
