// Shared by server components and the client scripts -- keep it free of node
// imports. Every internal URL goes through href() so the base path and the
// skin prefix live in exactly one place.
export type Skin = 'modern' | 'tui';
export const SKINS: readonly Skin[] = ['modern', 'tui'];

// TUI colorschemes; the palettes live in src/styles/themes.css. The first one
// is the default (no data-theme attribute).
export const THEMES = ['tokyonight', 'gruvbox', 'catppuccin', 'kanagawa', 'nord'] as const;
export type Theme = (typeof THEMES)[number];

// Modern skin light/dark override; 'auto' follows prefers-color-scheme.
export const MODES = ['auto', 'light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

// localStorage keys. The inline bootstrap in Base.astro repeats the literal
// strings because it cannot import modules; keep them in sync.
export const SKIN_KEY = 'wkd:skin';
export const THEME_KEY = 'wkd:theme';
export const MODE_KEY = 'wkd:mode';

export const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export function href(page: string, skin: Skin = 'modern'): string {
  const clean = page.replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = [skin === 'tui' ? 'tui' : '', clean].filter(Boolean);
  return parts.length ? `${BASE}${parts.join('/')}/` : BASE;
}

/** Inverse of href(): a site URL (any skin) back to the skin-less page path. */
export function pageOf(url: string): string {
  let p = url.startsWith(BASE) ? url.slice(BASE.length) : url.replace(/^\/+/, '');
  if (p === 'tui' || p.startsWith('tui/')) p = p.slice(3);
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function otherSkin(skin: Skin): Skin {
  return skin === 'modern' ? 'tui' : 'modern';
}
