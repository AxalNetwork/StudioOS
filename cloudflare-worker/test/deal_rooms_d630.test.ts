/**
 * D630 (#1388) — the Worker side of the deal-room screens, on real SQLite
 * (the baseline's tables; migrations 335 and 340 executed as written).
 *
 *   1. `GET /deals/dealroom/quota` reads used against cap without joining:
 *      "N of M", "Unlimited" for a plan without a cap, the plan that raises a
 *      full one and its cap, and the rooms this caller is in. Its count is the
 *      join's, so a quota that reads full is a join that is refused.
 *   2. Every deal-room write records its actor in `activity_logs`: join,
 *      leave (only when it removed a membership), recording a transfer,
 *      inviting an investor, and each reference write.
 *   3. `GET /networkfx/syndicates?project_id=` lists one company's
 *      syndicates; closing one refuses with a sentence for a stranger and for
 *      a syndicate already closed, and records its actor.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_rooms_d630.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';
import references from '../src/routes/references.ts';
import networkfx from '../src/routes/networkfx.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', f), 'utf8');

const ADMIN = 1, PRO = 10, FULL = 11, INST = 12, PARTNER = 20, STRANGER = 13, CREATOR = 14;
const ROLE: Record<number, string> = { 1: 'admin', 10: 'investor', 11: 'investor', 12: 'investor', 13: 'investor', 14: 'investor', 20: 'partner' };
const DEALS = [41, 42, 43, 44, 45, 46];
const PROJECT = 7, OTHER_PROJECT = 8;

function runMigration(db: InstanceType<typeof DatabaseSync>, file: string) {
  for (const stmt of MIG(file).replace(/--[^\n]*/g, '').split(';')) {
    const s = stmt.trim();
    if (s) db.exec(s);
  }
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'deals', 'deal_invitations', 'commitments', 'reference_checks', 'activity_logs',
    'investor_dealroom_members', 'user_company_links', 'company_profiles', 'ic_decisions', 'ic_votes', 'shared_services_log']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec('CREATE UNIQUE INDEX idx_deal_invites_pair ON deal_invitations(deal_id, investor_user_id)');
  db.exec(`CREATE TABLE ic_conditions (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, ic_decision_id INTEGER NOT NULL,
    body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_by INTEGER NOT NULL, created_at TEXT,
    resolved_at TEXT, resolved_by INTEGER)`);
  runMigration(db, '335_deal_transfers_and_closing_checklists.sql');
  runMigration(db, '340_deal_transfer_company.sql');
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, investor_tier, investor_subscription_status, investor_dealroom_max)
                        VALUES (?, ?, ?, ?, 1, ?, ?, ?)`);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 'free', 'free', 5);
  u.run(PRO, 'investor', 'Pia Pro', 'pia@example.test', 'professional', 'active', 5);
  u.run(FULL, 'investor', 'Fen Full', 'fen@example.test', 'professional', 'active', 5);
  u.run(INST, 'investor', 'Ian Inst', 'ian@example.test', 'institutional', 'active', 1_000_000);
  u.run(STRANGER, 'investor', 'Sam Stranger', 'sam@example.test', 'professional', 'active', 5);
  u.run(CREATOR, 'investor', 'Cy Creator', 'cy@example.test', 'professional', 'active', 5);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', 'free', 'free', 5);
  db.prepare(`INSERT INTO projects (id, name) VALUES (?, 'Alpha'), (?, 'Beta')`).run(PROJECT, OTHER_PROJECT);
  const d = db.prepare(`INSERT INTO deals (id, project_id, status) VALUES (?, ?, 'active')`);
  for (const id of DEALS) d.run(id, PROJECT);
  const m = db.prepare(`INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)`);
  m.run(PRO, 41); m.run(PRO, 42);
  for (const id of DEALS.slice(0, 5)) m.run(FULL, id);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/deals', deals as any);
  a.route('/api/references', references as any);
  a.route('/api/networkfx', networkfx as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: String(err?.message || 'Internal server error') }, 500);
  });
  return a;
})();

async function call(db: InstanceType<typeof DatabaseSync>, user: number, path: string, init: { method?: string; body?: any } = {}) {
  const tok = await new SignJWT({ user_id: user, role: ROLE[user] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, {
      method: init.method || 'GET',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  } finally { [console.warn, console.error] = saved; }
}

const logs = (db: InstanceType<typeof DatabaseSync>, action: string) =>
  db.prepare(`SELECT user_id, entity_type, entity_id, details FROM activity_logs WHERE action = ? ORDER BY id`).all(action) as any[];

// ── 1. the quota ───────────────────────────────────────────────────────────

test('D630: the quota reads used against cap, without joining anything', async () => {
  const db = freshDb();
  const r = await call(db, PRO, '/api/deals/dealroom/quota');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.used, 2);
  assert.equal(r.body.cap, 5);
  assert.equal(r.body.unlimited, false);
  assert.equal(r.body.full, false);
  assert.equal(r.body.tier, 'professional');
  assert.equal(r.body.upgrade_to, 'institutional');
  assert.equal(r.body.upgrade_cap, null, 'Institutional is unlimited, so it names no cap');
  assert.deepEqual([...r.body.member_deal_ids].sort(), [41, 42]);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM investor_dealroom_members').get() as any;
  assert.equal(rows.n, 7, 'reading the quota wrote nothing');
});

test('D630: a full quota reads full, and the join it predicts is refused with the same numbers', async () => {
  const db = freshDb();
  const q = await call(db, FULL, '/api/deals/dealroom/quota');
  assert.equal(q.body.used, 5);
  assert.equal(q.body.cap, 5);
  assert.equal(q.body.full, true);
  const j = await call(db, FULL, '/api/deals/46/dealroom/join', { method: 'POST' });
  assert.equal(j.status, 402);
  assert.equal(j.body.code, 'quota_dealrooms_exhausted');
  assert.equal(j.body.used, q.body.used);
  assert.equal(j.body.cap, q.body.cap);
  assert.equal(j.body.upgrade_to, q.body.upgrade_to);
  assert.equal(logs(db, 'dealroom_joined').length, 0, 'a refused join records no join');
});

test('D630: a Free plan names Professional and its cap; Institutional and a partner read Unlimited', async () => {
  const db = freshDb();
  db.prepare(`UPDATE users SET investor_tier = 'free', investor_subscription_status = 'free', investor_dealroom_max = 1 WHERE id = ?`).run(STRANGER);
  const free = await call(db, STRANGER, '/api/deals/dealroom/quota');
  assert.equal(free.body.cap, 1);
  assert.equal(free.body.upgrade_to, 'professional');
  assert.equal(free.body.upgrade_cap, 5, 'the next plan’s cap comes from INVESTOR_QUOTAS');
  for (const who of [INST, PARTNER]) {
    const r = await call(db, who, '/api/deals/dealroom/quota');
    assert.equal(r.status, 200);
    assert.equal(r.body.unlimited, true, `user ${who}`);
    assert.equal(r.body.cap, null);
    assert.equal(r.body.full, false);
    assert.equal(r.body.upgrade_to, null);
  }
});

test('D630: a cap granted on the account wins over the plan default, for the quota and the join alike', async () => {
  const db = freshDb();
  db.prepare('UPDATE users SET investor_dealroom_max = 6 WHERE id = ?').run(FULL);
  const q = await call(db, FULL, '/api/deals/dealroom/quota');
  assert.equal(q.body.cap, 6);
  assert.equal(q.body.full, false);
  const j = await call(db, FULL, '/api/deals/46/dealroom/join', { method: 'POST' });
  assert.equal(j.status, 200);
  assert.equal(j.body.cap, 6);
});

test('D630: the quota is refused to a role that cannot join', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (30, 'founder', 'Flo Founder', 'flo@example.test', 1)`).run();
  ROLE[30] = 'founder';
  const r = await call(db, 30, '/api/deals/dealroom/quota');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'investor_only');
});

