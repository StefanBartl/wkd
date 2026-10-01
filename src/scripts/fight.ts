// T7: a small local-vs-AI fighting minigame. New engine written for this
// canvas -- only the sprite sheets and the arena background are reused from
// $REPOS_DIR/FightingGame (a from-scratch tutorial project), not its code.
// Lives entirely behind the `data-fight` root in FightView.astro; a no-op if
// that root isn't on the page (it always is on the homepage, but this file
// is bundled for every page via client.ts).
//
// This file is the shell around the match: DOM, sprites, audio, HUD and
// input collection. The rules themselves -- physics, hits, clock, outcome
// -- are the deterministic core in src/lib/fight-engine/sim.ts.
import {
  type AnimKey,
  CANVAS,
  FIGHTERS,
  type FighterConfig,
  GROUND_Y,
  LEVELS,
  type LevelConfig,
  LOSSES_KEY,
  MUSIC_KEY,
  WINS_KEY,
} from '../lib/fight';
import { music, playSfx } from '../lib/fight-engine/audio';
import { MAX_FRAME_MS, StepClock } from '../lib/fight-engine/clock';
import { aiDriver, type Driver, type MatchSetup } from '../lib/fight-engine/driver';
import { connectedPads, pollGamepads } from '../lib/fight-engine/gamepad';
import type { Particles } from '../lib/fight-engine/particles';
import {
  BOX_H,
  BOX_W,
  createState,
  EV_HIT_P0,
  EV_HIT_P1,
  EV_LAND_P0,
  EV_LAND_P1,
  F_ANIM_FRAME,
  F_FACING,
  F_HEALTH,
  F_STATE,
  F_X,
  F_Y,
  FP,
  fighterBase,
  G_FRAME,
  IN_ATTACK1,
  IN_ATTACK2,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  INTRO_FRAMES,
  MOVE_SPEED,
  OVER_NONE,
  OVER_P0,
  OVER_P1,
  SIM_HZ,
  type SimState,
  STATE_ANIM,
  secondsLeft,
  step,
} from '../lib/fight-engine/sim';
import { BASE } from '../lib/site';

// Same guard as search.ts's own isEditable: the search box and category
// filter are always in the DOM regardless of which view is active, so a
// running match's window-level keydown listener has to yield to them.
const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function readCount(key: string): number {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(key)) || 0));
  } catch {
    return 0;
  }
}
function writeCount(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* private mode etc. */
  }
}
function readMusicPref(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== 'off';
  } catch {
    return true;
  }
}
function writeMusicPref(on: boolean): void {
  try {
    localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode etc. */
  }
}

const root = document.querySelector<HTMLElement>('[data-fight]');
if (root) setUp(root);

