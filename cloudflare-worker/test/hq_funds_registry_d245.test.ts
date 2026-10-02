/**
 * D245 — HQ's Funds row reads a registry of which deployment runs which fund
 * (canvas H24), not the shared /funds product.
 *
 * WHAT THIS FILE HOLDS:
 *
 *   1. THE BRANCH READ. Over the baseline's own `vc_funds` and
 *      `fund_report_periods`: each fund with its GP entity, the committed
 *      figure the funds product itself computes (and null, not 0, when neither
 *      store holds one), and its newest ISSUED period — a draft is not an
 *      issue. A periods table that cannot be read leaves the funds answering,
 *      each with its last issue unknown rather than "none".
 *   2. THE HQ ROUTE. HQ's own row, then three stub branches — one that
 *      answers, one that throws, one provisioned with no binding. The throwing
 *      branch is Unreadable, never zero funds; the others are unaffected; the
 *      coverage says how many answered; and NO total across funds appears,
 *      because no fund table records a currency.
 *   3. THE GATE. `requireSuperAdmin`: a plain admin is refused.
 *   4. D375 — WHAT THE OVERSIGHT VIEW NEEDS (Fabric F6 and F10). Vintage,
 *      called (the D371 ledger's figure) over committed, DPI from paid
 *      distributions, and each F10 flag from both sides; each second table
 *      unreadable on its own leaves its fields absent, never 0 or "none"; and
 *      the row's keys are fund-level facts only — no LP and no GP name or email
 *      crosses the unauthenticated RPC.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_funds_registry_d245.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminHq from '../src/routes/admin_hq.ts';
import { branchFundsRegistry, readFundsRegistry, FUNDS_REGISTRY_CAP } from '../src/rpc/branchOps.ts';
import { FABRIC_NOT_RECORDED } from '../src/routes/admin_hq.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (name: string) => read(`cloudflare-worker/sql/migrations/${name}.sql`);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7;
const PLAIN = 8;

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
const run = (db: InstanceType<typeof DatabaseSync>, sql: string) => {
  for (const st of splitStatements(sql)) db.exec(st);
};

/** The fund tables as the baseline declares them (plus migration 312), with three funds and their periods. */
function fundsDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['vc_funds', 'fund_report_periods', 'limited_partners', 'capital_calls', 'fund_distributions', 'entities']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(migration('312_fund_call_ledger'));
  // D376: the fund's GP and vehicle entities. No fund here is linked, so each
  // jurisdiction is null (not recorded); fabric_entities_d376.test.ts links them.
  db.exec(migration('314_fabric_entities'));
  const f = db.prepare(
    `INSERT INTO vc_funds (id, name, status, gp_entity, fund_size_cents, total_commitment, vintage_year,
                           gp_user_id, gp_name, gp_title, fund_admin, auditor, custodian, lpa_doc_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // Every GP-of-record fact set, an LPA on file, a custodian.
  f.run(1, 'Spin-Out Fund I', 'investing', 'Axal VC GP LLC', 1_000_000_000, 0, 2025,
    41, 'Guy Partner', 'Managing Member', 'Fundadmin Co', 'Audit & Co', 'Custody Bank', 900);
  // No GP of record, and every GP fact blank or unset — the canvas's Nordics.
  f.run(2, 'Axal France Fund I FPCI', 'fundraising', '  ', 0, 4_200_000, null,
    null, null, '', null, '   ', '  ', null);
  // A GP of record with two facts missing.
  f.run(3, 'Dormant vehicle', 'closed', null, 0, 0, 2019,
    42, 'Gail Partner', 'Director', null, 'Audit & Co', 'Custody Bank', null);
  const p = db.prepare(
    `INSERT INTO fund_report_periods (fund_id, period, period_start, period_end, issued_at, status) VALUES (?,?,?,?,?,?)`,
  );
  p.run(1, '2026-Q1', '2026-01-01', '2026-03-31', '2026-04-15T10:00:00Z', 'issued');
  p.run(1, '2026-Q2', '2026-04-01', '2026-06-30', '2026-07-14T10:00:00Z', 'issued');
  // A newer DRAFT: not an issue, and must not be read as the last one.
  p.run(1, '2026-Q3', '2026-07-01', '2026-09-30', null, 'draft');
  p.run(2, '2026-Q2', '2026-04-01', '2026-06-30', null, 'draft');
  // A draft OLDER than the last issue is not "drafted, not issued".
  p.run(3, '2025-Q4', '2025-10-01', '2025-12-31', '2026-01-20T10:00:00Z', 'issued');
  p.run(3, '2025-Q3', '2025-07-01', '2025-09-30', null, 'draft');

  const lp = db.prepare('INSERT INTO limited_partners (id, fund_id, commitment_amount, status, name, email) VALUES (?,?,?,?,?,?)');
  lp.run(11, 1, 6_000_000, 'active', 'Lena Limited', 'lena@lp.example');
  lp.run(12, 1, 4_000_000, 'committed', 'Leo Limited', 'leo@lp.example');
  lp.run(31, 3, 1_000, 'active', 'Lou Limited', 'lou@lp.example');
  const cc = db.prepare('INSERT INTO capital_calls (limited_partner_id, amount, amount_cents, status) VALUES (?,?,?,?)');
  // Since 312 the cents are exact and win over the dollars beside them.
  cc.run(11, 2_499_999.99, 250_000_000, 'paid');
  // Before 312 a line has dollars only, rounded to cents.
  cc.run(12, 500_000.40, null, 'pending');
  cc.run(31, 10, 1_000, 'pending');
  const d = db.prepare('INSERT INTO fund_distributions (fund_id, lp_id, amount_cents, distribution_type, status) VALUES (?,?,?,?,?)');
  d.run(1, 11, 60_000_000, 'return_of_capital', 'paid');
  // Not paid: not a distribution yet.
  d.run(1, 12, 99_000_000, 'profit_share', 'pending');
  return db;
}

/* ------------------------------------------------------------------ *
 * 1 · the branch read                                                 *
 * ------------------------------------------------------------------ */

test('D245: a branch lists its funds with GP entity, committed figure and newest issued period', async () => {
  const db = fundsDb();
  const r: any = await branchFundsRegistry({ DB: makeD1(db), BRANCH_CODE: 'fr' } as any);
  assert.equal(r.branch, 'fr');
  assert.match(r.as_of, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(r.complete, true);
  assert.equal(r.periods_available, true);
  const by = Object.fromEntries(r.funds.map((f: any) => [f.name, f]));
  assert.deepEqual(Object.keys(by), ['Axal France Fund I FPCI', 'Dormant vehicle', 'Spin-Out Fund I'], 'not ordered by name');

  const spin = by['Spin-Out Fund I'];
  assert.equal(spin.gp_entity, 'Axal VC GP LLC');
  assert.equal(spin.committed_minor, 1_000_000_000);
  assert.equal(spin.committed_source, 'fund_size_cents');
  assert.deepEqual(spin.last_issued, { period: '2026-Q2', period_end: '2026-06-30', issued_at: '2026-07-14T10:00:00Z' },
    'the newest ISSUED period is not the one reported — a draft is not an issue');

  const fr = by['Axal France Fund I FPCI'];
  assert.equal(fr.gp_entity, null, 'a blank GP entity was reported as a name');
  assert.equal(fr.committed_minor, 420_000_000, 'the legacy dollars were not read as the committed figure');
  assert.equal(fr.committed_source, 'total_commitment');
  assert.equal(fr.last_issued, null, 'a fund with only a draft was given an issued period');

  const dormant = by['Dormant vehicle'];
  assert.equal(dormant.committed_minor, null, 'two default zeros were reported as nothing committed');
  assert.equal(dormant.committed_source, null);
});

test('D245: the periods table unreadable leaves the funds answering, each last issue unknown — not "none"', async () => {
  const db = fundsDb();
  db.exec('DROP TABLE fund_report_periods');
  const r: any = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.funds.length, 3);
  assert.equal(r.periods_available, false);
  assert.match(r.periods_reason, /unknown rather than never/);
  for (const f of r.funds) {
    assert.ok(!('last_issued' in f), `${f.name} claims a last issue nobody read`);
    assert.ok(!('draft_not_issued' in f.flags), `${f.name} claims a draft state nobody read`);
  }
  // The other reads are unaffected.
  assert.equal(r.calls_available, true);
  assert.equal(r.funds.find((f: any) => f.id === 1).called_minor, 300_000_040);
});

test('D245: the read is a branch method with no secret, and refuses on HQ', async () => {
  assert.equal(branchFundsRegistry.length, 1, 'the branch read takes an argument beyond env — a secret it should not need');
  await assert.rejects(branchFundsRegistry({ DB: makeD1(fundsDb()) } as any), /only live on a branch/);
});

test('D245: a list past the ceiling says it stopped', async () => {
  const db = fundsDb();
  const f = db.prepare('INSERT INTO vc_funds (name, status) VALUES (?, ?)');
  for (let i = 0; i < FUNDS_REGISTRY_CAP; i += 1) f.run(`Bulk ${String(i).padStart(4, '0')}`, 'fundraising');
  const r: any = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.funds.length, FUNDS_REGISTRY_CAP);
  assert.equal(r.complete, false);
});

/* ------------------------------------------------------------------ *
 * 2 · the HQ route                                                    *
 * ------------------------------------------------------------------ */

function hqDb() {
  const db = fundsDb();
  for (const t of ['users', 'super_admins', 'territory_licences']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  run(db, migration('258_licence_deployments'));
  db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)').run(HOLDER, 'sue@axal.example', 'admin', 'Sue Hart');
  db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)').run(PLAIN, 'pat@axal.example', 'admin', 'Pat Plain');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const lic = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?,?,?,?,?, 'active')`);
  lic.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  lic.run(2, 'lic_de', 'AXL-002', 'Axal VC DACH GmbH', 'Axal VC DACH');
  lic.run(3, 'lic_es', 'AXL-003', 'Axal VC Iberia SL', 'Axal VC Iberia');
  const dep = db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status) VALUES (?,?,?,?,?, 'live')`);
  dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  dep.run('lic_de', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de');
  dep.run('lic_es', 'es', 'es.axal.vc', 'studioos-es', 'studioos-es');
  return db;
}

const FR_FUNDS = {
  branch: 'fr', as_of: '2026-09-26T09:00:00Z', complete: true, periods_available: true,
  funds: [{ id: 1, name: 'Axal France Fund I FPCI', status: 'investing', gp_entity: 'Axal France GP SAS',
    committed_minor: 420_000_000, committed_source: 'fund_size_cents',
    last_issued: { period: '2026-Q2', period_end: '2026-06-30', issued_at: '2026-07-14T10:00:00Z' } }],
};

async function jwt(userId: number) {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function funds(db: InstanceType<typeof DatabaseSync>, as = HOLDER, bindings: Record<string, unknown> = {}) {
  const app = new Hono<any>();
  app.route('/api/admin/hq', adminHq);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const res = await app.request('/api/admin/hq/funds', { headers: { Authorization: `Bearer ${await jwt(as)}` } },
    { DB: makeD1(db), JWT_SECRET, ...bindings } as any);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* status says it */ }
  return { status: res.status, body, text };
}
const STUBS = {
  BRANCH_FR: { async fundsRegistry() { return FR_FUNDS; } },
  BRANCH_DE: { async fundsRegistry() { throw new Error('binding unreachable'); } },
};

test('D245: HQ first, then each branch in its own state — an unreadable branch is never zero funds', async () => {
  const db = hqDb();
  const r = await funds(db, HOLDER, STUBS);
  assert.equal(r.status, 200, r.text);

  assert.equal(r.body.hq.status, 'ok');
  assert.deepEqual(r.body.hq.data.funds.map((f: any) => f.name),
    ['Axal France Fund I FPCI', 'Dormant vehicle', 'Spin-Out Fund I'], 'HQ\'s own funds are not its row');

  const by = Object.fromEntries(r.body.branches.map((b: any) => [b.code, b]));
  assert.deepEqual(Object.keys(by).sort(), ['de', 'es', 'fr']);
  assert.equal(by.fr.status, 'ok');
  assert.deepEqual(by.fr.data.funds, FR_FUNDS.funds, 'the answering branch was changed by the one that did not answer');
  assert.equal(by.fr.label, 'Axal VC France');

  assert.equal(by.de.status, 'unreadable');
  assert.match(by.de.reason, /binding unreachable/);
  assert.ok(!('data' in by.de), 'an unreadable branch carries a fund list');

  assert.equal(by.es.status, 'not_deployed');

  assert.deepEqual(
    { total: r.body.branches_coverage.total, answered: r.body.branches_coverage.answered },
    { total: 3, answered: 1 },
  );
  assert.deepEqual(r.body.branches_coverage.unreadable.sort(), ['de', 'es']);
});

test('D245: the payload carries no total across funds, and says why, with the currency not recorded', async () => {
  const db = hqDb();
  const r = await funds(db, HOLDER, STUBS);
  assert.deepEqual(Object.keys(r.body).sort(),
    ['branches', 'branches_coverage', 'committed_unit', 'hq', 'not_recorded', 'open_in_branch', 'read_at', 'total'],
    'a field appeared on the payload — a sum across funds would be one');
  assert.deepEqual(Object.keys(r.body.total).sort(), ['reason', 'shown']);
  assert.equal(r.body.total.shown, false);
  assert.match(r.body.total.reason, /euros to dollars/);
  assert.equal(r.body.committed_unit.recorded, false);
  assert.match(r.body.committed_unit.reason, /currency/);
  assert.equal(r.body.open_in_branch.built, false);
  // No figure on the payload equals a sum of two or more committed amounts.
  const amounts = [
    ...r.body.hq.data.funds.map((f: any) => f.committed_minor),
    ...FR_FUNDS.funds.map((f) => f.committed_minor),
  ].filter((n) => typeof n === 'number');
  const sum = amounts.reduce((a, b) => a + b, 0);
  assert.ok(!JSON.stringify(r.body).includes(String(sum)), 'a total across funds is on the payload');
});

test('D245: HQ\'s own table unreadable is its own state, and the branches still answer', async () => {
  const db = hqDb();
  db.exec('DROP TABLE vc_funds');
  const r = await funds(db, HOLDER, STUBS);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.hq.status, 'unreadable');
  assert.match(r.body.hq.reason, /HQ's own fund table could not be read/);
  assert.equal(r.body.branches.find((b: any) => b.code === 'fr').status, 'ok');
});

test('D245: only the elevation reads it — a plain admin is refused', async () => {
  const db = hqDb();
  const plain = await funds(db, PLAIN, STUBS);
  assert.equal(plain.status, 403, plain.text);
  assert.ok(!('branches' in plain.body));
});

/* ------------------------------------------------------------------ *
 * 4 · D375 — what the oversight view needs (Fabric F6 and F10)        *
 * ------------------------------------------------------------------ */

const byId = async (db = fundsDb()) => {
  const r: any = await readFundsRegistry({ DB: makeD1(db) } as any);
  return { r, f: Object.fromEntries(r.funds.map((x: any) => [x.id, x])) as Record<number, any> };
};

test('D375: each fund carries its vintage, or null when none is recorded', async () => {
  const { f } = await byId();
  assert.equal(f[1].vintage_year, 2025);
  assert.equal(f[2].vintage_year, null, 'an unset vintage was given a year');
  assert.equal(f[3].vintage_year, 2019);
  assert.equal(f[3].status, 'closed', 'the stage is not the fund\'s own status');
});

test('D375: called is the call ledger\'s figure, and called ÷ committed is null when nothing is committed', async () => {
  const { r, f } = await byId();
  assert.equal(r.calls_available, true);
  // 250_000_000 exact cents (not the dollars beside them) + 500_000.40 dollars rounded.
  assert.equal(f[1].called_minor, 300_000_040);
  assert.equal(f[1].called_ratio, 0.3);
  // Committed and nothing called: a real zero, from a ledger that answered.
  assert.equal(f[2].called_minor, 0);
  assert.equal(f[2].called_ratio, 0);
  // Called with no committed figure: the ratio has nothing to divide by.
  assert.equal(f[3].called_minor, 1_000);
  assert.equal(f[3].called_ratio, null, 'a ratio was computed against a committed figure nobody recorded');
});

test('D375: the called expression is the ledger\'s own OWED_CENTS_SQL, not a second definition', () => {
  const ledger = read('cloudflare-worker/src/services/fundCallLedger.ts');
  const owed = ledger.match(/const OWED_CENTS_SQL = `([^`]+)`;/);
  assert.ok(owed, 'OWED_CENTS_SQL is gone from the ledger');
  const ops = read('cloudflare-worker/src/rpc/branchOps.ts');
  const reg = ops.slice(ops.indexOf('export async function readFundsRegistry('), ops.indexOf('export async function branchFundsRegistry('));
  assert.ok(reg.includes(`SUM(${owed![1]})`), 'the registry sums a different owed figure from the ledger\'s');
});

