/**
 * D1137 (#3017, part 3 of #2422) — a company's archive, restore and
 * primary-admin transfer, a venture's move and owner transfer, and the
 * membership event each change writes (migration 597), on real SQLite: the
 * baseline's tables, migration 597 over them, and the routers mounted as
 * `index.ts` mounts them. Every person and company below is made up.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/company_lifecycle_d1137.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import companyLifecycle from '../src/routes/company_lifecycle.ts';
import projectLifecycle from '../src/routes/project_lifecycle.ts';
import projects from '../src/routes/projects.ts';
import { resolveActiveCompany } from '../src/middleware/activeCompany.ts';
import { membershipEvent, MEMBERSHIP_EVENT_KINDS } from '../src/services/companyMembershipEvents.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');

// People: Ada is the primary admin of Northwind (company 1) and owns the venture; Ben is a member of
// Northwind and a co-founder of the venture with a founder account; Cy is a co-founder with no founder
// account; Dee belongs to no company; Eve is a platform admin. Ada also belongs to Southwind (company 2);
// Ben does not. Westwind (company 3) is Dee's. Fay is a co-founder on a founders row whose account is not a founder's.
const ADA = 1, BEN = 2, CY = 3, DEE = 4, EVE = 5, FAY = 6;
const NORTH = 1, SOUTH = 2, WEST = 3;
const VENTURE = 10;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'founders', 'projects', 'company_profiles', 'user_company_links', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M597);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADA, 'founder', 'Ada Made-up', 'ada@example.test', 101);
  u.run(BEN, 'founder', 'Ben Made-up', 'ben@example.test', 102);
  u.run(CY, 'advisor', 'Cy Made-up', 'cy@example.test', null);
  u.run(DEE, 'founder', 'Dee Made-up', 'dee@example.test', 104);
  u.run(EVE, 'admin', 'Eve Made-up', 'eve@example.test', null);
  u.run(FAY, 'exploring', 'Fay Made-up', 'fay@example.test', 106);
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind'); c.run(SOUTH, 'co-south', 'Southwind'); c.run(WEST, 'co-west', 'Westwind');
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  l.run('l-1', NORTH, ADA, 'Admin', 1, '2026-01-01');
  l.run('l-2', NORTH, BEN, 'Member', 0, '2026-01-02');
  l.run('l-3', SOUTH, ADA, 'Admin', 1, '2026-01-03');
  l.run('l-4', WEST, DEE, 'Admin', 1, '2026-01-04');
  db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, ?, ?, ?)').run(VENTURE, 'Made-up venture', 101, NORTH);
  return db;
}

/** Seats on the venture: Ada owns it; Ben and Cy are co-founders. */
async function seats(db: DatabaseSync, env: any) {
  await env.DB.prepare('SELECT 1').first(); // warm the binding
  const { ensureProjectMembershipSchema } = await import('../src/services/projectAccess.ts');
  await ensureProjectMembershipSchema(env);
  const s = db.prepare("INSERT INTO project_members (project_id, user_id, role, status, accepted_at) VALUES (?, ?, ?, 'accepted', datetime('now'))");
  s.run(VENTURE, ADA, 'owner'); s.run(VENTURE, BEN, 'cofounder'); s.run(VENTURE, CY, 'cofounder');
}

function appFor() {
  const app = new Hono();
  app.route('/api/projects', projectLifecycle);
  app.route('/api/projects', projects);
  app.route('/api', companyLifecycle);
  app.route('/api', companyRoutes);
  return app;
}
const envOf = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [CY]: 'advisor', [DEE]: 'founder', [EVE]: 'admin', [FAY]: 'exploring' };

