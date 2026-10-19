/**
 * D756 (#1896) — the shared pieces of a chat's recordings, without a provider:
 *   · `sniffAudioContainer`: each container from its own first bytes; ADTS AAC,
 *     a short file and `ftyp` at the wrong offset are 'unknown'.
 *   · `normaliseAudioMime`, `audioMimeAdmitted`, `admitAudio`: the recorder's
 *     types, aliases resolved, and the declared type must match the bytes.
 *   · `boundedDownload`: https only, the status of a refusal, a body over the
 *     cap never read or cancelled mid-read, an empty body, the container on
 *     success, no `console` on any path, and one 30 s deadline over the
 *     headers and the body that aborts the fetch.
 *   · `fetchTelegramVoice` on a body that never ends is a retryable network
 *     failure.
 * Every fetch is a stub; nothing reaches a provider.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/channel_audio_d756.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROVIDER_DOWNLOAD_MS, boundedDownload, sniffAudioContainer, type AudioContainer,
} from '../src/services/channels/providerHttp.ts';
import { CHANNEL_AUDIO_MAX_BYTES, admitAudio, audioMimeAdmitted, normaliseAudioMime } from '../src/services/channels/channelAudio.ts';
import { fetchTelegramVoice } from '../src/services/channels/telegram.ts';
import { MAX_CHUNK_BYTES } from '../src/services/interviewSessions.ts';
import { AUDIO } from './_channels_fixture.ts';

const URL_OK = 'https://files.example.test/f/abc';
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Stub fetch for one test; every console method is captured. */
function stub(t: any, answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; signal: AbortSignal | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, signal: (init.signal as AbortSignal) ?? null });
    return answer(url, init);
  }) as typeof fetch;
  const logged: string[] = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) t.mock.method(console, m, (...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
  t.after(() => { globalThis.fetch = original; });
  return { calls, logged };
}
function counted(total: number, chunk = 64 * 1024) {
  const state = { pulls: 0, cancelled: false, sent: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      state.pulls += 1;
      if (state.sent >= total) { c.close(); return; }
      const n = Math.min(chunk, total - state.sent);
      state.sent += n;
      c.enqueue(new Uint8Array(n).fill(1));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state };
}

/** providerHttp.ts re-executed with one regression; its one dependency stays real. */
let mutation = 0;
async function mutant(before: string, after: string) {
  const file = new URL('../src/services/channels/providerHttp.ts', import.meta.url);
  const original = readFileSync(file, 'utf8');
  assert.ok(original.includes(before), `mutation target must exist: ${before}`);
  const { stripTypeScriptTypes } = await import('node:module');
  let source = stripTypeScriptTypes(original.replace(before, after), { mode: 'strip' });
  source = source.replace("from '../../util/deadline'", `from '${new URL('../src/util/deadline.ts', import.meta.url).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(`${source}\n// mutant ${++mutation}`).toString('base64'));
}

test('D756 sniffAudioContainer names each container from its first bytes', () => {
  const want: [keyof typeof AUDIO, AudioContainer][] = [
    ['OGG', 'ogg'], ['MP3_ID3', 'mpeg'], ['MP3_SYNC', 'mpeg'], ['ADTS', 'unknown'], ['WAV', 'wav'],
    ['M4A', 'mp4'], ['WEBM', 'webm'], ['JUNK', 'unknown'],
  ];
  for (const [name, container] of want) assert.equal(sniffAudioContainer(AUDIO[name]), container, name);
  assert.equal(sniffAudioContainer(new Uint8Array([0x4f, 0x67, 0x67])), 'unknown', 'three bytes');
  assert.equal(sniffAudioContainer(new TextEncoder().encode('ftypM4A 0000')), 'unknown', 'ftyp at offset 0');
});

test('D756 normaliseAudioMime and audioMimeAdmitted: the recorder\'s types, aliases resolved', () => {
  assert.equal(normaliseAudioMime('Audio/OGG; codecs=opus'), 'audio/ogg');
  assert.equal(normaliseAudioMime('audio/x-m4a'), 'audio/mp4');
  assert.equal(normaliseAudioMime('audio/mp3'), 'audio/mpeg');
  for (const raw of ['', '   ', null, undefined, 42, {}]) assert.equal(normaliseAudioMime(raw), null, String(raw));
  for (const ok of ['audio/ogg', 'audio/mpeg', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm']) assert.equal(audioMimeAdmitted(ok), true, ok);
  for (const no of ['audio/aac', 'audio/flac', 'audio/opus', 'video/mp4', 'application/pdf', '', null]) assert.equal(audioMimeAdmitted(no), false, String(no));
  assert.equal(CHANNEL_AUDIO_MAX_BYTES, MAX_CHUNK_BYTES, "the recorder's chunk");
});

test('D756 admitAudio: the declared type must match the container; with none, the container names it', () => {
  const containers: AudioContainer[] = ['ogg', 'mpeg', 'wav', 'mp4', 'webm', 'unknown'];
  const declared: (string | null)[] = [null, 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/aac', 'video/mp4'];
  const expect = (d: string | null, c: AudioContainer): string | null => {
    if (c === 'unknown') return null;
    const n = normaliseAudioMime(d);
    const fits: Record<string, string[]> = { ogg: ['audio/ogg'], mpeg: ['audio/mpeg'], wav: ['audio/wav', 'audio/x-wav'], mp4: ['audio/mp4'], webm: ['audio/webm'] };
    if (n === null) return fits[c][0];
    return fits[c].includes(n) ? n : null;
  };
  let admitted = 0;
  for (const c of containers) for (const d of declared) {
    const got = admitAudio(d, c);
    const want = expect(d, c);
    if (want) { admitted += 1; assert.deepEqual(got, { ok: true, mime: want }, `${d} in ${c}`); }
    else assert.deepEqual(got, { ok: false, code: 'unsupported_format' }, `${d} in ${c}`);
  }
  assert.equal(admitted, 13, 'five containers with no declared type, and eight matches');
});

test('D756 boundedDownload: https only, a refusal\'s status, a body over the cap never read or cancelled, empty, success; never a log', async (t) => {
  const s = stub(t, (url) => {
    if (url.endsWith('/404')) return new Response('nope', { status: 404 });
    if (url.endsWith('/declared')) return new Response(counted(10_000).stream, { headers: { 'content-length': '10000' } });
    if (url.endsWith('/empty')) return new Response(new Uint8Array(0));
    if (url.endsWith('/ok')) return new Response(AUDIO.WAV);
    throw new Error(`unexpected ${url}`);
  });
  assert.deepEqual(await boundedDownload('http://files.example.test/x', { maxBytes: 100 }), { ok: false, code: 'bad_url', status: 0 });
  assert.deepEqual(await boundedDownload('not a url', { maxBytes: 100 }), { ok: false, code: 'bad_url', status: 0 });
  assert.equal(s.calls.length, 0, 'nothing fetched for a bad URL');
  assert.deepEqual(await boundedDownload(`${URL_OK}/404`, { maxBytes: 100 }), { ok: false, code: 'http', status: 404 });
  assert.deepEqual(await boundedDownload(`${URL_OK}/declared`, { maxBytes: 100 }), { ok: false, code: 'too_large', status: 200 });
  assert.deepEqual(await boundedDownload(`${URL_OK}/empty`, { maxBytes: 100 }), { ok: false, code: 'empty_file', status: 200 });
  const ok = await boundedDownload(`${URL_OK}/ok`, { maxBytes: 4000 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && [ok.bytes.byteLength, ok.container], [4000, 'wav']);
  assert.deepEqual(s.logged, [], 'boundedDownload never logs');
});

test('D756 boundedDownload: content-length over the cap reads nothing; a stream over it is cancelled; a thrown fetch is network', async (t) => {
  const declared = counted(10 * 1024 * 1024);
  const open = counted(10 * 1024 * 1024);
  stub(t, (url) => {
    if (url.endsWith('/declared')) return new Response(declared.stream, { headers: { 'content-length': String(10 * 1024 * 1024) } });
    if (url.endsWith('/open')) return new Response(open.stream);
    throw new TypeError('fetch failed https://files.example.test/secret-path');
  });
  assert.deepEqual(await boundedDownload(`${URL_OK}/declared`, { maxBytes: MAX_CHUNK_BYTES }), { ok: false, code: 'too_large', status: 200 });
  assert.equal(declared.state.pulls, 0, 'not one chunk read');
  assert.deepEqual(await boundedDownload(`${URL_OK}/open`, { maxBytes: MAX_CHUNK_BYTES }), { ok: false, code: 'too_large', status: 200 });
  assert.equal(open.state.cancelled, true);
  assert.ok(open.state.sent <= MAX_CHUNK_BYTES + 64 * 1024, 'stopped one chunk past the cap');
  const thrown = await boundedDownload(`${URL_OK}/throws`, { maxBytes: 100 });
  assert.deepEqual(thrown, { ok: false, code: 'network', status: 0 });
  assert.equal(JSON.stringify(thrown).includes('secret-path'), false, 'the error\'s text is never returned');
});

/** A body that sends one chunk and never ends (or headers that never come), against the deadline. */
async function hang(t: any, phase: 'headers' | 'body', download: typeof boundedDownload = boundedDownload, ms = PROVIDER_DOWNLOAD_MS) {
  const s = stub(t, () => {
    if (phase === 'headers') return new Promise<Response>(() => {});
    return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(AUDIO.OGG); } }));
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  let settled: any = null;
  const pending = download(URL_OK, { maxBytes: MAX_CHUNK_BYTES }).then((r: any) => { settled = r; });
  await turn(); await turn();
  t.mock.timers.tick(ms - 1);
  await turn(); await turn();
  const early = settled;
  t.mock.timers.tick(1);
  for (let i = 0; i < 10 && !settled; i++) await turn();
  return { early, settled, aborted: s.calls[0]?.signal?.aborted === true, pending, logged: s.logged };
}

test('D756 boundedDownload: one 30 s deadline over the headers and the streamed body, and the fetch is aborted', async (t) => {
  for (const phase of ['headers', 'body'] as const) {
    await t.test(phase, async (tt) => {
      const r = await hang(tt, phase);
      assert.equal(r.early, null, 'unsettled at 29,999 ms');
      assert.deepEqual(r.settled, { ok: false, code: 'timeout', status: 0 }, 'settled at 30,000 ms');
      assert.equal(r.aborted, true, 'the fetch is aborted');
      assert.deepEqual(r.logged, []);
    });
  }
});

test('D756 fetchTelegramVoice: a file body that never ends is a retryable network failure, logged as a code', async (t) => {
  const s = stub(t, (url) => {
    if (url.endsWith('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_id: 'F', file_size: 4000, file_path: 'voice/f.oga' } }));
    return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(AUDIO.OGG); } }));
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  let settled: any = null;
  fetchTelegramVoice({ TELEGRAM_CHANNEL_BOT_TOKEN: '123:tok-SECRET' } as any, { file: 'F', mime: 'audio/ogg', media: 'voice', size: 4000 })
    .then((r) => { settled = r; });
  for (let i = 0; i < 6 && s.calls.length < 2; i++) await turn();
  assert.equal(s.calls.length, 2, 'getFile, then the file');
  t.mock.timers.tick(PROVIDER_DOWNLOAD_MS);
  for (let i = 0; i < 10 && !settled; i++) await turn();
  assert.deepEqual(settled, { ok: false, code: 'network', retryable: true });
  assert.deepEqual(s.logged, ['[channels] telegram file download failed code=timeout status=0']);
});

test('D756 mutations: the deadline, its length, the abort, the running count and a logged URL are each caught', async (t) => {
  await t.test('no withDeadline', async (tt) => {
    // withDeadline swapped for a function that hands back the work unbounded.
    const m = await mutant('return await withDeadline((async (): Promise<Download> => {', 'return await ((work: Promise<Download>) => work)((async (): Promise<Download> => {');
    const r = await hang(tt, 'body', m.boundedDownload);
    assert.equal(r.settled, null, 'without the deadline a hung body is never refused');
  });
  await t.test('the deadline one millisecond short', async (tt) => {
    const m = await mutant('export const PROVIDER_DOWNLOAD_MS = 30_000;', 'export const PROVIDER_DOWNLOAD_MS = 29_999;');
    const r = await hang(tt, 'body', m.boundedDownload, PROVIDER_DOWNLOAD_MS);
    assert.notEqual(r.early, null, 'it settles before 30,000 ms');
  });
  await t.test('no abort', async (tt) => {
    const m = await mutant("'network', status: 0 };\n  } finally {\n    controller.abort();\n  }", "'network', status: 0 };\n  } finally {\n  }");
    const r = await hang(tt, 'headers', m.boundedDownload);
    assert.equal(r.aborted, false, 'the fetch would keep running');
  });
  await t.test('no running count', async (tt) => {
    const m = await mutant('if (total > opts.maxBytes) {', 'if (false) {');
    const open = counted(MAX_CHUNK_BYTES + 128 * 1024);
    stub(tt, () => new Response(open.stream));
    const r = await m.boundedDownload(URL_OK, { maxBytes: MAX_CHUNK_BYTES });
    assert.equal(r.ok, true, 'without it the whole file is read');
  });
  await t.test('a logged URL', async (tt) => {
    const m = await mutant("      const res = await fetch(url, { ...(opts.init ?? {}), signal: controller.signal });",
      "      console.error(url);\n      const res = await fetch(url, { ...(opts.init ?? {}), signal: controller.signal });");
    const s = stub(tt, () => new Response(AUDIO.OGG));
    await m.boundedDownload(URL_OK, { maxBytes: MAX_CHUNK_BYTES });
    assert.deepEqual(s.logged, [URL_OK], 'the never-logs check (an empty log) sees it');
  });
});
