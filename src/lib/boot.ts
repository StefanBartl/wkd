import { THEMES } from './themes';

// The inline bootstrap that runs as the first child of <body>, before any
// page markup is parsed. It is emitted verbatim by src/components/Base.astro
// (set:html) and hashed into the CSP by astro.config.ts, so the string must be
// byte-identical in both places -- a single line, built only from constants.
// No src/lib/site.ts import here: that module reads import.meta.env, which
// does not exist when astro.config.ts evaluates this file in plain Node.
// localStorage keys mirror src/lib/site.ts.
//
// - data-js on <html> lets CSS hide controls that only work with scripting.
// - theme: TUI colorscheme, allow-listed (github.io shares localStorage across
//   every Pages project of the account, so never trust a stored value).
// - mode: modern light/dark override.
const themeTest = THEMES.slice(1)
  .map((t) => `t==="${t}"`)
  .join('||');

export const BOOT =
  'document.documentElement.dataset.js="";' +
  'try{' +
  `var t=localStorage.getItem("wkd:theme");if(${themeTest})document.documentElement.dataset.theme=t;` +
  'var m=localStorage.getItem("wkd:mode");if(m==="light"||m==="dark")document.documentElement.dataset.mode=m' +
  '}catch(e){}';
