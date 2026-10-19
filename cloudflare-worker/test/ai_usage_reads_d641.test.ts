/**
 * D641 (#1434) — the Usage page's reads, over a seeded log with a fixed clock.
 *
 *   · `by_model`: this month per model, with token sums that count only what
 *     D401 counts. A cached row, a refusal, a streamed row and a transcription
 *     are `uncounted_calls`, never 0 tokens folded into a sum.
 *   · `days`: the last 30 UTC days, today included, a day with no run a
 *     recorded 0.
 *   · task labels on `by_task` and `last_run`, one for every `TaskClass`.
 *   · `GET /api/ai/rates`: every model the router can send work to, read from
 *     the two price tables, none priced at 0, the deprecated one `retired`.
 *   · a failed read is `*_recorded: false` with `null`, never an empty list.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_usage_reads_d641.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import { AI_USERS_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { loadMyAiSpend, lastDays, SPEND_DAYS } from '../src/services/aiSpend.ts';
import { TASK_LABELS, MODEL_NAMES, RETIRED_MODELS, taskLabel } from '../src/services/aiCatalog.ts';
import { ROUTE, PRICE_USD_PER_1M_TOKENS, PRICE_USD_PER_AUDIO_MINUTE, PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET } from '../src/services/aiRouter.ts';
import ai, { rateCard } from '../src/routes/ai.ts';
import { createJWT } from '../src/auth.ts';

const LOG = `
CREATE TABLE ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT NOT NULL, model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0, est_cost_usd REAL NOT NULL DEFAULT 0, safety_score REAL,
  fallback_used INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, refusal TEXT, surface TEXT,
  created_at TEXT NOT NULL
);`;
const SCHEMA = AI_USERS_SCHEMA + AI_BUDGET_MIGRATION + LOG;
const ME = 2, OTHER = 3;
const AT = new Date('2026-10-07T12:00:00Z');

/**
 * Model A, this month: two counted live calls (one a fallback), one cached,
 * one refusal (with a recorded completion figure that is still not a count),
 * one streamed (completion 0, and a fallback). Model W: a transcription
 * (prompt 0). Model B: one counted call yesterday. Plus rows that must not
 * count: last month, another user, an unattributed call, tomorrow.
 */
const SEED = `
INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, est_cost_usd, cached, fallback_used, refusal, created_at) VALUES
  (${ME}, 'workspace_explain', 'model-a', 100, 40, 0.0100, 0, 0, NULL,              '2026-10-07 09:00:00'),
  (${ME}, 'workspace_explain', 'model-a', 300, 60, 0.0200, 0, 1, NULL,              '2026-10-07 10:00:00'),
  (${ME}, 'explain',           'model-a', 500, 90, 0.0000, 1, 0, NULL,              '2026-10-07 10:30:00'),
  (${ME}, 'explain',           'model-a', 700, 15, 0.0000, 0, 0, 'budget_user_day', '2026-10-06 08:00:00'),
  (${ME}, 'advisor_turn',      'model-a', 200, 0,  0.0040, 0, 1, NULL,              '2026-10-05 08:00:00'),
  (${ME}, 'transcribe',        'model-w', 0,   350, 0.0010, 0, 0, NULL,             '2026-10-03 08:00:00'),
  (${ME}, 'research_ask',      'model-b', 50,  20, 0.0030, 0, 0, NULL,              '2026-10-06 23:59:59'),
  (${ME}, 'research_ask',      'model-b', 999, 999, 9.0000, 0, 0, NULL,             '2026-09-30 23:59:59'),
  (${ME}, 'research_ask',      'model-b', 999, 999, 9.0000, 0, 0, NULL,             '2026-09-07 23:59:59'),
  (${ME}, 'research_ask',      'model-b', 999, 999, 9.0000, 0, 0, NULL,             '2026-09-08 00:00:00'),
  (${ME}, 'retired_task',      'model-a', 10,  10, 0.0001, 0, 0, NULL,              '2026-10-01 00:00:00'),
  (${ME}, 'research_ask',      'model-b', 999, 999, 9.0000, 0, 0, NULL,             '2026-10-08 00:00:00'),
  (${OTHER}, 'workspace_explain', 'model-a', 999, 999, 9.0000, 0, 0, NULL,          '2026-10-07 09:00:00'),
  (NULL, 'safety',             'model-a', 999, 999, 9.0000, 0, 0, NULL,             '2026-10-07 09:00:00');
`;

const fresh = (seed = SEED, schema = SCHEMA) => ({ DB: makeD1(schema, seed).DB } as any);
const round = (n: number) => Number(n.toFixed(6));

// ── by_model ─────────────────────────────────────────────────────────────────

