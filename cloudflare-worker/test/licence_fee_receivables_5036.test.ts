/**
 * D5036 (#5036) — licence-fee revenue on HQ · Revenue: run-rate, invoiced, collected and outstanding are four figures.
 *
 * The summary's `licence_fees` is a quarter of each active annual fee, and it used to sit under "This quarter" as if
 * it were revenue. These tests hold the four concepts apart on real rows: the run-rate is labelled as one, the invoice
 * ledger answers invoiced / collected / outstanding per currency for the period, overdue invoices are listed, void
 * ones count nowhere, a billable year with no invoice is a visible gap, and no figure is added across currencies.
 *
 * The DDL is the migrations' own (513 and the revision column), and `territory_licences` is the baseline's, so the
 * CHECKs the route relies on are the real ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import revenue, { quarterFromParam, quarterOf } from '../src/routes/admin_revenue.ts';
import {
  expectedGaps, isOverdue, licenceFeeReceivables, outstandingOf, periodBuckets, receivableBuckets,
} from '../src/services/licenceFeeReceivables.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 601;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
const migration = (f: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${f}`), 'utf8');

function freshDb(opts: { invoices?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'territory_licences', 'ai_usage_logs', 'promo_codes']) db.exec(ddl(t));
  db.exec(migration('260_subsidiary_statements.sql'));
  if (opts.invoices !== false) {
    db.exec(migration('513_licence_fee_invoices.sql'));
    db.exec(migration('202611071531_licence_revisions.sql').split('\n').filter((l) => /licence_fee_invoices/.test(l) && /^ALTER/.test(l)).join('\n'));
  }
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(SUPER, 'admin', 'Holder', 'h@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

function licence(db: any, ref: string, o: { status?: string; fee?: number | null; currency?: string; starts?: string | null } = {}) {
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency, starts_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`uid-${ref}`, ref, `${ref} SAS`, `${ref} brand`, o.status ?? 'active', o.fee === undefined ? 400_000 : o.fee, o.currency ?? 'EUR', o.starts === undefined ? '2025-01-01' : o.starts);
}

let n = 0;
function invoice(db: any, ref: string, o: { amount: number; paid?: number; status?: string; currency?: string; issued: string; due: string; periodStart?: string }) {
  n += 1;
  const start = o.periodStart ?? `${2100 + n}-01-01`;
  db.prepare(
    `INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency, reference,
       issued_at, due_at, status, paid_cents, figures_json, figures_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'x')`,
  ).run(`inv-${n}`, `uid-${ref}`, 'year', start, `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`, o.amount, o.currency ?? 'EUR',
    `${ref}-${n}`, o.issued, o.due, o.status ?? 'issued', o.paid ?? 0);
}

async function call(db: any, query = '') {
  const jwt = await new SignJWT({ user_id: SUPER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await revenue.fetch(
    new Request(`http://x/summary${query}`, { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const Q = { start: '2026-07-01', end: '2026-10-01', label: 'Q3 2026' };
const TODAY = '2026-09-15';

test('the annual-fee quarter is labelled a contracted run-rate, never revenue', async () => {
  const db = freshDb();
  licence(db, 'FR-001', { fee: 400_000 });
  const r = await call(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.licence_fees.measure, 'contracted_run_rate');
  assert.equal(r.body.licence_fees.label, 'Contracted quarterly run-rate');
  assert.match(r.body.licence_fees.basis, /not what was invoiced or collected/);
  assert.doesNotMatch(r.body.licence_fees.label, /revenue/i, 'the run-rate is called revenue');
  assert.equal(r.body.licence_fees.by_currency[0].quarter_cents, 100_000, 'the run-rate figure itself moved');
});

test('invoiced, collected and outstanding are three figures per currency, apart from the run-rate', async () => {
  const db = freshDb();
  licence(db, 'FR-001', { fee: 400_000 });
  licence(db, 'UK-001', { fee: 900_000, currency: 'GBP' });
  invoice(db, 'FR-001', { amount: 400_000, paid: 150_000, issued: '2026-07-10', due: '2026-12-01' });
  invoice(db, 'FR-001', { amount: 200_000, paid: 200_000, status: 'paid', issued: '2026-08-01', due: '2026-08-31' });
  invoice(db, 'UK-001', { amount: 900_000, paid: 0, currency: 'GBP', issued: '2026-07-02', due: '2026-08-01' });
  invoice(db, 'FR-001', { amount: 999_999, issued: '2026-06-30', due: '2026-07-30' }); // last quarter: not in the period
  const out = await licenceFeeReceivables({ DB: makeD1(db) } as any, Q, TODAY);
  assert.equal(out.available, true);
  const by = Object.fromEntries((out as any).by_currency.map((b: any) => [b.currency, b]));
  assert.deepEqual(Object.keys(by).sort(), ['EUR', 'GBP'], 'one bucket per currency');
  assert.equal(by.EUR.invoices, 2);
  assert.equal(by.EUR.invoiced_cents, 600_000, 'invoiced is the issued amount in the period');
  assert.equal(by.EUR.collected_cents, 350_000, 'collected is what was recorded paid');
  assert.equal(by.EUR.outstanding_cents, 250_000, 'outstanding is invoiced less collected');
  assert.equal(by.GBP.invoiced_cents, 900_000);
  assert.equal(by.GBP.outstanding_cents, 900_000);
  assert.notEqual(by.EUR.invoiced_cents, by.EUR.collected_cents, 'the fixture must tell invoiced from collected');
  for (const k of ['invoiced_cents', 'collected_cents', 'outstanding_cents']) {
    assert.equal(Object.keys(out).includes(k), false, `a cross-currency ${k} was invented at the top level`);
  }
});

test('overdue invoices are identified, listed, and counted in the receivable of any period', async () => {
  const db = freshDb();
  licence(db, 'FR-001');
  licence(db, 'UK-001', { currency: 'GBP' });
  invoice(db, 'FR-001', { amount: 400_000, paid: 100_000, issued: '2026-01-10', due: '2026-02-09' });   // older period, overdue
  invoice(db, 'UK-001', { amount: 900_000, currency: 'GBP', issued: '2026-07-02', due: '2026-08-01' }); // in period, overdue
  invoice(db, 'FR-001', { amount: 50_000, issued: '2026-09-01', due: '2026-10-01' });                   // open, not yet due
  invoice(db, 'FR-001', { amount: 70_000, paid: 70_000, status: 'paid', issued: '2026-01-01', due: '2026-01-02' }); // paid: not overdue
  const out: any = await licenceFeeReceivables({ DB: makeD1(db) } as any, Q, TODAY);
  assert.equal(out.overdue_total, 2);
  assert.deepEqual(out.overdue.map((o: any) => [o.reference.split('-')[0], o.outstanding_cents, o.currency]),
    [['FR', 300_000, 'EUR'], ['UK', 900_000, 'GBP']], 'the overdue list, oldest due first');
  assert.equal(out.overdue[0].days_overdue, 218);
  assert.equal(out.overdue[0].brand_name, 'FR-001 brand');
  const rec = Object.fromEntries(out.receivable_by_currency.map((b: any) => [b.currency, b]));
  assert.equal(rec.EUR.open_invoices, 2, 'a paid invoice is not a receivable');
  assert.equal(rec.EUR.outstanding_cents, 350_000);
  assert.equal(rec.EUR.overdue_cents, 300_000);
  assert.equal(rec.GBP.overdue_invoices, 1);
  const period = Object.fromEntries(out.by_currency.map((b: any) => [b.currency, b]));
  assert.equal(period.GBP.overdue_cents, 900_000);
  assert.equal(period.EUR.overdue_invoices, 0, 'an invoice issued in another period was counted overdue in this one');
});

test('a void invoice counts as neither revenue nor receivable, and is shown apart', async () => {
  const db = freshDb();
  licence(db, 'FR-001');
  invoice(db, 'FR-001', { amount: 400_000, status: 'void', issued: '2026-07-10', due: '2026-08-09' });
  invoice(db, 'FR-001', { amount: 100_000, issued: '2026-07-11', due: '2026-12-01' });
  const out: any = await licenceFeeReceivables({ DB: makeD1(db) } as any, Q, TODAY);
  const eur = out.by_currency[0];
  assert.equal(eur.invoiced_cents, 100_000, 'a void invoice was counted as invoiced');
  assert.equal(eur.outstanding_cents, 100_000, 'a void invoice was counted as outstanding');
  assert.equal(eur.invoices, 1);
  assert.equal(eur.void_invoices, 1);
  assert.equal(eur.void_cents, 400_000);
  assert.equal(out.receivable_by_currency[0].outstanding_cents, 100_000, 'a void invoice was a receivable');
  assert.equal(out.overdue_total, 0, 'a void invoice past its due date was called overdue');
  assert.equal(outstandingOf({ status: 'void', amount_cents: 5, paid_cents: 0 }), 0);
});

test('a billable year with no invoice is a visible gap; a void-only year and an uninvoiceable licence are named', async () => {
  const db = freshDb();
  licence(db, 'FR-001', { starts: '2025-03-01' });                      // year 2026–27 started 2026-03-01: not invoiced
  licence(db, 'DE-001', { starts: '2025-03-01' });                      // invoiced for this year
  licence(db, 'IT-001', { starts: '2025-03-01', status: 'suspended' }); // suspended still bills: only a void invoice
  licence(db, 'ES-001', { fee: null });                                 // cannot be invoiced: no fee
  licence(db, 'PT-001', { starts: null });                              // cannot be invoiced: no start date
  licence(db, 'NL-001', { starts: '2027-01-01' });                      // not started yet
  licence(db, 'BE-001', { status: 'terminated' });                      // owes no new year
  invoice(db, 'DE-001', { amount: 400_000, issued: '2026-03-01', due: '2026-03-31', periodStart: '2026-03-01' });
  invoice(db, 'IT-001', { amount: 400_000, status: 'void', issued: '2026-03-01', due: '2026-03-31', periodStart: '2026-03-01' });
  const out: any = await licenceFeeReceivables({ DB: makeD1(db) } as any, Q, TODAY);
  assert.deepEqual(out.expected_not_invoiced.map((g: any) => [g.licence_ref, g.gap, g.period_label, g.amount_cents, g.currency]), [
    ['FR-001', 'not_invoiced', '2026–27', 400_000, 'EUR'],
    ['IT-001', 'void_not_reissued', '2026–27', 400_000, 'EUR'],
  ]);
  assert.deepEqual(out.cannot_invoice.map((x: any) => [x.licence_ref, x.reason]).sort(), [['ES-001', 'no_annual_fee'], ['PT-001', 'no_start_date']]);
  assert.equal(out.not_started, 1);
});

test('an unreadable invoice ledger says so and leaves the run-rate standing', async () => {
  const db = freshDb({ invoices: false });
  licence(db, 'FR-001');
  const r = await call(db);
  assert.equal(r.status, 200);
  assert.equal(r.body.licence_invoices.available, false);
  assert.match(r.body.licence_invoices.reason, /could not be read/);
  assert.equal(r.body.licence_invoices.by_currency, undefined, 'an unreadable ledger reported figures');
  assert.equal(r.body.licence_fees.available, true, 'the run-rate went down with the ledger');
});

test('the summary takes a period, and refuses a malformed or unstarted one', async () => {
  const db = freshDb();
  licence(db, 'FR-001');
  invoice(db, 'FR-001', { amount: 400_000, issued: '2026-02-10', due: '2026-03-01' });
  const r = await call(db, '?period=2026-Q1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.quarter.key, '2026-Q1');
  assert.equal(r.body.licence_invoices.by_currency[0].invoiced_cents, 400_000, 'the period did not reach the invoice read');
  assert.equal((await call(db, '?period=2026-Q5')).status, 400);
  assert.equal((await call(db, '?period=2999-Q1')).status, 400, 'a future quarter is a page of zeros, refused');
  const now = new Date('2026-09-15T12:00:00Z');
  assert.deepEqual(quarterFromParam(undefined, now), quarterOf(now));
  assert.equal(quarterFromParam('2026-Q4', now), null);
  assert.equal(quarterFromParam('2026-Q3', now)?.start, '2026-07-01');
});

test('the pure helpers agree with the route', () => {
  const rows: any[] = [
    { status: 'issued', amount_cents: 10, paid_cents: 4, currency: 'eur', due_at: '2026-01-01' },
    { status: 'paid', amount_cents: 5, paid_cents: 5, currency: 'EUR', due_at: '2026-01-01' },
  ];
  assert.equal(isOverdue(rows[0], '2026-01-02'), true);
  assert.equal(isOverdue(rows[0], '2026-01-01'), false, 'due today is not overdue');
  assert.equal(isOverdue(rows[1], '2026-02-01'), false);
  assert.equal(periodBuckets(rows, '2026-02-01')[0].currency, 'EUR', 'currencies are bucketed upper-case');
  assert.equal(periodBuckets(rows, '2026-02-01').length, 1);
  assert.equal(receivableBuckets(rows, '2026-02-01')[0].outstanding_cents, 6);
  assert.deepEqual(expectedGaps([], new Map(), '2026-01-01'), { gaps: [], cannot_invoice: [], not_started: 0 });
});
