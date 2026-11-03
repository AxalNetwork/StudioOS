/**
 * #3936 part 3 (owner answer C, A on 2026-11-02): interview, meeting and
 * data-room audio opts out of Deepgram's Model Improvement Program
 * (`mip_opt_out`), and is quoted, held and charged at the opt-out rate.
 * Every other recording keeps the default, and Whisper never carries the flag.
 * Synthetic audio only; the model is a stub.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deepgram_mip_opt_out_3936.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AI_SURFACE } from '../src/services/aiSurfaces.ts';
import {
  DEEPGRAM_LISTEN, FLUX, MIP_OPT_OUT_PRICE_FACTOR, MIP_OPT_OUT_SURFACES, NOVA_3, WHISPER_TURBO,
  audioInputFor, liveInputFor, mipOptOut, mipPriceFactor,
} from '../src/services/sttFormats.ts';
import { run, estimateCostUsd, PRICE_USD_PER_AUDIO_MINUTE, PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET, __resetForTest } from '../src/services/aiRouter.ts';
import { LIVE_SURFACE, blockQuoteMicro, holdBlock, openLiveRelay } from '../src/services/liveTranscription.ts';
import { pricePerMinute } from '../src/services/sttModels.ts';
import { usdToMicro, billedUsdToMicro } from '../src/services/aiBudget.ts';

test.afterEach(() => __resetForTest());

const OPTED = [AI_SURFACE.validateInterviews, AI_SURFACE.raiseDataRoom];
const NOT_OPTED = [AI_SURFACE.studio, AI_SURFACE.raisePitch, null, undefined, ''];
const CLIP = new Uint8Array([1, 2, 3, 4]);

test('the opted-out surfaces are interview (and meeting) audio and the data room, by their AI_SURFACE addresses', () => {
  assert.deepEqual([...MIP_OPT_OUT_SURFACES].sort(), [...OPTED].sort());
  assert.equal(LIVE_SURFACE, AI_SURFACE.validateInterviews, 'the live transcript is interview audio');
  assert.deepEqual([...DEEPGRAM_LISTEN].sort(), [FLUX, NOVA_3].sort());
});

test('mipOptOut: a Deepgram listen model on an opted-out surface, and nothing else', () => {
  // Mutations checked: the model check dropped (Whisper flagged); the surface check dropped (every page flagged).
  for (const s of OPTED) {
    assert.equal(mipOptOut(NOVA_3, s), true, s);
    assert.equal(mipOptOut(FLUX, s), true, s);
    assert.equal(mipOptOut(WHISPER_TURBO, s), false, `Whisper on ${s}`);
    assert.equal(mipPriceFactor(NOVA_3, s), MIP_OPT_OUT_PRICE_FACTOR);
    assert.equal(mipPriceFactor(WHISPER_TURBO, s), 1);
  }
  for (const s of NOT_OPTED) {
    assert.equal(mipOptOut(NOVA_3, s as any), false, String(s));
    assert.equal(mipPriceFactor(NOVA_3, s as any), 1);
  }
  assert.ok(MIP_OPT_OUT_PRICE_FACTOR > 1, 'the opt-out rate is the higher one');
});

test('the request bodies: Nova-3 batch carries mip_opt_out: true only when asked; a live socket carries "true"; Whisper never', () => {
  const on = audioInputFor(NOVA_3, CLIP, 'audio/webm', null, true);
  assert.equal(on.mip_opt_out, true);
  assert.equal(on.diarize, true, 'the rest of the body is unchanged');
  assert.ok(!('mip_opt_out' in audioInputFor(NOVA_3, CLIP, 'audio/webm', null, false)));
  assert.ok(!('mip_opt_out' in audioInputFor(NOVA_3, CLIP, 'audio/webm')));
  assert.ok(!('mip_opt_out' in audioInputFor(WHISPER_TURBO, CLIP, 'audio/webm', null, true)));
  assert.deepEqual(liveInputFor(NOVA_3, 'en', true), { encoding: 'linear16', sample_rate: '16000', language: 'en', mip_opt_out: 'true' });
  assert.deepEqual(liveInputFor(FLUX, null, true), { encoding: 'linear16', sample_rate: '16000', mip_opt_out: 'true' });
  assert.deepEqual(liveInputFor(NOVA_3, null, false), { encoding: 'linear16', sample_rate: '16000' });
});

function stubAI() {
  const calls: { model: string; payload: any }[] = [];
  return {
    calls,
    async run(model: string, payload: any) {
      calls.push({ model, payload });
      return { results: { channels: [{ alternatives: [{ transcript: 'Hello there.', words: [] }] }] } };
    },
  };
}
function funded() {
  const f = aiBudgetFixture();
  f.db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(4, 50_000_000);
  return f;
}

test('through run(): an interview or data-room transcription opts out and is charged the opt-out rate; Studio\'s does neither', async () => {
  // Mutations checked: the router not passing mipOptOut (the flag never reaches the binding); the charge at the published rate.
  for (const [surface, opted] of [[AI_SURFACE.validateInterviews, true], [AI_SURFACE.raiseDataRoom, true], [AI_SURFACE.studio, false]] as const) {
    const ai = stubAI();
    const f = funded();
    const e = { AI: withGuard(ai), DB: f.DB, ENVIRONMENT: 'development', AI_PARTNER_MODELS: 'on' } as any;
    const r: any = await run(e, { task: 'transcribe', userId: 4, surface, model: NOVA_3, audio: CLIP, audioMime: 'audio/webm', audioMinutes: 2 } as any);
    assert.equal(r.ok, true, `${surface}: ${JSON.stringify(r.refusal ?? r.error)}`);
    const call = ai.calls.find((c) => c.model === NOVA_3);
    assert.ok(call, `${surface}: Nova-3 was called`);
    assert.equal(call!.payload.mip_opt_out === true, opted, surface);
    const row = f.db.prepare('SELECT est_cost_usd, charged_microusd FROM ai_usage_logs WHERE model = ?').get(NOVA_3) as any;
    const usd = 2 * PRICE_USD_PER_AUDIO_MINUTE[NOVA_3] * (opted ? MIP_OPT_OUT_PRICE_FACTOR : 1);
    assert.ok(Math.abs(row.est_cost_usd - usd) < 1e-9, `${surface}: ${row.est_cost_usd} vs ${usd}`);
    assert.ok(row.charged_microusd >= usdToMicro(usd) - 1, `${surface}: charged ${row.charged_microusd}`);
  }
  assert.equal(estimateCostUsd(NOVA_3, 0, 0, 2), 2 * PRICE_USD_PER_AUDIO_MINUTE[NOVA_3], 'the default factor is 1');
});

test('the live transcript: its block is quoted at the opt-out rate, and its socket opens with mip_opt_out', async () => {
  // Mutation checked: openLiveRelay without the opt-out (the socket's options lack it); the block at the published rate.
  assert.equal(blockQuoteMicro(NOVA_3), billedUsdToMicro(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[NOVA_3] * MIP_OPT_OUT_PRICE_FACTOR * 4, 1));
  const f = aiBudgetFixture();
  f.db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(4, 50_000_000);
  const opened: any[] = [];
  const e: any = { DB: f.DB, ENVIRONMENT: 'development', AI: { run: async (model: string, input: any, o: any) => { opened.push({ model, input, o }); return {}; } } };
  const held = await holdBlock(e, 4, NOVA_3);
  assert.ok(held.ok);
  const res = await openLiveRelay(e, undefined, { id: 1, live_model: NOVA_3, language: 'en' } as any, 4, null, (held as any).reservation);
  assert.equal(res.status, 502, 'the stub opens no socket');
  assert.deepEqual(opened.map((x) => [x.model, x.input.mip_opt_out, x.o.websocket]), [[NOVA_3, 'true', true]]);
});

test('the session model list states the rate a session is charged: Deepgram at the opt-out rate, Whisper unchanged', () => {
  assert.equal(pricePerMinute(NOVA_3, 'final'), PRICE_USD_PER_AUDIO_MINUTE[NOVA_3] * MIP_OPT_OUT_PRICE_FACTOR);
  assert.equal(pricePerMinute(NOVA_3, 'live'), PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[NOVA_3] * MIP_OPT_OUT_PRICE_FACTOR);
  assert.equal(pricePerMinute(WHISPER_TURBO, 'final'), PRICE_USD_PER_AUDIO_MINUTE[WHISPER_TURBO]);
});