function setUp(root: HTMLElement): void {
  const selectPanel = root.querySelector<HTMLElement>('[data-fight-select]');
  const arena = root.querySelector<HTMLElement>('[data-fight-arena]');
  const canvas = root.querySelector<HTMLCanvasElement>('[data-fight-canvas]');
  const ctx = canvas?.getContext('2d');
  const timerEl = root.querySelector<HTMLElement>('[data-fight-timer]');
  const playerBar = root.querySelector<HTMLElement>('[data-fight-health="player"]');
  const enemyBar = root.querySelector<HTMLElement>('[data-fight-health="enemy"]');
  const recordEl = root.querySelector<HTMLElement>('[data-fight-record]');
  const introEl = root.querySelector<HTMLElement>('[data-fight-intro]');
  const resultBox = root.querySelector<HTMLElement>('[data-fight-result]');
  const resultText = root.querySelector<HTMLElement>('[data-fight-result-text]');
  const againBtn = root.querySelector<HTMLButtonElement>('[data-fight-again]');
  const musicBtn = root.querySelector<HTMLButtonElement>('[data-fight-music]');
  const fullscreenBtn = root.querySelector<HTMLButtonElement>('[data-fight-fullscreen]');
  if (
    !selectPanel ||
    !arena ||
    !canvas ||
    !ctx ||
    !timerEl ||
    !playerBar ||
    !enemyBar ||
    !recordEl ||
    !introEl ||
    !resultBox ||
    !resultText
  ) {
    return;
  }

  // The "Sim core: Rust / WebAssembly" legend belongs to a match, not to the
  // page: only an AI match actually stepped by the module shows it (a match
  // against a friend or behind ?net=loopback always runs the TypeScript step).
  const coreHint = root.querySelector<HTMLElement>('[data-fight-core]');
  let match: Match | null = null;
  let picked: string | null = null;
  let musicOn = readMusicPref();

  const hud: Hud = {
    timerEl,
    playerBar,
    enemyBar,
    recordEl,
    introEl,
    resultBox,
    resultText,
    netEl: root.querySelector<HTMLElement>('[data-fight-net]'),
  };
  updateRecord(recordEl);

  // Matches can be started by the other side (an online `start` message), at
  // any time -- also while the visitor is on another tab or the page is hidden.
  const fightShown = (): boolean =>
    !document.hidden &&
    (document.getElementById('view-fight') as HTMLInputElement | null)?.checked === true;

  const launch = (setup: MatchSetup): void => {
    selectPanel.hidden = true;
    arena.hidden = false;
    // Which health bar gets the "you" tag (see .fight-you in modern.css).
    arena.dataset.you = String(setup.local);
    if (coreHint) coreHint.hidden = !setup.wasm;
    match?.stop();
    match = new Match(ctx, hud, setup, musicOn);
    // Not visible: set up, but wait for resume() instead of playing music
    // and running a match nobody is looking at (or controlling).
    match.start(fightShown());
  };

  // The AI game is the default owner of the fighter cards and the rematch
  // button; an online session takes them over while it lasts.
  const versusAi: OnlineHandlers = {
    pick(id: string): void {
      picked = id;
      launch(aiSetup(id));
    },
    rematch(): void {
      if (picked) launch(aiSetup(picked));
    },
  };
  let handlers: OnlineHandlers = versusAi;

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-fighter]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fighter;
      if (id) handlers.pick(id);
    });
  }

  againBtn?.addEventListener('click', () => handlers.rematch());
  // Only while an online session is on: the way out of it once the select
  // panel (with its Disconnect button) is hidden behind the arena.
  const leaveBtn = root.querySelector<HTMLButtonElement>('[data-fight-leave]');
  leaveBtn?.addEventListener('click', () => handlers.leave?.());

  const online = root.querySelector<HTMLElement>('[data-fight-online]');
  if (online && typeof RTCPeerConnection !== 'undefined' && 'CompressionStream' in window) {
    const api: OnlineApi = {
      root,
      launch,
      showSelect() {
        match?.stop();
        match = null;
        arena.hidden = true;
        selectPanel.hidden = false;
      },
      takeOver(next) {
        handlers = next ?? versusAi;
        if (leaveBtn) leaveBtn.hidden = !handlers.leave;
      },
    };
    online.hidden = false;
    for (const mode of ['invite', 'join'] as const) {
      online.querySelector(`[data-fight-${mode}]`)?.addEventListener('click', () => {
        // WebRTC, rollback and the invitation flow: fetched on first use.
        import('./fight-online')
          .then((m) => m.begin(mode, api))
          .catch(() => {
            const status = online.querySelector('[data-fight-online-status]');
            // A page left open across a deploy points at chunks that are gone.
            if (status)
              status.textContent = 'Could not load online play. Reload the page and retry.';
          });
      });
    }
  }

  musicBtn?.addEventListener('click', () => {
    musicOn = !musicOn;
    writeMusicPref(musicOn);
    musicBtn.setAttribute('aria-pressed', String(musicOn));
    musicBtn.textContent = musicOn ? 'Music: on' : 'Music: off';
    match?.setMusic(musicOn);
  });
  if (musicBtn) {
    musicBtn.setAttribute('aria-pressed', String(musicOn));
    musicBtn.textContent = musicOn ? 'Music: on' : 'Music: off';
  }

  fullscreenBtn?.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void arena.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    if (!fullscreenBtn) return;
    const isFull = document.fullscreenElement === arena;
    fullscreenBtn.textContent = isFull ? 'Exit fullscreen' : 'Fullscreen';
  });

  // Touch/on-screen controls: pointerdown/up so a held direction keeps
  // moving the same way a held arrow key does; pointercancel/leave release
  // it too, so a finger sliding off the button (or a cancelled gesture)
  // can't leave movement stuck on, same concern as the keyup fix below.
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-fight-action]')) {
    const action = btn.dataset.fightAction as Action | undefined;
    if (!action) continue;
    const press = (down: boolean) => (e: Event) => {
      e.preventDefault();
      match?.setAction(action, down);
    };
    btn.addEventListener('pointerdown', press(true));
    btn.addEventListener('pointerup', press(false));
    btn.addEventListener('pointercancel', press(false));
    btn.addEventListener('pointerleave', press(false));
  }

  // Leaving the Fight tab (a real click, or Escape -- views.ts dispatches a
  // 'change' event for that too, not just the .checked assignment) stops
  // the loop -- a fighting game has no business running frames, taking
  // input or ticking its clock while the visitor is looking at something
  // else. setAction()'s own `!this.running` guard is the backstop for the
  // gap between pause() (here) and stop() (only on an actual fighter
  // re-pick) still leaving the window keydown/keyup listeners attached.
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="view"]')) {
    radio.addEventListener('change', () => {
      if (radio.id !== 'view-fight') match?.pause();
      else match?.resume();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) match?.pause();
    else if (fightShown()) match?.resume();
  });

  requestWasmCore();
  requestLagDemo();

  // The controller legend only appears once a controller has announced
  // itself (browsers hold that back until its first button press).
  const padHint = root.querySelector<HTMLElement>('[data-fight-gamepad]');
  if (padHint) {
    const sync = (): void => {
      padHint.hidden = !connectedPads().some((p) => p?.mapping === 'standard');
    };
    window.addEventListener('gamepadconnected', sync);
    window.addEventListener('gamepaddisconnected', sync);
  }

  // Small reward for noticing the tab. mouseenter (not mouseover) so this
  // fires once per hover, not on every sub-pixel pointer move inside the
  // label.
  document
    .querySelector<HTMLLabelElement>('label[for="view-fight"]')
    ?.addEventListener('mouseenter', () => playSfx('blip'));
}

