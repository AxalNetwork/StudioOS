/**
 * D4694 (#4694) — HQ's licence terms and licence-fee invoices are written from
 * a snapshot the editor read earlier. Every such write now names the revision
 * it read, applies only the keys it names, and is refused with a 409 when
 * another write got there first. Synthetic data only.
 *
 *   core terms     PATCH /api/admin/licences/:uid/terms   territory_licences.terms_revision
 *   the schedule   PUT   /api/admin/licences/:uid/terms   licence_terms.revision
 *   invoices       PATCH /api/admin/licences/:uid/fee-invoices/:uid   licence_fee_invoices.revision
 *
 * WHAT IS PINNED
 *   · Renewing while the editor is open, then saving a stale form, is a 409 that
 *     writes nothing; after a reload, saving only the fee keeps the newer renewal.
 *   · Two writers on the same revision: one wins, the other gets a 409 and its
 *     value is not stored.
 *   · Invalid input is refused, never clamped or truncated: 12000 bps, "USDX",
 *     2026-02-30, "3500", -1.
 *   · The legacy PATCH takes the schedule's bar (TOTP + step-up) and a reason.
 *   · The schedule: a missing revision is refused; a stale one is a 409 with the
 *     current record; a first save racing another inserts once.
 *   · A conditional write that changes no row (the competing write lands between
 *     the check and the UPDATE) is a 409 and appends no event and no audit row.
 *   · A payment racing a void cannot leave a successful void; two payment edits
 *     on one revision cannot replace the newer total.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_revisions_4694.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { licenceRevisionAlters } from './_licence_revisions.mjs';
import adminLicences from '../src/routes/admin_licences.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { FeeInvoiceRefusal, recordFeeInvoiceUpdate, feeInvoiceOf } from '../src/services/licenceFeeInvoices.ts';
import { isIsoDay, parseExpectedRevision, validateCoreTermsBody } from '../src/services/licenceTerms.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const SCHEMA = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'territory_licences', 'licence_admins',
  'licence_events', 'licence_territories', 'licence_seats']
  .map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\nCREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT UNIQUE, code TEXT, hostname TEXT, status TEXT);\n'
  + ['513_licence_fee_invoices.sql', '202611062240_licence_event_changes.sql'].map(mig).join('\n')
  + '\n' + mig('512_licence_terms.sql').replace(/ALTER TABLE branch_licence[^;]*;/, '')
  + '\n' + licenceRevisionAlters('territory_licences', 'licence_terms', 'licence_fee_invoices');
const SECRET = ['d4694', 'revisions', 'fixture', 'signing', 'secret'].join('-');
const SUPER = 1, SUPER_PW = 2, ADMIN = 3, LIC = 'lic_4694';

type Hook = ((sql: string) => void) | null;

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  // A hook that runs just before a matching statement is prepared: it plays the competing write that lands
  // between the route's check and its UPDATE.
  const hooks: { before: Hook } = { before: null };
  const wrapped: any = new Proxy(DB, {
    get(target, prop, recv) {
      if (prop === 'prepare') return (sql: string) => { hooks.before?.(sql); return target.prepare(sql); };
      return Reflect.get(target, prop, recv);
    },
  });
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, SUPER_PW, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_PW})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(SUPER, 'totp-super', 'totp');
  s.run(SUPER_PW, 'pw-super', 'password');
  s.run(ADMIN, 'totp-3', 'totp');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-4694', 'Licensee', 'Brand', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2027-01-01')`).run(LIC);
  db.prepare(`INSERT INTO licence_fee_invoices
      (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency, reference, issued_at, due_at, status,
       figures_json, figures_sha256)
    VALUES ('inv_1', ?, '2026–27', '2026-01-01', '2026-12-31', 1000000, 'EUR', 'REF-1', '2026-11-01', '2026-12-01', 'issued', '{}', 'x')`).run(LIC);

  const env = { DB: wrapped, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/admin/licences', adminLicences);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const jti = who === SUPER ? 'totp-super' : who === SUPER_PW ? 'pw-super' : `totp-${who}`;
    const token = await new SignJWT({ user_id: who, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(`/api/admin/licences${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env));
    let json: any = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  }
  const row = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const rows = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const lic = () => row('SELECT * FROM territory_licences WHERE uid = ?', LIC);
  const inv = () => row("SELECT * FROM licence_fee_invoices WHERE uid = 'inv_1'");
  const termEvents = () => rows("SELECT id FROM licence_events WHERE event = 'terms_changed'").length;
  const T = `/${LIC}/terms`;
  const I = `/${LIC}/fee-invoices/inv_1`;
  return { db, env, hooks, call, row, rows, lic, inv, termEvents, T, I };
}

const REASON = 'Agreed at the annual review';

// 1 ───────────────────────────────────────────────────────────────────────────
test('renewing while Terms is open, then saving a stale form, writes nothing; after a reload, editing only the fee keeps the newer renewal date', async () => {
  // Mutations checked: the revision not bumped by renew; the revision not compared in the UPDATE; every field written instead of the named ones.
  const f = fixture();
  assert.equal(f.lic().terms_revision, 0, 'the editor opens at revision 0');
  const renewed = await f.call(SUPER, 'POST', `/${LIC}/renew`, { renews_on: '2028-01-01' });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.deepEqual([f.lic().renews_on, f.lic().terms_revision], ['2028-01-01', 1]);

  const stale = await f.call(SUPER, 'PATCH', f.T, { annual_fee_cents: 1100000, expected_revision: 0, reason: REASON });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.error, 'terms_conflict');
  assert.equal(stale.body.current_revision, 1);
  assert.equal(stale.body.current.renews_on, '2028-01-01', 'the 409 carries what to reload');
  assert.deepEqual([f.lic().annual_fee_cents, f.lic().renews_on], [1000000, '2028-01-01'], 'nothing was written');
  assert.equal(f.termEvents(), 0, 'no event for a save that did not commit');

  const ok = await f.call(SUPER, 'PATCH', f.T, { annual_fee_cents: 1100000, expected_revision: 1, reason: REASON });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([f.lic().annual_fee_cents, f.lic().renews_on, f.lic().term_years, f.lic().terms_revision], [1100000, '2028-01-01', 3, 2],
    'only the named key changed; the newer renewal date survived');
  assert.deepEqual(Object.keys(ok.body.changed), ['annual_fee_cents']);
  assert.equal(f.termEvents(), 1);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('two writers on one revision: one wins, the other gets a 409 and its value is not stored', async () => {
  // Mutations checked: the revision dropped from the UPDATE's WHERE; the row count not read.
  const f = fixture();
  const a = await f.call(SUPER, 'PATCH', f.T, { revenue_share_bps: 3500, expected_revision: 0, reason: REASON });
  const b = await f.call(SUPER, 'PATCH', f.T, { token_split_bps: 6000, expected_revision: 0, reason: REASON });
  assert.deepEqual([a.status, b.status], [200, 409]);
  assert.deepEqual([f.lic().revenue_share_bps, f.lic().token_split_bps], [3500, 5000]);
  assert.equal(f.termEvents(), 1);

  // The competing write lands between the check and the UPDATE: the UPDATE changes no row.
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE territory_licences') && sql.includes('terms_revision = terms_revision + 1')) {
      raced = true;
      f.db.exec('UPDATE territory_licences SET terms_revision = terms_revision + 1, term_years = 9');
    }
  };
  const c = await f.call(SUPER, 'PATCH', f.T, { token_split_bps: 7000, expected_revision: 1, reason: REASON });
  f.hooks.before = null;
  assert.equal(c.status, 409, JSON.stringify(c.body));
  assert.deepEqual([f.lic().token_split_bps, f.lic().term_years, f.lic().terms_revision], [5000, 9, 2], 'the racing write stands; ours is not stored');
  assert.equal(f.termEvents(), 1, 'a save that changed no row appends no event');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('invalid core terms are refused and nothing is stored: no clamping, no truncating, no coercing', async () => {
  // Mutations checked: bps clamped to 0..10000 again; the currency cut to three characters; a string of digits accepted.
  const f = fixture();
  const before = f.lic();
  const bad: Array<[string, Record<string, unknown>]> = [
    ['revenue_share_bps', { revenue_share_bps: 12000 }], ['revenue_share_bps', { revenue_share_bps: -5 }],
    ['revenue_share_bps', { revenue_share_bps: '3500' }], ['token_split_bps', { token_split_bps: 3500.5 }],
    ['currency', { currency: 'USDX' }], ['currency', { currency: 'U$D' }], ['currency', { currency: 123 }], ['currency', { currency: null }],
    ['starts_on', { starts_on: '2026-02-30' }], ['renews_on', { renews_on: '15/03/2026' }], ['renews_on', { renews_on: 20260315 }],
    ['term_years', { term_years: 0 }], ['term_years', { term_years: 51 }], ['term_years', { term_years: 2.5 }], ['term_years', { term_years: '3' }],
    ['annual_fee_cents', { annual_fee_cents: -1 }], ['annual_fee_cents', { annual_fee_cents: 10 ** 15 }], ['annual_fee_cents', { annual_fee_cents: '100' }],
    ['frequency', { frequency: 'monthly' }],
  ];
  for (const [field, body] of bad) {
    const r = await f.call(SUPER, 'PATCH', f.T, { ...body, expected_revision: 0, reason: REASON });
    assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${r.status}`);
    assert.equal(r.body.error, 'invalid_terms');
    assert.equal(r.body.errors[0].field, field, JSON.stringify(body));
  }
  assert.deepEqual(f.lic(), before, 'not one refused request changed the row');
  assert.equal(f.termEvents(), 0);

  const missing = [
    [{ revenue_share_bps: 100, reason: REASON }, 'revision_required'],
    [{ revenue_share_bps: 100, reason: REASON, expected_revision: '0' }, 'revision_required'],
    [{ revenue_share_bps: 100, reason: REASON, expected_revision: -1 }, 'revision_required'],
    [{ revenue_share_bps: 100, reason: REASON, expected_revision: 0.5 }, 'revision_required'],
    [{ revenue_share_bps: 100, expected_revision: 0 }, 'reason_required'],
    [{ revenue_share_bps: 100, expected_revision: 0, reason: '   ' }, 'reason_required'],
    [{ expected_revision: 0, reason: REASON }, 'nothing_to_change'],
  ] as const;
  for (const [body, code] of missing) assert.equal((await f.call(SUPER, 'PATCH', f.T, body)).body.error, code, JSON.stringify(body));
  assert.deepEqual(f.lic(), before);

  const lower = await f.call(SUPER, 'PATCH', f.T, { currency: 'usd', revenue_share_bps: 10000, starts_on: null, expected_revision: 0, reason: REASON });
  assert.equal(lower.status, 200, JSON.stringify(lower.body));
  assert.deepEqual([f.lic().currency, f.lic().revenue_share_bps, f.lic().starts_on], ['USD', 10000, null], 'case is normalised, null clears, the bound is allowed');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the legacy terms PATCH takes the schedule\'s bar: a TOTP session with a fresh step-up, a super admin, and a reason', async () => {
  // Mutations checked: requireSuperAdminWriteBar replaced by requireSuperAdmin on the PATCH.
  const f = fixture();
  const before = f.lic();
  const body = { annual_fee_cents: 1, expected_revision: 0, reason: REASON };
  for (const who of [ADMIN, SUPER_PW]) {
    const r = await f.call(who, 'PATCH', f.T, body);
    assert.ok(r.status === 401 || r.status === 403, `${who}: ${r.status}`);
  }
  assert.deepEqual(f.lic(), before);
  assert.equal((await f.call(SUPER, 'PATCH', f.T, body)).status, 200);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the schedule: a missing revision is refused, a stale one is a 409 with the current record, and two admins cannot silently overwrite each other', async () => {
  // Mutations checked: expected_revision optional; the revision not compared; the full row written from a stale snapshot.
  const f = fixture();
  const first = await f.call(SUPER, 'GET', f.T);
  assert.deepEqual([first.body.terms, first.body.revision], [null, 0]);
  const none = await f.call(SUPER, 'PUT', f.T, { terms: { governing_law: 'Delaware' }, reason: REASON });
  assert.deepEqual([none.status, none.body.error], [400, 'revision_required']);
  assert.equal(f.rows('SELECT * FROM licence_terms').length, 0);

  const a = await f.call(SUPER, 'PUT', f.T, { terms: { governing_law: 'Delaware' }, reason: REASON, expected_revision: 0 });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.revision, 1);
  const b = await f.call(SUPER, 'PUT', f.T, { terms: { cure_days: 30 }, reason: REASON, expected_revision: 0 });
  assert.equal(b.status, 409, JSON.stringify(b.body));
  assert.equal(b.body.error, 'terms_conflict');
  assert.equal(b.body.current_revision, 1);
  assert.equal(b.body.current.terms.governing_law, 'Delaware');
  assert.equal(f.row('SELECT cure_days, governing_law, revision FROM licence_terms').cure_days, null, 'the stale save was not stored');
  assert.equal(f.termEvents(), 1);

  const merged = await f.call(SUPER, 'PUT', f.T, { terms: { cure_days: 30 }, reason: REASON, expected_revision: 1 });
  assert.equal(merged.status, 200);
  assert.deepEqual([merged.body.terms.governing_law, merged.body.terms.cure_days, merged.body.revision], ['Delaware', 30, 2], 'after a reload both edits stand');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('a first schedule save racing another inserts once; a schedule UPDATE that changes no row is a 409 with no event', async () => {
  // Mutations checked: INSERT ... ON CONFLICT DO UPDATE in place of DO NOTHING; the schedule row count not read; the revision dropped from the UPDATE.
  const f = fixture();
  // Both admins read "no schedule yet" (revision 0). The other admin's first save lands between this one's
  // check and its INSERT, so the INSERT must do nothing and the save must be refused.
  let inserted = false;
  f.hooks.before = (sql) => {
    if (!inserted && sql.startsWith('INSERT INTO licence_terms')) {
      inserted = true;
      f.db.exec("INSERT INTO licence_terms (licence_uid, governing_law, revision) VALUES ('" + LIC + "', 'France', 1)");
    }
  };
  const lost = await f.call(SUPER, 'PUT', f.T, { terms: { governing_law: 'Delaware' }, reason: REASON, expected_revision: 0 });
  f.hooks.before = null;
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.equal(lost.body.current.terms.governing_law, 'France');
  assert.deepEqual(f.rows('SELECT governing_law, revision FROM licence_terms'), [{ governing_law: 'France', revision: 1 }], 'the other admin\'s row stands');
  assert.equal(f.termEvents(), 0, 'the refused save appended no event');
  const saved = await f.call(SUPER, 'PUT', f.T, { terms: { governing_law: 'Delaware' }, reason: REASON, expected_revision: 1 });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(f.termEvents(), 1);

  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE licence_terms')) { raced = true; f.db.exec("UPDATE licence_terms SET revision = revision + 1, cure_days = 99"); }
  };
  const c = await f.call(SUPER, 'PUT', f.T, { terms: { cure_days: 30 }, reason: REASON, expected_revision: 2 });
  f.hooks.before = null;
  assert.equal(c.status, 409, JSON.stringify(c.body));
  assert.deepEqual(f.rows('SELECT cure_days, revision FROM licence_terms'), [{ cure_days: 99, revision: 3 }]);
  assert.equal(f.termEvents(), 1);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('a payment racing a void cannot produce a successful void or a void audit row; two payment edits on one revision cannot replace the newer total', async () => {
  // Mutations checked: the revision removed from the invoice UPDATEs; the row count not read; the audit written before the write.
  const f = fixture();
  const audit = () => f.rows("SELECT action FROM activity_logs WHERE action LIKE 'licence_fee_invoice_%' ORDER BY id").map((r) => r.action);
  assert.equal((await f.call(SUPER, 'PATCH', f.I, { paid_cents: 100 })).body.error, 'revision_required');
  assert.equal(f.inv().paid_cents, 0);

  const pay = await f.call(SUPER, 'PATCH', f.I, { paid_cents: 300000, expected_revision: 0 });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(pay.body.invoice.revision, 1);
  const second = await f.call(SUPER, 'PATCH', f.I, { paid_cents: 500000, expected_revision: 0 });
  assert.deepEqual([second.status, second.body.error], [409, 'invoice_changed']);
  assert.deepEqual([second.body.current_revision, second.body.current_paid_cents], [1, 300000]);
  assert.equal(f.inv().paid_cents, 300000, 'the older edit did not replace the newer total');

  const voidStale = await f.call(SUPER, 'PATCH', f.I, { status: 'void', void_note: 'Issued in error to the wrong year', expected_revision: 0 });
  assert.equal(voidStale.status, 409);
  assert.equal(f.inv().status, 'issued');
  assert.deepEqual(audit(), ['licence_fee_invoice_payment'], 'no void audit row');

  // Another admin recorded a payment and then took it back (revision 2, paid 0 again): the invoice looks
  // voidable, but a void written from revision 0 never saw that history.
  await f.call(SUPER, 'PATCH', f.I, { paid_cents: 0, expected_revision: 1 });
  const staleVoid = await f.call(SUPER, 'PATCH', f.I, { status: 'void', void_note: 'Issued in error to the wrong year', expected_revision: 0 });
  assert.deepEqual([staleVoid.status, staleVoid.body.error], [409, 'invoice_changed']);
  assert.deepEqual([f.inv().status, f.inv().revision], ['issued', 2], 'a stale void on a voidable invoice is still refused');

  // The payment lands between the void's check and its UPDATE: the void changes no row.
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE licence_fee_invoices') && sql.includes("status = 'void'")) {
      raced = true;
      f.db.exec("UPDATE licence_fee_invoices SET paid_cents = 100, revision = revision + 1 WHERE uid = 'inv_1'");
    }
  };
  const racing = await f.call(SUPER, 'PATCH', f.I, { status: 'void', void_note: 'Issued in error to the wrong year', expected_revision: 2 });
  f.hooks.before = null;
  assert.equal(racing.status, 409, JSON.stringify(racing.body));
  assert.deepEqual([f.inv().status, f.inv().paid_cents], ['issued', 100], 'the invoice stayed non-void');
  assert.deepEqual(audit(), ['licence_fee_invoice_payment', 'licence_fee_invoice_payment'], 'still no void audit row');

  const ok = await f.call(SUPER, 'PATCH', f.I, { paid_cents: 0, expected_revision: 3 });
  assert.equal(ok.status, 200);
  const v = await f.call(SUPER, 'PATCH', f.I, { status: 'void', void_note: 'Issued in error to the wrong year', expected_revision: 4 });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(f.inv().status, 'void');
  assert.equal(audit().filter((a) => a === 'licence_fee_invoice_void').length, 1);
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('recordFeeInvoiceUpdate throws a 409 when its conditional UPDATE changes no row, and names the current state', async () => {
  // Mutations checked: the row count not read (the stale call returns the unchanged invoice as if it had been written).
  const f = fixture();
  const stale = (await feeInvoiceOf(f.env, LIC, 'inv_1'))!;
  f.db.exec("UPDATE licence_fee_invoices SET revision = 5, paid_cents = 200 WHERE uid = 'inv_1'");
  await assert.rejects(
    recordFeeInvoiceUpdate(f.env, stale, { kind: 'payment', paid_cents: 400, paid_note: null, expected_revision: 0 }, SUPER, '2026-11-07T00:00:00Z'),
    (e: any) => e instanceof FeeInvoiceRefusal && e.status === 409 && e.code === 'invoice_changed' && e.extra.current_revision === 5 && e.extra.current_paid_cents === 200,
  );
  assert.equal(f.inv().paid_cents, 200);
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('the validators: expected_revision is a whole number from zero; dates are real; unknown keys are named', () => {
  assert.deepEqual(parseExpectedRevision(0), { ok: true, value: 0 });
  for (const bad of [undefined, null, '0', -1, 1.5, NaN, Infinity, 2 ** 60, true]) assert.equal(parseExpectedRevision(bad).ok, false, String(bad));
  assert.equal(isIsoDay('2028-02-29'), true);
  for (const bad of ['2027-02-29', '2026-13-01', '2026-1-1', '', null, 20260101]) assert.equal(isIsoDay(bad), false, String(bad));
  const r = validateCoreTermsBody({ currency: 'eur', nope: 1, revenue_share_bps: 10001 });
  assert.equal(r.ok, false);
  assert.deepEqual((r as any).errors.map((e: any) => e.field).sort(), ['nope', 'revenue_share_bps']);
});
