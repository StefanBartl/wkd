//! The fight minigame's simulation step, a second time: this is a line-by-line
//! port of `step()` in `src/lib/fight-engine/sim.ts`. Both work on the same
//! 104-word `i32` state, so JavaScript keeps creating, reading, hashing and
//! rendering the state and only the step itself runs here -- the state array
//! lives in this module's linear memory and JS holds an `Int32Array` view of
//! it.
//!
//! Deliberately no wasm-bindgen: three exports and a shared buffer are the
//! whole interface. `tests/fight-wasm.test.ts` holds the two implementations
//! to bit-identical state on every frame; change one and it fails until the
//! other follows.
#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

const FP: i32 = 256;

const IN_LEFT: i32 = 1;
const IN_RIGHT: i32 = 2;
const IN_JUMP: i32 = 4;
const IN_ATTACK1: i32 = 8;
const IN_ATTACK2: i32 = 16;
const IN_SPECIAL: i32 = 32;

const ST_IDLE: i32 = 0;
const ST_RUN: i32 = 1;
const ST_JUMP: i32 = 2;
const ST_FALL: i32 = 3;
const ST_ATTACK1: i32 = 4;
const ST_ATTACK2: i32 = 5;
const ST_TAKE_HIT: i32 = 6;
const ST_DEATH: i32 = 7;
const ST_SPECIAL: i32 = 8;

const EV_HIT_P0: i32 = 1;
const EV_HIT_P1: i32 = 2;
const EV_LAND_P0: i32 = 4;
const EV_LAND_P1: i32 = 8;
const EV_KO: i32 = 16;
const EV_TIMEUP: i32 = 32;
const EV_FIGHT: i32 = 64;
const EV_SPECIAL: i32 = 128;

const OVER_NONE: i32 = 0;
const OVER_P0: i32 = 1;
const OVER_P1: i32 = 2;
const OVER_DRAW: i32 = 3;

const SP_NONE: i32 = 0;
const SP_TELEPORT: i32 = 3;
const SP_WAVE: i32 = 4;

const G_FRAME: usize = 0;
const G_OVER: usize = 2;
const GLOBAL_SIZE: usize = 8;

const F_X: usize = 0;
const F_Y: usize = 1;
const F_VX: usize = 2;
const F_VY: usize = 3;
const F_FACING: usize = 4;
const F_HEALTH: usize = 5;
const F_STATE: usize = 6;
const F_ANIM_FRAME: usize = 7;
const F_ANIM_TICK: usize = 8;
const F_COOLDOWN_UNTIL: usize = 9;
const F_HIT_UNTIL: usize = 10;
const F_DID_HIT: usize = 11;
const F_SPEED: usize = 12;
const F_POWER: usize = 15;
const F_ANIM_CFG: usize = 16;
const F_SPECIAL: usize = 34;
const F_SPECIAL_UNTIL: usize = 35;
const F_PROJ_KIND: usize = 36;
const F_PROJ_X: usize = 37;
const F_PROJ_Y: usize = 38;
const F_PROJ_VX: usize = 39;
const F_PROJ_UNTIL: usize = 40;
const FIGHTER_SIZE: usize = 48;

const STATE_LEN: usize = GLOBAL_SIZE + 2 * FIGHTER_SIZE;
const P0: usize = GLOBAL_SIZE;
const P1: usize = GLOBAL_SIZE + FIGHTER_SIZE;

const ARENA_W: i32 = 1024;
const GROUND_Y: i32 = 480;
const BOX_W: i32 = 90;
const BOX_H: i32 = 150;
const AIR_TUCK: i32 = 30;
const ATTACK_W: i32 = 100;
const ATTACK_H: i32 = 60;
const ATTACK1_Y_OFFSET: i32 = 50;
const ATTACK2_Y_OFFSET: i32 = 10;
const EDGE_MARGIN: i32 = 10;

const GRAVITY: i32 = 141; // round(0.55 * FP)
const JUMP_VELOCITY: i32 = -3200; // -12.5 * FP

const INTRO_FRAMES: i32 = 54;
const MATCH_FRAMES: i32 = 60 * 60;
const HIT_STUN_FRAMES: i32 = 21;
const ATTACK1_DAMAGE: i32 = 10;
const ATTACK1_COOLDOWN: i32 = 27;
const ATTACK2_DAMAGE: i32 = 22;
const ATTACK2_COOLDOWN: i32 = 57;

