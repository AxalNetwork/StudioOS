/**
 * D752 (#1888) section 3 — an investor's proof of capital from their own Mercury.
 *
 * Migration 491's table, CHECKs, index and triggers; the five routes under
 * /api/mercury/attestations for every role, a branch and a support session;
 * the three targets, the floor and its cap; consent; the check against the
 * investor's own accounts, failing closed; supersession, revoke and expiry;
 * and that no response, row or log holds a balance.
 *
 * Mercury is the `bank()` stub throughout. Ids, names and balances are
 * invented: account A holds 1,234,567.89 and account B 50,000.12, so the sum
 * is 128,456,801 cents, and no floor below equals the sum or either balance.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/capital_attestations_d752.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tableFromBaseline } from './_baseline.mjs';
import { mig } from './_mercury_d713.ts';
import { personalFixture, connected, bank, req as rawReq, account, defaultBank, count, day, ACC_A, ACC_B, FOUR_A, FOUR_B } from './_mercury_personal_d713.ts';
import { CONSENT_TEMPLATE, CONSENT_VERSION, MIN_FLOOR_CENTS, statementSentence, wholeDollarCap } from '../src/services/capitalAttestationTerms.ts';

const BALANCE_A = 1234567.89, BALANCE_B = 50000.12;
const ACC_T = 'acc-personal-t';
const seen: string[] = [];

async function req(env: any, who: number, method: string, path: string, body?: unknown, opts: { impersonated?: boolean; branch?: boolean } = {}) {
  const r = await rawReq(env, who, method, path, body, opts);
  seen.push(r.text);
  return r;
}

function richBank() {
  const state = defaultBank();
  state.accounts = [account(ACC_A, FOUR_A, 'checking', BALANCE_A), account(ACC_B, FOUR_B, 'savings', BALANCE_B), account(ACC_T, '9911', 'treasury', 777777.77)];
  return bank(state);
}

async function setup(opts: { connect?: boolean } = {}) {
  const { db, env } = await personalFixture();
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  // deals, commitments and deal_invitations come from the shared world (`_mercury_d713.ts`, since #1887).
  db.exec(tableFromBaseline(baseline, 'lp_applications'));
  db.exec(mig('491_mercury_capital_attestations.sql'));
  db.exec(`INSERT INTO users (id, role, name, email) VALUES (31, 'investor', 'Second', 'second@example.test');
    INSERT INTO vc_funds (id, name, slug) VALUES (1, 'Axal Spin-Out Fund I', 'spinout-fund-i'), (2, 'Outside Fund', 'outside-fund');
    INSERT INTO deals (id, project_id, status, passed_at) VALUES (1, 1, 'active', NULL), (2, 2, 'rejected', NULL), (3, 2, 'active', '2026-01-01');
    INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (1, 30), (1, 31);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES
      (101, 1, 30, 300000.00, 'pending'), (102, 1, 30, 400000.00, 'confirmed'), (103, 1, 31, 250000.00, 'pending'),
      (104, 2, 30, 200000.00, 'pending'), (105, 1, 30, 999.99, 'pending'), (106, 3, 30, 200000.00, 'pending');
    INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, target_commitment, status) VALUES
      (201, 30, 'spinout-fund-i', 'individual', 2000000.00, 'in_review');
    INSERT INTO limited_partners (id, user_id, fund_id, commitment_amount, email) VALUES
      (301, 30, 1, 500000.00, 'investor@example.test'), (302, NULL, 1, 100000.00, 'INVESTOR@example.test'), (303, 30, 2, 900000.00, 'investor@example.test');
    INSERT INTO capital_calls (limited_partner_id, amount, amount_cents) VALUES (301, 150000.00, 15000000), (301, 50000.50, NULL), (303, 1.00, 100);
  `);
  if (opts.connect !== false) await connected(db, env, 30);
  return { db, env };
}

const BODY = (extra: Record<string, unknown> = {}) => ({
  purpose: 'deal_commitment', target_id: 101, account_ids: [ACC_A, ACC_B], consent: true, consent_version: 'd752-1', ...extra,
});
const rows = (db: any) => count(db, 'SELECT COUNT(*) AS n FROM capital_attestations');
const UUID = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';

// ─────────────────────────────────────────────────────────── the migration

const COLUMNS = ['id', 'uid', 'user_id', 'purpose', 'target_id', 'deal_id', 'fund_id', 'amount_floor_cents', 'as_of', 'expires_on',
  'holder_name', 'accounts_counted', 'consent_version', 'consented_at', 'state', 'revoked_at', 'admin_view_count', 'last_admin_view_at',
  'created_at', 'updated_at'];

function insert(db: any, over: Record<string, unknown> = {}) {
  const r = { uid: crypto.randomUUID(), user_id: 30, purpose: 'deal_commitment', target_id: 101, deal_id: 1, fund_id: null,
    amount_floor_cents: 100000, as_of: '2026-10-01', expires_on: '2026-10-31', holder_name: 'Own Practice LLC', accounts_counted: 1,
    consent_version: 'd752-1', state: 'active', revoked_at: null, ...over };
  const keys = Object.keys(r);
  db.prepare(`INSERT INTO capital_attestations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(r) as any[]);
  return r.uid as string;
}

test('migration 491: the exact columns, none of them a balance, an account or a transaction', async () => {
  const { db } = await setup({ connect: false });
  const cols = (db.prepare('PRAGMA table_info(capital_attestations)').all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, COLUMNS);
  for (const c of cols) assert.doesNotMatch(c, /balance|available|current_cents|account_id|last_?four|last4|transaction|counterparty/);
});

test('migration 491: the CHECKs refuse a bad floor, count, expiry, purpose, target shape and revoke', async () => {
  const { db } = await setup({ connect: false });
  for (const bad of [
    { amount_floor_cents: 99900 }, { amount_floor_cents: 100050 }, { amount_floor_cents: 100000.5 },
    { accounts_counted: 0 }, { expires_on: '2026-10-30' }, { purpose: 'other' },
    { fund_id: 1 }, { purpose: 'lp_commitment', deal_id: null, fund_id: null }, { state: 'revoked', revoked_at: null },
  ]) assert.throws(() => insert(db, bad), /CHECK constraint failed/, JSON.stringify(bad));
  insert(db, { purpose: 'lp_commitment', deal_id: null, fund_id: 1, target_id: 301 });
  insert(db, { purpose: 'lp_application', deal_id: null, fund_id: null, target_id: 201 });
  assert.equal(rows(db), 2);
});

test('migration 491: one active statement per target; superseded ones may repeat', async () => {
  const { db } = await setup({ connect: false });
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'uq_capital_attestations_active'").get() as any;
  assert.match(idx.sql, /WHERE state = 'active'/);
  insert(db);
  assert.throws(() => insert(db), /UNIQUE/);
  insert(db, { state: 'superseded' });
  insert(db, { state: 'superseded' });
  assert.equal(rows(db), 3);
});

test('migration 491: what a statement says is fixed, revoked is final, superseded never returns, views always move, nothing is deleted', async () => {
  const { db } = await setup({ connect: false });
  const uid = insert(db);
  for (const set of ["amount_floor_cents = 200000", "holder_name = 'Other LLC'", 'target_id = 105', "as_of = '2026-10-02', expires_on = '2026-11-01'"]) {
    assert.throws(() => db.prepare(`UPDATE capital_attestations SET ${set} WHERE uid = ?`).run(uid), /capital_attestation_fixed/, set);
  }
  db.prepare("UPDATE capital_attestations SET admin_view_count = admin_view_count + 1, last_admin_view_at = datetime('now') WHERE uid = ?").run(uid);
  db.prepare("UPDATE capital_attestations SET state = 'superseded' WHERE uid = ?").run(uid);
  assert.throws(() => db.prepare("UPDATE capital_attestations SET state = 'active' WHERE uid = ?").run(uid), /capital_attestation_fixed/);
  db.prepare("UPDATE capital_attestations SET admin_view_count = admin_view_count + 1 WHERE uid = ?").run(uid);
  db.prepare("UPDATE capital_attestations SET state = 'revoked', revoked_at = datetime('now') WHERE uid = ?").run(uid);
  assert.throws(() => db.prepare("UPDATE capital_attestations SET state = 'active', revoked_at = NULL WHERE uid = ?").run(uid), /capital_attestation_fixed/);
  db.prepare("UPDATE capital_attestations SET admin_view_count = admin_view_count + 1 WHERE uid = ?").run(uid);
  assert.equal(count(db, 'SELECT admin_view_count AS n FROM capital_attestations WHERE uid = ?', uid), 3);
  assert.throws(() => db.prepare('DELETE FROM capital_attestations WHERE uid = ?').run(uid), /append-only/);
});

// ─────────────────────────────────────────────────────────── policy

const FIVE = (uid = UUID): Array<[string, string, unknown?]> => [
  ['GET', '/api/mercury/attestations'], ['GET', '/api/mercury/attestations/targets'], ['GET', '/api/mercury/attestations/accounts'],
  ['POST', '/api/mercury/attestations', BODY()], ['POST', `/api/mercury/attestations/${uid}/revoke`],
];

test('policy: a founder and a partner hold no use; a branch and a support session are refused on all five; Mercury is never called', async () => {
  const { db, env } = await setup();
  await connected(db, env, 10);
  await connected(db, env, 20);
  const b = richBank();
  try {
    for (const who of [10, 20]) {
      for (const [m, p, body] of FIVE().slice(1, 4)) {
        const r = await req(env, who, m, p, body);
        assert.deepEqual([r.status, r.body.error], [403, 'purpose_not_allowed'], `${who} ${m} ${p}`);
      }
      const list = await req(env, who, 'GET', '/api/mercury/attestations');
      assert.deepEqual([list.status, list.body.attestations], [200, []]);
    }
    for (const [m, p, body] of FIVE()) {
      let r = await req(env, 30, m, p, body, { branch: true });
      assert.deepEqual([r.status, r.body.error], [403, 'hq_only'], `branch ${m} ${p}`);
      r = await req(env, 30, m, p, body, { impersonated: true });
      assert.deepEqual([r.status, r.body.error], [403, 'support_session_refused'], `support ${m} ${p}`);
    }
    assert.equal(b.calls.length, 0);
    assert.equal(rows(db), 0);
  } finally { b.restore(); }
});

// ─────────────────────────────────────────────────────────── targets

test('GET /targets: the investor\'s own open targets, with caps and reasons, and no bank call', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const r = await req(env, 30, 'GET', '/api/mercury/attestations/targets');
    assert.equal(r.status, 200, r.text);
    const key = (t: any) => `${t.purpose}:${t.target_id}`;
    assert.deepEqual(r.body.targets.map(key).sort(),
      ['deal_commitment:101', 'deal_commitment:105', 'lp_application:201', 'lp_commitment:301', 'lp_commitment:302'].sort());
    const by = Object.fromEntries(r.body.targets.map((t: any) => [key(t), t]));
    assert.deepEqual([by['deal_commitment:101'].max_cents, by['deal_commitment:101'].attestable, by['deal_commitment:101'].deal_id], [30000000, true, 1]);
    assert.deepEqual([by['deal_commitment:105'].attestable, by['deal_commitment:105'].reason], [false, 'below_minimum']);
    assert.deepEqual([by['lp_application:201'].max_cents, by['lp_application:201'].fund_id], [200000000, 1]);
    const lp = by['lp_commitment:301'];
    assert.deepEqual([lp.committed_cents, lp.called_cents, lp.max_cents, lp.fund_id], [50000000, 20000050, 29999900, 1]);
    assert.equal(count(db, 'SELECT user_id AS n FROM limited_partners WHERE id = 302'), 30, 'the unclaimed row carrying their email is now theirs');
    assert.equal(r.body.consent.version, 'd752-1');
    assert.equal(r.body.consent.template, CONSENT_TEMPLATE);
    assert.deepEqual([r.body.minimum_cents, r.body.valid_days, r.body.unreadable], [100000, 30, []]);
    db.exec("UPDATE lp_applications SET status = 'declined' WHERE id = 201");
    let again = await req(env, 30, 'GET', '/api/mercury/attestations/targets');
    assert.ok(!again.body.targets.some((t: any) => t.purpose === 'lp_application'));
    db.exec("UPDATE lp_applications SET status = 'pending', target_commitment = NULL WHERE id = 201");
    again = await req(env, 30, 'GET', '/api/mercury/attestations/targets');
    const app = again.body.targets.find((t: any) => t.purpose === 'lp_application');
    assert.deepEqual([app.attestable, app.reason, app.max_cents], [false, 'amount_missing', null]);
    db.exec('DROP TABLE lp_applications');
    again = await req(env, 30, 'GET', '/api/mercury/attestations/targets');
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.unreadable, ['lp_application']);
    assert.ok(again.body.targets.some((t: any) => t.purpose === 'deal_commitment'), 'the other purposes still answer');
    assert.equal(b.calls.length, 0, 'targets read no bank');
  } finally { b.restore(); }
});

test('GET /targets: an LP commitment whose calls cannot be read is calls_unreadable, never a full cap', async () => {
  const { db, env } = await setup();
  db.exec('ALTER TABLE capital_calls RENAME TO capital_calls_gone');
  const r = await req(env, 30, 'GET', '/api/mercury/attestations/targets');
  const lp = r.body.targets.find((t: any) => t.purpose === 'lp_commitment' && t.target_id === 301);
  assert.deepEqual([lp.attestable, lp.reason, lp.max_cents, lp.called_cents], [false, 'calls_unreadable', null, null]);
  const share = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'lp_commitment', target_id: 301 }));
  assert.deepEqual([share.status, share.body.error, share.body.reason], [409, 'target_not_attestable', 'calls_unreadable']);
  assert.equal(rows(db), 0);
});

// ─────────────────────────────────────────────────────────── accounts

test('GET /accounts: checking and savings with id, name, kind and last four, the holder, two GETs and one log row', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const r = await req(env, 30, 'GET', '/api/mercury/attestations/accounts');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.holder_name, 'Own Practice LLC');
    assert.deepEqual(r.body.accounts, [
      { id: ACC_A, name: 'Own checking', kind: 'checking', last_four: FOUR_A },
      { id: ACC_B, name: 'Own savings', kind: 'savings', last_four: FOUR_B },
    ]);
    assert.deepEqual(b.calls.map((c) => [c.method, c.path]), [['GET', '/organization'], ['GET', '/accounts']]);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integration_logs WHERE event_type = 'capital_attestation_accounts' AND response_summary = 'use=capital_attestation accounts=2'"), 1);
  } finally { b.restore(); }
});

// ─────────────────────────────────────────────────────────── sharing

test('POST /: a shared statement, dated today, expiring in 30 days, at the cap when no amount is named, after exactly two GETs', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY());
    assert.equal(r.status, 201, r.text);
    const row: any = db.prepare('SELECT * FROM capital_attestations').get();
    assert.deepEqual(
      [row.as_of, row.expires_on, row.holder_name, row.accounts_counted, row.consent_version, row.amount_floor_cents, row.deal_id, row.fund_id, row.state],
      [day(0), day(30), 'Own Practice LLC', 2, 'd752-1', 30000000, 1, null, 'active'],
    );
    assert.deepEqual([r.body.attestation.amount_floor_cents, r.body.attestation.expired, r.body.accounts_unreadable], [30000000, false, 0]);
    assert.equal(r.body.attestation.target_label, 'Venture · deal commitment');
    assert.equal(r.body.attestation.statement, `At least $300,000 available at Mercury on ${day(0)}, held by Own Practice LLC, across 2 accounts. Shared by the investor on ${String(row.consented_at).slice(0, 10)}.`);
    assert.deepEqual(b.calls.map((c) => [c.method, c.path]), [['GET', '/organization'], ['GET', '/accounts']]);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integration_logs WHERE event_type = 'capital_attestation_check' AND response_summary = 'use=capital_attestation accounts=2 unreadable=0'"), 1);
  } finally { b.restore(); }
});

test('POST /: consent missing, false or a string is consent_required; an old version is consent_outdated; no bank call, nothing stored', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    for (const consent of [undefined, false, 'true']) {
      const r = await req(env, 30, 'POST', '/api/mercury/attestations', { ...BODY(), consent });
      assert.deepEqual([r.status, r.body.error], [400, 'consent_required'], String(consent));
    }
    const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ consent_version: 'd752-0' }));
    assert.deepEqual([r.status, r.body.error, r.body.message], [409, 'consent_outdated', 'The words you agreed to have changed. Read them again.']);
    assert.equal(b.calls.length, 0);
    assert.equal(rows(db), 0);
  } finally { b.restore(); }
});

test('POST /: the floor and the cap, checked before the bank', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    for (const [amount_cents, code] of [[99900, 'invalid_amount'], [100050, 'invalid_amount'], [150000.5, 'invalid_amount'], ['200000', 'invalid_amount'], [30000100, 'amount_above_target']] as const) {
      const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents }));
      assert.deepEqual([r.status, r.body.error], [400, code], String(amount_cents));
    }
    assert.match((await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents: 30000100 }))).body.message, /\$300,000/);
    assert.equal(b.calls.length, 0);
    assert.equal(rows(db), 0);
    const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents: 30000000 }));
    assert.equal(r.status, 201, r.text);
    const low = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents: 100000 }));
    assert.equal(low.status, 201, 'exactly the minimum');
    const below = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'deal_commitment', target_id: 105 }));
    assert.deepEqual([below.status, below.body.error, below.body.reason], [409, 'target_not_attestable', 'below_minimum']);
  } finally { b.restore(); }
});

test('POST /: a balance below the floor shares nothing and names no figure', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'lp_application', target_id: 201, amount_cents: 128500000 }));
    assert.deepEqual([r.status, r.body.error], [409, 'balance_below_amount']);
    assert.match(r.text, /^[^0-9]*$/);
    assert.equal(rows(db), 0);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integration_logs WHERE event_type = 'capital_attestation_check' AND response_summary = 'use=capital_attestation accounts=2 unreadable=0'"), 1,
      'the log row is the same for a refused check');
    const ok = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'lp_application', target_id: 201, amount_cents: 128400000 }));
    assert.equal(ok.status, 201, ok.text);
    assert.deepEqual([ok.body.attestation.fund_id, ok.body.attestation.target_label], [1, 'Fund I application']);
  } finally { b.restore(); }
});

test('POST /: an account with no balance counts nothing; with none readable the check fails closed', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    b.state.accounts = [account(ACC_A, FOUR_A, 'checking', BALANCE_A), account(ACC_B, FOUR_B, 'savings')];
    const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY());
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.body.attestation.accounts_counted, r.body.accounts_unreadable], [1, 1]);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integration_logs WHERE response_summary = 'use=capital_attestation accounts=2 unreadable=1'"), 1);
    b.state.accounts = [account(ACC_A, FOUR_A), account(ACC_B, FOUR_B, 'savings')];
    const none = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'lp_commitment', target_id: 301 }));
    assert.deepEqual([none.status, none.body.error], [502, 'mercury_unreadable']);
    assert.equal(rows(db), 1);
  } finally { b.restore(); }
});

test('POST /: an account the organization does not hold, or a Treasury account, is account_not_found; bad lists never reach the bank', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    for (const ids of [[ACC_A, 'acc-nope'], [ACC_T]]) {
      const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ account_ids: ids }));
      assert.deepEqual([r.status, r.body.error], [409, 'account_not_found'], ids.join());
    }
    const calls = b.calls.length;
    for (const ids of [[ACC_A, ACC_A], Array.from({ length: 21 }, (_, i) => `acc-${i}`), ['acc/a'], [], 'acc-a', [7]]) {
      const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ account_ids: ids }));
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_accounts'], JSON.stringify(ids));
    }
    for (const [k, v, code] of [['purpose', 'gift', 'invalid_purpose'], ['target_id', 0, 'invalid_target_id'], ['target_id', '1x', 'invalid_target_id']] as const) {
      const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ [k]: v }));
      assert.deepEqual([r.status, r.body.error], [400, code]);
    }
    assert.equal(b.calls.length, calls);
    assert.equal(rows(db), 0);
  } finally { b.restore(); }
});

test('POST /: no legal name from Mercury is holder_unreadable, nothing stored', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    b.state.org = { id: 'org-own' };
    const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY());
    assert.deepEqual([r.status, r.body.error], [502, 'holder_unreadable']);
    assert.equal(rows(db), 0);
  } finally { b.restore(); }
});

test('POST /: another investor\'s target, a deal they committed to that is rejected or passed, and a confirmed commitment are all 404 like a missing one', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const missing = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ target_id: 999999 }));
    assert.deepEqual([missing.status, missing.body.error], [404, 'target_not_found']);
    for (const target_id of [103, 104, 106, 102]) {
      const r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ target_id }));
      assert.equal(r.text, missing.text, String(target_id));
    }
    const outside = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'lp_commitment', target_id: 303 }));
    assert.equal(outside.text, missing.text, 'an LP row on an outside fund');
    assert.equal(b.calls.length, 0);
    assert.equal(rows(db), 0);
  } finally { b.restore(); }
});

test('POST /: every read re-checks the connection: an Axal entity, a rejected token, no connection', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    b.state.org = { id: 'org-x', legalBusinessName: 'Axal VC Management LLC' };
    let r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY());
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_entity_account']);
    assert.equal((db.prepare('SELECT status FROM integrations WHERE user_id = 30').get() as any).status, 'error');
    db.exec("UPDATE integrations SET status = 'active', last_error = NULL WHERE user_id = 30");
    b.state.org = defaultBank().org;
    b.state.status = 401;
    r = await req(env, 30, 'POST', '/api/mercury/attestations', BODY());
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_reconnect_required']);
    b.state.status = undefined;
    r = await req(env, 31, 'POST', '/api/mercury/attestations', BODY({ target_id: 103 }));
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_not_connected']);
    assert.equal(rows(db), 0);
  } finally { b.restore(); }
});

// ─────────────────────────────────────────────────────────── supersession, revoke, disconnect, expiry

test('supersession: a second statement on one target supersedes the first; another target\'s stays active', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const first = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents: 200000 }));
    const lp = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'lp_commitment', target_id: 301 }));
    const second = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents: 300000 }));
    assert.deepEqual([first.status, lp.status, second.status], [201, 201, 201]);
    const state = (uid: string) => (db.prepare('SELECT state FROM capital_attestations WHERE uid = ?').get(uid) as any).state;
    assert.deepEqual([state(first.body.attestation.uid), state(second.body.attestation.uid), state(lp.body.attestation.uid)], ['superseded', 'active', 'active']);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM capital_attestations WHERE purpose = 'deal_commitment' AND target_id = 101 AND state = 'active'"), 1);
    const targets = await req(env, 30, 'GET', '/api/mercury/attestations/targets');
    const t = targets.body.targets.find((x: any) => x.purpose === 'deal_commitment' && x.target_id === 101);
    assert.deepEqual([t.active.uid, t.active.amount_floor_cents], [second.body.attestation.uid, 300000]);
  } finally { b.restore(); }
});

test('revoke: once, final, the owner\'s only; a superseded one too; a member whose role changed keeps it; SQL cannot undo it', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const a = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents: 200000 }));
    const later = await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ amount_cents: 300000 }));
    const uid = a.body.attestation.uid;
    const other = await req(env, 31, 'POST', `/api/mercury/attestations/${later.body.attestation.uid}/revoke`);
    const random = await req(env, 31, 'POST', `/api/mercury/attestations/${UUID}/revoke`);
    assert.deepEqual([other.status, other.body.error], [404, 'attestation_not_found']);
    assert.equal(other.text, random.text);
    assert.equal((await req(env, 30, 'POST', '/api/mercury/attestations/not-a-uuid/revoke')).status, 404);
    const r = await req(env, 30, 'POST', `/api/mercury/attestations/${uid}/revoke`);
    assert.equal(r.status, 200, 'a superseded statement can be revoked');
    assert.deepEqual([r.body.attestation.state, typeof r.body.attestation.revoked_at], ['revoked', 'string']);
    const again = await req(env, 30, 'POST', `/api/mercury/attestations/${uid}/revoke`);
    assert.deepEqual([again.status, again.body.error], [409, 'already_revoked']);
    assert.throws(() => db.prepare("UPDATE capital_attestations SET state = 'active', revoked_at = NULL WHERE uid = ?").run(uid), /capital_attestation_fixed/);
    db.exec("UPDATE users SET role = 'founder' WHERE id = 30");
    const former = await req(env, 30, 'POST', `/api/mercury/attestations/${later.body.attestation.uid}/revoke`);
    assert.equal(former.status, 200, `a founder revokes what they shared as an investor: ${former.text}`);
    const list = await req(env, 30, 'GET', '/api/mercury/attestations');
    assert.deepEqual(list.body.attestations.map((x: any) => x.state), ['revoked', 'revoked']);
  } finally { b.restore(); }
});

test('disconnect does not revoke: after the generic disconnect, the statement is still active', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    const a = await req(env, 30, 'POST', '/api/mercury/attestations', BODY());
    assert.equal(a.status, 201);
    const d = await req(env, 30, 'DELETE', '/api/connectors/mp-30');
    assert.equal(d.status, 200, d.text);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integrations WHERE user_id = 30"), 0);
    const list = await req(env, 30, 'GET', '/api/mercury/attestations');
    assert.deepEqual(list.body.attestations.map((x: any) => [x.uid, x.state]), [[a.body.attestation.uid, 'active']]);
  } finally { b.restore(); }
});

test('expiry is computed: a statement 31 days old reads expired in the list and on its target, and stays active', async () => {
  const { db, env } = await setup();
  const uid = insert(db, { target_id: 105, as_of: day(-31), expires_on: day(-1) });
  const list = await req(env, 30, 'GET', '/api/mercury/attestations');
  assert.deepEqual(list.body.attestations.map((x: any) => [x.uid, x.expired, x.state]), [[uid, true, 'active']]);
  const targets = await req(env, 30, 'GET', '/api/mercury/attestations/targets');
  assert.equal(targets.body.targets.find((t: any) => t.target_id === 105).active.expired, true);
});

// ─────────────────────────────────────────────────────────── no balance anywhere

const keysDeep = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysDeep)
  : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);

test('no balance in any response or log written by this file', async () => {
  const { db, env } = await setup();
  const b = richBank();
  try {
    await req(env, 30, 'GET', '/api/mercury/attestations/accounts');
    await req(env, 30, 'POST', '/api/mercury/attestations', BODY());
    await req(env, 30, 'POST', '/api/mercury/attestations', BODY({ purpose: 'lp_application', target_id: 201, amount_cents: 128500000 }));
    await req(env, 30, 'GET', '/api/mercury/attestations');
    await req(env, 30, 'GET', '/api/mercury/attestations/targets');
  } finally { b.restore(); }
  const logs = (db.prepare('SELECT request_summary, response_summary, payload_json FROM integration_logs').all() as any[])
    .flatMap((l) => [l.request_summary, l.response_summary, l.payload_json].map((x) => String(x ?? '')));
  assert.ok(seen.length > 50 && logs.length >= 2, `${seen.length} responses, ${logs.length} log fields`);
  for (const text of [...seen, ...logs]) {
    for (const figure of ['123456789', '1234567', '5000012', '50000.12', '128456801', '1284568']) assert.ok(!text.includes(figure), `${figure} in ${text.slice(0, 200)}`);
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    for (const k of keysDeep(parsed)) assert.doesNotMatch(k, /balance|available|current_cents/, k);
  }
});

// ─────────────────────────────────────────────────────────── the words and the static rules

test('the consent version and its words move together', () => {
  assert.equal(CONSENT_VERSION, 'd752-1');
  assert.equal(CONSENT_TEMPLATE,
    'I ask StudioOS to read, now, the available balance of the {accounts} Mercury accounts I picked, and to share one statement with Axal\'s admins: ' +
    'at least {amount} was available on {as_of}, in accounts held by {holder}. StudioOS keeps and shows no balance. ' +
    'The statement is labelled expired after 30 days, and I can revoke it at any time.');
  assert.equal(MIN_FLOOR_CENTS, 100000);
  assert.deepEqual([wholeDollarCap(29999950), wholeDollarCap(0), wholeDollarCap(null), wholeDollarCap(Number.NaN), wholeDollarCap(-5)], [29999900, null, null, null, null]);
  assert.equal(statementSentence({ amount_floor_cents: 123400000, as_of: '2026-10-01', holder_name: 'Own LLC', accounts_counted: 1, consented_at: '2026-10-01 12:00:00' }),
    'At least $1,234,000 available at Mercury on 2026-10-01, held by Own LLC, across 1 account. Shared by the investor on 2026-10-01.');
});

const root = 'cloudflare-worker/src';
const walk = (p: string): string[] => readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]));
const src = (f: string) => readFileSync(join(root, f), 'utf8');

test('static: no DELETE, no money path, the terms stay pure, the route never imports the bank code, and nothing scheduled or AI reads it', () => {
  for (const f of walk(root)) assert.doesNotMatch(readFileSync(f, 'utf8'), /DELETE FROM capital_attestations/, f);
  const route = src('routes/mercury_attestations.ts');
  for (const m of route.matchAll(/mercuryAttestations\.(?:get|post|put|patch|delete)\('([^']*)'/g)) assert.doesNotMatch(m[1], /send|transfer|pay|payout|wire/i, m[1]);
  assert.equal([...route.matchAll(/mercuryAttestations\.(?:get|post)\(/g)].length, 5);
  assert.doesNotMatch(route, /mercuryPersonal|providers\//);
  assert.doesNotMatch(src('services/capitalAttestationTerms.ts'), /from\s+['"][^'"]*(mercuryPersonal|providers\/)/);
  assert.doesNotMatch(src('services/capitalAttestationTerms.ts'), /from\s+['"]/, 'the terms import nothing at all');
  for (const f of [...walk(join(root, 'mcp')), join(root, 'services/eadwynConnectors.ts'), join(root, 'services/eadwynReaders.ts')]) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /capital_attestations|capitalAttestations/, f);
  }
  const index = src('index.ts');
  const scheduled = index.slice(index.indexOf('scheduled'));
  assert.doesNotMatch(scheduled, /capitalAttestations|capital_attestations/);
});