// ── 2. every write records its actor ───────────────────────────────────────

test('D630: join and leave are recorded with their actor; a leave that changed nothing is not', async () => {
  const db = freshDb();
  const j = await call(db, PRO, '/api/deals/43/dealroom/join', { method: 'POST' });
  assert.equal(j.status, 200);
  assert.deepEqual(logs(db, 'dealroom_joined').map((l) => [l.user_id, l.entity_type, l.entity_id]), [[PRO, 'deal', '43']]);
  const again = await call(db, PRO, '/api/deals/43/dealroom/join', { method: 'POST' });
  assert.equal(again.body.already_member, true);
  assert.equal(logs(db, 'dealroom_joined').length, 1, 'an idempotent re-join records nothing new');

  await call(db, PRO, '/api/deals/43/dealroom/leave', { method: 'DELETE' });
  assert.deepEqual(logs(db, 'dealroom_left').map((l) => [l.user_id, l.entity_id]), [[PRO, '43']]);
  await call(db, PRO, '/api/deals/44/dealroom/leave', { method: 'DELETE' });
  assert.equal(logs(db, 'dealroom_left').length, 1, 'leaving a room you were not in records nothing');
  const q = await call(db, PRO, '/api/deals/dealroom/quota');
  assert.equal(q.body.used, 2);
});

