/**
 * D266 — a branch reports its quarter to HQ every morning, and what arrives.
 *
 * `reportUsage` was the statement ledger's only designed input and had no
 * caller. `pushUsageReport` (services/usageReport.ts) is the call, and this
 * file drives it end to end: a real branch database answering
 * `branchRevenueSummary`, and a stub HQ binding that forwards to the REAL
 * `reportUsage` over a real HQ database. The stub adds nothing but the
 * transport, so what lands in `subsidiary_usage_reports` is what production
 * would write.
 *
 * What it pins, and why each is the one that could quietly go wrong:
 *
 *   · EVERY STREAM ARRIVES UNMEASURED. Three NULL rows, never a zero. A
 *     `gross_cents ?? 0` anywhere on the path would write a complete-looking
 *     quarter that earned nothing, which is the reading D111 exists to refuse.
 *   · THE TOKEN COST TRAVELS AS A BASIS, NOT A FIGURE. The one measured
 *     number rides `estimate_basis` and `is_estimate`.
 *   · A WRONG OR MISSING SECRET WRITES NOTHING. The report is authenticated
 *     by HQ; the push refuses before calling when the branch has none.
 *   · HQ NEVER REPORTS TO ITSELF, and the stub is never called there.
 *   · 1 OCTOBER STILL CLOSES Q3. Two quarters per run, oldest first.
 *   · A RE-RUN REPLACES ROWS. The upsert key is (licence, period, stream).
 *   · D5947: A BRANCH WITH LEDGER ROWS REPORTS THEIR GROSS, in the rows' own
 *     currency, and HQ stores it unchanged with its state, source and as-of
 *     time. A quarter that began before the ledger's coverage is incomplete;
 *     a second currency is named, never added; a branch with no Stripe
 *     webhook says its ledger is empty by design.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/usage_report_d266.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { reportUsage } from '../src/rpc/hqOps.ts';
import { pushUsageReport, reportPeriods, sendUsageReportNow } from '../src/services/usageReport.ts';
import { FINANCIAL_EVENTS_DDL } from '../src/services/financialEvents.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_260 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql'), 'utf8',
);
const MIGRATION_5947 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/202611161359_5947_usage_report_source.sql'), 'utf8',
);

/** Synthetic. Its digest is computed by the fixture, never pasted in. */
const SECRET = 'rpc-secret-for-fr-synthetic-0000';

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
        async all() { return { success: true, results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HQ with `fr` provisioned and its secret's hash stored. */
async function hqDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE territory_licences ( revision INTEGER NOT NULL DEFAULT 0,id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      licence_ref TEXT UNIQUE NOT NULL, legal_entity_name TEXT NOT NULL, brand_name TEXT NOT NULL,
      revenue_share_bps INTEGER, currency TEXT NOT NULL DEFAULT 'EUR', status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live', rpc_secret_hash TEXT);
  `);
  db.exec(MIGRATION_260);
  db.exec(MIGRATION_5947);
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, revenue_share_bps)
     VALUES ('lic_fr','AXL-001','Axal VC France SAS','Axal VC France',3500)`,
  ).run();
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, rpc_secret_hash)
     VALUES ('lic_fr','fr','fr.axal.vc','studioos-fr','studioos-fr',?)`,
  ).run(await sha256Hex(SECRET));
  return db;
}

/**
 * The HQ binding, as a branch sees it: the real `reportUsage` over HQ's own
 * database, with the calls recorded. HQ's env has no BRANCH_CODE, which is
 * what makes it HQ.
 */
function stubHq(db: InstanceType<typeof DatabaseSync>) {
  const hqEnv = { DB: makeD1(db) } as any;
  const calls: { code: string; period: string }[] = [];
  return {
    calls,
    binding: {
      async reportUsage(code: string, secret: string, period: string, figures: any[]) {
        calls.push({ code, period });
        return reportUsage(hqEnv, code, secret, period, figures);
      },
    },
  };
}

/** A branch with some AI spend inside Q3 2026. */
function branchEnv(over: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec('CREATE TABLE ai_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, est_cost_usd REAL, created_at TEXT)');
  db.prepare("INSERT INTO ai_usage_logs (est_cost_usd, created_at) VALUES (1.25, '2026-08-14 10:00:00')").run();
  db.prepare("INSERT INTO ai_usage_logs (est_cost_usd, created_at) VALUES (0.75, '2026-09-02 10:00:00')").run();
  return { DB: makeD1(db), __db: db, BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', RPC_SECRET: SECRET, ...over } as any;
}

const rows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare(
    `SELECT period, stream, gross_cents, currency, is_estimate, estimate_basis, reported_at
       FROM subsidiary_usage_reports ORDER BY period, stream`,
  ).all() as any[];

const OCT_1 = new Date(Date.UTC(2026, 9, 1, 5, 10));

test('reportPeriods: the previous quarter and the current one, oldest first — 1 October still closes Q3', () => {
  assert.deepEqual(reportPeriods(OCT_1), ['2026-Q3', '2026-Q4']);
  assert.deepEqual(reportPeriods(new Date(Date.UTC(2026, 0, 1))), ['2025-Q4', '2026-Q1']);
  assert.deepEqual(reportPeriods(new Date(Date.UTC(2026, 5, 30, 23, 59))), ['2026-Q1', '2026-Q2']);
});

test('a branch reports both quarters: every stream NULL, the token cost carried as a basis, reported_at stamped', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const env = branchEnv({ HQ: stub.binding });

  const r = await pushUsageReport(env, OCT_1);
  assert.equal(r.sent, true, r.reason);
  assert.deepEqual(r.periods.map((p) => [p.period, p.sent, p.streams]), [['2026-Q3', true, 3], ['2026-Q4', true, 3]]);
  assert.deepEqual(stub.calls, [{ code: 'fr', period: '2026-Q3' }, { code: 'fr', period: '2026-Q4' }]);

  const got = rows(hq);
  assert.equal(got.length, 6, 'three streams for each of two quarters');
  for (const row of got) {
    assert.equal(row.gross_cents, null, `${row.period} ${row.stream} must arrive unmeasured, never as a zero`);
    assert.match(String(row.reported_at), /^\d{4}-\d{2}-\d{2}T/, 'reported_at is stamped by HQ');
  }
  const q3Token = got.find((x) => x.period === '2026-Q3' && x.stream === 'token_margin');
  assert.equal(q3Token.is_estimate, 1);
  assert.equal(q3Token.currency, 'USD');
  assert.match(String(q3Token.estimate_basis), /USD 2\.00 over 2 calls/,
    'the Q3 inference cost is the one measured number, and it travels as a basis');
  const q4Token = got.find((x) => x.period === '2026-Q4' && x.stream === 'token_margin');
  assert.match(String(q4Token.estimate_basis), /USD 0\.00 over 0 calls/);
  assert.deepEqual(
    [...new Set(got.map((x) => x.stream))].sort(),
    ['licence_fees', 'subscriptions', 'token_margin'],
  );
});

test('a re-run replaces the rows rather than adding to them', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const env = branchEnv({ HQ: stub.binding });
  await pushUsageReport(env, OCT_1);
  const first = rows(hq).map((x) => x.reported_at);
  await new Promise((r) => setTimeout(r, 5));
  await pushUsageReport(env, OCT_1);
  const second = rows(hq);
  assert.equal(second.length, 6, 'the upsert key is (licence, period, stream)');
  assert.notDeepEqual(second.map((x) => x.reported_at), first, 'the second run restated the rows');
});

test('a wrong secret writes nothing, and the push says why', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const r = await pushUsageReport(branchEnv({ HQ: stub.binding, RPC_SECRET: 'not-the-secret-synthetic' }), OCT_1);
  assert.equal(r.sent, false);
  assert.equal(stub.calls.length, 2, 'HQ was asked, and refused both');
  assert.ok(r.periods.every((p) => !p.sent && /did not accept/.test(String(p.reason))));
  assert.equal(rows(hq).length, 0, 'a refused report writes no row');
});

test('a missing secret refuses before HQ is called', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const r = await pushUsageReport(branchEnv({ HQ: stub.binding, RPC_SECRET: '' }), OCT_1);
  assert.equal(r.sent, false);
  assert.match(String(r.reason), /no RPC_SECRET/);
  assert.equal(stub.calls.length, 0);
  assert.equal(rows(hq).length, 0);
});

test('a branch with no HQ binding refuses before anything', async () => {
  const r = await pushUsageReport(branchEnv(), OCT_1);
  assert.equal(r.sent, false);
  assert.match(String(r.reason), /no HQ service binding/);
});

test('HQ never reports to itself, and the binding is never called there', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const env = { DB: makeD1(hq), RPC_SECRET: SECRET, HQ: stub.binding } as any;
  const r = await pushUsageReport(env, OCT_1);
  assert.equal(r.sent, false);
  assert.match(String(r.reason), /only a branch reports/);
  assert.equal(stub.calls.length, 0);
});

test('an HQ that never answers is a stated deadline, not a hang', async () => {
  const { USAGE_REPORT_DEADLINE_MS } = await import('../src/services/usageReport.ts');
  assert.ok(USAGE_REPORT_DEADLINE_MS <= 10_000, 'a scheduled block must not wait on HQ for long');
  const env = branchEnv({ HQ: { reportUsage: () => new Promise(() => {}) } });
  const r = await pushUsageReport(env, OCT_1, 50);
  assert.equal(r.sent, false);
  assert.deepEqual(r.periods.map((p) => p.sent), [false, false]);
  assert.match(String(r.reason), /did not answer the 2026-Q3 report within 0\.05 seconds/);
});


/* ------------------------------------------------------------------ *
 * D5947 — the measured subscriptions stream, end to end               *
 * ------------------------------------------------------------------ */

const WEBHOOK = { STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_for_tests' };

/**
 * A branch whose database holds the financial ledger (D5299's DDL, as every
 * migrated database does), its Stripe coverage starting at `coverage`.
 */
function ledgerBranch(coverage: string, over: Record<string, unknown> = {}, licenceCurrency = 'EUR') {
  const env = branchEnv(over);
  const db: InstanceType<typeof DatabaseSync> = (env as any).__db;
  for (const statement of FINANCIAL_EVENTS_DDL) {
    if (statement.startsWith('INSERT OR IGNORE INTO financial_event_coverage')) {
      db.prepare('INSERT INTO financial_event_coverage (source, coverage_starts_at) VALUES (?, ?)').run('stripe', coverage);
    } else {
      db.exec(statement);
    }
  }
  db.exec('CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, currency TEXT)');
  db.prepare('INSERT INTO branch_licence (id, currency) VALUES (1, ?)').run(licenceCurrency);
  let n = 0;
  const invoice = (currency: string, gross: number, at: string, stream = 'tier') => {
    n += 1;
    db.prepare(
      `INSERT INTO financial_events (uid, source, source_event_id, source_event_type, kind, livemode,
         revenue_stream, currency, gross_cents, refund_cents, net_cents, occurred_at)
       VALUES (?, 'stripe', ?, 'invoice.paid', 'invoice', 1, ?, ?, ?, 0, ?, ?)`,
    ).run(`fe_${n}`, `evt_${n}`, stream, currency, gross, gross, at);
  };
  return { env, db, invoice };
}

const subs = (hq: InstanceType<typeof DatabaseSync>, period: string) =>
  hq.prepare(
    `SELECT gross_cents, currency, state, reason, source, source_as_of, reported_at
       FROM subsidiary_usage_reports WHERE period = ? AND stream = 'subscriptions'`,
  ).get(period) as any;

test('D5947: a branch with ledger rows reports their gross in their own currency, and HQ stores it unchanged', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const { env, invoice } = ledgerBranch('2026-06-01T00:00:00Z', { HQ: stub.binding, ...WEBHOOK });
  invoice('CHF', 12_000, '2026-07-02T10:00:00Z');
  invoice('CHF', 3_500, '2026-09-30T23:59:59Z');
  invoice('CHF', 99_999, '2026-10-01T00:00:00Z');           // Q4 — not Q3's
  invoice('CHF', 77_777, '2026-08-01T00:00:00Z', 'cart_order'); // not a subscription stream

  const r = await pushUsageReport(env, OCT_1);
  assert.equal(r.sent, true, r.reason);
  const q3 = subs(hq, '2026-Q3');
  assert.equal(q3.gross_cents, 15_500, 'the quarter\'s invoices, and only those, are the gross');
  assert.equal(q3.currency, 'CHF', 'the figure travels in the rows\' own currency, not the EUR default');
  assert.equal(q3.state, 'complete');
  assert.equal(q3.source, 'financial_events');
  assert.match(String(q3.source_as_of), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the figure has an as-of time');
  assert.match(String(q3.reported_at), /^\d{4}-\d{2}-\d{2}T/, 'reported_at is still the report\'s own stamp');

  const q4 = subs(hq, '2026-Q4');
  assert.equal(q4.gross_cents, 99_999);
  const others = hq.prepare(
    "SELECT stream, gross_cents, state, source FROM subsidiary_usage_reports WHERE period = '2026-Q3' AND stream != 'subscriptions' ORDER BY stream",
  ).all() as any[];
  assert.deepEqual(others.map((x) => [x.stream, x.gross_cents, x.state, x.source]), [
    ['licence_fees', null, 'not_available', 'none'],
    ['token_margin', null, 'not_available', 'ai_usage_logs'],
  ], 'a stream the branch cannot measure is still NULL, with its state and source');
});

test('D5947: a quarter that began before the ledger\'s coverage is reported incomplete, never as the full quarter', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const { env, invoice } = ledgerBranch('2026-08-15T09:00:00Z', { HQ: stub.binding, ...WEBHOOK });
  invoice('EUR', 4_000, '2026-09-01T00:00:00Z');
  await pushUsageReport(env, OCT_1);
  const q3 = subs(hq, '2026-Q3');
  assert.equal(q3.state, 'incomplete');
  assert.equal(q3.gross_cents, 4_000, 'what the ledger holds is reported, marked partial');
  assert.match(String(q3.reason), /2026-08-15T09:00:00Z/, 'the coverage start is named');
  assert.equal(subs(hq, '2026-Q4').state, 'not_recorded', 'Q4 has no invoice, and an empty quarter is not a zero');
  assert.equal(subs(hq, '2026-Q4').gross_cents, null);
  assert.doesNotMatch(String(subs(hq, '2026-Q4').reason), /receives no Stripe webhooks/,
    'a branch that does receive webhooks was told its ledger is empty by design');
});

test('D5947: a branch with no Stripe webhook reports its ledger empty by design, not as zero', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const { env } = ledgerBranch('2026-06-01T00:00:00Z', { HQ: stub.binding });
  await pushUsageReport(env, OCT_1);
  for (const period of ['2026-Q3', '2026-Q4']) {
    const row = subs(hq, period);
    assert.equal(row.gross_cents, null);
    assert.equal(row.state, 'not_recorded');
    assert.match(String(row.reason), /receives no Stripe webhooks/);
    assert.match(String(row.reason), /empty by design/);
  }
});

test('D5947: two currencies are never added — the licence currency is kept, the other named, the stream incomplete', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const { env, invoice } = ledgerBranch('2026-06-01T00:00:00Z', { HQ: stub.binding, ...WEBHOOK });
  invoice('EUR', 10_000, '2026-07-10T00:00:00Z');
  invoice('USD', 2_500, '2026-07-11T00:00:00Z');
  await pushUsageReport(env, OCT_1);
  const q3 = subs(hq, '2026-Q3');
  assert.equal(q3.gross_cents, 10_000, 'a cross-currency sum reached HQ');
  assert.equal(q3.currency, 'EUR');
  assert.equal(q3.state, 'incomplete');
  assert.match(String(q3.reason), /USD 2500 minor units/);
  assert.equal(
    (hq.prepare("SELECT COUNT(*) AS n FROM subsidiary_usage_reports WHERE period = '2026-Q3' AND stream = 'subscriptions'").get() as any).n,
    1, 'one row per stream: the key is not widened',
  );

  // None of the currencies is the licence's: no figure stands for the stream.
  const hq2 = await hqDb();
  const stub2 = stubHq(hq2);
  const other = ledgerBranch('2026-06-01T00:00:00Z', { HQ: stub2.binding, ...WEBHOOK }, 'GBP');
  other.invoice('EUR', 10_000, '2026-07-10T00:00:00Z');
  other.invoice('USD', 2_500, '2026-07-11T00:00:00Z');
  await pushUsageReport(other.env, OCT_1);
  const none = subs(hq2, '2026-Q3');
  assert.equal(none.gross_cents, null);
  assert.equal(none.state, 'incomplete');
  assert.match(String(none.reason), /EUR 10000 minor units, USD 2500 minor units/);
});

test('D5947: a re-report replaces the measured figure, and Send now carries the same metadata', async () => {
  const hq = await hqDb();
  const stub = stubHq(hq);
  const store = new Map<string, string>();
  const kv = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } };
  const { env, invoice } = ledgerBranch('2026-06-01T00:00:00Z', { HQ: stub.binding, RATE_LIMITS: kv, ...WEBHOOK });
  invoice('EUR', 1_000, '2026-07-10T00:00:00Z');
  await pushUsageReport(env, OCT_1);
  assert.equal(subs(hq, '2026-Q3').gross_cents, 1_000);
  invoice('EUR', 2_000, '2026-08-10T00:00:00Z');
  const sent = await sendUsageReportNow(env, OCT_1);
  assert.equal(sent.called, true, sent.reason);
  const rowsQ3 = hq.prepare("SELECT * FROM subsidiary_usage_reports WHERE period = '2026-Q3' AND stream = 'subscriptions'").all() as any[];
  assert.equal(rowsQ3.length, 1, 'the re-report added a row');
  assert.equal(rowsQ3[0].gross_cents, 3_000);
  assert.equal(rowsQ3[0].source, 'financial_events');
  assert.ok(rowsQ3[0].source_as_of);
});
