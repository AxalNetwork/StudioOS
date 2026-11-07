/**
 * D4677 (#4677) — the Pipeline's consequential transitions are atomic, current
 * and evidence-backed. The real routers over real in-memory SQLite, with a
 * batch that is one transaction (all of it lands or none of it does), as D1's is.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/pipeline_atomic_d4677.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { quotesRouter } from '../src/routes/needs.ts';
import pipeline, { openGateReview } from '../src/routes/pipeline.ts';
import legalcap from '../src/routes/legalcap.ts';

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const BASELINE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../sql/schema_baseline.sql'), 'utf8');
const SCORE_TABLE = BASELINE.slice(BASELINE.indexOf('CREATE TABLE score_snapshots'), BASELINE.indexOf(');', BASELINE.indexOf('CREATE TABLE score_snapshots')) + 2)
  .replace(/REFERENCES \w+\(\w+\)/g, '');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const OPERATOR = 2;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, hooks: { failOn?: RegExp } = {}) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          if (hooks.failOn?.test(sql)) throw new Error('simulated write failure');
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // D1's batch is one transaction.
    async batch(x: any[]) {
      const out: any[] = [];
      db.exec('BEGIN');
      try { for (const st of x || []) out.push(await st.run()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return out;
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT, founder_id INTEGER, partner_id INTEGER);
    CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT, company TEXT);
    CREATE TABLE founder_needs (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'design', title TEXT NOT NULL DEFAULT 'n', description TEXT NOT NULL DEFAULT 'd', status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, need_id INTEGER NOT NULL, rfp_id INTEGER, partner_id INTEGER NOT NULL,
      price REAL NOT NULL, timeline_weeks INTEGER, deliverables TEXT NOT NULL DEFAULT 'x', notes TEXT, status TEXT NOT NULL DEFAULT 'submitted', decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, company_id INTEGER, loss_reason TEXT, UNIQUE (need_id, partner_id));
    CREATE TABLE engagements (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL, project_id INTEGER NOT NULL, price REAL NOT NULL, status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT, invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, company_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sector TEXT, stage TEXT NOT NULL DEFAULT 'idea',
      status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake','scoring','tier_1','tier_2','rejected','spinout','active')),
      founder_id INTEGER, company_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE subsidiaries (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, holding_company_id TEXT, subsidiary_name TEXT NOT NULL,
      jurisdiction TEXT NOT NULL DEFAULT 'Delaware_CCorp', stripe_atlas_status TEXT DEFAULT 'pending', stripe_atlas_ref TEXT, ein TEXT, incorporation_date TIMESTAMP,
      ip_transfer_complete INTEGER DEFAULT 0, equity_allocated TEXT DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      spinout_status TEXT DEFAULT 'pending', ip_license_doc_id INTEGER, equity_allocation_json TEXT DEFAULT '{}', stripe_atlas_id TEXT,
      independent_scaling_enabled INTEGER DEFAULT 0, post_spinout_dashboard_url TEXT);
    CREATE UNIQUE INDEX uq_sub_deal ON subsidiaries(deal_id);
    CREATE TABLE legal_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      content TEXT, file_url TEXT, generated_by INTEGER, signed_by INTEGER, version INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, fund_id INTEGER);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  `);
  // The score table is the real one: the board reads it through the integrity service.
  db.exec(SCORE_TABLE);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(ADMIN, 'admin', 'Ada', 'ada@example.test');
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(OPERATOR, 'partner', 'Pat', 'pat@example.test');
  db.prepare("INSERT INTO partners (id, name, company) VALUES (1, 'Firm A', 'A'), (2, 'Firm B', 'B')").run();
  db.prepare("INSERT INTO projects (id, name, stage, status) VALUES (42, 'Orbit Notes', 'idea', 'active')").run();
  db.prepare("INSERT INTO founder_needs (id, uid, project_id, founder_id) VALUES (7, 'need_7', 42, 9)").run();
  db.prepare("INSERT INTO quotes (id, uid, need_id, partner_id, price) VALUES (11, 'q11', 7, 1, 1000), (12, 'q12', 7, 2, 2000)").run();
  return db;
}

const app = new Hono<any>();
app.route('/api/quotes', quotesRouter);
app.route('/api/pipeline', pipeline);
app.route('/api/legalcap', legalcap);
app.onError((err: any, c) => c.json({ detail: String(err?.message || err) }, 500));

async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role, jti: `t-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(db: InstanceType<typeof DatabaseSync>, method: string, path: string, body?: unknown, as: { id: number; role: string } = { id: ADMIN, role: 'admin' }, hooks: { failOn?: RegExp } = {}) {
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, hooks) };
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${await token(as.id, as.role)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => { const s = [console.warn, console.error]; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { [console.warn, console.error] = s; } };
const rows = (db: InstanceType<typeof DatabaseSync>, sql: string, ...a: any[]) => db.prepare(sql).all(...a).map((r) => ({ ...r })) as any[];

// ───────────────────────────────────────────────────────── quote acceptance

test('accepting a quote accepts it, rejects the rival, fills the need and creates exactly one engagement', async () => {
  const db = freshDb();
  const r = await call(db, 'POST', '/api/quotes/11/accept');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(rows(db, 'SELECT id, status FROM quotes ORDER BY id').map((q) => q.status), ['accepted', 'rejected']);
  assert.equal(rows(db, 'SELECT status FROM founder_needs')[0].status, 'filled');
  const eng = rows(db, 'SELECT quote_id, partner_id, founder_id, project_id, price FROM engagements');
  assert.deepEqual(eng, [{ quote_id: 11, partner_id: 1, founder_id: 9, project_id: 42, price: 1000 }]);
});

test('two different quotes accepted for one need: exactly one wins, one engagement, the other is 409', async () => {
  const db = freshDb();
  const [a, b] = await Promise.all([call(db, 'POST', '/api/quotes/11/accept'), call(db, 'POST', '/api/quotes/12/accept')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(rows(db, "SELECT id FROM quotes WHERE status = 'accepted'").length, 1);
  assert.equal(rows(db, 'SELECT id FROM engagements').length, 1);
  const loser = a.status === 409 ? a : b;
  assert.match(loser.body.error, /decided/);
});

test('a stale accept of the rival after the need is decided is refused and changes nothing', async () => {
  const db = freshDb();
  await call(db, 'POST', '/api/quotes/11/accept');
  const before = rows(db, 'SELECT id, status FROM quotes ORDER BY id');
  const late = await call(db, 'POST', '/api/quotes/12/accept');
  assert.equal(late.status, 409);
  assert.deepEqual(rows(db, 'SELECT id, status FROM quotes ORDER BY id'), before);
  assert.equal(rows(db, 'SELECT id FROM engagements').length, 1);
});

test('retrying the winning accept is the same 200, not a second engagement', async () => {
  const db = freshDb();
  await call(db, 'POST', '/api/quotes/11/accept');
  const again = await call(db, 'POST', '/api/quotes/11/accept');
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'accepted');
  assert.equal(rows(db, 'SELECT id FROM engagements').length, 1);
});

test('a retry repairs an accepted quote that has no engagement', async () => {
  const db = freshDb();
  await call(db, 'POST', '/api/quotes/11/accept');
  db.prepare('DELETE FROM engagements').run();
  const again = await call(db, 'POST', '/api/quotes/11/accept');
  assert.equal(again.status, 200);
  assert.equal(rows(db, 'SELECT quote_id FROM engagements').length, 1);
});

test('an engagement insert that fails fails the accept and leaves every prior state unchanged', async () => {
  const db = freshDb();
  const r = await quiet(() => call(db, 'POST', '/api/quotes/11/accept', undefined, { id: ADMIN, role: 'admin' }, { failOn: /INSERT INTO engagements/ }));
  assert.equal(r.status, 500, 'the failure propagates; it is not reported as success');
  assert.deepEqual(rows(db, 'SELECT status FROM quotes ORDER BY id').map((q) => q.status), ['submitted', 'submitted']);
  assert.equal(rows(db, 'SELECT status FROM founder_needs')[0].status, 'open');
  assert.equal(rows(db, 'SELECT id FROM engagements').length, 0);
});

test('a need that is no longer open cannot take an accept', async () => {
  const db = freshDb();
  db.prepare("UPDATE founder_needs SET status = 'closed'").run();
  const r = await call(db, 'POST', '/api/quotes/11/accept');
  assert.equal(r.status, 409);
  assert.equal(rows(db, "SELECT id FROM quotes WHERE status = 'accepted'").length, 0);
});

// ───────────────────────────────────────────────────────────────── gates

const gate = (db: InstanceType<typeof DatabaseSync>, status = 'pending') =>
  Number(db.prepare("INSERT INTO decision_gates (deal_id, status, ai_recommendation) VALUES (42, ?, 'spinout_ready')").run(status).lastInsertRowid);
async function ready(db: InstanceType<typeof DatabaseSync>) {
  // ensureSchema creates the pipeline tables on first use.
  await call(db, 'GET', '/api/pipeline/active');
  db.prepare("INSERT INTO project_stages (deal_id, stage_name, status) VALUES (42, 'decision_gate', 'active')").run();
}

test('deciding a gate moves the gate, the stage and the project together', async () => {
  const db = freshDb(); await ready(db);
  const g = gate(db);
  const r = await call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: g, decision: 'passed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(rows(db, 'SELECT status, final_decision FROM decision_gates')[0].status, 'passed');
  assert.deepEqual(rows(db, "SELECT stage_name FROM project_stages WHERE status = 'active'"), [{ stage_name: 'spinout_ready' }]);
  assert.equal(rows(db, 'SELECT status FROM projects')[0].status, 'spinout');
});

test('a failed stage write leaves the gate pending and the project where it was', async () => {
  const db = freshDb(); await ready(db);
  const g = gate(db);
  const r = await quiet(() => call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: g, decision: 'passed' }, { id: ADMIN, role: 'admin' }, { failOn: /INSERT INTO project_stages/ }));
  assert.equal(r.status, 500);
  assert.equal(rows(db, 'SELECT status FROM decision_gates')[0].status, 'pending', 'not decided without its stage');
  assert.deepEqual(rows(db, "SELECT stage_name FROM project_stages WHERE status = 'active'"), [{ stage_name: 'decision_gate' }]);
  assert.equal(rows(db, 'SELECT status FROM projects')[0].status, 'active');
});

test('an older pending gate cannot be decided over a newer review', async () => {
  const db = freshDb(); await ready(db);
  const older = gate(db);
  const newer = gate(db);
  const stale = await call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: older, decision: 'passed' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'gate_superseded');
  assert.equal(stale.body.latest_gate_id, newer);
  assert.equal(rows(db, 'SELECT status FROM projects')[0].status, 'active', 'the stale decision moved nothing');
  assert.deepEqual(rows(db, 'SELECT status FROM decision_gates ORDER BY id').map((g) => g.status), ['pending', 'pending']);
  assert.equal((await call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: newer, decision: 'failed' })).status, 200);
});

test('two decisions on one gate: one wins; a decided gate is 409', async () => {
  const db = freshDb(); await ready(db);
  const g = gate(db);
  const [a, b] = await Promise.all([
    call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: g, decision: 'passed' }),
    call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: g, decision: 'failed' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const status = rows(db, 'SELECT status FROM projects')[0].status;
  const decided = rows(db, 'SELECT final_decision FROM decision_gates')[0].final_decision;
  assert.equal(status, decided === 'passed' ? 'spinout' : 'rejected', 'the project follows the one decision that won');
});

test('iterate keeps history and returns the venture to mvp_dev; failed closes it out', async () => {
  const db = freshDb(); await ready(db);
  await call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: gate(db), decision: 'iterate' });
  assert.deepEqual(rows(db, 'SELECT stage_name, status FROM project_stages ORDER BY id').map((s) => `${s.stage_name}:${s.status}`), ['decision_gate:completed', 'iterate:completed', 'mvp_dev:active']);
  await call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: gate(db), decision: 'failed' });
  assert.equal(rows(db, 'SELECT status FROM projects')[0].status, 'rejected');
  assert.equal(rows(db, "SELECT id FROM project_stages WHERE status = 'active'").length, 0);
});

test('rejected and spun-out ventures leave the active board; their history stays readable', async () => {
  const db = freshDb(); await ready(db);
  db.prepare("INSERT INTO projects (id, name, stage, status) VALUES (43, 'Gone', 'idea', 'rejected'), (44, 'Out', 'spun_out', 'spinout')").run();
  const board = await call(db, 'GET', '/api/pipeline/active');
  assert.equal(board.status, 200, JSON.stringify(board.body));
  assert.deepEqual(board.body.items.map((p: any) => p.id), [42]);
  assert.equal(board.body.total, 1, 'the total counts the same population the page does');
  const all = await call(db, 'GET', '/api/pipeline/active?include_closed=1');
  assert.deepEqual(all.body.items.map((p: any) => p.id).sort(), [42, 43, 44]);
});

// ──────────────────────────────────────────────────────────────── spin-out

const asOperator = { id: OPERATOR, role: 'partner' };
async function sub(db: InstanceType<typeof DatabaseSync>, status: string, extra: Record<string, unknown> = {}) {
  await call(db, 'GET', '/api/legalcap/spinout/status/42');
  const cols = { deal_id: 42, subsidiary_name: 'Orbit Notes, Inc.', spinout_status: status, ...extra };
  db.prepare(`INSERT INTO subsidiaries (${Object.keys(cols).join(',')}) VALUES (${Object.keys(cols).map(() => '?').join(',')})`).run(...(Object.values(cols) as any[]));
}

test('starting a spin-out without a passed gate is 412; only an admin with a written reason may override, and it is recorded', async () => {
  const db = freshDb();
  assert.equal((await call(db, 'POST', '/api/legalcap/spinout/execute', { deal_id: 42, force: true }, asOperator)).status, 412, 'force is gone');
  assert.equal((await call(db, 'POST', '/api/legalcap/spinout/execute', { deal_id: 42, override: { kind: 'no_passed_gate', reason: 'short' } })).status, 412);
  assert.equal((await call(db, 'POST', '/api/legalcap/spinout/execute', { deal_id: 42, override: { kind: 'no_passed_gate', reason: 'Studio approved off-cycle on 2026-11-05' } }, asOperator)).status, 412, 'an operator cannot override');
  const ok = await call(db, 'POST', '/api/legalcap/spinout/execute', { deal_id: 42, override: { kind: 'no_passed_gate', reason: 'Studio approved off-cycle on 2026-11-05' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const ev = rows(db, "SELECT event_type, details, performed_by FROM spinout_events WHERE event_type = 'override_no_passed_gate'");
  assert.equal(ev.length, 1);
  assert.match(ev[0].details, /off-cycle/);
});

test('the IP licence is a draft until a signature is recorded; only then is the transfer complete', async () => {
  const db = freshDb();
  await sub(db, 'pending');
  const draft = await call(db, 'POST', '/api/legalcap/spinout/ip-transfer', { deal_id: 42 });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.awaiting, 'signature');
  assert.equal(rows(db, "SELECT status FROM legal_documents WHERE type = 'IP_license'")[0].status, 'generated');
  let s = rows(db, 'SELECT spinout_status, ip_transfer_complete, ip_license_doc_id FROM subsidiaries')[0];
  assert.deepEqual([s.spinout_status, s.ip_transfer_complete, s.ip_license_doc_id], ['pending', 0, null]);
  // Again: the same draft, not a second one.
  await call(db, 'POST', '/api/legalcap/spinout/ip-transfer', { deal_id: 42 });
  assert.equal(rows(db, "SELECT id FROM legal_documents WHERE type = 'IP_license'").length, 1);
  assert.equal((await call(db, 'POST', '/api/legalcap/spinout/ip-transfer', { deal_id: 42, signed: { signed_by_name: 'Fay Founder', signed_on: '2999-01-01' } })).status, 400, 'a future date is not evidence');
  assert.equal((await call(db, 'POST', '/api/legalcap/spinout/ip-transfer', { deal_id: 42, signed: { signed_by_name: '', signed_on: '2026-11-05' } })).status, 400);
  const signed = await call(db, 'POST', '/api/legalcap/spinout/ip-transfer', { deal_id: 42, signed: { signed_by_name: 'Fay Founder', signed_on: '2026-11-05' } });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  s = rows(db, 'SELECT spinout_status, ip_transfer_complete, ip_license_doc_id FROM subsidiaries')[0];
  assert.deepEqual([s.spinout_status, s.ip_transfer_complete], ['ip_transferred', 1]);
  const doc = rows(db, "SELECT status, content FROM legal_documents WHERE type = 'IP_license'")[0];
  assert.equal(doc.status, 'signed');
  assert.equal(JSON.parse(doc.content).signature.signed_by_name, 'Fay Founder');
});

test('incorporation is recorded only with its evidence; no EIN is ever made up', async () => {
  const db = freshDb();
  await sub(db, 'equity_allocated');
  const ask = await call(db, 'POST', '/api/legalcap/spinout/stripe-atlas', { deal_id: 42 });
  assert.equal(ask.status, 200);
  assert.equal(ask.body.awaiting, 'incorporation_evidence');
  let s = rows(db, 'SELECT spinout_status, stripe_atlas_status, ein FROM subsidiaries')[0];
  assert.deepEqual([s.spinout_status, s.stripe_atlas_status, s.ein], ['equity_allocated', 'pending', null], 'a request is not an incorporation');
  for (const bad of [{ atlas_id: '', ein: '12-3456789', incorporation_date: '2026-10-01' }, { atlas_id: 'acct_1', ein: '123456789', incorporation_date: '2026-10-01' }, { atlas_id: 'acct_1', ein: '12-3456789', incorporation_date: '2999-01-01' }]) {
    assert.equal((await call(db, 'POST', '/api/legalcap/spinout/stripe-atlas', { deal_id: 42, confirmation: bad })).status, 400, JSON.stringify(bad));
  }
  const ok = await call(db, 'POST', '/api/legalcap/spinout/stripe-atlas', { deal_id: 42, confirmation: { atlas_id: 'acct_1Orbit', ein: '12-3456789', incorporation_date: '2026-10-01' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  s = rows(db, 'SELECT spinout_status, stripe_atlas_id, ein, incorporation_date FROM subsidiaries')[0];
  assert.deepEqual([s.spinout_status, s.stripe_atlas_id, s.ein, s.incorporation_date], ['incorporated', 'acct_1Orbit', '12-3456789', '2026-10-01']);
});

test('going independent needs the recorded evidence, has no force, and moves the venture off the board in one batch', async () => {
  const db = freshDb(); await ready(db);
  await sub(db, 'equity_allocated');
  assert.equal((await call(db, 'POST', '/api/legalcap/spinout/go-independent', { deal_id: 42, force: true })).status, 412, 'force is gone');
  db.prepare("UPDATE subsidiaries SET spinout_status = 'incorporated'").run();
  assert.equal((await call(db, 'POST', '/api/legalcap/spinout/go-independent', { deal_id: 42 })).status, 412, 'incorporated without evidence is not incorporated');
  db.prepare("UPDATE subsidiaries SET stripe_atlas_id = 'acct_1', ein = '12-3456789', incorporation_date = '2026-10-01'").run();
  const failed = await quiet(() => call(db, 'POST', '/api/legalcap/spinout/go-independent', { deal_id: 42 }, { id: ADMIN, role: 'admin' }, { failOn: /UPDATE projects SET stage = 'spun_out'/ }));
  assert.equal(failed.status, 500);
  assert.equal(rows(db, 'SELECT spinout_status FROM subsidiaries')[0].spinout_status, 'incorporated', 'a failed project write undoes the subsidiary write');
  const ok = await quiet(() => call(db, 'POST', '/api/legalcap/spinout/go-independent', { deal_id: 42 }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(rows(db, 'SELECT spinout_status FROM subsidiaries')[0].spinout_status, 'independent');
  assert.equal(rows(db, 'SELECT stage FROM projects')[0].stage, 'spun_out');
  assert.equal(rows(db, "SELECT id FROM project_stages WHERE status = 'active'").length, 0);
  assert.deepEqual((await call(db, 'GET', '/api/pipeline/active')).body.items, [], 'off the active board');
});

test('a need that already has an accepted quote takes no second one, even if a rival is still submitted', async () => {
  const db = freshDb();
  db.prepare("UPDATE quotes SET status = 'accepted', decided_at = '2026-11-01T00:00:00.000Z' WHERE id = 12").run();
  const r = await call(db, 'POST', '/api/quotes/11/accept');
  assert.equal(r.status, 409);
  assert.deepEqual(rows(db, 'SELECT status FROM quotes ORDER BY id').map((q) => q.status), ['submitted', 'accepted']);
  assert.equal(rows(db, 'SELECT id FROM engagements').length, 0);
});

test('a new review supersedes every older pending gate and moves the venture to decision_gate with the new gate', async () => {
  const db = freshDb(); await ready(db);
  db.prepare("UPDATE project_stages SET status = 'completed'").run();
  db.prepare("INSERT INTO project_stages (deal_id, stage_name, status) VALUES (42, 'mvp_dev', 'active')").run();
  const old = gate(db);
  const env = { DB: makeD1(db) } as any;
  const created = await openGateReview(env, 42, 'spinout_ready', 'Rule-based.', null);
  const gates = rows(db, 'SELECT id, status FROM decision_gates ORDER BY id');
  assert.deepEqual(gates.map((g) => g.status), ['superseded', 'pending']);
  assert.equal(gates[0].id, old);
  assert.equal(created.id, gates[1].id);
  assert.deepEqual(rows(db, "SELECT stage_name FROM project_stages WHERE status = 'active'"), [{ stage_name: 'decision_gate' }]);
  assert.equal(JSON.parse(rows(db, "SELECT metadata FROM project_stages WHERE stage_name = 'decision_gate' AND status = 'active'")[0].metadata).gate_id, gates[1].id);
  const stale = await call(db, 'PATCH', '/api/pipeline/decision-gate/decide', { gate_id: old, decision: 'passed' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'gate_superseded');
});

test('a failed review write leaves the older gate pending and the stage where it was', async () => {
  const db = freshDb(); await ready(db);
  db.prepare("UPDATE project_stages SET status = 'completed'").run();
  db.prepare("INSERT INTO project_stages (deal_id, stage_name, status) VALUES (42, 'mvp_dev', 'active')").run();
  gate(db);
  const env = { DB: makeD1(db, { failOn: /INSERT INTO project_stages/ }) } as any;
  await assert.rejects(() => openGateReview(env, 42, 'continue', 'x', null));
  assert.deepEqual(rows(db, 'SELECT status FROM decision_gates').map((g) => g.status), ['pending']);
  assert.deepEqual(rows(db, "SELECT stage_name FROM project_stages WHERE status = 'active'"), [{ stage_name: 'mvp_dev' }]);
});
