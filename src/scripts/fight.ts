// T7: a small local-vs-AI fighting minigame. New engine written for this
// canvas -- only the sprite sheets and the arena background are reused from
// $REPOS_DIR/FightingGame (a from-scratch tutorial project), not its code.
// Lives entirely behind the `data-fight` root in FightView.astro; a no-op if
// that root isn't on the page (it always is on the homepage, but this file
// is bundled for every page via client.ts).
import {
  ANIM,
  type AnimKey,
  CANVAS,
  FIGHTERS,
  GRAVITY,
  GROUND_Y,
  LEVELS,
  type LevelConfig,
  MATCH_SECONDS,
} from '../lib/fight';
import { BASE } from '../lib/site';

// Same guard as search.ts's own isEditable: the search box and category
// filter are always in the DOM regardless of which view is active, so a
// running match's window-level keydown listener has to yield to them.
const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

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
  const resultBox = root.querySelector<HTMLElement>('[data-fight-result]');
  const resultText = root.querySelector<HTMLElement>('[data-fight-result-text]');
  const againBtn = root.querySelector<HTMLButtonElement>('[data-fight-again]');
  if (
    !selectPanel ||
    !arena ||
    !canvas ||
    !ctx ||
    !timerEl ||
    !playerBar ||
    !enemyBar ||
    !resultBox ||
    !resultText
  ) {
    return;
  }

  let match: Match | null = null;
  let picked: string | null = null;

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-fighter]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fighter;
      if (!id) return;
      picked = id;
      selectPanel.hidden = true;
      arena.hidden = false;
      match?.stop();
      match = new Match(ctx, id, { timerEl, playerBar, enemyBar, resultBox, resultText });
      match.start();
    });
  }

  againBtn?.addEventListener('click', () => {
    if (!picked) return;
    match?.stop();
    match = new Match(ctx, picked, { timerEl, playerBar, enemyBar, resultBox, resultText });
    match.start();
  });

  // Leaving the Fight tab (a real click, or Escape -- views.ts dispatches a
  // 'change' event for that too, not just the .checked assignment) stops
  // the loop -- a fighting game has no business running frames, taking
  // input or ticking its clock while the visitor is looking at something
  // else. handleKey()'s own `!this.running` guard is the backstop for the
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

interface Hud {
  timerEl: HTMLElement;
  playerBar: HTMLElement;
  enemyBar: HTMLElement;
  resultBox: HTMLElement;
  resultText: HTMLElement;
}

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

// Logical hurtbox the physics/ground collision uses; the sprite is drawn
// larger and centered over it (raw frames have a lot of transparent margin).
const BOX_W = 90;
const BOX_H = 190;
const DRAW_SCALE = 1.7;
const ATTACK_RANGE = 90;
const ATTACK_W = 100;
const ATTACK_H = 60;
const ATTACK_COOLDOWN_MS = 550;
const HIT_STUN_MS = 350;
const MOVE_SPEED = 4.2;
const JUMP_VELOCITY = -12.5;

