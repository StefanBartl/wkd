// Shared by server components and the client skin script -- keep it free of
// node imports. Every internal URL goes through href() so the base path and
// the skin prefix live in exactly one place.
export type Skin = 'modern' | 'tui';
export const SKINS: readonly Skin[] = ['modern', 'tui'];
export const STORAGE_KEY = 'wkd:skin';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export function href(page: string, skin: Skin = 'modern'): string {
  const clean = page.replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = [skin === 'tui' ? 'tui' : '', clean].filter(Boolean);
  return parts.length ? `${BASE}${parts.join('/')}/` : BASE;
}

export function otherSkin(skin: Skin): Skin {
  return skin === 'modern' ? 'tui' : 'modern';
}
