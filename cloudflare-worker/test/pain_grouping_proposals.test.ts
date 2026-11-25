/**
 * D8546 (#8546, part of #6006): Problem discovery's grouping proposals on the Worker. A set of phrases from one
 * venture, said in several interviews, is stored pending, read with each member's source, edited, discarded, or
 * accepted as one unit through the same alias write as the manual assign-many. A pending set changes no theme.
 * The real migrated schema in memory, the mounted router, real tokens.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/pain_grouping_proposals.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { DatabaseSync } from 'node:sqlite';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import grouping from '../src/routes/pain_grouping_proposals.ts';
import progress, { MAX_BULK_ASSIGN } from '../src/routes/progress.ts';
import {
  MAX_GROUPING_MEMBERS, MAX_GROUPING_SOURCES, acceptGroupingProposal, listGroupingProposals, proposeGrouping,
} from '../src/services/painGroupingProposals.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { openSchema } from './_schema_once.mjs';

const KEY = ['fixture', 'key', 'for', 'd8546', 'tests'].join('-');
const roles: Record<number, string> = { 10: 'founder', 20: 'founder', 30: 'admin', 40: 'partner', 50: 'investor' };

/** Venture 1 (founder 10): themes 11 and 12; interviews 1 (no consent), 2 and 3 (consent). Venture 2 (founder 20): interview 9, theme 22. */
function seeded(): DatabaseSync {
  const db = openSchema();
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  for (const [id, role, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [30, 'admin', null], [40, 'partner', null], [50, 'investor', null]] as const) {
    u.run(id, role, `User ${id}`, `user${id}@example.test`, founder);
  }
  db.exec(`
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Project One', 1001), (2, 'Project Two', 1002);
    INSERT INTO pain_groups (id, project_id, title, sort_order) VALUES (11, 1, 'Slow dispatch', 0), (12, 1, 'Paper forms', 1), (22, 2, 'Theirs', 0);
    INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES
      (1, 12, 'paper forms everywhere', 'Paper forms everywhere'), (2, 22, 'theirs', 'Theirs');
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json, quote_consent) VALUES
      (1, 1, 'Iris Example', '["Dispatch is slow", "We wait on dispatch", "Secret pricing pain"]', 0),
      (2, 1, 'Jon Example', '["Dispatch is slow", "Paper forms everywhere", "Calls get lost"]', 1),
      (3, 1, 'Kim Example', '["we wait on dispatch", "Calls get lost"]', 1),
      (9, 2, 'Other Example', '["Their own pain"]', 1);
  `);
  return db;
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const app = new Hono<any>();
  app.route('/api/progress/pain-grouping-proposals', grouping);
  app.route('/api/progress', progress);
  app.onError((error: Error, c) => c.json({ detail: error.message }, error.message === 'Forbidden' ? 403 : 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/progress${path}`, { method, headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const env = (db: DatabaseSync) => ({ DB: d1Over(db) }) as any;
const P = '/pain-grouping-proposals';
const aliases = (db: DatabaseSync, projectId = 1) => db.prepare(
  'SELECT group_id, phrase_norm, display_phrase FROM pain_group_aliases WHERE project_id = ? ORDER BY phrase_norm').all(projectId) as any[];
const activity = (db: DatabaseSync) => db.prepare("SELECT action, details, actor, entity_id FROM activity_logs WHERE entity_type = 'validate.problem-discovery' ORDER BY id").all() as any[];
const groups = (db: DatabaseSync) => db.prepare('SELECT id, title FROM pain_groups WHERE project_id = 1 ORDER BY id').all() as any[];

/** "Dispatch is slow" (interviews 1 and 2), "We wait on dispatch" (1 and 3), "Calls get lost" (2): three phrases, three interviews. */
const SPAN = [
  { phrase: 'Dispatch is slow', interview_id: 1 }, { phrase: 'dispatch is slow', interview_id: 2 },
  { phrase: 'We wait on dispatch', interview_id: 1 }, { phrase: 'we wait on dispatch', interview_id: 3 },
  { phrase: 'Calls get lost', interview_id: 2 },
];
const propose = (db: DatabaseSync, over: Record<string, unknown> = {}) => proposeGrouping(env(db), {
  projectId: 1, userId: 10, members: SPAN, target: { group_id: 11 }, ...over,
} as any);

test('a set spanning two interviews is stored with each member\'s sources, and a pending set changes no theme', async () => {
  const db = seeded();
  const before = { groups: groups(db), aliases: aliases(db), activity: activity(db) };
  const r = await propose(db);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.proposal.status, 'pending');
  assert.equal(r.proposal.target_group_id, 11);
  assert.equal(r.proposal.target_title, 'Slow dispatch');
  assert.deepEqual(r.proposal.members.map((m) => [m.phrase, m.sources.map((s) => s.interview_id)]), [
    ['Dispatch is slow', [1, 2]], ['We wait on dispatch', [1, 3]], ['Calls get lost', [2]],
  ]);
  assert.deepEqual({ groups: groups(db), aliases: aliases(db), activity: activity(db) }, before, 'a pending proposal writes no theme, alias or activity');

  const read = await call(db, 10, 'GET', `${P}/1`);
  assert.equal(read.status, 200);
  assert.equal(read.body.proposals.length, 1);
  const first = read.body.proposals[0].members[0];
  assert.deepEqual(first.sources, [
    { interview_id: 1, interviewee: 'Iris Example', quote_consent: false },
    { interview_id: 2, interviewee: 'Jon Example', quote_consent: true },
  ], 'each source says who and whether that interview agreed to be quoted');
});

test('the same ingress key answers the proposal it already stored', async () => {
  const db = seeded();
  const a = await propose(db, { sourceKey: 'producer:run-1' });
  const b = await propose(db, { sourceKey: 'producer:run-1' });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal(b.proposal.id, a.proposal.id);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pain_grouping_proposals').get() as any).n, 1);
});

test('an edit changes the title and the members under the same checks, and the original stays as proposed', async () => {
  const db = seeded();
  const r = await propose(db, { target: { new_title: 'Dispatch trouble' } });
  assert.ok(r.ok);
  if (!r.ok) return;
  const id = r.proposal.id;
  const edit = await call(db, 10, 'PATCH', `${P}/1/${id}`, { title: '  Dispatch and calls  ', members: [{ phrase: 'Calls get lost', interview_id: 3 }, { phrase: 'Dispatch is slow', interview_id: 1 }] });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.proposal.edited, true);
  assert.equal(edit.body.proposal.target_title, 'Dispatch and calls');
  assert.deepEqual(edit.body.proposal.members.map((m: any) => m.phrase), ['Calls get lost', 'Dispatch is slow']);
  assert.equal(edit.body.proposal.original.target_title, 'Dispatch trouble');
  assert.deepEqual(edit.body.proposal.original.members.map((m: any) => m.phrase), ['Dispatch is slow', 'We wait on dispatch', 'Calls get lost']);
  const row = db.prepare('SELECT target_title, members_json, edited_title FROM pain_grouping_proposals WHERE id = ?').get(id) as any;
  assert.equal(row.target_title, 'Dispatch trouble', 'the stored original is untouched');
  assert.equal(row.edited_title, 'Dispatch and calls');
  assert.ok(row.members_json.includes('We wait on dispatch'));

  const bad = await call(db, 10, 'PATCH', `${P}/1/${id}`, { members: [{ phrase: 'Not said by anyone', interview_id: 1 }] });
  assert.equal(bad.status, 404);
  assert.equal(bad.body.error, 'member_not_found');
  const none = await call(db, 10, 'PATCH', `${P}/1/${id}`, {});
  assert.equal(none.body.error, 'nothing_to_edit');
  const existing = await propose(db);
  assert.ok(existing.ok);
  if (!existing.ok) return;
  const retitle = await call(db, 10, 'PATCH', `${P}/1/${existing.proposal.id}`, { title: 'Renamed' });
  assert.equal(retitle.body.error, 'title_not_editable', 'a set going to an existing theme has no title of its own');
});

test('discard changes the proposal\'s status only, and a decided proposal is not decided again', async () => {
  const db = seeded();
  const r = await propose(db);
  assert.ok(r.ok);
  if (!r.ok) return;
  const before = { groups: groups(db), aliases: aliases(db), activity: activity(db) };
  const d = await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/discard`);
  assert.equal(d.status, 200);
  assert.equal(d.body.proposal.status, 'discarded');
  assert.deepEqual({ groups: groups(db), aliases: aliases(db), activity: activity(db) }, before);
  assert.equal((await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`)).body.error, 'already_decided');
  assert.equal((await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/discard`)).body.error, 'already_decided');
  assert.equal((await call(db, 10, 'PATCH', `${P}/1/${r.proposal.id}`, { title: 'x' })).body.error, 'already_decided');
  assert.equal((await call(db, 10, 'GET', `${P}/1`)).body.proposals.length, 0, 'a discarded proposal leaves the pending list');
  assert.equal((await call(db, 10, 'GET', `${P}/1?status=all`)).body.proposals.length, 1);
});

