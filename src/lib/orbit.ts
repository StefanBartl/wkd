// A radial reading of the same roster the grid shows: one spoke per plugin,
// grouped into category bands by angle -- unrelated to the require() graph
// in stack.ts (this groups by src/data/registry.json's category, not by what
// requires what), so it includes every plugin, docmap-desktop included.

export interface OrbitPlugin {
  slug: string;
  name: string;
  category: string;
}

export interface OrbitBand {
  category: string;
  label: string;
  path: string;
  /** 0..1 fill-opacity step, distinct per category without inventing new hues. */
  tone: number;
}

export interface OrbitSpoke {
  slug: string;
  name: string;
  category: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  labelRotation: number;
  labelAnchor: 'start' | 'end';
}

export interface OrbitLayout {
  size: number;
  cx: number;
  cy: number;
  hubR: number;
  centerLabel: string;
  bands: OrbitBand[];
  spokes: OrbitSpoke[];
}

// SIZE has to clear R_LABEL by enough room for the longest label rendered
// fully horizontal (a spoke pointing due left/right) -- "runtime-analysis.nvim"
// at the 10px monospace used in CSS is close to 140px wide.
const SIZE = 900;
const GAP_DEG = 2.5;
const R_BAND_INNER = 78;
const R_BAND_OUTER = 104;
const R_SPOKE_OUTER = 250;
const R_LABEL = 262;

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function sectorPath(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number): string {
  const large = a2 - a1 > 180 ? 1 : 0;
  const p1 = polar(cx, cy, r2, a1);
  const p2 = polar(cx, cy, r2, a2);
  const p3 = polar(cx, cy, r1, a2);
  const p4 = polar(cx, cy, r1, a1);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${r2} ${r2} 0 ${large} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${r1} ${r1} 0 ${large} 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}

export function orbitLayout(plugins: OrbitPlugin[], categories: Record<string, string>): OrbitLayout {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const order = Object.keys(categories).filter((id) => plugins.some((p) => p.category === id));
  const total = plugins.length;
  const sweep = 360 - GAP_DEG * order.length;

  const bands: OrbitBand[] = [];
  const spokes: OrbitSpoke[] = [];
  let angle = -90; // 12 o'clock, so the first category reads like a clock face

  order.forEach((cat, i) => {
    const members = [...plugins]
      .filter((p) => p.category === cat)
      .sort((a, b) => a.name.localeCompare(b.name));
    const span = (members.length / total) * sweep;
    const start = angle;
    const end = angle + span;
    const tone = order.length > 1 ? 0.15 + (i / (order.length - 1)) * 0.7 : 0.5;
    bands.push({
      category: cat,
      label: categories[cat] ?? cat,
      path: sectorPath(cx, cy, R_BAND_INNER, R_BAND_OUTER, start, end),
      tone,
    });

    const step = span / members.length;
    members.forEach((m, j) => {
      const mid = start + step * (j + 0.5);
      const p1 = polar(cx, cy, R_BAND_OUTER, mid);
      const p2 = polar(cx, cy, R_SPOKE_OUTER, mid);
      const label = polar(cx, cy, R_LABEL, mid);
      const norm = ((mid % 360) + 360) % 360;
      const flip = norm > 90 && norm < 270;
      spokes.push({
        slug: m.slug,
        name: m.name,
        category: m.category,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        labelX: label.x,
        labelY: label.y,
        labelRotation: flip ? mid + 180 : mid,
        labelAnchor: flip ? 'end' : 'start',
      });
    });

    angle = end + GAP_DEG;
  });

  return { size: SIZE, cx, cy, hubR: R_BAND_INNER - 16, centerLabel: String(total), bands, spokes };
}