async function call(db: DatabaseSync, env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await appFor().request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const events = (db: DatabaseSync) => db.prepare('SELECT company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json FROM company_membership_events ORDER BY id').all() as any[];
const primaries = (db: DatabaseSync, company: number) => (db.prepare('SELECT user_id FROM user_company_links WHERE company_id = ? AND is_primary_admin = 1 ORDER BY user_id').all(company) as any[]).map((r) => r.user_id);

// ── Archive and restore ─────────────────────────────────────────────────────

test('archive and restore: a primary admin only; an archived company is never active, and leaves the memberships list', async () => {
  // Mutations checked: a member who is not primary admin allowed; the archive filter dropped from
  // resolveActiveCompany or from /company/memberships; archiving twice allowed.
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(db, env, BEN, 'POST', '/api/company/co-north/archive')).status, 403, 'a member, not a primary admin');
  assert.equal((await call(db, env, DEE, 'POST', '/api/company/co-north/archive')).status, 404, 'a stranger reads not found');
  assert.equal((await call(db, env, EVE, 'POST', '/api/company/co-north/archive')).status, 404, 'a platform admin is not its primary admin (owner question 3 A)');
  assert.equal(await resolveActiveCompany(env, { id: ADA }, String(NORTH)), NORTH);

  const a = await call(db, env, ADA, 'POST', '/api/company/co-north/archive');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.archived, true);
  assert.equal((db.prepare('SELECT archived_by FROM company_profiles WHERE id = ?').get(NORTH) as any).archived_by, ADA);
  assert.equal(await resolveActiveCompany(env, { id: ADA }, String(NORTH)), null, 'an archived company is never active');
  assert.equal(await resolveActiveCompany(env, { id: BEN }, String(NORTH)), null, 'for any of its members');
  assert.equal(await resolveActiveCompany(env, { id: ADA }, String(SOUTH)), SOUTH, 'the other company is untouched');
  assert.equal((await call(db, env, ADA, 'POST', '/api/company/co-north/archive')).body.code, 'already_archived');

  const list = await call(db, env, ADA, 'GET', '/api/company/memberships');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.map((x: any) => x.uid), ['co-south'], 'the archived company leaves the switcher\'s list');
  const all = await call(db, env, ADA, 'GET', '/api/company/memberships?include=archived');
  assert.deepEqual(all.body.map((x: any) => [x.uid, Boolean(x.archived_at)]), [['co-north', true], ['co-south', false]]);
  const me = await call(db, env, ADA, 'GET', '/api/company/me');
  assert.equal(me.body.uid, 'co-south', '/company/me skips the archived company');

  const r = await call(db, env, ADA, 'POST', '/api/company/co-north/restore');
  assert.deepEqual([r.status, r.body.archived], [200, false]);
  assert.equal(await resolveActiveCompany(env, { id: ADA }, String(NORTH)), NORTH, 'restored as it was');
  assert.equal((await call(db, env, ADA, 'POST', '/api/company/co-north/restore')).body.code, 'not_archived');
  assert.deepEqual(events(db).map((e) => [e.kind, e.company_id, e.actor_user_id]), [['archive', NORTH, ADA], ['restore', NORTH, ADA]]);
});

// ── Transfer ─────────────────────────────────────────────────────────────────

test('transfer grants and demotes in one batch, and never leaves a company without a primary admin', async () => {
  // Mutations checked: the demote sent before the grant (or without it); a non-member target accepted;
  // `demote` taken from a string; the event outside the batch.
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(db, env, BEN, 'POST', '/api/company/co-north/transfer', { user_id: ADA })).status, 403);
  assert.equal((await call(db, env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: DEE, demote: true })).status, 404, 'only to a member');
  assert.equal((await call(db, env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: ADA })).status, 400);
  assert.equal((await call(db, env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: BEN, demote: 'yes' })).status, 400);
  assert.deepEqual(primaries(db, NORTH), [ADA], 'a refused transfer changes nothing');

  // A failed event write rolls the grant and the demote back with it: the batch is all or none.
  db.exec('ALTER TABLE company_membership_events RENAME TO cme_away');
  const failed = await call(db, env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: BEN, demote: true });
  assert.ok(failed.status >= 500, JSON.stringify(failed.body));
  assert.deepEqual(primaries(db, NORTH), [ADA], 'never halfway');
  db.exec('ALTER TABLE cme_away RENAME TO company_membership_events');

  const t = await call(db, env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: BEN, demote: true });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.deepEqual(primaries(db, NORTH), [BEN], 'Ben holds it, Ada stepped down');
  assert.deepEqual(events(db).map((e) => [e.kind, e.actor_user_id, e.target_user_id, JSON.parse(e.after_json)]),
    [['transfer', ADA, BEN, { target_primary_admin: true, actor_primary_admin: false }]]);
  assert.equal((await call(db, env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: BEN })).status, 403, 'Ada is no longer a primary admin');

  // Without demote both hold it; then Ben may step down to Ada, who already holds it.
  const both = await call(db, env, BEN, 'POST', '/api/company/co-north/transfer', { user_id: ADA });
  assert.equal(both.status, 200);
  assert.deepEqual(primaries(db, NORTH), [ADA, BEN]);
  assert.equal((await call(db, env, BEN, 'POST', '/api/company/co-north/transfer', { user_id: ADA })).body.code, 'already_primary');
  assert.equal((await call(db, env, BEN, 'POST', '/api/company/co-north/transfer', { user_id: ADA, demote: true })).status, 200);
  assert.deepEqual(primaries(db, NORTH), [ADA]);

  await call(db, env, ADA, 'POST', '/api/company/co-north/archive');
  assert.equal((await call(db, env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: BEN })).body.code, 'archived');
});

