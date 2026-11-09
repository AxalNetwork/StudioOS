/**
 * D4870 (#4870) — the admin publication summary (`draftSummary`,
 * `services/publications.ts`) is the caller D4556 named for its gateway model.
 * Off by default: with `AI_PROVIDER_GATEWAY_OPENAI` anything but exactly 'on'
 * the summary runs on Workers AI as before and the gateway is never called. On,
 * it runs `runGatewayTextModel` first, and goes back to Workers AI only where
 * the gateway refused before any provider ran. The binding is a stub: no live
 * call is made and no gateway exists. Same fixtures as D4556's suite.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/publications_gateway_d4870.test.ts
 */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { GUARD_MODEL, withGuard } from './_guard_stub.mjs';
import { draftSummary, gatewayFallsBack, PUBLICATION_GATEWAY_MODEL } from '../src/services/publications.ts';
import { GATEWAY_TEXT_MODELS, GATEWAY_TEXT_SLUG_VAR, GATEWAY_TEXT_SWITCH, GATEWAY_TEXT_ZDR_VAR } from '../src/services/ai/catalogue.ts';

const ME = 2;
const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const rows = (db: any) => db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all().map((r: any) => ({ ...r }));
const runRows = (db: any) => rows(db).filter((r: any) => r.model !== GUARD_MODEL);
const holds = (db: any) => db.prepare('SELECT * FROM ai_budget_reservations').all();

const ON = { [GATEWAY_TEXT_SWITCH]: 'on', [GATEWAY_TEXT_SLUG_VAR]: 'providers-slice', [GATEWAY_TEXT_ZDR_VAR]: 'on' };

function world(env: Record<string, unknown> = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(migration('510_member_ai_pauses.sql') + migration('525_ai_reservation_idempotency.sql') + migration('632_ai_hold_context.sql'));
  return { db, env: { DB, ...env } as any };
}

const gwAnswer = (text = '- [sector_heat:fintech] Heat rose (2026-W44)') => new Response(JSON.stringify({
  id: 'chatcmpl-test', object: 'chat.completion', model: 'gpt-5-mini-2025-08-07',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text, refusal: null } }],
  usage: { prompt_tokens: 1000, completion_tokens: 200 }, gatewayMetadata: { keySource: 'Unified' },
}), { status: 200, headers: { 'cf-aig-log-id': 'log_test_1' } });

type GwReply = (() => Response) | 'throw-2018' | 'throw-unknown' | 'hang';
/** The binding: the gateway model takes `gw`; every Workers AI model answers a bullet; the guard is safe. */
function stubAi(gw: GwReply = gwAnswer) {
  const calls: string[] = [];
  const ai: any = {
    async run(model: string) {
      calls.push(model);
      if (model === PUBLICATION_GATEWAY_MODEL) {
        if (gw === 'hang') return new Promise(() => {});
        if (gw === 'throw-2018') throw new Error('AiGatewayError: 2018: rate limited');
        if (gw === 'throw-unknown') throw new Error('something internal');
        return gw();
      }
      return { response: '- [sector_heat:fintech] Workers AI bullet (2026-W44)', usage: { prompt_tokens: 100, completion_tokens: 20 } };
    },
  };
  withGuard(ai);
  return { ai, calls };
}

const AGG = [{ dimension_key: 'fintech', period_key: '2026-W44', n: 7, value: 0.4, payload: {} }] as any;
const OPTS = { title: 'Weekly heat', section: 'sector_heat', audience: 'lp', filters: {}, aggregates: AGG };
const DEPS = { attemptTimeoutMs: 50, timeoutMs: 2000, random: () => 0.5, sleep: async () => {} };
const draft = (env: any, ai: any) => draftSummary({ ...env, AI: ai }, ME, OPTS, DEPS);
const gwCalls = (calls: string[]) => calls.filter((m) => m === PUBLICATION_GATEWAY_MODEL).length;
const workersCalls = (calls: string[]) => calls.filter((m) => m !== PUBLICATION_GATEWAY_MODEL && m !== GUARD_MODEL).length;

test('D4870: the caller names the one D4556 model, and that model approves publication over public text', () => {
  const m = GATEWAY_TEXT_MODELS.find((x) => x.id === PUBLICATION_GATEWAY_MODEL);
  assert.ok(m, 'the model is in the gateway catalogue');
  assert.ok(m!.workloads.some((w) => w.task === 'publication' && w.dataClasses.includes('public' as never)));
});

test('D4870: off by default — unless the switch is exactly "on", the summary runs on Workers AI and the gateway is never called', async () => {
  // The caller checks the switch and `runGatewayTextModel` checks it again. Mutation checked:
  // a truthy check in both places calls the gateway for 'true', 'ON' and '1'; either exact check alone keeps this green.
  for (const value of [undefined, '', 'true', 'ON', 'off', '1']) {
    const w = world({ ...ON, [GATEWAY_TEXT_SWITCH]: value });
    const s = stubAi();
    const r = await draft(w.env, s.ai);
    assert.equal(r.ok, true, String(value));
    assert.match(r.summary_text, /Workers AI bullet/, String(value));
    assert.notEqual(r.model, PUBLICATION_GATEWAY_MODEL, String(value));
    assert.equal(gwCalls(s.calls), 0, `no gateway call with the switch ${String(value)}`);
    assert.equal(workersCalls(s.calls), 1);
  }
});