test('accepting lands the whole set in the existing theme through the manual assign-many\'s write: the same aliases and the same activity row', async () => {
  const db = seeded();
  const r = await propose(db);
  assert.ok(r.ok);
  if (!r.ok) return;
  const a = await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`);
  assert.equal(a.status, 200);
  assert.equal(a.body.assigned, 3);
  assert.equal(a.body.group_id, 11);
  assert.equal(a.body.proposal.status, 'accepted');

  // The manual route, on a second database, with the same phrases and the same theme.
  const manual = seeded();
  const m = await call(manual, 10, 'POST', '/pain-groups/1/assign-many', { phrases: ['Dispatch is slow', 'We wait on dispatch', 'Calls get lost'], group_id: 11 });
  assert.equal(m.status, 200);
  assert.deepEqual(aliases(db), aliases(manual), 'the same alias rows as the manual route writes');
  assert.deepEqual(activity(db).map(({ action, details, entity_id }) => ({ action, details, entity_id })),
    activity(manual).map(({ action, details, entity_id }) => ({ action, details, entity_id })), 'the same one activity row');
  assert.equal(activity(db).length, 1);
  assert.equal(activity(db)[0].actor, 'user:10');
});

test('accepting a proposed new theme makes it once, after the existing themes, and moves every member into it', async () => {
  const db = seeded();
  const r = await propose(db, { target: { new_title: 'Dispatch trouble' } });
  assert.ok(r.ok);
  if (!r.ok) return;
  const a = await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`);
  assert.equal(a.status, 200);
  const made = groups(db).filter((g) => g.title === 'Dispatch trouble');
  assert.equal(made.length, 1);
  assert.equal(a.body.group_id, made[0].id);
  const row = db.prepare('SELECT sort_order, created_by FROM pain_groups WHERE id = ?').get(made[0].id) as any;
  assert.deepEqual({ sort: Number(row.sort_order), by: Number(row.created_by) }, { sort: 2, by: 10 });
  assert.deepEqual(aliases(db).filter((x) => x.group_id === made[0].id).map((x) => x.phrase_norm), ['calls get lost', 'dispatch is slow', 'we wait on dispatch']);
  assert.deepEqual(activity(db).map((x) => [x.action, x.details, x.entity_id]), [['pain_group_created', 'Dispatch trouble created with 3 quotes', String(made[0].id)]]);

  // The same on an accepted edit: the edited title and members are what land.
  const db2 = seeded();
  const r2 = await propose(db2, { target: { new_title: 'Original title' } });
  assert.ok(r2.ok);
  if (!r2.ok) return;
  await call(db2, 10, 'PATCH', `${P}/1/${r2.proposal.id}`, { title: 'Edited title', members: [{ phrase: 'Calls get lost', interview_id: 2 }] });
  const a2 = await call(db2, 10, 'POST', `${P}/1/${r2.proposal.id}/accept`);
  assert.equal(a2.status, 200);
  assert.deepEqual(groups(db2).map((g) => g.title), ['Slow dispatch', 'Paper forms', 'Edited title']);
  assert.deepEqual(aliases(db2).map((x) => x.phrase_norm), ['calls get lost', 'paper forms everywhere']);
});