const SPECIAL_RECOVERY: i32 = 36;
const TELEPORT_GAP: i32 = 20;

// Indexed by SP_* (none, bullet, orb, teleport, wave), as in sim.ts.
const SPECIAL_COOLDOWN: [i32; 5] = [0, 150, 270, 180, 210];
const PROJ_W: [i32; 5] = [0, 16, 36, 0, 40];
const PROJ_H: [i32; 5] = [0, 8, 36, 0, 36];
const PROJ_SPEED: [i32; 5] = [0, 14 * FP, 5 * FP, 0, 7 * FP];
const PROJ_DAMAGE: [i32; 5] = [0, 8, 18, 0, 14];
const PROJ_LIFE: [i32; 5] = [0, 90, 240, 0, 150];
const PROJ_Y_OFFSET: [i32; 5] = [0, 55, 40, 0, 0];

const GROUND_FP: i32 = GROUND_Y * FP;
const BOX_W_FP: i32 = BOX_W * FP;
const BOX_H_FP: i32 = BOX_H * FP;
const MIN_X_FP: i32 = EDGE_MARGIN * FP;
const MAX_X_FP: i32 = (ARENA_W - BOX_W - EDGE_MARGIN) * FP;

type State = [i32; STATE_LEN];

static mut STATE: State = [0; STATE_LEN];

/// Where the state lives in linear memory; JS wraps it in an `Int32Array`.
#[no_mangle]
pub extern "C" fn state_ptr() -> *mut i32 {
    core::ptr::addr_of_mut!(STATE) as *mut i32
}

#[no_mangle]
pub extern "C" fn state_len() -> i32 {
    STATE_LEN as i32
}

/// Advance the match by one 60 Hz frame; returns the `EV_*` bitmask.
#[no_mangle]
pub extern "C" fn step(input0: i32, input1: i32) -> i32 {
    // SAFETY: WebAssembly here is single-threaded and nothing else holds a
    // Rust reference to STATE; JS only touches it between calls.
    let s = unsafe { &mut *core::ptr::addr_of_mut!(STATE) };
    step_state(s, input0, input1)
}

/// The special kind is data from JS; anything out of range has no move.
fn kind_index(kind: i32) -> usize {
    if (0..5).contains(&kind) {
        kind as usize
    } else {
        0
    }
}

fn is_on_ground(s: &State, b: usize) -> bool {
    s[b + F_Y] + BOX_H_FP >= GROUND_FP
}

fn hurt_bottom(s: &State, b: usize) -> i32 {
    s[b + F_Y] + BOX_H_FP - if is_on_ground(s, b) { 0 } else { AIR_TUCK * FP }
}

fn is_attack(st: i32) -> bool {
    st == ST_ATTACK1 || st == ST_ATTACK2
}

fn is_busy(st: i32) -> bool {
    is_attack(st) || st == ST_SPECIAL
}

fn anim_frames(s: &State, b: usize, st: i32) -> i32 {
    s[b + F_ANIM_CFG + st as usize * 2]
}

fn anim_hold(s: &State, b: usize, st: i32) -> i32 {
    s[b + F_ANIM_CFG + st as usize * 2 + 1]
}

fn enter_state(s: &mut State, b: usize, st: i32) {
    s[b + F_STATE] = st;
    s[b + F_ANIM_FRAME] = 0;
    s[b + F_ANIM_TICK] = 0;
}

fn set_state(s: &mut State, b: usize, next: i32) {
    let cur = s[b + F_STATE];
    if cur == next || cur == ST_DEATH {
        return;
    }
    if cur == ST_TAKE_HIT && s[G_FRAME] < s[b + F_HIT_UNTIL] {
        return;
    }
    if is_busy(cur) && s[b + F_ANIM_FRAME] < anim_frames(s, b, cur) - 1 {
        return;
    }
    enter_state(s, b, next);
}

