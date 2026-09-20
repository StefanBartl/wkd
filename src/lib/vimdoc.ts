// Vim help (`:help help-writing`) to HTML. Line-oriented on purpose: the
// format is defined by conventions, not a grammar, and the plugin docs follow
// them consistently:
//
//   *tag*                    anchor (right-aligned on heading lines)
//   |tag|                    cross-reference
//   ====== / ------          section separator; the next line is a heading
//   Heading ~                sub-heading (column heading)
//   text >  ...  <           code block (`>lua` sets the language)
//   'option'  `code`  <Key>  CTRL-X  {arg}  https://…
//
// Everything is HTML-escaped first; only markup produced here is emitted, and
// `href`s are built from tag names through encodeURIComponent.

export interface TagTarget {
  /** site page path without base/skin, e.g. "p/cascade/help" */
  page: string;
}

export interface RenderOptions {
  /** where a |tag| lives; null -> render as plain reference */
  resolve: (tag: string) => TagTarget | null;
  /** turns a page path into a URL for the current skin */
  href: (page: string) => string;
  /** the page the document itself is rendered on (same-page tags link to #fragment only) */
  self: string;
}

export interface Rendered {
  html: string;
  headings: { level: 2 | 3; text: string; id: string | null }[];
}

const TAG_RE = /\*([^\s*|]+)\*/g;