test('D4870: on — the summary comes from the gateway model, metered on one row under the publication task, with no Workers AI run', async () => {
  const w = world(ON);
  const s = stubAi();
  const r = await draft(w.env, s.ai);
  assert.equal(r.ok, true);
  assert.equal(r.summary_text, '- [sector_heat:fintech] Heat rose (2026-W44)');
  assert.equal(r.model, PUBLICATION_GATEWAY_MODEL);
  assert.equal(gwCalls(s.calls), 1);
  // Mutation checked: dropping the gateway answer's return fails this test.
  assert.equal(workersCalls(s.calls), 0, 'no second model run');
  const [row] = runRows(w.db);
  assert.equal(row.model, PUBLICATION_GATEWAY_MODEL);
  assert.equal(row.task, 'publication');
  assert.equal(r.usageLogId, row.id, 'the proposal can name its row');
  assert.equal(JSON.parse(row.units_json).data_class, 'public');
  assert.equal(holds(w.db).length, 1, 'one hold');
});

test('D4870: on but unconfigured, or the gateway refused before the provider ran — the summary runs on Workers AI as it does off', async () => {
  // Missing slug and ZDR: `misconfigured`, nothing held, no gateway call.
  let w = world({ [GATEWAY_TEXT_SWITCH]: 'on' });
  let s = stubAi();
  let r = await draft(w.env, s.ai);
  assert.equal(r.ok, true);
  assert.match(r.summary_text, /Workers AI bullet/);
  assert.equal(gwCalls(s.calls), 0);
  assert.equal(workersCalls(s.calls), 1);

  // Rate limited on every attempt (AI Gateway 2018: refused before the provider ran).
  w = world(ON);
  s = stubAi('throw-2018');
  r = await draft(w.env, s.ai);
  assert.equal(r.ok, true);
  assert.match(r.summary_text, /Workers AI bullet/);
  assert.ok(gwCalls(s.calls) >= 1);
  // Mutation checked: dropping the `completion === 'none'` arm makes this 0.
  assert.equal(workersCalls(s.calls), 1);
});

test('D4870: on, and the provider may have done the work — no Workers AI retry; the aggregate fallback, the refusal, never the thrown text', async () => {
  for (const gw of ['hang', 'throw-unknown', () => new Response('{"error":"boom"}', { status: 500 })] as GwReply[]) {
    const w = world(ON);
    const s = stubAi(gw);
    const r = await draft(w.env, s.ai);
    const label = typeof gw === 'string' ? gw : '500';
    assert.equal(r.ok, false, label);
    assert.equal(r.error, 'all_models_failed', label);
    assert.ok(!/something internal|boom/.test(JSON.stringify(r)), `${label}: no thrown or upstream text`);
    assert.match(r.summary_text, /\[fintech\] value=0\.4 across 7 contributors/, label);
    // Mutation checked: falling back on every refusal makes this 1.
    assert.equal(workersCalls(s.calls), 0, `${label}: the work is not run twice`);
  }
});

test('D4870: on — the member\'s own state and the guard refuse on the gateway and are not retried on Workers AI', async () => {
  // The page's AI switch is off: nothing runs at all.
  const off = world(ON);
  off.db.exec('CREATE TABLE ai_rail_preferences(uid TEXT, user_id INTEGER, section TEXT, task TEXT, model TEXT, mode TEXT)');
  off.db.prepare("INSERT INTO ai_rail_preferences(uid, user_id, section, task, mode) VALUES ('off', ?, 'publications', '', 'manual')").run(ME);
  let s = stubAi();
  let r = await draft(off.env, s.ai);
  assert.deepEqual([r.ok, r.error], [false, 'assist_off']);
  assert.equal(s.calls.length, 0, 'no model and no guard call');

  // Out of tokens: the hold refuses.
  const broke = world(ON);
  setFixtureAllowance(broke.db, 0);
  s = stubAi();
  r = await draft(broke.env, s.ai);
  assert.equal(r.ok, false);
  assert.equal(gwCalls(s.calls) + workersCalls(s.calls), 0);

  // The input guard blocks.
  const w = world(ON);
  s = stubAi();
  s.ai.run = (orig => async (model: string, ...rest: unknown[]) => (model === GUARD_MODEL ? { response: 'unsafe\nS1' } : orig(model, ...rest)))(s.ai.run);
  r = await draft(w.env, s.ai);
  assert.deepEqual([r.ok, r.error], [false, 'guard_blocked']);
  assert.equal(gwCalls(s.calls) + workersCalls(s.calls), 0);
});

test('D4870: which gateway refusals go back to Workers AI', () => {
  for (const refusal of ['misconfigured', 'capacity_unavailable', 'model_not_offered'] as const) assert.equal(gatewayFallsBack({ ok: false, refusal }), true, refusal);
  assert.equal(gatewayFallsBack({ ok: false, refusal: 'all_models_failed', completion: 'none' }), true);
  assert.equal(gatewayFallsBack({ ok: false, refusal: 'all_models_failed', completion: 'unknown' }), false);
  assert.equal(gatewayFallsBack({ ok: false, refusal: 'all_models_failed' }), false, 'no completion is not "none"');
  for (const refusal of ['assist_off', 'insufficient_tokens', 'monthly_limit', 'ai_paused', 'guard_blocked', 'guard_blocked_output', 'guard_unavailable',
    'terms_mismatch', 'provider_refused', 'invalid_input', 'surface_not_eligible', 'data_class_not_approved', 'task_not_eligible', 'zdr_not_confirmed'] as const) {
    assert.equal(gatewayFallsBack({ ok: false, refusal }), false, refusal);
  }
});
