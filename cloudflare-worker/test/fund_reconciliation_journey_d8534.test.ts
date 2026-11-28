/**
 * D8534 (#8534) — one synthetic investor journey, admission to distribution,
 * with bank-feed reconciliation and its five failure cases, on node:sqlite
 * through the real routers and services.
 *
 * The fund is a fixture Fund I (`spinout-fund-i`) with two investors. The
 * bank feed is `mercuryStub` from `_mercury_fixture.ts`: every Mercury read
 * goes to it, nothing goes to the network, and every account number, id and
 * amount here is invented.
 *
 * The journey: an investor is invited, bound to an identity and admitted
 * after approval; a capital call is issued; the bank feed shows the receipt;
 * the receipt is reconciled (the matched receipt on the call line, and the
 * cash line of the operational ledger against the bank line); a distribution
 * is recorded. After every step `agree()` checks that the approvals, the
 * ledger and each investor's own view say the same thing, and `invariants()`
 * checks the three invariants:
 *
 *   INV1  one bank item never settles two obligations;
 *   INV2  every balance change has an approval behind it;
 *   INV3  no fund flow reaches a Stripe payment path.
 *
 * The cases: duplicate, partial, unmatched, reversed, revoked. Each names its
 * end state; where the platform has no concept for a step (no reversal of a
 * receipt, no link from an approved application to an LP row) the test pins
 * what exists and D8534.md records the gap.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_reconciliation_journey_d8534.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import funds from '../src/routes/funds.ts';
import capital from '../src/routes/capital.ts';
import fundLedger from '../src/routes/fund_ledger.ts';
import adminLpApplications from '../src/routes/admin_lp_applications.ts';
import { createAdminMercury } from '../src/routes/admin_mercury.ts';
import { syncConnection } from '../src/services/mercury/sync.ts';
import { encryptToken } from '../src/services/mercury/store.ts';
import { claimLpRowsAtSignIn } from '../src/services/lpClaim.ts';
import { handleJob } from '../src/services/queueWorker.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { fundUnmatchedCount } from '../src/services/fundCashSummary.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { mercuryStub, account, type StubState, type StubTxn } from './_mercury_fixture.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const BASELINE = read('../sql/schema_baseline.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MERCURY_TOKEN = 'fixture-not-a-token-8534';

/* ── INV3, the runtime half: nothing in this file may reach the network ──── */

/**
 * Every global fetch is recorded and refused. The Mercury stub is handed to
 * the sync as its fetcher, so it never passes through here: anything that
 * does is a request a fund flow made on its own, and a Stripe one is the
 * payment path INV3 forbids.
 */
const outbound: string[] = [];
globalThis.fetch = (async (input: any) => {
  outbound.push(String(input?.url ?? input));
  throw new Error('D8534: no network in the fund reconciliation fixture');
}) as typeof fetch;

/* ── the world ──────────────────────────────────────────────────────────── */

const ADMIN = 1;      // HQ Admin: reviews applications, confirms bank matches
const SUPER = 2;      // Super Admin: assigns the ledger's administrator
const ADMIN2 = 3;     // a second Admin, whose authority the revoked case removes
const LP_A = 10;      // investor A: account exists, address not yet verified at invite
const LP_B = 20;      // investor B: verified account, bound at invite
const GP = 40;        // the GP of record (institutional investor)
const FA = 50;        // the fund administrator of the operational ledger
const OTHER_GP = 60;  // an institutional investor who is not this fund's GP of record
const FUND = 1;
const COMMIT_A = 6000;  // dollars, as `limited_partners.commitment_amount` stores them
const COMMIT_B = 4000;
const CALL_CENTS = 1_000_000;
const SHARE_A = 600_000;
const SHARE_B = 400_000;
const LAST4 = '4321';
const JTI: Record<number, string> = { [ADMIN]: 'totp-admin', [SUPER]: 'totp-super', [ADMIN2]: 'totp-admin2' };

const day = (d: Date) => d.toISOString().slice(0, 10);
// The call header is stamped by SQLite's datetime('now'), and the matcher's window opens there, so the bank dates follow the real day.
const TODAY = day(new Date()); // clock-ok: relative
const plus = (iso: string, n: number) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
const DUE = plus(TODAY, 30);
const YEAR = TODAY.slice(0, 4);

const TABLES = ['users', 'super_admins', 'user_sessions', 'vc_funds', 'limited_partners', 'capital_calls', 'projects',
  'partners', 'activity_logs', 'activity_stats', 'notifications', 'queue_jobs', 'liquidity_events', 'fund_distributions',
  'fund_report_periods', 'portfolio_positions', 'legal_documents', 'lp_applications', 'admin_audit_log'];

const SCHEMA = [
  ...TABLES.map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))),
  'CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);',
  stripForeignKeys(read('../sql/migrations/264_admin_notices.sql')),
  read('../sql/migrations/312_fund_call_ledger.sql'),
  read('../sql/migrations/418_fund_ledger.sql'),
  read('../sql/migrations/473_fund_management_fees.sql'),
  read('../sql/migrations/202611152336_6238_capital_call_amendments.sql'),
  // D9017: the bank-reversed state a person resolves.
  read('../sql/migrations/202611272146_9017_capital_call_bank_reversals.sql'),
  ...['417_fund_position_valuations.sql', '472_entity_bank_accounts.sql', '474_mercury_entity_connections.sql',
    '476_fund_report_drafts.sql', '483_mercury_not_ours.sql'].map((m) => read(`../sql/migrations/${m}`)),
].join('\n');

const SEED = `
INSERT INTO users (id, email, name, role, is_active, email_verified, investor_tier, investor_subscription_status, kyc_status) VALUES
  (${ADMIN}, 'admin@example.test', 'Fixture Admin', 'admin', 1, 1, 'free', 'active', 'approved'),
  (${SUPER}, 'super@example.test', 'Fixture Super', 'admin', 1, 1, 'free', 'active', 'approved'),
  (${ADMIN2}, 'admin2@example.test', 'Fixture Admin Two', 'admin', 1, 1, 'free', 'active', 'approved'),
  (${LP_A}, 'lp-a@example.test', 'Fixture LP A', 'investor', 1, 0, 'free', 'active', 'approved'),
  (${LP_B}, 'lp-b@example.test', 'Fixture LP B', 'investor', 1, 1, 'free', 'active', 'approved'),
  (${GP}, 'gp@example.test', 'Fixture GP', 'investor', 1, 1, 'institutional', 'active', 'approved'),
  (${FA}, 'fa@example.test', 'Fixture Fund Administrator', 'investor', 1, 1, 'free', 'active', 'approved'),
  (${OTHER_GP}, 'other-gp@example.test', 'Fixture Other GP', 'investor', 1, 1, 'institutional', 'active', 'approved');
INSERT INTO super_admins (user_id) VALUES (${SUPER});
INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES
  (${ADMIN}, 'totp-admin', 'totp', datetime('now')),
  (${SUPER}, 'totp-super', 'totp', datetime('now')),
  (${ADMIN2}, 'totp-admin2', 'totp', datetime('now'));
INSERT INTO vc_funds (id, name, slug, gp_user_id, carried_interest, management_fee, fund_admin_user_id)
  VALUES (${FUND}, 'Fixture Fund I', 'spinout-fund-i', ${GP}, 0.2, 0.02, ${FA});
INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, target_commitment, accredited, status) VALUES
  (1, ${LP_A}, 'spinout-fund-i', 'individual', ${COMMIT_A}, 1, 'pending'),
  (2, ${LP_B}, 'spinout-fund-i', 'individual', ${COMMIT_B}, 1, 'pending');
INSERT INTO mercury_entity_connections (id, uid, entity_key, status, credentials_enc, connected_by)
  VALUES (1, 'conn-fund-8534', 'fund', 'active', 'v1.replaced-below', ${SUPER});
`;

