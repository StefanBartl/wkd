// T7: a small local-vs-AI fighting minigame. New engine written for this
// canvas -- only the sprite sheets and the arena background are reused from
// $REPOS_DIR/FightingGame (a from-scratch tutorial project), not its code.
// Lives entirely behind the `data-fight` root in FightView.astro; a no-op if
// that root isn't on the page (it always is on the homepage, but this file
// is bundled for every page via client.ts).
import {
  type AnimDef,
  type AnimKey,
  CANVAS,
  FIGHTERS,
  type FighterConfig,
  GRAVITY,
  GROUND_Y,
  LEVELS,
  type LevelConfig,
  LOSSES_KEY,
  MATCH_SECONDS,
  MUSIC_KEY,
  WINS_KEY,
} from '../lib/fight';
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

// ---- tiny procedural audio -------------------------------------------------
// No sound assets exist in the source project (it never had any either --
// see its own ToDo.md). This is a synthesised stinger + a looping arpeggio,
// not a real "FIGHT!" voice line or produced music -- a placeholder Stefan
// can replace with real audio later, same spirit as T6's pre-built,
// awaiting-real-screenshots component.
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function playStinger(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [freq, start, dur] of [
    [220, 0, 0.16],
    [146, 0.1, 0.32],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.22, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.05);
  }
}

function playHit(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.14);
}

class MusicLoop {
  private gain: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private i = 0;
  private readonly notes = [110, 130.81, 146.83, 110, 164.81, 146.83, 130.81, 98];

  start(): void {
    const ctx = getAudioCtx();
    if (!ctx) return;
    this.stop();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.05;
    this.gain.connect(ctx.destination);
    this.i = 0;
    this.timer = setInterval(() => this.step(ctx), 230);
    this.step(ctx);
  }

  private step(ctx: AudioContext): void {
    if (!this.gain) return;
    const freq = this.notes[this.i % this.notes.length] ?? 110;
    this.i++;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g).connect(this.gain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.gain?.disconnect();
    this.gain = null;
  }
}

// ---- fighter ----------------------------------------------------------
// Logical hurtbox the physics/ground collision uses; the sprite is drawn
// larger and centered over it (raw frames have a lot of transparent margin).
const BOX_W = 90;
const BOX_H = 190;
const DRAW_SCALE = 1.7;
const ATTACK_RANGE = 90;
const ATTACK_W = 100;
const ATTACK_H = 60;
const HIT_STUN_MS = 350;
const MOVE_SPEED = 4.2;
const JUMP_VELOCITY = -12.5;
const INTRO_MS = 900;

// Light/fast vs. heavy/slow -- "different attacks" per fighter would need
// per-character move sets kenji's assets don't give us cleanly, but every
// fighter already has two real, differently-timed swings via attack1/attack2.
const ATTACK_STATS: Readonly<
  Record<'attack1' | 'attack2', { damage: number; cooldownMs: number }>
> = {
  attack1: { damage: 10, cooldownMs: 450 },
  attack2: { damage: 22, cooldownMs: 950 },
};

type State = 'idle' | 'run' | 'jump' | 'fall' | 'attack1' | 'attack2' | 'takeHit' | 'death';
type AttackState = 'attack1' | 'attack2';
const isAttackState = (s: State): s is AttackState => s === 'attack1' || s === 'attack2';

class Fighter {
  x: number;
  y = GROUND_Y - BOX_H;
  vx = 0;
  vy = 0;
  facing: 1 | -1;
  health = 100;
  state: State = 'idle';
  frame = 0;
  frameElapsed = 0;
  attackCooldownUntil = 0;
  hitUntil = 0;
  didHitThisSwing = false;
  dead = false;
  private images: Record<AnimKey, HTMLImageElement>;
  private readonly anim: Readonly<Record<AnimKey, AnimDef>>;
  readonly filter: string;
  readonly footMargin: number;

