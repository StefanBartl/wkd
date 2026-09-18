import registry from '../data/registry.json';

export const CATEGORIES: Record<string, string> = registry.categories;

export function categoryLabel(id: string): string {
  return CATEGORIES[id] ?? id;
}

export function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function lazySnippet(owner: string, name: string): string {
  return `{\n  "${owner}/${name}",\n  opts = {},\n}`;
}
