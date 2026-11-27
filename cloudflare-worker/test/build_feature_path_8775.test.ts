/**
 * D8775 (#8775) — one feature carried from Solution design to a must-have, a builder and a reviewer, a
 * dated test against a linked deliverable, and the proof Raise offers for Pitch.
 *
 *   1. Make it a must-have promotes the feature's own row: pain theme, hypothesis (and its success bar)
 *      are carried; `roadmap` adds the linked item in the same write; a second promotion is a 409.
 *   2. Owners and reviewers are the project's team (#3994's roster) or its company (Q1 option A); an
 *      empty list says why and where to add someone.
 *   3. An agent builds only with a named person reviewing, and only the project's own active agent (Q2 A).
 *   4. A session's deliverable is an https address; a linked address is Returned, never Tested; a done
 *      session needs its date.
 *   5. Raise offers `prototype-test-result` only for a must-have's dated, done session that kept a finding
 *      and links its deliverable (Q3 A); the founder still accepts it there.
 *
 * Real SQLite with the production schema and every migration. Names and addresses are made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_feature_path_8775.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import build from '../src/routes/cycle_build.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { collectEvidenceSources } from '../src/services/raiseEvidenceSources.ts';
import { deliverableUrl, proofStage } from '../src/services/buildOwners.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-8775-0123456789abcdef';
const FOUNDER = 10, COMPANY_MATE = 11, TEAM_ONLY = 12, OUTSIDER = 13, ADMIN = 14;
const P = 1, P_OTHER = 2, COMPANY = 5;
const FEATURE = 3, PAIN = 1, HYP = 30, AGENT = 40, AGENT_PAUSED = 41, AGENT_OTHER = 42;

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const ddl = (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
  db.close();
  return ddl;
})();

function world(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES
    (${FOUNDER}, 'founder', 'Maya Sample', 'maya@example.invalid', 1, 1001, 'growth'),
    (${COMPANY_MATE}, 'founder', 'Noah Sample', 'noah@example.invalid', 1, NULL, 'free'),
    (${TEAM_ONLY}, 'advisor', 'Iris Sample', 'iris@example.invalid', 1, NULL, 'free'),
    (${OUTSIDER}, 'founder', 'Theo Sample', 'theo@example.invalid', 1, 1002, 'free'),
    (${ADMIN}, 'admin', 'Admin Sample', 'admin@example.invalid', 1, NULL, 'free')`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${P}, 'Orchard Sample', 1001, ${COMPANY}), (${P_OTHER}, 'Other Sample', 1002, 6)`);
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', ${FOUNDER}, ${COMPANY}), ('l2', ${COMPANY_MATE}, ${COMPANY})`);
  // Iris is on the project's team only: before #8775 she could own nothing on Build.
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${TEAM_ONLY}, 'advisor', 'accepted')`);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (${PAIN}, ${P}, 'Intake takes a day')`);
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim, success_bar) VALUES (${HYP}, ${P}, 'H2', 'Clinics book faster with a form', '8 of 10 complete it unaided')`);
  db.exec(`INSERT INTO mvp_features (id, project_id, title, pain_group_id, hypothesis_id, is_must_have, delivery_status) VALUES
    (${FEATURE}, ${P}, 'Customer intake form', ${PAIN}, ${HYP}, 0, 'Backlog'), (9, ${P_OTHER}, 'Elsewhere', NULL, NULL, 0, 'Backlog')`);
  db.exec(`INSERT INTO team_agents (id, uid, scope_kind, project_id, role_key, first_name, model_id, sponsor_user_id, monthly_cap_microusd, status, created_by) VALUES
    (${AGENT}, 'a40', 'project', ${P}, 'engineer', 'Draft', 'model', ${FOUNDER}, 1000, 'active', ${FOUNDER}),
    (${AGENT_PAUSED}, 'a41', 'project', ${P}, 'designer', 'Paused', 'model', ${FOUNDER}, 1000, 'paused', ${FOUNDER}),
    (${AGENT_OTHER}, 'a42', 'project', ${P_OTHER}, 'engineer', 'Other', 'model', ${OUTSIDER}, 1000, 'active', ${OUTSIDER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles', cycleRecords);
app.route('/api/cycles/build', build);
app.onError((e, c) => c.json({ error: e.message }, 500));
const envFor = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' }) as any;

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, userId = FOUNDER) {
  const token = await new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await withThrownResponses(() => app.request(`/api/cycles/build${path}${path.includes('?') ? '&' : '?'}project=${P}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, envFor(db)));
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const rec = (db: DatabaseSync, slug: string, id: number) => call(db, 'GET', `/modules/${slug}/records/${id}`);
const act = (db: DatabaseSync, slug: string, id: number, key: string, body: unknown = {}) => call(db, 'POST', `/modules/${slug}/records/${id}/actions/${key}`, body);
const options = (db: DatabaseSync, slug: string) => call(db, 'GET', `/modules/${slug}/form-options`);
const row = (db: DatabaseSync, sql: string, ...args: any[]) => ({ ...(db.prepare(sql).get(...args) as any) });
const n = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);
const section = (r: any, title: string) => r.body.side.find((s: any) => s.title === title) ?? r.body.main.find((s: any) => s.title === title);
const rowB = (s: any, a: string) => s.rows.find((x: any) => x.a === a)?.b;

test('1: Add must-have from a feature promotes its own row, carrying its pain theme and hypothesis, and adds the roadmap item in the same write', async () => {
  const db = world();
  try {
    const features = n(db, 'SELECT COUNT(*) AS n FROM mvp_features');
    const r = await call(db, 'POST', '/must-haves', { feature_id: FEATURE, state: 'in_progress', owner_user_id: TEAM_ONLY, due_date: '2027-01-15', roadmap: 'next' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.id, FEATURE, 'the must-have is the feature, not a second row');
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM mvp_features'), features, 'no new row: nothing is retyped');
    assert.deepEqual(row(db, 'SELECT title, pain_group_id, hypothesis_id, is_must_have, delivery_status, owner_user_id, due_date FROM mvp_features WHERE id = ?', FEATURE),
      { title: 'Customer intake form', pain_group_id: PAIN, hypothesis_id: HYP, is_must_have: 1, delivery_status: 'In Progress', owner_user_id: TEAM_ONLY, due_date: '2027-01-15' });
    assert.deepEqual(row(db, 'SELECT objective, kanban_status, feature_id, owner_user_id FROM roadmap_okrs WHERE id = ?', r.body.roadmap_item_id),
      { objective: 'Customer intake form', kanban_status: 'next', feature_id: FEATURE, owner_user_id: TEAM_ONLY });
    assert.equal(n(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'build_must_have_promoted'"), 1);
    // Promoting it again makes nothing twice.
    assert.equal((await call(db, 'POST', '/must-haves', { feature_id: FEATURE })).status, 409);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM roadmap_okrs'), 1);
    // Another venture's feature is a 404; a bad column is a 400; neither writes.
    assert.equal((await call(db, 'POST', '/must-haves', { feature_id: 9 })).status, 404);
    db.exec(`INSERT INTO mvp_features (id, project_id, title, is_must_have) VALUES (4, ${P}, 'Reminder texts', 0)`);
    assert.equal((await call(db, 'POST', '/must-haves', { feature_id: 4, roadmap: 'someday' })).status, 400);
    assert.equal(row(db, 'SELECT is_must_have FROM mvp_features WHERE id = 4').is_must_have, 0);
    // The record shows what it carried, with the hypothesis's success bar.
    const carried = section(await rec(db, 'prototype-mvp', FEATURE), 'Carried from the feature');
    assert.equal(rowB(carried, 'Pain theme'), 'Intake takes a day');
    assert.equal(rowB(carried, 'Success bar'), '8 of 10 complete it unaided');
    const sd = section(await rec(db, 'solution-design', FEATURE), 'Carried into its must-have');
    assert.equal(rowB(sd, 'Success bar'), '8 of 10 complete it unaided');
  } finally { db.close(); }
});

test('1: the feature record\'s Make it a must-have runs the same promotion, and Add must-have offers only features not yet must-haves', async () => {
  const db = world();
  try {
    const before = await options(db, 'prototype-mvp');
    assert.deepEqual(before.body.feature_id.options, [{ value: String(FEATURE), label: 'Customer intake form' }]);
    const r = await rec(db, 'solution-design', FEATURE);
    const make = r.body.actions.find((a: any) => a.key === 'mark-must-have');
    assert.equal(make.label, 'Make it a must-have');
    assert.equal(make.kind, 'form');
    assert.equal((await act(db, 'solution-design', FEATURE, 'mark-must-have', { roadmap: 'now', owner_user_id: String(COMPANY_MATE) })).status, 200);
    assert.deepEqual(row(db, 'SELECT is_must_have, pain_group_id, hypothesis_id, owner_user_id FROM mvp_features WHERE id = ?', FEATURE),
      { is_must_have: 1, pain_group_id: PAIN, hypothesis_id: HYP, owner_user_id: COMPANY_MATE });
    assert.equal(row(db, 'SELECT kanban_status FROM roadmap_okrs WHERE feature_id = ?', FEATURE).kanban_status, 'now');
    assert.deepEqual((await options(db, 'prototype-mvp')).body.feature_id.options, [], 'a must-have is not offered again');
  } finally { db.close(); }
});

test('2: an owner is on the project\'s team or in its company; anyone else is refused, and an empty list says where to add someone', async () => {
  const db = world();
  try {
    const owners = (await options(db, 'prototype-mvp')).body.owner_user_id;
    assert.deepEqual(owners.options.map((o: any) => o.label), ['Iris Sample', 'Maya Sample', 'Noah Sample'], 'team and company, each once');
    assert.equal(owners.note, undefined);
    assert.equal((await call(db, 'POST', '/must-haves', { title: 'Booking link', owner_user_id: TEAM_ONLY })).status, 201);
    const refused = await call(db, 'POST', '/must-haves', { title: 'Booking link', owner_user_id: OUTSIDER });
    assert.equal(refused.status, 400);
    assert.match(refused.body.detail, /not on this project’s team or in its company/);
    assert.equal((await call(db, 'POST', '/roadmap', { title: 'Intake v2', owner_user_id: TEAM_ONLY })).status, 201);
    assert.equal((await call(db, 'POST', '/roadmap', { title: 'Intake v3', owner_user_id: OUTSIDER })).status, 400);
    assert.equal((await call(db, 'PATCH', `/features/${FEATURE}`, { owner_user_id: OUTSIDER })).status, 400);
    // A member whose seat was removed is no longer offered nor accepted.
    db.exec(`UPDATE project_members SET status = 'removed' WHERE user_id = ${TEAM_ONLY}`);
    assert.equal((await call(db, 'POST', '/must-haves', { title: 'Booking link', owner_user_id: TEAM_ONLY })).status, 400);
    // No one at all (an admin's preview of a venture whose founder holds no seat): the read says why and links the project's team.
    db.exec('DELETE FROM user_company_links; DELETE FROM project_members; UPDATE users SET founder_id = NULL');
    const empty = (await call(db, 'GET', '/modules/prototype-mvp/form-options', undefined, ADMIN)).body.owner_user_id;
    assert.deepEqual(empty.options, []);
    assert.equal(empty.note.href, `/projects/${P}/settings/team`);
    assert.match(empty.note.text, /on this project’s team or in its company/);
  } finally { db.close(); }
});

test('3: an agent builds only with a person reviewing, and only the project\'s own active agent', async () => {
  const db = world();
  try {
    db.exec(`UPDATE mvp_features SET is_must_have = 1 WHERE id = ${FEATURE}`);
    const set = (body: unknown) => act(db, 'prototype-mvp', FEATURE, 'assign-builder', body);
    assert.equal((await set({ builder_agent_id: String(AGENT) })).status, 400, 'no reviewer');
    assert.equal((await set({ builder_agent_id: String(AGENT_PAUSED), reviewer_user_id: String(TEAM_ONLY) })).status, 400, 'a paused agent');
    assert.equal((await set({ builder_agent_id: String(AGENT_OTHER), reviewer_user_id: String(TEAM_ONLY) })).status, 400, 'another project\'s agent');
    assert.equal((await set({ builder_agent_id: String(AGENT), reviewer_user_id: String(OUTSIDER) })).status, 400, 'a reviewer off the team');
    assert.deepEqual(row(db, 'SELECT builder_agent_id, reviewer_user_id FROM mvp_features WHERE id = ?', FEATURE), { builder_agent_id: null, reviewer_user_id: null });
    assert.equal((await set({ builder_agent_id: String(AGENT), reviewer_user_id: String(TEAM_ONLY) })).status, 200);
    assert.deepEqual(row(db, 'SELECT builder_agent_id, reviewer_user_id FROM mvp_features WHERE id = ?', FEATURE), { builder_agent_id: AGENT, reviewer_user_id: TEAM_ONLY });
    const who = section(await rec(db, 'prototype-mvp', FEATURE), 'Who builds it');
    assert.equal(rowB(who, 'Builder'), 'Draft (agent), reviewed by Iris Sample');
    // The reviewer cannot be cleared while the agent builds it; clearing both is fine.
    assert.equal((await set({ reviewer_user_id: '' })).status, 400);
    assert.equal((await call(db, 'PATCH', `/features/${FEATURE}`, { reviewer_user_id: null })).status, 400);
    assert.equal((await set({ builder_agent_id: '', reviewer_user_id: '' })).status, 200);
    assert.deepEqual(row(db, 'SELECT builder_agent_id, reviewer_user_id FROM mvp_features WHERE id = ?', FEATURE), { builder_agent_id: null, reviewer_user_id: null });
    // The paused agent is not offered.
    const form = (await rec(db, 'prototype-mvp', FEATURE)).body.actions.find((a: any) => a.key === 'assign-builder').form;
    assert.deepEqual(form.fields[0].options.map((o: any) => o.value), ['', String(AGENT)]);
  } finally { db.close(); }
});

test('4: a linked deliverable is Returned, never Tested; a done session is dated; the address must be https', async () => {
  const db = world();
  try {
    db.exec(`UPDATE mvp_features SET is_must_have = 1 WHERE id = ${FEATURE}`);
    const add = (body: unknown) => act(db, 'prototype-mvp', FEATURE, 'add-session', body);
    for (const bad of ['http://prototype.example.invalid', 'https://user:pw@prototype.example.invalid', 'javascript:alert(1)', 'https://prototype.example.invalid/ x'])
      assert.equal((await add({ title: 'Walkthrough', deliverable_url: bad })).status, 400, bad);
    assert.equal((await add({ title: 'Walkthrough', status: 'done' })).status, 400, 'a done session needs its date');
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM mvp_test_sessions'), 0);
    assert.equal((await add({ title: 'Walkthrough', deliverable_url: 'https://prototype.example.invalid/intake' })).status, 200);
    const stage = () => rec(db, 'prototype-mvp', FEATURE).then((r) => section(r, 'Proof').rows.find((x: any) => x.a === 'Stage'));
    assert.equal((await stage()).c, 'Returned', 'an address alone');
    assert.match((await stage()).b, /Returned is not tested/);
    assert.equal(section(await rec(db, 'prototype-mvp', FEATURE), 'Test sessions').rows[0].href, 'https://prototype.example.invalid/intake');
    assert.equal((await add({ title: 'Clinic test', status: 'done', held_on: '2026-11-20', owner_user_id: String(TEAM_ONLY), deliverable_url: 'https://prototype.example.invalid/intake' })).status, 200);
    assert.equal((await stage()).c, 'Returned', 'a done session with no kept finding is still not Tested');
    const session = row(db, "SELECT id FROM mvp_test_sessions WHERE title = 'Clinic test'").id;
    db.exec(`INSERT INTO mvp_test_findings (session_id, text, hypothesis_id, direction, kept) VALUES (${session}, 'Eight of ten finished alone', ${HYP}, 'supports', 1)`);
    assert.equal((await stage()).c, 'Tested');
    assert.equal(rowB(section(await rec(db, 'prototype-mvp', FEATURE), 'Proof'), 'Last tested') != null, true);
  } finally { db.close(); }
});

test('5: Raise offers a prototype test result only for a must-have\'s dated, done session that kept a finding and links its deliverable', async () => {
  const db = world();
  try {
    const env = envFor(db);
    const offered = async () => (await collectEvidenceSources(env, P, FOUNDER, '2026-11-27T00:00:00Z', ['prototype-test-result'])).candidates;
    db.exec(`UPDATE mvp_features SET is_must_have = 1 WHERE id = ${FEATURE}`);
    db.exec(`INSERT INTO mvp_test_sessions (id, project_id, feature_id, title, held_on, status, deliverable_url) VALUES
      (60, ${P}, ${FEATURE}, 'Address only', '2026-11-18', 'planned', 'https://prototype.example.invalid/a'),
      (61, ${P}, ${FEATURE}, 'Done, no address', '2026-11-19', 'done', NULL),
      (62, ${P}, ${FEATURE}, 'Done, undated', NULL, 'done', 'https://prototype.example.invalid/b'),
      (63, ${P}, ${FEATURE}, 'Done, flagged only', '2026-11-20', 'done', 'https://prototype.example.invalid/c'),
      (64, ${P}, ${FEATURE}, 'Clinic test', '2026-11-21', 'done', 'https://prototype.example.invalid/d')`);
    db.exec(`INSERT INTO mvp_test_findings (session_id, text, direction, kept) VALUES
      (60, 'kept', 'supports', 1), (61, 'kept', 'supports', 1), (62, 'kept', 'supports', 1), (63, 'flagged', 'supports', 0), (64, 'kept', 'supports', 1)`);
    const got = await offered();
    assert.deepEqual(got.map((c) => [c.source_ref, c.observed_on, c.source_label, c.source_table]), [['64', '2026-11-21', 'recorded', 'mvp_test_sessions']]);
    assert.doesNotMatch(JSON.stringify(got), /prototype\.example/, 'the address is not in the offer');
    // A feature that is not a must-have offers nothing.
    db.exec(`UPDATE mvp_features SET is_must_have = 0 WHERE id = ${FEATURE}`);
    assert.deepEqual(await offered(), []);
  } finally { db.close(); }
});

test('the pure rules: the deliverable address and the proof stage', () => {
  assert.equal(deliverableUrl(undefined), undefined);
  assert.equal(deliverableUrl(''), null);
  assert.equal(deliverableUrl('https://prototype.example.invalid/x'), 'https://prototype.example.invalid/x');
  for (const bad of ['http://a.example', 'https://a.example:8443/', 'https://localhost/', 'ftp://a.example', 42, 'https://a.example/\u0000'])
    assert.equal(deliverableUrl(bad), false, String(bad));
  assert.equal(proofStage([]), 'none');
  assert.equal(proofStage([{ status: 'planned', deliverable_url: 'https://a.example', kept: 1 }]), 'returned');
  assert.equal(proofStage([{ status: 'done', deliverable_url: 'https://a.example', kept: 0 }]), 'returned');
  assert.equal(proofStage([{ status: 'done', deliverable_url: null, kept: 1 }]), 'tested');
});
