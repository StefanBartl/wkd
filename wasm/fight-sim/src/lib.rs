//! The fight minigame's simulation step, a second time: this is a line-by-line
//! port of `step()` in `src/lib/fight-engine/sim.ts`. Both work on the same
//! 72-word `i32` state, so JavaScript keeps creating, reading, hashing and
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

const ST_IDLE: i32 = 0;
const ST_RUN: i32 = 1;
const ST_JUMP: i32 = 2;
const ST_FALL: i32 = 3;
const ST_ATTACK1: i32 = 4;
const ST_ATTACK2: i32 = 5;
const ST_TAKE_HIT: i32 = 6;
const ST_DEATH: i32 = 7;

const EV_HIT_P0: i32 = 1;
const EV_HIT_P1: i32 = 2;
const EV_LAND_P0: i32 = 4;
const EV_LAND_P1: i32 = 8;
const EV_KO: i32 = 16;
const EV_TIMEUP: i32 = 32;
const EV_FIGHT: i32 = 64;

const OVER_NONE: i32 = 0;
const OVER_P0: i32 = 1;
const OVER_P1: i32 = 2;
const OVER_DRAW: i32 = 3;

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
const F_ANIM_CFG: usize = 16;
const FIGHTER_SIZE: usize = 32;

const STATE_LEN: usize = GLOBAL_SIZE + 2 * FIGHTER_SIZE;
const P0: usize = GLOBAL_SIZE;
const P1: usize = GLOBAL_SIZE + FIGHTER_SIZE;

const ARENA_W: i32 = 1024;
const GROUND_Y: i32 = 480;
const BOX_W: i32 = 90;
const BOX_H: i32 = 190;
const ATTACK_W: i32 = 100;
const ATTACK_H: i32 = 60;
const ATTACK_Y_OFFSET: i32 = 30;
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

const GROUND_FP: i32 = GROUND_Y * FP;
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

fn is_on_ground(s: &State, b: usize) -> bool {
    s[b + F_Y] + BOX_H_FP >= GROUND_FP
}

fn is_attack(st: i32) -> bool {
    st == ST_ATTACK1 || st == ST_ATTACK2
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
    if is_attack(cur) && s[b + F_ANIM_FRAME] < anim_frames(s, b, cur) - 1 {
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
    let swing_done = is_attack(st) && s[b + F_ANIM_FRAME] >= anim_frames(s, b, st) - 1;
    if !is_attack(st) || swing_done {
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

/// Damage the attacker lands on the defender this frame, 0 for none.
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
    let ax0 = if s[atk + F_FACING] == 1 {
        s[atk + F_X] + BOX_W * FP
    } else {
        s[atk + F_X] - ATTACK_W * FP
    };
    let ay0 = s[atk + F_Y] + ATTACK_Y_OFFSET * FP;
    let dx0 = s[def + F_X];
    let dy0 = s[def + F_Y];
    let overlap = ax0 < dx0 + BOX_W * FP
        && ax0 + ATTACK_W * FP > dx0
        && ay0 < dy0 + BOX_H_FP
        && ay0 + ATTACK_H * FP > dy0;
    if !overlap {
        return 0;
    }
    if st == ST_ATTACK1 {
        ATTACK1_DAMAGE
    } else {
        ATTACK2_DAMAGE
    }
}

fn apply_hit(s: &mut State, atk: usize, def: usize, damage: i32) {
    s[atk + F_DID_HIT] = 1;
    let health = (s[def + F_HEALTH] - damage).max(0);
    s[def + F_HEALTH] = health;
    s[def + F_HIT_UNTIL] = s[G_FRAME] + HIT_STUN_FRAMES;
    enter_state(s, def, if health <= 0 { ST_DEATH } else { ST_TAKE_HIT });
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

    let dmg_to_1 = landed_damage(s, P0, P1);
    let dmg_to_0 = landed_damage(s, P1, P0);
    if dmg_to_1 > 0 {
        apply_hit(s, P0, P1, dmg_to_1);
        events |= EV_HIT_P1;
    }
    if dmg_to_0 > 0 {
        apply_hit(s, P1, P0, dmg_to_0);
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
