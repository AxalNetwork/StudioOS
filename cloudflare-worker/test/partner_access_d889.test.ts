/**
 * D889 (#2438) — an Operating Partner (`partner`) reaches a venture only
 * through an accepted `project_members` row, with that row's role; the roster
 * and deletion stay with the founder-owner and admins; and a submitted update
 * reaches a reader only with the relationship and the founder's grant.
 *
 * Real routes over in-memory SQLite. Every refusal is tested for each role that
 * must be refused; every fixture is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/partner_access_d889.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import projects from '../src/routes/projects.ts';
import updates from '../src/routes/portfolio_updates.ts';
import { canAccessProject, evaluateTeamGate, isProjectManager } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { ensureInvestorPaywallSchema } from '../src/middleware/requireInvestorTier.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const BASELINE = readFileSync(resolve(here, '../sql/schema_baseline.sql'), 'utf8');
const file = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`))!), 'utf8');
const ddl = (prefix: string) => file(prefix).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
// Users: the venture's founder-owner, an admin, three partners (no tie, co-founder member, advisor member),
// an investor who can see the venture, a founder with no tie.
const OWNER = 1, ADMIN = 2, P_NONE = 3, P_COF = 4, P_ADV = 5, INVESTOR = 6, STRANGER = 7;
const V = 70;        // the venture, owned by OWNER (founder_id 100)
const V_OTHER = 71;  // a second venture with no one tied to it but its owner

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(tableFromBaseline(BASELINE, 'users'));
  db.exec(tableFromBaseline(BASELINE, 'founders'));
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, founder_id INTEGER, sector TEXT, stage TEXT,
             status TEXT, company_id INTEGER, playbook_week TEXT, description TEXT, deleted_at TEXT,
             created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
           CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
           CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
           CREATE TABLE deals (id INTEGER PRIMARY KEY, project_id INTEGER);
           CREATE TABLE watchlist_items (id INTEGER PRIMARY KEY, owner_user_id INTEGER, converted_deal_id INTEGER, company_id INTEGER);`);
  db.exec(ddl('119'));
  db.exec(ddl('125'));
  db.exec(file('437'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(OWNER, 'founder', 100, 'Owner', 'owner@example.test');
  u.run(ADMIN, 'admin', null, 'Admin', 'admin@example.test');
  u.run(P_NONE, 'partner', null, 'Partner A', 'pa@example.test');
  u.run(P_COF, 'partner', null, 'Partner B', 'pb@example.test');
  u.run(P_ADV, 'partner', null, 'Partner C', 'pc@example.test');
  u.run(INVESTOR, 'investor', null, 'Investor', 'inv@example.test');
  u.run(STRANGER, 'founder', 200, 'Stranger', 'st@example.test');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, stage, playbook_week) VALUES (?, ?, ?, 100, 'idea', 'week_1')").run(V, 'v70', 'Venture');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, stage, playbook_week) VALUES (?, ?, ?, 100, 'idea', 'week_1')").run(V_OTHER, 'v71', 'Other venture');
  const m = db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, ?, 'accepted')");
  m.run(V, OWNER, 'owner');
  m.run(V, P_COF, 'cofounder');
  m.run(V, P_ADV, 'advisor');
  db.prepare("INSERT INTO founders (id, name, email) VALUES (100, 'Owner', 'owner@example.test')").run();
  db.prepare("INSERT INTO founders (id, name, email) VALUES (200, 'Stranger', 'st@example.test')").run();
  // The investor can see both ventures, through an introduction each.
  await ensureInvestorPaywallSchema({ DB: d1Over(db) } as any);
  db.exec('ALTER TABLE investor_introductions ADD COLUMN company_id INTEGER');
  const intro = db.prepare("INSERT INTO investor_introductions (uid, investor_user_id, project_id, quarter) VALUES (?, ?, ?, '2026Q4')");
  intro.run('i1', INVESTOR, V); intro.run('i2', INVESTOR, V_OTHER);
  return db;
}

const ROLE: Record<number, string> = { [OWNER]: 'founder', [ADMIN]: 'admin', [P_NONE]: 'partner', [P_COF]: 'partner', [P_ADV]: 'partner', [INVESTOR]: 'investor', [STRANGER]: 'founder' };

const app = new Hono<any>();
app.route('/api/projects', projects);
app.route('/api/portfolio-updates', updates);
app.onError((e, c) => c.json({ detail: e.message }, e.message === 'Forbidden' ? 403 : 500));
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: userId, role: ROLE[userId] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, ctx as any);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const user = (id: number, founder_id: number | null = null) => ({ id, role: ROLE[id], founder_id }) as any;
const project = { id: V, founder_id: 100 };

// ── The predicates ──────────────────────────────────────────────────────────

test('canAccessProject: a partner with no tie is refused read and write; a member partner gets exactly their role', async () => {
  const db = await fixture();
  const env = { DB: d1Over(db) } as any;
  assert.equal(await canAccessProject(env, user(P_NONE), project), false, 'no tie: no read');
  assert.equal(await canAccessProject(env, user(P_NONE), project, { write: true }), false, 'no tie: no write');
  assert.equal(await canAccessProject(env, user(P_COF), project, { write: true }), true, 'a co-founder member edits');
  assert.equal(await canAccessProject(env, user(P_ADV), project), true, 'an advisor member reads');
  assert.equal(await canAccessProject(env, user(P_ADV), project, { write: true }), false, 'an advisor member does not edit');
  assert.equal(await canAccessProject(env, user(ADMIN), project, { write: true }), true, 'an admin is unchanged');
  assert.equal(await canAccessProject(env, user(OWNER, 100), project, { write: true }), true, 'the owner is unchanged');
  assert.equal(await canAccessProject(env, user(INVESTOR), project), false, 'an investor is unchanged');
});

test('isProjectManager and the team gate: only the founder-owner and an admin manage the roster', () => {
  assert.equal(isProjectManager(user(OWNER, 100), project), true);
  assert.equal(isProjectManager(user(ADMIN), project), true);
  for (const id of [P_NONE, P_COF, P_ADV, INVESTOR]) assert.equal(isProjectManager(user(id), project), false, ROLE[id] + id);
  assert.equal(isProjectManager({ role: 'founder', founder_id: 200 } as any, project), false, 'another founder');
  assert.equal(evaluateTeamGate({ role: 'admin', spinout_lab_active: 1, spinout_lab_week: 1 }).locked, false, 'an admin bypasses the gate');
  assert.equal(evaluateTeamGate({ role: 'partner', spinout_lab_active: 1, spinout_lab_week: 1 }).locked, true, 'a partner does not');
});

// ── The project routes ──────────────────────────────────────────────────────

test('DELETE /projects/:id: a partner (tied or not), an investor and another founder get 403; the owner and an admin delete', async () => {
  for (const id of [P_NONE, P_COF, P_ADV, INVESTOR, STRANGER]) {
    const db = await fixture();
    const r = await call(db, id, 'DELETE', `/projects/${V}`);
    assert.equal(r.status, 403, `${ROLE[id]} ${id}`);
    assert.equal((db.prepare('SELECT deleted_at FROM projects WHERE id = ?').get(V) as any).deleted_at, null, `${id}: nothing deleted`);
  }
  for (const id of [OWNER, ADMIN]) {
    const db = await fixture();
    const r = await call(db, id, 'DELETE', `/projects/${V}`);
    assert.equal(r.status, 200, `${ROLE[id]}: ${JSON.stringify(r.body)}`);
    assert.notEqual((db.prepare('SELECT deleted_at FROM projects WHERE id = ?').get(V) as any).deleted_at, null);
  }
});

test('PUT /projects/:id: a partner with no tie and an advisor partner get 403; a co-founder partner edits data but not the staff fields', async () => {
  for (const id of [P_NONE, P_ADV]) {
    const db = await fixture();
    const r = await call(db, id, 'PUT', `/projects/${V}`, { description: 'changed' });
    assert.equal(r.status, 403, `${id}: ${JSON.stringify(r.body)}`);
    assert.equal((db.prepare('SELECT description FROM projects WHERE id = ?').get(V) as any).description, null);
  }
  const db = await fixture();
  const r = await call(db, P_COF, 'PUT', `/projects/${V}`, { description: 'changed', stage: 'scale', playbook_week: 'complete' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = db.prepare('SELECT description, stage, playbook_week FROM projects WHERE id = ?').get(V) as any;
  assert.deepEqual([row.description, row.stage, row.playbook_week], ['changed', 'idea', 'week_1'], 'stage and week stay the admin\'s');
});

test('the roster: every partner, tied or not, gets 403 on add, invite, revoke and remove; a partner with no tie cannot view it', async () => {
  for (const id of [P_NONE, P_COF, P_ADV]) {
    const db = await fixture();
    const add = await call(db, id, 'POST', `/projects/${V}/members`, { mode: 'user_id', user_id: STRANGER, role: 'cofounder' });
    const invite = await call(db, id, 'POST', `/projects/${V}/invitations`, { email: 'new@example.test', role: 'advisor' });
    const revoke = await call(db, id, 'POST', `/projects/${V}/invitations/1/revoke`);
    const remove = await call(db, id, 'DELETE', `/projects/${V}/members/${P_ADV}`);
    assert.deepEqual([add.status, invite.status, revoke.status, remove.status], [403, 403, 403, 403], `partner ${id}`);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND status = 'accepted'").get(V) as any).n, 3, `${id}: the roster is unchanged`);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM project_member_invitations').get() as any).n, 0, `${id}: no invitation`);
  }
  const db = await fixture();
  assert.equal((await call(db, P_NONE, 'GET', `/projects/${V}/members`)).status, 403, 'no tie: no roster view');
  const member = await call(db, P_ADV, 'GET', `/projects/${V}/members`);
  assert.deepEqual([member.status, member.body.can_manage], [200, false], 'a member views, does not manage');
  const owner = await call(db, OWNER, 'GET', `/projects/${V}/members`);
  assert.deepEqual([owner.status, owner.body.can_manage], [200, true]);
});

test('GET /projects: a partner lists only the ventures they are a member of; advance-week is no longer theirs', async () => {
  const db = await fixture();
  const ids = (r: any) => (Array.isArray(r.body) ? r.body : []).map((p: any) => p.id).sort();
  assert.deepEqual(ids(await call(db, P_NONE, 'GET', '/projects')), [], 'no tie: nothing');
  assert.deepEqual(ids(await call(db, P_COF, 'GET', '/projects')), [V]);
  assert.deepEqual(ids(await call(db, ADMIN, 'GET', '/projects')), [V, V_OTHER], 'an admin is unchanged');
  for (const id of [P_NONE, P_COF]) {
    assert.equal((await call(db, id, 'POST', `/projects/${V}/advance-week`)).status, 403, `partner ${id}`);
  }
  assert.equal((db.prepare('SELECT playbook_week FROM projects WHERE id = ?').get(V) as any).playbook_week, 'week_1');
});

// ── The update feed ─────────────────────────────────────────────────────────

/** A submitted update on `projectId` with the given audience_json (a raw string, or null). */
function update(db: DatabaseSync, uid: string, projectId: number, audience: string | null) {
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, body, status, submitted_at, created_at, updated_at, audience_json)
              VALUES (?, ?, ?, ?, 'Body text', 'submitted', '2026-10-20', '2026-10-20', '2026-10-20', ?)`).run(uid, projectId, OWNER, `Update ${uid}`, audience);
  return Number((db.prepare('SELECT id FROM portfolio_updates WHERE uid = ?').get(uid) as any).id);
}

async function inbox(db: DatabaseSync, id: number): Promise<string[]> {
  const r = await call(db, id, 'GET', '/portfolio-updates');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.map((x: any) => x.uid).sort();
}
const detail = async (db: DatabaseSync, id: number, uid: string) => (await call(db, id, 'GET', `/portfolio-updates/${uid}`)).status;

test('an investor who sees the company reads only what its founder chose investors for; team-only, legacy and malformed fail closed', async () => {
  const db = await fixture();
  update(db, 'to-investors', V, JSON.stringify({ investors: true, team: false, network: false }));
  update(db, 'team-only', V, JSON.stringify({ investors: false, team: true, network: false }));
  update(db, 'legacy', V, null);
  update(db, 'malformed', V, '{investors: true');
  update(db, 'not-a-bool', V, JSON.stringify({ investors: 'yes' }));
  update(db, 'silent', V, JSON.stringify({ team: true }));
  assert.deepEqual(await inbox(db, INVESTOR), ['to-investors']);
  assert.equal(await detail(db, INVESTOR, 'to-investors'), 200);
  for (const uid of ['team-only', 'legacy', 'malformed', 'not-a-bool', 'silent']) assert.equal(await detail(db, INVESTOR, uid), 403, uid);
  // The founder and an admin still read every one of them.
  const all = ['legacy', 'malformed', 'not-a-bool', 'silent', 'team-only', 'to-investors'];
  assert.deepEqual(await inbox(db, OWNER), all);
  assert.deepEqual(await inbox(db, ADMIN), all);
  assert.equal(await detail(db, ADMIN, 'legacy'), 200);
});

test('a recorded investor recipient reads the update even when audience_json says nothing; another investor does not', async () => {
  const db = await fixture();
  const id = update(db, 'recorded', V, null);
  db.prepare("INSERT INTO update_recipients (update_id, audience, user_id, delivered_via) VALUES (?, 'investor', ?, 'notification')").run(id, INVESTOR);
  assert.deepEqual(await inbox(db, INVESTOR), ['recorded']);
  assert.equal(await detail(db, INVESTOR, 'recorded'), 200);
  // A recipient row of another audience is not an investor grant.
  const db2 = await fixture();
  const id2 = update(db2, 'network-row', V, null);
  db2.prepare("INSERT INTO update_recipients (update_id, audience, user_id, delivered_via) VALUES (?, 'network', ?, 'notification')").run(id2, INVESTOR);
  assert.deepEqual(await inbox(db2, INVESTOR), []);
  assert.equal(await detail(db2, INVESTOR, 'network-row'), 403);
});

test('an investor\'s grant needs the relationship: an update to investors on a venture they cannot see stays hidden', async () => {
  const db = await fixture();
  db.prepare('DELETE FROM investor_introductions WHERE project_id = ?').run(V_OTHER);
  update(db, 'seen', V, JSON.stringify({ investors: true }));
  update(db, 'unseen', V_OTHER, JSON.stringify({ investors: true }));
  assert.deepEqual(await inbox(db, INVESTOR), ['seen']);
  assert.equal(await detail(db, INVESTOR, 'unseen'), 403);
});

test('a partner reads only updates of ventures they are a member of, sent to the team; a partner with no tie reads none', async () => {
  const db = await fixture();
  update(db, 'team', V, JSON.stringify({ investors: false, team: true }));
  update(db, 'investors', V, JSON.stringify({ investors: true, team: false }));
  update(db, 'other-team', V_OTHER, JSON.stringify({ team: true }));
  update(db, 'legacy', V, null);
  assert.deepEqual(await inbox(db, P_NONE), [], 'no tie: nothing');
  for (const uid of ['team', 'investors', 'other-team', 'legacy']) assert.equal(await detail(db, P_NONE, uid), 403, `no tie: ${uid}`);
  for (const id of [P_COF, P_ADV]) {
    assert.deepEqual(await inbox(db, id), ['team'], `member ${id}`);
    assert.equal(await detail(db, id, 'team'), 200);
    for (const uid of ['investors', 'other-team', 'legacy']) assert.equal(await detail(db, id, uid), 403, `member ${id}: ${uid}`);
  }
});

test('a draft is the founder\'s and an admin\'s only', async () => {
  const db = await fixture();
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, created_at, updated_at, audience_json)
              VALUES ('draft', ?, ?, 'Draft', 'draft', '2026-10-20', '2026-10-20', ?)`).run(V, OWNER, JSON.stringify({ investors: true, team: true }));
  for (const id of [INVESTOR, P_COF]) assert.equal(await detail(db, id, 'draft'), 403, String(id));
  assert.equal(await detail(db, ADMIN, 'draft'), 200);
});