test('D375: DPI is paid distributions over called, and null when nothing is called', async () => {
  const { r, f } = await byId();
  assert.equal(r.distributions_available, true);
  assert.equal(f[1].distributed_minor, 60_000_000, 'a pending distribution was counted as paid');
  assert.equal(f[1].dpi, 0.2);
  assert.equal(f[2].distributed_minor, 0);
  assert.equal(f[2].dpi, null, 'a DPI was computed over nothing called');
  assert.equal(f[3].dpi, 0);
});

test('D375: F10 — no GP of record, from both sides', async () => {
  const { f } = await byId();
  assert.equal(f[1].flags.no_gp_of_record, false);
  assert.equal(f[2].flags.no_gp_of_record, true, 'a fund with no gp_user_id reads as having a GP of record');
  assert.equal(f[3].flags.no_gp_of_record, false);
});

test('D375: F10 — custodian recorded, from both sides; a blank custodian is not one', async () => {
  const { f } = await byId();
  assert.equal(f[1].flags.custodian_recorded, true);
  assert.equal(f[2].flags.custodian_recorded, false, 'a blank custodian was read as recorded');
});

test('D375: F10 — which GP-of-record facts are unset, in the canvas\'s order', async () => {
  const { f } = await byId();
  assert.deepEqual(f[1].flags.gp_fields_unset, []);
  assert.deepEqual(f[2].flags.gp_fields_unset, ['gp_name', 'gp_title', 'gp_entity', 'fund_admin', 'auditor'],
    'a blank string was read as a recorded fact');
  assert.deepEqual(f[3].flags.gp_fields_unset, ['gp_entity', 'fund_admin']);
});

