// Shared by the server (FightView.astro renders the character-select cards)
// and the client engine (src/scripts/fight.ts). Assets live in public/fight/,
// copied from $REPOS_DIR/FightingGame (a from-scratch tutorial project) --
// only the sprite sheets and the one arena background came from there, the
// game code itself is new, written for this canvas/engine.
export type AnimKey =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'attack1'
  | 'attack2'
  | 'takeHit'
  | 'death';

export interface AnimDef {
  readonly file: string;
  readonly frames: number;
  readonly hold: number;
}

export interface FighterConfig {
  readonly id: string;
  readonly name: string;
  /** public/ path prefix for this fighter's sprite sheets, e.g. '/fight/samurai-mack/'. */
  readonly spriteBase: string;
  /** CSS/canvas filter applied when drawing this fighter -- see the note below. */
  readonly filter: string;
  /**
   * Transparent px below the feet within a 200px-tall frame, pixel-scanned
   * per pack (they differ) -- without this the sprite's bounding box
   * touches the ground but the visible character floats above it.
   */
  readonly footMargin: number;
  /**
   * Which way the raw sprite sheet looks (1 = right, -1 = left). The packs
   * disagree -- measured from where the blade extends in the attack frames
   * -- and drawing mirrors whenever the fighter faces the other way.
   */
  readonly nativeFacing: 1 | -1;
  readonly anim: Readonly<Record<AnimKey, AnimDef>>;
}

// samurai-mack and martial-hero are byte-identical sprite files (confirmed
// via checksum) under different pack names -- "Martial Hero" gets a
// hue-rotate filter applied wherever it's drawn, the only way those two
// picks are visually distinct until real, separate art replaces one of
// them. kenji is a genuinely different pack (own frame counts throughout).
const SAMURAI_ANIM: Readonly<Record<AnimKey, AnimDef>> = {
  idle: { file: 'idle.png', frames: 8, hold: 6 },
  run: { file: 'run.png', frames: 8, hold: 6 },
  jump: { file: 'jump.png', frames: 2, hold: 8 },
  fall: { file: 'fall.png', frames: 2, hold: 8 },
  attack1: { file: 'attack1.png', frames: 6, hold: 5 },
  attack2: { file: 'attack2.png', frames: 6, hold: 5 },
  takeHit: { file: 'take-hit.png', frames: 4, hold: 6 },
  death: { file: 'death.png', frames: 6, hold: 8 },
};

const KENJI_ANIM: Readonly<Record<AnimKey, AnimDef>> = {
  idle: { file: 'idle.png', frames: 4, hold: 8 },
  run: { file: 'run.png', frames: 8, hold: 6 },
  jump: { file: 'jump.png', frames: 2, hold: 8 },
  fall: { file: 'fall.png', frames: 2, hold: 8 },
  attack1: { file: 'attack1.png', frames: 4, hold: 6 },
  attack2: { file: 'attack2.png', frames: 4, hold: 6 },
  takeHit: { file: 'take-hit.png', frames: 3, hold: 7 },
  death: { file: 'death.png', frames: 7, hold: 8 },
};

export const FIGHTERS: readonly FighterConfig[] = [
  {
    id: 'samurai-mack',
    name: 'Samurai Mack',
    spriteBase: 'samurai-mack',
    filter: 'none',
    footMargin: 78,
    nativeFacing: 1,
    anim: SAMURAI_ANIM,
  },
  {
    id: 'martial-hero',
    name: 'Martial Hero',
    spriteBase: 'martial-hero',
    filter: 'hue-rotate(190deg) saturate(1.4)',
    footMargin: 78,
    nativeFacing: 1,
    anim: SAMURAI_ANIM,
  },
  {
    id: 'kenji',
    name: 'Kenji',
    spriteBase: 'kenji',
    filter: 'none',
    footMargin: 72,
    nativeFacing: -1,
    anim: KENJI_ANIM,
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

/** Every animation sheet, every fighter, is a grid of 200x200 frames. */
export const FRAME = { w: 200, h: 200 } as const;

export const CANVAS = { w: 1024, h: 576 } as const;
// Pixel-scanned from public/fight/background.png (a clean column away from
// the fence/campfire): the stone path's top edge -- the actual walkable
// ground -- starts at y=480, not some guessed mid-canvas value. Off by
// ~150px was the other half of the "fighters float" bug alongside the
// per-sprite foot margin in src/scripts/fight.ts.
export const GROUND_Y = 480;
export const MATCH_SECONDS = 60;

export const WINS_KEY = 'wkd:fight-wins';
export const LOSSES_KEY = 'wkd:fight-losses';
export const MUSIC_KEY = 'wkd:fight-music';
