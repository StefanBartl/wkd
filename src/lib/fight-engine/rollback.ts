// Rollback netcode for two peers (the GGPO idea): nobody waits for the
// other side's input. Each peer steps the match immediately, guessing that
// the opponent keeps doing what they last did; when the real input arrives
// and the guess was wrong, the match is rewound to the last frame both
// inputs are known for and re-simulated up to the present within the same
// tick. Possible only because step() is deterministic and the whole state
// is one array that can be copied.
//
// Two states are kept instead of a ring of snapshots:
//   confirmed -- stepped only with real inputs of both players
//   current   -- confirmed plus up to `maxPrediction` guessed frames; this
//                is what gets rendered
// A rollback is "copy confirmed over current, replay the frames in between".
//
// The transport may drop, delay and reorder packets (it is meant to run over
// an unreliable WebRTC data channel): every packet repeats all inputs the
// peer has not acknowledged yet.
import { cloneState, copyState, G_OVER, hashState, type SimState, step } from './sim.ts';

export interface Transport {
  send(data: Uint8Array): void;
  onmessage: ((data: Uint8Array) => void) | null;
}

export interface RollbackOptions {
  /** Which fighter this peer controls. */
  readonly local: 0 | 1;
  /** Initial state; both peers must start from identical ones. */
  readonly state: SimState;
  readonly transport: Transport;
  /**
   * Frames between pressing a button and the sim seeing it. Trades a little
   * local latency for fewer rollbacks: with 2 frames, a peer up to ~33ms
   * away never has to be guessed at all.
   */
  readonly inputDelay?: number;
  /** Most frames `current` may run ahead of `confirmed` before stalling. */
  readonly maxPrediction?: number;
  /**
   * Tags every packet (0..255). Peers that reuse one transport for several
   * matches bump it per match, so a straggler from the previous match is
   * dropped instead of being read as news about this one.
   */
  readonly matchId?: number;
}

export interface RollbackStats {
  /** Times a wrong guess forced a rewind. */
  rollbacks: number;
  /** Frames re-simulated in the deepest single rewind. */
  maxRollbackFrames: number;
  /** Ticks spent waiting because the peer's input was too far behind. */
  stalledTicks: number;
  /** Ticks skipped to let a peer that runs behind catch up. */
  syncSkips: number;
}

// Longest match (intro + 60s) plus headroom for input delay.
const MAX_FRAMES = 60 * 75;
const MAX_INPUTS_PER_PACKET = 64;
const HASH_INTERVAL = 30;
const SYNC_SKIP_COOLDOWN = 10;
const HEADER_BYTES = 23;

interface Packet {
  /** Sender's current frame. */
  frame: number;
  /** Sender has this peer's inputs for all frames below this. */
  ack: number;
  /** How far the sender believes it runs ahead, in frames. */
  advantage: number;
  /** Frame of the first input in `inputs`. */
  start: number;
  inputs: Uint8Array;
  /** A frame the sender has confirmed, and its state hash there. */
  hashFrame: number;
  hash: number;
  matchId: number;
}

function encodePacket(p: Packet): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + p.inputs.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, p.frame, true);
  view.setUint32(4, p.ack, true);
  view.setInt8(8, Math.max(-127, Math.min(127, p.advantage)));
  view.setUint32(9, p.start, true);
  view.setUint8(13, p.inputs.length);
  view.setUint32(14, p.hashFrame, true);
  view.setUint32(18, p.hash, true);
  view.setUint8(22, p.matchId);
  bytes.set(p.inputs, HEADER_BYTES);
  return bytes;
}

