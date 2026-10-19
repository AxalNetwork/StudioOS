/**
 * D762 (#2019) — each AI run records its charge beside its cost.
 *
 * What this part builds, before A1 (D760, #2017) lands its pricing module:
 * migration 493's columns on `ai_usage_logs`, every row's charge, hold, units
 * and rail fields, a streamed run settled on what it used when its stream
 * ends, `seedSpend` reading the charge, and "Held by runs in progress"
 * counting an earlier month's review hold. Billing stays on cost: the billed
 * quote waits for A1's `billedMicro` and `billingMode`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/ai_charged_d762.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { loadAiBudget, usdToMicro } from '../src/services/aiBudget.ts';
import { run, __resetForTest, ROUTE, estimateCostUsd, meterStream } from '../src/services/aiRouter.ts';

const MODEL = ROUTE.advisor_turn.model;
const caps = (db, day = 0, month = 0) => db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',?,?,1)").run(day, month);
const fund = (db, user = 2, amount = 5_000_000) => db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance_microusd=excluded.balance_microusd').run(user, amount);
const rows = (db) => db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all().map((r) => ({ ...r }));
const reservations = (db) => db.prepare('SELECT * FROM ai_budget_reservations ORDER BY created_at, uid').all().map((r) => ({ ...r }));

function fixture(extra = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  return { ...f, env: { DB: f.DB, ENVIRONMENT: 'development', ...extra } };
}
const answer = (usage = { prompt_tokens: 100, completion_tokens: 20 }) => ({ run: async () => ({ response: 'answer', usage }) });

// ================================================================ the log row

test('a member run records what its hold settled at, the hold, and the units, beside the cost', async () => {
  const f = fixture({ AI: answer() });
  try {
    caps(f.db); fund(f.db);
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    assert.equal(r.ok, true);
    const [row] = rows(f.db);
    const [hold] = reservations(f.db);
    const cost = estimateCostUsd(MODEL, 100, 20);
    assert.equal(row.est_cost_usd, cost);
    assert.equal(row.charged_microusd, usdToMicro(cost), 'the charge is not the settled amount');
    assert.equal(hold.status, 'settled');
    assert.equal(hold.actual_included_microusd + hold.actual_topup_microusd, row.charged_microusd, 'the row and the hold disagree on the charge');
    assert.equal(row.reservation_uid, hold.uid, 'the row does not name the hold that paid for it');
    assert.deepEqual(JSON.parse(row.units_json), { tokens_in: 100, tokens_out: 20 });
  } finally { f.db.close(); }
});

test('the row\'s units are D761\'s for the answering attempt, cached input among them', async () => {
  const f = fixture({ AI: answer({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } }) });
  try {
    caps(f.db); fund(f.db);
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    const units = JSON.parse(rows(f.db)[0].units_json);
    assert.equal(units.tokens_in, 100);
    assert.equal(units.tokens_out, 20);
    assert.equal(units.tokens_cached, 60, 'the cached input D761 measured was not recorded');
    assert.deepEqual(units, { ...r.units, tokens_in: 100, tokens_out: 20 }, 'the row does not carry the attempt\'s units');
  } finally { f.db.close(); }
});

test('AI_BILLING unset, or any value that is not the switch, charges cost (A1 and this task add "charged")', async () => {
  for (const AI_BILLING of [undefined, '', 'on', 'yes', 'Charged ', 'CHARGED']) {
    const f = fixture({ AI: answer(), ...(AI_BILLING === undefined ? {} : { AI_BILLING }) });
    try {
      caps(f.db); fund(f.db);
      await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
      assert.equal(rows(f.db)[0].charged_microusd, usdToMicro(estimateCostUsd(MODEL, 100, 20)), `AI_BILLING=${JSON.stringify(AI_BILLING)} did not charge cost`);
    } finally { f.db.close(); }
  }
});

test('nothing charged reads 0, never NULL: a refusal, a failed run, a system run', async () => {
  const f = fixture({ AI: { run: async () => { throw new Error('down'); } } });
  try {
    caps(f.db); fund(f.db);
    assert.equal((await run(f.env, { task: 'advisor_turn', userId: 2, text: 'x' })).refusal, 'all_models_failed');
    assert.equal((await run(f.env, { task: 'advisor_turn', userId: 2, text: 'x', model: 'not-a-model' })).refusal, 'model_not_offered');
    f.env.AI = answer();
    assert.equal((await run(f.env, { task: 'advisor_turn', userId: 0, text: 'system' })).ok, true);
    const [failed, refused, system] = rows(f.db);
    assert.equal(failed.charged_microusd, 0);
    assert.ok(failed.reservation_uid, 'a failed run does not name the hold it refunded');
    assert.equal(refused.charged_microusd, 0);
    assert.equal(refused.reservation_uid, null);
    assert.equal(system.charged_microusd, 0, 'a run with no hold charged somebody');
    assert.equal(system.reservation_uid, null);
    assert.ok(system.est_cost_usd > 0, 'the system run has no cost to compare');
  } finally { f.db.close(); }
});

test('a run that cost more than its hold is not charged yet: NULL, waiting for review', async () => {
  // A hold quotes the dearest model at its bounds; a provider reporting more output than the bound overruns it.
  const f = fixture({ AI: answer({ prompt_tokens: 100, completion_tokens: 5_000_000 }) });
  try {
    caps(f.db); fund(f.db, 2, 50_000_000);
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello', maxTokens: 16 });
    assert.equal(r.refusal, 'misconfigured');
    const [row] = rows(f.db);
    assert.equal(reservations(f.db)[0].status, 'review');
    assert.equal(row.charged_microusd, null, 'a charge was recorded before the Super Admin decided it');
    assert.equal(row.reservation_uid, reservations(f.db)[0].uid);
  } finally { f.db.close(); }
});

test('the KV spend buckets and the organisation cap stay on cost', async () => {
  const puts = new Map();
  const f = fixture({ AI: answer(), AI_SPEND: { get: async (k) => puts.get(k) ?? null, put: async (k, v) => { puts.set(k, v); } } });
  try {
    caps(f.db); fund(f.db);
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    const org = [...puts].find(([k]) => k.startsWith('ai_spend:org:'));
    assert.ok(org, 'the org bucket was not bumped');
    assert.equal(Number(org[1]), estimateCostUsd(MODEL, 100, 20), 'the org bucket counts something other than cost');
  } finally { f.db.close(); }
});

test('the rail page, option and record are written when the caller passes them, and only as plain keys', async () => {
  const f = fixture({ AI: answer() });
  try {
    caps(f.db); fund(f.db);
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'a', railPage: '/validate/interviews', railOption: 'summarise', recordRef: 'interview:12' });
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'b', railPage: "/x'; DROP TABLE", railOption: 'a'.repeat(161), recordRef: 'has space' });
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'c' });
    const [kept, refused, none] = rows(f.db);
    assert.deepEqual([kept.rail_page, kept.rail_option, kept.record_ref], ['/validate/interviews', 'summarise', 'interview:12']);
    assert.deepEqual([refused.rail_page, refused.rail_option, refused.record_ref], [null, null, null]);
    assert.deepEqual([none.rail_page, none.rail_option, none.record_ref], [null, null, null]);
    assert.equal(kept.guard_for, null, 'guard_for is A4\'s to write');
  } finally { f.db.close(); }
});

// ================================================================ a streamed run

const enc = new TextEncoder();
function sse(lines) {
  let i = 0;
  return new ReadableStream({
    pull(c) { if (i < lines.length) c.enqueue(enc.encode(lines[i++])); else c.close(); },
  });
}
const CHUNKS = ['data: {"response":"Hello "}\n\n', 'data: {"respo', 'nse":"world"}\n\n'];
async function readAll(stream) {
  const r = stream.getReader(); let out = '';
  for (;;) { const n = await r.read(); if (n.done) return out; out += new TextDecoder().decode(n.value); }
}
const streaming = (lines) => ({ run: async (_m, payload) => (payload.stream ? sse(lines) : { response: 'x' }) });

test('a streamed run settles on the provider\'s final usage when the stream ends, never at 0 output', async () => {
  const lines = [...CHUNKS, 'data: {"response":"","usage":{"prompt_tokens":40,"completion_tokens":7}}\n\n', 'data: [DONE]\n\n'];
  const f = fixture({ AI: streaming(lines) });
  try {
    caps(f.db); fund(f.db);
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hi', stream: true });
    assert.equal(r.ok, true);
    assert.equal(reservations(f.db)[0].status, 'pending', 'the hold settled before the stream was read');
    assert.equal(rows(f.db).length, 0, 'the row was written before the run had used anything');
    assert.equal(await readAll(r.stream), lines.join(''), 'the stream was not passed through unchanged');
    const [row] = rows(f.db);
    assert.equal(row.completion_tokens, 7);
    assert.equal(row.prompt_tokens, 40);
    assert.deepEqual([JSON.parse(row.units_json).tokens_in, JSON.parse(row.units_json).tokens_out], [40, 7], 'the units are the stream\'s opening figures, not what it used');
    assert.equal(row.charged_microusd, usdToMicro(estimateCostUsd(MODEL, 40, 7)));
    assert.equal(reservations(f.db)[0].status, 'settled');
  } finally { f.db.close(); }
});

test('with no usage chunk, a streamed run settles on the output the Worker counted', async () => {
  const f = fixture({ AI: streaming([...CHUNKS, 'data: [DONE]\n\n']) });
  try {
    caps(f.db); fund(f.db);
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hi', stream: true });
    await readAll(r.stream);
    const [row] = rows(f.db);
    assert.equal(row.completion_tokens, Math.ceil('Hello world'.length / 4), 'the deltas split across chunks were not counted');
    assert.ok(row.completion_tokens > 0);
    assert.equal(row.charged_microusd, usdToMicro(estimateCostUsd(MODEL, row.prompt_tokens, row.completion_tokens)));
  } finally { f.db.close(); }
});

test('a reader who stops early is settled on what they were sent, once', async () => {
  const f = fixture({ AI: streaming(['data: {"response":"Hello there "}\n\n', 'data: {"response":"never sent"}\n\n']) });
  try {
    caps(f.db); fund(f.db);
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hi', stream: true });
    const reader = r.stream.getReader();
    await reader.read();
    await reader.cancel('gone');
    const [row, extra] = rows(f.db);
    assert.equal(extra, undefined, 'the run was settled twice');
    assert.equal(row.completion_tokens, Math.ceil('Hello there '.length / 4));
    assert.equal(reservations(f.db)[0].status, 'settled');
  } finally { f.db.close(); }
});

test('meterStream: a reader who cancels while a read is still pending is settled once', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let sent = 0;
  const source = new ReadableStream({
    async pull(c) {
      if (sent++ === 0) { c.enqueue(enc.encode('data: {"response":"abcd"}\n\n')); return; }
      await gate; c.close();
    },
  });
  const seen = [];
  const reader = meterStream(source, async (u) => { seen.push(u); }).getReader();
  await reader.read();
  const pending = reader.read();
  await new Promise((r) => setTimeout(r, 0));
  const cancelled = reader.cancel('gone');
  release();
  await Promise.allSettled([pending, cancelled]);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(seen.length, 1, 'the run was settled twice');
});

test('meterStream: a usage chunk with no completion count is not the provider\'s figure', async () => {
  const seen = [];
  const s = meterStream(sse(['data: {"response":"abcdefgh","usage":{"prompt_tokens":3}}\n\n', 'not json\n', 'data: [DONE]\n\n']), async (u) => { seen.push(u); });
  await readAll(s);
  assert.deepEqual(seen, [{ completion_tokens: 2, source: 'counted' }]);
  // A provider count of 0 is not believed over text the reader was actually sent.
  const zero = [];
  await readAll(meterStream(sse(['data: {"response":"abcdefgh","usage":{"prompt_tokens":3,"completion_tokens":0}}\n\n']), async (u) => { zero.push(u); }));
  assert.deepEqual(zero, [{ completion_tokens: 2, source: 'counted' }]);
  const failing = meterStream(sse(['data: {"response":"x"}\n\n']), async () => { throw new Error('settle failed'); });
  assert.equal(await readAll(failing), 'data: {"response":"x"}\n\n', 'a settlement failure reached the reader');
});

// ================================================================ the budget reads

test('seedSpend reads the charge where one is recorded, and the cost on an older row', async () => {
  const f = fixture();
  try {
    caps(f.db, 10_000_000, 50_000_000); fund(f.db);
    const today = new Date().toISOString().slice(0, 10);
    const log = f.db.prepare("INSERT INTO ai_usage_logs(user_id,task,model,est_cost_usd,charged_microusd,refusal,created_at) VALUES(2,'t','m',?,?,?,?)");
    log.run(9.0, 300000, null, `${today} 08:00:00`);     // a charge: it wins over the cost
    log.run(0.2, null, null, `${today} 09:00:00`);       // before 493: the cost
    log.run(4.0, 0, 'budget_review', `${today} 10:00:00`); // a refusal: not spend
    const b = await loadAiBudget(f.env, 2);
    assert.equal(b.day_spend_microusd, 300000 + 200000);
  } finally { f.db.close(); }
});

test('"Held by runs in progress" counts an earlier month\'s review hold; this month\'s spend does not', async () => {
  const f = fixture();
  try {
    caps(f.db, 10_000_000, 50_000_000); fund(f.db);
    const now = new Date();
    const before = await loadAiBudget(f.env, 2, now);
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString();
    f.db.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,recorded_cost_microusd,expires_at,created_at)
      VALUES('old-review',2,?,?,120000,0,'review',150000,'2000-01-01',?)`).run(last.slice(0, 10), last.slice(0, 7), last.slice(0, 19).replace('T', ' '));
    // An earlier month's PENDING hold is not counted: it expires and returns on its own.
    f.db.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,expires_at,created_at)
      VALUES('old-pending',2,?,?,70000,0,'pending','2999-01-01',?)`).run(last.slice(0, 10), last.slice(0, 7), last.slice(0, 19).replace('T', ' '));
    // This month's review hold is counted once, in this month's figure.
    const month = now.toISOString().slice(0, 7);
    f.db.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,recorded_cost_microusd,expires_at,created_at)
      VALUES('this-review',2,'1999-01-01',?,50000,0,'review',60000,'2000-01-01',?)`).run(month, now.toISOString().slice(0, 19).replace('T', ' '));
    f.db.prepare("UPDATE ai_included_spend SET spend_microusd=spend_microusd+50000 WHERE user_id=2 AND period_kind='month' AND period_key=?").run(month);
    const after = await loadAiBudget(f.env, 2, now);
    assert.equal(after.month_reserved_microusd, before.month_reserved_microusd + 120000 + 50000);
    assert.equal(after.month_spend_microusd, before.month_spend_microusd, 'an earlier month\'s hold moved this month\'s spend');
    assert.equal(after.day_reserved_microusd, before.day_reserved_microusd);
  } finally { f.db.close(); }
});

// ================================================================ the schema

test('ensureLogSchema creates migration 493\'s columns on a fresh database, and a pre-493 table gains them', async () => {
  const migration = readFileSync(new URL('../sql/migrations/493_ai_usage_charged.sql', import.meta.url), 'utf8');
  const want = [...migration.matchAll(/ADD COLUMN (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(want, ['charged_microusd', 'reservation_uid', 'rail_page', 'rail_option', 'record_ref', 'guard_for', 'units_json']);
  const cols = (db) => db.prepare('PRAGMA table_info(ai_usage_logs)').all().map((c) => c.name);
  const idx = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ai_usage_logs'").all().map((r) => r.name);

  const fresh = fixture({ AI: answer() });
  try {
    fresh.db.exec('DROP TABLE ai_usage_logs');
    await run(fresh.env, { task: 'advisor_turn', userId: 0, text: 'x' });
    // In the CREATE's own order: columns added by the pre-493 path would land after `surface` in another order.
    assert.deepEqual(cols(fresh.db).slice(-8), ['surface', ...want], 'the fresh table did not get 493\'s columns from the CREATE');
    assert.ok(idx(fresh.db).includes('idx_ai_usage_user_page_created'));
    assert.equal(rows(fresh.db).length, 1);
  } finally { fresh.db.close(); }

  const old = fixture({ AI: answer() });
  try {
    old.db.exec('DROP TABLE ai_usage_logs');
    old.db.exec("CREATE TABLE ai_usage_logs(id INTEGER PRIMARY KEY,user_id INTEGER,task TEXT NOT NULL,model TEXT NOT NULL,latency_ms INTEGER DEFAULT 0,prompt_tokens INTEGER DEFAULT 0,completion_tokens INTEGER DEFAULT 0,est_cost_usd REAL DEFAULT 0,safety_score REAL,fallback_used INTEGER DEFAULT 0,cached INTEGER DEFAULT 0,refusal TEXT,surface TEXT,created_at TEXT DEFAULT(datetime('now')))");
    await run(old.env, { task: 'advisor_turn', userId: 0, text: 'x' });
    for (const c of want) assert.ok(cols(old.db).includes(c), `the pre-493 table did not gain ${c}`);
    assert.ok(idx(old.db).includes('idx_ai_usage_user_page_created'));
    assert.equal(rows(old.db).length, 1, 'a run on a pre-493 table was not logged');
    assert.equal(rows(old.db)[0].charged_microusd, 0);
  } finally { old.db.close(); }
});

test('migration 493 is additive: seven nullable columns and one index, no rebuild, no backfill', () => {
  const sql = readFileSync(new URL('../sql/migrations/493_ai_usage_charged.sql', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.equal((sql.match(/ALTER TABLE ai_usage_logs ADD COLUMN/g) || []).length, 7);
  assert.doesNotMatch(sql, /NOT NULL|DEFAULT|UPDATE |INSERT |DROP |CREATE TABLE|BEGIN|PRAGMA/i);
  assert.equal((sql.match(/CREATE INDEX IF NOT EXISTS/g) || []).length, 1);
});
