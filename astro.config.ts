import { createHash } from 'node:crypto';
import { defineConfig, fontProviders } from 'astro/config';
import { pagefindIntegration } from './src/integrations/pagefind';
import { BOOT } from './src/lib/boot';

// Deployed under a project sub-path on GitHub Pages for now. Moving to a
// custom domain later means changing `site` and setting `base: '/'` -- nothing
// else in the codebase may assume the path (see src/lib/site.ts).
export default defineConfig({
  site: 'https://stefanbartl.github.io',
  base: '/wkd',
  trailingSlash: 'always',
  compressHTML: true,
  build: { format: 'directory' },
  // Opt-in prefetch (data-astro-prefetch) on the links people actually click
  // through -- cards, table rows, nav. Not on the 38-link TUI sidebar or the
  // 430-row activity list, where a keyboard pass would fetch every page.
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  // No markdown is rendered yet; Shiki's inline styles would break the hashed CSP.
  markdown: { syntaxHighlight: false },
  integrations: [pagefindIntegration()],
  security: {
    // Static output: Astro emits a hashed <meta http-equiv> CSP. GitHub Pages
    // cannot send headers, so this is the only CSP we can ship there.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self'", // Pagefind's search worker
        "media-src 'self'", // demo videos in public/demos/
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        'upgrade-insecure-requests',
      ],
      scriptDirective: {
        // Pagefind runs a WebAssembly search core; the bundle itself is same-origin.
        resources: ["'self'", "'wasm-unsafe-eval'"],
        // Astro only hashes the scripts it bundles; the is:inline bootstrap in
        // Base.astro is hashed here.
        hashes: [`sha256-${createHash('sha256').update(BOOT).digest('base64')}`],
      },
    },
  },
  // Fonts come from pinned npm packages (pnpm lockfile, integrity-checked), not
  // from a CDN at build time: the build is hermetic and a CDN outage cannot
  // fail a scheduled deploy. wght-only files: the wdth axis is not used.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Archivo',
      cssVariable: '--font-display',
      fallbacks: ['Arial Narrow', 'Helvetica Neue', 'sans-serif'],
      options: {
        variants: [
          {
            src: [
              './node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2',
            ],
            weight: '100 900',
            style: 'normal',
            display: 'swap',
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      fallbacks: ['ui-monospace', 'Cascadia Mono', 'monospace'],
      options: {
        variants: [
          {
            src: [
              './node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
            ],
            weight: '100 800',
            style: 'normal',
            display: 'swap',
          },
        ],
      },
    },
  ],
});
