import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadCodeError, pack, parseControl, unpack } from '../src/lib/fight-engine/net.ts';

const SDP = ['v=0', 'a=group:BUNDLE 0', 'a=candidate:1 1 udp 2113937151 192.168.1.5 5000 typ host'];
const sdp = (extra: string[] = []): string => [...SDP, ...extra].join('\r\n');

/** A code made the way an attacker would, bypassing pack()'s own limits. */
async function rawCode(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
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
