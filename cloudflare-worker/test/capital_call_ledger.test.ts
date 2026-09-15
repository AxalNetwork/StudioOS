/**
 * A GP's capital call reaches the ledger, exactly once.
 *
 * Task #197. `capital_call_notice` — the job `POST /api/funds/:id/capital-call`
 * enqueues — wrote an `activity_logs` line per LP and bumped
 * `vc_funds.deployed_capital`, and never wrote a `capital_calls` row. Two live
 * screens read that table through `api.listCapitalCalls()` and both carry a
 * working Pay button over it, so a GP could issue a call and an LP could see a
 * log line and a moved dashboard number with no receivable to pay.
 *
 * THIS IS THE FIRST TEST OF ANY QUEUE-JOB HANDLER IN THE REPO, which is part of
 * why the bug survived: `handleJob` had no coverage at all, so nothing noticed
 * that one of its money paths wrote no money.
 *
 * WHAT IS ACTUALLY HARD HERE IS NOT THE INSERT, IT IS THE RETRY. The handler gets
 * re-run: on the D1 path `Jobs.markFailed` puts the same `queue_jobs` row back to
 * `pending`, and on the CF Queue path the consumer deletes its idempotency claim
 * in the failure branch on purpose "so a CF retry actually re-runs the handler".
 * A ledger row added naively to a handler with those semantics turns a missing
 * receivable into a doubled one, which is worse than the bug. So most of this
 * file is about what happens the second time.
 *
 * THE FIXTURE IS BUILT FROM `schema_baseline.sql`, NOT HAND-COPIED — and this is
 * not ceremony. `capital.test.ts`'s hand-written `capital_calls` has no `uid`
 * column, because nothing needed one when it was written. `uid` is the entire
 * idempotency mechanism here, so a hand-copied fixture would have failed on the
 * INSERT and taught me to weaken the code instead.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/capital_call_ledger.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeD1 } from './_d1_sqlite.mjs';
import { handleJob } from '../src/services/queueWorker.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = readFileSync(resolve(HERE, '../sql/schema_baseline.sql'), 'utf8');

/**
 * One table's DDL, straight out of the production snapshot, minus its foreign
 * keys.
 *
 * WHY THE `REFERENCES` CLAUSES GO. `node:sqlite` enforces foreign keys by
 * default, so creating `vc_funds` — which carries `lpa_doc_id INTEGER REFERENCES
 * legal_documents(id)` — fails unless this fixture also builds
 * `legal_documents`, and then whatever that references, and so on out. Stubbing
 * that chain would put a hand-written schema back in, which is the thing taking
 * the DDL from the baseline was meant to avoid.
 *
 * WHAT IS KEPT IS WHAT THIS FILE DEPENDS ON: every column, its type, its
 * default, and its UNIQUE constraints — including `uid TEXT UNIQUE NOT NULL
 * DEFAULT (lower(hex(randomblob(16))))`, which is the entire idempotency
 * mechanism under test. Dropping the FKs is also closer to how D1 behaves in the
 * path being exercised: `GOTCHAS.md` records that SQLite ignores `PRAGMA
 * foreign_keys` inside a batch's implicit transaction, which is where these
 * inserts run.
 */
function ddl(table: string): string {
  for (const needle of [`CREATE TABLE ${table} (`, `CREATE TABLE "${table}" (`]) {
    const at = BASELINE.indexOf(needle);
    if (at < 0) continue;
    const end = BASELINE.indexOf(';', at);
    assert.ok(end > at, `${table}'s DDL does not close where this reader expects`);
    const sql = BASELINE.slice(at, end + 1)
      .replace(/\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi, '');
    assert.doesNotMatch(sql, /REFERENCES/i, `${table} still carries a foreign key this fixture cannot satisfy`);
    return sql;
  }
  assert.fail(`the baseline no longer defines ${table}`);
}

const SCHEMA = [
  ddl('capital_calls'),
  ddl('limited_partners'),
  ddl('vc_funds'),
  ddl('job_idempotency'),
  // `activity_logs` is where the notices land. Narrow on purpose — the columns
  // the job binds and nothing else.
  `CREATE TABLE activity_logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
     actor TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));`,
  `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);`,
].join('\n');

const FUND = 1;

