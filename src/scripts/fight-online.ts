// The "fight a friend" flow: swapping the two invitation codes, then the
// small protocol over the control channel that gets both browsers into the
// same match. Loaded with import() when someone clicks Invite or Join, so
// WebRTC and rollback cost a visitor nothing until then.
//
// Roles: whoever invited is the host, plays fighter 0 (left) and decides
// seed and arena; the guest plays fighter 1. Both announce their fighter
// with `hello`, the host answers with `start`, and each side builds the
// identical initial state from that one message.
import { FIGHTERS, LEVELS } from '../lib/fight';
import {
  BadCodeError,
  type ControlMessage,
  gameSilence,
  invite,
  join,
  LinkFailedError,
  type PeerLink,
} from '../lib/fight-engine/net';
import { peerDriver } from '../lib/fight-engine/net-driver';
import { RollbackSession } from '../lib/fight-engine/rollback';
import { createState } from '../lib/fight-engine/sim';
import type { OnlineApi } from './fight';

const PING_MS = 2000;
// Rollback packets stop while a peer's tab is hidden (no animation frames),
// pings do not (timers still run, throttled to about one per second). So
// silence this long means the peer is gone, not just looking elsewhere.
const SILENCE_MS = 10_000;
// A match in progress exchanges game packets every frame. A peer that keeps
// answering pings but sends none (tab hidden for a long time, or simply
// hostile) must not hold the match frozen forever.
const GAME_SILENCE_MS = 30_000;

type StartMessage = Extract<ControlMessage, { type: 'start' }>;

interface Ui {
  status: HTMLElement;
  menu: HTMLElement;
  outStep: HTMLElement;
  outLabel: HTMLElement;
  out: HTMLTextAreaElement;
  copy: HTMLButtonElement;
  inStep: HTMLElement;
  inLabel: HTMLElement;
  input: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
  resultText: HTMLElement | null;
}

function findUi(root: HTMLElement): Ui | null {
  const q = <T extends HTMLElement>(name: string): T | null =>
    root.querySelector<T>(`[data-fight-${name}]`);
  const ui = {
    status: q('online-status'),
    menu: q('online-menu'),
    outStep: q('code-out-step'),
    outLabel: q('code-out-label'),
    out: q<HTMLTextAreaElement>('code-out'),
    copy: q<HTMLButtonElement>('code-copy'),
    inStep: q('code-in-step'),
    inLabel: q('code-in-label'),
    input: q<HTMLTextAreaElement>('code-in'),
    submit: q<HTMLButtonElement>('code-submit'),
    cancel: q<HTMLButtonElement>('online-cancel'),
  };
  for (const el of Object.values(ui)) if (!el) return null;
  return { ...(ui as Omit<Ui, 'resultText'>), resultText: q('result-text') };
}

// One flow at a time; starting another cancels the one in progress.
let abort: (() => void) | null = null;
// What the status line says when nothing is going on. Read once: reset()
// leaves its last word in that element, so reading it again would take an
// error message for the original text.
let idleText: string | null = null;

const LINK_FAILED =
  'Could not connect. For now this only works between devices on the same network.';
// The guest's browser starts probing the moment the reply code exists, but
// the host answers nothing until that code is entered; after a few minutes
// the probing gives up. A failure this long after the reply says so.
const LATE_REPLY_MS = 60_000;
const LINK_TIMED_OUT =
  'The connection timed out. Either the reply code was entered too late, or the devices are not on the same network. Start over and enter the codes promptly.';

