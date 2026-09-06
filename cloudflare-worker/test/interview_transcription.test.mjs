/**
 * A recording, what it costs, and the two ways that could go wrong quietly.
 *
 * The router prices everything per million tokens. Whisper is billed per audio
 * MINUTE and has no token rate anywhere, so the obvious implementation — one
 * price table — makes a transcription cost **zero**. That is the exact failure
 * `ai_router_prices.test.mjs` exists for: *"a model in ROUTE with no price row
 * bills as zero, and a spend cap that counts zero never trips."* A founder
 * could transcribe all day against a cap that never moves.
 *
 * The second one is smaller and worse to find: a duration the client sends is a
 * number the client chooses. Billing on it means a caller can transcribe an
 * hour and report a minute.
 *
 * Run with:
 *   node --test cloudflare-worker/test/interview_transcription.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFile(resolve(__dirname, rel), 'utf8');
const router = () => read('../src/services/aiRouter.ts');
const routes = () => read('../src/routes/founder_validate.ts');

/** `estimateCostUsd` and its two tables, evaluated out of the source. */
async function costFn() {
  const src = await router();
  const tokenTable = src.slice(src.indexOf('export const PRICE_USD_PER_1M_TOKENS'));
  const audioTable = src.slice(src.indexOf('export const PRICE_USD_PER_AUDIO_MINUTE'));
  const tokens = {};
  for (const m of tokenTable.slice(0, tokenTable.indexOf('};')).matchAll(
    /'(@cf\/[^']+)':\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)/g)) {
    tokens[m[1]] = { in: Number(m[2]), out: Number(m[3]) };
  }
  const audio = {};
  for (const m of audioTable.slice(0, audioTable.indexOf('};')).matchAll(
    /'(@cf\/[^']+)':\s*([\d.]+)/g)) {
    audio[m[1]] = Number(m[2]);
  }
  // The function's own body, rebuilt from the two tables it reads.
  const est = (model, pIn, pOut, minutes = 0) => {
    const perMinute = audio[model];
    if (perMinute != null) return Math.max(0, minutes) * perMinute;
    const p = tokens[model];
    if (!p) return 0;
    return (pIn / 1e6) * p.in + (pOut / 1e6) * p.out;
  };
  return { est, tokens, audio };
}

test('a transcription does not cost zero', async () => {
  const { est, audio } = await costFn();
  const model = '@cf/openai/whisper-large-v3-turbo';
  assert.ok(audio[model], `${model} has no per-minute price`);
  // Whisper reports no tokens at all, so the token path would answer 0 for a
  // 44-minute interview — and a cap counting zero never trips.
  assert.equal(est(model, 0, 0, 0), 0, 'no audio is no cost');
  assert.ok(est(model, 0, 0, 44) > 0, 'a 44-minute clip must cost something');
  assert.ok(Math.abs(est(model, 0, 0, 44) - 0.022) < 1e-9,
    `44 minutes at $0.0005 is $0.022, got ${est(model, 0, 0, 44)}`);
});

test('the audio table does not disturb token pricing', async () => {
  const { est } = await costFn();
  // A token model asked with an audioMinutes argument must ignore it, or every
  // chat run would start billing for minutes it never used.
  const chat = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  assert.equal(est(chat, 1000, 500, 0), est(chat, 1000, 500, 99),
    'a token-priced model billed differently when handed audio minutes');
});

test('both Whisper models are priced, at the rate Cloudflare publishes', async () => {
  const { audio } = await costFn();
  // The base model is priced because `routes/advisor.ts`'s composer mic has
  // been calling it directly since that feature shipped; runs already recorded
  // against it still have to cost what they cost.
  assert.equal(audio['@cf/openai/whisper'], 0.0005);
  assert.equal(audio['@cf/openai/whisper-large-v3-turbo'], 0.0005);
});