/**
 * Two LPs with UNEQUAL commitments, which the pro-rata split needs to be
 * meaningful, and a third that is neither committed nor active.
 *
 * 400 and 600 against a 1000 total make the shares 40% and 60% — so a bug that
 * divided equally per head would show up as 500/500 rather than hiding behind
 * two identical numbers.
 */
const SEED = `
INSERT INTO users (id, email, name) VALUES (10, 'a@lp.test', 'LP A'), (20, 'b@lp.test', 'LP B'), (30, 'c@lp.test', 'LP C');
INSERT INTO vc_funds (id, name, status, total_commitment, deployed_capital, lp_count)
  VALUES (${FUND}, 'Fund I', 'active', 1000, 0, 3);
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, invested_amount, status)
  VALUES (100, ${FUND}, 10, 'LP A', 'a@lp.test', 400, 0, 'committed'),
         (200, ${FUND}, 20, 'LP B', 'b@lp.test', 600, 0, 'active'),
         (300, ${FUND}, 30, 'LP C', 'c@lp.test', 999, 0, 'redeemed');
`;

function env(seed = SEED) {
  const { DB, db } = makeD1(SCHEMA, seed);
  return { DB, __db: db } as any;
}

/** The job, as the consumer calls it — note `id: 0`, which the queue path uses. */
function job(payload: Record<string, unknown>) {
  return {
    id: 0,
    job_type: 'capital_call_notice' as const,
    payload: JSON.stringify(payload),
    status: 'processing' as const,
    attempts: 1,
    max_retries: 3,
    error: null,
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
    started_at: '2026-09-13T00:00:00Z',
    completed_at: null,
    dead_at: null,
  };
}

const calls = (e: any) =>
  e.__db.prepare('SELECT * FROM capital_calls ORDER BY limited_partner_id').all() as any[];
const notices = (e: any) =>
  e.__db.prepare("SELECT * FROM activity_logs WHERE action = 'capital_call_notice' ORDER BY id").all() as any[];
const deployed = (e: any) =>
  Number((e.__db.prepare('SELECT deployed_capital FROM vc_funds WHERE id = ?').get(FUND) as any).deployed_capital);

// ------------------------------------------------------------------ the write

test('a call writes one pro-rata row per committed or active LP', async () => {
  const e = env();
  await handleJob(e, job({ fund_id: FUND, amount_cents: 250_000, call_uid: 'call-a' }));

  const rows = calls(e);
  assert.equal(rows.length, 2, 'one row per billable LP, and the redeemed LP is not one');
  assert.deepEqual(rows.map((r) => r.limited_partner_id), [100, 200]);

  // 400/1000 and 600/1000 of $2,500. Unequal on purpose — an equal split would
  // give 1250/1250 and this assertion is what tells the two apart.
  assert.equal(rows[0].amount, 1000);
  assert.equal(rows[1].amount, 1500);
  // AND THEY SUM TO THE CALL. A split that loses a cent to rounding is a
  // receivable that can never be fully paid.
  assert.equal(rows[0].amount + rows[1].amount, 2500);

  // DOLLARS, not cents: the route speaks cents and the column is REAL dollars.
  assert.ok(rows.every((r) => r.amount < 250_000), 'amount was stored in cents');

  for (const r of rows) {
    assert.equal(r.status, 'pending', 'a new call is owed, not paid');
    assert.equal(r.paid_date, null, "and nothing has been paid, so there is no date");
    assert.equal(r.due_date, null, 'no due date was supplied, so none is invented');
    assert.ok(r.uid, 'every row carries the uid that makes it idempotent');
  }

  // One notice per row, and the figure in it is the figure in the ledger.
  const logged = notices(e);
  assert.equal(logged.length, 2);
  assert.match(logged[0].details, /\$1000\.00 due \(pro-rata of \$2500\)/);
  assert.match(logged[1].details, /\$1500\.00 due \(pro-rata of \$2500\)/);
  assert.deepEqual(logged.map((r) => r.user_id), [10, 20]);
});

test('a due date the GP supplied is kept, and only that one', async () => {
  const e = env();
  await handleJob(e, job({
    fund_id: FUND, amount_cents: 100_000, call_uid: 'call-due', due_date: '2026-10-15',
  }));
  assert.deepEqual(calls(e).map((r) => r.due_date), ['2026-10-15', '2026-10-15']);
});