fn start_attack(s: &mut State, b: usize, kind: i32) {
    let cur = s[b + F_STATE];
    if cur == ST_DEATH || cur == ST_TAKE_HIT {
        return;
    }
    let frame = s[G_FRAME];
    if frame < s[b + F_COOLDOWN_UNTIL] {
        return;
    }
    enter_state(s, b, kind);
    s[b + F_DID_HIT] = 0;
    s[b + F_COOLDOWN_UNTIL] = frame
        + if kind == ST_ATTACK1 {
            ATTACK1_COOLDOWN
        } else {
            ATTACK2_COOLDOWN
        };
}

/// Returns whether the move started.
fn start_special(s: &mut State, b: usize) -> bool {
    let kind = s[b + F_SPECIAL];
    if kind == SP_NONE {
        return false;
    }
    let cur = s[b + F_STATE];
    if cur == ST_DEATH || cur == ST_TAKE_HIT {
        return false;
    }
    let frame = s[G_FRAME];
    if frame < s[b + F_SPECIAL_UNTIL] {
        return false;
    }
    if frame < s[b + F_COOLDOWN_UNTIL] {
        return false;
    }
    if s[b + F_PROJ_KIND] != SP_NONE {
        return false;
    }
    enter_state(s, b, ST_SPECIAL);
    s[b + F_DID_HIT] = 0;
    s[b + F_SPECIAL_UNTIL] = frame + SPECIAL_COOLDOWN[kind_index(kind)];
    s[b + F_COOLDOWN_UNTIL] = frame + SPECIAL_RECOVERY;
    true
}

fn apply_input(s: &mut State, b: usize, input: i32) {
    if s[b + F_STATE] == ST_DEATH {
        s[b + F_VX] = 0;
        return;
    }
    let speed = s[b + F_SPEED];
    let right = if input & IN_RIGHT != 0 { speed } else { 0 };
    let left = if input & IN_LEFT != 0 { speed } else { 0 };
    let vx = right - left;
    s[b + F_VX] = vx;
    if vx > 0 {
        s[b + F_FACING] = 1;
    } else if vx < 0 {
        s[b + F_FACING] = -1;
    }
    if input & IN_JUMP != 0 && is_on_ground(s, b) {
        s[b + F_VY] = JUMP_VELOCITY;
    }
    if input & IN_SPECIAL != 0 && start_special(s, b) {
        return;
    }
    if input & IN_ATTACK1 != 0 {
        start_attack(s, b, ST_ATTACK1);
    } else if input & IN_ATTACK2 != 0 {
        start_attack(s, b, ST_ATTACK2);
    }
}

/// Returns true when the fighter touched down this frame.
fn physics(s: &mut State, b: usize) -> bool {
    if s[b + F_STATE] == ST_DEATH {
        return false;
    }
    let was_airborne = !is_on_ground(s, b);
    let mut x = s[b + F_X] + s[b + F_VX];
    let mut vy = s[b + F_VY] + GRAVITY;
    let mut y = s[b + F_Y] + vy;
    if y + BOX_H_FP >= GROUND_FP {
        y = GROUND_FP - BOX_H_FP;
        vy = 0;
    }
    x = x.clamp(MIN_X_FP, MAX_X_FP);
    s[b + F_X] = x;
    s[b + F_Y] = y;
    s[b + F_VY] = vy;

    let st = s[b + F_STATE];
    let swing_done = is_busy(st) && s[b + F_ANIM_FRAME] >= anim_frames(s, b, st) - 1;
    if !is_busy(st) || swing_done {
        if y + BOX_H_FP < GROUND_FP {
            set_state(s, b, if vy < 0 { ST_JUMP } else { ST_FALL });
        } else if s[b + F_VX] != 0 {
            set_state(s, b, ST_RUN);
        } else {
            set_state(s, b, ST_IDLE);
        }
    }
    was_airborne && y + BOX_H_FP >= GROUND_FP
}

fn advance_anim(s: &mut State, b: usize) {
    let st = s[b + F_STATE];
    let tick = s[b + F_ANIM_TICK] + 1;
    if tick < anim_hold(s, b, st) {
        s[b + F_ANIM_TICK] = tick;
        return;
    }
    s[b + F_ANIM_TICK] = 0;
    let frame = s[b + F_ANIM_FRAME];
    if frame < anim_frames(s, b, st) - 1 {
        s[b + F_ANIM_FRAME] = frame + 1;
    } else if st != ST_DEATH {
        s[b + F_ANIM_FRAME] = 0;
    }
}

