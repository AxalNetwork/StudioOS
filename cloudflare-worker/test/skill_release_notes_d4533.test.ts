// D4533 (#4533, B1 of the owner's decisions, 2026-11-09) — a release note on a skill version.
//
//   1. A publish may carry `release_note`; it is trimmed, kept on the version row, and read back
//      by HQ's GET /:uid and the team's GET /skills/:uid as `versions[].release_note`.
//   2. No note (absent, null, blank) is NULL, never an empty string, and reads null ("Not recorded").
//   3. A note that is not text, or longer than 2000 characters, is refused before anything is
//      written: no version row, no pointer move, even ahead of the HQ gate.
//   4. The note is as immutable as its row (759's trigger), and the column's CHECK refuses a blank
//      or over-long note written around the route.
//   5. A company version takes a note too; a bulk publish writes none.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_release_notes_d4533.test.ts
//
// No production skill is published, retired or re-pinned: everything runs on the node:sqlite D1 fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, addColumnsFrom, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamSkills from '../src/routes/team_skills.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { RELEASE_NOTE_MAX, releaseNoteOf } from '../src/services/agents/skillPublish.ts';
import { passHqGate } from './_hq_skill_gate.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, SUPER2 = 3, EDITOR = 10;
const HQ = '/api/admin/ai-agents/skills';

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const m of ['199_super_admin', '089_skills_values_taxonomy', '712_team_agents', '759_agent_skills', '202611022326_agent_skill_context_tokens',
    '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle', '202611081919_skill_release_evidence',
    '202611090904_skill_eval_result_identity', '202611092030_skill_version_release_note']) db.exec(sql(`migrations/${m}.sql`));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(SUPER2, 'u-super2', 'super2@example.test', 'Rex Reviewer', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  for (const id of [SUPER, SUPER2]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')`);
  db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l1', ?, 1, 'Founder')").run(EDITOR);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  const env: any = { DB, JWT_SECRET: 'd4533-notes-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamSkills);
  a.route(mount.path, mount.router);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: r.status, body: parsed, text };
}

const draft = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
  steps: ['Read the recorded metrics', 'Write the highlights'], tools: ['stripe.read'], output_kind: 'draft', roles: ['cfo'],
  tags: [{ slug: 'investor_reporting', level: 'proficient' }], ...over,
});
async function newSkill(w: W, who = SUPER, over: Record<string, unknown> = {}) {
  const r = await call(w, who, 'POST', '/api/teams/skills', draft(over));
  assert.equal(r.status, 201, r.text);
  return r.body.skill.uid as string;
}
const row = (w: W, uid: string) => w.db.prepare('SELECT * FROM agent_skills WHERE uid = ?').get(uid) as any;
const notes = (w: W, uid: string) => (w.db.prepare('SELECT v.version, v.release_note FROM agent_skill_versions v JOIN agent_skills s ON s.id = v.skill_id WHERE s.uid = ? ORDER BY v.version').all(uid) as any[])
  .map((v) => [v.version, v.release_note]);
const publish = (w: W, uid: string, body?: unknown, who = SUPER) => call(w, who, 'POST', `/api/teams/skills/${uid}/publish`, body);

test('D4533 B1: releaseNoteOf trims, keeps no blank note, and refuses non-text and over-long notes', () => {
  assert.deepEqual(releaseNoteOf(undefined), { ok: true, note: null });
  assert.deepEqual(releaseNoteOf(null), { ok: true, note: null });
  assert.deepEqual(releaseNoteOf('   \n '), { ok: true, note: null });
  assert.deepEqual(releaseNoteOf('  Line one\r\nLine two  '), { ok: true, note: 'Line one\nLine two' });
  assert.equal((releaseNoteOf('x'.repeat(RELEASE_NOTE_MAX)) as any).note.length, RELEASE_NOTE_MAX);
  assert.equal((releaseNoteOf(`  ${'x'.repeat(RELEASE_NOTE_MAX)}  `) as any).ok, true, 'the limit is on the trimmed note');
  assert.equal((releaseNoteOf('x'.repeat(RELEASE_NOTE_MAX + 1)) as any).code, 'release_note_too_long');
  for (const bad of [42, true, ['a'], { text: 'a' }]) assert.equal((releaseNoteOf(bad) as any).code, 'release_note_invalid', JSON.stringify(bad));
});

