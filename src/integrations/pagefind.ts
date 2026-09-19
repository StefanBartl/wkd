import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import * as pagefind from 'pagefind';

// Static search index. After `astro build` Pagefind indexes dist/ (only pages
// carrying data-pagefind-body) and writes dist/pagefind/. In dev the same
// bundle is served from dist/ if a build exists, so search can be tried
// without deploying; otherwise the client shows a hint.
const UNUSED_UI = [
  'pagefind-ui.js',
  'pagefind-ui.css',
  'pagefind-modular-ui.js',
  'pagefind-modular-ui.css',
  'pagefind-component-ui.js',
  'pagefind-component-ui.css',
  'pagefind-highlight.js',
];

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.css': 'text/css',
};

export function pagefindIntegration(): AstroIntegration {
  let base = '/';
  let outDir = '';

  return {
    name: 'wkd-pagefind',
    hooks: {
      'astro:config:done': ({ config }) => {
        base = config.base.replace(/\/?$/, '/');
        outDir = fileURLToPath(config.outDir);
      },

      'astro:server:setup': ({ server, logger }) => {
        const prefix = `${base}pagefind/`;
        const bundle = join(outDir, 'pagefind');
        if (!existsSync(bundle)) {
          logger.warn(`no ${bundle} -- run \`pnpm build\` once to try search in dev`);
        }
        server.middlewares.use((req, res, next) => {
          const url = (req.url ?? '').split('?')[0] ?? '';
          if (!url.startsWith(prefix)) return next();
          let rel: string;
          try {
            rel = normalize(decodeURIComponent(url.slice(prefix.length)));
          } catch {
            return next(); // malformed percent-encoding
          }
          if (rel.startsWith('..') || rel.includes('\0')) return next();
          const file = join(bundle, rel);
          readFile(file).then(
            (buf) => {
              res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
              res.setHeader('Cache-Control', 'no-store');
              res.end(buf);
            },
            () => next(),
          );
        });
      },

      'astro:build:done': async ({ dir, logger }) => {
        const site = fileURLToPath(dir);
        const { index, errors } = await pagefind.createIndex({});
        if (!index) throw new Error(`pagefind: ${errors.join('; ')}`);
        const added = await index.addDirectory({ path: site });
        const written = await index.writeFiles({ outputPath: join(site, 'pagefind') });
        await pagefind.close();
        // The site talks to the core API only; the prebuilt UI bundles are ~420 KB
        // of dead weight in every deploy artifact.
        await Promise.all(UNUSED_UI.map((f) => rm(join(written.outputPath, f), { force: true })));
        const problems = [...added.errors, ...written.errors];
        if (problems.length) throw new Error(`pagefind: ${problems.join('; ')}`);
        logger.info(`indexed ${added.page_count} pages -> ${written.outputPath}`);
      },
    },
  };
}