const app = new Hono<any>();
app.route('/api/funds', funds);
app.route('/api/capital', capital);
app.route('/api/fund-ledger', fundLedger);
app.route('/api/admin/lp-applications', adminLpApplications);
app.route('/api/admin/mercury', createAdminMercury());
// Production's error table (`index.ts`): a gate's thrown sentence answers its status.
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function token(user: number, support = false): Promise<string> {
  return new SignJWT({ user_id: user, ...(JTI[user] ? { jti: JTI[user] } : {}), ...(support ? { impersonated_by: SUPER } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

type World = Awaited<ReturnType<typeof world>>;

async function world() {
  const { DB, db } = makeD1(SCHEMA, SEED);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB };
  // The Fund's account for capital contributions (D708): a call on Fund I is held without one.
  const regUid = '0000aaaa-0000-4000-8000-000000008534';
  const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', regUid, `90817263${LAST4}`);
  db.prepare(`INSERT INTO entity_bank_accounts (uid, entity_key, label, bank_name, bank_address, beneficiary_name,
      beneficiary_address, account_kind, account_number_enc, account_last4, routing_number, purposes_json, recorded_by)
    VALUES (?, 'fund', 'Fixture Fund checking', 'Fixture Bank', '1 Fixture Way', 'Axal VC Spin-Out Lab Fund I LP', '2 Fixture Way',
      'checking', ?, ?, '000000017', '["capital_contribution","gp_commitment"]', ?)`).run(regUid, enc, LAST4, SUPER);
  db.prepare('UPDATE mercury_entity_connections SET credentials_enc = ? WHERE id = 1')
    .run(await encryptToken(env, 'conn-fund-8534', MERCURY_TOKEN));

  const bank: StubState = { accounts: [account('acc-fund-8534', 'checking', LAST4)], org: { id: 'org-fixture', legalBusinessName: 'Fixture Fund I LP' }, txns: { 'acc-fund-8534': [] } };
  const stub = mercuryStub(bank);

  async function call(as: number, method: string, path: string, body?: unknown, opts: { support?: boolean } = {}) {
    const res: Response = await (app.request(path, {
      method,
      headers: { Authorization: `Bearer ${await token(as, opts.support)}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env) as Promise<Response>).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
    let json: any = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json };
  }

  /** The bank shows a line; `sync()` reads it through the read-only client and runs the matcher. */
  let seq = 0;
  function wire(amount: string, extra: Partial<StubTxn> = {}): StubTxn {
    seq += 1;
    const t: StubTxn = { id: `txn-fixture-${String(seq).padStart(4, '0')}`, amount, createdAt: `${TODAY}T14:00:00Z`,
      postedAt: `${TODAY}T15:00:00Z`, status: 'sent', kind: 'incomingDomesticWire', counterpartyName: `Fixture payer ${seq}`, ...extra };
    bank.txns['acc-fund-8534'].push(t);
    return t;
  }
  async function sync() {
    const out = await syncConnection(env, 1, 'manual', { fetcher: stub.fetcher });
    assert.ok(out.status === 'ok', `sync: ${JSON.stringify(out)}`);
    return out;
  }
  const rows = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];
  const one = (sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
  return { env, db, call, bank, stub, wire, sync, rows, one };
}

/* ── the three views: approvals, ledger, the investor's own ─────────────── */

/** The call ledger as stored: each line's owed and received cents, each LP's and the fund's credited cents. */
function ledger(w: World) {
  const lines = w.rows(`SELECT cc.id, cc.limited_partner_id AS lp, cc.status,
      COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER)) AS owed,
      COALESCE((SELECT SUM(r.amount_cents) FROM capital_call_receipts r WHERE r.capital_call_id = cc.id), 0) AS received
    FROM capital_calls cc ORDER BY cc.id`);
  const lps = w.rows(`SELECT id, user_id, status, CAST(ROUND(invested_amount * 100) AS INTEGER) AS invested FROM limited_partners ORDER BY id`);
  const deployed = w.one(`SELECT CAST(ROUND(deployed_capital * 100) AS INTEGER) AS c FROM vc_funds WHERE id = ${FUND}`).c;
  return { lines, lps, deployed };
}

/** What investor `user` reads on their own portal. */
async function portal(w: World, user: number) {
  const r = await w.call(user, 'GET', '/api/funds/lp-portal');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.capital_calls_recorded, true);
  return r.body;
}

/**
 * After every step: each investor's portal shows exactly the ledger's lines
 * for their own LP rows, with the same owed and received cents and status,
 * and the same paid-in and distributions; no investor sees the other's.
 */
async function agree(w: World, step: string) {
  const l = ledger(w);
  for (const user of [LP_A, LP_B]) {
    const mine = l.lps.filter((lp) => lp.user_id === user);
    const view = await portal(w, user);
    const expectLines = l.lines.filter((x) => mine.some((lp) => lp.id === x.lp))
      .map((x) => ({ id: x.id, owed: x.owed, received: x.received, status: x.status }));
    const seen = view.capital_calls.map((c: any) => ({ id: c.id, owed: Number(c.owed_cents), received: Number(c.received_cents), status: c.status }))
      .sort((a: any, b: any) => a.id - b.id);
    assert.deepEqual(seen, expectLines, `${step}: investor ${user}'s calls match the ledger`);
    for (const lp of mine) {
      const perf = view.performance.find((p: any) => p.lp_id === lp.id);
      assert.ok(perf, `${step}: investor ${user} sees LP row ${lp.id}`);
      assert.equal(Math.round(perf.invested_amount * 100), lp.invested, `${step}: investor ${user}'s paid-in matches the ledger`);
      const paid = w.one(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM fund_distributions WHERE lp_id = ? AND status = 'paid'`, lp.id).c;
      assert.equal(Math.round(perf.distributions_dollars * 100), paid, `${step}: investor ${user}'s distributions are the paid ones`);
    }
    assert.equal(view.performance.length, mine.length, `${step}: investor ${user} sees only their own LP rows`);
  }
  invariants(w, step);
}

/* ── the invariants ─────────────────────────────────────────────────────── */

/** INV1: one bank item never settles two obligations. */
function oneBankItemOneObligation(w: World, step: string) {
  // A bank line's reference sits on at most one receipt (one call line).
  assert.deepEqual(w.rows(`SELECT reference, COUNT(*) AS n FROM capital_call_receipts WHERE reference LIKE 'mercury:%'
      GROUP BY reference HAVING COUNT(*) > 1`), [], `${step}: a bank line receipted twice`);
  // A bank line has at most one live match.
  assert.deepEqual(w.rows(`SELECT transaction_id FROM mercury_matches WHERE state <> 'rejected'
      GROUP BY transaction_id HAVING COUNT(*) > 1`), [], `${step}: a bank line with two live matches`);
  // A confirmed capital-call match settles its own target with its own bank line, for its own cents.
  for (const m of w.rows(`SELECT m.*, t.mercury_transaction_id AS mtid FROM mercury_matches m JOIN mercury_transactions t ON t.id = m.transaction_id
      WHERE m.target_kind = 'capital_call_line' AND m.state = 'confirmed'`)) {
    const r = w.one('SELECT * FROM capital_call_receipts WHERE id = ?', m.receipt_id);
    assert.ok(r, `${step}: confirmed match ${m.uid} has its receipt`);
    assert.deepEqual([r.capital_call_id, r.amount_cents, r.reference], [m.target_id, m.amount_cents, `mercury:${m.mtid}`],
      `${step}: confirmed match ${m.uid} settles its own line with its own bank line`);
  }
  // A bank receipt is held by exactly one match, which names that receipt's line.
  for (const r of w.rows(`SELECT * FROM capital_call_receipts WHERE reference LIKE 'mercury:%'`)) {
    const held = w.rows('SELECT target_id FROM mercury_matches WHERE receipt_id = ?', r.id);
    assert.deepEqual(held.map((h) => h.target_id), [r.capital_call_id], `${step}: receipt ${r.id} is one match's, on its own line`);
  }
  // The operational ledger: a statement line reconciles at most one ledger line in the fund.
  assert.deepEqual(w.rows(`SELECT fund_id, statement_reference, statement_line_reference FROM fund_ledger_lines
      WHERE statement_reference IS NOT NULL GROUP BY 1, 2, 3 HAVING COUNT(*) > 1`), [], `${step}: a statement line reconciled twice`);
}

/** INV2: every balance change has an approval behind it. */
function everyBalanceChangeApproved(w: World, step: string) {
  const l = ledger(w);
  // No credit without a receipt: each LP's paid-in and the fund's deployed capital are exactly their receipts.
  for (const lp of l.lps) {
    const sum = w.one('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM capital_call_receipts WHERE limited_partner_id = ?', lp.id).c;
    assert.equal(lp.invested, sum, `${step}: LP ${lp.id}'s paid-in is its receipts`);
  }
  assert.equal(l.deployed, w.one(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM capital_call_receipts WHERE fund_id = ${FUND}`).c,
    `${step}: the fund's deployed capital is its receipts`);
  // No line paid without receipts covering it, and none covered left unpaid.
  for (const x of l.lines) assert.equal(x.status === 'paid', x.received >= x.owed && x.owed > 0, `${step}: line ${x.id} paid iff covered`);
  // Each receipt has a person behind it: a bank receipt, the Admin who confirmed its match; any other, the GP or an Admin.
  for (const r of w.rows('SELECT * FROM capital_call_receipts')) {
    if (String(r.reference || '').startsWith('mercury:')) {
      const m = w.one('SELECT * FROM mercury_matches WHERE receipt_id = ?', r.id);
      assert.ok(m && m.confirmed_by != null && m.confirmed_at != null, `${step}: bank receipt ${r.id} has a confirmed match`);
      assert.equal(m.confirmed_by, r.recorded_by, `${step}: bank receipt ${r.id} is recorded by its confirmer`);
    } else {
      const who = w.one('SELECT role FROM users WHERE id = ?', r.recorded_by);
      assert.ok(r.recorded_by === GP || who?.role === 'admin', `${step}: receipt ${r.id} recorded by the GP or an Admin`);
    }
  }
  // Each call was issued by the fund's GP of record or an Admin. (Its `capital_call_issued` activity row is not
  // asserted: `logActivity` omits the NOT NULL `action` column and the row never lands; D8534 finding 3.)
  for (const c of w.rows('SELECT fc.*, f.gp_user_id FROM fund_capital_calls fc JOIN vc_funds f ON f.id = fc.fund_id')) {
    const who = w.one('SELECT role FROM users WHERE id = ?', c.issued_by);
    assert.ok(c.issued_by === c.gp_user_id || who?.role === 'admin', `${step}: call ${c.id} issued by the GP of record or an Admin`);
  }
  // A distribution is paid only by a recorded act.
  for (const d of w.rows(`SELECT * FROM fund_distributions WHERE status = 'paid'`)) {
    assert.ok(w.one(`SELECT 1 AS x FROM activity_logs WHERE action_type = 'distribution_marked_paid' AND entity_id = ? AND user_id IS NOT NULL`, String(d.id)),
      `${step}: paid distribution ${d.id} has its mark-paid act`);
  }
  // The operational ledger: each posted entry and each reconciliation is audited to the person who made it.
  for (const e of w.rows('SELECT * FROM fund_ledger_entries WHERE posted = 1')) {
    assert.ok(w.one(`SELECT 1 AS x FROM activity_logs WHERE action = 'fund_ledger_entry_posted' AND user_id = ? AND details LIKE ?`,
      e.recorded_by, `%"entry_uid":"${e.uid}"%`), `${step}: entry ${e.uid} has its posting audit`);
  }
  for (const line of w.rows('SELECT * FROM fund_ledger_lines WHERE reconciled_by IS NOT NULL')) {
    assert.ok(w.one(`SELECT 1 AS x FROM activity_logs WHERE action = 'fund_ledger_line_reconciled' AND user_id = ? AND details LIKE ?`,
      line.reconciled_by, `%"line_id":${line.id},%`), `${step}: reconciled line ${line.id} has its audit`);
  }
  // Admission: every LP row on the fund answers to an approved application for its investor.
  for (const lp of w.rows(`SELECT lp.*, u.id AS uid FROM limited_partners lp LEFT JOIN users u ON LOWER(u.email) = LOWER(lp.email)`)) {
    assert.ok(w.one(`SELECT 1 AS x FROM lp_applications WHERE user_id = ? AND fund_slug = 'spinout-fund-i' AND status = 'approved'
      AND reviewed_by IS NOT NULL`, lp.user_id ?? lp.uid), `${step}: LP ${lp.id} was admitted after an approval`);
  }
}

/** INV3: no fund flow reaches a Stripe payment path (the runtime half; the static half is its own test). */
function noStripe(w: World, step: string) {
  assert.deepEqual(outbound.filter((u) => /stripe/i.test(u)), [], `${step}: a fund flow called Stripe`);
  assert.deepEqual(outbound, [], `${step}: a fund flow made a network request`);
  for (const c of w.stub.calls) {
    assert.equal(c.method, 'GET', `${step}: the bank feed is read only`);
    assert.equal(new URL(c.url).host, 'api.mercury.com');
  }
  assert.deepEqual(w.rows(`SELECT id FROM users WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL
      OR investor_stripe_customer_id IS NOT NULL OR stripe_connect_account_id IS NOT NULL`), [], `${step}: a Stripe identity was written`);
}

function invariants(w: World, step: string) {
  oneBankItemOneObligation(w, step);
  everyBalanceChangeApproved(w, step);
  noStripe(w, step);
}

/* ── the journey's steps, reused by the cases ───────────────────────────── */

/** Invite, bind and admit both investors after approval; LP A is bound at sign-in, LP B at invite. */
async function admit(w: World) {
  for (const id of [1, 2]) {
    const r = await w.call(ADMIN, 'PATCH', `/api/admin/lp-applications/${id}`, { status: 'approved', review_note: 'Fixture approval' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.application.status, 'approved');
  }
  const a = await w.call(GP, 'POST', `/api/funds/${FUND}/lps`, { name: 'Fixture LP A', email: 'lp-a@example.test', commitment_amount: COMMIT_A });
  const b = await w.call(GP, 'POST', `/api/funds/${FUND}/lps`, { name: 'Fixture LP B', email: 'LP-B@example.test', commitment_amount: COMMIT_B });
  assert.deepEqual([a.status, b.status], [201, 201], JSON.stringify([a.body, b.body]));
  const lpA = Number(a.body.lp.id), lpB = Number(b.body.lp.id);
  // B's address is verified, so the invite links it now; A's is not, so A's row waits, unbound.
  assert.equal(w.one('SELECT user_id FROM limited_partners WHERE id = ?', lpB).user_id, LP_B);
  assert.equal(w.one('SELECT user_id FROM limited_partners WHERE id = ?', lpA).user_id, null);
  const before = await w.call(LP_A, 'GET', '/api/funds/lp-portal?view=studio');
  assert.deepEqual([before.body.lp_holdings.length, before.body.unlinked_commitment], [0, true], 'A sees an unlinked commitment, no holding');
  // A proves the address and signs in: the row is bound to A's account.
  w.db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(LP_A);
  assert.equal((await claimLpRowsAtSignIn(w.env, { id: LP_A, email: 'lp-a@example.test' })).claimed, 1);
  assert.equal(w.one('SELECT user_id FROM limited_partners WHERE id = ?', lpA).user_id, LP_A);
  for (const id of [lpA, lpB]) assert.equal(w.one('SELECT status FROM limited_partners WHERE id = ?', id).status, 'committed');
  return { lpA, lpB };
}

/** The GP issues one call of $10,000.00, split by commitment. */
async function issue(w: World, lps: { lpA: number; lpB: number }) {
  const r = await w.call(GP, 'POST', `/api/funds/${FUND}/capital-call`, { amount_cents: CALL_CENTS, due_date: DUE, purpose: 'Fixture call' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const lineA = w.one('SELECT id, amount_cents FROM capital_calls WHERE limited_partner_id = ?', lps.lpA);
  const lineB = w.one('SELECT id, amount_cents FROM capital_calls WHERE limited_partner_id = ?', lps.lpB);
  assert.deepEqual([lineA.amount_cents, lineB.amount_cents], [SHARE_A, SHARE_B]);
  return { ...lps, lineA: Number(lineA.id), lineB: Number(lineB.id) };
}

async function admittedAndCalled(w: World) {
  const lps = await admit(w);
  await agree(w, 'admitted');
  const ctx = await issue(w, lps);
  await agree(w, 'call issued');
  return ctx;
}

const matchOf = (w: World, mtid: string) => w.one(`SELECT m.* FROM mercury_matches m JOIN mercury_transactions t ON t.id = m.transaction_id
  WHERE t.mercury_transaction_id = ? ORDER BY m.id DESC`, mtid);
const lineState = (w: World, id: number) => {
  const x = ledger(w).lines.find((l) => l.id === id)!;
  return { status: x.status, received: x.received };
};

/* ── D9017: the bank-reversed state ─────────────────────────────────────── */

/** The GP's read of the call that holds `lineId`: each line's `bank_reversed`, and the call's reversals in full. */
async function gpCall(w: World, lineId: number, as = GP) {
  const callId = w.one('SELECT fund_call_id FROM capital_calls WHERE id = ?', lineId).fund_call_id;
  const r = await w.call(as, 'GET', `/api/funds/${FUND}/capital-calls/${callId}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const byLine = Object.fromEntries(r.body.call.lines.map((l: any) => [l.id, l.bank_reversed]));
  assert.equal(r.body.bank_reversals.status, 'ready');
  return { byLine, reversals: r.body.bank_reversals.rows as any[] };
}

/** What each investor's own portal says about bank reversals, by line id. */
async function portalReversed(w: World, user: number) {
  const view = await portal(w, user);
  assert.equal(view.bank_reversals_recorded, true);
  return Object.fromEntries(view.capital_calls.map((c: any) => [c.id, c.bank_reversed]));
}

/** The money a reversal must not move: every line, the receipts, paid-in, deployed capital, and each investor's DPI and TVPI. */
async function money(w: World) {
  const perf = async (u: number) => (await portal(w, u)).performance.map((p: any) => [p.invested_amount, p.dpi, p.tvpi]);
  return JSON.stringify({ ledger: ledger(w), receipts: w.rows('SELECT * FROM capital_call_receipts ORDER BY id'), a: await perf(LP_A), b: await perf(LP_B) });
}

const resolvePath = (uid: string) => `/api/funds/${FUND}/capital-calls/bank-reversals/${uid}/resolve`;
const NOTE = 'The bank returned the wire; LP A is re-sending it.';

/** The operational ledger: a cash account, an LP capital account and the year's period, set up by the administrator. */
async function books(w: World) {
  const ids: Record<string, number> = {};
  for (const [code, name, category] of [['CASH', 'Cash at bank', 'asset'], ['LPCAP', 'LP capital contributions', 'equity'],
    ['DIST', 'Distributions to LPs', 'equity']]) {
    const r = await w.call(FA, 'POST', `/api/fund-ledger/${FUND}/accounts`, { code, name, category });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[code] = Number(r.body.id);
  }
  const p = await w.call(FA, 'POST', `/api/fund-ledger/${FUND}/periods`, { label: `FY ${YEAR}`, start_date: `${YEAR}-01-01`, end_date: `${YEAR}-12-31` });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  return { ...ids, period: Number(p.body.id) };
}

/** Post the receipt to the books and return the cash line, by the administrator (or `as`). */
async function postReceipt(w: World, b: Awaited<ReturnType<typeof books>>, cents: number, label: string, as = FA) {
  const r = await w.call(as, 'POST', `/api/fund-ledger/${FUND}/periods/${b.period}/entries`, {
    entry_date: TODAY, description: label,
    lines: [{ account_id: b.CASH, debit_cents: cents, credit_cents: 0 }, { account_id: b.LPCAP, debit_cents: 0, credit_cents: cents }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return Number(w.one(`SELECT l.id FROM fund_ledger_lines l JOIN fund_ledger_entries e ON e.id = l.entry_id
    WHERE e.uid = ? AND l.account_id = ?`, r.body.uid, b.CASH).id);
}

const reconcileBody = (mtid: string, cents: number) => ({
  statement_reference: `mercury:acc-fund-8534`, statement_line_reference: mtid, statement_date: TODAY, statement_amount_cents: cents,
});

/* ── the journey ────────────────────────────────────────────────────────── */

test('the journey: admitted after approval, called, received, reconciled, distributed; the three views agree after each step', async () => {
  const w = await world();
  await agree(w, 'start');
  const ctx = await admittedAndCalled(w);

  // The bank feed shows LP A's wire for exactly its share. The matcher proposes; nothing moves.
  const t = w.wire('6000.00');
  await w.sync();
  const proposed = matchOf(w, t.id);
  assert.deepEqual([proposed.target_kind, proposed.target_id, proposed.state, proposed.origin], ['capital_call_line', ctx.lineA, 'proposed', 'matcher']);
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'pending', received: 0 }, 'a proposal moves no money');
  assert.equal(await fundUnmatchedCount(w.env, FUND, { start: TODAY, end: TODAY } as any), 1, 'proposed is not yet matched');
  await agree(w, 'bank feed shows the receipt');

  // An Admin confirms: one receipt, on A's line, recorded by the confirmer; A's paid-in and the fund's deployed move once.
  const ok = await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${proposed.uid}/confirm`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'paid', received: SHARE_A });
  assert.equal(await fundUnmatchedCount(w.env, FUND, { start: TODAY, end: TODAY } as any), 0);
  // The administrator posts it to the books and reconciles the cash line to the bank line.
  const b = await books(w);
  const cash = await postReceipt(w, b, SHARE_A, 'Capital call 1: LP A');
  const rec = await w.call(FA, 'POST', `/api/fund-ledger/${FUND}/lines/${cash}/reconcile`, reconcileBody(t.id, SHARE_A));
  assert.deepEqual([rec.status, rec.body.updated], [200, 1], JSON.stringify(rec.body));
  const book = (await w.call(FA, 'GET', `/api/fund-ledger/${FUND}`)).body;
  assert.equal(book.summary.reconciled_lines, 1);
  assert.deepEqual(book.trial_balance.map((a: any) => [a.code, a.debit_cents, a.credit_cents]).sort(), [['CASH', SHARE_A, 0], ['LPCAP', 0, SHARE_A]]);
  await agree(w, 'receipt reconciled');

  // B pays too, so both are paid in before the distribution.
  const tb = w.wire('4000.00');
  await w.sync();
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${matchOf(w, tb.id).uid}/confirm`)).status, 200);
  await agree(w, 'B received');

  // A distribution of $2,000.00 proceeds (return of capital) is computed by the job, pending: no investor counts it yet.
  w.db.exec(`INSERT INTO liquidity_events (id, event_type, status) VALUES (77, 'distribution', 'executed')`);
  await handleJob(w.env, { id: 0, job_type: 'returns_distribution', payload: JSON.stringify({ fund_id: FUND, liquidity_event_id: 77, proceeds_cents: 200_000 }),
    status: 'processing', attempts: 1, max_retries: 3, error: null, created_at: TODAY, updated_at: TODAY } as any);
  const dists = w.rows('SELECT * FROM fund_distributions ORDER BY lp_id');
  assert.deepEqual(dists.map((d) => [d.lp_id, d.amount_cents, d.status]), [[ctx.lpA, 120_000, 'pending'], [ctx.lpB, 80_000, 'pending']]);
  await agree(w, 'distribution pending');
  // The GP marks A's paid: A's portal counts it, B's still does not.
  const returnsOf = (lp: number) => Number(w.rows('SELECT returns FROM limited_partners WHERE id = ?', lp)[0].returns ?? 0);
  const returnsBefore = returnsOf(ctx.lpA);
  const paid = await w.call(GP, 'POST', `/api/funds/distributions/${dists[0].id}/mark-paid`);
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  await agree(w, 'distribution recorded');
  const perfA = (await portal(w, LP_A)).performance[0];
  assert.deepEqual([perfA.invested_amount, perfA.distributions_dollars, perfA.dpi], [6000, 1200, 0.2]);
  // Owner answer (D8534): the paid row is the record of the payout. `returns` is not credited as well, so DPI and
  // TVPI (returns + paid distributions) count the $1,200 once; a second press is refused and changes nothing.
  assert.equal(returnsOf(ctx.lpA), returnsBefore, 'mark-paid leaves limited_partners.returns as it was');
  const again = await w.call(GP, 'POST', `/api/funds/distributions/${dists[0].id}/mark-paid`);
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.deepEqual([(await portal(w, LP_A)).performance[0].dpi, returnsOf(ctx.lpA)], [0.2, returnsBefore]);

  // INV3 on the investor's own Pay press: refused, the GP records payment; nothing moves and nothing leaves.
  const pay = await w.call(LP_B, 'POST', `/api/capital/calls/${ctx.lineB}/pay`);
  assert.deepEqual([pay.status, pay.body.error], [403, 'gp_records_payment']);
  await agree(w, 'end');
});

/* ── the failure cases ──────────────────────────────────────────────────── */

test('duplicate: the same bank line read twice, and a second identical wire, settle the call once; the second wire stays unmatched', async () => {
  const w = await world();
  const ctx = await admittedAndCalled(w);
  const t = w.wire('6000.00');
  // The feed returns the same line twice in one page, and again on the next sync.
  w.bank.txns['acc-fund-8534'].push({ ...t });
  await w.sync();
  await w.sync();
  assert.equal(w.one('SELECT COUNT(*) AS n FROM mercury_transactions WHERE mercury_transaction_id = ?', t.id).n, 1, 'stored once');
  const m = matchOf(w, t.id);
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/confirm`)).status, 200);
  const again = await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/confirm`);
  assert.deepEqual([again.status, again.body.code], [409, 'match_confirmed']);
  // A second, distinct wire for the same amount the same day: the line is paid, so it is never proposed, and a manual pair is refused.
  const t2 = w.wire('6000.00');
  await w.sync();
  assert.equal(matchOf(w, t2.id), undefined, 'a second wire for a paid line is not proposed');
  const manual = await w.call(ADMIN, 'POST', '/api/admin/mercury/matches', { transaction_uid: w.one('SELECT uid FROM mercury_transactions WHERE mercury_transaction_id = ?', t2.id).uid, target_kind: 'capital_call_line', target_id: ctx.lineA });
  assert.deepEqual([manual.status, manual.body.code], [409, 'already_paid']);
  // Nor can it be moved onto the other investor's line: it is more than B owes.
  const other = await w.call(ADMIN, 'POST', '/api/admin/mercury/matches', { transaction_uid: w.one('SELECT uid FROM mercury_transactions WHERE mercury_transaction_id = ?', t2.id).uid, target_kind: 'capital_call_line', target_id: ctx.lineB });
  assert.deepEqual([other.status, other.body.code], [409, 'exceeds_outstanding']);
  // The books: the first bank line reconciles one cash line; offered to a second cash line it is refused.
  const b = await books(w);
  const cash1 = await postReceipt(w, b, SHARE_A, 'Capital call 1: LP A');
  const cash2 = await postReceipt(w, b, SHARE_A, 'Capital call 1: LP A (entered twice)');
  assert.equal((await w.call(FA, 'POST', `/api/fund-ledger/${FUND}/lines/${cash1}/reconcile`, reconcileBody(t.id, SHARE_A))).status, 200);
  const dup = await w.call(FA, 'POST', `/api/fund-ledger/${FUND}/lines/${cash2}/reconcile`, reconcileBody(t.id, SHARE_A));
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  // End state: one receipt, A paid once, the second wire unmatched for a person to deal with.
  assert.equal(w.one('SELECT COUNT(*) AS n FROM capital_call_receipts').n, 1);
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'paid', received: SHARE_A });
  assert.deepEqual(lineState(w, ctx.lineB), { status: 'pending', received: 0 });
  assert.equal(await fundUnmatchedCount(w.env, FUND, { start: TODAY, end: TODAY } as any), 1);
  await agree(w, 'duplicate end');
});

test('partial: less than the call is received; it is paired by hand, the line is part-received, and the balance settles it', async () => {
  const w = await world();
  const ctx = await admittedAndCalled(w);
  const t = w.wire('4000.00');   // A owes $6,000.00 and sends $4,000.00
  await w.sync();
  // Exactly B's share: the matcher proposes it to B's line, which an Admin rejects as the wrong payer.
  const wrong = matchOf(w, t.id);
  assert.deepEqual([wrong.target_id, wrong.state], [ctx.lineB, 'proposed']);
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${wrong.uid}/reject`, { reason: 'The payer is LP A, not LP B.' })).status, 200);
  const uid = w.one('SELECT uid FROM mercury_transactions WHERE mercury_transaction_id = ?', t.id).uid;
  const pair = await w.call(ADMIN, 'POST', '/api/admin/mercury/matches', { transaction_uid: uid, target_kind: 'capital_call_line', target_id: ctx.lineA });
  assert.equal(pair.status, 201, JSON.stringify(pair.body));
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${pair.body.uid}/confirm`)).status, 200);
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'pending', received: 400_000 });
  const view = await portal(w, LP_A);
  assert.equal(view.capital_calls[0].received_cents, 400_000, 'A sees what was received');
  await agree(w, 'partial received');
  // The balance arrives: exactly what is still owed, so the matcher proposes it, and the line is paid.
  const rest = w.wire('2000.00');
  await w.sync();
  const m = matchOf(w, rest.id);
  assert.deepEqual([m.target_id, m.amount_cents], [ctx.lineA, 200_000]);
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/confirm`)).status, 200);
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'paid', received: SHARE_A });
  assert.equal(w.one('SELECT COUNT(*) AS n FROM capital_call_receipts WHERE capital_call_id = ?', ctx.lineA).n, 2, 'two bank lines, two receipts');
  await agree(w, 'partial end');
});

