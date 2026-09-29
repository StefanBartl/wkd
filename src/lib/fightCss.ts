import { ANIM, FIGHTERS, FRAME } from './fight';

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
  const previewSheetWidth = ANIM.idle.frames * FRAME.w * previewScale;
  return FIGHTERS.map(
    (f) => `.fight-pick[data-fighter="${f.id}"] .fight-pick-sprite {
    background-image: url(${base}fight/${f.spriteBase}/idle.png);
    background-size: ${previewSheetWidth}px ${PREVIEW}px;
    filter: ${f.filter};
  }`,
  ).join('\n');
}
