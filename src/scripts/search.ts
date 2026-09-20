import { BASE, href, pageOf, readPref, SKIN_KEY, SKINS, type Skin } from '../lib/site';

// Static full-text search over the plugin pages. The index is produced by
// Pagefind after the build (src/integrations/pagefind.ts) and loaded lazily on
// first focus, so a visitor who never searches never downloads it.
//
// Only the modern-skin pages are indexed (otherwise every plugin would show up
// twice); result URLs are mapped back onto the skin the visitor is in.

interface PagefindData {
  url: string;
  excerpt: string;
  meta: Record<string, string>;
  filters: Record<string, string[]>;
}
interface PagefindResult {
  id: string;
  data(): Promise<PagefindData>;
}
interface Pagefind {
  options(opts: Record<string, unknown>): Promise<void>;
  search(query: string): Promise<{ results: PagefindResult[] }>;
}

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 120;
const UNAVAILABLE = import.meta.env.DEV
  ? 'no search index yet -- run `pnpm build` once'
  : 'search is unavailable right now';

const form = document.querySelector<HTMLFormElement>('form[data-search]');
if (form) init(form);

function init(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input[type="search"]');
  const panel = form.querySelector<HTMLElement>('[data-panel]');
  const list = form.querySelector<HTMLOListElement>('[data-results]');
  const status = form.querySelector<HTMLElement>('[data-status]');
  if (!input || !panel || !list || !status) return;

  const currentSkin = document.documentElement.dataset.skin as Skin;
  // Results follow the same skin the nav links point to (prefs.ts rewrites
  // those to a stored preference; "stay here" stores the current skin).
  const targetSkin = (): Skin => readPref(SKIN_KEY, SKINS) ?? currentSkin;
  let engine: Promise<Pagefind> | null = null;
  let attempt = 0;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A failed module import is memoised by the browser's module map, so a plain
  // retry of the same URL rejects again without a request; vary the URL instead.
  const load = (): Promise<Pagefind> => {
    engine ??= import(
      /* @vite-ignore */ `${BASE}pagefind/pagefind.js${attempt ? `?r=${attempt}` : ''}`
    )
      .then(async (m: Pagefind) => {
        await m.options({ baseUrl: BASE });
        return m;
      })
      .catch((e: unknown) => {
        engine = null;
        attempt++;
        throw e;
      });
    return engine;
  };

  // Closing also invalidates any in-flight search (seq) and pending debounce,
  // otherwise slow fragment loads would reopen the panel with stale results.
  const close = (): void => {
    seq++;
    clearTimeout(timer);
    panel.hidden = true;
    list.replaceChildren();
    status.textContent = '';
  };

  const open = (): void => {
    panel.hidden = false;
  };

  const render = (items: PagefindData[], query: string): void => {
    const skin = targetSkin();
    list.replaceChildren(...items.map((d) => resultItem(d, skin)));
    status.textContent = items.length
      ? `${items.length} result${items.length === 1 ? '' : 's'} for “${query}”`
      : `no plugin matches “${query}”`;
    open();
  };

  // Pagefind's excerpt is escaped text plus <mark> tags. Rebuild it as DOM
  // nodes instead of trusting it as HTML: an inert DOMParser document is
  // walked and only text and <mark> survive.
  const excerptNode = (html: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = 's-excerpt';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const node of doc.body.childNodes) {
      if (node instanceof Element && node.tagName === 'MARK') {
        const mark = document.createElement('mark');
        mark.textContent = node.textContent;
        span.append(mark);
      } else {
        span.append(document.createTextNode(node.textContent ?? ''));
      }
    }
    return span;
  };

  const resultItem = (d: PagefindData, skin: Skin): HTMLLIElement => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = href(pageOf(d.url), skin);
    const title = document.createElement('span');
    title.className = 's-title';
    title.textContent = d.meta.title ?? pageOf(d.url);
    const cat = document.createElement('span');
    cat.className = 's-cat';
    cat.textContent = d.filters.category?.[0] ?? '';
    a.append(title, cat, excerptNode(d.excerpt));
    li.append(a);
    return li;
  };

  const run = async (): Promise<void> => {
    if (form.dataset.mode === 'cmd') return; // the debounce fired after `:`
    const query = input.value.trim();
    const mine = ++seq;
    if (!query) {
      close();
      return;
    }
    // Stale when a newer search or close() moved seq on -- or when the TUI
    // command line took the field over while this search was in flight
    // (Tab out of the field, then `:`): its candidates must not be replaced.
    const stale = (): boolean => mine !== seq || form.dataset.mode === 'cmd';
    let pf: Pagefind;
    try {
      pf = await load();
    } catch {
      if (stale()) return;
      status.textContent = UNAVAILABLE;
      open();
      return;
    }
    const { results } = await pf.search(query);
    if (stale()) return;
    const items = await Promise.all(results.slice(0, MAX_RESULTS).map((r) => r.data()));
    if (stale()) return;
    render(items, query);
  };

  input.addEventListener('focus', () => {
    if (form.dataset.mode === 'cmd') return; // `:` needs no index
    load().catch(() => {});
  });
  input.addEventListener('input', () => {
    if (form.dataset.mode === 'cmd') return; // the TUI command line owns the field
    clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (form.dataset.mode === 'cmd') return;
    list.querySelector('a')?.click();
  });

  // Keyboard: `/` focuses search anywhere, Esc clears it, arrows walk results.
  const isEditable = (t: EventTarget | null): boolean =>
    t instanceof HTMLElement &&
    (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
      e.preventDefault();
      delete form.dataset.mode;
      input.focus();
      input.select();
    }
  });

  form.addEventListener('keydown', (e) => {
    if (form.dataset.mode === 'cmd') return;
    if (e.key === 'Escape') {
      input.value = '';
      close();
      input.blur();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...list.querySelectorAll<HTMLAnchorElement>('a')];
    if (!links.length) return;
    e.preventDefault();
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
    if (next < 0) input.focus();
    else links[Math.min(next, links.length - 1)]?.focus();
  });

  document.addEventListener('click', (e) => {
    // Unconditional: a click elsewhere while the first search is still loading
    // must cancel it too (close() is idempotent).
    if (e.target instanceof Node && !form.contains(e.target)) close();
  });
}