test('unmatched: a receipt that fits no call is never proposed, cannot be paired, moves nothing, and is counted unmatched until marked', async () => {
  const w = await world();
  const ctx = await admittedAndCalled(w);
  const t = w.wire('7000.00');   // more than either line owes
  await w.sync();
  assert.equal(matchOf(w, t.id), undefined);
  const uid = w.one('SELECT uid FROM mercury_transactions WHERE mercury_transaction_id = ?', t.id).uid;
  for (const line of [ctx.lineA, ctx.lineB]) {
    const r = await w.call(ADMIN, 'POST', '/api/admin/mercury/matches', { transaction_uid: uid, target_kind: 'capital_call_line', target_id: line });
    assert.deepEqual([r.status, r.body.code], [409, 'exceeds_outstanding']);
  }
  assert.equal(await fundUnmatchedCount(w.env, FUND, { start: TODAY, end: TODAY } as any), 1);
  await agree(w, 'unmatched');
  // An Admin marks it Not ours: it leaves the unmatched count, and still settles nothing.
  const mark = await w.call(ADMIN, 'POST', `/api/admin/mercury/transactions/${uid}/not-ours`, { reason: 'not_fund_transaction', note: 'Fixture: not a fund receipt.' });
  assert.ok([200, 201].includes(mark.status), JSON.stringify(mark.body));
  assert.equal(await fundUnmatchedCount(w.env, FUND, { start: TODAY, end: TODAY } as any), 0);
  const refused = await w.call(ADMIN, 'POST', '/api/admin/mercury/matches', { transaction_uid: uid, target_kind: 'capital_call_line', target_id: ctx.lineA });
  assert.deepEqual([refused.status, refused.body.code], [409, 'marked_not_ours']);
  assert.equal(w.one('SELECT COUNT(*) AS n FROM capital_call_receipts').n, 0);
  for (const line of [ctx.lineA, ctx.lineB]) assert.deepEqual(lineState(w, line).received, 0);
  await agree(w, 'unmatched end');
});