test('D375: F10 — LPA on file, from both sides', async () => {
  const { f } = await byId();
  assert.equal(f[1].flags.lpa_on_file, true);
  assert.equal(f[2].flags.lpa_on_file, false);
});

test('D375: F10 — a draft newer than the last issue is "drafted, not issued"; an older one is not', async () => {
  const { f } = await byId();
  assert.deepEqual(f[1].flags.draft_not_issued, { period: '2026-Q3', period_end: '2026-09-30' });
  assert.deepEqual(f[2].flags.draft_not_issued, { period: '2026-Q2', period_end: '2026-06-30' },
    'a draft with nothing issued was not flagged');
  assert.equal(f[3].flags.draft_not_issued, null, 'a draft older than the last issue was flagged');
});

test('D375: the call lines unreadable leave called and DPI absent — not 0 — and the rest answering', async () => {
  const db = fundsDb();
  db.exec('DROP TABLE capital_calls');
  const { r, f } = await byId(db);
  assert.equal(r.calls_available, false);
  assert.match(r.calls_reason, /unknown rather than nothing/);
  for (const x of r.funds) {
    for (const k of ['called_minor', 'called_ratio', 'dpi']) assert.ok(!(k in x), `${x.name} carries ${k} nobody read`);
  }
  assert.equal(r.distributions_available, true);
  assert.equal(f[1].distributed_minor, 60_000_000);
  assert.equal(r.periods_available, true);
  assert.equal(f[1].flags.no_gp_of_record, false);
});