/** All `*tag*` anchors defined in a help file. */
export function collectTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) if (m[1]) tags.add(m[1]);
  return [...tags];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const INLINE = new RegExp(
  [
    /\*([^\s*|]+)\*/.source, // 1 tag definition
    /\|([^\s|]+)\|/.source, // 2 reference
    /`([^`\n]+)`/.source, // 3 code
    /'([a-z][a-z_]{2,}(?:\.[a-z_]+)*)'/.source, // 4 'option'
    /(<[A-Za-z][\w-]*(?:-[\w-]+)*>)/.source, // 5 <Key>
    /(CTRL-[^\s,.)]+)/.source, // 6 CTRL-X
    /(https?:\/\/[^\s)>\]]+)/.source, // 7 url
    /(\{[^{}\s]+\})/.source, // 8 {arg}
  ].join('|'),
  'g',
);

function inline(line: string, o: RenderOptions): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    out += esc(line.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    const [, tag, ref, code, opt, key, ctrl, url, arg] = m;
    if (tag) {
      out += `<a class="vd-tag" id="${esc(tag)}" href="#${encodeURIComponent(tag)}">*${esc(tag)}*</a>`;
    } else if (ref) {
      const t = o.resolve(ref);
      if (t) {
        const base = t.page === o.self ? '' : o.href(t.page);
        out += `<a class="vd-ref" href="${esc(base)}#${encodeURIComponent(ref)}">|${esc(ref)}|</a>`;
      } else {
        out += `<code class="vd-ref vd-ref--ext">|${esc(ref)}|</code>`;
      }
    } else if (code) {
      out += `<code>${esc(code)}</code>`;
    } else if (opt) {
      out += `<code class="vd-opt">'${esc(opt)}'</code>`;
    } else if (key) {
      out += `<kbd>${esc(key)}</kbd>`;
    } else if (ctrl) {
      out += `<kbd>${esc(ctrl)}</kbd>`;
    } else if (url) {
      // Sentence punctuation after a URL belongs to the prose, not the link
      // ("see https://github.com/x/y, which ..."), as in Vim's own helpURL.
      const [, link = url, trail = ''] = url.match(/^(.*?)([.,;:!?"']*)$/) ?? [];
      out += `<a class="vd-url" href="${esc(link)}" rel="noopener">${esc(link)}</a>${esc(trail)}`;
    } else if (arg) {
      out += `<var>${esc(arg)}</var>`;
    }
  }
  return out + esc(line.slice(last));
}

const SEPARATOR = /^[=-]{3,}\s*$/;
// A code block opens with `>` (optionally `>lua`) at the end of a line, and
// only when it stands alone or follows whitespace -- exactly like Vim's own
// help syntax. Without that rule a line ending in `<Esc>` or `->` would open
// a block and swallow the indented lines after it.
const CODE_OPEN = /^(?:(.*)\s)?>([a-z]*)$/;
const MODELINE = /^\s*vim?:/;
// Non-global twins of TAG_RE for .test(): a global regex keeps lastIndex
// between calls and would miss every other match.
const HAS_TAG = /\*[^\s*|]+\*/;
const TAG_LINE = /^\s*(?:\*[^\s*|]+\*\s*)+$/;

export function renderVimdoc(text: string, o: RenderOptions): Rendered {
  const lines = text.replace(/\r/g, '').split('\n');
  // Files end with a newline, so the modeline is the last non-blank line.
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop();
  if (lines.length && MODELINE.test(lines[lines.length - 1] ?? '')) lines.pop();

  const headings: Rendered['headings'] = [];
  const out: string[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  let codeLang = '';
  let pendingH2 = false;

  const flushPara = (): void => {
    // Drop leading/trailing blank lines of a block; keep inner spacing.
    while (para.length && para[0] === '') para.shift();
    while (para.length && para[para.length - 1] === '') para.pop();
    if (para.length) out.push(`<pre class="vd-text">${para.join('\n')}</pre>`);
    para = [];
  };
  const flushCode = (): void => {
    if (code === null) return;
    while (code.length && code[code.length - 1] === '') code.pop();
    const lang = codeLang ? ` data-lang="${esc(codeLang)}"` : '';
    // `>` directly followed by an unindented line (which ends the block, as in
    // Vim) leaves nothing to show; an empty bordered box would be an artefact.
    if (code.length) out.push(`<pre class="vd-code"${lang}><code>${code.join('\n')}</code></pre>`);
    code = null;
    codeLang = '';
  };
  const heading = (level: 2 | 3, raw: string): void => {
    flushPara();
    const tags = [...raw.matchAll(TAG_RE)].map((m) => m[1] ?? '');
    const textPart = raw.replace(TAG_RE, ' ').replace(/~\s*$/, '').replace(/\s+/g, ' ').trim();
    const id = tags[0] ?? null;
    headings.push({ level, text: textPart, id });
    const anchors = tags
      .map(
        (t) => `<a class="vd-tag" id="${esc(t)}" href="#${encodeURIComponent(t)}">*${esc(t)}*</a>`,
      )
      .join(' ');
    out.push(
      `<h${level} class="vd-h${level}">${esc(textPart)}${anchors ? ` <span class="vd-tags">${anchors}</span>` : ''}</h${level}>`,
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (code !== null) {
      if (line.startsWith('<')) {
        flushCode();
        const rest = line.slice(1);
        if (rest.trim()) para.push(inline(rest, o));
        continue;
      }
      if (line.trim() && !/^\s/.test(line)) {
        flushCode(); // unindented text ends the block implicitly
      } else {
        code.push(esc(line));
        continue;
      }
    }

    if (SEPARATOR.test(line)) {
      flushPara();
      out.push('<hr class="vd-hr">');
      pendingH2 = true;
      continue;
    }
    if (!line.trim()) {
      para.push('');
      continue;
    }
    if (pendingH2) {
      pendingH2 = false;
      // A tag that does not fit on the heading line goes right-aligned on the
      // next one (function signatures in lib.nvim's docs); keep it with the
      // heading so the section has an id and a TOC entry.
      const next = lines[i + 1] ?? '';
      if (!HAS_TAG.test(line) && TAG_LINE.test(next)) {
        i++;
        heading(2, `${line} ${next}`);
      } else if (
        TAG_LINE.test(line) &&
        next.trim() &&
        !SEPARATOR.test(next) &&
        !TAG_LINE.test(next) &&
        !CODE_OPEN.test(next)
      ) {
        // The other order: tag line first, heading text below it (reposcope's
        // command sections). Without the merge the heading and its TOC entry
        // would have no text at all.
        i++;
        heading(2, `${next} ${line}`);
      } else {
        heading(2, line);
      }
      continue;
    }
    const open = line.match(CODE_OPEN);
    if (open) {
      const before = open[1] ?? '';
      if (before.trim()) para.push(inline(before, o));
      flushPara();
      code = [];
      codeLang = open[2] ?? '';
      continue;
    }
    if (/\S\s*~$/.test(line) && !/^\s{20,}/.test(line)) {
      heading(3, line);
      continue;
    }
    para.push(inline(line, o));
  }
  flushCode();
  flushPara();
  return { html: out.join('\n'), headings };
}