test('reversed: a reconciled receipt whose bank line fails is flagged for review and nothing is undone (no reversal concept, D8534 gap 2)', async () => {
  const w = await world();
  const ctx = await admittedAndCalled(w);
  const t = w.wire('6000.00');
  await w.sync();
  const m = matchOf(w, t.id);
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/confirm`)).status, 200);
  const b = await books(w);
  const cash = await postReceipt(w, b, SHARE_A, 'Capital call 1: LP A');
  assert.equal((await w.call(FA, 'POST', `/api/fund-ledger/${FUND}/lines/${cash}/reconcile`, reconcileBody(t.id, SHARE_A))).status, 200);
  await agree(w, 'reconciled before reversal');

  // The bank now reports the line failed.
  w.bank.txns['acc-fund-8534'][0] = { ...t, status: 'failed' };
  await w.sync();
  assert.equal(matchOf(w, t.id).state, 'needs_review', 'the match is flagged');
  // What exists today: the receipt, the credits, the paid line and the reconciled cash line all stand.
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'paid', received: SHARE_A });
  assert.equal(w.one('SELECT reconciled_by FROM fund_ledger_lines WHERE id = ?', cash).reconciled_by, FA);
  assert.equal((await portal(w, LP_A)).capital_calls[0].status, 'paid', 'the investor still reads paid');
  // The failed line is no longer a posted bank line, so it is not counted unmatched either.
  assert.equal(await fundUnmatchedCount(w.env, FUND, { start: TODAY, end: TODAY } as any), 0);
  // D9017: the line now reads bank reversed, on the GP's call read and in A's own portal, and nowhere for B.
  const rev = w.one('SELECT * FROM capital_call_bank_reversals');
  assert.deepEqual([rev.capital_call_id, rev.cause, rev.bank_status, rev.receipt_cents, rev.resolved_at], [ctx.lineA, 'failed', 'failed', SHARE_A, null]);
  const gpRead = await gpCall(w, ctx.lineA);
  assert.deepEqual(gpRead.byLine[ctx.lineA], { detected_at: rev.detected_at, resolved_at: null }, "the GP reads A's line bank reversed");
  assert.equal(gpRead.byLine[ctx.lineB], null, "B's line is not reversed");
  assert.deepEqual(gpRead.reversals.map((r: any) => [r.uid, r.capital_call_id, r.cause, r.receipt_cents]), [[rev.uid, ctx.lineA, 'failed', SHARE_A]]);
  assert.deepEqual(await portalReversed(w, LP_A), { [ctx.lineA]: { detected_at: rev.detected_at, resolved_at: null } }, "A reads it on A's own line");
  assert.deepEqual(await portalReversed(w, LP_B), { [ctx.lineB]: null }, "B sees no reversal, and not A's line");
  // A replayed sync, and a second change to the same bank line, record no second reversal.
  await w.sync();
  w.bank.txns['acc-fund-8534'][0] = { ...t, status: 'failed', amount: '5999.00' };
  await w.sync();
  assert.equal(w.one('SELECT COUNT(*) AS n FROM capital_call_bank_reversals').n, 1, 'one reversal per receipt');
  // A person can only reject the flagged match; that undoes nothing and the line can never be re-matched.
  const again = await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/confirm`);
  assert.deepEqual([again.status, again.body.code], [409, 'needs_review']);
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/reject`, { reason: 'The wire was returned by the bank.' })).status, 200);
  await w.sync();
  assert.equal(w.one(`SELECT COUNT(*) AS n FROM mercury_matches WHERE state <> 'rejected'`).n, 0);
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'paid', received: SHARE_A }, 'answer b: the receipt is not reversed');
  // Rejecting the match does not clear the state.
  assert.equal((await gpCall(w, ctx.lineA)).byLine[ctx.lineA].resolved_at, null, 'still bank reversed after the reject');
  assert.equal((await portalReversed(w, LP_A))[ctx.lineA].resolved_at, null);
  await agree(w, 'reversed (failed): flagged');
  const before = await money(w);

  // Only the GP of record or an Admin resolves it, outside a support session, with a note.
  const refused: Array<[number, boolean, number, string | undefined]> = [];
  for (const [as, support] of [[LP_A, false], [LP_B, false], [FA, false], [OTHER_GP, false], [GP, true], [ADMIN, true]] as Array<[number, boolean]>) {
    const r = await w.call(as, 'POST', resolvePath(rev.uid), { note: NOTE }, { support });
    refused.push([as, support, r.status, r.body?.code]);
  }
  assert.deepEqual(refused, [
    [LP_A, false, 402, undefined], [LP_B, false, 402, undefined], [FA, false, 402, undefined], [OTHER_GP, false, 404, undefined],
    [GP, true, 403, 'support_session_refused'], [ADMIN, true, 403, 'support_session_refused'],
  ]);
  const noNote = await w.call(GP, 'POST', resolvePath(rev.uid), { note: 'ok' });
  assert.deepEqual([noNote.status, noNote.body.error], [400, 'note_required']);
  assert.equal(w.one('SELECT resolved_at FROM capital_call_bank_reversals').resolved_at, null, 'no refused attempt resolved it');
  assert.equal(w.one(`SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'capital_call_bank_reversal_resolved'`).n, 0);

  // The GP of record resolves it: the person, the time and the note are kept, with an audit row.
  const ok = await w.call(GP, 'POST', resolvePath(rev.uid), { note: `  ${NOTE}  ` });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.bank_reversal.resolved_by_name, ok.body.bank_reversal.resolution_note], ['Fixture GP', NOTE]);
  const done = w.one('SELECT * FROM capital_call_bank_reversals WHERE uid = ?', rev.uid);
  assert.deepEqual([done.resolved_by, done.resolution_note, done.detected_at], [GP, NOTE, rev.detected_at]);
  assert.ok(done.resolved_at, 'resolved_at is stamped');
  const audit = w.rows(`SELECT user_id, details FROM activity_logs WHERE action = 'capital_call_bank_reversal_resolved'`);
  assert.deepEqual(audit.map((a) => [a.user_id, JSON.parse(a.details)]), [[GP, { fund_id: FUND, reversal_uid: rev.uid }]]);
  assert.deepEqual((await gpCall(w, ctx.lineA)).byLine[ctx.lineA], { detected_at: rev.detected_at, resolved_at: done.resolved_at });
  assert.deepEqual((await portalReversed(w, LP_A))[ctx.lineA], { detected_at: rev.detected_at, resolved_at: done.resolved_at });
  // Detection and resolution move no money: the lines, receipts, paid-in, deployed capital, DPI and TVPI are as they were.
  assert.equal(await money(w), before, 'resolving moved money');

  // The history is kept: a second resolve is refused, and the row cannot be rewritten or deleted.
  const twice = await w.call(ADMIN, 'POST', resolvePath(rev.uid), { note: 'A second resolution attempt.' });
  assert.deepEqual([twice.status, twice.body.error, twice.body.bank_reversal?.resolved_by_name], [409, 'bank_reversal_resolved', 'Fixture GP']);
  assert.equal(w.one(`SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'capital_call_bank_reversal_resolved'`).n, 1, 'a refused resolve leaves no audit row');
  assert.throws(() => w.db.prepare('UPDATE capital_call_bank_reversals SET resolution_note = ? WHERE uid = ?').run('Rewritten afterwards.', rev.uid), /resolution is final/);
  assert.throws(() => w.db.prepare('DELETE FROM capital_call_bank_reversals WHERE uid = ?').run(rev.uid), /is kept/);
  assert.deepEqual({ ...w.one('SELECT resolved_by, resolution_note FROM capital_call_bank_reversals') }, { resolved_by: GP, resolution_note: NOTE });
  // The same reversal through another fund's path is not found.
  const elsewhere = await w.call(ADMIN, 'POST', `/api/funds/999/capital-calls/bank-reversals/${rev.uid}/resolve`, { note: NOTE });
  assert.equal(elsewhere.status, 404);
  // A second call: A's new line reads no reversal beside the reversed one.
  const second = await w.call(GP, 'POST', `/api/funds/${FUND}/capital-call`, { amount_cents: CALL_CENTS, due_date: DUE, purpose: 'Fixture call 2' });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const lineA2 = Number(w.one('SELECT MAX(id) AS id FROM capital_calls WHERE limited_partner_id = ?', ctx.lpA).id);
  assert.deepEqual(await portalReversed(w, LP_A), { [ctx.lineA]: { detected_at: rev.detected_at, resolved_at: done.resolved_at }, [lineA2]: null });
  await agree(w, 'reversed (failed) end');
});

test('reversed, amount changed: a receipted bank line that comes back as a smaller credit is never allowed to settle a second line', async () => {
  const w = await world();
  const ctx = await admittedAndCalled(w);
  const t = w.wire('6000.00');
  await w.sync();
  const m = matchOf(w, t.id);
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/confirm`)).status, 200);
  // The bank restates the line as $4,000.00, exactly what B owes.
  w.bank.txns['acc-fund-8534'][0] = { ...t, amount: '4000.00' };
  await w.sync();
  assert.equal(matchOf(w, t.id).state, 'needs_review');
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${m.uid}/reject`, { reason: 'The bank restated this wire.' })).status, 200);
  // Rejected, the line is a posted credit again, so the next sync proposes it to B's line.
  await w.sync();
  const second = matchOf(w, t.id);
  assert.deepEqual([second.target_id, second.state], [ctx.lineB, 'proposed']);
  // Confirming it would make one bank line settle two calls: refused, and nothing moves.
  const refused = await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${second.uid}/confirm`);
  assert.deepEqual([refused.status, refused.body.code], [409, 'bank_line_already_receipted']);
  assert.deepEqual(lineState(w, ctx.lineB), { status: 'pending', received: 0 });
  assert.equal(matchOf(w, t.id).state, 'proposed');
  // D9017: A's line reads bank reversed (restated); the new proposal to B's line reverses nothing on B's.
  const rev = w.one('SELECT * FROM capital_call_bank_reversals');
  assert.deepEqual([rev.capital_call_id, rev.cause, rev.bank_amount_cents, rev.receipt_cents], [ctx.lineA, 'restated', SHARE_B, SHARE_A]);
  const gpRead = await gpCall(w, ctx.lineA);
  assert.deepEqual([gpRead.byLine[ctx.lineA]?.resolved_at, gpRead.byLine[ctx.lineB]], [null, null]);
  assert.deepEqual(await portalReversed(w, LP_B), { [ctx.lineB]: null });
  assert.equal((await portalReversed(w, LP_A))[ctx.lineA].resolved_at, null);
  await agree(w, 'reversed (restated): flagged');
  const before = await money(w);
  // An Admin resolves it: kept on the row, and the Admin's act is in the admin audit too.
  const ok = await w.call(ADMIN, 'POST', resolvePath(rev.uid), { note: 'Restated by the bank; LP A owes the $2,000.00 balance.' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(w.one('SELECT resolved_by FROM capital_call_bank_reversals').resolved_by, ADMIN);
  const adminAudit = w.rows(`SELECT admin_user_id FROM admin_audit_log WHERE action = 'fund_admin.capital_call.bank_reversal'`);
  assert.deepEqual(adminAudit.map((a) => a.admin_user_id), [ADMIN]);
  assert.equal(await money(w), before, 'resolving moved money');
  await agree(w, 'reversed (restated) end');
});