function updateRecord(el: HTMLElement): void {
  el.textContent = `${readCount(WINS_KEY)}W ${readCount(LOSSES_KEY)}L`;
}

interface Hud {
  timerEl: HTMLElement;
  playerBar: HTMLElement;
  enemyBar: HTMLElement;
  recordEl: HTMLElement;
  introEl: HTMLElement;
  resultBox: HTMLElement;
  resultText: HTMLElement;
  netEl: HTMLElement | null;
}

/** What fight-online.ts gets to drive the page with. */
export interface OnlineApi {
  readonly root: HTMLElement;
  launch(setup: MatchSetup): void;
  /** Stop whatever is running and go back to the fighter cards. */
  showSelect(): void;
  /** Route fighter picks and the rematch button here; null hands them back to the AI game. */
  takeOver(handlers: OnlineHandlers | null): void;
}

export interface OnlineHandlers {
  pick(id: string): void;
  rematch(): void;
  /** Present while a session can be left from the arena; shows the Leave button. */
  leave?(): void;
}

type Action = 'left' | 'right' | 'jump' | 'attack1' | 'attack2';

const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'jump',
  ' ': 'attack1',
  x: 'attack2',
};

const ACTION_BITS: Readonly<Record<Action, number>> = {
  left: IN_LEFT,
  right: IN_RIGHT,
  jump: IN_JUMP,
  attack1: IN_ATTACK1,
  attack2: IN_ATTACK2,
};

const imageCache = new Map<string, HTMLImageElement>();
function loadImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