  constructor(x: number, facing: 1 | -1, cfg: FighterConfig) {
    this.x = x;
    this.facing = facing;
    this.filter = cfg.filter;
    this.footMargin = cfg.footMargin;
    this.anim = cfg.anim;
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

  get onGround(): boolean {
    return this.y + BOX_H >= GROUND_Y - 0.01;
  }

  get attackBox(): { x: number; y: number; w: number; h: number } {
    const w = ATTACK_W;
    const x = this.facing === 1 ? this.x + BOX_W : this.x - w;
    return { x, y: this.y + 30, w, h: ATTACK_H };
  }

  get hurtBox(): { x: number; y: number; w: number; h: number } {
    return { x: this.x, y: this.y, w: BOX_W, h: BOX_H };
  }

  setState(next: State, now: number): void {
    if (this.state === next) return;
    if (this.state === 'death') return;
    if (this.state === 'takeHit' && now < this.hitUntil) return;
    if (
      isAttackState(this.state) &&
      this.frame < this.anim[this.state].frames - 1 &&
      next !== 'takeHit' &&
      next !== 'death'
    ) {
      return; // let the swing finish its frames before switching
    }
    this.state = next;
    this.frame = 0;
    this.frameElapsed = 0;
  }

  startAttack(kind: AttackState, now: number): boolean {
    if (this.state === 'death' || this.state === 'takeHit') return false;
    if (now < this.attackCooldownUntil) return false;
    this.state = kind;
    this.frame = 0;
    this.frameElapsed = 0;
    this.didHitThisSwing = false;
    this.attackCooldownUntil = now + ATTACK_STATS[kind].cooldownMs;
    return true;
  }

  takeHit(damage: number, now: number): void {
    if (this.state === 'death') return;
    this.health = Math.max(0, this.health - damage);
    this.hitUntil = now + HIT_STUN_MS;
    this.state = this.health <= 0 ? 'death' : 'takeHit';
    this.frame = 0;
    this.frameElapsed = 0;
    if (this.state === 'death') this.dead = true;
  }

  physics(): void {
    if (this.dead) return;
    this.x += this.vx;
    this.vy += GRAVITY;
    this.y += this.vy;
    if (this.y + BOX_H >= GROUND_Y) {
      this.y = GROUND_Y - BOX_H;
      this.vy = 0;
    }
    this.x = Math.max(10, Math.min(CANVAS.w - BOX_W - 10, this.x));
    if (this.state === 'takeHit' || this.state === 'death') return;
    // An attack only releases once its swing has played out to the last
    // frame -- setState() itself already refuses an earlier switch away
    // from it, this just has to actually call setState() once it's done
    // instead of never calling it at all while attacking.
    const swingDone = isAttackState(this.state) && this.frame >= this.anim[this.state].frames - 1;
    if (!isAttackState(this.state) || swingDone) {
      if (!this.onGround) this.setState(this.vy < 0 ? 'jump' : 'fall', performance.now());
      else if (this.vx !== 0) this.setState('run', performance.now());
      else this.setState('idle', performance.now());
    }
  }

  advanceFrame(dt: number): void {
    const anim = this.anim[this.state];
    this.frameElapsed += dt;
    const holdMs = anim.hold * 16.7;
    if (this.frameElapsed >= holdMs) {
      this.frameElapsed = 0;
      if (this.frame < anim.frames - 1) this.frame++;
      else if (this.state !== 'death') this.frame = 0;
      // Death holds its last frame instead of looping.
    }
  }

  /** The frames within the current swing where the attack box can land a hit. */
  hitWindow(): { start: number; end: number } {
    const frames = this.anim[this.state].frames;
    return { start: Math.floor(frames * 0.3), end: Math.ceil(frames * 0.8) };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const img = this.images[this.state];
    const anim = this.anim[this.state];
    if (!img.complete || img.naturalWidth === 0) return;
    const fw = img.naturalWidth / anim.frames;
    const fh = img.naturalHeight;
    const drawW = fw * DRAW_SCALE;
    const drawH = fh * DRAW_SCALE;
    const cx = this.x + BOX_W / 2;
    // footMargin pushes the drawn sprite down so the actual feet -- not
    // the bottom of its transparent bounding box -- land on the ground.
    const drawY = this.y + BOX_H - drawH + this.footMargin * DRAW_SCALE;
    ctx.save();
    // Skipping the assignment for the (usual) unfiltered case avoids
    // exercising canvas's filter code path -- known slow, especially on
    // WebKit -- on every frame of the match for a value that never
    // actually changes once the fighter is created.
    if (this.filter !== 'none') ctx.filter = this.filter;
    if (this.facing === -1) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, this.frame * fw, 0, fw, fh, -drawW / 2, drawY, drawW, drawH);
    } else {
      ctx.drawImage(img, this.frame * fw, 0, fw, fh, cx - drawW / 2, drawY, drawW, drawH);
    }
    ctx.restore();
  }
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