test('revoked: authority removed between approval and reconciliation refuses the act; nothing moves until someone with authority acts', async () => {
  const w = await world();
  const ctx = await admittedAndCalled(w);
  // The bank pairing: A sends $5,000.00, which fits no line exactly, so nothing is proposed; a second Admin
  // pairs it to A's line by hand (the approval), then loses the Admin role before confirming.
  const t = w.wire('5000.00');
  await w.sync();
  assert.equal(matchOf(w, t.id), undefined);
  const uid = w.one('SELECT uid FROM mercury_transactions WHERE mercury_transaction_id = ?', t.id).uid;
  const pair = await w.call(ADMIN2, 'POST', '/api/admin/mercury/matches', { transaction_uid: uid, target_kind: 'capital_call_line', target_id: ctx.lineA });
  assert.equal(pair.status, 201, JSON.stringify(pair.body));
  w.db.prepare(`UPDATE users SET role = 'investor' WHERE id = ?`).run(ADMIN2);
  const denied = await w.call(ADMIN2, 'POST', `/api/admin/mercury/matches/${pair.body.uid}/confirm`);
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.equal(w.one('SELECT state FROM mercury_matches WHERE uid = ?', pair.body.uid).state, 'proposed');
  assert.deepEqual(lineState(w, ctx.lineA), { status: 'pending', received: 0 });
  await agree(w, 'revoked: confirm refused');
  const PART = 500_000;
  // The account is deactivated outright: still refused.
  w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(ADMIN2);
  assert.equal((await w.call(ADMIN2, 'POST', `/api/admin/mercury/matches/${pair.body.uid}/confirm`)).status, 401);
  // An Admin who holds the authority now confirms it; the receipt is theirs.
  assert.equal((await w.call(ADMIN, 'POST', `/api/admin/mercury/matches/${pair.body.uid}/confirm`)).status, 200);
  assert.equal(w.one('SELECT recorded_by FROM capital_call_receipts').recorded_by, ADMIN);
  await agree(w, 'revoked: confirmed by an Admin');

  // The books: the administrator posts the receipt, then the Super Admin removes them before they reconcile it.
  const b = await books(w);
  const cash = await postReceipt(w, b, PART, 'Capital call 1: LP A, part');
  const removed = await w.call(SUPER, 'PUT', `/api/fund-ledger/${FUND}/administrator`, { user_id: null });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const late = await w.call(FA, 'POST', `/api/fund-ledger/${FUND}/lines/${cash}/reconcile`, reconcileBody(t.id, PART));
  assert.equal(late.status, 404, JSON.stringify(late.body));
  assert.equal(w.one('SELECT reconciled_by FROM fund_ledger_lines WHERE id = ?', cash).reconciled_by, null);
  await agree(w, 'revoked: reconcile refused');
  // An Admin reconciles it instead; the line is the Admin's.
  const done = await w.call(ADMIN, 'POST', `/api/fund-ledger/${FUND}/lines/${cash}/reconcile`, reconcileBody(t.id, PART));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(w.one('SELECT reconciled_by FROM fund_ledger_lines WHERE id = ?', cash).reconciled_by, ADMIN);
  await agree(w, 'revoked end');
});