function decodePacket(bytes: Uint8Array): Packet | null {
  if (bytes.length < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint8(13);
  if (bytes.length !== HEADER_BYTES + count) return null;
  return {
    frame: view.getUint32(0, true),
    ack: view.getUint32(4, true),
    advantage: view.getInt8(8),
    start: view.getUint32(9, true),
    inputs: bytes.subarray(HEADER_BYTES),
    hashFrame: view.getUint32(14, true),
    hash: view.getUint32(18, true),
    matchId: view.getUint8(22),
  };
}

export class RollbackSession {
  /** The predicted present: render this. */
  readonly current: SimState;
  /** The newest state both peers are guaranteed to agree on. */
  readonly confirmed: SimState;
  readonly stats: RollbackStats = {
    rollbacks: 0,
    maxRollbackFrames: 0,
    stalledTicks: 0,
    syncSkips: 0,
  };
  /** Set once the peers' confirmed states were found to differ. Not recoverable. */
  desynced = false;

  private readonly local: 0 | 1;
  private readonly transport: Transport;
  private readonly inputDelay: number;
  private readonly maxPrediction: number;
  private readonly matchId: number;

  private frameNo = 0;
  private confirmedNo = 0;
  private readonly localInputs = new Uint8Array(MAX_FRAMES);
  private readonly remoteInputs = new Uint8Array(MAX_FRAMES);
  /** What was fed to the sim as the remote input, real or guessed, per frame. */
  private readonly usedRemote = new Uint8Array(MAX_FRAMES);
  private localKnown = 0;
  private remoteKnown = 0;
  private peerAck = 0;
  private mispredicted = false;

  private heardFromPeer = false;
  private remoteFrame = 0;
  private remoteAdvantage = 0;
  private lastSyncSkip = -SYNC_SKIP_COOLDOWN;

  private readonly hashes = new Map<number, number>();
  private lastHashFrame = 0;

  constructor(options: RollbackOptions) {
    this.local = options.local;
    this.transport = options.transport;
    this.inputDelay = options.inputDelay ?? 2;
    this.maxPrediction = options.maxPrediction ?? 8;
    this.matchId = (options.matchId ?? 0) & 0xff;
    this.current = cloneState(options.state);
    this.confirmed = cloneState(options.state);
    // The first `inputDelay` frames have no input from anyone.
    this.localKnown = this.inputDelay;
    this.transport.onmessage = (data) => this.receive(data);
  }

  /** Frames stepped so far on the predicted timeline. */
  get frame(): number {
    return this.frameNo;
  }

  /** Frames for which both players' real inputs have been applied. */
  get confirmedFrame(): number {
    return this.confirmedNo;
  }

  /** OVER_* once the match has ended for both peers beyond doubt, else 0. */
  get outcome(): number {
    return this.confirmed[G_OVER] as number;
  }

  /** Frames of input from the peer still being guessed at. */
  get predictedFrames(): number {
    return this.frameNo - this.confirmedNo;
  }

  /**
   * One 60 Hz tick: takes the local input sampled now, sends it, absorbs
   * whatever arrived from the peer and steps the match. Returns the EV_*
   * bits of the newly simulated frame, or 0 when the tick had to wait.
   * Events are from the predicted timeline -- a hit that gets rolled back
   * has already been reported.
   */
  advance(localInput: number): number {
    const target = this.frameNo + this.inputDelay;
    if (target >= this.localKnown && target < MAX_FRAMES) {
      this.localInputs[target] = localInput;
      this.localKnown = target + 1;
    }
    this.confirm();
    this.send();

    if (this.mispredicted) this.rollback();

    if (this.frameNo >= MAX_FRAMES - 1) return 0;
    if (this.frameNo - this.confirmedNo >= this.maxPrediction) {
      this.stats.stalledTicks++;
      return 0;
    }
    if (this.shouldWaitForPeer()) {
      this.stats.syncSkips++;
      return 0;
    }

    const events = this.stepCurrent(this.frameNo);
    this.frameNo++;
    return events;
  }

  private remoteInputFor(frame: number): number {
    if (frame < this.remoteKnown) return this.remoteInputs[frame] as number;
    // The guess: whatever they did last, they are still doing.
    return this.remoteKnown > 0 ? (this.remoteInputs[this.remoteKnown - 1] as number) : 0;
  }

  private stepWith(state: SimState, frame: number, remote: number): number {
    const mine = this.localInputs[frame] as number;
    return this.local === 0 ? step(state, mine, remote) : step(state, remote, mine);
  }

  private stepCurrent(frame: number): number {
    const remote = this.remoteInputFor(frame);
    this.usedRemote[frame] = remote;
    return this.stepWith(this.current, frame, remote);
  }

  /** Advance `confirmed` over every frame both inputs are now known for. */
  private confirm(): void {
    const until = Math.min(this.remoteKnown, this.localKnown, this.frameNo);
    while (this.confirmedNo < until) {
      this.stepWith(
        this.confirmed,
        this.confirmedNo,
        this.remoteInputs[this.confirmedNo] as number,
      );
      this.confirmedNo++;
      if (this.confirmedNo % HASH_INTERVAL === 0) {
        this.hashes.set(this.confirmedNo, hashState(this.confirmed));
        this.hashes.delete(this.confirmedNo - HASH_INTERVAL * 8);
        this.lastHashFrame = this.confirmedNo;
      }
    }
  }

  private rollback(): void {
    this.mispredicted = false;
    const depth = this.frameNo - this.confirmedNo;
    copyState(this.current, this.confirmed);
    for (let f = this.confirmedNo; f < this.frameNo; f++) this.stepCurrent(f);
    this.stats.rollbacks++;
    if (depth > this.stats.maxRollbackFrames) this.stats.maxRollbackFrames = depth;
  }

  /**
   * Both peers estimate how far they run ahead of the other; half the
   * difference is this peer's real lead with the (symmetric) latency
   * cancelled out. A peer a frame or more ahead sits out a tick now and
   * then, so the other one stops living permanently in its past.
   */
  private shouldWaitForPeer(): boolean {
    if (!this.heardFromPeer) return false;
    if (this.frameNo - this.lastSyncSkip < SYNC_SKIP_COOLDOWN) return false;
    const advantage = this.frameNo - this.remoteFrame;
    if ((advantage - this.remoteAdvantage) / 2 < 1) return false;
    this.lastSyncSkip = this.frameNo;
    return true;
  }

  private send(): void {
    const start = Math.min(this.peerAck, this.localKnown);
    const count = Math.min(this.localKnown - start, MAX_INPUTS_PER_PACKET);
    this.transport.send(
      encodePacket({
        frame: this.frameNo,
        ack: this.remoteKnown,
        advantage: this.frameNo - this.remoteFrame,
        start,
        inputs: this.localInputs.subarray(start, start + count),
        hashFrame: this.lastHashFrame,
        hash: this.hashes.get(this.lastHashFrame) ?? 0,
        matchId: this.matchId,
      }),
    );
  }

  private receive(data: Uint8Array): void {
    const packet = decodePacket(data);
    if (!packet || packet.matchId !== this.matchId) return;
    this.heardFromPeer = true;
    if (packet.ack > this.peerAck) this.peerAck = Math.min(packet.ack, this.localKnown);
    // Reordered packets: only the newest one says where the peer is now.
    if (packet.frame >= this.remoteFrame) {
      this.remoteFrame = packet.frame;
      this.remoteAdvantage = packet.advantage;
    }

    // Inputs are only taken as a gapless continuation of what is known; a
    // packet that starts later is waiting for one that got lost, and the
    // peer will repeat those inputs until they are acknowledged.
    if (packet.start <= this.remoteKnown) {
      const end = Math.min(packet.start + packet.inputs.length, MAX_FRAMES);
      for (let f = this.remoteKnown; f < end; f++) {
        const input = packet.inputs[f - packet.start] as number;
        this.remoteInputs[f] = input;
        if (f < this.frameNo && this.usedRemote[f] !== input) this.mispredicted = true;
      }
      if (end > this.remoteKnown) this.remoteKnown = end;
    }

    if (packet.hashFrame > 0) {
      const mine = this.hashes.get(packet.hashFrame);
      if (mine !== undefined && mine !== packet.hash) this.desynced = true;
    }
  }
}

export interface LoopbackOptions {
  /** One-way delay in ticks (1 tick = 1/60 s). */
  readonly delay: number;
  /** Extra random delay per packet, 0..jitter ticks; also reorders packets. */
  readonly jitter?: number;
  /** Probability in 0..1 that a packet is dropped. */
  readonly loss?: number;
  readonly seed?: number;
}

/**
 * An in-process network: two connected transports and a clock. Nothing is
 * delivered until tick() is called, once per simulated frame.
 */
export function createLoopback(options: LoopbackOptions): {
  a: Transport;
  b: Transport;
  tick(): void;
} {
  let now = 0;
  let rng = (options.seed ?? 1) | 1;
  const random = (): number => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return (rng >>> 0) / 0x1_0000_0000;
  };
  const inFlight: { due: number; to: Transport; data: Uint8Array }[] = [];
  const end = (other: () => Transport): Transport => ({
    onmessage: null,
    send(data) {
      if (random() < (options.loss ?? 0)) return;
      const due = now + options.delay + Math.floor(random() * ((options.jitter ?? 0) + 1));
      inFlight.push({ due, to: other(), data: data.slice() });
    },
  });
  const a: Transport = end(() => b);
  const b: Transport = end(() => a);
  return {
    a,
    b,
    tick() {
      now++;
      const due = inFlight.filter((packet) => packet.due <= now);
      for (const packet of due) inFlight.splice(inFlight.indexOf(packet), 1);
      for (const packet of due) packet.to.onmessage?.(packet.data);
    },
  };
}
