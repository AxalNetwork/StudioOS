/**
 * D5948 (#5948) — revenue ledger slice 4: an AI run's hold and usage row name
 * the licence they ran under, and a period's settled runs aggregate per
 * licence (cost, billed, margin), with unattributed and pre-migration runs
 * counted apart.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/ai_licence_attribution_5948.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { run, __resetForTest } from '../src/services/aiRouter.ts';
import { reserveAiBudget } from '../src/services/aiBudget.ts';
import {
  licenceAiPeriod, runLicenceUid, stampReservationLicence, stampUsageLicence,
} from '../src/services/aiLicenceAttribution.ts';

const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611150131_5948_ai_licence_uid.sql'), 'utf8');
const BRANCH_LICENCE = 'CREATE TABLE branch_licence (id INTEGER PRIMARY KEY CHECK (id = 1), licence_uid TEXT NOT NULL);';
const LICENCE = 'lic_acme_0001';

const caps = (db: any) => db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();
const fund = (db: any, user = 2, amount = 5_000_000) => db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance_microusd=excluded.balance_microusd').run(user, amount);
const holds = (db: any) => db.prepare('SELECT * FROM ai_budget_reservations ORDER BY created_at, uid').all().map((r: any) => ({ ...r }));
const logs = (db: any) => db.prepare("SELECT * FROM ai_usage_logs WHERE task <> 'safety' ORDER BY id").all().map((r: any) => ({ ...r }));
const answer = () => ({ run: async () => ({ response: 'answer', usage: { prompt_tokens: 100, completion_tokens: 20 } }) });

function fixture(opts: { branch?: string | null; licence?: string | null; table?: boolean; migrated?: boolean } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  if (opts.migrated !== false) f.db.exec(MIGRATION);
  if (opts.table !== false) {
    f.db.exec(BRANCH_LICENCE);
    if (opts.licence !== null) f.db.prepare('INSERT INTO branch_licence (id, licence_uid) VALUES (1, ?)').run(opts.licence ?? LICENCE);
  }
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', AI: withGuard(answer()), ...(opts.branch === null ? {} : { BRANCH_CODE: opts.branch ?? 'acme' }) };
  caps(f.db); fund(f.db);
  return { ...f, env };
}

// ───────────────────────────────────────────────────────── stamping

test('on a branch Worker a new hold and its usage row carry the branch licence', async () => {
  const f = fixture();
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    assert.equal(r.ok, true);
    const [hold] = holds(f.db);
    const [row] = logs(f.db);
    assert.equal(hold.licence_uid, LICENCE, 'the hold does not name the branch licence');
    assert.equal(row.licence_uid, LICENCE, 'the usage row does not name the branch licence');
    assert.equal(row.reservation_uid, hold.uid);
  } finally { f.db.close(); }
});

test('HQ names no licence: the columns stay NULL, and branch_licence is never read', async () => {
  const f = fixture({ branch: null });
  try {
    let read = 0;
    const prepare = f.DB.prepare.bind(f.DB);
    f.DB.prepare = (sql: string) => { if (/branch_licence/.test(sql)) read += 1; return prepare(sql); };
    assert.equal((await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' })).ok, true);
    assert.equal(holds(f.db)[0].licence_uid, null);
    assert.equal(logs(f.db)[0].licence_uid, null);
    assert.equal(read, 0, 'HQ read branch_licence: a licence would be guessed from a table HQ does not own');
  } finally { f.db.close(); }
});

test('a branch with no licence row, or an unreadable one, runs as before and stores NULL', async () => {
  for (const opts of [{ licence: null }, { table: false }, { licence: '   ' }]) {
    const f = fixture(opts);
    try {
      const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
      assert.equal(r.ok, true, `the AI call failed when the licence lookup did (${JSON.stringify(opts)})`);
      assert.equal(holds(f.db)[0].licence_uid, null);
      assert.equal(logs(f.db)[0].licence_uid, null);
    } finally { f.db.close(); }
  }
});

test('a database before the migration still runs: nothing is stamped and nothing fails', async () => {
  const f = fixture({ migrated: false });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    assert.equal(r.ok, true);
    assert.equal(holds(f.db)[0].licence_uid, undefined, 'the hold table gained a column outside the migration');
  } finally { f.db.close(); }
});

test('the licence is written once and never changed afterwards', async () => {
  const f = fixture();
  try {
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    const [hold] = holds(f.db);
    const [row] = logs(f.db);
    assert.equal(await stampReservationLicence(f.env, hold.uid, 'lic_other'), false);
    assert.equal(await stampUsageLicence(f.env, row.id, 'lic_other'), false);
    assert.equal(holds(f.db)[0].licence_uid, LICENCE);
    assert.equal(logs(f.db)[0].licence_uid, LICENCE);
    // No other statement in the Worker writes the column on these two tables.
    const src = resolve(process.cwd(), 'cloudflare-worker/src');
    const files = (readdirSync(src, { recursive: true }) as string[]).filter((p) => p.endsWith('.ts'));
    const writers = files.filter((p) => {
      const text = readFileSync(resolve(src, p), 'utf8');
      return /UPDATE\s+ai_(budget_reservations|usage_logs)\s+SET[^`'"]*licence_uid/i.test(text);
    });
    assert.deepEqual(writers.map((p) => p.replace(/\\/g, '/')), ['services/aiLicenceAttribution.ts']);
  } finally { f.db.close(); }
});

test('the licence is resolved once per database, and a branch with none is read again', async () => {
  const f = fixture({ licence: null });
  try {
    let reads = 0;
    const prepare = f.DB.prepare.bind(f.DB);
    f.DB.prepare = (sql: string) => { if (/FROM branch_licence/.test(sql)) reads += 1; return prepare(sql); };
    assert.equal(await runLicenceUid(f.env), null);
    f.db.prepare('INSERT INTO branch_licence (id, licence_uid) VALUES (1, ?)').run(LICENCE);
    assert.equal(await runLicenceUid(f.env), LICENCE, 'a licence provisioned later was not read');
    assert.equal(await runLicenceUid(f.env), LICENCE);
    assert.equal(await runLicenceUid(f.env), LICENCE);
    assert.equal(reads, 2, 'a named licence was read again on every run');
  } finally { f.db.close(); }
});

test('what a member is charged does not change on a branch', async () => {
  const charged = async (branch: string | null) => {
    const f = fixture({ branch });
    try {
      await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
      const [hold] = holds(f.db); const [row] = logs(f.db);
      return { charged: row.charged_microusd, included: hold.actual_included_microusd, topup: hold.actual_topup_microusd, quote: hold.included_microusd + hold.topup_microusd };
    } finally { f.db.close(); }
  };
  assert.deepEqual(await charged('acme'), await charged(null));
});

test('a replayed hold is the first one, unchanged', async () => {
  const f = fixture();
  try {
    f.db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/525_ai_reservation_idempotency.sql'), 'utf8'));
    const now = new Date();
    const one = await reserveAiBudget(f.env, 2, 1000, now, { idempotencyKey: 'k-5948' });
    const two = await reserveAiBudget(f.env, 2, 1000, now, { idempotencyKey: 'k-5948' });
    assert.ok(one.ok && two.ok);
    assert.equal(holds(f.db).length, 1);
    assert.equal(holds(f.db)[0].licence_uid, LICENCE);
  } finally { f.db.close(); }
});

// ───────────────────────────────────────────────────────── the aggregate

function seedSettled(db: any, uid: string, opts: { licence: string | null; created: string; updated: string; included: number; topup: number; cost?: number | null; user?: number }) {
  db.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,settlement_uid,
      actual_included_microusd,actual_topup_microusd,expires_at,created_at,updated_at,licence_uid)
    VALUES(?,?,?,?,?,?,'settled',?,?,?,?,?,?,?)`)
    .run(uid, opts.user ?? 2, opts.created.slice(0, 10), opts.created.slice(0, 7), opts.included, opts.topup, `s-${uid}`,
      opts.included, opts.topup, opts.updated, opts.created, opts.updated, opts.licence);
  if (opts.cost != null) {
    db.prepare("INSERT INTO ai_usage_logs(user_id,task,model,est_cost_usd,reservation_uid,licence_uid) VALUES(?,?,?,?,?,?)")
      .run(opts.user ?? 2, 'advisor_turn', 'm', opts.cost, uid, opts.licence);
  }
}

test('the period aggregate: per licence cost, billed and margin; unattributed and pre-migration counted apart', async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE ai_licence_attribution_start SET started_at = '2026-11-15 00:00:00' WHERE id = 1").run();
    const before = '2026-11-01 10:00:00', after = '2026-11-16 10:00:00', settled = '2026-11-20 10:00:00';
    // Licence A: two runs, $1 provider cost each; half of each run paid from top-ups.
    seedSettled(f.db, 'a1', { licence: 'lic_a', created: after, updated: settled, included: 1_000_000, topup: 1_000_000, cost: 1 });
    seedSettled(f.db, 'a2', { licence: 'lic_a', created: after, updated: settled, included: 0, topup: 3_000_000, cost: 1 });
    // Licence B: one run settled before migration 493 had a usage row: margin cannot be computed.
    seedSettled(f.db, 'b1', { licence: 'lic_b', created: after, updated: settled, included: 0, topup: 500_000, cost: null });
    // NULL after the start: unattributed. NULL before it: pre-migration.
    seedSettled(f.db, 'n1', { licence: null, created: after, updated: settled, included: 0, topup: 700_000, cost: 1 });
    seedSettled(f.db, 'p1', { licence: null, created: before, updated: settled, included: 0, topup: 700_000, cost: 1 });
    seedSettled(f.db, 'p2', { licence: null, created: before, updated: settled, included: 0, topup: 700_000, cost: 1 });
    // Outside the period, and an admin's run: neither counts.
    seedSettled(f.db, 'x1', { licence: 'lic_a', created: after, updated: '2026-12-02 00:00:00', included: 0, topup: 9_000_000, cost: 1 });
    seedSettled(f.db, 'x2', { licence: 'lic_a', created: after, updated: settled, included: 0, topup: 9_000_000, cost: 1, user: 1 });

    const out = await licenceAiPeriod(f.env, { start: '2026-11-01', end: '2026-12-01' });
    assert.deepEqual(out.licences, [
      // a1: billed 1.0, cost 1$ × 1/2 = 0.5; a2: billed 3.0, cost 1$ × 3/3 = 1.0.
      { licence_uid: 'lic_a', runs: 2, runs_not_recorded: 0, included_microusd: 1_000_000, billed_microusd: 4_000_000, cost_microusd: 1_500_000, margin_microusd: 2_500_000 },
      { licence_uid: 'lic_b', runs: 1, runs_not_recorded: 1, included_microusd: 0, billed_microusd: 0, cost_microusd: 0, margin_microusd: null },
    ]);
    assert.equal(out.unattributed_runs, 1);
    assert.equal(out.pre_migration_runs, 2, 'a pre-migration run was folded into a licence, into unattributed, or into zero');
    assert.equal(out.attribution_started_at, '2026-11-15 00:00:00');
  } finally { f.db.close(); }
});

test('with no start row the pre-migration count is not recorded (null), never 0', async () => {
  const f = fixture();
  try {
    f.db.exec('DELETE FROM ai_licence_attribution_start');
    seedSettled(f.db, 'n1', { licence: null, created: '2026-11-16 10:00:00', updated: '2026-11-20 10:00:00', included: 0, topup: 700_000, cost: 1 });
    const out = await licenceAiPeriod(f.env, { start: '2026-11-01', end: '2026-12-01' });
    assert.equal(out.pre_migration_runs, null);
    assert.equal(out.unattributed_runs, 1);
    assert.equal(out.attribution_started_at, null);
    assert.deepEqual(out.licences, []);
  } finally { f.db.close(); }
});

test('the migration starts attribution once and adds a nullable column to both tables', () => {
  assert.match(MIGRATION, /ALTER TABLE ai_budget_reservations ADD COLUMN licence_uid TEXT;/);
  assert.match(MIGRATION, /ALTER TABLE ai_usage_logs ADD COLUMN licence_uid TEXT;/);
  assert.match(MIGRATION, /INSERT OR IGNORE INTO ai_licence_attribution_start \(id, started_at\) VALUES \(1, datetime\('now'\)\);/);
  assert.doesNotMatch(MIGRATION, /UPDATE ai_(budget_reservations|usage_logs)/, 'the migration backfills a licence');
});
