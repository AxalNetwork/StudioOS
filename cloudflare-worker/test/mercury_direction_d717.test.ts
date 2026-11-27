/**
 * D717 (#1782) decision 12, #1856 — `GET /api/admin/mercury/transactions`'
 * `direction` filter. The Bank accounts console counts unmatched receipts per
 * entity, and a receipt is a credit: `match=none` alone counts debits too.
 *
 * Fixture: two credits and one debit on the Fund's account, one credit on the
 * GP's, nothing matched; then a credit with a live match and one with an
 * active Not ours mark. Every id, ending and amount is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_direction_d717.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, JTI, appFor, call, envFor, freshDb, rows } from './_mercury_fixture.ts';

function seed() {
  const db = freshDb();
  db.exec(`INSERT INTO mercury_entity_connections (id, uid, entity_key, status, credentials_enc, connected_by) VALUES
    (1, 'c-fund', 'fund', 'active', 'v1.x', 901), (2, 'c-gp', 'gp', 'active', 'v1.y', 901)`);
  db.exec(`INSERT INTO mercury_accounts (id, uid, mercury_account_id, connection_id, entity_key, kind, last_four, registered) VALUES
    (1, '${'a'.repeat(32)}', 'acc-fund', 1, 'fund', 'checking', '1212', 1),
    (2, '${'b'.repeat(32)}', 'acc-gp', 2, 'gp', 'checking', '3434', 1)`);
  return db;
}
let n = 0;
function line(db: any, account: number, cents: number, day = '2026-09-20') {
  n += 1;
  db.prepare(`INSERT INTO mercury_transactions (uid, mercury_transaction_id, account_id, amount_cents, created_on, posted_on, status, kind)
              VALUES (?, ?, ?, ?, ?, ?, 'sent', 'incomingDomesticWire')`).run(`d${String(n).padStart(31, '0')}`, `dx-${n}`, account, cents, day, day);
  return db.prepare('SELECT * FROM mercury_transactions WHERE mercury_transaction_id = ?').get(`dx-${n}`) as any;
}
const list = async (env: any, qs: string) => call(appFor(), env, 'GET', `/transactions?${qs}`, ADMIN, { jti: JTI.adminTotp });

function fixture() {
  const db = seed();
  const credit1 = line(db, 1, 120000);
  const credit2 = line(db, 1, 45000, '2026-09-21');
  const debit = line(db, 1, -9900);
  const gpCredit = line(db, 2, 70000);
  return { db, env: envFor(db), credit1, credit2, debit, gpCredit };
}

test('#1856 direction=credit with match=none counts and lists only the entity\'s unmatched credits', async () => {
  const { env, credit1, credit2 } = fixture();
  const r = await list(env, 'entity=fund&match=none&direction=credit');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.total, 2, 'the total counts credits only');
  assert.deepEqual(r.body.items.map((t: any) => t.uid).sort(), [credit1.uid, credit2.uid].sort());
  assert.ok(r.body.items.every((t: any) => t.amount_cents > 0));
});

test('#1856 direction=debit lists only the debit; no direction lists all three, as before', async () => {
  const { env, debit } = fixture();
  const d = await list(env, 'entity=fund&direction=debit');
  assert.equal(d.status, 200, d.text);
  assert.equal(d.body.total, 1);
  assert.deepEqual(d.body.items.map((t: any) => t.uid), [debit.uid]);
  const all = await list(env, 'entity=fund&match=none');
  assert.equal(all.body.total, 3);
  assert.equal(all.body.items.length, 3);
});

test('#1856 an unknown direction answers 400 invalid_direction', async () => {
  const { env } = fixture();
  const r = await list(env, 'entity=fund&direction=sideways');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'invalid_direction');
  assert.equal(r.body.detail, 'Direction is credit or debit.');
});

test('#1856 the audit row carries the direction', async () => {
  const { db, env } = fixture();
  await list(env, 'entity=fund&match=none&direction=credit');
  const audits = rows(db, "SELECT filters_json FROM admin_audit_log WHERE action = 'mercury_transactions_read'");
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0].filters_json).direction, 'credit');
});

test('#1856 a credit with a live match, or an active Not ours mark, stays out of match=none&direction=credit', async () => {
  const { db, env, credit1, credit2 } = fixture();
  db.prepare(`INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents)
              VALUES ('m-1', ?, 'capital_call_line', 1, 'proposed', 'manual', ?)`).run(credit1.id, credit1.amount_cents);
  db.prepare(`INSERT INTO mercury_not_ours (uid, transaction_id, reason, state, amount_cents, marked_by)
              VALUES ('no-1', ?, 'duplicate', 'active', ?, 902)`).run(credit2.id, credit2.amount_cents);
  const r = await list(env, 'entity=fund&match=none&direction=credit');
  assert.equal(r.body.total, 0);
  assert.deepEqual(r.body.items, []);
});