// ------------------------------------------------------------------ the retry

test('a retry writes no second row and sends no second notice', async () => {
  // THE ASSERTION THIS WHOLE DESIGN EXISTS FOR. `Jobs.markFailed` re-arms the
  // same row, so the handler runs again with the same payload — and a doubled
  // receivable is worse than a missing one.
  const e = env();
  const call = job({ fund_id: FUND, amount_cents: 250_000, call_uid: 'call-a' });
  await handleJob(e, call);
  await handleJob(e, call);
  await handleJob(e, call);

  const rows = calls(e);
  assert.equal(rows.length, 2, 'three runs of one call produced more than one set of rows');
  assert.equal(rows[0].amount + rows[1].amount, 2500, 'the receivable doubled');
  assert.equal(notices(e).length, 2, 'the LPs were told more than once');
});

test('a retry after a partial write fills only the gap, and notices only that', async () => {
  // The half-done case, which a clean-retry test cannot reach: one row landed,
  // the process died, the job runs again. It must complete the set rather than
  // duplicating what is there or refusing because something already exists.
  const e = env();
  const call = job({ fund_id: FUND, amount_cents: 250_000, call_uid: 'call-a' });
  await handleJob(e, call);
  // Delete LP 200's row and its notice — the state a mid-batch failure leaves.
  e.__db.exec('DELETE FROM capital_calls WHERE limited_partner_id = 200');
  e.__db.exec('DELETE FROM activity_logs');

  await handleJob(e, call);

  const rows = calls(e);
  assert.equal(rows.length, 2, 'the missing row was not filled in');
  assert.equal(rows.find((r) => r.limited_partner_id === 200)!.amount, 1500);
  const logged = notices(e);
  assert.equal(logged.length, 1, 'the LP whose row already existed was told again');
  assert.equal(logged[0].user_id, 20, 'and the wrong LP was told');
});

test('two different calls on one fund both land', async () => {
  // THE CASE A `job.id`-KEYED UID WOULD HAVE BROKEN. The CF Queue consumer calls
  // `handleJob` with a hardcoded `id: 0` — as this file's `job()` does — so a uid
  // built from the job id would be identical for every call ever issued, and the
  // second one would be silently swallowed by `INSERT OR IGNORE`. The key has to
  // identify the CALL, which is why the route mints `call_uid`.
  const e = env();
  await handleJob(e, job({ fund_id: FUND, amount_cents: 250_000, call_uid: 'call-a' }));
  await handleJob(e, job({ fund_id: FUND, amount_cents: 100_000, call_uid: 'call-b' }));

  const rows = calls(e);
  assert.equal(rows.length, 4, 'a second, genuinely different call was swallowed');
  const byLp = (id: number) => rows.filter((r) => r.limited_partner_id === id).map((r) => r.amount).sort((a, b) => a - b);
  assert.deepEqual(byLp(100), [400, 1000]);
  assert.deepEqual(byLp(200), [600, 1500]);
  assert.equal(notices(e).length, 4);
});

test('a payload with no call_uid still works, and dedupes per amount', async () => {
  // An in-flight job enqueued before this change, or a hand-crafted
  // `/api/infra/enqueue`. It must not throw. The fallback keys on the fund and
  // the amount, so two IDENTICAL hand-enqueued calls collapse into one — a lost
  // duplicate rather than a doubled receivable, which is the right way round.
  const e = env();
  await handleJob(e, job({ fund_id: FUND, amount_cents: 250_000 }));
  assert.equal(calls(e).length, 2);
  await handleJob(e, job({ fund_id: FUND, amount_cents: 250_000 }));
  assert.equal(calls(e).length, 2, 'the legacy fallback is not idempotent');
  // A different amount is a different call and does land.
  await handleJob(e, job({ fund_id: FUND, amount_cents: 100_000 }));
  assert.equal(calls(e).length, 4);
});

// ------------------------------------------------- the figure it must not move