test('D4533 B1: an HQ version keeps its release note; both reads answer it; the next version without one reads null', async () => {
  const w = world();
  const uid = await newSkill(w);
  await passHqGate(w.db, uid, SUPER2, SUPER);
  const r1 = await publish(w, uid, { release_note: '  First release: reads the recorded metrics.\r\nNo forecasts.  ' });
  assert.equal(r1.status, 200, r1.text);
  assert.deepEqual(notes(w, uid), [[1, 'First release: reads the recorded metrics.\nNo forecasts.']]);

  // v2, published with a blank note: NULL, never ''.
  assert.equal((await call(w, SUPER, 'PATCH', `/api/teams/skills/${uid}`, { steps: ['Read the recorded metrics', 'Write the highlights', 'List the asks'] })).status, 200);
  await passHqGate(w.db, uid, SUPER2, SUPER);
  assert.equal((await publish(w, uid, { release_note: '   ' })).status, 200);
  // v3, published with no body at all.
  assert.equal((await call(w, SUPER, 'PATCH', `/api/teams/skills/${uid}`, { purpose: 'From recorded metrics, a short draft update for investors.' })).status, 200);
  await passHqGate(w.db, uid, SUPER2, SUPER);
  assert.equal((await publish(w, uid)).status, 200);
  assert.deepEqual(notes(w, uid), [[1, 'First release: reads the recorded metrics.\nNo forecasts.'], [2, null], [3, null]]);

  const hq = await call(w, SUPER, 'GET', `${HQ}/${uid}`);
  assert.equal(hq.status, 200, hq.text);
  assert.deepEqual(hq.body.versions.map((v: any) => [v.version, v.release_note]), [[3, null], [2, null], [1, 'First release: reads the recorded metrics.\nNo forecasts.']]);
  const team = await call(w, SUPER, 'GET', `/api/teams/skills/${uid}`);
  assert.equal(team.status, 200, team.text);
  assert.deepEqual(team.body.versions.map((v: any) => [v.version, v.release_note]), [[3, null], [2, null], [1, 'First release: reads the recorded metrics.\nNo forecasts.']]);

  // The publish audit row records the note it was published with.
  const audit = (w.db.prepare("SELECT details FROM activity_logs WHERE action = 'agent_skill_published' ORDER BY id").all() as any[]).map((a) => JSON.parse(a.details));
  assert.deepEqual(audit.map((a) => a.release_note), ['First release: reads the recorded metrics.\nNo forecasts.', null, null]);
});

test('D4533 B1: a bad note is refused before anything is written, ahead of the HQ gate', async () => {
  const w = world();
  const ready = await newSkill(w);
  await passHqGate(w.db, ready, SUPER2, SUPER);
  const long = await publish(w, ready, { release_note: 'x'.repeat(RELEASE_NOTE_MAX + 1) });
  assert.equal(long.status, 400, long.text);
  assert.equal(long.body.code ?? long.body.error, 'release_note_too_long');
  const typed = await publish(w, ready, { release_note: 7 });
  assert.equal(typed.status, 400, typed.text);
  assert.equal(typed.body.code ?? typed.body.error, 'release_note_invalid');
  assert.deepEqual(notes(w, ready), [], 'no version row');
  assert.deepEqual([row(w, ready).current_version, row(w, ready).status], [0, 'draft'], 'no pointer move');
  // The same draft then publishes, so the refusal spent nothing.
  assert.equal((await publish(w, ready, { release_note: 'The first version.' })).status, 200);

  // A draft with no approval: the note's refusal answers first, and the gate's after it.
  const unready = await newSkill(w, SUPER, { name: 'Draft the board pack' });
  const first = await publish(w, unready, { release_note: 'x'.repeat(RELEASE_NOTE_MAX + 1) });
  assert.equal(first.body.code ?? first.body.error, 'release_note_too_long');
  const gate = await publish(w, unready, { release_note: 'Fine.' });
  assert.equal(gate.status, 409, gate.text);
  assert.equal(gate.body.code ?? gate.body.error, 'needs_approval');
  assert.deepEqual(notes(w, unready), []);
});