test('D375: the distributions unreadable leave DPI absent, and called answering', async () => {
  const db = fundsDb();
  db.exec('DROP TABLE fund_distributions');
  const { r, f } = await byId(db);
  assert.equal(r.distributions_available, false);
  assert.match(r.distributions_reason, /unknown rather than nothing/);
  for (const x of r.funds) {
    assert.ok(!('dpi' in x) && !('distributed_minor' in x), `${x.name} carries a DPI nobody read`);
  }
  assert.equal(r.calls_available, true);
  assert.equal(f[1].called_ratio, 0.3);
});

test('D375: a row is fund-level facts only — no LP and no GP name or email crosses the RPC', async () => {
  const r: any = await branchFundsRegistry({ DB: makeD1(fundsDb()), BRANCH_CODE: 'fr' } as any);
  assert.deepEqual(Object.keys(r).sort(), [
    'as_of', 'branch', 'calls_available', 'complete', 'distributions_available', 'entities_available', 'funds',
    'periods_available',
  ]);
  for (const x of r.funds) {
    assert.deepEqual(Object.keys(x).sort(), [
      'called_minor', 'called_ratio', 'committed_minor', 'committed_source', 'distributed_minor', 'dpi',
      'flags', 'gp_entity', 'gp_entity_jurisdiction', 'id', 'jurisdiction', 'last_issued', 'name', 'status', 'vintage_year',
    ], `${x.name} carries a key that is not a fund-level fact`);
    assert.equal(x.jurisdiction, null, `${x.name} has a jurisdiction with no vehicle linked`);
    assert.deepEqual(Object.keys(x.flags).sort(),
      ['custodian_recorded', 'draft_not_issued', 'gp_fields_unset', 'lpa_on_file', 'no_gp_of_record']);
  }
  // `as_of` is the read clock. An ISO stamp contains `:41` whenever the
  // minute or the second is 41, which is not the fixture's gp_user_id.
  const { as_of, ...facts } = r;
  assert.match(as_of, /^\d{4}-\d{2}-\d{2}T/);
  const text = JSON.stringify(facts);
  for (const leak of ['Lena', 'lena@lp.example', 'Leo', 'Lou', 'Guy Partner', 'Gail', 'Managing Member',
    'Custody Bank', 'Fundadmin', 'Audit & Co', '"41"', ':41', ':900']) {
    assert.ok(!text.includes(leak), `the registry carries ${leak}`);
  }
});

test('D375: the route says why each F6 element with no store is not recorded', async () => {
  const r = await funds(hqDb(), HOLDER, STUBS);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.not_recorded, FABRIC_NOT_RECORDED);
  assert.deepEqual(Object.keys(FABRIC_NOT_RECORDED).sort(),
    ['hq_economics', 'jurisdiction', 'obligations', 'platform_aum', 'report_cadence', 'tvpi']);
  assert.match(FABRIC_NOT_RECORDED.hq_economics, /owner's brief/);
  assert.match(FABRIC_NOT_RECORDED.platform_aum, /currency/);
  assert.match(FABRIC_NOT_RECORDED.tvpi, /valuation/);
  for (const [k, v] of Object.entries(FABRIC_NOT_RECORDED)) {
    assert.ok(v.length > 40, `${k} has no reason`);
    assert.doesNotMatch(v, /\bForge\b|fiduciar|\badvice\b|\badvisor\b|recommendation/i, `${k} uses a word the programme forbids`);
  }
});
