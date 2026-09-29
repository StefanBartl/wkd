import { FIGHTERS, FRAME } from './fight';

const PREVIEW = 100;

/**
 * CSS for the fighter pick-card sprite previews (background-image crop +
 * per-fighter filter -- see FightView.astro for why this can't be a
 * `style="--x:…"` attribute). A pure function of `base`, not importing
 * site.ts's BASE (which reads import.meta.env, unavailable when
 * astro.config.ts evaluates this file in plain Node): the exact same
 * string -- and therefore the exact same CSP hash -- has to come out of
 * both the config-eval call (to compute the hash) and the render-time call
 * (to emit the <style> tag). Same pattern as src/lib/boot.ts.
 */
export function fightPickCss(base: string): string {
  const previewScale = PREVIEW / FRAME.w;
  return FIGHTERS.map((f) => {
    // Each fighter's own idle frame count -- kenji's sheet has 4, not 8.
    const sheetWidth = f.anim.idle.frames * FRAME.w * previewScale;
    return `.fight-pick[data-fighter="${f.id}"] .fight-pick-sprite {
    background-image: url(${base}fight/${f.spriteBase}/idle.png);
    background-size: ${sheetWidth}px ${PREVIEW}px;
    filter: ${f.filter};
  }`;
  }).join('\n');
}
