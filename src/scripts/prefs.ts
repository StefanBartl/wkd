import { href, MODE_KEY, MODES, SKIN_KEY, SKINS, type Skin, THEME_KEY, THEMES } from '../lib/site';

// Visitor preferences, all client-side and all optional:
//  - skin:  remembered on an explicit switch; on later visits internal links are
//           rewritten to the preferred skin (no redirect, no flash). The hint
//           bar offers both ways out: follow the link, or "stay here", which
//           re-points the links and stores the current skin instead.
//  - theme: TUI colorscheme, applied as data-theme on <html>.
//  - mode:  modern skin light/dark override, applied as data-mode on <html>.
// The inline bootstrap (src/lib/boot.ts) applies theme/mode before first
// paint; this module only wires the controls.
const root = document.documentElement;
const currentSkin = root.dataset.skin as Skin;
const otherSkin = document.body.dataset.otherSkin as Skin;

function read<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode etc. -- the control still works for this page */
  }
}

// ---- skin -----------------------------------------------------------------
const navLinks = document.querySelectorAll<HTMLAnchorElement>('a[data-nav]');
const pointNavTo = (skin: Skin): void => {
  for (const a of navLinks) a.href = href(a.dataset.nav ?? '', skin);
};

for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-skin-switch]')) {
  a.addEventListener('click', () => write(SKIN_KEY, otherSkin));
}

const preferredSkin = read(SKIN_KEY, SKINS);
if (preferredSkin && preferredSkin !== currentSkin) {
  pointNavTo(preferredSkin);
  const hint = document.querySelector<HTMLElement>('[data-skin-hint]');
  if (hint) {
    hint.hidden = false;
    hint
      .querySelector<HTMLButtonElement>('button[data-skin-keep]')
      ?.addEventListener('click', () => {
        write(SKIN_KEY, currentSkin);
        pointNavTo(currentSkin);
        hint.hidden = true;
      });
  }
}

// ---- theme (tui) ----------------------------------------------------------
const themeSelect = document.querySelector<HTMLSelectElement>('select[data-theme-select]');
if (themeSelect) {
  themeSelect.value = read(THEME_KEY, THEMES) ?? THEMES[0];
  themeSelect.addEventListener('change', () => {
    const theme = themeSelect.value;
    if (theme === THEMES[0]) {
      delete root.dataset.theme;
      write(THEME_KEY, null);
    } else {
      root.dataset.theme = theme;
      write(THEME_KEY, theme);
    }
  });
}

// ---- mode (modern) --------------------------------------------------------
const modeSelect = document.querySelector<HTMLSelectElement>('select[data-mode-select]');
if (modeSelect) {
  modeSelect.value = read(MODE_KEY, MODES) ?? 'auto';
  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value;
    if (mode === 'auto') {
      delete root.dataset.mode;
      write(MODE_KEY, null);
    } else {
      root.dataset.mode = mode;
      write(MODE_KEY, mode);
    }
  });
}
