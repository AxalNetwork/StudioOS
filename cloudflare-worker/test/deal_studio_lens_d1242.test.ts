/**
 * D1242 (#3255) — the Studio lens's read, an Operating Partner moving only the
 * rounds they lead, and a round intake scoring set to Not raising never read
 * as a person's pass.
 *
 * The REAL `deals` router against real SQLite, with D469's harness. The rows:
 *   - ALPHA (applied), led by PARTNER: 2 invitations (one interested), 1
 *     confirmed commitment and 1 pending, so 2 invited · 1 interested · 1 committed;
 *   - BETA (scored), led by OTHER: no invitation;
 *   - PASSED (rejected) by ADMIN through the pass route's columns;
 *   - INTAKE (rejected), with no person and its project's intake line;
 *   - LEGACY (rejected), with no person and no trace at all.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_studio_lens_d1242.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import deals from '../src/routes/deals.ts';
import { canMoveRound, notRaisingBy } from '../src/services/dealStudioLens.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/deals', deals);

const PARTNER = 20, OTHER = 23, ADMIN = 21, INVESTOR = 42, FOUNDER = 50;
const ALPHA = 71, BETA = 72, PASSED = 73, INTAKE = 74, LEGACY = 75;

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

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      investor_tier TEXT, partner_id INTEGER, founder_id INTEGER
    );
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, partner_id INTEGER,
      lead_partner_id INTEGER, status TEXT NOT NULL DEFAULT 'applied', notes TEXT,
      description TEXT, website TEXT, amount REAL, target_raise REAL, currency TEXT,
      minimum_check REAL, valuation_cap REAL, carry_pct REAL,
      management_fee_pct REAL, instrument TEXT, spv_jurisdiction TEXT,
      closing_deadline TEXT, capital_committed REAL DEFAULT 0, source TEXT,
      pass_reason TEXT, pass_note TEXT, passed_at TEXT, passed_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      stage_changed_at TEXT
    );
    CREATE TABLE commitments (id INTEGER PRIMARY KEY, deal_id INTEGER, investor_user_id INTEGER, amount REAL, status TEXT);
    CREATE TABLE deal_invitations (id INTEGER PRIMARY KEY, deal_id INTEGER, investor_user_id INTEGER, status TEXT);
    CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE deal_stage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, from_stage TEXT,
      to_stage TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'set', days_in_from INTEGER,
      actor_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER, action TEXT,
      details TEXT, actor TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(PARTNER, 'partner', 'Pat Partner'); u.run(OTHER, 'partner', 'Olu Other'); u.run(ADMIN, 'admin', 'Ada Admin');
  u.run(INVESTOR, 'investor', 'Ingrid Investor'); u.run(FOUNDER, 'founder', 'Fay Founder');
  const p = db.prepare('INSERT INTO projects (id, name, sector) VALUES (?, ?, ?)');
  p.run(1, 'Alpha', 'Robotics'); p.run(2, 'Beta', 'Health'); p.run(3, 'Gamma', 'Climate'); p.run(4, 'Delta', 'Fintech'); p.run(5, 'Epsilon', 'AI');
  const d = db.prepare(`INSERT INTO deals (id, uid, project_id, status, amount, currency, source, lead_partner_id, created_at, passed_by_user_id, pass_reason)
                        VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?)`);
  d.run(ALPHA, 'd-a', 1, 'applied', 500000, 'Founder applied', PARTNER, '2026-10-05 00:00:00', null, null);
  d.run(BETA, 'd-b', 2, 'scored', null, null, OTHER, '2026-10-04 00:00:00', null, null);
  d.run(PASSED, 'd-p', 3, 'rejected', 250000, 'Studio sourced', null, '2026-10-03 00:00:00', ADMIN, 'valuation');
  d.run(INTAKE, 'd-i', 4, 'rejected', null, null, null, '2026-10-02 00:00:00', null, null);
  d.run(LEGACY, 'd-l', 5, 'rejected', null, null, null, '2026-10-01 00:00:00', null, null);
  db.exec(`
    INSERT INTO deal_invitations (deal_id, investor_user_id, status) VALUES (${ALPHA}, 42, 'interested'), (${ALPHA}, 43, 'invited');
    INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES (${ALPHA}, 42, 10000, 'confirmed'), (${ALPHA}, 43, 5000, 'pending');
    INSERT INTO activity_logs (project_id, action, details, actor)
      VALUES (4, 'auto_scored', 'Score: 41, Tier: TIER_3, Status: rejected, Review: auto_approved', 'system'),
             (1, 'auto_scored', 'Score: 72, Tier: TIER_2, Status: tier_2, Review: auto_approved', 'system');
  `);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });
async function call(who: { user: number; role: string }, path: string, init: { method?: string; body?: any } = {}, db = freshDb()) {
  const res = await app.request(`/api/deals${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${await token(who.user, who.role)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  return { status: res.status, body: await res.json().catch(() => null), db };
}
const partner = { user: PARTNER, role: 'partner' };
const admin = { user: ADMIN, role: 'admin' };
const row = (db: InstanceType<typeof DatabaseSync>, id: number) => ({ ...(db.prepare('SELECT status, lead_partner_id, target_raise FROM deals WHERE id = ?').get(id) as any) });
const events = (db: InstanceType<typeof DatabaseSync>, id: number) => (db.prepare('SELECT kind, actor_user_id FROM deal_stage_events WHERE deal_id = ?').all(id) as any[]).length;

test('the rules: an admin moves any round, an Operating Partner only the rounds they lead, anyone else none', () => {
  // Mutations checked: a partner with no lead allowed; an investor allowed; ids compared as strings only.
  assert.equal(canMoveRound({ id: 1, role: 'admin' }, null), true);
  assert.equal(canMoveRound({ id: 20, role: 'partner' }, 20), true);
  assert.equal(canMoveRound({ id: 20, role: 'partner' }, '20'), true);
  assert.equal(canMoveRound({ id: 20, role: 'partner' }, 23), false);
  assert.equal(canMoveRound({ id: 20, role: 'partner' }, null), false);
  assert.equal(canMoveRound({ id: 42, role: 'investor' }, 42), false);
  assert.equal(notRaisingBy({ status: 'active' }), null);
  assert.equal(notRaisingBy({ status: 'rejected', passed_by_user_id: 21 }), 'person');
  assert.equal(notRaisingBy({ status: 'rejected', person_event: 1, intake_logged: 1 }), 'person', 'a named person wins over the intake line');
  assert.equal(notRaisingBy({ status: 'rejected', intake_logged: 1 }), 'intake');
  assert.equal(notRaisingBy({ status: 'rejected' }), 'not_recorded');
});

test('GET /studio: every round with its lead, investors, source and who set Not raising; the intake count', async () => {
  // Mutations checked: interested counted as invited; a pending commitment counted; the intake line ignored;
  // an intake row read as a person; can_move true on a round another partner leads.
  const r = await call(admin, '/studio');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x: any) => x.id), [ALPHA, BETA, PASSED, INTAKE, LEGACY], 'newest first');
  const a = r.body.rows[0];
  assert.deepEqual([a.project_name, a.lead_partner_name, a.source, a.investors], ['Alpha', 'Pat Partner', 'Founder applied', { invited: 2, interested: 1, committed: 1 }]);
  assert.deepEqual(r.body.rows[1].investors, { invited: 0, interested: 0, committed: 0 });
  assert.deepEqual(r.body.rows.map((x: any) => x.not_raising_by), [null, null, 'person', 'intake', 'not_recorded']);
  assert.equal(r.body.rows[2].passed_by_name, 'Ada Admin');
  assert.equal(r.body.rows[3].passed_by_name, null);
  assert.equal(r.body.intake_not_raising, 1);
  assert.ok(r.body.rows.every((x: any) => x.can_move), 'an admin moves every round');
  assert.equal(JSON.stringify(r.body).includes('pass_note'), false, 'no internal note on the list');

  const p = await call(partner, '/studio');
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.rows.map((x: any) => [x.id, x.you_lead, x.can_move]),
    [[ALPHA, true, true], [BETA, false, false], [PASSED, false, false], [INTAKE, false, false], [LEGACY, false, false]]);
});

test('GET /studio is studio staff only', async () => {
  // Mutation checked: the route open to every signed-in user.
  assert.equal((await call({ user: INVESTOR, role: 'investor' }, '/studio')).status, 403);
  assert.equal((await call({ user: FOUNDER, role: 'founder' }, '/studio')).status, 403);
});

test('an Operating Partner cannot move a round they do not lead: advance, pass and edit are refused before anything is written', async () => {
  // Mutations checked: the guard after the stage event; the guard missing on any one route.
  const db = freshDb();
  for (const [method, path, body] of [['POST', `/${BETA}/advance`, undefined], ['POST', `/${BETA}/pass`, { reason: 'team' }], ['PUT', `/${BETA}`, { target_raise: 9 }]] as const) {
    const r = await call(partner, path, { method, body }, db);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'not_your_round');
    assert.match(r.body.detail, /only the rounds you lead/);
  }
  assert.deepEqual(row(db, BETA), { status: 'scored', lead_partner_id: OTHER, target_raise: null }, 'nothing written');
  assert.equal(events(db, BETA), 0, 'no stage event either');
});

test('an Operating Partner moves a round they lead; an admin moves any', async () => {
  // Mutation checked: the guard refusing the lead too.
  const db = freshDb();
  const adv = await call(partner, `/${ALPHA}/advance`, { method: 'POST' }, db);
  assert.equal(adv.status, 200);
  assert.equal(row(db, ALPHA).status, 'scored');
  const pass = await call(partner, `/${ALPHA}/pass`, { method: 'POST', body: { reason: 'team' } }, db);
  assert.equal(pass.status, 200);
  assert.equal(row(db, ALPHA).status, 'rejected');
  assert.equal((await call(admin, `/${BETA}/advance`, { method: 'POST' }, db)).status, 200);
  assert.equal(row(db, BETA).status, 'active');
});

test('only an admin changes who leads a round', async () => {
  // Mutations checked: a partner handing their round on; the refusal after the write.
  const db = freshDb();
  const r = await call(partner, `/${ALPHA}`, { method: 'PUT', body: { lead_partner_id: OTHER, target_raise: 7 } }, db);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'lead_admin_only');
  assert.deepEqual(row(db, ALPHA), { status: 'applied', lead_partner_id: PARTNER, target_raise: null });
  assert.equal((await call(admin, `/${ALPHA}`, { method: 'PUT', body: { lead_partner_id: OTHER } }, db)).status, 200);
  assert.equal(row(db, ALPHA).lead_partner_id, OTHER);
});

test('pass analytics: an intake row never reads as a pass, and is counted apart', async () => {
  // Mutations checked: the intake row counted in the unrecorded bucket; the intake count missing.
  const r = await call(admin, '/pass-analytics');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2, 'the admin pass and the untraced legacy row; not the intake one');
  assert.equal(r.body.unrecorded, 1);
  assert.equal(r.body.intake_not_raising, 1);
  const unrec = await call(admin, '/pass-analytics?reason=unrecorded');
  assert.deepEqual(unrec.body.deals.map((x: any) => x.id), [LEGACY]);
});

test('the intake writer records its arrival as a stage event with no person; the studio route sits above the id route', () => {
  const projects = readFileSync('cloudflare-worker/src/routes/projects.ts', 'utf8');
  const submit = projects.slice(projects.indexOf("projects.post('/submit'"));
  const at = submit.indexOf('INSERT INTO deals (project_id, status) VALUES (${project.id}, ${dealStatus}) RETURNING id');
  assert.ok(at > 0);
  assert.match(submit.slice(at, at + 600), /recordStageEvent\(sql, \{[\s\S]*?kind: 'set', actorUserId: null/);
  const src = readFileSync('cloudflare-worker/src/routes/deals.ts', 'utf8');
  assert.ok(src.indexOf("deals.get('/studio'") > 0 && src.indexOf("deals.get('/studio'") < src.indexOf("deals.get('/:id'"));
});