// ---- input ------------------------------------------------------------
// The sim samples input once per 60 Hz step, level-triggered. A key tapped
// and released between two steps would be invisible to plain "is it held
// right now" sampling, so every press also sets a latch that survives until
// the next step has consumed it.
class InputLatch {
  private held = 0;
  private pressed = 0;

  set(bit: number, down: boolean): void {
    if (down) {
      this.held |= bit;
      this.pressed |= bit;
    } else {
      this.held &= ~bit;
    }
  }

  /** Everything down now or tapped since the last consume(); the taps stay latched. */
  peek(): number {
    return this.held | this.pressed;
  }

  consume(): number {
    const bits = this.held | this.pressed;
    this.pressed = 0;
    return bits;
  }

  clear(): void {
    this.held = 0;
    this.pressed = 0;
  }
}

// ---- fighter sprite ---------------------------------------------------
// The sprite is drawn larger than the sim's hurtbox and centered over it
// (raw frames have a lot of transparent margin).
const DRAW_SCALE = 1.7;

class FighterView {
  private readonly images: Record<AnimKey, HTMLImageElement>;
  private readonly cfg: FighterConfig;

  constructor(cfg: FighterConfig) {
    this.cfg = cfg;
    const base = `${BASE}fight/${cfg.spriteBase}/`;
    this.images = {
      idle: loadImage(base + cfg.anim.idle.file),
      run: loadImage(base + cfg.anim.run.file),
      jump: loadImage(base + cfg.anim.jump.file),
      fall: loadImage(base + cfg.anim.fall.file),
      attack1: loadImage(base + cfg.anim.attack1.file),
      attack2: loadImage(base + cfg.anim.attack2.file),
      takeHit: loadImage(base + cfg.anim.takeHit.file),
      death: loadImage(base + cfg.anim.death.file),
    };
  }

  draw(ctx: CanvasRenderingContext2D, s: SimState, b: number): void {
    const key = STATE_ANIM[s[b + F_STATE] as number] ?? 'idle';
    const img = this.images[key];
    if (!img.complete || img.naturalWidth === 0) return;
    const fw = img.naturalWidth / this.cfg.anim[key].frames;
    const fh = img.naturalHeight;
    const drawW = fw * DRAW_SCALE;
    const drawH = fh * DRAW_SCALE;
    const x = (s[b + F_X] as number) / FP;
    const y = (s[b + F_Y] as number) / FP;
    const cx = x + BOX_W / 2;
    // footMargin pushes the drawn sprite down so the actual feet -- not
    // the bottom of its transparent bounding box -- land on the ground.
    const drawY = y + BOX_H - drawH + this.cfg.footMargin * DRAW_SCALE;
    const sx = (s[b + F_ANIM_FRAME] as number) * fw;
    ctx.save();
    // Skipping the assignment for the (usual) unfiltered case avoids
    // exercising canvas's filter code path -- known slow, especially on
    // WebKit -- on every frame of the match for a value that never
    // actually changes once the fighter is created.
    if (this.cfg.filter !== 'none') ctx.filter = this.cfg.filter;
    if (s[b + F_FACING] !== this.cfg.nativeFacing) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, 0, fw, fh, -drawW / 2, drawY, drawW, drawH);
    } else {
      ctx.drawImage(img, sx, 0, fw, fh, cx - drawW / 2, drawY, drawW, drawH);
    }
    ctx.restore();
  }
}

// ---- match ------------------------------------------------------------
// After a match against a peer: keep re-sending the last inputs for at most
// this long, so the other side can still confirm the result (see flush()).
const LINGER_MS = 3000;
const LINGER_TICK_MS = 100;
// The handwritten opponent walks a little slower than the player.
const AI_SPEED = Math.round(MOVE_SPEED * 0.85);