test('by_model: this month per model, counting tokens only where D401 counts them', async () => {
  const r = await loadMyAiSpend(fresh(), { id: ME, role: 'founder' }, AT);
  assert.equal(r.by_model_recorded, true);
  const by = Object.fromEntries(r.by_model!.map((m) => [m.model, { ...m, spend_usd: round(m.spend_usd) }]));
  assert.deepEqual(Object.keys(by).sort(), ['model-a', 'model-b', 'model-w']);
  // model-a: 2 counted + cached + refusal + streamed + the retired-task row (counted).
  assert.deepEqual(by['model-a'], {
    model: 'model-a', calls: 6, spend_usd: 0.0341,
    // 100 + 300 counted, 200 from the streamed row's prompt side, 10 from the
    // retired-task row; the cached 500 and the refused 700 are not counts.
    prompt_tokens: 610,
    // 40 + 60 + 10; the streamed row's 0 is not a count, nor the cached 90,
    // nor the refused row's 15 (a refusal ran no model, whatever it recorded).
    completion_tokens: 110,
    // cached, refused, streamed.
    uncounted_calls: 3,
    cached_calls: 1,
    // the fallback call, and the streamed call that also fell back.
    fallback_calls: 2,
  });
  // A transcription: its 0 prompt is not a count, so it is uncounted; its
  // completion side is a positive figure the router wrote down.
  assert.deepEqual(by['model-w'], {
    model: 'model-w', calls: 1, spend_usd: 0.001, prompt_tokens: 0, completion_tokens: 350,
    uncounted_calls: 1, cached_calls: 0, fallback_calls: 0,
  });
  // September's, tomorrow's and other people's rows are not here.
  assert.deepEqual(by['model-b'], {
    model: 'model-b', calls: 2, spend_usd: 9.003, prompt_tokens: 1049, completion_tokens: 1019,
    uncounted_calls: 0, cached_calls: 0, fallback_calls: 0,
  });
  // Dearest first.
  assert.deepEqual(r.by_model!.map((m) => m.model), ['model-b', 'model-a', 'model-w']);
});

// ── days ─────────────────────────────────────────────────────────────────────

test('days: the last 30 UTC days, today last, a day with no run a recorded 0', async () => {
  const r = await loadMyAiSpend(fresh(), { id: ME, role: 'founder' }, AT);
  assert.equal(r.days_recorded, true);
  assert.equal(SPEND_DAYS, 30);
  assert.equal(r.days!.length, 30);
  assert.equal(r.days![0].day, '2026-09-08');
  assert.equal(r.days![29].day, '2026-10-07', 'today is included');
  const d = Object.fromEntries(r.days!.map((x) => [x.day, { calls: x.calls, spend_usd: round(x.spend_usd) }]));
  assert.deepEqual(d['2026-10-07'], { calls: 3, spend_usd: 0.03 });
  assert.deepEqual(d['2026-10-06'], { calls: 2, spend_usd: 0.003 }, 'the refusal and 23:59:59 both land on the 6th');
  assert.deepEqual(d['2026-10-04'], { calls: 0, spend_usd: 0 }, 'a day with no run is a recorded 0');
  assert.deepEqual(d['2026-09-30'], { calls: 1, spend_usd: 9 }, 'a day in the previous month is in the window');
  assert.deepEqual(d['2026-09-08'], { calls: 1, spend_usd: 9 }, 'the first day is whole');
  assert.equal(d['2026-09-07'], undefined, 'the 31st day back is outside the window');
  assert.equal(d['2026-10-08'], undefined, 'tomorrow is outside the window');
  assert.equal(round(r.days!.reduce((s, x) => s + x.spend_usd, 0)), 18.0381);
});