test('a member is refused when its interview or phrase is not this venture\'s, the target is missing or another venture\'s, or the set is empty or too large', async () => {
  const db = seeded();
  const refused = async (over: Record<string, unknown>, status: number, code: string) => {
    const r = await propose(db, over);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual([r.status, r.code], [status, code]);
  };
  await refused({ members: [{ phrase: 'Their own pain', interview_id: 9 }] }, 404, 'source_not_found');
  await refused({ members: [{ phrase: 'Dispatch is slow', interview_id: 404 }] }, 404, 'source_not_found');
  await refused({ members: [{ phrase: 'Calls get lost', interview_id: 1 }] }, 404, 'member_not_found');
  await refused({ members: [] }, 400, 'members_required');
  await refused({ members: 'x' }, 400, 'members_required');
  await refused({ members: [{ phrase: '   ', interview_id: 1 }] }, 400, 'invalid_phrase');
  await refused({ members: [{ phrase: 'Dispatch is slow', interview_id: '1' }] }, 400, 'invalid_source');
  await refused({ target: { group_id: 22 } }, 404, 'theme_not_found');
  await refused({ target: { group_id: 404 } }, 404, 'theme_not_found');
  await refused({ target: {} }, 400, 'target_required');
  await refused({ target: { group_id: 11, new_title: 'Both' } }, 400, 'target_required');
  await refused({ target: { new_title: '   ' } }, 400, 'target_required');
  await refused({ target: { group_id: 'x' } }, 400, 'invalid_group_id');
  assert.equal(MAX_GROUPING_MEMBERS, MAX_BULK_ASSIGN, 'the manual route\'s limit');
  const many = Array.from({ length: MAX_GROUPING_MEMBERS + 1 }, (_, i) => ({ phrase: `Pain number ${i}`, interview_id: 1 }));
  await refused({ members: many }, 400, 'too_many_members');
  // D1 takes 100 bound values in a statement and the claim binds three per source interview: a set draws on at most 30.
  for (let i = 0; i <= MAX_GROUPING_SOURCES; i++) {
    db.prepare("INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json, quote_consent) VALUES (?, 1, 'Extra', '[\"Calls get lost\"]', 1)").run(100 + i);
  }
  await refused({ members: Array.from({ length: MAX_GROUPING_SOURCES + 1 }, (_, i) => ({ phrase: 'Calls get lost', interview_id: 100 + i })) }, 400, 'too_many_sources');
  const ok = await propose(db, { members: Array.from({ length: MAX_GROUPING_SOURCES }, (_, i) => ({ phrase: 'Calls get lost', interview_id: 100 + i })) });
  assert.equal(ok.ok, true, 'thirty sources are allowed');
  if (ok.ok) assert.equal((await acceptGroupingProposal(env(db), { projectId: 1, id: ok.proposal.id, userId: 10 })).ok, true, 'and a set of thirty accepts within D1\'s bound-value limit');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pain_grouping_proposals WHERE status = ?').get('pending') as any).n, 0, 'a refusal stores nothing');
});

