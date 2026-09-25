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
import { pushUsageReport, reportPeriods } from '../src/services/usageReport.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_260 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql'), 'utf8',
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
        async all() { return { results: db.prepare(sql).all(...b) }; },
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
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      licence_ref TEXT UNIQUE NOT NULL, legal_entity_name TEXT NOT NULL, brand_name TEXT NOT NULL,
      revenue_share_bps INTEGER, currency TEXT NOT NULL DEFAULT 'EUR', status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live', rpc_secret_hash TEXT);
  `);
  db.exec(MIGRATION_260);
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
  return { DB: makeD1(db), BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', RPC_SECRET: SECRET, ...over } as any;
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