/// Base damage scaled by the attacker's power. Wrapping, like the i32 the
/// TypeScript side stores; the division truncates toward zero in both.
fn scaled(s: &State, atk: usize, base: i32) -> i32 {
    base.wrapping_mul(s[atk + F_POWER]) / 100
}

fn touches(s: &State, def: usize, x0: i32, y0: i32, w: i32, h: i32) -> bool {
    let dx0 = s[def + F_X];
    let dy0 = s[def + F_Y];
    x0 < dx0 + BOX_W_FP && x0 + w > dx0 && y0 < hurt_bottom(s, def) && y0 + h > dy0
}

/// Damage the attacker's swing lands on the defender this frame, 0 for none.
fn landed_damage(s: &State, atk: usize, def: usize) -> i32 {
    let st = s[atk + F_STATE];
    if !is_attack(st) || s[atk + F_DID_HIT] != 0 || s[def + F_STATE] == ST_DEATH {
        return 0;
    }
    let frames = anim_frames(s, atk, st);
    let frame = s[atk + F_ANIM_FRAME];
    // floor(frames * 0.3) .. ceil(frames * 0.8), in integers.
    if frame < frames * 3 / 10 || frame > (frames * 8 + 9) / 10 {
        return 0;
    }
    // From the attacker's middle, so a swing reaches an opponent standing inside it.
    let ax0 = if s[atk + F_FACING] == 1 {
        s[atk + F_X] + BOX_W_FP / 2
    } else {
        s[atk + F_X] - ATTACK_W * FP
    };
    let light = st == ST_ATTACK1;
    let offset = if light {
        ATTACK1_Y_OFFSET
    } else {
        ATTACK2_Y_OFFSET
    };
    let ay0 = s[atk + F_Y] + offset * FP;
    if !touches(
        s,
        def,
        ax0,
        ay0,
        ATTACK_W * FP + BOX_W_FP / 2,
        ATTACK_H * FP,
    ) {
        return 0;
    }
    scaled(
        s,
        atk,
        if light {
            ATTACK1_DAMAGE
        } else {
            ATTACK2_DAMAGE
        },
    )
}

/// Damage the attacker's projectile lands on the defender this frame.
fn projectile_damage(s: &State, atk: usize, def: usize) -> i32 {
    let kind = s[atk + F_PROJ_KIND];
    if kind == SP_NONE || s[def + F_STATE] == ST_DEATH {
        return 0;
    }
    let k = kind_index(kind);
    if touches(
        s,
        def,
        s[atk + F_PROJ_X],
        s[atk + F_PROJ_Y],
        PROJ_W[k] * FP,
        PROJ_H[k] * FP,
    ) {
        scaled(s, atk, PROJ_DAMAGE[k])
    } else {
        0
    }
}

fn hurt(s: &mut State, def: usize, damage: i32) {
    let health = (s[def + F_HEALTH] - damage).max(0);
    s[def + F_HEALTH] = health;
    s[def + F_HIT_UNTIL] = s[G_FRAME] + HIT_STUN_FRAMES;
    enter_state(s, def, if health <= 0 { ST_DEATH } else { ST_TAKE_HIT });
}

fn move_projectile(s: &mut State, b: usize) {
    let kind = s[b + F_PROJ_KIND];
    if kind == SP_NONE {
        return;
    }
    let x = s[b + F_PROJ_X] + s[b + F_PROJ_VX];
    s[b + F_PROJ_X] = x;
    let gone = s[G_FRAME] >= s[b + F_PROJ_UNTIL]
        || x + PROJ_W[kind_index(kind)] * FP < 0
        || x > ARENA_W * FP;
    if gone {
        s[b + F_PROJ_KIND] = SP_NONE;
    }
}

