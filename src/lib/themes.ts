// TUI colorschemes; the palettes live in src/styles/themes.css. The first one
// is the default (no data-theme attribute). Kept in its own module with no
// other imports because src/lib/boot.ts (evaluated by astro.config.ts in plain
// Node) derives the bootstrap's allow-list from it.
export const THEMES = ['tokyonight', 'gruvbox', 'catppuccin', 'kanagawa', 'nord'] as const;
export type Theme = (typeof THEMES)[number];
