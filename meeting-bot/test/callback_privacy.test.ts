/**
 * D886 B2 (#2580): the HTTP callback client against a stubbed Worker, and
 * #2577's privacy rule — no meeting link, passcode or participant name in a
 * log line, whatever the adapter throws.
 */
import { test } from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { CALLBACK_PATHS, TransportError, httpTransport, signRequest } from '../src/callback.ts';
import { logLine, safeFields } from '../src/log.ts';
import { runBot } from '../src/lifecycle.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import { CHUNK_SAMPLES, FREE_LIMIT_MS } from '../src/constants.ts';
import { AdapterFailure } from '../src/types.ts';
import { FakeClock, StubCallback, tone } from './_harness.ts';

const BASE = 'https://axal.vc/api/meeting-bot/runs/run_9/';
// A fresh key each run: the test checks the signature's shape, not a stored value.
const KEY = randomBytes(16).toString('hex');

type Seen = { url: string; init: RequestInit };
function stubFetch(answer: (url: string, init: RequestInit) => Response) {
  const seen: Seen[] = [];
  const f = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch;
  return { f, seen };
}

test('1. status and events are signed POSTs to the run\'s callback, with redirects refused', async () => {
  const { f, seen } = stubFetch(() => new Response('{}', { status: 200 }));
  const t = httpTransport({ baseUrl: BASE, runId: 'run_9', key: KEY, fetch: f, now: () => 1_700_000_000_000 });
  await t.status({ state: 'recording' });
  await t.events([{ n: 1, type: 'speaker', key: 'p1', at_ms: 5 }]);
  assert.deepEqual(seen.map((s) => s.url), [BASE + CALLBACK_PATHS.status, BASE + CALLBACK_PATHS.events]);
  for (const s of seen) {
    assert.equal(s.init.method, 'POST');
    assert.equal(s.init.redirect, 'error');
    assert.ok(s.init.signal, 'every request has a deadline');
    const h = s.init.headers as Record<string, string>;
    const expected = await signRequest(KEY, 'run_9', String(s.init.body), 1_700_000_000_000);
    assert.equal(h['x-axal-bot-signature'], expected['x-axal-bot-signature']);
    assert.equal(h['x-axal-bot-signature'], createHmac('sha256', KEY).update(`run_9.1700000000.${String(s.init.body)}`).digest('hex'), 'HMAC-SHA256 over <run>.<ts>.<body>');
    assert.equal(h['x-axal-bot-ts'], '1700000000');
    assert.equal(h['x-axal-bot-run'], 'run_9');
  }
  const other = await signRequest(randomBytes(16).toString('hex'), 'run_9', String(seen[0].init.body), 1_700_000_000_000);
  assert.notEqual(other['x-axal-bot-signature'], (seen[0].init.headers as Record<string, string>)['x-axal-bot-signature']);
  assert.deepEqual(JSON.parse(String(seen[1].init.body)), { events: [{ n: 1, type: 'speaker', key: 'p1', at_ms: 5 }] });
});

test('2. a chunk asks for its one-time URL, then PUTs the WAV there; a non-https URL is refused', async () => {
  const upload = 'https://r2.example.com/put/abc?sig=1';
  const { f, seen } = stubFetch((url) => (url.endsWith('/chunks/4') ? Response.json({ url: upload }) : new Response(null, { status: 200 })));
  const t = httpTransport({ baseUrl: BASE, runId: 'run_9', key: KEY, fetch: f });
  const wav = new Uint8Array([1, 2, 3]);
  await t.putChunk(4, wav);
  assert.deepEqual(seen.map((s) => [s.init.method, s.url]), [['POST', BASE + 'chunks/4'], ['PUT', upload]]);
  assert.equal(seen[1].init.body, wav);
  assert.equal((seen[1].init.headers as Record<string, string>)['content-type'], 'audio/wav');

  const bad = stubFetch(() => Response.json({ url: 'http://r2.example.com/put' }));
  await assert.rejects(httpTransport({ baseUrl: BASE, runId: 'r', key: KEY, fetch: bad.f }).putChunk(0, wav), TransportError);
  assert.equal(bad.seen.length, 1, 'nothing is sent to a plain-http URL');
});