/* ── INV3, the static half ──────────────────────────────────────────────── */

/** The modules that move or record fund money in this journey. */
const FUND_FLOW = ['services/fundCallLedger.ts', 'services/mercury/match.ts', 'services/mercury/store.ts', 'services/mercury/sync.ts',
  'services/fundLedger.ts', 'models/distributions.ts', 'services/fundDistributionSplit.ts', 'services/lpClaim.ts',
  'routes/_capital_call_writes.ts', 'services/fundCashSummary.ts'];
/** Stripe's payment paths: the provider client, the billing routes and the Stripe services. */
const STRIPE_PATH = /^(integrations\/providers\/stripe\.ts|routes\/billing\.ts|services\/stripe[^/]*\.ts)$/;

function reachable(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = roots.map((r) => resolve(SRC, r));
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'";]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|^import\s+['"](\.[^'"]+)['"]/gm)) {
      const spec = resolve(dirname(file), m[1] || m[2] || m[3]);
      const hit = [spec, `${spec}.ts`, `${spec}.js`, `${spec}/index.ts`].find((p) => /\.(ts|js|mjs)$/.test(p) && existsSync(p));
      if (hit) stack.push(hit);
    }
  }
  return seen;
}

test('INV3 static: no module the fund flow reaches is a Stripe payment path', () => {
  const graph = [...reachable(FUND_FLOW)].map((p) => relative(SRC, p));
  assert.ok(graph.length > FUND_FLOW.length, 'the walk follows imports');
  for (const f of FUND_FLOW) assert.ok(graph.includes(f), f);
  assert.deepEqual(graph.filter((p) => STRIPE_PATH.test(p)), []);
  // And the fund-flow modules themselves name no Stripe host or Stripe module.
  for (const f of FUND_FLOW) {
    const code = readFileSync(resolve(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /api\.stripe\.com|providers\/stripe|from\s+['"][^'"]*stripe/i, f);
  }
});