class Match {
  private player: Fighter;
  private ai: Fighter;
  private bg = loadImage(`${BASE}fight/background.png`);
  private level: LevelConfig = LEVELS[Math.floor(Math.random() * LEVELS.length)] ?? {
    id: 'day',
    label: 'Day',
    filter: 'none',
  };
  private keys = { left: false, right: false };
  private lastFrameAt = 0;
  private endsAt = 0;
  private introUntil = 0;
  private introShown = false;
  private raf = 0;
  private running = false;
  private over = false;
  private aiNextDecisionAt = 0;
  private aiMoveDir = 0;
  private music = new MusicLoop();
  private musicWanted: boolean;
  // Written health/timer values, so the HUD only touches the DOM on the
  // ~1-2/sec ticks where they actually changed instead of every one of a
  // 60fps match's ~3600 frames.
  private lastPlayerHealth = -1;
  private lastAiHealth = -1;
  private lastRemaining = -1;
  private onKeyDown = (e: KeyboardEvent): void => this.handleKey(e, true);
  private onKeyUp = (e: KeyboardEvent): void => this.handleKey(e, false);

  constructor(
    private ctx: CanvasRenderingContext2D,
    playerId: string,
    private hud: Hud,
    musicWanted: boolean,
  ) {
    this.musicWanted = musicWanted;
    const chosen = FIGHTERS.find((f) => f.id === playerId) ?? FIGHTERS[0];
    // A random pick among the rest, not FIGHTERS.find()'s first-in-order
    // match: with 2 fighters that's the same one either way, but with 3+
    // it keeps the matchup varied instead of always facing the same rival.
    const rest = FIGHTERS.filter((f) => f.id !== chosen?.id);
    const other = rest[Math.floor(Math.random() * rest.length)] ?? FIGHTERS[1];
    const chosenCfg = chosen ?? FIGHTERS[0];
    const otherCfg = other ?? FIGHTERS[1];
    if (!chosenCfg || !otherCfg) throw new Error('fight: no fighters configured');
    this.player = new Fighter(180, 1, chosenCfg);
    this.ai = new Fighter(CANVAS.w - 180 - BOX_W, -1, otherCfg);
    this.hud.resultBox.hidden = true;
  }

  start(): void {
    const now = performance.now();
    this.introUntil = now + INTRO_MS;
    this.introShown = false;
    this.endsAt = now + INTRO_MS + MATCH_SECONDS * 1000;
    this.lastFrameAt = now;
    this.running = true;
    this.over = false;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    if (this.musicWanted) this.music.start();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.music.stop();
    // setAction() ignores keyup while paused too, so a movement key
    // released during the pause would otherwise never clear -- same fix
    // also covers losing a keyup entirely, e.g. the window itself loses
    // focus while a key is held, which never reaches here as any event.
    this.keys.left = false;
    this.keys.right = false;
  }

