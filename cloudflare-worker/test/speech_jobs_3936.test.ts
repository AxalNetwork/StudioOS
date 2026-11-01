/**
 * #3936 (D1478 task 2, part 1): the speech jobs' model choice, the captions
 * job, smart-turn's price, the Speak quote, and Record a Session's Listen row.
 * Pure where it can be; the quote goes through `quoteRun` with no member, so
 * it reads no database. The model is never called.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/speech_jobs_3936.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MELOTTS, OPUS_REFUSAL, SPEECH_JOBS, SPEECH_JOB_STEPS, WALKTHROUGH_CAPTIONS, captionsOf, speechBlock, speechChoice, speechJob,
} from '../src/services/ai/speechJobs.ts';
import { modelById } from '../src/services/ai/catalogue.ts';
import { parseAudioOutput } from '../src/services/sttFormats.ts';
import { PRICE_USD_PER_1K_CHARACTERS, PRICE_USD_PER_AUDIO_MINUTE, estimateCostUsd, quoteRun } from '../src/services/aiRouter.ts';
import { speakRequest, speakRefusal, speechMime } from '../src/services/ai/shapes.ts';
import { costMicro, unitPrice } from '../src/services/ai/pricing.ts';

const ON = { AI_PARTNER_MODELS: 'on' } as any;
const OFF = { AI_PARTNER_MODELS: 'off' } as any;
const AURA_EN = '@cf/deepgram/aura-2-en';
const TURBO = '@cf/openai/whisper-large-v3-turbo';
const SPEAK_JOBS = Object.keys(SPEECH_JOB_STEPS).filter((id) => speechJob(id)?.kind === 'speak');

test('every speech job names a job step of the plan, of a speech kind', () => {
  assert.equal(SPEECH_JOBS.length, Object.keys(SPEECH_JOB_STEPS).length);
  for (const id of Object.keys(SPEECH_JOB_STEPS)) {
    assert.ok(['listen_file', 'listen_live', 'speak', 'turn_taking'].includes(speechJob(id)!.kind), id);
  }
  assert.equal(speechJob('ST1'), null, 'a text job is not a speech job');
  assert.deepEqual(speechChoice('ST1', { switches: ON, tier: 'paid' }), { ok: false, code: 'press_hidden', job: 'ST1', message: 'This press has no speech job.' });
});

test('MeloTTS answers every Speak job while the gate is off, and on a free plan; GR9 refuses it (Opus in Ogg)', () => {
  assert.ok(SPEAK_JOBS.length >= 8, `${SPEAK_JOBS.length} speak jobs`);
  for (const id of SPEAK_JOBS) {
    for (const ctx of [{ switches: OFF, tier: 'paid' as const }, { switches: ON, tier: 'free' as const }]) {
      const c = speechChoice(id, ctx);
      if (id === 'GR9') {
        assert.deepEqual(c, { ok: false, code: 'press_hidden', job: 'GR9', message: OPUS_REFUSAL }, `GR9 ${ctx.switches.AI_PARTNER_MODELS} ${ctx.tier}`);
        continue;
      }
      assert.ok(c.ok, `${id} ${JSON.stringify(ctx)} ${JSON.stringify(c)}`);
      assert.equal(c.ok && c.model, MELOTTS, id);
    }
  }
  // With the gate on and a paid plan, the Default answers: an Aura voice where the plan names one.
  const ar5 = speechChoice('AR5', { switches: ON, tier: 'paid' });
  assert.deepEqual(ar5, { ok: true, model: AURA_EN, source: 'default', job: 'AR5', skipped: null });
  const gr9 = speechChoice('GR9', { switches: ON, tier: 'paid' });
  assert.equal(gr9.ok && gr9.model, AURA_EN);
  // ST7's Default is MeloTTS itself.
  assert.deepEqual(speechChoice('ST7', { switches: OFF, tier: 'free' }), { ok: true, model: MELOTTS, source: 'default', job: 'ST7', skipped: null });
  // The receipt says why the Default did not run.
  const off = speechChoice('AR5', { switches: OFF, tier: 'paid' });
  assert.deepEqual(off.ok && off.skipped, { model: AURA_EN, reason: 'not_offered' });
  const free = speechChoice('AR5', { switches: ON, tier: 'free' });
  assert.deepEqual(free.ok && free.skipped, { model: AURA_EN, reason: 'plan_locked' });
  assert.equal(free.ok && free.source, 'fallback');
  // The guarantee rests on the table: every Speak job but GR9 has MeloTTS as its Default or fallback.
  for (const id of SPEAK_JOBS.filter((x) => x !== 'GR9')) {
    const j = speechJob(id)!;
    assert.ok(j.default === MELOTTS || j.fallback === MELOTTS, `${id} cannot fall back to MeloTTS`);
  }
});

test('a named voice the plan locks is refused, never swapped; one the press does not list is refused', () => {
  const locked = speechChoice('AR5', { switches: ON, tier: 'free', caller: AURA_EN });
  assert.equal(locked.ok, false);
  assert.equal(!locked.ok && locked.code, 'plan_locked');
  const unlisted = speechChoice('AR5', { switches: ON, tier: 'paid', caller: TURBO });
  assert.equal(!unlisted.ok && unlisted.code, 'model_not_offered');
  const picked = speechChoice('AR5', { switches: ON, tier: 'paid', pick: MELOTTS });
  assert.deepEqual(picked, { ok: true, model: MELOTTS, source: 'pick', job: 'AR5', skipped: null });
  // A stored pick the job no longer lists reads as none.
  const stale = speechChoice('AR5', { switches: ON, tier: 'paid', pick: TURBO });
  assert.equal(stale.ok && stale.source, 'default');
  assert.equal(!speechChoice('GR9', { switches: ON, tier: 'paid', caller: MELOTTS }).ok, true, 'GR9 never takes MeloTTS, even named');
});

test('Listen jobs take a model that transcribes their way: a file per minute, a live stream per WebSocket minute', () => {
  const va1 = speechChoice('VA1', { switches: OFF, tier: 'free' });
  assert.deepEqual(va1, { ok: true, model: TURBO, source: 'default', job: 'VA1', skipped: null });
  const va2 = speechChoice('VA2', { switches: ON, tier: 'free' });
  assert.equal(va2.ok && va2.model, '@cf/deepgram/flux', 'the live Default streams');
  assert.equal(speechChoice('VA2', { switches: ON, tier: 'paid', caller: TURBO }).ok, false, 'a batch model cannot listen live');
  // A model of the wrong kind is never offered, even where a list would name it.
  const ctx = { switches: ON, tier: 'paid' as const };
  assert.equal(speechBlock('VA2', speechJob('VA2')!, TURBO, ctx), 'not_offered', 'batch-only, under a live job');
  assert.equal(speechBlock('VA1', speechJob('VA1')!, '@cf/deepgram/flux', ctx), 'not_offered', 'live-only, under a file job');
  assert.equal(speechBlock('ST7', speechJob('ST7')!, TURBO, ctx), 'not_offered', 'a listener under a Speak job');
  assert.equal(speechBlock('VA1', speechJob('VA1')!, '@cf/deepgram/nova-3', ctx), null, 'Nova-3 has a batch price');
  assert.equal(speechBlock('VA2', speechJob('VA2')!, '@cf/deepgram/nova-3', ctx), null, 'and a live one');
  const turn = speechChoice('ST11', { switches: OFF, tier: 'free' });
  assert.equal(turn.ok && turn.model, '@cf/pipecat-ai/smart-turn-v2');
});

test('the walkthrough-captions job (F11) is the DK11 class and returns timestamps', () => {
  assert.equal(WALKTHROUGH_CAPTIONS, 'DK11C');
  const job = speechJob(WALKTHROUGH_CAPTIONS)!;
  assert.deepEqual([job.id, job.kind], ['DK11', 'listen_file']);
  const c = speechChoice(WALKTHROUGH_CAPTIONS, { switches: OFF, tier: 'free' });
  assert.equal(c.ok && c.model, TURBO);
  const t = parseAudioOutput(TURBO, { text: 'Welcome. This is the deck.', segments: [{ start: 0, end: 1.5, text: ' Welcome.' }, { start: 1.5, end: 3.25, text: ' This is the deck.' }, { start: 4, end: 3, text: 'bad' }, { text: 'no time' }] });
  assert.deepEqual(captionsOf(t), [{ start_ms: 0, end_ms: 1500, text: 'Welcome.' }, { start_ms: 1500, end_ms: 3250, text: 'This is the deck.' }]);
  assert.deepEqual(captionsOf(null), []);
});

test('smart-turn is billed at the dollar figure, $0.00033795 a minute (answer F)', () => {
  assert.equal(PRICE_USD_PER_AUDIO_MINUTE['@cf/pipecat-ai/smart-turn-v2'], 0.00033795);
  assert.equal(modelById('@cf/pipecat-ai/smart-turn-v2')!.prices.audio_minutes, '0.00033795');
  assert.ok(Math.abs(estimateCostUsd('@cf/pipecat-ai/smart-turn-v2', 0, 0, 60) - 0.020277) < 1e-9, 'an hour of turn detection');
  assert.equal(costMicro('@cf/pipecat-ai/smart-turn-v2', { audio_minutes: 100 }), 33795, 'the run settles at the dollar figure too');
  assert.equal(unitPrice('@cf/myshell-ai/melotts', 'audio_minutes'), '0.00020493', 'other models keep their neuron price');
});

test('the Speak quote is per 1,000 characters: an Aura voice costs its catalogue rate per thousand', async () => {
  // The neuron-derived figure: within a millionth of a dollar of the printed $0.030 and $0.015.
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  near(PRICE_USD_PER_1K_CHARACTERS[AURA_EN], 0.03);
  near(estimateCostUsd(AURA_EN, 0, 0, 0, 0, 1000), PRICE_USD_PER_1K_CHARACTERS[AURA_EN]);
  near(estimateCostUsd(AURA_EN, 0, 0, 0, 0, 2000), 2 * PRICE_USD_PER_1K_CHARACTERS[AURA_EN]);
  near(estimateCostUsd('@cf/deepgram/aura-1', 0, 0, 0, 0, 1000), 0.015);
  // The quote runs the job's choice and names it on the receipt.
  const text = 'a'.repeat(1000);
  const q = await quoteRun(OFF, { task: 'module_voice' as any, userId: 0, text, speak: {}, speechJob: 'AR5' });
  assert.deepEqual(q.ok && [q.model, q.speech], [MELOTTS, { job: 'AR5', source: 'fallback', skipped: { model: AURA_EN, reason: 'not_offered' } }]);
  const gr9 = await quoteRun(OFF, { task: 'module_voice' as any, userId: 0, text, speak: { format: 'opus_ogg' }, speechJob: 'GR9' });
  assert.deepEqual(gr9.ok ? 'ran' : [gr9.refusal, gr9.error], ['model_not_offered', OPUS_REFUSAL]);
});

test('Opus in Ogg is asked of Aura only; MeloTTS makes MP3 and refuses it; Ogg bytes read as audio/ogg', () => {
  assert.deepEqual(speakRequest(AURA_EN, 'hi', { format: 'opus_ogg' }), { text: 'hi', encoding: 'opus', container: 'ogg' });
  assert.deepEqual(speakRequest(AURA_EN, 'hi', {}), { text: 'hi', encoding: 'mp3' });
  assert.equal(speakRequest(MELOTTS, 'hi', { format: 'opus_ogg' }), null);
  assert.deepEqual(speakRequest(MELOTTS, 'hi', { lang: 'en' }), { prompt: 'hi', lang: 'en' });
  assert.equal(speakRefusal({ format: 'wav' as any }, 'hi'), 'the format is opus_ogg or none');
  assert.equal(speakRefusal({ format: 'opus_ogg' }, 'hi'), null);
  assert.equal(speechMime(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0])), 'audio/ogg');
  assert.equal(speechMime(new Uint8Array([0x49, 0x44, 0x33, 0])), 'audio/mpeg');
});

test('Record a Session lists no text model: every Listen row of the rail matrix is speech models only', () => {
  const matrix = JSON.parse(readFileSync(new URL('../src/services/ai/railMatrix.json', import.meta.url), 'utf8'));
  const listen = [...matrix.rows, ...matrix.options].filter((r: any) => r.kind === 'speech');
  assert.ok(listen.some((r: any) => r.pageKey === 'Founder · Validate · Customer research'));
  for (const r of listen) {
    for (const m of [...r.models, ...(r.more ?? [])]) {
      assert.equal(modelById(m.id)?.kind, 'Automatic Speech Recognition', `${r.pageKey} ${r.optionKey ?? ''} lists ${m.id}`);
    }
  }
});