test('only the venture\'s writers read or decide: a partner, an investor and another venture\'s founder get no payload', async () => {
  const db = seeded();
  const r = await propose(db);
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const who of [40, 50, 20]) {
    for (const [method, path, body] of [
      ['GET', `${P}/1`, undefined], ['PATCH', `${P}/1/${r.proposal.id}`, { title: 'x' }],
      ['POST', `${P}/1/${r.proposal.id}/discard`, undefined], ['POST', `${P}/1/${r.proposal.id}/accept`, undefined],
    ] as const) {
      const res = await call(db, who, method, path, body);
      assert.equal(res.status, 403, `${who} ${method} ${path}`);
      assert.equal(JSON.stringify(res.body).includes('Dispatch'), false, 'no suggestion wording in the refusal');
    }
  }
  assert.deepEqual(await listGroupingProposals(env(db), 1, { writer: false, status: 'all' }), [], 'the service gives a non-writer nothing');
  assert.equal((await call(db, 30, 'GET', `${P}/1`)).status, 200, 'an admin writes');
  assert.equal((await call(db, 10, 'GET', `${P}/2`)).status, 403, 'a founder reads no other venture\'s');
  assert.equal((await call(db, 10, 'GET', `${P}/999`)).status, 404);
  assert.equal((await call(db, 10, 'POST', `${P}/1/999/accept`)).body.error, 'proposal_not_found');
  assert.equal(db.prepare("SELECT status FROM pain_grouping_proposals WHERE id = ?").get(r.proposal.id)!.status, 'pending', 'nothing refused changed the proposal');
});