test('lastDays crosses month and year ends in UTC', () => {
  assert.deepEqual(lastDays(new Date('2026-03-01T00:30:00Z'), 3), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(lastDays(new Date('2027-01-01T23:59:59Z'), 2), ['2026-12-31', '2027-01-01']);
});

// ── labels ───────────────────────────────────────────────────────────────────

test('every task class has a label, and by_task and last_run carry it', async () => {
  for (const task of Object.keys(ROUTE)) {
    assert.equal(typeof (TASK_LABELS as any)[task], 'string', `${task} has no label`);
    assert.ok((TASK_LABELS as any)[task].trim().length > 0, `${task} has an empty label`);
    assert.doesNotMatch((TASK_LABELS as any)[task], /advis|recommend|fiduciar/i, `${task}'s label breaks the voice rule`);
  }
  assert.deepEqual(Object.keys(TASK_LABELS).sort(), Object.keys(ROUTE).sort(), 'a label for a task the router does not have');
  assert.equal(TASK_LABELS.workspace_explain, 'Explain this page');
  assert.equal(taskLabel('retired_task'), null);
  assert.equal(taskLabel('toString'), null, 'an inherited property is not a label');
  assert.equal(taskLabel(undefined), null);

  const r = await loadMyAiSpend(fresh(), { id: ME, role: 'founder' }, AT);
  // The last run as at 12:00 is today's cached explain; tomorrow's row is after `now`.
  assert.equal(r.last_run!.task, 'explain');
  assert.equal(r.last_run!.label, 'Explain a topic');
  const byTask = Object.fromEntries(r.by_task.map((t) => [t.task, t.label]));
  assert.equal(byTask.workspace_explain, 'Explain this page');
  assert.equal(byTask.transcribe, 'Transcribe audio');
  assert.equal(byTask.retired_task, null, 'a task the router no longer has gets no invented label');
});

test('last_run carries its task label', async () => {
  const seed = `INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, est_cost_usd, created_at)
                VALUES (${ME}, 'workspace_explain', 'model-a', 10, 5, 0.001, '2026-10-07 11:00:00');`;
  const r = await loadMyAiSpend(fresh(seed), { id: ME, role: 'founder' }, AT);
  assert.equal(r.last_run!.label, 'Explain this page');
});

// ── failure is not an empty list ─────────────────────────────────────────────

test('a failed read is recorded: false with null, never an empty list', async () => {
  // The totals read but the two new reads fail: a log with no est_cost_usd
  // breaks every query, so wrap the DB to fail only the per-model and per-day ones.
  const base = fresh();
  const failing = {
    DB: {
      prepare: (q: string) => (/GROUP BY u\.model|GROUP BY substr\(u\.created_at, 1, 10\)/.test(q)
        ? { bind: () => ({ all: async () => { throw new Error('read failed'); } }) }
        : base.DB.prepare(q)),
    },
  } as any;
  const r = await loadMyAiSpend(failing, { id: ME, role: 'founder' }, AT);
  assert.equal(r.recorded, true, 'the totals still stand');
  assert.equal(r.by_model, null);
  assert.equal(r.by_model_recorded, false);
  assert.equal(r.days, null);
  assert.equal(r.days_recorded, false);
  assert.equal(r.by_task_recorded, true);

  // No log at all: nothing is recorded, and nothing reads as an empty month.
  const none = await loadMyAiSpend(fresh('', AI_USERS_SCHEMA + AI_BUDGET_MIGRATION), { id: ME, role: 'founder' }, AT);
  assert.equal(none.recorded, false);
  assert.equal(none.by_model, null);
  assert.equal(none.by_model_recorded, false);
  assert.equal(none.days, null);
  assert.equal(none.days_recorded, false);
});

test('a caller with no runs has 30 recorded zero days and an empty, recorded by_model', async () => {
  const r = await loadMyAiSpend(fresh(), { id: 99, role: 'founder' }, AT);
  assert.equal(r.by_model_recorded, true);
  assert.deepEqual(r.by_model, []);
  assert.equal(r.days_recorded, true);
  assert.equal(r.days!.length, 30);
  assert.ok(r.days!.every((d) => d.calls === 0 && d.spend_usd === 0));
});

// ── the rate card ────────────────────────────────────────────────────────────

test('the rate card covers every model ROUTE can use, priced from the router\'s own tables', () => {
  const card = rateCard();
  const byId = new Map(card.map((m: any) => [m.id, m]));
  const routed = new Set<string>();
  for (const e of Object.values(ROUTE) as any[]) {
    routed.add(e.model);
    for (const m of e.fallbackChain ?? []) routed.add(m);
    for (const m of e.alternates ?? []) routed.add(m);
  }
  for (const id of routed) {
    const m: any = byId.get(id);
    assert.ok(m, `${id} is routed but not on the rate card`);
    assert.notEqual(m.retired, true, `${id} is routed but marked retired`);
  }
  // Every priced model is on the card once, with the table's own figures. D760:
  // a model priced only over a WebSocket (Flux) has a row too.
  const wsOnly = Object.keys(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET).filter((id) => !(id in PRICE_USD_PER_AUDIO_MINUTE));
  assert.equal(card.length, Object.keys(PRICE_USD_PER_1M_TOKENS).length + Object.keys(PRICE_USD_PER_AUDIO_MINUTE).length + wsOnly.length);
  assert.equal(byId.size, card.length, 'a model is listed twice');
  for (const [id, p] of Object.entries(PRICE_USD_PER_1M_TOKENS)) {
    assert.deepEqual(
      { in: byId.get(id).in_per_1m_usd, out: byId.get(id).out_per_1m_usd, audio: byId.get(id).per_audio_minute_usd },
      { in: p.in, out: p.out, audio: undefined }, id);
  }
  for (const [id, perMinute] of Object.entries(PRICE_USD_PER_AUDIO_MINUTE)) {
    assert.equal(byId.get(id).per_audio_minute_usd, perMinute, id);
    assert.equal(byId.get(id).in_per_1m_usd, undefined, `${id} is billed by the minute, not the token`);
  }
  // No price is 0: an input rate on every token model, an output rate on every
  // model that produces output (an embedding produces none), a minute rate on audio.
  const embeds = new Set((Object.values(ROUTE) as any[]).filter((e) => e.isEmbed).map((e) => e.model));
  for (const [id, perMinute] of Object.entries(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET)) {
    assert.equal(byId.get(id).per_audio_minute_websocket_usd, perMinute, id);
  }
  for (const m of card as any[]) {
    if (m.per_audio_minute_usd !== undefined) { assert.ok(m.per_audio_minute_usd > 0, m.id); continue; }
    if (m.per_audio_minute_websocket_usd !== undefined) { assert.ok(m.per_audio_minute_websocket_usd > 0, m.id); continue; }
    assert.ok(m.in_per_1m_usd > 0, `${m.id} has an input price of 0`);
    if (!embeds.has(m.id)) assert.ok(m.out_per_1m_usd > 0, `${m.id} has an output price of 0`);
  }
  // Names are readable, never the bare id; the deprecated 8b is retired and no other.
  for (const m of card as any[]) {
    assert.equal(m.name, MODEL_NAMES[m.id], `${m.id} has no name`);
    assert.notEqual(m.name, m.id);
  }
  assert.deepEqual(card.filter((m: any) => m.retired).map((m: any) => m.id), ['@cf/meta/llama-3.1-8b-instruct']);
  assert.deepEqual([...RETIRED_MODELS], ['@cf/meta/llama-3.1-8b-instruct']);
});

test('the rate card follows the price table rather than a copy of it', () => {
  const saved = PRICE_USD_PER_1M_TOKENS['@cf/meta/llama-3.2-3b-instruct'];
  PRICE_USD_PER_1M_TOKENS['@cf/meta/llama-3.2-3b-instruct'] = { in: 1.234, out: 5.678 };
  try {
    const m: any = rateCard().find((x: any) => x.id === '@cf/meta/llama-3.2-3b-instruct');
    assert.deepEqual([m.in_per_1m_usd, m.out_per_1m_usd], [1.234, 5.678]);
  } finally {
    PRICE_USD_PER_1M_TOKENS['@cf/meta/llama-3.2-3b-instruct'] = saved;
  }
});

// ── the routes ───────────────────────────────────────────────────────────────

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
/** The real router; SQL answers the usage table, a stub answers the session lookups. */
function routeEnv(userId: number) {
  const { DB } = makeD1(SCHEMA, SEED);
  const stub = (q: string) => {
    const api: any = {
      bind: () => api,
      first: async () => (/FROM user_sessions/i.test(q) ? { revoked_at: null, step_up_due_at: null } : null),
      all: async () => ({
        results: /FROM\s+users/i.test(q)
          ? [{ id: userId, email: `u${userId}@example.test`, role: 'founder', is_active: 1, name: 'U' }]
          : [],
      }),
      run: async () => ({ meta: { changes: 0 } }),
    };
    return api;
  };
  return {
    JWT_SECRET,
    DB: {
      prepare: (q: string) => (/ai_usage_logs/.test(q) ? DB.prepare(q) : stub(q)),
      exec: async () => ({ count: 0, duration: 0 }),
    },
  } as any;
}

test('GET /rates serves the card to a signed-in member, and nothing without a session', async () => {
  const env = routeEnv(ME);
  const token = await createJWT(env, ME, `u${ME}@example.test`, 'founder', undefined, `jti-${ME}`);
  const res = await ai.request('/rates', { headers: { authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.models, JSON.parse(JSON.stringify(rateCard())));
  // Without a session the sub-router throws requireAuth's refusal (the app's
  // error handler turns it into a 401); no card is served either way.
  const anon = await ai.request('/rates', {}, env);
  assert.notEqual(anon.status, 200);
  assert.equal(((await anon.json().catch(() => ({}))) as any).models, undefined);
});

test('GET /me/spend carries by_model, days and the labels', async () => {
  const env = routeEnv(ME);
  const token = await createJWT(env, ME, `u${ME}@example.test`, 'founder', undefined, `jti-${ME}`);
  const res = await ai.request('/me/spend', { headers: { authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.by_model_recorded, true);
  assert.ok(Array.isArray(body.by_model));
  assert.equal(body.days_recorded, true);
  assert.equal(body.days.length, 30);
  assert.equal(body.days[29].day, new Date().toISOString().slice(0, 10));
  assert.ok(body.by_task.every((t: any) => 'label' in t));
});
