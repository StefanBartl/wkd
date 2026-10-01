// Which sprite frame a fighter shows. During the match that is the sim's own
// animation state. The sim stops dead at the result, though -- on the very
// frame of the knockout -- so the last animation is the view's to play, from
// a frame counter of its own: the loser goes down, the winner finishes the
// swing and settles.
import type { AnimDef, AnimKey } from '../fight.ts';
import {
  F_ANIM_FRAME,
  F_STATE,
  type SimState,
  ST_ATTACK1,
  ST_ATTACK2,
  ST_DEATH,
  STATE_ANIM,
} from './sim.ts';

export interface Pose {
  readonly key: AnimKey;
  readonly frame: number;
}

/** `outro`: 60 Hz frames since the match ended, or -1 while it is running. */
export function pose(
  s: SimState,
  base: number,
  anim: Readonly<Record<AnimKey, AnimDef>>,
  outro = -1,
): Pose {
  const state = s[base + F_STATE] as number;
  const key = STATE_ANIM[state] ?? 'idle';
  const frame = s[base + F_ANIM_FRAME] as number;
  if (outro < 0) return { key, frame };

  const advanced = frame + Math.floor(outro / anim[key].hold);
  // Death holds its last frame, as it does in the sim.
  if (state === ST_DEATH) return { key, frame: Math.min(anim[key].frames - 1, advanced) };
  if ((state === ST_ATTACK1 || state === ST_ATTACK2) && advanced < anim[key].frames) {
    return { key, frame: advanced };
  }
  return { key: 'idle', frame: Math.floor(outro / anim.idle.hold) % anim.idle.frames };
}