// `?sim=wasm` swaps the TypeScript step() for its Rust/WebAssembly twin
// (wasm/fight-sim). Same rules, bit for bit -- tests/fight-wasm.test.ts
// holds them to that -- so this is a switch for comparing the two, not a
// feature; the TypeScript core stays the default.
type WasmCore = Pick<typeof import('../lib/fight-engine/wasm-loader'), 'instantiateSim'> & {
  module: WebAssembly.Module;
};
let wasmCore: WasmCore | null = null;
function requestWasmCore(): void {
  if (new URLSearchParams(location.search).get('sim') !== 'wasm') return;
  import('../lib/fight-engine/wasm-loader')
    .then(async (m) => {
      wasmCore = { instantiateSim: m.instantiateSim, module: await m.loadSimModule() };
    })
    .catch(() => {
      // The TypeScript core runs instead.
    });
}

// `?net=loopback` plays the AI through rollback netcode over a simulated
// network (`lag` one-way ms, `jitter` ms, `loss` percent), to see and feel
// what rollback does without a second machine. A debugging aid, like
// ?sim=wasm.
let lagDemo: ((initial: SimState) => Driver) | null = null;
function requestLagDemo(): void {
  const query = new URLSearchParams(location.search);
  if (query.get('net') !== 'loopback') return;
  const frames = (name: string, fallback: number): number => {
    const ms = Number(query.get(name) ?? fallback);
    return Number.isFinite(ms) ? Math.max(0, Math.min(30, Math.round((ms * SIM_HZ) / 1000))) : 0;
  };
  const net = {
    delay: frames('lag', 100),
    jitter: frames('jitter', 0),
    loss: Math.max(0, Math.min(0.5, Number(query.get('loss') ?? 0) / 100 || 0)),
  };
  import('../lib/fight-engine/net-driver')
    .then((m) => {
      lagDemo = (initial) => m.laggedAiDriver(initial, net);
    })
    .catch(() => {
      // The plain AI game runs instead.
    });
}

/** A match against the AI: the visitor's pick on the left, a random other fighter and arena. */
function aiSetup(playerId: string): MatchSetup {
  const chosen = FIGHTERS.find((f) => f.id === playerId) ?? FIGHTERS[0];
  // A random pick among the rest, not FIGHTERS.find()'s first-in-order
  // match: with 2 fighters that's the same one either way, but with 3+
  // it keeps the matchup varied instead of always facing the same rival.
  const rest = FIGHTERS.filter((f) => f.id !== chosen?.id);
  const other = rest[Math.floor(Math.random() * rest.length)] ?? FIGHTERS[1];
  const level = LEVELS[Math.floor(Math.random() * LEVELS.length)];
  if (!chosen || !other || !level) throw new Error('fight: no fighters configured');
  const initial = createState(
    { anim: chosen.anim },
    { anim: other.anim, speed: AI_SPEED },
    Math.floor(Math.random() * 0x1_0000_0000),
  );
  let driver: Driver | null = null;
  let wasm = false;
  if (lagDemo) {
    driver = lagDemo(initial);
  } else if (wasmCore) {
    try {
      const sim = wasmCore.instantiateSim(wasmCore.module, initial);
      driver = aiDriver(sim.state, sim.step);
      wasm = true;
    } catch {
      // A module built for another state layout: the TypeScript core runs instead.
    }
  }
  driver ??= aiDriver(initial, (input0, input1) => step(initial, input0, input1));
  return { driver, fighters: [chosen, other], local: 0, level, wasm };
}

// WebGPU hit sparks and landing dust: a separate chunk, fetched on the
// first match instead of with every page view, and simply absent where
// WebGPU is (see particles.ts) or where the visitor asked for less motion.
let particles: Particles | null = null;
let particlesRequested = false;
function requestParticles(): void {
  if (particlesRequested) return;
  particlesRequested = true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  import('../lib/fight-engine/particles')
    .then((m) => m.createParticles(CANVAS.w, CANVAS.h, GROUND_Y))
    .then((fx) => {
      particles = fx;
    })
    .catch(() => {
      // No particles, the match is unaffected.
    });
}