export function begin(mode: 'invite' | 'join', api: OnlineApi): void {
  const found = findUi(api.root);
  if (!found) return;
  const ui: Ui = found;
  abort?.();

  // fight.ts stored the page's own text before anything could replace it.
  idleText ??= ui.status.dataset.idle ?? ui.status.textContent ?? '';
  const idle = idleText;
  let cancelled = false;
  let busy = false;
  /** When the guest's reply code appeared; 0 for the host. */
  let repliedAt = 0;
  let pending: { cancel(): void } | null = null;
  let link: PeerLink | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const say = (text: string): void => {
    ui.status.textContent = text;
  };
  const show = (step: 'menu' | 'out' | 'in' | 'cancel', on: boolean): void => {
    const el = { menu: ui.menu, out: ui.outStep, in: ui.inStep, cancel: ui.cancel }[step];
    el.hidden = !on;
  };
  /** The button that was just pressed is hidden by the next step; keyboard users keep their place. */
  const retry = (message: string): void => {
    // Cancel may have come while the code was still being checked.
    if (cancelled) return;
    busy = false;
    ui.submit.disabled = false;
    say(message);
    ui.input.focus();
  };

  /** Back to how the page was before, optionally leaving a last word. */
  const reset = (message: string | null): void => {
    if (cancelled) return;
    cancelled = true;
    abort = null;
    clearInterval(heartbeat);
    pending?.cancel();
    link?.close();
    api.takeOver(null);
    ui.submit.onclick = null;
    ui.submit.disabled = false;
    ui.copy.onclick = null;
    ui.cancel.onclick = null;
    ui.cancel.textContent = 'Cancel';
    ui.out.value = '';
    ui.input.value = '';
    show('out', false);
    show('in', false);
    show('cancel', false);
    show('menu', true);
    say(message ?? idle);
    ui.menu.querySelector<HTMLElement>('button')?.focus();
  };
  abort = () => reset(null);
  ui.cancel.onclick = () => reset(null);
  ui.copy.onclick = () => {
    ui.out.select();
    navigator.clipboard?.writeText(ui.out.value).then(
      () => {
        ui.copy.textContent = 'Copied';
      },
      () => {
        // Selected above, so Ctrl+C still works.
      },
    );
  };

  // The fighter cards would start an AI match, which hides this whole panel
  // (and the Cancel button in it) while the codes are still being swapped.
  api.takeOver({
    pick: () => say('Finish connecting first, or press Cancel.'),
    rematch: () => {},
  });

  show('menu', false);
  show('cancel', true);
  ui.copy.textContent = 'Copy';

  const failed = (error: unknown): void => {
    if (!(error instanceof LinkFailedError)) {
      reset('That did not work. Check the code and try again.');
      return;
    }
    const waited = repliedAt === 0 ? 0 : performance.now() - repliedAt;
    reset(waited > LATE_REPLY_MS ? LINK_TIMED_OUT : LINK_FAILED);
  };

  if (mode === 'invite') {
    say('Creating an invitation…');
    invite().then((invitation) => {
      if (cancelled) return invitation.cancel();
      pending = invitation;
      ui.out.value = invitation.code;
      ui.outLabel.textContent = '1. Send this invitation code to your friend';
      ui.inLabel.textContent = '2. Paste the reply code they send back';
      ui.submit.textContent = 'Connect';
      show('out', true);
      show('in', true);
      say('Waiting for your friend’s reply code.');
      ui.copy.focus();
      ui.submit.onclick = () => {
        if (busy) return;
        busy = true;
        ui.submit.disabled = true;
        say('Connecting…');
        invitation.accept(ui.input.value).then(connected, (error: unknown) => {
          // A typo or a cut-off message does not cost the invitation.
          if (error instanceof BadCodeError) retry('That reply code is not valid. Check it.');
          else failed(error);
        });
      };
    }, failed);
  } else {
    ui.inLabel.textContent = '1. Paste the invitation code your friend sent you';
    ui.submit.textContent = 'Create reply';
    show('in', true);
    say('Waiting for the invitation code.');
    ui.input.focus();
    ui.submit.onclick = () => {
      if (busy) return;
      busy = true;
      ui.submit.disabled = true;
      say('Creating a reply…');
      join(ui.input.value).then(
        (reply) => {
          if (cancelled) return reply.cancel();
          pending = reply;
          ui.out.value = reply.code;
          ui.outLabel.textContent = '2. Send this reply code back to your friend';
          show('in', false);
          show('out', true);
          repliedAt = performance.now();
          say('Waiting for your friend to enter the reply code.');
          ui.copy.focus();
          reply.link.then(connected, failed);
        },
        (error: unknown) => {
          if (error instanceof BadCodeError) retry('That invitation code is not valid. Check it.');
          else failed(error);
        },
      );
    };
  }

  function connected(peer: PeerLink): void {
    if (cancelled) {
      peer.close();
      return;
    }
    link = peer;
    pending = null;
    const host = mode === 'invite';
    let mine: string | null = null;
    let theirs: string | null = null;
    let matchNo = 0;
    // The number of the match last started: what `rematch` messages refer to.
    let current = -1;
    let playing = false;
    let session: RollbackSession | null = null;
    // Game packets only flow while a match runs: the watchdog counts from here.
    let matchStartedAt = 0;
    let iWantRematch = false;
    let theyWantRematch = false;

    show('out', false);
    show('in', false);
    ui.cancel.textContent = 'Disconnect';
    // Whatever was on screen, the fighter cards belong to this session now.
    api.showSelect();
    say('Connected. Pick your fighter.');
    api.root.querySelector<HTMLElement>('[data-fighter]')?.focus();

    const launch = (start: StartMessage): void => {
      const [f0, f1] = start.fighters.map((id) => FIGHTERS.find((f) => f.id === id));
      const level = LEVELS.find((l) => l.id === start.level);
      // Only the host's own start message is known to be well-formed.
      if (!f0 || !f1 || !level) return;
      const initial = createState(
        { anim: f0.anim, special: f0.special },
        { anim: f1.anim, special: f1.special },
        start.seed,
      );
      session = new RollbackSession({
        local: host ? 0 : 1,
        state: initial,
        transport: peer.game,
        matchId: start.match,
      });
      playing = true;
      current = start.match;
      matchStartedAt = performance.now();
      say('Connected.');
      iWantRematch = false;
      theyWantRematch = false;
      api.launch({ driver: peerDriver(session), fighters: [f0, f1], local: host ? 0 : 1, level });
    };

    /** Host only: once both fighters are known, decide the rest and go. */
    const startIfReady = (): void => {
      if (!host || !mine || !theirs) return;
      const level = LEVELS[Math.floor(Math.random() * LEVELS.length)];
      if (!level) return;
      const start: StartMessage = {
        type: 'start',
        match: ++matchNo & 0xff,
        seed: Math.floor(Math.random() * 0x1_0000_0000),
        level: level.id,
        fighters: [mine, theirs],
      };
      peer.sendControl(start);
      launch(start);
    };

    peer.oncontrol = (message) => {
      switch (message.type) {
        case 'hello':
          if (!FIGHTERS.some((f) => f.id === message.fighter)) return;
          theirs = message.fighter;
          if (!playing) startIfReady();
          break;
        case 'start':
          // The guest follows the host; a host ignores a peer claiming otherwise.
          if (!host) launch(message);
          break;
        case 'rematch':
          // Only a request about the match that just ended counts; a repeated
          // click or a late message would otherwise arm the next rematch too.
          if (message.match !== current) return;
          theyWantRematch = true;
          if (iWantRematch) startIfReady();
          break;
        default:
      }
    };

    const leave = (): void => {
      api.showSelect();
      reset(null);
    };

    api.takeOver({
      pick(id) {
        mine = id;
        peer.sendControl({ type: 'hello', fighter: id });
        say('Waiting for your friend to pick a fighter.');
        if (!playing) startIfReady();
      },
      rematch() {
        if (iWantRematch) return;
        iWantRematch = true;
        peer.sendControl({ type: 'rematch', match: current });
        if (theyWantRematch) startIfReady();
        // Added to the result, not in place of it: who won should stay readable.
        else if (ui.resultText) ui.resultText.textContent += ' Waiting for your friend…';
      },
      leave,
    });

    heartbeat = setInterval(() => {
      peer.sendControl({ type: 'ping' });
      const now = performance.now();
      const matchFrozen =
        session !== null &&
        session.outcome === 0 &&
        !session.desynced &&
        gameSilence(now, peer.lastGameHeard, matchStartedAt) > GAME_SILENCE_MS;
      if (now - peer.lastHeard > SILENCE_MS || matchFrozen) peer.close();
    }, PING_MS);

    peer.onclose = () => {
      api.showSelect();
      reset('The connection to your friend was lost. The AI is still up for a fight.');
    };
    ui.cancel.onclick = leave;
  }
}
