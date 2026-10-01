import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadCodeError,
  gameSilence,
  pack,
  parseControl,
  seal,
  unpack,
} from '../src/lib/fight-engine/net.ts';

const SDP = ['v=0', 'a=group:BUNDLE 0', 'a=candidate:1 1 udp 2113937151 192.168.1.5 5000 typ host'];
const sdp = (extra: string[] = []): string => [...SDP, ...extra].join('\r\n');

/** A code made the way an attacker would: well-formed (checksum included), bypassing pack()'s own limits. */
async function rawCode(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return seal(bytes);
}

test('control messages: well-formed ones parse, with exactly the fields they are allowed', () => {
  assert.deepEqual(parseControl('{"type":"ping"}'), { type: 'ping' });
  assert.deepEqual(parseControl('{"type":"hello","fighter":"kenji","extra":1}'), {
    type: 'hello',
    fighter: 'kenji',
  });
  assert.deepEqual(parseControl('{"type":"rematch","match":3}'), { type: 'rematch', match: 3 });
  assert.deepEqual(
    parseControl('{"type":"start","match":1,"seed":4294967295,"level":"l","fighters":["a","b"]}'),
    { type: 'start', match: 1, seed: 4294967295, level: 'l', fighters: ['a', 'b'] },
  );
});

test('control messages: anything from a stranger that is off-shape is dropped', () => {
  const bad = [
    'not json',
    'null',
    '[]',
    '"ping"',
    '{}',
    '{"type":"nope"}',
    '{"type":"hello"}',
    '{"type":"hello","fighter":7}',
    `{"type":"hello","fighter":"${'x'.repeat(65)}"}`,
    '{"type":"rematch"}',
    '{"type":"rematch","match":-1}',
    '{"type":"rematch","match":1.5}',
    '{"type":"start","match":1,"seed":4294967296,"level":"l","fighters":["a","b"]}',
    '{"type":"start","match":1,"seed":1,"level":"l","fighters":["a"]}',
    '{"type":"start","match":1,"seed":1,"level":"l","fighters":["a",2]}',
    '{"__proto__":{"type":"ping"}}',
  ];
  for (const raw of bad) assert.equal(parseControl(raw), null, raw);
});

test('a code survives the round trip', async () => {
  const description = sdp(['a=ice-ufrag:abc']);
  assert.deepEqual(await unpack(await pack('offer', description), 'offer'), {
    type: 'offer',
    sdp: description,
  });
});

test('a code with line breaks and spaces added by a messenger still works', async () => {
  const code = await pack('answer', sdp());
  const wrapped = code.replace(/(.{40})/g, '$1\r\n ');
  assert.equal((await unpack(wrapped, 'answer')).type, 'answer');
});

test('the wrong kind of code is a bad code, not a crash', async () => {
  const offer = await pack('offer', sdp());
  await assert.rejects(unpack(offer, 'answer'), BadCodeError);
});

test('garbage is a bad code however it is garbage', async () => {
  const garbage = [
    '',
    '   ',
    '!!!!',
    'AAAA',
    'x'.repeat(8001),
    // Valid base64 and no checksum: what a code looks like when a character was lost.
    'A'.repeat(40),
    await rawCode('plainly not json'),
    await rawCode('[1,2]'),
    await rawCode('{"t":"offer"}'),
    await rawCode('{"t":"offer","s":5}'),
  ];
  for (const code of garbage) {
    await assert.rejects(unpack(code, 'offer'), BadCodeError, code.slice(0, 20));
  }
});

test('a small code that inflates to megabytes is refused while inflating', async () => {
  const bomb = await rawCode(JSON.stringify({ t: 'offer', s: 'a'.repeat(3_000_000) }));
  assert.ok(bomb.length < 8000, 'the bomb must fit the code limit to prove anything');
  const started = performance.now();
  await assert.rejects(unpack(bomb, 'offer'), BadCodeError);
  assert.ok(performance.now() - started < 2000, 'took long enough to be a hang');
});

test('a description with hundreds of candidates or lines is not from a browser', async () => {
  const candidate = (i: number): string =>
    `a=candidate:${i} 1 udp 2113937151 10.0.0.${i % 250} ${5000 + i} typ host`;
  const manyCandidates = sdp(Array.from({ length: 41 }, (_, i) => candidate(i)));
  const manyLines = sdp(Array.from({ length: 400 }, (_, i) => `a=x-${i}:1`));
  await assert.rejects(
    unpack(await rawCode(JSON.stringify({ t: 'offer', s: manyCandidates })), 'offer'),
    BadCodeError,
  );
  await assert.rejects(
    unpack(await rawCode(JSON.stringify({ t: 'offer', s: manyLines })), 'offer'),
    BadCodeError,
  );
  // ...while a machine with plenty of network adapters is fine.
  const busy = sdp(Array.from({ length: 12 }, (_, i) => candidate(i)));
  assert.equal((await unpack(await pack('offer', busy), 'offer')).type, 'offer');
});

/** Repeatable noise that deflate cannot shrink, so a code made of it is long. */
let noiseState = 12345;
function noise(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < length; i++) {
    noiseState = (Math.imul(noiseState, 1103515245) + 12345) >>> 0;
    out += alphabet[(noiseState >>> 16) & 63];
  }
  return out;
}

test('a valid code that is simply too long is refused for its length', async () => {
  // Valid in every other way: 120 lines, no candidates, well under the inflated limit.
  const lines = Array.from({ length: 120 }, (_, i) => `a=x-${i}:${noise(80)}`);
  const code = await pack('offer', sdp(lines));
  assert.ok(code.length > 8000, `only ${code.length} characters`);
  await assert.rejects(unpack(code, 'offer'), BadCodeError);
});

const bytesOf = (code: string): string => atob(code.replaceAll('-', '+').replaceAll('_', '/'));

test('any single-character typo in a code is caught, not turned into another description', async () => {
  const code = await pack(
    'answer',
    sdp(['a=ice-ufrag:abcd', 'a=ice-pwd:0123456789abcdef0123456789']),
  );
  assert.equal((await unpack(code, 'answer')).type, 'answer');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < code.length; i++) {
    const other = alphabet[(alphabet.indexOf(code[i] as string) + 1) % alphabet.length];
    const typo = code.slice(0, i) + other + code.slice(i + 1);
    // The last character carries unused bits: changing only those is no typo at all.
    if (bytesOf(typo) === bytesOf(code)) continue;
    await assert.rejects(unpack(typo, 'answer'), BadCodeError, `position ${i}`);
  }
  // A dropped character and an added one as well.
  await assert.rejects(unpack(code.slice(0, 10) + code.slice(11), 'answer'), BadCodeError);
  await assert.rejects(unpack(`${code.slice(0, 10)}A${code.slice(10)}`, 'answer'), BadCodeError);
});

test('the match watchdog counts from the match start, not from the last packet of an older one', () => {
  const MINUTE = 60_000;
  // A rematch begins 5 minutes after the last game packet: no silence yet.
  assert.equal(gameSilence(5 * MINUTE + 1000, 0, 5 * MINUTE), 1000);
  // The peer's packets after the start count as soon as they arrive.
  assert.equal(gameSilence(5 * MINUTE + 9000, 5 * MINUTE + 8000, 5 * MINUTE), 1000);
  // A match that never gets a packet is silent for as long as it has run.
  assert.equal(gameSilence(5 * MINUTE + 31_000, 0, 5 * MINUTE), 31_000);
});