type State = 'idle' | 'run' | 'jump' | 'fall' | 'attack1' | 'takeHit' | 'death';

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
  readonly filter: string;

  constructor(x: number, facing: 1 | -1, spriteBase: string, filter: string) {
    this.x = x;
    this.facing = facing;
    this.filter = filter;
    this.images = {
      idle: loadImage(`${BASE}fight/${spriteBase}/${ANIM.idle.file}`),
      run: loadImage(`${BASE}fight/${spriteBase}/${ANIM.run.file}`),
      jump: loadImage(`${BASE}fight/${spriteBase}/${ANIM.jump.file}`),
      fall: loadImage(`${BASE}fight/${spriteBase}/${ANIM.fall.file}`),
      attack1: loadImage(`${BASE}fight/${spriteBase}/${ANIM.attack1.file}`),
      takeHit: loadImage(`${BASE}fight/${spriteBase}/${ANIM.takeHit.file}`),
      death: loadImage(`${BASE}fight/${spriteBase}/${ANIM.death.file}`),
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
      this.state === 'attack1' &&
      this.frame < ANIM[this.state].frames - 1 &&
      next !== 'takeHit' &&
      next !== 'death'
    ) {
      return; // let the swing finish its frames before switching
    }
    this.state = next;
    this.frame = 0;
    this.frameElapsed = 0;
  }

  startAttack(now: number): boolean {
    if (this.state === 'death' || this.state === 'takeHit') return false;
    if (now < this.attackCooldownUntil) return false;
    this.state = 'attack1';
    this.frame = 0;
    this.frameElapsed = 0;
    this.didHitThisSwing = false;
    this.attackCooldownUntil = now + ATTACK_COOLDOWN_MS;
    return true;
  }

  takeHit(now: number): void {
    if (this.state === 'death') return;
    this.health = Math.max(0, this.health - 12);
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
    // attack1 only releases once its swing has played out to the last
    // frame -- setState() itself already refuses an earlier switch away
    // from it, this just has to actually call setState() once it's done
    // instead of never calling it at all while attack1 is current.
    const swingDone = this.state === 'attack1' && this.frame >= ANIM.attack1.frames - 1;
    if (this.state !== 'attack1' || swingDone) {
      if (!this.onGround) this.setState(this.vy < 0 ? 'jump' : 'fall', performance.now());
      else if (this.vx !== 0) this.setState('run', performance.now());
      else this.setState('idle', performance.now());
    }
  }

  advanceFrame(dt: number): void {
    const anim = ANIM[this.state];
    this.frameElapsed += dt;
    const holdMs = anim.hold * 16.7;
    if (this.frameElapsed >= holdMs) {
      this.frameElapsed = 0;
      if (this.frame < anim.frames - 1) this.frame++;
      else if (this.state !== 'death') this.frame = 0;
      // Death holds its last frame instead of looping.
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const img = this.images[this.state];
    const anim = ANIM[this.state];
    if (!img.complete || img.naturalWidth === 0) return;
    const fw = img.naturalWidth / anim.frames;
    const fh = img.naturalHeight;
    const drawW = fw * DRAW_SCALE;
    const drawH = fh * DRAW_SCALE;
    const cx = this.x + BOX_W / 2;
    const bottom = this.y + BOX_H;
    ctx.save();
    // Skipping the assignment for the (usual) unfiltered case avoids
    // exercising canvas's filter code path -- known slow, especially on
    // WebKit -- on every frame of the match for a value that never
    // actually changes once the fighter is created.
    if (this.filter !== 'none') ctx.filter = this.filter;
    if (this.facing === -1) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, this.frame * fw, 0, fw, fh, -drawW / 2, bottom - drawH, drawW, drawH);
    } else {
      ctx.drawImage(img, this.frame * fw, 0, fw, fh, cx - drawW / 2, bottom - drawH, drawW, drawH);
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
  private raf = 0;
  private running = false;
  private over = false;
  private aiNextDecisionAt = 0;
  private aiMoveDir = 0;
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
  ) {
    const chosen = FIGHTERS.find((f) => f.id === playerId) ?? FIGHTERS[0];
    // A random pick among the rest, not FIGHTERS.find()'s first-in-order
    // match: with today's 2 fighters that's the same fighter either way,
    // but it stops "opponent" from silently freezing into one fixed
    // matchup the day the roster grows past 2.
    const rest = FIGHTERS.filter((f) => f.id !== chosen?.id);
    const other = rest[Math.floor(Math.random() * rest.length)] ?? FIGHTERS[1];
    this.player = new Fighter(
      180,
      1,
      chosen?.spriteBase ?? 'samurai-mack',
      chosen?.filter ?? 'none',
    );
    this.ai = new Fighter(
      CANVAS.w - 180 - BOX_W,
      -1,
      other?.spriteBase ?? 'martial-hero',
      other?.filter ?? 'none',
    );
    this.hud.resultBox.hidden = true;
  }

  start(): void {
    this.endsAt = performance.now() + MATCH_SECONDS * 1000;
    this.lastFrameAt = performance.now();
    this.running = true;
    this.over = false;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    // handleKey() ignores keyup while paused too (see its own comment), so
    // a movement key released during the pause would otherwise never clear
    // -- same fix also covers losing a keyup entirely, e.g. the window
    // itself loses focus while a key is held, which never reaches here as
    // any event at all.
    this.keys.left = false;
    this.keys.right = false;
  }

  resume(): void {
    if (this.over || this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.pause();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    // `this.running` (not just `this.over`) so a paused-but-not-stopped
    // match -- left via a real view-tab change, not yet Escape, see
    // views.ts -- can't keep hijacking Arrow/Space anywhere on the page.
    if (this.over || !this.running) return;
    if (isEditable(e.target)) return;
    switch (e.key) {
      case 'ArrowLeft':
        this.keys.left = down;
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.keys.right = down;
        e.preventDefault();
        break;
      case 'ArrowUp':
        if (down && this.player.onGround) this.player.vy = JUMP_VELOCITY;
        e.preventDefault();
        break;
      case ' ':
        if (down) this.player.startAttack(performance.now());
        e.preventDefault();
        break;
      default:
    }
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
        if (Math.random() < 0.55) this.ai.startAttack(now);
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
    if (attacker.state !== 'attack1' || attacker.didHitThisSwing) return;
    // Only the couple of frames where the swing is actually extended can land.
    if (attacker.frame < 2 || attacker.frame > 4) return;
    if (overlaps(attacker.attackBox, defender.hurtBox)) {
      attacker.didHitThisSwing = true;
      defender.takeHit(now);
    }
  }

  private finish(timeUp: boolean): void {
    this.over = true;
    this.pause();
    const playerWon = this.ai.dead && !this.player.dead;
    const aiWon = this.player.dead && !this.ai.dead;
    const draw = timeUp && this.player.health === this.ai.health;
    this.hud.resultText.textContent = draw
      ? 'Draw.'
      : playerWon || (timeUp && this.player.health > this.ai.health)
        ? 'You win.'
        : aiWon || (timeUp && this.ai.health > this.player.health)
          ? 'You lose.'
          : 'Draw.';
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