class Match {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly driver: Driver;
  private readonly local: 0 | 1;
  private readonly views: readonly [FighterView, FighterView];
  private readonly input = new InputLatch();
  private bg = loadImage(`${BASE}fight/background.png`);
  private readonly level: LevelConfig;
  private ticks = 0;
  private lastFrameAt = 0;
  private readonly clock = new StepClock();
  private raf = 0;
  private linger: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private over = false;
  private musicWanted: boolean;
  // Written health/timer values, so the HUD only touches the DOM on the
  // ~1-2/sec ticks where they actually changed instead of every one of a
  // 60fps match's ~3600 frames.
  private lastPlayerHealth = -1;
  private lastEnemyHealth = -1;
  private lastRemaining = -1;
  private onKeyDown = (e: KeyboardEvent): void => this.handleKey(e, true);
  private onKeyUp = (e: KeyboardEvent): void => this.handleKey(e, false);

  constructor(ctx: CanvasRenderingContext2D, hud: Hud, setup: MatchSetup, musicWanted: boolean) {
    this.ctx = ctx;
    this.hud = hud;
    this.musicWanted = musicWanted;
    this.driver = setup.driver;
    this.local = setup.local;
    this.level = setup.level;
    this.views = [new FighterView(setup.fighters[0]), new FighterView(setup.fighters[1])];
    this.hud.resultBox.hidden = true;
    if (this.hud.netEl) this.hud.netEl.hidden = this.driver.status() === null;
  }

  /** `active` false: wait for resume() -- nobody is looking at the Fight tab right now. */
  start(active = true): void {
    this.lastFrameAt = performance.now();
    this.clock.reset();
    this.over = false;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.hud.introEl.classList.remove('fight-intro-play');
    void this.hud.introEl.offsetWidth; // restart the CSS animation
    this.hud.introEl.classList.add('fight-intro-play');
    requestParticles();
    // Module state outlives matches: the last blow of the previous one froze
    // its sparks in the buffer when the loop stopped.
    particles?.clear();
    if (!active) return;
    this.running = true;
    playSfx('stinger');
    if (this.musicWanted) music.start();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    music.stop();
    // setAction() ignores keyup while paused too, so a movement key
    // released during the pause would otherwise never clear -- same fix
    // also covers losing a keyup entirely, e.g. the window itself loses
    // focus while a key is held, which never reaches here as any event.
    this.input.clear();
  }

