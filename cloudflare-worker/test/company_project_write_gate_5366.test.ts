/**
 * D5366 (#5366) — a company project is written through a company seat.
 *
 * Direct requests exercise the project-data, roster and lifecycle routes. The
 * UI capability comes from the same members read. Project authority remains
 * the route's existing D889 rule; #5329 owns any expansion of that rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import projects from '../src/routes/projects.ts';
import lifecycle from '../src/routes/project_lifecycle.ts';
import { hashInviteToken } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = 'd5366-company-project-write-gate-secret';
const OWNER = 101, COFOUNDER = 102, PLAIN = 103, HQ = 104, HQ_SEATED = 105, TARGET = 106;
const PROJECT = 70, COMPANY = 1, FOUNDER = 501;
const ROLE: Record<number, string> = { [OWNER]: 'founder', [COFOUNDER]: 'founder', [PLAIN]: 'founder', [HQ]: 'admin', [HQ_SEATED]: 'admin', [TARGET]: 'founder' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const user = db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
  for (const [id, role, founder] of [[OWNER, 'founder', FOUNDER], [COFOUNDER, 'founder', 502], [PLAIN, 'founder', 503], [HQ, 'admin', null], [HQ_SEATED, 'admin', null], [TARGET, 'founder', 504]] as const) {
    user.run(id, `u-${id}`, `u${id}@example.test`, `User ${id}`, role, founder, 'growth', 'active');
  }
  db.prepare("INSERT INTO founders (id, name, email) VALUES (?, 'Owner', 'owner@example.test')").run(FOUNDER);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, 'co-north', 'Northwind', datetime('now'), datetime('now'))").run(COMPANY);
  const link = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES (?, ?, ?, ?, 0)");
  link.run('l-owner', COMPANY, OWNER, 'Founder');
  link.run('l-cofounder', COMPANY, COFOUNDER, 'Founder');
  link.run('l-plain', COMPANY, PLAIN, 'Member');
  link.run('l-hq-seat', COMPANY, HQ_SEATED, 'Admin');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id, slug, stage, created_at, updated_at) VALUES (?, 'p-70', 'Before', ?, ?, 'before', 'idea', datetime('now'), datetime('now'))").run(PROJECT, FOUNDER, COMPANY);
  const member = db.prepare("INSERT INTO project_members (project_id, user_id, role, status, accepted_at) VALUES (?, ?, ?, 'accepted', datetime('now'))");
  member.run(PROJECT, OWNER, 'owner'); member.run(PROJECT, COFOUNDER, 'cofounder'); member.run(PROJECT, PLAIN, 'cofounder');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}

async function call(w: ReturnType<typeof fixture>, who: number, method: string, path: string, body?: unknown, claims: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const app = new Hono(); app.route('/api/projects', lifecycle); app.route('/api/projects', projects);
  const res = await app.request(`/api/projects${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await res.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json, text };
}

const name = (w: ReturnType<typeof fixture>) => (w.db.prepare('SELECT name FROM projects WHERE id = ?').get(PROJECT) as any).name;
const support = { impersonated_by: HQ };

test('project data: HQ without a seat, support and a non-editing seat are refused before any write', async () => {
  for (const [who, claims, reason] of [[HQ, {}, 'hq_access'], [OWNER, support, 'support_session'], [PLAIN, {}, 'not_an_editor']] as const) {
    const w = fixture();
    const out = await call(w, who, 'PUT', `/${PROJECT}`, { name: 'Changed' }, claims);
    assert.deepEqual([out.status, out.body?.reason], [403, reason], out.text);
    assert.equal(name(w), 'Before', 'a refused request changes nothing');
  }
});

test('creating a company project is refused before any founder or project row is written', async () => {
  for (const [who, claims, reason] of [[HQ, {}, 'hq_access'], [OWNER, support, 'support_session'], [PLAIN, {}, 'not_an_editor']] as const) {
    const w = fixture();
    const before = (w.db.prepare('SELECT COUNT(*) AS n FROM projects').get() as any).n;
    const founders = (w.db.prepare('SELECT COUNT(*) AS n FROM founders').get() as any).n;
    const out = await call(w, who, 'POST', '', { name: 'New company project', company_id: COMPANY }, claims);
    assert.deepEqual([out.status, out.body?.reason], [403, reason], out.text);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM projects').get() as any).n, before);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM founders').get() as any).n, founders);
  }
});

test('project data: owner, editing co-founder and platform admin with an editing seat keep existing authority', async () => {
  for (const who of [OWNER, COFOUNDER, HQ_SEATED]) {
    const w = fixture();
    const out = await call(w, who, 'PUT', `/${PROJECT}`, { name: `Changed ${who}` });
    assert.equal(out.status, 200, out.text);
    assert.equal(name(w), `Changed ${who}`);
  }
});

test('all existing-project mutation paths cross the gate, including roster and lifecycle routes', async () => {
  for (const [method, path, body] of [
    ['POST', `/${PROJECT}/members`, { mode: 'user_id', user_id: TARGET, role: 'advisor' }],
    ['PUT', `/${PROJECT}/slug`, { slug: 'after' }],
    ['POST', `/${PROJECT}/move`, { company_id: null }],
    ['POST', `/${PROJECT}/transfer`, { user_id: TARGET }],
  ] as const) {
    for (const [who, claims, reason] of [[HQ, {}, 'hq_access'], [OWNER, support, 'support_session'], [PLAIN, {}, 'not_an_editor']] as const) {
      const w = fixture();
      const out = await call(w, who, method, path, body, claims);
      assert.deepEqual([out.status, out.body?.reason], [403, reason], `${method} ${path}: ${out.text}`);
      assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND user_id = ?').get(PROJECT, TARGET) as any).n, 0);
      assert.deepEqual({ ...(w.db.prepare('SELECT slug, company_id, founder_id FROM projects WHERE id = ?').get(PROJECT) as any) }, { slug: 'before', company_id: COMPANY, founder_id: FOUNDER });
    }
  }
  const w = fixture();
  const roster = await call(w, HQ_SEATED, 'POST', `/${PROJECT}/members`, { mode: 'user_id', user_id: TARGET, role: 'advisor' });
  assert.equal(roster.status, 200, roster.text);
  assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND user_id = ?').get(PROJECT, TARGET) as any).n, 1);
});

test('accepting an invitation to a company project crosses the same gate', async () => {
  for (const [who, claims, reason] of [[HQ, {}, 'hq_access'], [OWNER, support, 'support_session'], [PLAIN, {}, 'not_an_editor']] as const) {
    const w = fixture(); const token = `invite-${who}`; const hash = await hashInviteToken(token);
    w.db.prepare("INSERT INTO project_member_invitations (project_id, role, status, source, invitee_user_id, token_hash, expires_at) VALUES (?, 'advisor', 'pending', 'link', ?, ?, datetime('now', '+1 day'))")
      .run(PROJECT, who, hash);
    const out = await call(w, who, 'POST', '/invitations/accept', { token }, claims);
    assert.deepEqual([out.status, out.body?.reason], [403, reason], out.text);
    assert.equal((w.db.prepare("SELECT status FROM project_member_invitations WHERE token_hash = ?").get(hash) as any).status, 'pending');
  }
});

test('the members read returns the server capability and denial reason used by the Projects tab', async () => {
  const expected = [
    [HQ, {}, false, false, 'hq_access'],
    [OWNER, support, false, false, 'support_session'],
    [HQ_SEATED, {}, true, true, null],
    [COFOUNDER, {}, true, true, null], // D5329: the Founder seat now confers roster authority.
    [PLAIN, {}, false, false, 'not_an_editor'],
  ] as const;
  for (const [who, claims, canManage, canEdit, reason] of expected) {
    const out = await call(fixture(), who, 'GET', `/${PROJECT}/members`, undefined, claims);
    assert.equal(out.status, 200, out.text);
    assert.deepEqual([out.body.can_manage, out.body.can_edit, out.body.write_reason], [canManage, canEdit, reason]);
  }
});

test('the company gate does not take #5329 project-scope authority', () => {
  const teams = readFileSync(new URL('../src/services/agents/teams.ts', import.meta.url), 'utf8');
  assert.match(teams, /s\.kind === 'company'[\s\S]*companyWriteDenial/);
  assert.match(teams, /return isProjectManager\(user, s\)/);
});
