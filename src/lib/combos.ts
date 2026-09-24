import combosData from '../data/combos.json';
import registry from '../data/registry.json';

// Cross-category groupings, distinct from src/data/registry.json's one
// category per plugin: a plugin can be in several of these, or none. Colour
// identity is deliberately its own (see modern.css) rather than reusing the
// category neons -- the whole point here is a second, visibly different
// system, not a restyled category.

export interface Combo {
  id: string;
  name: string;
  blurb: string;
  members: string[];
}

export const COMBOS: Combo[] = combosData.combos;

// Server-side only, ships no bytes: a typo'd slug here should fail the
// build, not silently drop a member or link a 404 (same reasoning as the
// demos.json/CategoryFilter checks elsewhere in this codebase).
const registrySlugs = new Set(registry.plugins.map((p) => p.name.replace(/\.nvim$/, '')));
for (const combo of COMBOS) {
  for (const slug of combo.members) {
    if (!registrySlugs.has(slug)) {
      throw new Error(`src/data/combos.json: combo "${combo.id}" names unknown plugin "${slug}"`);
    }
  }
}

export function combosFor(slug: string): Combo[] {
  return COMBOS.filter((c) => c.members.includes(slug));
}