  resume(): void {
    if (this.over || this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    if (this.musicWanted) this.music.start();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.pause();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  setMusic(on: boolean): void {
    this.musicWanted = on;
    if (on && this.running && !this.over) this.music.start();
    else this.music.stop();
  }

  setAction(action: Action, down: boolean): void {
    // `this.running` (not just `this.over`) so a paused-but-not-stopped
    // match -- left via a real view-tab change, not yet Escape, see
    // views.ts -- can't keep reacting to touch buttons/keys anywhere on
    // the page. Input is also ignored during the FIGHT! intro beat.
    if (this.over || !this.running || performance.now() < this.introUntil) return;
    const now = performance.now();
    switch (action) {
      case 'left':
        this.keys.left = down;
        break;
      case 'right':
        this.keys.right = down;
        break;
      case 'jump':
        if (down && this.player.onGround) this.player.vy = JUMP_VELOCITY;
        break;
      case 'attack1':
        if (down) this.player.startAttack('attack1', now);
        break;
      case 'attack2':
        if (down) this.player.startAttack('attack2', now);
        break;
      default:
    }
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    if (isEditable(e.target)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const action = KEY_ACTIONS[key];
    if (!action) return;
    e.preventDefault();
    this.setAction(action, down);
  }

  private driveAI(now: number): void {
    if (this.ai.state === 'death' || this.ai.state === 'takeHit') {
      this.ai.vx = 0;
      return;
    }
    const dx = this.player.x - this.ai.x;
    this.ai.facing = dx < 0 ? 1 : -1;
    const dist = Math.abs(dx);
    if (now >= this.aiNextDecisionAt) {
      this.aiNextDecisionAt = now + 350 + Math.random() * 400;
      if (dist < ATTACK_RANGE + 10) {
        this.aiMoveDir = 0;
        if (Math.random() < 0.55)
          this.ai.startAttack(Math.random() < 0.35 ? 'attack2' : 'attack1', now);
      } else {
        this.aiMoveDir = dx < 0 ? -1 : 1;
        if (this.ai.onGround && Math.random() < 0.08) this.ai.vy = JUMP_VELOCITY;
      }
    }
    this.ai.vx = dist < ATTACK_RANGE + 10 ? 0 : this.aiMoveDir * MOVE_SPEED * 0.85;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(50, now - this.lastFrameAt);
    this.lastFrameAt = now;

    if (now < this.introUntil) {
      if (!this.introShown) {
        this.introShown = true;
        this.hud.introEl.classList.remove('fight-intro-play');
        void this.hud.introEl.offsetWidth; // restart the CSS animation
        this.hud.introEl.classList.add('fight-intro-play');
        playStinger();
      }
      this.player.advanceFrame(dt);
      this.ai.advanceFrame(dt);
      this.render();
      if (this.running) this.raf = requestAnimationFrame(this.tick);
      return;
    }

    this.player.vx = (this.keys.right ? MOVE_SPEED : 0) - (this.keys.left ? MOVE_SPEED : 0);
    if (this.player.vx > 0) this.player.facing = 1;
    else if (this.player.vx < 0) this.player.facing = -1;
    this.driveAI(now);

    this.player.physics();
    this.ai.physics();
    this.player.advanceFrame(dt);
    this.ai.advanceFrame(dt);

    this.resolveAttack(this.player, this.ai, now);
    this.resolveAttack(this.ai, this.player, now);

    if (this.player.health !== this.lastPlayerHealth) {
      this.lastPlayerHealth = this.player.health;
      this.hud.playerBar.style.width = `${this.player.health}%`;
    }
    if (this.ai.health !== this.lastAiHealth) {
      this.lastAiHealth = this.ai.health;
      this.hud.enemyBar.style.width = `${this.ai.health}%`;
    }

    const remaining = Math.max(0, Math.ceil((this.endsAt - now) / 1000));
    if (remaining !== this.lastRemaining) {
      this.lastRemaining = remaining;
      this.hud.timerEl.textContent = String(remaining);
    }

    if (this.player.dead || this.ai.dead || remaining <= 0) {
      this.finish(remaining <= 0);
    }

    this.render();
    if (this.running) this.raf = requestAnimationFrame(this.tick);
  };

  private resolveAttack(attacker: Fighter, defender: Fighter, now: number): void {
    if (!isAttackState(attacker.state) || attacker.didHitThisSwing) return;
    const { start, end } = attacker.hitWindow();
    if (attacker.frame < start || attacker.frame > end) return;
    if (overlaps(attacker.attackBox, defender.hurtBox)) {
      attacker.didHitThisSwing = true;
      defender.takeHit(ATTACK_STATS[attacker.state].damage, now);
      playHit();
    }
  }

  private finish(timeUp: boolean): void {
    this.over = true;
    this.pause();
    const playerWon =
      (this.ai.dead && !this.player.dead) || (timeUp && this.player.health > this.ai.health);
    const aiWon =
      (this.player.dead && !this.ai.dead) || (timeUp && this.ai.health > this.player.health);
    this.hud.resultText.textContent = playerWon ? 'You win.' : aiWon ? 'You lose.' : 'Draw.';
    if (playerWon) writeCount(WINS_KEY, readCount(WINS_KEY) + 1);
    else if (aiWon) writeCount(LOSSES_KEY, readCount(LOSSES_KEY) + 1);
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
    this.player.draw(ctx);
    this.ai.draw(ctx);
  }
}