// ── A venture's move and owner transfer ─────────────────────────────────────

test('a venture moves only to a company its owner belongs to, never to an archived one, and out of its company with null', async () => {
  // Mutations checked: the owner's membership not checked; an archived company accepted; a co-founder allowed to move it.
  const db = fixture(); const env = envOf(db); await seats(db, env);
  assert.equal((await call(db, env, BEN, 'POST', `/api/projects/${VENTURE}/move`, { company_id: SOUTH })).status, 403, 'a co-founder does not move it');
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/move`, {})).status, 400);
  const west = await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: WEST });
  assert.deepEqual([west.status, west.body.code], [404, 'not_owner_company'], 'Ada does not belong to Westwind');
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: NORTH })).body.code, 'unchanged');

  const moved = await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: SOUTH });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal((db.prepare('SELECT company_id FROM projects WHERE id = ?').get(VENTURE) as any).company_id, SOUTH);

  await call(db, env, ADA, 'POST', '/api/company/co-north/archive');
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: NORTH })).body.code, 'archived');
  const out = await call(db, env, EVE, 'POST', `/api/projects/${VENTURE}/move`, { company_id: null });
  assert.deepEqual([out.status, out.body.company_id], [200, null], 'an admin may take it out of its company');
  assert.deepEqual(events(db).filter((e) => e.kind === 'project_move').map((e) => [e.project_id, e.company_id, e.actor_user_id, JSON.parse(e.before_json), JSON.parse(e.after_json)]), [
    [VENTURE, SOUTH, ADA, { company_id: NORTH }, { company_id: SOUTH }],
    [VENTURE, SOUTH, EVE, { company_id: SOUTH }, { company_id: null }],
  ]);
});

test('the owner seat goes to a co-founder with a founder account who belongs to the venture\'s company', async () => {
  // Mutations checked: an advisor account accepted as owner; the company check dropped; the old owner losing their seat.
  const db = fixture(); const env = envOf(db); await seats(db, env);
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: DEE })).body.code, 'not_cofounder');
  // Dee, with a founder account, holds an advisor seat: still not a co-founder.
  db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')").run(VENTURE, DEE);
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: DEE })).body.code, 'not_cofounder');
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: CY })).body.code, 'no_founder_account');
  db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')").run(VENTURE, FAY);
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: FAY })).body.code, 'no_founder_account',
    'a founders row is not enough: the account must be a founder\'s');
  assert.equal((await call(db, env, BEN, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: BEN })).status, 403, 'only the owner transfers it');

  // In Southwind, which Ben does not belong to, the transfer waits for a move.
  db.prepare('UPDATE projects SET company_id = ? WHERE id = ?').run(SOUTH, VENTURE);
  const refused = await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: BEN });
  assert.deepEqual([refused.status, refused.body.code], [409, 'owner_not_in_company']);
  assert.equal((db.prepare('SELECT founder_id FROM projects WHERE id = ?').get(VENTURE) as any).founder_id, 101, 'nothing changed');
  db.prepare('UPDATE projects SET company_id = ? WHERE id = ?').run(NORTH, VENTURE);

  const t = await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: BEN });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal((db.prepare('SELECT founder_id FROM projects WHERE id = ?').get(VENTURE) as any).founder_id, 102, 'the venture is Ben\'s');
  const roles = Object.fromEntries((db.prepare("SELECT user_id, role FROM project_members WHERE project_id = ? AND status = 'accepted'").all(VENTURE) as any[]).map((r) => [r.user_id, r.role]));
  assert.deepEqual(roles, { [ADA]: 'cofounder', [BEN]: 'owner', [CY]: 'cofounder', [DEE]: 'advisor', [FAY]: 'cofounder' }, 'Ada keeps a seat as a co-founder');
  assert.deepEqual(events(db).map((e) => [e.kind, e.project_id, e.company_id, e.target_user_id, JSON.parse(e.after_json)]),
    [['project_transfer', VENTURE, NORTH, BEN, { owner_user_id: BEN }]]);
  assert.equal((await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: SOUTH })).status, 403, 'Ada no longer owns it');
});

// ── Every membership change writes its event ────────────────────────────────

test('every company membership route writes its event: join, rename, role change, removal and leave', async () => {
  // Mutations checked: removal recorded as a leave (and the other way round); a title-only edit recorded as a role change.
  const db = fixture(); const env = envOf(db);
  const created = await call(db, env, DEE, 'POST', '/api/company/create', { company_name: 'Eastwind' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const east = Number(created.body.id);
  assert.equal((await call(db, env, ADA, 'PATCH', '/api/company/co-north', { company_name: 'Northwind Labs' })).status, 200);
  assert.equal((await call(db, env, ADA, 'PATCH', '/api/company/co-north', { description: 'No rename here' })).status, 200);
  assert.equal((await call(db, env, ADA, 'PATCH', `/api/company/co-north/members/${BEN}`, { role_in_company: 'Advisor' })).status, 200);
  assert.equal((await call(db, env, ADA, 'PATCH', `/api/company/co-north/members/${BEN}`, { title: null })).status, 200);
  db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l-5', ?, ?, 'Admin', 0)").run(NORTH, DEE);
  assert.equal((await call(db, env, ADA, 'DELETE', `/api/company/co-north/members/${BEN}`)).status, 200);
  assert.equal((await call(db, env, DEE, 'DELETE', `/api/company/co-north/members/${DEE}`)).status, 200, 'an editor removing themselves leaves');
  assert.deepEqual(events(db).map((e) => [e.kind, e.company_id, e.actor_user_id, e.target_user_id, e.before_json && JSON.parse(e.before_json), e.after_json && JSON.parse(e.after_json)]), [
    ['join', east, DEE, DEE, null, { role_in_company: 'Admin', is_primary_admin: true }],
    ['rename', NORTH, ADA, null, { company_name: 'Northwind' }, { company_name: 'Northwind Labs' }],
    ['role_change', NORTH, ADA, BEN, { role_in_company: 'Member' }, { role_in_company: 'Advisor' }],
    ['remove', NORTH, ADA, BEN, { role_in_company: 'Advisor', is_primary_admin: false }, null],
    ['leave', NORTH, DEE, DEE, { role_in_company: 'Admin', is_primary_admin: false }, null],
  ]);
});

test('a venture\'s seat changes write their events, and the event writer refuses what it cannot place', async () => {
  // Mutation checked: the seat removal's event written when there was no seat.
  const db = fixture(); const env = envOf(db); await seats(db, env);
  const add = await call(db, env, ADA, 'POST', `/api/projects/${VENTURE}/members`, { user_id: DEE, role: 'advisor' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal((await call(db, env, ADA, 'DELETE', `/api/projects/${VENTURE}/members/${DEE}`)).status, 200);
  assert.equal((await call(db, env, ADA, 'DELETE', `/api/projects/${VENTURE}/members/${DEE}`)).status, 200, 'removing again changes nothing');
  assert.deepEqual(events(db).map((e) => [e.kind, e.project_id, e.target_user_id]), [['seat_add', VENTURE, DEE], ['seat_remove', VENTURE, DEE]]);

  assert.deepEqual([...MEMBERSHIP_EVENT_KINDS].sort(), ['archive', 'join', 'leave', 'project_move', 'project_transfer', 'remove', 'rename', 'restore', 'role_change', 'seat_add', 'seat_remove', 'transfer']);
  assert.throws(() => membershipEvent(env, { kind: 'join' }), /names a company or a venture/);
  assert.throws(() => membershipEvent(env, { kind: 'nope' as any, companyId: 1 }), /unknown/);
  // The migration's CHECK holds the same rule for any writer.
  assert.throws(() => db.prepare("INSERT INTO company_membership_events (kind) VALUES ('join')").run());
  assert.throws(() => db.prepare("INSERT INTO company_membership_events (company_id, kind) VALUES (1, 'promoted')").run());
});