test('D4533 B1: the note is as immutable as its row, and the column refuses a blank or over-long note', async () => {
  const w = world();
  const uid = await newSkill(w);
  await passHqGate(w.db, uid, SUPER2, SUPER);
  assert.equal((await publish(w, uid, { release_note: 'As written.' })).status, 200);
  const id = row(w, uid).id;
  assert.throws(() => w.db.prepare("UPDATE agent_skill_versions SET release_note = 'Rewritten.' WHERE skill_id = ?").run(id), /immutable/);
  assert.throws(() => w.db.prepare('UPDATE agent_skill_versions SET release_note = NULL WHERE skill_id = ?').run(id), /immutable/);
  assert.deepEqual(notes(w, uid), [[1, 'As written.']]);
  const insert = (version: number, note: string | null) => w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by, release_note)
    VALUES (?, ?, 'md', 'n', 'p', '[]', '[]', 'draft', '[]', '[]', ?, ?)`).run(id, version, SUPER, note);
  assert.throws(() => insert(10, ''), /CHECK/);
  assert.throws(() => insert(11, '   '), /CHECK/);
  assert.throws(() => insert(12, 'x'.repeat(RELEASE_NOTE_MAX + 1)), /CHECK/);
  insert(13, null); // a version written without a note (as every version before 202611092030) is NULL
  const hq = await call(w, SUPER, 'GET', `${HQ}/${uid}`);
  assert.deepEqual(hq.body.versions.map((v: any) => [v.version, v.release_note]), [[13, null], [1, 'As written.']]);
});

test('D4533 B1: a company version takes a note too; a bulk publish writes none', async () => {
  const w = world();
  const co = await newSkill(w, EDITOR, { scope: 'company', company: 'co-uid-1', name: 'Acme brief' });
  const r = await publish(w, co, { release_note: 'Acme’s first brief.' }, EDITOR);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.freshness, null, 'no HQ decision for a company skill');
  assert.deepEqual(notes(w, co), [[1, 'Acme’s first brief.']]);
  const read = await call(w, EDITOR, 'GET', `/api/teams/skills/${co}`);
  assert.deepEqual(read.body.versions.map((v: any) => v.release_note), ['Acme’s first brief.']);
  const audit = w.db.prepare("SELECT details FROM activity_logs WHERE action = 'company_skill_published'").get() as any;
  assert.equal(JSON.parse(audit.details).release_note, 'Acme’s first brief.');

  const hq = await newSkill(w);
  await passHqGate(w.db, hq, SUPER2, SUPER);
  const bulk = await call(w, SUPER, 'POST', `${HQ}/bulk`, { action: 'publish', uids: [hq], reason: 'The quarterly release of Axal skills.', release_note: 'Ignored: a bulk publish takes no note.' });
  assert.equal(bulk.status, 200, bulk.text);
  assert.equal(bulk.body.results[0].ok, true, bulk.text);
  assert.deepEqual(notes(w, hq), [[1, null]]);
});

// Mutation checked: 9 of 9 caught. Each was applied by a script, this file run, and the source restored.
//   - skillPublish.ts: the INSERT binds null for `release_note` → tests 2, 4 and 5.
//   - skillPublish.ts: `note || null` → `note` (a blank note stored as '') → tests 1 and 2.
//   - skillPublish.ts: the length check removed → tests 1 and 3.
//   - skillPublish.ts: the type check removed (`String(raw)`) → tests 1 and 3.
//   - skillPublish.ts: `release_note` dropped from the publish audit row → tests 2 and 5.
//   - team_skills.ts: the note's refusal moved after `publishDraft` → test 3.
//   - team_skills.ts: `release_note` read as null in GET /skills/:uid → tests 2 and 5.
//   - admin_hq_skills.ts: `release_note` read as null in GET /:uid → tests 2 and 4.
//   - the migration's CHECK removed → test 4.
