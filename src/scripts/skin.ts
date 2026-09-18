import { href, SKINS, type Skin, STORAGE_KEY } from '../lib/site';

// Skin preference without redirects: remember an explicit switch, and on a
// later visit rewrite internal links so the visitor stays in their skin.
// Static hosting only, no flash -- the current page is left as rendered.
const root = document.documentElement;
const current = root.dataset.skin as Skin;
const other = document.body.dataset.otherSkin as Skin;

function read(): Skin | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return SKINS.includes(v as Skin) ? (v as Skin) : null;
  } catch {
    return null;
  }
}

function write(skin: Skin): void {
  try {
    localStorage.setItem(STORAGE_KEY, skin);
  } catch {
    /* private mode etc. -- the switch link still works */
  }
}

for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-skin-switch]')) {
  a.addEventListener('click', () => write(other));
}

const pref = read();
if (pref && pref !== current) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-nav]')) {
    a.href = href(a.dataset.nav ?? '', pref);
  }
  const hint = document.querySelector<HTMLElement>('[data-skin-hint]');
  if (hint) hint.hidden = false;
}
