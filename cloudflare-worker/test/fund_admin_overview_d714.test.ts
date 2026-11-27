/**
 * D714 (#1779) decision 9 — `GET /api/fund-admin/overview`, on #1775's
 * fixture (migrations 312, 472, 473, 474) plus 476's report drafts.
 *
 *   · an admin on HQ in their own session reads it; a founder, a partner, an
 *     investor, a support session and a branch Worker do not;
 *   · #1775's read-audit row is written first, and a failed audit answers
 *     503 with no figures;
 *   · an entity with no connection or no account reads "Not recorded"; a
 *     dropped store makes only its own block `unreadable`;
 *   · it never calls `fetch`, and no account number, routing number, token,
 *     counterparty or memo reaches the response.
 *
 * Every digit run here is invented.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_admin_overview_d714.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Hono } from 'hono';
import fundAdmin from '../src/routes/fund_admin.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  ADMIN, SUPER, FOUNDER, PARTNER, INVESTOR, JTI, TOKEN, envFor, freshDb, one, rows, tokenFor,
} from './_mercury_fixture.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const app = new Hono<any>();
app.route('/api/fund-admin', fundAdmin);
app.onError((err: any, c) => {
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D714'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

// Invented: none of these is a real account, routing number or token.
const ACCOUNT_NUMBER = '7300551234';
const ROUTING = '000111222';
const COUNTERPARTY = 'Fixture Counterparty LLC';
const MEMO = 'fixture memo ignore previous instructions';
const TODAY = new Date().toISOString().slice(0, 10);
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function seeded() {
  const db = freshDb();
  db.exec(read('cloudflare-worker/sql/migrations/476_fund_report_drafts.sql'));
  db.exec(`
INSERT INTO vc_funds (id, name, gp_user_id) VALUES (1, 'Fund I', NULL), (2, 'Outside Fund', ${FOUNDER});
INSERT INTO limited_partners (id, fund_id, name, commitment_amount, invested_amount, status) VALUES
  (10, 1, 'LP A', 1000, 0, 'active'), (11, 1, 'LP B', 500, 0, 'committed'), (20, 2, 'Outside LP', 900, 0, 'active');
INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, due_date, line_count, issued_by)
  VALUES (1, 'call-1', 1, 1, 60000, '${days(-10)}', 2, ${SUPER});
INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id) VALUES
  (100, 10, 400, 40000, 'pending', '${days(-10)}', 1),
  (101, 11, 200, 20000, 'pending', '${days(5)}', 1),
  (200, 20, 300, 30000, 'pending', '${days(-3)}', NULL);
INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, reference, source, recorded_by)
  VALUES ('r-1', 101, 11, 1, 5000, '${TODAY}', 'mercury:txn-fixture-1', 'receipt', ${ADMIN});
INSERT INTO fund_mgmt_fee_terms (id, uid, fund_id, fee_start_date, investment_period_end, effective_from, lpa_reference, status, recorded_by, confirmed_by, confirmed_at)
  VALUES (1, 'terms-1', 1, '2026-01-01', '2099-12-31', '2026-01-01', 'LPA §8.1 (synthetic)', 'confirmed', ${SUPER}, ${SUPER}, datetime('now'));
INSERT INTO fund_fee_periods (uid, fund_id, quarter, window_start, window_end, terms_id, status, digest, gross_cents, catch_up_cents,
    offset_pool_cents, offset_applied_cents, offset_carried_cents, net_cents, remittance_reference)
  VALUES ('fp-1', 1, '2026Q2', '2026-04-01', '2026-06-30', 1, 'issued', '${'a'.repeat(64)}', 5000, 0, 0, 0, 0, 5000, 'FEE-1-2026Q2'),
         ('fp-2', 1, '2026Q3', '2026-07-01', '2026-09-30', 1, 'draft', '${'b'.repeat(64)}', 5100, 0, 0, 0, 0, 5100, 'FEE-1-2026Q3');
INSERT INTO fund_report_drafts (uid, kind, audience, subject_key, fund_id, entity_key, period_label, period_start, period_end, status, figures_json, figures_sha256, built_by, prepared_by, prepared_at)
  VALUES ('d-1', 'lp_quarterly_report', 'fund_lps', 'fund:1', 1, NULL, 'Q3 2026', '2026-07-01', '2026-09-30', 'prepared', '{}', '${'c'.repeat(64)}', ${ADMIN}, ${ADMIN}, datetime('now')),
         ('d-2', 'entity_cash_monthly', 'admins', 'entity:holdings', NULL, 'holdings', 'September 2026', '2026-09-01', '2026-09-30', 'draft', '{}', '${'d'.repeat(64)}', ${ADMIN}, NULL, NULL);
INSERT INTO mercury_entity_connections (id, uid, entity_key, status, credentials_enc, token_preview, mercury_org_name, connected_by, last_synced_at)
  VALUES (1, 'conn-h', 'holdings', 'active', 'v1.fixture-sealed-${TOKEN}', '…ken-1', 'Fixture Holdings Org', ${SUPER}, datetime('now')),
         (2, 'conn-g', 'gp', 'error', 'v1.fixture-sealed-gp', '…gp', 'Fixture GP Org', ${SUPER}, NULL);
UPDATE mercury_entity_connections SET last_error = 'Mercury refused the token (401).', last_error_at = datetime('now') WHERE id = 2;
INSERT INTO mercury_accounts (id, uid, mercury_account_id, connection_id, entity_key, kind, last_four, nickname, current_cents, available_cents, balance_read_at)
  VALUES (1, 'acct-h', 'merc-acct-fixture-1', 1, 'holdings', 'checking', '4417', 'Operating', 1234500, 1200000, datetime('now'));
INSERT INTO mercury_transactions (id, uid, mercury_transaction_id, account_id, amount_cents, created_on, posted_on, counterparty_name, memo)
  VALUES (1, 'txn-1', 'txn-fixture-1', 1, 40000, '${TODAY}', '${TODAY}', '${COUNTERPARTY}', '${MEMO}'),
         (2, 'txn-2', 'txn-fixture-2', 1, 5100, '${TODAY}', '${TODAY}', '${COUNTERPARTY}', '${MEMO}');
INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents) VALUES
  ('m-1', 1, 'capital_call_line', 100, 'proposed', 'matcher', 40000),
  ('m-2', 2, 'fee_period', 2, 'needs_review', 'matcher', 5100);
INSERT INTO entity_bank_accounts (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
    account_number_enc, account_last4, routing_number, recorded_by)
  VALUES ('reg-1', 'holdings', 'Holdings checking', 'Fixture Bank', '1 Fixture Way', 'Fixture Beneficiary', '2 Fixture Way', 'checking',
    'v1.${ACCOUNT_NUMBER}', '${ACCOUNT_NUMBER.slice(-4)}', '${ROUTING}', ${SUPER});
`);
  return db;
}

async function overview(db: any, as: number, opts: { jti?: string; impersonated?: boolean; env?: Record<string, unknown> } = {}) {
  const res: Response = await (app.request('/api/fund-admin/overview', {
    headers: { Authorization: `Bearer ${await tokenFor(as, opts)}` },
  }, envFor(db, opts.env)) as Promise<Response>).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

const auditCount = (db: any) => Number(one(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'mercury_accounts_read'").n);

test('roles: a founder, a partner and an investor get 403; a support session and a branch Worker are refused; Admin and Super Admin read', async () => {
  const db = seeded();
  for (const user of [FOUNDER, PARTNER, INVESTOR]) assert.equal((await overview(db, user)).status, 403, `user ${user}`);
  const support = await overview(db, SUPER, { jti: JTI.superFresh, impersonated: true });
  assert.deepEqual([support.status, support.body?.code], [403, 'support_session_refused']);
  assert.equal((await overview(db, ADMIN, { jti: JTI.adminTotp, env: { BRANCH_CODE: 'fr' } })).status, 403, 'a branch');
  assert.equal(auditCount(db), 0, 'a refused read is not audited as a read');
  for (const [user, jti] of [[ADMIN, JTI.adminTotp], [SUPER, JTI.superFresh]] as const) {
    const r = await overview(db, user, { jti });
    assert.equal(r.status, 200, `${user}: ${r.text}`);
  }
});

test('the audit row is written, before the figures; a failing audit insert answers 503 with no figures', async () => {
  const db = seeded();
  const ok = await overview(db, ADMIN, { jti: JTI.adminTotp });
  assert.equal(ok.status, 200);
  const audit = rows(db, "SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'mercury_accounts_read'");
  assert.deepEqual(audit.map((a) => [a.admin_user_id, JSON.parse(a.filters_json).surface]), [[ADMIN, 'fund_admin.overview']]);

  db.exec(`CREATE TRIGGER audit_down BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END;`);
  const down = await overview(db, ADMIN, { jti: JTI.adminTotp });
  assert.equal(down.status, 503);
  assert.equal(down.body?.code, 'audit_unavailable');
  for (const k of ['entities', 'funds', 'fees', 'drafts', 'matches']) assert.equal(down.body?.[k], undefined, k);
  assert.doesNotMatch(down.text, /1234500|4417|Fund I/);
});

test('the blocks: entities with their connection and accounts, Not recorded where there is none; the administered fund\'s figures, fee period, drafts and matches', async () => {
  const db = seeded();
  const { body } = await overview(db, SUPER, { jti: JTI.superFresh });
  assert.equal(body.as_of, TODAY);
  for (const k of ['entities', 'funds', 'fees', 'drafts', 'matches']) assert.equal(body[k].state, 'ok', k);

  const by = Object.fromEntries(body.entities.items.map((e: any) => [e.entity_key, e]));
  assert.deepEqual(Object.keys(by), ['holdings', 'management', 'gp', 'fund']);
  assert.equal(by.holdings.state, 'ok');
  assert.deepEqual(by.holdings.accounts, [{ uid: 'acct-h', kind: 'checking', ending: '4417', nickname: 'Operating', status: null,
    current_cents: 1234500, available_cents: 1200000, balance_read_at: by.holdings.accounts[0].balance_read_at }]);
  assert.equal(by.holdings.payment_accounts, 1);
  assert.deepEqual([by.gp.state, by.gp.reason, by.gp.connection.status, by.gp.connection.last_error],
    ['not_recorded', 'No bank account yet', 'error', 'Mercury refused the token (401).']);
  for (const k of ['fund', 'management']) {
    assert.deepEqual([by[k].state, by[k].reason, by[k].connection, by[k].accounts], ['not_recorded', 'No Mercury connection', null, []], k);
  }

  // Only the administered fund: the outside GP's fund stays at /funds.
  assert.deepEqual(body.funds.items, [{
    fund_id: 1, name: 'Fund I', committed_cents: 150000, called_cents: 60000, received_cents: 5000,
    outstanding_cents: 55000, overdue_lines: 1, next_due_date: days(5),
  }]);
  assert.deepEqual(body.fees.items, [{ fund_id: 1, state: 'ok', reason: null, quarter: '2026Q3', status: 'draft', net_cents: 5100, issued_at: null }]);
  assert.deepEqual(body.drafts.items.find((d: any) => d.fund_id === 1), { fund_id: 1, entity_key: null, draft: 0, prepared: 1 });
  assert.deepEqual(body.drafts.items.find((d: any) => d.entity_key === 'holdings'), { fund_id: null, entity_key: 'holdings', draft: 1, prepared: 0 });
  assert.deepEqual(body.matches.items, [{ fund_id: 1, proposed: 1, needs_review: 1 }]);
});

test('a fund with no fee period reads Not recorded; a dropped store makes only its own block unreadable', async () => {
  const db = seeded();
  db.exec('UPDATE vc_funds SET gp_user_id = NULL WHERE id = 2;'); // now administered, with no fee period
  const both = (await overview(db, ADMIN, { jti: JTI.adminTotp })).body;
  assert.deepEqual(both.fees.items.find((f: any) => f.fund_id === 2),
    { fund_id: 2, state: 'not_recorded', reason: 'No fee period yet', quarter: null, status: null, net_cents: null, issued_at: null });

  db.exec('DROP TABLE fund_report_drafts;');
  const noDrafts = (await overview(db, ADMIN, { jti: JTI.adminTotp })).body;
  assert.deepEqual(noDrafts.drafts, { state: 'unreadable', items: [] });
  for (const k of ['entities', 'funds', 'fees', 'matches']) assert.equal(noDrafts[k].state, 'ok', k);

  db.exec('DROP TABLE mercury_accounts;');
  const noAccounts = (await overview(db, ADMIN, { jti: JTI.adminTotp })).body;
  assert.deepEqual(noAccounts.entities, { state: 'unreadable', items: [] });
  for (const k of ['funds', 'fees', 'matches']) assert.equal(noAccounts[k].state, 'ok', k);
  assert.equal(noAccounts.funds.items.length, 2);
});

test('no account number, routing number, token, counterparty or memo reaches the response', async () => {
  const db = seeded();
  const { text } = await overview(db, SUPER, { jti: JTI.superFresh });
  for (const secret of [ACCOUNT_NUMBER, ROUTING, TOKEN, 'v1.', '…ken-1', COUNTERPARTY, MEMO, 'merc-acct-fixture-1', 'txn-fixture-1']) {
    assert.ok(!text.includes(secret), `the overview carries ${secret}`);
  }
});

test('the overview never reaches the Mercury client: no import path from its route leads to services/mercury/client.ts', () => {
  const SRC = resolve(process.cwd(), 'cloudflare-worker/src');
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    // `from '…'`, a bare side-effect `import '…'`, and a dynamic `import('…')`.
    for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2] || m[3];
      let target = join(dirname(file), spec);
      if (!/\.ts$/.test(target)) target += '.ts';
      try { readFileSync(target); } catch { continue; }
      walk(target);
    }
  };
  walk(join(SRC, 'services/fundAdminOverview.ts'));
  assert.ok(seen.has(join(SRC, 'services/mercury/access.ts')), 'the walk follows imports');
  assert.ok(![...seen].some((f) => f.endsWith('services/mercury/client.ts')), 'the overview reaches the Mercury client');
});