test('D630: a recorded transfer and an invitation are recorded with their actor', async () => {
  const db = freshDb();
  const t = await call(db, PARTNER, '/api/deals/41/transfers', { method: 'POST', body: { amount_cents: 2500000, reference: 'WIRE-1' } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const [tl] = logs(db, 'deal_transfer_recorded');
  assert.equal(tl.user_id, PARTNER);
  assert.equal(tl.entity_id, '41');
  assert.equal(JSON.parse(tl.details).amount_cents, 2500000);

  const refused = await call(db, PARTNER, '/api/deals/41/transfers', { method: 'POST', body: { amount_cents: 0 } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'transfer_amount_invalid');
  assert.equal(logs(db, 'deal_transfer_recorded').length, 1, 'a refused transfer records nothing');

  const i = await call(db, ADMIN, '/api/deals/41/invitations', { method: 'POST', body: { investor_user_ids: [STRANGER], message: 'Take a look' } });
  assert.equal(i.status, 200, JSON.stringify(i.body));
  assert.deepEqual(logs(db, 'deal_investor_invited').map((l) => [l.user_id, l.entity_id, JSON.parse(l.details).investor_user_id]), [[ADMIN, '41', STRANGER]]);
});

test('D630: each reference write is recorded with its actor and its deal', async () => {
  const db = freshDb();
  const c = await call(db, ADMIN, '/api/references', { method: 'POST', body: { deal_id: 41, reference_name: 'Rita Reference' } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = c.body.id;
  await call(db, ADMIN, `/api/references/${id}`, { method: 'PATCH', body: { notes: 'Called back' } });
  await call(db, ADMIN, `/api/references/${id}/consent`, { method: 'POST', body: { consent_given: true } });
  await call(db, ADMIN, `/api/references/${id}`, { method: 'DELETE' });
  for (const action of ['reference_scheduled', 'reference_updated', 'reference_consent_given', 'reference_deleted']) {
    const rows = logs(db, action);
    assert.equal(rows.length, 1, action);
    assert.equal(rows[0].user_id, ADMIN, action);
    assert.equal(rows[0].entity_id, '41', action);
    assert.equal(JSON.parse(rows[0].details).reference_id, id, action);
  }
  assert.deepEqual(JSON.parse(logs(db, 'reference_updated')[0].details).fields, ['notes']);
});

// ── 3. syndicates ──────────────────────────────────────────────────────────

async function seedSyndicates(db: InstanceType<typeof DatabaseSync>) {
  // The route bootstraps its own tables on first touch.
  await call(db, ADMIN, '/api/networkfx/syndicates');
  db.prepare(`INSERT INTO syndicates (id, name, created_by, deal_id, target_cents, status) VALUES
    (1, 'Alpha syndicate', ?, ?, 5000000, 'funded'),
    (2, 'Alpha second', ?, ?, NULL, 'open'),
    (3, 'Beta syndicate', ?, ?, NULL, 'open'),
    (4, 'Alpha closed', ?, ?, NULL, 'closed')`).run(CREATOR, PROJECT, CREATOR, PROJECT, CREATOR, OTHER_PROJECT, CREATOR, PROJECT);
}

test('D630: ?project_id= lists one company’s syndicates, and refuses a malformed id', async () => {
  const db = freshDb();
  await seedSyndicates(db);
  const r = await call(db, PRO, `/api/networkfx/syndicates?project_id=${PROJECT}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((s: any) => s.id).sort(), [1, 2, 4]);
  const all = await call(db, PRO, '/api/networkfx/syndicates');
  assert.equal(all.body.length, 4, 'without the filter the list is unchanged');
  const bad = await call(db, PRO, '/api/networkfx/syndicates?project_id=abc');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_project_id');
});

test('D630: closing a syndicate is its creator’s or an admin’s, refuses with sentences, and records its actor', async () => {
  const db = freshDb();
  await seedSyndicates(db);
  const status = (id: number) => (db.prepare('SELECT status FROM syndicates WHERE id = ?').get(id) as any).status;

  const stranger = await call(db, STRANGER, '/api/networkfx/syndicates/1/close', { method: 'POST', body: {} });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.error, 'syndicate_close_forbidden');
  assert.match(stranger.body.detail, /^Only the syndicate’s creator or an admin can close it\. Nothing was closed\.$/);
  assert.equal(status(1), 'funded');

  const missing = await call(db, CREATOR, '/api/networkfx/syndicates/99/close', { method: 'POST', body: {} });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'syndicate_not_found');

  const done = await call(db, CREATOR, '/api/networkfx/syndicates/4/close', { method: 'POST', body: {} });
  assert.equal(done.status, 409);
  assert.equal(done.body.error, 'syndicate_already_closed');
  assert.match(done.body.detail, /already closed\. Nothing changed\./);

  const ok = await call(db, CREATOR, '/api/networkfx/syndicates/1/close', { method: 'POST', body: {} });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'closed');
  assert.equal(status(1), 'closed', 'Funded closes');
  const admin = await call(db, ADMIN, '/api/networkfx/syndicates/2/close', { method: 'POST', body: {} });
  assert.equal(admin.status, 200, 'an admin closes another member’s syndicate');
  assert.equal(status(2), 'closed');

  const rows = logs(db, 'syndicate_closed');
  assert.deepEqual(rows.map((l) => [l.user_id, l.entity_type, l.entity_id]), [[CREATOR, 'syndicate', '1'], [ADMIN, 'syndicate', '2']]);
  assert.equal(JSON.parse(rows[0].details).from_status, 'funded');
});
