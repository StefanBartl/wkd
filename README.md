# wkd

wkd -- website for the `.nvim` plugin family. Everything on the site — taglines, status,
ASCII banners, docs listings, commit counts, the activity stream — is read from the
plugin repositories at build time. Nothing about a plugin is written twice.

Live (once deployed): <https://stefanbartl.github.io/wkd/>

## Two skins, one content layer

| Skin | Path | Look |
|---|---|---|
| `modern` (default) | `/wkd/…` | Editorial brutalism: hairline grid, one acid accent, oversized variable type, `light-dark()` |
| `tui` | `/wkd/tui/…` | The site as a Neovim window: statusline, sidebar, cmdline, 16-colour terminal palette |

Both skins are built statically from the same collections. The switcher is a plain link to
the same page in the other skin; `src/scripts/prefs.ts` remembers the choice in
`localStorage` and rewrites internal links on later visits (no redirects, no flash).

## How content gets in

```
../<plugin>/                 (sibling checkouts locally; cloned in CI)
  README.md   → banner (first code block), status (first blockquote), tagline (first paragraph)
  docs/*.md   → documentation list
  doc/*.txt   → rendered help pages (+ cross-plugin tag index)
  lua/**      → require() edges for /stack
  .git        → commit count, last 12 commits (conventional-commit parsed)
```

- `src/data/registry.json` — the only hand-maintained list: plugin name, category, kind.
  Adding a plugin is one line here.
- `src/loaders/repos.ts` — the Astro content loader that scans the checkouts and fills two
  collections, `plugins` and `activity`.
- `PLUGINS_DIR` — where the checkouts live (default: the parent directory of this repo).

## Commands

```bash
pnpm install
pnpm dev        # http://127.0.0.1:4321/wkd/
pnpm build      # static output in dist/
pnpm preview
pnpm verify     # biome + astro check + build
```

Requires Node ≥ 22.12 and pnpm ≥ 10.

## Stack and constraints

- **Astro 7**, zero client JS by default. Total client script is ~8 KB: the preference
  helper (`src/scripts/prefs.ts`) and the search UI (`src/scripts/search.ts`); the Pagefind
  engine loads only when the search field is focused for a search (the TUI command line
  reuses the field but never loads it).
- **Search** is Pagefind, built into `dist/pagefind/` after `astro build` by
  `src/integrations/pagefind.ts` (which also serves that bundle in `astro dev` once a build
  exists). Only the modern-skin plugin pages carry `data-pagefind-body`, so each plugin is
  indexed once; results are mapped onto whichever skin the visitor is in. Press `/` anywhere.
- **Vim operation** of the TUI skin (`src/scripts/vim.ts`, progressive — everything is a
  plain link underneath): `j`/`k`/`gg`/`G` move a cursor line over the links in `<main>`,
  `:` opens a command line in the footer that shares the search field (`:help x`, `:e x`,
  `:ls`, `:log`, `:colorscheme x`, `:set skin=modern|tui`, `:q`; `Tab` / `Shift+Tab` cycle
  through the completions of commands, plugin names and themes; `:help x` on a plugin
  without `doc/*.txt` fails with E149 instead of landing on a 404), `?` opens the key help,
  and the statusline shows NORMAL / INSERT / COMMAND.
- **Vimdoc** (`src/lib/vimdoc.ts`): every `doc/*.txt` is rendered to HTML at `/p/<plugin>/help/`
  (further files at `/p/<plugin>/help/<file>/`, lib.nvim has 17). Line-oriented on the help
  conventions -- `*tag*` anchors, `|tag|` links resolved across all plugins' docs, `>lua … <`
  code blocks, `~` headings, `'option'`, `<Key>`; everything HTML-escaped first. Help pages are
  in the search index (modern skin only, like the plugin pages), so `:help`-style searches
  work site-wide.
- **Stack** (`/stack`): the `require()` edges between the plugins, read from every file of each
  `lua/` tree (Lua comments excluded); a require inside `pcall` -- `pcall(require, …)` included --
  counts as *optional*. "Depended on" ranking plus a per-plugin tree.
- **Category filter** on the home pages is pure CSS: radio inputs plus `:has()` rules in
  `src/styles/filter.css`. Adding a category to the registry means adding one rule there.