test('issuing a call does not move deployed_capital', async () => {
  // THE DOUBLE-COUNT THIS CHANGE WOULD OTHERWISE HAVE INTRODUCED. `POST
  // /capital/calls/:id/pay` already adds a paid call's amount to
  // `deployed_capital`, and `capital.test.ts` pins that. Before task #197 the job
  // could bump the same figure at issuance harmlessly, because it wrote no row
  // and so nothing could ever be paid. Writing the row makes issuing-then-paying
  // count the same money twice, so the issuance bump had to go.
  const e = env();
  assert.equal(deployed(e), 0);
  await handleJob(e, job({ fund_id: FUND, amount_cents: 250_000, call_uid: 'call-a' }));
  assert.equal(deployed(e), 0, 'the job moved a figure that means money paid out');

  // And the pay path is still the thing that moves it — simulated here with the
  // same statement `routes/capital.ts` runs, because this file does not boot Hono.
  const row = calls(e)[0];
  e.__db.prepare("UPDATE capital_calls SET status = 'paid', paid_date = date('now') WHERE id = ?").run(row.id);
  e.__db.prepare('UPDATE vc_funds SET deployed_capital = deployed_capital + ? WHERE id = ?').run(row.amount, FUND);
  assert.equal(deployed(e), 1000, 'paying a call the job wrote must move it exactly once');
});

// ------------------------------------------------------------- the empty cases

test('a fund with nothing to call writes nothing and does not throw', async () => {
  // Each of these is a legitimate state, not an error: a fund with no LPs yet, and
  // a fund whose LPs have all committed zero. A throw here would dead-letter the
  // job and page somebody about a fund that simply has no investors.
  const noLps = env(`
    INSERT INTO vc_funds (id, name, status, total_commitment, deployed_capital)
      VALUES (${FUND}, 'Empty', 'active', 0, 0);
  `);
  await handleJob(noLps, job({ fund_id: FUND, amount_cents: 100_000, call_uid: 'x' }));
  assert.equal(calls(noLps).length, 0);

  const zeroCommit = env(`
    INSERT INTO users (id, email, name) VALUES (10, 'a@lp.test', 'LP A');
    INSERT INTO vc_funds (id, name, status, total_commitment, deployed_capital)
      VALUES (${FUND}, 'Zero', 'active', 0, 0);
    INSERT INTO limited_partners (id, fund_id, user_id, commitment_amount, invested_amount, status)
      VALUES (100, ${FUND}, 10, 0, 0, 'active');
  `);
  await handleJob(zeroCommit, job({ fund_id: FUND, amount_cents: 100_000, call_uid: 'y' }));
  assert.equal(calls(zeroCommit).length, 0, 'a zero-commitment LP got a receivable');
  assert.equal(notices(zeroCommit).length, 0);
});

test('a zero share writes no row even when other LPs are billable', async () => {
  // The mixed case the two empty ones above cannot reach: one LP has committed
  // nothing, the others have. A zero-dollar receivable on a page whose job is to
  // say what is owed is noise, so it is skipped rather than stored.
  const e = env(`
    INSERT INTO users (id, email, name) VALUES (10, 'a@lp.test', 'A'), (20, 'b@lp.test', 'B');
    INSERT INTO vc_funds (id, name, status, total_commitment, deployed_capital)
      VALUES (${FUND}, 'Mixed', 'active', 400, 0);
    INSERT INTO limited_partners (id, fund_id, user_id, commitment_amount, invested_amount, status)
      VALUES (100, ${FUND}, 10, 400, 0, 'active'),
             (200, ${FUND}, 20, 0,   0, 'active');
  `);
  await handleJob(e, job({ fund_id: FUND, amount_cents: 100_000, call_uid: 'z' }));
  const rows = calls(e);
  assert.equal(rows.length, 1, 'the zero-commitment LP was billed');
  assert.equal(rows[0].limited_partner_id, 100);
  assert.equal(rows[0].amount, 1000, 'the whole call went to the only committed LP');
});

test('a call with no fund or no amount is refused loudly', async () => {
  // These ARE errors — a caller that lost the fund id or the amount has a bug,
  // and a silent return would hide it. Throwing dead-letters the job, which is
  // where a payload bug belongs.
  const e = env();
  await assert.rejects(() => handleJob(e, job({ amount_cents: 100 })), /fund_id and amount_cents required/);
  await assert.rejects(() => handleJob(e, job({ fund_id: FUND, amount_cents: 0 })), /fund_id and amount_cents required/);
  assert.equal(calls(e).length, 0);
});