test('a stale source or target at accept writes nothing and the proposal stays pending', async () => {
  const db = seeded();
  const r = await propose(db);
  assert.ok(r.ok);
  if (!r.ok) return;
  // The interview no longer says it.
  db.prepare("UPDATE discovery_interviews SET pains_json = '[\"Dispatch is slow\"]' WHERE id = 3").run();
  const a = await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`);
  assert.deepEqual([a.status, a.body.error], [409, 'stale_source']);
  // An interview deleted.
  db.prepare('DELETE FROM discovery_interviews WHERE id = 3').run();
  assert.equal((await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`)).body.error, 'stale_source');
  // The theme deleted.
  db.prepare('DELETE FROM pain_groups WHERE id = 11').run();
  const edit = await call(db, 10, 'PATCH', `${P}/1/${r.proposal.id}`, { members: [{ phrase: 'Dispatch is slow', interview_id: 1 }] });
  assert.equal(edit.status, 200);
  assert.equal((await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`)).body.error, 'stale_target');
  assert.equal((db.prepare('SELECT status FROM pain_grouping_proposals WHERE id = ?').get(r.proposal.id) as any).status, 'pending');
  assert.deepEqual(aliases(db).map((x) => x.phrase_norm), ['paper forms everywhere'], 'no alias was written');
  assert.deepEqual(activity(db), []);
});

test('a premise that moves between the read and the claim leaves the proposal pending with nothing written', async () => {
  const moves: Record<string, string> = {
    'the theme is deleted': 'DELETE FROM pain_groups WHERE id = 11',
    'an interview\'s pains change': `UPDATE discovery_interviews SET pains_json = '["Dispatch is slow", "We wait on dispatch", "Calls get lost", "One more"]' WHERE id = 3`,
  };
  for (const [name, sql] of Object.entries(moves)) {
    const db = seeded();
    const r = await propose(db);
    assert.ok(r.ok);
    if (!r.ok) return;
    // The change lands after the accept read the venture and before its batch runs.
    const base = d1Over(db);
    const racing = { ...base, batch: async (stmts: any[]) => { db.prepare(sql).run(); return base.batch(stmts); } };
    const res = await acceptGroupingProposal({ DB: racing } as any, { projectId: 1, id: r.proposal.id, userId: 10 });
    assert.equal(res.ok, false, name);
    if (!res.ok) assert.deepEqual([res.status, res.code], [409, 'stale_grouping'], name);
    assert.equal((db.prepare('SELECT status FROM pain_grouping_proposals WHERE id = ?').get(r.proposal.id) as any).status, 'pending', name);
    assert.deepEqual(aliases(db).map((x) => x.phrase_norm), ['paper forms everywhere'], name);
    assert.deepEqual(activity(db), [], name);
  }
});

test('two accepts at once apply the set once: one wins, the other is told it was decided', async () => {
  for (const target of [{ group_id: 11 }, { new_title: 'Dispatch trouble' }]) {
    const db = seeded();
    const r = await propose(db, { target });
    assert.ok(r.ok);
    if (!r.ok) return;
    const both = await Promise.all([1, 2].map(() => call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`)));
    assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
    assert.equal(both.find((x) => x.status === 409)!.body.error, 'already_decided');
    assert.equal(activity(db).length, 1, 'one activity row');
    assert.equal(aliases(db).filter((x) => x.phrase_norm !== 'paper forms everywhere').length, 3, 'each member once');
    if ('new_title' in target) assert.equal(groups(db).filter((g) => g.title === 'Dispatch trouble').length, 1, 'one new theme');
    const again = await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`);
    assert.equal(again.body.error, 'already_decided', 'a replay writes nothing more');
    assert.equal(activity(db).length, 1);
  }
});

test('an accept that read the proposal pending before another decided it writes nothing, and overwrites nothing the winner or a later edit left', async () => {
  for (const target of [{ group_id: 11 }, { new_title: 'Dispatch trouble' }]) {
    const db = seeded();
    const r = await propose(db, { target });
    assert.ok(r.ok);
    if (!r.ok) return;
    // B decides after A read the proposal and before A's batch runs; then a person moves one phrase to another theme.
    const base = d1Over(db);
    let winner: any = null;
    const racing = { ...base, batch: async (stmts: any[]) => {
      if (!winner) {
        winner = await acceptGroupingProposal({ DB: base } as any, { projectId: 1, id: r.proposal.id, userId: 30 });
        db.prepare("UPDATE pain_group_aliases SET group_id = 12 WHERE project_id = 1 AND phrase_norm = 'calls get lost'").run();
      }
      return base.batch(stmts);
    } };
    const loser = await acceptGroupingProposal({ DB: racing } as any, { projectId: 1, id: r.proposal.id, userId: 10 });
    assert.equal(winner.ok, true);
    assert.equal(loser.ok, false);
    if (!loser.ok) assert.deepEqual([loser.status, loser.code], [409, 'already_decided']);
    assert.equal(activity(db).length, 1, 'one activity row');
    assert.equal(activity(db)[0].actor, 'user:30', 'the winner\'s');
    assert.equal(aliases(db).find((x) => x.phrase_norm === 'calls get lost')!.group_id, 12, 'the loser did not move it back');
    if ('new_title' in target) assert.equal(groups(db).filter((g) => g.title === 'Dispatch trouble').length, 1, 'one new theme');
    assert.equal((db.prepare('SELECT decided_by FROM pain_grouping_proposals WHERE id = ?').get(r.proposal.id) as any).decided_by, 30);
  }
});

test('a write that fails part way leaves the proposal pending, no theme made and no member assigned', async () => {
  for (const target of [{ group_id: 11 }, { new_title: 'Dispatch trouble' }]) {
    const db = seeded();
    // The third member's alias write fails.
    db.exec(`CREATE TRIGGER fail_third BEFORE INSERT ON pain_group_aliases WHEN NEW.phrase_norm = 'calls get lost'
             BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    const r = await propose(db, { target });
    assert.ok(r.ok);
    if (!r.ok) return;
    const a = await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`);
    assert.deepEqual([a.status, a.body.error], [503, 'accept_failed']);
    assert.equal(JSON.stringify(a.body).includes('disk full'), false, 'the raw error is not sent');
    const row = db.prepare('SELECT status, decision_token, accepted_group_id FROM pain_grouping_proposals WHERE id = ?').get(r.proposal.id) as any;
    assert.deepEqual([row.status, row.decision_token, row.accepted_group_id], ['pending', null, null]);
    assert.deepEqual(aliases(db).map((x) => x.phrase_norm), ['paper forms everywhere']);
    assert.deepEqual(groups(db).map((g) => g.title), ['Slow dispatch', 'Paper forms']);
    assert.deepEqual(activity(db), []);
    db.exec('DROP TRIGGER fail_third');
    assert.equal((await call(db, 10, 'POST', `${P}/1/${r.proposal.id}/accept`)).status, 200, 'and a retry then lands');
  }
});

test('quote consent: each source says whether its interview agreed to be quoted, and a non-writer is given no wording at all', async () => {
  const db = seeded();
  const r = await propose(db, { members: [{ phrase: 'Secret pricing pain', interview_id: 1 }, { phrase: 'Calls get lost', interview_id: 2 }] });
  assert.ok(r.ok);
  if (!r.ok) return;
  const read = await call(db, 10, 'GET', `${P}/1`);
  const [secret, calls] = read.body.proposals[0].members;
  assert.deepEqual(secret.sources, [{ interview_id: 1, interviewee: 'Iris Example', quote_consent: false }]);
  assert.deepEqual(calls.sources, [{ interview_id: 2, interviewee: 'Jon Example', quote_consent: true }]);
  // After accepting, the theme's phrases reach a reader only under the existing consent rule, which is the view's, not this file's.
  assert.equal((await call(db, 40, 'GET', `${P}/1`)).body?.proposals, undefined);
  assert.equal(JSON.stringify((await call(db, 50, 'GET', `${P}/1`)).body).includes('Secret'), false);
});