- **Preferences** (all optional, all `localStorage`): skin, TUI colorscheme
  (`src/styles/themes.css`: tokyonight, gruvbox, catppuccin, kanagawa, nord) and the modern
  skin's light/dark override. A one-line inline bootstrap (`src/lib/boot.ts`, emitted
  verbatim by `Base.astro`) applies theme and mode before first paint and marks `<html>`
  with `data-js`, which is what hides the search field and the two selects when scripting
  is off. Astro does not hash `is:inline` scripts, so `astro.config.ts` computes the
  SHA-256 of that string itself and adds it to `script-src`.
- **Prefetch** is opt-in per link (`data-astro-prefetch` on cards, table rows, nav and
  commit links, hover strategy) rather than site-wide: the 38-link TUI sidebar sits on every
  page, and a keyboard pass over it would otherwise fetch every plugin page.
- **Accessibility** is part of the design, not a pass afterwards: skip links, visible focus
  rings in both skins (the acid accent is 1.03:1 on light paper, so focus uses ink there),
  decorative ASCII and generated text hidden from assistive tech (`aria-hidden`,
  `content: "# " / ""`), the ticker's loop copy `inert`, a pause control for the marquee,
  and the TUI sidebar moved below the content on phones.
- **Native CSS**: cascade layers, `light-dark()`, container/scroll-driven animations,
  cross-document view transitions (`@view-transition`, no client router).
- **Fonts** via Astro's Fonts API from the pinned `@fontsource-variable/*` packages (local
  provider, wght-only latin files: 35 KB + 40 KB), self-hosted, preloaded. Nothing is fetched
  from a CDN at build time, so a CDN outage cannot fail a scheduled deploy.
- **CSP** is generated by Astro as a hashed `<meta http-equiv>` — the only form GitHub Pages
  can serve. Consequences: no `<ClientRouter />`, no Shiki inline styles, no external
  scripts. `script-src` additionally allows `'wasm-unsafe-eval'` for Pagefind's search core.
  `frame-ancestors`, COOP/COEP and `Permissions-Policy` need real headers and will come with
  a move to Cloudflare Pages.
- **Base path** is `/wkd`. Every internal URL goes through `href()` in `src/lib/site.ts`;
  moving to a custom domain is `base: '/'` in `astro.config.ts` and nothing else.
