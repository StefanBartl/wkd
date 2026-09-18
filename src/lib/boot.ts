// The inline bootstrap that runs in <head> before first paint. It is emitted
// verbatim by src/components/Base.astro (set:html) and hashed into the CSP by
// astro.config.ts, so the string must be byte-identical in both places -- keep
// it a single line with no interpolation and no imports (this module is also
// evaluated by astro.config.ts in plain Node, where import.meta.env does not
// exist). localStorage keys mirror src/lib/site.ts.
//
// - data-js on <html> lets CSS hide controls that only work with scripting.
// - theme: TUI colorscheme; mode: modern light/dark override.
export const BOOT =
  'document.documentElement.dataset.js="";try{var t=localStorage.getItem("wkd:theme");if(t&&t!=="tokyonight")document.documentElement.dataset.theme=t;var m=localStorage.getItem("wkd:mode");if(m==="light"||m==="dark")document.documentElement.dataset.mode=m}catch(e){}';
