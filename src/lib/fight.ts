// Shared by the server (FightView.astro renders the character-select cards)
// and the client engine (src/scripts/fight.ts). Assets live in public/fight/,
// copied from $REPOS_DIR/FightingGame (a from-scratch tutorial project) --
// only the sprite sheets and the one arena background came from there, the
// game code itself is new, written for this canvas/engine.
//
// Both sprite sheets happen to be byte-identical files (confirmed via
// checksum) under different pack names, so "Martial Hero" gets a hue-rotate
// filter applied wherever it's drawn -- the only way the two selectable
// fighters are visually distinct until real, separate art replaces one of
// them.
export interface FighterConfig {
  readonly id: string;
  readonly name: string;
  /** public/ path prefix for this fighter's sprite sheets, e.g. '/fight/samurai-mack/'. */
  readonly spriteBase: string;
  /** CSS/canvas filter applied when drawing this fighter -- see the note above. */
  readonly filter: string;
}

export const FIGHTERS: readonly FighterConfig[] = [
  { id: 'samurai-mack', name: 'Samurai Mack', spriteBase: 'samurai-mack', filter: 'none' },
  {
    id: 'martial-hero',
    name: 'Martial Hero',
    spriteBase: 'martial-hero',
    filter: 'hue-rotate(190deg) saturate(1.4)',
  },
];

export interface LevelConfig {
  readonly id: string;
  readonly label: string;
  readonly filter: string;
}

// "Level zufällig" (Stefan's ask): the asset repo only has one real arena
// background, so variety comes from a canvas filter picked at random per
// match instead of fabricated extra art.
export const LEVELS: readonly LevelConfig[] = [
  { id: 'day', label: 'Day', filter: 'none' },
  {
    id: 'dusk',
    label: 'Dusk',
    filter: 'sepia(0.35) hue-rotate(-20deg) saturate(1.35) brightness(0.92)',
  },
  { id: 'night', label: 'Night', filter: 'brightness(0.45) saturate(0.55) hue-rotate(190deg)' },
];

/** Every animation sheet for both fighters is a grid of 200x200 frames. */
export const FRAME = { w: 200, h: 200 } as const;

export type AnimKey = 'idle' | 'run' | 'jump' | 'fall' | 'attack1' | 'takeHit' | 'death';

export const ANIM: Readonly<Record<AnimKey, { file: string; frames: number; hold: number }>> = {
  idle: { file: 'idle.png', frames: 8, hold: 6 },
  run: { file: 'run.png', frames: 8, hold: 6 },
  jump: { file: 'jump.png', frames: 2, hold: 8 },
  fall: { file: 'fall.png', frames: 2, hold: 8 },
  attack1: { file: 'attack1.png', frames: 6, hold: 5 },
  takeHit: { file: 'take-hit.png', frames: 4, hold: 6 },
  death: { file: 'death.png', frames: 6, hold: 8 },
};

export const CANVAS = { w: 1024, h: 576 } as const;
export const GROUND_Y = 330;
export const GRAVITY = 0.55;
export const MATCH_SECONDS = 60;
