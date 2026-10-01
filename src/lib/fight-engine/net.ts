// A direct browser-to-browser link for a 1v1 match, with no server of our
// own: WebRTC needs the two peers to swap one session description each
// ("signaling"), and here the players do that themselves by passing two
// codes through any messenger. The site stays static.
//
// Two data channels: `game` carries rollback packets and is unreliable and
// unordered on purpose (a late input packet is worthless, the next one
// repeats its content anyway); `ctl` is reliable and carries the handful of
// messages that set a match up.
import type { Transport } from './rollback.ts';

// Empty: no STUN server is contacted, which limits this to peers that can
// reach each other directly (same machine, same network). Play across the
// internet needs a STUN server here -- a third party that then sees both
// players' IP addresses, hence a decision that is Stefan's to make (E1 in
// the implementation plan), not a default.
const ICE_SERVERS: RTCIceServer[] = [];

export type ControlMessage =
  | { type: 'hello'; fighter: string }
  | { type: 'start'; match: number; seed: number; level: string; fighters: [string, string] }
  | { type: 'rematch' }
  | { type: 'ping' };

export interface PeerLink {
  readonly game: Transport;
  sendControl(message: ControlMessage): void;
  oncontrol: ((message: ControlMessage) => void) | null;
  /** Fires once, when the link is gone for whatever reason. */
  onclose: (() => void) | null;
  /** performance.now() of the last message received on either channel. */
  readonly lastHeard: number;
  close(): void;
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;
const isUint = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffff_ffff;

/** The peer is a stranger's browser: nothing it sends is trusted to have this shape. */
function parseControl(raw: string): ControlMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case 'hello':
      return isString(m.fighter) ? { type: 'hello', fighter: m.fighter } : null;
    case 'start': {
      const f = m.fighters;
      if (!isUint(m.match) || !isUint(m.seed) || !isString(m.level)) return null;
      if (!Array.isArray(f) || f.length !== 2 || !isString(f[0]) || !isString(f[1])) return null;
      return {
        type: 'start',
        match: m.match,
        seed: m.seed,
        level: m.level,
        fighters: [f[0], f[1]],
      };
    }
    case 'rematch':
      return { type: 'rematch' };
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}

// ---- signaling codes ----------------------------------------------------
// A session description is ~500-900 bytes of text; deflated and base64url
// encoded it fits in a chat message.
const MAX_CODE_CHARS = 8000;
const MAX_SDP_BYTES = 32_768;

async function pump(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // A pasted code is untrusted input: stop inflating before a small code
    // has turned into a very large string.
    if (total > limit) {
      await reader.cancel();
      throw new Error('code too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function through(bytes: Uint8Array<ArrayBuffer>, transform: GenericTransformStream) {
  return new Blob([bytes]).stream().pipeThrough(transform) as ReadableStream<Uint8Array>;
}

async function pack(description: RTCSessionDescription | null): Promise<string> {
  if (!description) throw new Error('no session description');
  const json = JSON.stringify({ t: description.type, s: description.sdp });
  const deflated = await pump(
    through(new TextEncoder().encode(json), new CompressionStream('deflate-raw')),
    MAX_SDP_BYTES,
  );
  let binary = '';
  for (const byte of deflated) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function unpack(
  code: string,
  expected: 'offer' | 'answer',
): Promise<RTCSessionDescriptionInit> {
  const compact = code.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length > MAX_CODE_CHARS) throw new Error('bad code');
  const binary = atob(compact.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const inflated = await pump(
    through(bytes, new DecompressionStream('deflate-raw')),
    MAX_SDP_BYTES,
  );
  const data: unknown = JSON.parse(new TextDecoder().decode(inflated));
  if (typeof data !== 'object' || data === null) throw new Error('bad code');
  const { t, s } = data as Record<string, unknown>;
  if (t !== expected || typeof s !== 'string') throw new Error('bad code');
  return { type: expected, sdp: s };
}

// ---- connection ---------------------------------------------------------
function wire(pc: RTCPeerConnection): Promise<PeerLink> {
  // Negotiated channels with fixed ids exist on both ends without either
  // side having to announce them.
  const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 });
  const game = pc.createDataChannel('game', {
    negotiated: true,
    id: 1,
    ordered: false,
    maxRetransmits: 0,
  });
  game.binaryType = 'arraybuffer';

  let lastHeard = performance.now();
  let closed = false;

  const transport: Transport = {
    onmessage: null,
    send(data) {
      if (game.readyState === 'open') game.send(data as Uint8Array<ArrayBuffer>);
    },
  };
  const link: PeerLink = {
    game: transport,
    oncontrol: null,
    onclose: null,
    get lastHeard() {
      return lastHeard;
    },
    sendControl(message) {
      if (ctl.readyState === 'open') ctl.send(JSON.stringify(message));
    },
    close() {
      pc.close();
      lost();
    },
  };
  const lost = (): void => {
    if (closed) return;
    closed = true;
    link.onclose?.();
  };

  game.onmessage = (e) => {
    if (!(e.data instanceof ArrayBuffer)) return;
    lastHeard = performance.now();
    transport.onmessage?.(new Uint8Array(e.data));
  };
  ctl.onmessage = (e) => {
    if (typeof e.data !== 'string' || e.data.length > 1024) return;
    lastHeard = performance.now();
    const message = parseControl(e.data);
    if (message) link.oncontrol?.(message);
  };
  ctl.onclose = lost;
  game.onclose = lost;

  return new Promise((resolve, reject) => {
    let open = 0;
    const opened = (): void => {
      if (++open < 2) return;
      // The silence clock starts now, not when the invitation was made:
      // the players take far longer than any timeout to swap their codes.
      lastHeard = performance.now();
      resolve(link);
    };
    ctl.onopen = opened;
    game.onopen = opened;
    pc.onconnectionstatechange = () => {
      // 'disconnected' is not final -- ICE may recover from it.
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        reject(new Error('connection failed'));
        lost();
      }
    };
  });
}

/** Resolves when every network candidate is in the local description. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') done();
    };
    // A candidate source that never answers must not hold the code back
    // forever; whatever was found by then has to do.
    const timer = setTimeout(done, 4000);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export interface Invitation {
  /** Give this to the other player. */
  readonly code: string;
  /** Feed in the code they send back; resolves once the link is up. */
  accept(replyCode: string): Promise<PeerLink>;
  cancel(): void;
}

export interface Reply {
  /** Send this back to the player who invited. */
  readonly code: string;
  /** Resolves once the inviting player has entered the reply code. */
  readonly link: Promise<PeerLink>;
  cancel(): void;
}

export const onlineSupported = (): boolean =>
  typeof RTCPeerConnection !== 'undefined' && typeof CompressionStream !== 'undefined';

export async function invite(): Promise<Invitation> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const link = wire(pc);
  // Rejections surface through accept(); without this an early failure
  // would be reported as unhandled before anyone awaits it.
  link.catch(() => {});
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return {
    code: await pack(pc.localDescription),
    async accept(replyCode) {
      await pc.setRemoteDescription(await unpack(replyCode, 'answer'));
      return link;
    },
    cancel: () => pc.close(),
  };
}

export async function join(invitationCode: string): Promise<Reply> {
  const offer = await unpack(invitationCode, 'offer');
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const link = wire(pc);
  link.catch(() => {});
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { code: await pack(pc.localDescription), link, cancel: () => pc.close() };
}