- **Lint/format**: Biome. `.astro` templates are not analysed for unused imports (Biome does
  not read the template part yet). The one Lua file, `demos/init.lua`, is checked like the
  plugins it drives: `stylua --check demos/init.lua` and `luacheck demos/init.lua` from the
  repository root (`.stylua.toml` and `.luacheckrc` here copy the family's settings).

## Demos

`demos/<plugin>.tape` is a [VHS](https://github.com/charmbracelet/vhs) script that drives a
clean Neovim (`demos/init.lua`: only lib.nvim, ui.nvim, the demoed plugin and the tokyonight colorscheme on the
runtimepath, read from `$PLUGINS_DIR`) over a fixture in `demos/fixtures/`. Two recording
aids come from that config: `:Demo <text>` shows a title float (top right) naming the feature
currently demonstrated, and ui.nvim's screenkey HUD (bottom right) shows the keys behind
every action. The
`Record demos` workflow records every tape in its own job (a matrix read from `demos/demos.json`,
so a run takes about as long as the slowest tape, roughly five minutes, instead of the sum of
all of them), turns each recording into `<plugin>.webm` + `.mp4` + a `.webp` poster and, once
every job succeeded, force-pushes them as the single-commit orphan branch `demo-assets` -- weekly, on `workflow_dispatch`, and whenever
`demos/**` or `scripts/tape-chapters.mjs` changes. The deploy workflow copies that branch into `public/demos/` (a branch that
does not exist yet means a build without demos; an origin that cannot be queried fails the run
rather than deploying a demo-less site over a good one); the loader
turns whatever it finds there into a `<video>` on the plugin page (both skins). Recordings
are therefore reproducible, never stale, and never part of main's history. For a local build
with videos: `scripts/pull-demos.sh`. A tape recorded locally (`vhs demos/<tape>.tape` from the
repository root) lands in `out/`, which is ignored. Each tape's chapters (the second at which each feature starts) are computed from the tape by
`scripts/tape-chapters.mjs` (VHS's own clock: typing speed per character and per key repeat,
sleeps, nothing while hidden, nothing for a `Ctrl+`/`Alt+`/`Shift+` combination) and
published as `<tape>.chapters.json`; the page lists them under the player as jump marks. The
recording aids in `demos/init.lua`: `<C-t>` shows the next title from `$DEMO_TITLES` with a
`$DEMO_COUNTDOWN`-second countdown (default 3) before the feature's keys, and past the last
title the "loops from here" card. A plugin may have more than one tape: an
entry with its own `tape` name (`hover-media` for `demos/hover-media.tape`), a `title`, a `needs`
list (plugins of the family the shown feature depends on, linked from the caption) and a `note`.
`plugin` and every `needs` entry must be a registry slug: the build fails on a typo instead of
linking a 404.
Adding a demo = one tape + one line in
`demos/demos.json` (which checkouts it needs; a bare slug is one of the family, `owner/repo@sha`
a third-party dependency such as telescope, pinned to a commit because its code runs in the
container that produces what the site serves) + a `setup()` entry in `demos/init.lua` if the
plugin needs one. External tools a plugin shells out to (ripgrep, fd) are downloaded by the
workflow (version and checksum pinned) and mounted into the container. The publish step
refuses anything but `.webm`/`.mp4`/`.webp`/`.chapters.json`, since the deploy copies the branch
verbatim under the site origin. The record job's checkout carries no token and is mounted into the
container as the tapes' working directory, with `.git` hidden behind an empty read-only tmpfs
(actions/checkout's post step runs git in that checkout on the host); the chapters are computed
before the container runs and copied next to the recording only afterwards, and a symlink among
the outputs fails the job instead of being followed by the upload. lib.nvim's first-run panel for missing external tools is switched off in that
config (`vim.g.lib_nvim_deps_disable_first_run`): in the container it would open on every
recording and, being entered, become the window the demoed command runs from -- which is how
the diff.nvim tape once recorded a diff of the panel's float. A third aid, `:DemoDump [label]`, appends the window/option state to
`demos/out/_dump-<plugin>.txt`, which the workflow prints into the job log and drops before
publishing -- for a recording that looks wrong in CI but right locally. VHS runs in its official container image, pinned to v0.11.0 by tag and digest: v0.12.0 exits 0
without writing any file ([charmbracelet/vhs#787](https://github.com/charmbracelet/vhs/issues/787)).

### Screenshots

What a recording cannot show -- an image drawn into a float, a rendered PDF page, anything that
needs a graphics-capable terminal -- goes on the plugin page as a screenshot: `public/shots/<slug>/`
holds the files plus a `shots.json` (an ordered list of `{ file, width, height, caption }`). The
loader reads the manifest and fails the build on a missing file or on anything that is not a plain
image file name; both skins render the list under the demo. Keep them to the editor area and free of personal data, the page is public.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on push, on a 6-hour
schedule, on manual dispatch, and on `repository_dispatch` events of type `plugin-push`.
It clones every registry entry treeless (`--filter=tree:0`, six in parallel) so commit
history is complete without downloading blobs. No token, no API rate limits. Clone failures
are classified: a private or missing repository is skipped with a warning (the site is
simply missing it), anything else -- 5xx, timeout, RPC failure -- is retried once and then
fails the run, and the loader refuses to build an empty site under `CI`, so a degraded
GitHub never replaces a good deployment with a partial one. Queued runs wait for the running
one instead of cancelling it (a cancelled `deploy-pages` leaves the environment red).

To rebuild the site on every plugin push, add this to each plugin repo's CI:

```yaml
- name: Notify wkd
  if: github.ref == 'refs/heads/main'
  run: |
    gh api repos/StefanBartl/wkd/dispatches \
      -f event_type=plugin-push -f 'client_payload[repo]=${{ github.repository }}'
  env:
    GH_TOKEN: ${{ secrets.WKD_DISPATCH_TOKEN }}
```

(`WKD_DISPATCH_TOKEN`: a fine-grained PAT with `contents: write` on this repo only.)

## Roadmap

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, both skins, all plugin pages, activity stream from git | **done** |
| 1 | Category filter, search (Pagefind), colorscheme presets in the TUI skin, light/dark in modern | **done** |
| 2 | `repository_dispatch` hooks in the plugin repos, GitHub Pages live | Pages live; hooks open |
| 3 | Demo pipeline: VHS `.tape` scripts recorded in CI → webm/mp4 + poster on the plugin pages | **pipeline done**; tapes: cascade, emojis, replacer, spotlight, data, diff, markdown, color_my_ascii, hover, insights, fileops, buffer-ctx, recommender, sessions, ui, gopath, runtime-analysis, documentation, pickers, cmdlog |
| 4 | TUI skin: vim motions (`j`/`k`/`gg`/`G`), `:` command line with completion, `?` help | **done** |
| 5 | Vimdoc renderer (`doc/*.txt` → HTML with `\|tag\|` links; `:help` opens it), `/stack` dependency graph | **done** |