test('minutes come from the bytes, never from the request', async () => {
  // A duration the client sends is a number the client chooses. Billing on it
  // means a caller transcribes an hour and reports a minute.
  const src = await router();
  const fn = src.slice(src.indexOf('export function audioMinutesFromBytes'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /ASSUMED_AUDIO_BITRATE_BPS/);
  assert.match(body, /Math\.max\(1, Math\.ceil\(/,
    'a clip shorter than a minute must still bill a minute — that is the unit');

  const r = await routes();
  const transcribe = r.slice(r.indexOf("founderValidate.post('/interviews/:id/transcribe'"));
  const handler = transcribe.slice(0, transcribe.indexOf('\n});') + 4);
  assert.match(handler, /audioMinutes: audioMinutesFromBytes\(Number\(row\.recording_size_bytes/,
    'the transcribe route bills on something other than the stored byte length');
  assert.doesNotMatch(handler, /duration_sec/,
    'the transcribe route reads a client-reported duration');
});

test('the upload derives its own key and admits only audio', async () => {
  const r = await routes();
  const upload = r.slice(r.indexOf("founderValidate.post('/interviews/:id/recording'"));
  const handler = upload.slice(0, upload.indexOf('\n});') + 4);

  // A caller-supplied key is a path-traversal write into another account's
  // prefix — the rule `routes/research.ts` states at its own upload.
  assert.match(handler, /const key = `validate-audio\/\$\{s\.user\.id\}\/\$\{crypto\.randomUUID\(\)\}/,
    'the R2 key is not derived server-side');
  assert.doesNotMatch(handler, /form\.get\('key'\)|body\.key/, 'the route reads a key from the request');

  // An allowlist, not a prefix test: `audio/*` admits anything a client cares
  // to label, and the model has to decode it.
  assert.match(handler, /AUDIO_MIME\[mime\]/);
  assert.doesNotMatch(handler, /startsWith\('audio\//, 'a prefix check is not an allowlist');
  assert.match(handler, /415/, 'an unsupported type must be refused, not stored');
  assert.match(handler, /MAX_RECORDING_BYTES/);
  assert.match(handler, /413/);
});

test('a stored key outside the feature prefix is never read', async () => {
  // `services/r2.ts` states this at each of its getters: never read outside the
  // prefix this feature owns, whatever the stored key says.
  const r = await routes();
  const transcribe = r.slice(r.indexOf("founderValidate.post('/interviews/:id/transcribe'"));
  const handler = transcribe.slice(0, transcribe.indexOf('\n});') + 4);
  assert.match(handler, /startsWith\('validate-audio\/'\)/,
    'the transcribe route reads whatever key the row holds');
  assert.ok(handler.indexOf("startsWith('validate-audio/')") < handler.indexOf('FILES.get'),
    'the prefix guard must come before the read, not after');
});

test('an empty transcript is stored as an answer, not left as absent', async () => {
  // Silence transcribes to an empty string. NULL means never transcribed; ''
  // means transcribed and there was no speech. Folding them together offers
  // "Transcribe" forever on a silent clip, and charges for it each time.
  const r = await routes();
  const transcribe = r.slice(r.indexOf("founderValidate.post('/interviews/:id/transcribe'"));
  const handler = transcribe.slice(0, transcribe.indexOf('\n});') + 4);
  assert.match(handler, /const text = r\.output \?\? '';/,
    'an empty result must be stored, not skipped');
  assert.doesNotMatch(handler, /if \(!text\) return/, 'an empty transcript is being treated as a failure');
  // And the model that produced it is recorded, because the router falls back
  // to a smaller sibling under load.
  assert.match(handler, /transcribed_by_model = \?/);
  assert.match(handler, /\.bind\(text, r\.usage\.model, id\)/);
});

test('the advisor mic is metered now, and calls no model directly', async () => {
  // It bypassed the router for as long as it existed: no per-user cap, no org
  // kill switch, no fallback, and no row in `ai_usage_logs` — so every
  // transcription a user ran was invisible to the spend meter that claims to
  // show what they have spent.
  const advisor = await read('../src/routes/advisor.ts');
  const post = advisor.slice(advisor.indexOf("advisor.post('/transcribe'"));
  const handler = post.slice(0, post.indexOf('\n});') + 4);
  assert.match(handler, /aiRouterRun\(c\.env, \{\s*\n\s*task: 'transcribe'/,
    'the advisor mic still calls the model directly');
  assert.doesNotMatch(handler, /AI\.run\(/, 'a direct env.AI.run survives in the mic handler');
  assert.doesNotMatch(advisor, /TRANSCRIBE_MODEL/, 'the hardcoded model constant survives');
  assert.match(handler, /audioMinutes: audioMinutesFromBytes\(bytes\.byteLength\)/);
  // A refusal keeps the shape its caller has always read.
  assert.match(handler, /error: 'transcribe_failed'/);
  assert.match(handler, /refusal: r\.refusal/);
});

test('transcribe offers no model choice, and says why', async () => {
  const src = await router();
  const body = src.slice(src.indexOf('export const ROUTE'));
  const entries = [...body.matchAll(/^ {2}([a-z_]+):\s*\{/gm)];
  const i = entries.findIndex((e) => e[1] === 'transcribe');
  assert.ok(i >= 0, 'transcribe is not a ROUTE entry');
  const to = i + 1 < entries.length ? entries[i + 1].index : body.length;
  const entry = body.slice(entries[i].index, to);
  // Two models at one price with no meaningful difference is a control that
  // cannot change anything — D13's own objection to the original menu.
  assert.doesNotMatch(entry, /alternates/, 'transcribe offers a choice between equals');
  assert.doesNotMatch(entry, /fallbackChain/,
    'a fallback between two models at one price doubles the bill for a clip that fails twice');
  assert.match(entry, /isAudio: true/);
  assert.doesNotMatch(entry, /cacheTtlSec/,
    'a cached transcription would return one clip\'s words for another');
});
