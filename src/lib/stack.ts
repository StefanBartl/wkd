import type { CollectionEntry } from 'astro:content';

// The dependency picture of the family, from the require() edges the loader
// found under each plugin's lua/ tree (Lua comments excluded; a pcall-guarded
// require -- also pcall(require, "x") -- is an optional edge).

export interface Edge {
  slug: string;
  /** every require() of it is pcall-guarded: an optional integration */
  optional: boolean;
}

export interface StackNode {
  slug: string;
  name: string;
  category: string;
  uses: Edge[];
  usedBy: string[];
}

export function buildStack(plugins: CollectionEntry<'plugins'>[]): StackNode[] {
  const nodes = new Map<string, StackNode>();
  for (const p of plugins) {
    nodes.set(p.id, {
      slug: p.id,
      name: p.data.name,
      category: p.data.category,
      uses: [
        ...p.data.uses.map((slug) => ({ slug, optional: false })),
        ...p.data.usesOptional.map((slug) => ({ slug, optional: true })),
      ]
        .filter((e) => plugins.some((q) => q.id === e.slug))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      usedBy: [],
    });
  }
  for (const n of nodes.values()) {
    for (const u of n.uses) nodes.get(u.slug)?.usedBy.push(n.slug);
  }
  for (const n of nodes.values()) n.usedBy.sort();
  return [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Nodes ordered by how many plugins depend on them; only those with dependants. */
export function foundations(nodes: StackNode[]): StackNode[] {
  return nodes.filter((n) => n.usedBy.length > 0).sort((a, b) => b.usedBy.length - a.usedBy.length);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The TUI skin's two <pre> blocks as HTML strings. Assembled here rather than
 * in the template because whitespace inside <pre> is significant and JSX
 * formatting would break the alignment. Names are escaped; hrefs come from
 * the caller's href() over registry slugs.
 */
export function renderTuiStack(
  nodes: StackNode[],
  hrefOf: (slug: string) => string,
): { bars: string; tree: string } {
  const byName = new Map(nodes.map((n) => [n.slug, n.name]));
  const link = (slug: string, cls = ''): string =>
    `<a${cls ? ` class="${cls}"` : ''} href="${esc(hrefOf(slug))}" data-nav="p/${esc(slug)}">${esc(byName.get(slug) ?? slug)}</a>`;

  const base = foundations(nodes);
  const max = base[0]?.usedBy.length ?? 1;
  const bars = base
    .map((n) => {
      const pad = ' '.repeat(Math.max(1, 24 - n.name.length));
      const bar = '█'.repeat(Math.max(1, Math.round((n.usedBy.length / max) * 24)));
      // The block glyphs are decoration; the count after them is the value.
      return `${link(n.slug)}${pad}<span class="bar" aria-hidden="true">${bar}</span> ${n.usedBy.length}`;
    })
    .join('\n');

  const tree = nodes
    .filter((n) => n.uses.length)
    .map((n) => {
      const kids = n.uses.map((u, i) => {
        const branch = i === n.uses.length - 1 ? '└── ' : '├── ';
        const opt = u.optional ? ' <span class="tui-dim">(optional)</span>' : '';
        return `<span class="tui-dim">${branch}</span>${link(u.slug)}${opt}`;
      });
      return [link(n.slug, 'node'), ...kids].join('\n');
    })
    .join('\n\n');

  return { bars, tree };
}