/// Returns whether the special move went off this frame.
fn fire_special(s: &mut State, b: usize, opp: usize) -> bool {
    if s[b + F_STATE] != ST_SPECIAL || s[b + F_DID_HIT] != 0 {
        return false;
    }
    let half = anim_frames(s, b, ST_SPECIAL) >> 1;
    if s[b + F_ANIM_FRAME] < half {
        return false;
    }
    s[b + F_DID_HIT] = 1;
    let kind = s[b + F_SPECIAL];
    let x = s[b + F_X];
    if kind == SP_TELEPORT {
        let ox = s[opp + F_X];
        let behind = if x <= ox {
            ox + (BOX_W + TELEPORT_GAP) * FP
        } else {
            ox - (BOX_W + TELEPORT_GAP) * FP
        };
        let target = behind.clamp(MIN_X_FP, MAX_X_FP);
        s[b + F_X] = target;
        s[b + F_FACING] = if target > ox { -1 } else { 1 };
        return true;
    }
    let k = kind_index(kind);
    let facing = s[b + F_FACING];
    s[b + F_PROJ_KIND] = kind;
    s[b + F_PROJ_X] = if facing == 1 {
        x + BOX_W_FP
    } else {
        x - PROJ_W[k] * FP
    };
    s[b + F_PROJ_Y] = if kind == SP_WAVE {
        GROUND_FP - PROJ_H[k] * FP
    } else {
        s[b + F_Y] + PROJ_Y_OFFSET[k] * FP
    };
    s[b + F_PROJ_VX] = facing * PROJ_SPEED[k];
    s[b + F_PROJ_UNTIL] = s[G_FRAME] + PROJ_LIFE[k];
    true
}

fn step_state(s: &mut State, input0: i32, input1: i32) -> i32 {
    if s[G_OVER] != OVER_NONE {
        return 0;
    }
    let frame = s[G_FRAME];

    if frame < INTRO_FRAMES {
        advance_anim(s, P0);
        advance_anim(s, P1);
        s[G_FRAME] = frame + 1;
        return if frame + 1 == INTRO_FRAMES {
            EV_FIGHT
        } else {
            0
        };
    }

    let mut events = 0;
    apply_input(s, P0, input0);
    apply_input(s, P1, input1);
    if physics(s, P0) {
        events |= EV_LAND_P0;
    }
    if physics(s, P1) {
        events |= EV_LAND_P1;
    }
    advance_anim(s, P0);
    advance_anim(s, P1);
    move_projectile(s, P0);
    move_projectile(s, P1);
    if fire_special(s, P0, P1) {
        events |= EV_SPECIAL;
    }
    if fire_special(s, P1, P0) {
        events |= EV_SPECIAL;
    }

    let swing_to_1 = landed_damage(s, P0, P1);
    let swing_to_0 = landed_damage(s, P1, P0);
    let shot_to_1 = projectile_damage(s, P0, P1);
    let shot_to_0 = projectile_damage(s, P1, P0);
    if swing_to_1 > 0 {
        s[P0 + F_DID_HIT] = 1;
    }
    if swing_to_0 > 0 {
        s[P1 + F_DID_HIT] = 1;
    }
    if shot_to_1 > 0 {
        s[P0 + F_PROJ_KIND] = SP_NONE;
    }
    if shot_to_0 > 0 {
        s[P1 + F_PROJ_KIND] = SP_NONE;
    }
    if swing_to_1 + shot_to_1 > 0 {
        hurt(s, P1, swing_to_1 + shot_to_1);
        events |= EV_HIT_P1;
    }
    if swing_to_0 + shot_to_0 > 0 {
        hurt(s, P0, swing_to_0 + shot_to_0);
        events |= EV_HIT_P0;
    }

    s[G_FRAME] = frame + 1;

    let dead0 = s[P0 + F_STATE] == ST_DEATH;
    let dead1 = s[P1 + F_STATE] == ST_DEATH;
    let time_up = frame + 1 >= INTRO_FRAMES + MATCH_FRAMES;
    if dead0 || dead1 || time_up {
        let h0 = s[P0 + F_HEALTH];
        let h1 = s[P1 + F_HEALTH];
        s[G_OVER] = if dead0 != dead1 {
            if dead1 {
                OVER_P0
            } else {
                OVER_P1
            }
        } else if h0 != h1 {
            if h0 > h1 {
                OVER_P0
            } else {
                OVER_P1
            }
        } else {
            OVER_DRAW
        };
        events |= if dead0 || dead1 { EV_KO } else { EV_TIMEUP };
    }
    events
}
