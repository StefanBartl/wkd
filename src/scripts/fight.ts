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
  LEVELS,
  type LevelConfig,
  LOSSES_KEY,
  MUSIC_KEY,
  WINS_KEY,
} from '../lib/fight';
import { aiInput } from '../lib/fight-engine/ai';
import { music, playSfx } from '../lib/fight-engine/audio';
import { pollGamepads } from '../lib/fight-engine/gamepad';
import {
  BOX_H,
  BOX_W,
  createState,
  EV_HIT_P0,
  EV_HIT_P1,
  EV_KO,
  EV_TIMEUP,
  F_ANIM_FRAME,
  F_FACING,
  F_HEALTH,
  F_STATE,
  F_X,
  F_Y,
  FP,
  fighterBase,
  G_OVER,
  IN_ATTACK1,
  IN_ATTACK2,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  MOVE_SPEED,
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

  let match: Match | null = null;
  let picked: string | null = null;
  let musicOn = readMusicPref();

  const hud: Hud = { timerEl, playerBar, enemyBar, recordEl, introEl, resultBox, resultText };
  updateRecord(recordEl);

  const startMatch = (id: string): void => {
    picked = id;
    selectPanel.hidden = true;
    arena.hidden = false;
    match?.stop();
    match = new Match(ctx, id, hud, musicOn);
    match.start();
  };

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-fighter]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fighter;
      if (id) startMatch(id);
    });
  }

  againBtn?.addEventListener('click', () => {
    if (picked) startMatch(picked);
  });

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
    else if ((document.getElementById('view-fight') as HTMLInputElement | null)?.checked)
      match?.resume();
  });

  // The controller legend only appears once a controller has announced
  // itself (browsers hold that back until its first button press).
  const padHint = root.querySelector<HTMLElement>('[data-fight-gamepad]');
  if (padHint) {
    const sync = (): void => {
      padHint.hidden = !navigator.getGamepads?.().some((p) => p?.mapping === 'standard');
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
const STEP_MS = 1000 / SIM_HZ;
// A frame this late (tab was throttled, debugger, GC pause) is not caught
// up step by step -- the match just loses that time.
const MAX_FRAME_MS = 100;
const MAX_STEPS_PER_FRAME = 6;
// The handwritten opponent walks a little slower than the player.
const AI_SPEED = Math.round(MOVE_SPEED * 0.85);

class Match {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly state: SimState;
  private readonly views: readonly [FighterView, FighterView];
  private readonly input = new InputLatch();
  private bg = loadImage(`${BASE}fight/background.png`);
  private level: LevelConfig = LEVELS[Math.floor(Math.random() * LEVELS.length)] ?? {
    id: 'day',
    label: 'Day',
    filter: 'none',
  };
  private lastFrameAt = 0;
  private acc = 0;
  private raf = 0;
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

  constructor(ctx: CanvasRenderingContext2D, playerId: string, hud: Hud, musicWanted: boolean) {
    this.ctx = ctx;
    this.hud = hud;
    this.musicWanted = musicWanted;
    const chosen = FIGHTERS.find((f) => f.id === playerId) ?? FIGHTERS[0];
    // A random pick among the rest, not FIGHTERS.find()'s first-in-order
    // match: with 2 fighters that's the same one either way, but with 3+
    // it keeps the matchup varied instead of always facing the same rival.
    const rest = FIGHTERS.filter((f) => f.id !== chosen?.id);
    const other = rest[Math.floor(Math.random() * rest.length)] ?? FIGHTERS[1];
    if (!chosen || !other) throw new Error('fight: no fighters configured');
    this.views = [new FighterView(chosen), new FighterView(other)];
    this.state = createState(
      { anim: chosen.anim },
      { anim: other.anim, speed: AI_SPEED },
      Math.floor(Math.random() * 0x1_0000_0000),
    );
    this.hud.resultBox.hidden = true;
  }

  start(): void {
    this.lastFrameAt = performance.now();
    this.acc = 0;
    this.running = true;
    this.over = false;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.hud.introEl.classList.remove('fight-intro-play');
    void this.hud.introEl.offsetWidth; // restart the CSS animation
    this.hud.introEl.classList.add('fight-intro-play');
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
    this.acc = 0;
    if (this.musicWanted) music.start();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.pause();
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
    // the sim ignores it until the intro ends, and a button still held at
    // that point takes effect on the first live frame.
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
    let dt = now - this.lastFrameAt;
    this.lastFrameAt = now;
    // The sim always advances in whole 60 Hz steps, however fast the
    // display refreshes -- a 120 Hz screen renders twice per step instead
    // of running the match at double speed. On a 60 Hz screen frame times
    // jitter around 16.67ms; snapping those keeps it at exactly one step
    // per frame instead of an occasional 0-then-2 stutter.
    if (Math.abs(dt - STEP_MS) < 2) dt = STEP_MS;
    this.acc += Math.min(dt, MAX_FRAME_MS);

    // Controllers have no events for button state, only polling; once per
    // rendered frame is as fresh as the browser's own snapshot gets.
    const pad = pollGamepads();
    let events = 0;
    let steps = 0;
    while (this.acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      events |= step(this.state, this.input.consume() | pad, aiInput(this.state, 1));
      this.acc -= STEP_MS;
      steps++;
    }

    if (events & (EV_HIT_P0 | EV_HIT_P1)) playSfx('hit');
    this.syncHud();
    if (events & (EV_KO | EV_TIMEUP)) this.finish();
    this.render();
    if (this.running) this.raf = requestAnimationFrame(this.tick);
  };

  private syncHud(): void {
    const playerHealth = this.state[fighterBase(0) + F_HEALTH] as number;
    const enemyHealth = this.state[fighterBase(1) + F_HEALTH] as number;
    if (playerHealth !== this.lastPlayerHealth) {
      this.lastPlayerHealth = playerHealth;
      this.hud.playerBar.style.width = `${playerHealth}%`;
    }
    if (enemyHealth !== this.lastEnemyHealth) {
      this.lastEnemyHealth = enemyHealth;
      this.hud.enemyBar.style.width = `${enemyHealth}%`;
    }
    const remaining = secondsLeft(this.state);
    if (remaining !== this.lastRemaining) {
      this.lastRemaining = remaining;
      this.hud.timerEl.textContent = String(remaining);
    }
  }

  private finish(): void {
    this.over = true;
    this.pause();
    const outcome = this.state[G_OVER];
    this.hud.resultText.textContent =
      outcome === OVER_P0 ? 'You win.' : outcome === OVER_P1 ? 'You lose.' : 'Draw.';
    if (outcome === OVER_P0) writeCount(WINS_KEY, readCount(WINS_KEY) + 1);
    else if (outcome === OVER_P1) writeCount(LOSSES_KEY, readCount(LOSSES_KEY) + 1);
    updateRecord(this.hud.recordEl);
    this.hud.resultBox.hidden = false;
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);
    ctx.save();
    if (this.level.filter !== 'none') ctx.filter = this.level.filter;
    if (this.bg.complete && this.bg.naturalWidth > 0) {
      ctx.drawImage(this.bg, 0, 0, CANVAS.w, CANVAS.h);
    }
    ctx.restore();
    this.views[0].draw(ctx, this.state, fighterBase(0));
    this.views[1].draw(ctx, this.state, fighterBase(1));
  }
}