test('3. an error carries the status only, never a URL; a non-https or unanchored base is refused', async () => {
  const { f } = stubFetch(() => new Response('boom https://axal.vc/secret', { status: 503 }));
  const t = httpTransport({ baseUrl: BASE, runId: 'r', key: KEY, fetch: f });
  const err = await t.status({ state: 'joining' }).catch((e) => e);
  assert.ok(err instanceof TransportError);
  assert.equal(err.status, 503);
  assert.equal(err.message, 'callback_503');

  const down = stubFetch(() => { throw new Error(`getaddrinfo ENOTFOUND ${BASE}`); });
  const e2 = await httpTransport({ baseUrl: BASE, runId: 'r', key: KEY, fetch: down.f }).status({ state: 'joining' }).catch((e) => e);
  assert.equal(e2.message, 'callback_0');

  assert.throws(() => httpTransport({ baseUrl: 'http://axal.vc/api/x/', runId: 'r', key: KEY }), TransportError);
  assert.throws(() => httpTransport({ baseUrl: 'https://axal.vc/api/x', runId: 'r', key: KEY }), TransportError);
});

test('4. safeFields keeps numbers, booleans and the bot\'s own codes, and drops every other string', () => {
  assert.deepEqual(safeFields({ state: 'recording', code: 'not_admitted', seq: 3, ok: true, url: 'https://zoom.us/j/1', name: 'Ada', reason: 'alone', nan: NaN, 'Bad-Key': 1 }),
    { state: 'recording', code: 'not_admitted', seq: 3, ok: true, reason: 'alone' });
  const lines: string[] = [];
  logLine((e) => lines.push(e), 'https://zoom.us/j/1');
  assert.deepEqual(lines, [], 'an event name that is not code-like is not written');
});

test('5. a whole run, with a passcode in the link and names in the roster, writes none of them to a log line', async () => {
  const LINK = 'https://us02web.zoom.us/j/81234567890?pwd=Zq9SECRETpass';
  const NAMES = ['Zelda Quixote', 'Bartholomew Yung'];
  const lines: string[] = [];
  const console0 = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    for (const variant of ['ok', 'adapter_throws'] as const) {
      const clock = new FakeClock();
      const cb = new StubCallback();
      cb.failChunk.set(0, 2);
      const a = new FakeAdapter({ platform: 'zoom', openDoor: true });
      if (variant === 'adapter_throws') a.join = async () => { throw new Error(`could not open ${LINK} for ${NAMES[0]}`); };
      a.arrive('u1', NAMES[0]); a.arrive('u2', NAMES[1]);
      const run = runBot({ runId: 'r', platform: 'zoom', meetingUrl: LINK, notice: 'n', limitMs: FREE_LIMIT_MS },
        { adapter: a, transport: cb, clock, log: (e, f) => lines.push(JSON.stringify({ e, ...f })) });
      await clock.advance(100);
      a.speak('u1'); a.say(tone(CHUNK_SAMPLES + 10)); a.depart('u2');
      await clock.advance(10_000);
      a.end();
      const r = await clock.until(run);
      if (variant === 'adapter_throws') assert.equal(r.code, 'platform_blocked');
      else assert.equal(r.reason, 'call_ended');
    }
    // A refusal raised with a message is reported by its code alone.
    assert.equal(new AdapterFailure('obf_unavailable').message, 'obf_unavailable');
  } finally {
    console.log = console0;
  }
  assert.ok(lines.length > 5, 'the run did log');
  const all = lines.join('\n');
  for (const needle of [LINK, 'Zq9SECRETpass', '81234567890', 'zoom.us/j', ...NAMES, 'Zelda', 'u1', 'u2']) {
    assert.ok(!all.includes(needle), `a log line carries ${needle}`);
  }
});
