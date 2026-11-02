/**
 * #3936 (D1478 task 2, part 2): the live transcript takes run()'s hold, guard
 * and settle.
 *
 *  · a block's hold is its minutes plus the guard's share of its text;
 *  · the stream's final text (its live passages) goes through the output
 *    guard; safe keeps the draft, unsafe removes it ("guard_blocked"), and a
 *    guard that cannot answer removes it too ("guard_unavailable");
 *  · the settle charges the minutes and the guard's calls against the holds,
 *    and writes one `ai_usage_logs` row on Interviews' surface with the
 *    guard's rows naming it;
 *  · the live model follows Record a Session's live job (VA2): a model the job
 *    does not list, cannot stream, or the plan locks is refused before any socket opens.
 * Synthetic records only; the model and the guard are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/live_transcription_guard_3936.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { GUARD_MODEL } from './_guard_stub.mjs';
import { __resetForTest, PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET } from '../src/services/aiRouter.ts';
import { LIVE_JOB, blockGuardMicro, blockHoldMicro, blockQuoteMicro, holdBlock, liveChoice, settleStream } from '../src/services/liveTranscription.ts';
import { usdToMicro } from '../src/services/aiBudget.ts';

const NOVA = '@cf/deepgram/nova-3';
const FLUX = '@cf/deepgram/flux';
const ON = { AI_PARTNER_MODELS: 'on' } as any;
const OFF = { AI_PARTNER_MODELS: 'off' } as any;
const MEMBER = 4;

function world(guard: 'safe' | 'unsafe' | 'down') {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(MEMBER, 50_000_000);
  f.db.exec(`CREATE TABLE interview_transcript_segments (id INTEGER PRIMARY KEY, session_id INTEGER, source TEXT, start_ms INTEGER, end_ms INTEGER,
      speaker_label TEXT, speaker_raw TEXT, text TEXT, model TEXT);
    CREATE TABLE interview_session_receipts (id INTEGER PRIMARY KEY, session_id INTEGER, kind TEXT, model TEXT, requested_model TEXT,
      fallback_used INTEGER, audio_minutes REAL, cost_microusd INTEGER, outcome TEXT, refusal TEXT);`);
  const seg = f.db.prepare("INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, text, model) VALUES (1, 'live', ?, ?, ?, ?)");
  seg.run(0, 4000, 'We lose a day closing the books every month.', NOVA);
  seg.run(4000, 9000, 'Reconciliation is all spreadsheets.', NOVA);
  const guardCalls: string[] = [];
  const AI = {
    run: async (model: string, input: any) => {
      if (model !== GUARD_MODEL) throw new Error(`no model but the guard is called at settle, not ${model}`);
      guardCalls.push(`${input?.messages?.at(-1)?.role}: ${String(input?.messages?.at(-1)?.content ?? '')}`);
      if (guard === 'down') throw new Error('guard unavailable');
      return { response: guard === 'safe' ? 'safe' : 'unsafe\nS1', usage: { prompt_tokens: 300, completion_tokens: 2 } };
    },
  };
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', AI };
  const session: any = { id: 1, created_by_user_id: MEMBER };
  const rows = () => f.db.prepare('SELECT id, task, model, surface, user_id, charged_microusd, guard_for, units_json, safety_score FROM ai_usage_logs ORDER BY id').all() as any[];
  const drafts = () => (f.db.prepare("SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE source = 'live'").get() as any).n;
  const receipt = () => f.db.prepare('SELECT * FROM interview_session_receipts').get() as any;
  const reservations = () => f.db.prepare('SELECT status, actual_included_microusd + actual_topup_microusd AS charged FROM ai_budget_reservations').all() as any[];
  return { f, env, session, rows, drafts, receipt, reservations, guardCalls };
}

test('a block holds its minutes and the guard\'s share of the text it can produce', async () => {
  const w = world('safe');
  try {
    assert.equal(blockHoldMicro(NOVA), blockQuoteMicro(NOVA) + blockGuardMicro());
    assert.ok(blockGuardMicro() > 0);
    const h = await holdBlock(w.env, MEMBER, NOVA);
    assert.equal(h.ok, true);
    const [r] = w.f.db.prepare('SELECT included_microusd + topup_microusd AS held FROM ai_budget_reservations').all() as any[];
    assert.equal(r.held, blockHoldMicro(NOVA));
  } finally { w.f.db.close(); }
});

test('safe: the draft stays; one stream row on Interviews\' surface, the guard\'s rows name it, minutes and guard settle against the hold', async () => {
  const w = world('safe');
  try {
    const h = await holdBlock(w.env, MEMBER, NOVA);
    assert.equal(h.ok, true);
    const out = await settleStream(w.env, w.session, NOVA, [(h as any).reservation], 90_000);
    assert.equal(out.guard, 'passed');
    assert.equal(w.guardCalls.length, 1, 'the final text is checked');
    assert.match(w.guardCalls[0], /^assistant: .*closing the books/, 'checked as output: the transcript is what the model said');
    assert.equal(w.drafts(), 2, 'the draft stays');
    const [stream, ...guards] = w.rows();
    assert.deepEqual([stream.task, stream.model, stream.surface, stream.user_id, stream.guard_for, stream.safety_score], ['transcribe', NOVA, '/validate/customer-research', MEMBER, null, 1]);
    assert.deepEqual(JSON.parse(stream.units_json), { audio_minutes_websocket: 2 });
    const minutes = usdToMicro(2 * PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[NOVA]);
    assert.equal(stream.charged_microusd, minutes, 'the stream row is charged its minutes');
    assert.equal(guards.length, 1);
    assert.deepEqual([guards[0].task, guards[0].guard_for], ['safety', stream.id], 'the guard row names the stream');
    const [res] = w.reservations();
    assert.equal(res.charged, minutes + guards[0].charged_microusd, 'minutes and guard settle against the hold');
    assert.equal(out.cost_microusd, res.charged);
    assert.deepEqual([w.receipt().outcome, w.receipt().refusal, w.receipt().cost_microusd], ['ok', null, res.charged]);
  } finally { w.f.db.close(); }
});

test('unsafe: the live draft is removed and the receipt says the guard blocked it; the minutes are still charged', async () => {
  const w = world('unsafe');
  try {
    const h = await holdBlock(w.env, MEMBER, NOVA);
    const out = await settleStream(w.env, w.session, NOVA, [(h as any).reservation], 60_000);
    assert.equal(out.guard, 'blocked');
    assert.equal(w.drafts(), 0);
    assert.equal(w.receipt().refusal, 'guard_blocked');
    assert.equal(w.rows()[0].safety_score, 0);
    assert.ok(w.reservations()[0].charged >= usdToMicro(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[NOVA]));
  } finally { w.f.db.close(); }
});

test('a guard that cannot answer fails closed: the draft goes, "guard_unavailable", and its uncompleted calls charge nothing', async () => {
  const w = world('down');
  try {
    const h = await holdBlock(w.env, MEMBER, NOVA);
    const out = await settleStream(w.env, w.session, NOVA, [(h as any).reservation], 60_000);
    assert.equal(out.guard, 'unavailable');
    assert.equal(w.drafts(), 0);
    assert.equal(w.receipt().refusal, 'guard_unavailable');
    assert.equal(w.reservations()[0].charged, usdToMicro(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[NOVA]), 'only the minutes');
    assert.equal(w.rows()[0].safety_score, null);
  } finally { w.f.db.close(); }
});

test('the live model follows Record a Session\'s live job (VA2): offered, live, and allowed by the plan; refused before any socket', () => {
  assert.equal(LIVE_JOB, 'VA2');
  assert.deepEqual(liveChoice(FLUX, ON, 'paid'), { ok: true, model: FLUX, source: 'caller', job: 'VA2', skipped: null });
  assert.equal(liveChoice(NOVA, ON, 'paid').ok, true);
  // The use-case table locks both live models at "all" (MODEL_LOCKS) and keeps them offered either side of the switch.
  for (const sw of [ON, OFF]) for (const tier of ['free', 'paid'] as const) assert.equal(liveChoice(FLUX, sw, tier).ok, true, `${sw.AI_PARTNER_MODELS} ${tier}`);
  // What VA2 does not list, or what cannot stream, is refused: a batch model, a voice, an unknown id.
  for (const m of ['@cf/openai/whisper-large-v3-turbo', '@cf/myshell-ai/melotts', '@cf/no/such-model']) {
    const c = liveChoice(m, ON, 'paid');
    assert.deepEqual([c.ok, !c.ok && c.code], [false, 'model_not_offered'], m);
  }
  const route = readFileSync(new URL('../src/routes/founder_validate_sessions.ts', import.meta.url), 'utf8');
  const at = route.indexOf("sessions.get('/sessions/:id/live'");
  const live = route.slice(at, route.indexOf('openLiveRelay(c.env', at));
  assert.ok(live.indexOf('liveChoice(') > 0 && live.indexOf('liveChoice(') < live.indexOf('holdBlock('), 'the job decides before anything is held');
  // A refused choice returns before the hold: the refusal branch is the choice's own.
  assert.match(live, /if \(!choice\.ok\) \{[\s\S]{0,400}?return json\(\{ ok: false, refusal, message: choice\.message \}/);
  assert.match(live, /outcome: 'refused', refusal/);
});

test('Deepgram mip_opt_out stays off until answer C\'s price effect is confirmed', () => {
  const src = ['../src/services/sttFormats.ts', '../src/services/liveTranscription.ts', '../src/services/aiRouter.ts', '../src/services/ai/shapes.ts']
    .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /mip_opt_out\s*:\s*true/);
});