  resume(): void {
    if (this.over || this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.clock.reset();
    if (this.musicWanted) music.start();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.pause();
    clearInterval(this.linger);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  setMusic(on: boolean): void {
    this.musicWanted = on;
    if (on && this.running && !this.over) music.start();
    else music.stop();
  }

  setAction(action: Action, down: boolean): void {
    // `this.running` (not just `this.over`) so a paused-but-not-stopped
    // match -- left via a real view-tab change, not yet Escape, see
    // views.ts -- can't keep reacting to touch buttons/keys anywhere on
    // the page. Input during the "FIGHT!" intro is latched like any other:
    // the sim ignores it until the intro ends; sampleInput() keeps a tap
    // latched until then, so a quick tap early still counts on the first live
    // frame, like a button that is still held.
    if (this.over || !this.running) return;
    this.input.set(ACTION_BITS[action], down);
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    if (isEditable(e.target)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const action = KEY_ACTIONS[key];
    if (!action) return;
    e.preventDefault();
    this.setAction(action, down);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = now - this.lastFrameAt;
    this.lastFrameAt = now;

    // Controllers have no events for button state, only polling; once per
    // rendered frame is as fresh as the browser's own snapshot gets.
    const pad = pollGamepads();
    let events = 0;
    for (let steps = this.clock.frame(dt); steps > 0; steps--) {
      events |= this.driver.tick(this.sampleInput() | pad);
    }

    if (events & (EV_HIT_P0 | EV_HIT_P1)) playSfx('hit');
    if (events && particles) this.emitParticles(events, particles);
    this.syncHud();
    // Not on the KO/time-up event: with rollback that is only a prediction
    // until the driver has the frame confirmed by both peers.
    if (this.driver.desynced) this.finish(true);
    else if (this.driver.outcome !== OVER_NONE) this.finish(false);
    this.render(Math.min(dt, MAX_FRAME_MS) / 1000);
    if (this.running) this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * The local input for one step. A latched tap is only spent where the step
   * can use it: not during the intro (the sim ignores input there), and not
   * on a tick where rollback is waiting for the peer and will not record it.
   */
  private sampleInput(): number {
    const live = (this.driver.state[G_FRAME] as number) >= INTRO_FRAMES;
    return live && this.driver.wantsInput ? this.input.consume() : this.input.peek();
  }

  private emitParticles(events: number, fx: Particles): void {
    const s = this.driver.state;
    for (const index of [0, 1] as const) {
      const me = fighterBase(index);
      const cx = (s[me + F_X] as number) / FP + BOX_W / 2;
      if (events & (index === 0 ? EV_HIT_P0 : EV_HIT_P1)) {
        // Sparks fly on along the blow, i.e. the way the attacker faces.
        const attacker = fighterBase(index === 0 ? 1 : 0);
        fx.sparks(cx, (s[me + F_Y] as number) / FP + 70, s[attacker + F_FACING] as number);
      }
      if (events & (index === 0 ? EV_LAND_P0 : EV_LAND_P1)) fx.dust(cx, GROUND_Y);
    }
  }

  private syncHud(): void {
    const state = this.driver.state;
    const playerHealth = state[fighterBase(0) + F_HEALTH] as number;
    const enemyHealth = state[fighterBase(1) + F_HEALTH] as number;
    if (playerHealth !== this.lastPlayerHealth) {
      this.lastPlayerHealth = playerHealth;
      this.hud.playerBar.style.width = `${playerHealth}%`;
    }
    if (enemyHealth !== this.lastEnemyHealth) {
      this.lastEnemyHealth = enemyHealth;
      this.hud.enemyBar.style.width = `${enemyHealth}%`;
    }
    const remaining = secondsLeft(state);
    if (remaining !== this.lastRemaining) {
      this.lastRemaining = remaining;
      this.hud.timerEl.textContent = String(remaining);
    }
    if (this.hud.netEl && this.ticks++ % 30 === 0) {
      const status = this.driver.status();
      if (status !== null) this.hud.netEl.textContent = status;
    }
  }

  /** `voided`: the peers' states diverged, so whatever the result says, it does not count. */
  private finish(voided: boolean): void {
    this.over = true;
    this.pause();
    if (voided) {
      this.hud.resultText.textContent =
        'The two games went out of sync. This match does not count.';
    } else {
      const outcome = this.driver.outcome;
      const won = outcome === (this.local === 0 ? OVER_P0 : OVER_P1);
      const lost = outcome === (this.local === 0 ? OVER_P1 : OVER_P0);
      this.hud.resultText.textContent = won ? 'You win.' : lost ? 'You lose.' : 'Draw.';
      if (won) writeCount(WINS_KEY, readCount(WINS_KEY) + 1);
      else if (lost) writeCount(LOSSES_KEY, readCount(LOSSES_KEY) + 1);
      updateRecord(this.hud.recordEl);
      this.startLinger();
    }
    this.hud.resultBox.hidden = false;
  }

  /**
   * The loop is stopped, and with it the packets. The peer may not have
   * received the last inputs yet (the channel is unreliable), and without
   * them it can never confirm the final frames; so keep re-sending for a
   * moment, until it has acknowledged them.
   */
  private startLinger(): void {
    if (!this.driver.flush) return;
    const until = performance.now() + LINGER_MS;
    this.linger = setInterval(() => {
      if (this.driver.flush?.() || performance.now() > until) clearInterval(this.linger);
    }, LINGER_TICK_MS);
  }

  private render(frameSeconds: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);
    ctx.save();
    if (this.level.filter !== 'none') ctx.filter = this.level.filter;
    if (this.bg.complete && this.bg.naturalWidth > 0) {
      ctx.drawImage(this.bg, 0, 0, CANVAS.w, CANVAS.h);
    }
    ctx.restore();
    this.views[0].draw(ctx, this.driver.state, fighterBase(0));
    this.views[1].draw(ctx, this.driver.state, fighterBase(1));
    particles?.draw(ctx, frameSeconds);
  }
}
