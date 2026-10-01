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
import { type ControlMessage, invite, join, type PeerLink } from '../lib/fight-engine/net';
import { peerDriver } from '../lib/fight-engine/net-driver';
import { RollbackSession } from '../lib/fight-engine/rollback';
import { createState } from '../lib/fight-engine/sim';
import type { OnlineApi } from './fight';

const PING_MS = 2000;
// Rollback packets stop while a peer's tab is hidden (no animation frames),
// pings do not (timers still run, throttled to about one per second). So
// silence this long means the peer is gone, not just looking elsewhere.
const SILENCE_MS = 10_000;

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

export function begin(mode: 'invite' | 'join', api: OnlineApi): void {
  const found = findUi(api.root);
  if (!found) return;
  const ui: Ui = found;
  abort?.();

  const idle = ui.status.textContent ?? '';
  let cancelled = false;
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

  show('menu', false);
  show('cancel', true);
  ui.copy.textContent = 'Copy';

  const failed = (): void => reset('That did not work. Check the code and try again.');

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
      ui.submit.onclick = () => {
        say('Connecting…');
        invitation.accept(ui.input.value).then(connected, failed);
      };
    }, failed);
  } else {
    ui.inLabel.textContent = '1. Paste the invitation code your friend sent you';
    ui.submit.textContent = 'Create reply';
    show('in', true);
    say('Waiting for the invitation code.');
    ui.submit.onclick = () => {
      say('Creating a reply…');
      join(ui.input.value).then((reply) => {
        if (cancelled) return reply.cancel();
        pending = reply;
        ui.out.value = reply.code;
        ui.outLabel.textContent = '2. Send this reply code back to your friend';
        show('in', false);
        show('out', true);
        say('Waiting for your friend to enter the reply code.');
        reply.link.then(connected, failed);
      }, failed);
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
    let playing = false;
    let iWantRematch = false;
    let theyWantRematch = false;

    show('out', false);
    show('in', false);
    ui.cancel.textContent = 'Disconnect';
    say('Connected. Pick your fighter.');

    const launch = (start: StartMessage): void => {
      const [f0, f1] = start.fighters.map((id) => FIGHTERS.find((f) => f.id === id));
      const level = LEVELS.find((l) => l.id === start.level);
      // Only the host's own start message is known to be well-formed.
      if (!f0 || !f1 || !level) return;
      const initial = createState({ anim: f0.anim }, { anim: f1.anim }, start.seed);
      const session = new RollbackSession({
        local: host ? 0 : 1,
        state: initial,
        transport: peer.game,
        matchId: start.match,
      });
      playing = true;
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
          theyWantRematch = true;
          if (iWantRematch) startIfReady();
          break;
        default:
      }
    };

    api.takeOver({
      pick(id) {
        mine = id;
        peer.sendControl({ type: 'hello', fighter: id });
        say('Waiting for your friend to pick a fighter.');
        if (!playing) startIfReady();
      },
      rematch() {
        iWantRematch = true;
        peer.sendControl({ type: 'rematch' });
        if (theyWantRematch) startIfReady();
        else if (ui.resultText) ui.resultText.textContent = 'Waiting for your friend…';
      },
    });

    heartbeat = setInterval(() => {
      peer.sendControl({ type: 'ping' });
      if (performance.now() - peer.lastHeard > SILENCE_MS) peer.close();
    }, PING_MS);

    peer.onclose = () => {
      api.showSelect();
      reset('The connection to your friend was lost. The AI is still up for a fight.');
    };
    ui.cancel.onclick = () => {
      api.showSelect();
      reset(null);
    };
  }
}
