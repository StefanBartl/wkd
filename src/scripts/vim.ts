import { href, pageOf, SKIN_KEY, type Skin, THEMES } from '../lib/site';

// Vim-style operation of the TUI skin. Everything here is progressive: the
// links, the search field and the selects work without it.
//
//  j / k, gg / G   move a cursor over the links in <main> (focus follows)
//  Enter           open (native link activation)
//  :               command line in the footer, Tab completes, Enter runs
//  ?               key help (a <dialog>)
//  /               search (src/scripts/search.ts; both share the same field,
//                  coordinated through form.dataset.mode === 'cmd')
//
// The command line reuses the search form's input and result panel; while
// data-mode="cmd" is set, search.ts stays out of the way.

type ModeName = 'NORMAL' | 'INSERT' | 'COMMAND';

interface Command {
  name: string;
  aliases: string[];
  arg: 'plugin' | 'theme' | 'skin' | null;
  desc: string;
  run: (arg: string) => void;
}

interface Candidate {
  text: string; // what Tab inserts (command name or argument)
  desc: string;
}

const PENDING_G_MS = 800;

if (document.documentElement.dataset.skin === 'tui') init();

function init(): void {
  const form = document.querySelector<HTMLFormElement>('form[data-search]');
  const input = form?.querySelector<HTMLInputElement>('input[type="search"]');
  const panel = form?.querySelector<HTMLElement>('[data-panel]');
  const list = form?.querySelector<HTMLOListElement>('[data-results]');
  const status = form?.querySelector<HTMLElement>('[data-status]');
  const main = document.querySelector<HTMLElement>('main');
  if (!form || !input || !panel || !list || !status || !main) return;

  const modeEl = document.querySelector<HTMLElement>('.tui-status .mode');
  const help = document.querySelector<HTMLDialogElement>('dialog[data-help]');
  const placeholder = input.placeholder;
  const currentPage = pageOf(location.pathname);

  const plugins = [
    ...document.querySelectorAll<HTMLAnchorElement>('nav.tui-side a.item[data-nav]'),
  ].map((a) => ({
    slug: (a.dataset.nav ?? '').replace(/^p\//, ''),
    name: a.textContent?.trim() ?? '',
    help: a.hasAttribute('data-vimdoc'), // has a /help page (doc/*.txt exists)
  }));

  const setMode = (m: ModeName): void => {
    if (modeEl) modeEl.textContent = m;
  };
  const inCmd = (): boolean => form.dataset.mode === 'cmd';
  const isEditable = (t: EventTarget | null): boolean =>
    t instanceof HTMLElement &&
    (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  // ---- command line ----------------------------------------------------------
  const go = (page: string, skin: Skin = 'tui'): void => {
    location.href = href(page, skin);
  };

  const fail = (msg: string): void => {
    exitCmd();
    status.textContent = msg;
    status.classList.add('is-error');
    panel.hidden = false;
  };

  const resolvePlugin = (arg: string): string | null => {
    const q = arg.toLowerCase().replace(/\.nvim$/, '');
    if (!q) return null;
    const exact = plugins.find((p) => p.slug === q || p.name.toLowerCase() === q);
    if (exact) return exact.slug;
    const starts = plugins.filter((p) => p.slug.startsWith(q));
    if (starts.length === 1) return starts[0]?.slug ?? null;
    const includes = plugins.filter((p) => p.slug.includes(q));
    return includes.length === 1 ? (includes[0]?.slug ?? null) : null;
  };

  const hasHelp = (slug: string): boolean => plugins.some((p) => p.slug === slug && p.help);

  const openPlugin = (arg: string, suffix = ''): void => {
    let slug: string | null;
    if (!arg) {
      // :help on a plugin page opens that plugin's help; elsewhere the list.
      slug = currentPage.match(/^p\/([^/]+)/)?.[1] ?? null;
      if (!slug) {
        go('');
        return;
      }
    } else {
      slug = resolvePlugin(arg);
      if (!slug) {
        fail(`E149: Sorry, no plugin matches "${arg}"`);
        return;
      }
    }
    // A plugin without doc/*.txt has no help page; the link would 404.
    if (suffix === '/help' && !hasHelp(slug)) {
      fail(`E149: Sorry, no help for ${slug}`);
      return;
    }
    go(`p/${slug}${suffix}`);
  };

  const commands: Command[] = [
    {
      name: 'help',
      aliases: ['h'],
      arg: 'plugin',
      desc: 'vimdoc of a plugin',
      run: (arg) => openPlugin(arg, '/help'),
    },
    { name: 'stack', aliases: [], arg: null, desc: 'dependency graph', run: () => go('stack') },
    {
      name: 'edit',
      aliases: ['e'],
      arg: 'plugin',
      desc: 'open a plugin page',
      run: (arg) => openPlugin(arg),
    },
    { name: 'ls', aliases: ['plugins'], arg: null, desc: 'all plugins', run: () => go('') },
    {
      name: 'log',
      aliases: ['activity'],
      arg: null,
      desc: 'activity stream',
      run: () => go('activity'),
    },
    {
      name: 'colorscheme',
      aliases: ['colo'],
      arg: 'theme',
      desc: 'switch colorscheme',
      run: (arg) => {
        const sel = document.querySelector<HTMLSelectElement>('select[data-theme-select]');
        const theme = THEMES.find((t) => t === arg || (arg && t.startsWith(arg)));
        if (!sel || !theme) return fail(`E185: Cannot find color scheme '${arg}'`);
        sel.value = theme;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        exitCmd();
      },
    },
    {
      name: 'set',
      aliases: [],
      arg: 'skin',
      desc: 'set skin=modern | skin=tui',
      run: (arg) => {
        const m = arg.match(/^skin=(modern|tui)$/);
        if (!m) return fail(`E518: Unknown option: ${arg || '(none)'}`);
        const skin = m[1] as Skin;
        try {
          localStorage.setItem(SKIN_KEY, skin);
        } catch {
          /* fine, the navigation still happens */
        }
        go(currentPage, skin);
      },
    },
    {
      name: 'quit',
      aliases: ['q'],
      arg: null,
      desc: 'close the command line',
      run: () => exitCmd(),
    },
  ];

  const findCommand = (name: string): Command | undefined => {
    const n = name.toLowerCase();
    return (
      commands.find((c) => c.name === n || c.aliases.includes(n)) ??
      (() => {
        const hits = commands.filter((c) => c.name.startsWith(n));
        return hits.length === 1 ? hits[0] : undefined;
      })()
    );
  };

  const candidates = (typed: string): Candidate[] => {
    const raw = typed.replace(/^\s+/, '');
    const space = raw.indexOf(' ');
    if (space < 0) {
      const q = raw.toLowerCase();
      return commands
        .filter((c) => c.name.startsWith(q) || c.aliases.some((a) => a.startsWith(q)))
        .map((c) => ({ text: c.name, desc: c.desc }));
    }
    const cmd = findCommand(raw.slice(0, space));
    const arg = raw
      .slice(space + 1)
      .trim()
      .toLowerCase();
    if (!cmd) return [];
    switch (cmd.arg) {
      case 'plugin':
        return plugins
          .filter((p) => p.slug.includes(arg))
          .map((p) => ({ text: p.slug, desc: p.name }));
      case 'theme':
        return THEMES.filter((t) => t.startsWith(arg)).map((t) => ({
          text: t,
          desc: 'colorscheme',
        }));
      case 'skin':
        return ['skin=modern', 'skin=tui']
          .filter((s) => s.startsWith(arg))
          .map((s) => ({ text: s, desc: 'skin' }));
      default:
        return [];
    }
  };

  // Tab cycles through the candidates of what was *typed* (seed), not of the
  // text a previous Tab inserted -- otherwise the second Tab sees only the
  // one candidate it just completed to and the cycle is stuck.
  let tabIndex = -1;
  let seed: string | null = null;
  const renderCandidates = (): void => {
    const cands = candidates(input.value);
    tabIndex = -1;
    seed = null;
    status.classList.remove('is-error');
    status.textContent = cands.length ? '' : input.value.trim() ? 'no completion' : '';
    list.replaceChildren(
      ...cands.map((c, i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.index = String(i);
        const t = document.createElement('span');
        t.className = 's-title';
        t.textContent = c.text;
        const d = document.createElement('span');
        d.className = 's-excerpt';
        d.textContent = c.desc;
        b.append(t, d);
        // Keep the input focused (no blur -> no exitCmd) and apply the candidate.
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          applyCandidate(c, seed ?? input.value);
          execute();
        });
        li.append(b);
        return li;
      }),
    );
    panel.hidden = !cands.length && !status.textContent;
  };

  const applyCandidate = (c: Candidate, typed: string): void => {
    const raw = typed.replace(/^\s+/, '');
    const space = raw.indexOf(' ');
    input.value = space < 0 ? `${c.text} ` : `${raw.slice(0, space)} ${c.text}`;
    input.setSelectionRange(input.value.length, input.value.length);
  };

  const complete = (dir: 1 | -1): void => {
    seed ??= input.value;
    const cands = candidates(seed);
    if (!cands.length) return;
    tabIndex = (tabIndex + dir + cands.length) % cands.length;
    const c = cands[tabIndex];
    if (!c) return;
    applyCandidate(c, seed);
    for (const b of list.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('is-active', b.dataset.index === String(tabIndex));
    }
  };

  const enterCmd = (): void => {
    form.dataset.mode = 'cmd';
    input.value = '';
    input.placeholder = '';
    input.focus();
    setMode('COMMAND');
    renderCandidates();
  };

  const exitCmd = (): void => {
    delete form.dataset.mode;
    input.value = '';
    input.placeholder = placeholder;
    list.replaceChildren();
    status.textContent = '';
    status.classList.remove('is-error');
    panel.hidden = true;
    if (document.activeElement === input) input.blur();
    setMode('NORMAL');
  };

  const execute = (): void => {
    const raw = input.value.trim();
    if (!raw) {
      exitCmd();
      return;
    }
    const space = raw.indexOf(' ');
    const name = space < 0 ? raw : raw.slice(0, space);
    const arg = space < 0 ? '' : raw.slice(space + 1).trim();
    const cmd = findCommand(name);
    if (!cmd) {
      fail(`E492: Not an editor command: ${raw}`);
      return;
    }
    cmd.run(arg);
  };

  input.addEventListener('focus', () => {
    // `/` after a failed command: the error would otherwise colour the search
    // status red until the next `:`.
    if (!inCmd() && status.classList.contains('is-error')) {
      status.classList.remove('is-error');
      status.textContent = '';
      panel.hidden = true;
    }
    setMode(inCmd() ? 'COMMAND' : 'INSERT');
  });
  input.addEventListener('blur', () => {
    if (inCmd()) exitCmd();
    else setMode('NORMAL');
  });
  input.addEventListener('input', () => {
    if (inCmd()) renderCandidates();
  });
  form.addEventListener('submit', (e) => {
    if (!inCmd()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    execute();
  });
  form.addEventListener('keydown', (e) => {
    if (!inCmd()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      exitCmd();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete(e.shiftKey ? -1 : 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      complete(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      complete(-1);
    }
  });

  // ---- motions -----------------------------------------------------------------
  let cursor = -1;
  let pendingG = 0;
  const rows = (): HTMLAnchorElement[] =>
    [...main.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => a.offsetParent !== null);

  const moveTo = (index: number): void => {
    const all = rows();
    if (!all.length) return;
    const prev = all[cursor];
    prev?.classList.remove('vim-cur');
    cursor = Math.max(0, Math.min(index, all.length - 1));
    const row = all[cursor];
    if (!row) return;
    row.classList.add('vim-cur');
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
  };

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (help?.open) return;
    switch (e.key) {
      case ':':
        e.preventDefault();
        enterCmd();
        break;
      case '?':
        e.preventDefault();
        help?.showModal();
        break;
      case 'j':
        e.preventDefault();
        moveTo(cursor + 1);
        break;
      case 'k':
        e.preventDefault();
        moveTo(cursor - 1);
        break;
      case 'G':
        e.preventDefault();
        moveTo(Number.MAX_SAFE_INTEGER);
        break;
      case 'g': {
        e.preventDefault();
        const now = Date.now();
        if (now - pendingG < PENDING_G_MS) {
          pendingG = 0;
          moveTo(0);
        } else pendingG = now;
        break;
      }
      default:
    }
  });

  // Keep the cursor in sync when focus moves by Tab or mouse.
  main.addEventListener('focusin', (e) => {
    const all = rows();
    const i = all.indexOf(e.target as HTMLAnchorElement);
    if (i < 0) return;
    all[cursor]?.classList.remove('vim-cur');
    cursor = i;
    all[i]?.classList.add('vim-cur');
  });
}
