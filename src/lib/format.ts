import registry from '../data/registry.json';

export const CATEGORIES: Record<string, string> = registry.categories;

export function categoryLabel(id: string): string {
  return CATEGORIES[id] ?? id;
}

/** Calendar day in UTC. Committer dates carry mixed offsets (GitHub-side
 *  commits are `Z`, local ones `+02:00`); grouping by the string's own day
 *  would split a day around midnight once the list is in true time order. */
export function isoDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Newest first by instant, not by string (offsets differ between commits). */
export function byDateDesc<T extends { data: { date: string } }>(a: T, b: T): number {
  return Date.parse(b.data.date) - Date.parse(a.data.date);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A count as a round, honest floor: "950+" rather than "972". Steps of 10 below
 * a hundred, 50 below a thousand, 100 above -- the figure stays true as the
 * number grows and does not twitch with every commit.
 */
export function approx(n: number): string {
  if (n < 10) return String(n);
  const step = n < 100 ? 10 : n < 1000 ? 50 : 100;
  return `${(Math.floor(n / step) * step).toLocaleString('en')}+`;
}

export function lazySnippet(owner: string, name: string): string {
  return `{\n  "${owner}/${name}",\n  opts = {},\n}`;
}
