import { defineConfig, fontProviders } from 'astro/config';

// Deployed under a project sub-path on GitHub Pages for now. Moving to a
// custom domain later means changing `site` and setting `base: '/'` -- nothing
// else in the codebase may assume the path (see src/lib/site.ts).
export default defineConfig({
  site: 'https://stefanbartl.github.io',
  base: '/dotnvim',
  trailingSlash: 'always',
  compressHTML: true,
  build: { format: 'directory' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  // No markdown is rendered yet; Shiki's inline styles would break the hashed CSP.
  markdown: { syntaxHighlight: false },
  security: {
    // Static output: Astro emits a hashed <meta http-equiv> CSP. GitHub Pages
    // cannot send headers, so this is the only CSP we can ship there.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "media-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        'upgrade-insecure-requests',
      ],
    },
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Archivo',
      cssVariable: '--font-display',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Arial Narrow', 'Helvetica Neue', 'sans-serif'],
      display: 'swap',
    },
    {
      provider: fontProviders.fontsource(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      weights: ['100 800'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'Cascadia Mono', 'monospace'],
      display: 'swap',
    },
  ],
});
