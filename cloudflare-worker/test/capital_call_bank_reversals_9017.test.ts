/**
 * D9017 (#9017) — the bank-reversal store on its own: the cause read from a
 * bank line's change, which reversal a line shows, and what the table keeps.
 *
 * The journey through the real routers (detection in the sync, the GP's and
 * the investor's reads, the resolve act and its gate) is in
 * `fund_reconciliation_journey_d8534.test.ts`. This file holds the edges that
 * journey has one receipt per line for. Real node:sqlite, synthetic rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/capital_call_bank_reversals_9017.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys } from './_baseline.mjs';
import { lineBankReversed, resolveReversal, reversalCause, reversalsForLines } from '../src/services/capitalCallBankReversals.ts';
import { VOIDED_STATUSES } from '../src/services/mercury/store.ts';

const MIGRATION = readFileSync(new URL('../sql/migrations/202611272146_9017_capital_call_bank_reversals.sql', import.meta.url), 'utf8');
const SCHEMA = `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER);
${stripForeignKeys(MIGRATION)}`;
const SEED = `INSERT INTO users (id, name) VALUES (40, 'Fixture GP'), (1, 'Fixture Admin');`;

function world() {
  const { DB, db } = makeD1(SCHEMA, SEED);
  const add = (uid: string, line: number, receipt: number, detected: string, fund = 1) => db.prepare(
    `INSERT INTO capital_call_bank_reversals (uid, fund_id, capital_call_id, receipt_id, match_id, transaction_id, cause, bank_status,
       bank_amount_cents, receipt_cents, detected_at) VALUES (?, ?, ?, ?, ?, ?, 'failed', 'failed', 400000, 400000, ?)`,
  ).run(uid, fund, line, receipt, receipt, receipt, detected);
  return { env: { DB } as any, db, add };
}

test('the cause: a voided status names itself, an amount change alone is restated, anything else is no reversal', () => {
  assert.equal(reversalCause({ status: 'failed', amount_cents: 600_000 }, 600_000, VOIDED_STATUSES), 'failed');
  assert.equal(reversalCause({ status: 'Cancelled', amount_cents: 600_000 }, 600_000, VOIDED_STATUSES), 'cancelled');
  assert.equal(reversalCause({ status: 'sent', amount_cents: 400_000 }, 600_000, VOIDED_STATUSES), 'restated');
  assert.equal(reversalCause({ status: 'sent', amount_cents: 600_000 }, 600_000, VOIDED_STATUSES), null);
  assert.equal(reversalCause({ status: null, amount_cents: 600_000 }, 600_000, VOIDED_STATUSES), null);
});

test('a line with two reversed receipts reads the open one; with both resolved, the newest', async () => {
  const w = world();
  // The partial case: two receipts on one line, both reversed. The older is still open, the newer is resolved.
  w.add('r-old', 7, 1, '2026-11-20 09:00:00');
  w.add('r-new', 7, 2, '2026-11-25 09:00:00');
  w.add('r-other', 8, 3, '2026-11-26 09:00:00');
  assert.equal((await resolveReversal(w.env, { fundId: 1, uid: 'r-new', userId: 40, note: 'The second wire was re-sent.' })).kind, 'resolved');
  const rows = await reversalsForLines(w.env, [7]);
  assert.deepEqual(rows.map((r) => r.uid), ['r-old', 'r-new'], 'open first, then newest; only the asked lines');
  assert.deepEqual(lineBankReversed(rows, 7), { detected_at: '2026-11-20 09:00:00', resolved_at: null });
  assert.equal(lineBankReversed(rows, 8), null, 'a line not asked for reads nothing');
  assert.equal((await resolveReversal(w.env, { fundId: 1, uid: 'r-old', userId: 1, note: 'The first wire was re-sent.' })).kind, 'resolved');
  const after = await reversalsForLines(w.env, [7]);
  assert.deepEqual(after.map((r) => r.uid), ['r-new', 'r-old'], 'all resolved: newest first');
  assert.equal(lineBankReversed(after, 7)?.detected_at, '2026-11-25 09:00:00');
  assert.deepEqual(after.map((r) => r.resolved_by_name), ['Fixture GP', 'Fixture Admin']);
  assert.deepEqual(await reversalsForLines(w.env, []), []);
});

test('resolve is scoped to its fund, said once, and audited once', async () => {
  const w = world();
  w.add('r-1', 7, 1, '2026-11-20 09:00:00');
  assert.equal((await resolveReversal(w.env, { fundId: 2, uid: 'r-1', userId: 40, note: 'Another fund entirely.' })).kind, 'not_found');
  assert.equal((await resolveReversal(w.env, { fundId: 1, uid: 'nope', userId: 40, note: 'No such reversal here.' })).kind, 'not_found');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()!.n, 0);
  const first = await resolveReversal(w.env, { fundId: 1, uid: 'r-1', userId: 40, note: 'Re-sent on the same day.' });
  assert.equal(first.kind, 'resolved');
  const second = await resolveReversal(w.env, { fundId: 1, uid: 'r-1', userId: 1, note: 'A later second attempt.' });
  assert.equal(second.kind, 'already_resolved');
  assert.equal(second.kind === 'already_resolved' && second.reversal.resolved_by_name, 'Fixture GP');
  assert.deepEqual(w.db.prepare('SELECT action, user_id, details FROM activity_logs').all().map((r: any) => ({ ...r })), [
    { action: 'capital_call_bank_reversal_resolved', user_id: 40, details: JSON.stringify({ fund_id: 1, reversal_uid: 'r-1' }) },
  ]);
});

test('the table keeps what it holds: one row per receipt, the resolution columns together, and nothing rewritten or deleted', () => {
  const w = world();
  w.add('r-1', 7, 1, '2026-11-20 09:00:00');
  assert.throws(() => w.add('r-2', 7, 1, '2026-11-21 09:00:00'), /UNIQUE constraint failed: capital_call_bank_reversals\.receipt_id/);
  // A resolution needs all three columns and a note of ten characters or more.
  assert.throws(() => w.db.prepare(`UPDATE capital_call_bank_reversals SET resolved_at = datetime('now') WHERE uid = 'r-1'`).run(), /CHECK constraint failed/);
  assert.throws(() => w.db.prepare(`UPDATE capital_call_bank_reversals SET resolved_at = datetime('now'), resolved_by = 40, resolution_note = 'short' WHERE uid = 'r-1'`).run(), /CHECK constraint failed/);
  // What was detected is never rewritten, open or resolved.
  assert.throws(() => w.db.prepare(`UPDATE capital_call_bank_reversals SET receipt_cents = 1 WHERE uid = 'r-1'`).run(), /what was detected is kept/);
  assert.throws(() => w.db.prepare(`UPDATE capital_call_bank_reversals SET detected_at = '2026-01-01 00:00:00' WHERE uid = 'r-1'`).run(), /what was detected is kept/);
  w.db.prepare(`UPDATE capital_call_bank_reversals SET resolved_at = datetime('now'), resolved_by = 40, resolution_note = 'Resolved by hand.' WHERE uid = 'r-1'`).run();
  assert.throws(() => w.db.prepare(`UPDATE capital_call_bank_reversals SET resolved_by = 1 WHERE uid = 'r-1'`).run(), /resolution is final/);
  assert.throws(() => w.db.prepare(`DELETE FROM capital_call_bank_reversals WHERE uid = 'r-1'`).run(), /is kept/);
  assert.equal(w.db.prepare('SELECT resolved_by FROM capital_call_bank_reversals').get()!.resolved_by, 40);
});
