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

export interface TreeNodePos {
  slug: string;
  name: string;
  category: string;
  depth: number;
  x: number;
  y: number;
}

export interface TreeEdge {
  from: string;
  to: string;
  optional: boolean;
}

export interface TreeLayout {
  width: number;
  height: number;
  nodes: TreeNodePos[];
  edges: TreeEdge[];
  /** Plugins with neither an outgoing nor an incoming edge -- not drawn. */
  isolated: number;
}

const TREE_NODE_SPACING = 150;
const TREE_LAYER_HEIGHT = 130;
const TREE_MARGIN_X = 75;
const TREE_MARGIN_TOP = 40;
const TREE_MARGIN_BOTTOM = 50;

/**
 * A layered, roots-at-the-bottom reading of the require() graph: a node's
 * depth is the longest chain of *hard* requires down to something with none
 * of its own. Depth deliberately ignores optional (pcall-guarded) edges --
 * lib.nvim optionally requires two plugins that hard-require lib.nvim back,
 * so counting those would make the "depth" of the graph's own foundation
 * undefined (a cycle). Optional edges are still returned in `edges` and
 * drawn, just excluded from the layering itself.
 */
export function treeLayout(nodes: StackNode[]): TreeLayout {
  const connected = nodes.filter((n) => n.uses.length > 0 || n.usedBy.length > 0);
  const isolated = nodes.length - connected.length;
  const bySlug = new Map(connected.map((n) => [n.slug, n]));

  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  function depthOf(slug: string): number {
    const cached = depths.get(slug);
    if (cached !== undefined) return cached;
    if (visiting.has(slug)) return 0; // guard against an unexpected hard-edge cycle
    visiting.add(slug);
    const n = bySlug.get(slug);
    const hard = n ? n.uses.filter((e) => !e.optional && bySlug.has(e.slug)) : [];
    const d = hard.length === 0 ? 0 : 1 + Math.max(...hard.map((e) => depthOf(e.slug)));
    visiting.delete(slug);
    depths.set(slug, d);
    return d;
  }
  for (const n of connected) depthOf(n.slug);

  const maxDepth = Math.max(0, ...connected.map((n) => depths.get(n.slug) ?? 0));
  const layers: StackNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of connected) layers[depths.get(n.slug) ?? 0]?.push(n);
  for (const layer of layers) layer.sort((a, b) => a.name.localeCompare(b.name));

  const widest = Math.max(1, ...layers.map((l) => l.length));
  const width = TREE_MARGIN_X * 2 + (widest - 1) * TREE_NODE_SPACING;
  const height = TREE_MARGIN_TOP + TREE_MARGIN_BOTTOM + maxDepth * TREE_LAYER_HEIGHT;

  const positions = new Map<string, TreeNodePos>();
  layers.forEach((layer, depth) => {
    const y = height - TREE_MARGIN_BOTTOM - depth * TREE_LAYER_HEIGHT;
    const rowWidth = (layer.length - 1) * TREE_NODE_SPACING;
    const startX = (width - rowWidth) / 2;
    layer.forEach((n, i) => {
      positions.set(n.slug, {
        slug: n.slug,
        name: n.name,
        category: n.category,
        depth,
        x: startX + i * TREE_NODE_SPACING,
        y,
      });
    });
  });

  const edges: TreeEdge[] = [];
  for (const n of connected) {
    for (const e of n.uses) {
      if (positions.has(e.slug)) edges.push({ from: n.slug, to: e.slug, optional: e.optional });
    }
  }

  return { width, height, nodes: [...positions.values()], edges, isolated };
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
