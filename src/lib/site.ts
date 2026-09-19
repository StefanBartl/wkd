// Shared by server components and the client scripts -- keep it free of node
// imports. Every internal URL goes through href() so the base path and the
// skin prefix live in exactly one place.
export type Skin = 'modern' | 'tui';
export const SKINS: readonly Skin[] = ['modern', 'tui'];

export { THEMES, type Theme } from './themes';

// Modern skin light/dark override; 'auto' follows prefers-color-scheme.
export const MODES = ['auto', 'light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

// The modern skin's paper/ink pair, mirrored from modern.css for theme-color.
export const MODE_COLORS = { light: '#f1efe8', dark: '#0b0b0c' } as const;

// localStorage keys. src/lib/boot.ts repeats the literal strings because it
// cannot import this module; keep them in sync.
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

/** Validated read of a stored preference; null when absent, invalid or storage is blocked. */
export function readPref<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : null;
  } catch {
    return null;
  }
}
