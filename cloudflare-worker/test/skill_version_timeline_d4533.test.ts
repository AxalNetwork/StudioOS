// D4533 part 5 (#4533, the owner's E = b; S20's field list on #4533) — one skill's version timeline,
// merged on read from the rows that already record it. GET /api/admin/ai-agents/skills/:uid answers it as `timeline`.
//
//   1. The order: newest first; in one second the effect above its cause (publish above the approval it spent,
//      a retirement or restore above the review it withdrew); then the newer source row; an unreadable time last.
//   2. Each kind carries its fields: publish (version, release note), review (decision, reviewer, decision time,
//      the reviewer's comment only), draft_restore (source version, reason), retirement (reason, replacement).
//      A version is named only where a row proves it, else null. No email, no discarded draft text, no evidence.
//   3. A restore, a publish and a retirement made through the real routes read back as written.
//   4. Super Admin only, like every HQ skill read; a company skill is not HQ's (404).
//   5. At most 200 rows (`truncated`); an unreadable audit log leaves restores out and says so.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_version_timeline_d4533.test.ts
//
// Every time below is a fixed string written into the fixture (D5614). No production skill is touched.
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
import { TIMELINE_MAX, orderTimeline } from '../src/services/agents/skillLifecycle.ts';
import { passHqGate } from './_hq_skill_gate.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, ADMIN = 2, SUPER2 = 3, EDITOR = 10;
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
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
  user.run(SUPER2, 'u-super2', 'super2@example.test', 'Rex Reviewer', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  for (const id of [SUPER, SUPER2]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')`);
  db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l1', ?, 1, 'Founder')").run(EDITOR);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  const env: any = { DB, JWT_SECRET: 'd4533-timeline-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
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
const idOf = (w: W, uid: string) => (w.db.prepare('SELECT id FROM agent_skills WHERE uid = ?').get(uid) as any).id as number;
const timeline = async (w: W, uid: string, who = SUPER) => {
  const r = await call(w, who, 'GET', `${HQ}/${uid}`);
  assert.equal(r.status, 200, r.text);
  return r.body.timeline;
};

// Synthetic rows on the real schema.
function version(w: W, skillId: number, v: number, at: string, opts: { by?: number; note?: string | null; reviewId?: number } = {}) {
  const manifest = opts.reviewId == null ? null
    : JSON.stringify({ manifest: 1, review: { review_id: opts.reviewId, requested_by: SUPER, reviewer_id: SUPER2, decided_at: at } });
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json,
      published_by, published_at, evidence_json, release_note) VALUES (?, ?, 'md', 'n', 'p', '[]', '[]', 'draft', '[]', '[]', ?, ?, ?, ?)`)
    .run(skillId, v, opts.by ?? SUPER, at, manifest, opts.note ?? null);
}
function review(w: W, skillId: number, status: string, requestedAt: string, decidedAt: string | null, comment: string | null = null) {
  const r = w.db.prepare(`INSERT INTO agent_skill_reviews (skill_id, draft_hash, requested_by, reviewer_id, status, comment, requested_at, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(skillId, 'a'.repeat(64), SUPER, SUPER2, status, comment, requestedAt, decidedAt);
  return Number(r.lastInsertRowid);
}
function restoreAudit(w: W, uid: string, at: string, filters: Record<string, unknown>) {
  w.db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, filters_json, exported_at) VALUES (?, 'agent_skill_restore_proposed', ?, ?)`)
    .run(SUPER, JSON.stringify({ skill_uid: uid, ...filters }), at);
}

test('D4533 part 5: orderTimeline is newest first; one second follows the cause; then the newer row; an unreadable time last', () => {
  const T1 = '2026-10-01 09:00:00', T2 = '2026-10-02 09:00:00';
  const rows = [
    { sort_at: T1, seq: 5, kind: 'review' as const },
    { sort_at: null, seq: 9, kind: 'publish' as const },
    { sort_at: T1, seq: 2, kind: 'publish' as const },
    { sort_at: T2, seq: 1, kind: 'review' as const },
    { sort_at: T1, seq: 7, kind: 'draft_restore' as const },
    { sort_at: T1, seq: 0, kind: 'retirement' as const },
    { sort_at: T1, seq: 6, kind: 'review' as const },
    { sort_at: T1, seq: 3, kind: 'publish' as const },
  ];
  assert.deepEqual(orderTimeline(rows).map((r) => `${r.kind}:${r.seq}`),
    ['review:1', 'retirement:0', 'publish:3', 'publish:2', 'draft_restore:7', 'review:6', 'review:5', 'publish:9']);
  // The input is not reordered in place.
  assert.equal(rows[0].seq, 5);
});

test('D4533 part 5: GET /:uid answers one merged timeline from the existing rows, each kind with its fields', async () => {
  const w = world();
  const uid = await newSkill(w);
  const other = await newSkill(w, SUPER, { name: 'Draft the board pack' });
  const id = idOf(w, uid);
  // Reviews: changes asked; approved and released as v1 (same second as v1); withdrawn (same second as a restore,
  // with a comment nobody intended for HQ); approved but released by no version; and one still open.
  const asked = review(w, id, 'changes_requested', '2026-09-30 10:00:00', '2026-09-30 12:00:00', 'Name the source of each metric.');
  const released = review(w, id, 'approved', '2026-09-30 13:00:00', '2026-10-01 09:00:00', 'Looks right.');
  const withdrawn = review(w, id, 'withdrawn', '2026-10-01 11:00:00', '2026-10-02 10:00:00', 'A note that was never sent.');
  const unreleased = review(w, id, 'approved', '2026-10-02 11:00:00', '2026-10-02 12:00:00');
  review(w, id, 'requested', '2026-10-03 09:00:00', null);
  version(w, id, 1, '2026-10-01 09:00:00', { note: 'First release.', reviewId: released });
  version(w, id, 2, '2026-10-03 08:00:00'); // published before D4533: no manifest, no note
  restoreAudit(w, uid, '2026-10-02 10:00:00', { reason: 'v2 dropped the highlights; back to v1.', from_version: 1, current_version: 1, next_version: 2,
    before: { definition_hash: 'b'.repeat(64), discarded_draft: { name: 'An unpublished draft text' } }, after: { restored_from: 1 } });
  restoreAudit(w, other, '2026-10-02 10:30:00', { reason: 'Another skill entirely.', from_version: 1 });
  const replacement = await newSkill(w, SUPER, { name: 'Draft the quarterly investor letter' });
  w.db.prepare(`INSERT INTO agent_skill_retirements (skill_id, replacement_skill_id, reason, pinned_agents, retired_by, retired_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, idOf(w, replacement), 'Replaced by the quarterly letter skill.', 2, SUPER, '2026-10-04 07:00:00');

  const t = await timeline(w, uid);
  assert.deepEqual(t.unreadable, []);
  assert.equal(t.truncated, false);
  assert.deepEqual(t.rows.map((r: any) => [r.id, r.kind, r.at, r.version]), [
    ['retirement', 'retirement', '2026-10-04 07:00:00', null],
    ['publish:v2', 'publish', '2026-10-03 08:00:00', 2],
    [`review:${unreleased}`, 'review', '2026-10-02 12:00:00', null],
    [`draft_restore:${t.rows[3].id.split(':')[1]}`, 'draft_restore', '2026-10-02 10:00:00', null],
    [`review:${withdrawn}`, 'review', '2026-10-02 10:00:00', null],
    ['publish:v1', 'publish', '2026-10-01 09:00:00', 1],
    [`review:${released}`, 'review', '2026-10-01 09:00:00', 1],
    [`review:${asked}`, 'review', '2026-09-30 12:00:00', null],
  ]);
  const by = Object.fromEntries(t.rows.map((r: any) => [r.id, r]));
  const sue = { uid: 'u-super', name: 'Sue Super' }, rex = { uid: 'u-super2', name: 'Rex Reviewer' };
  assert.deepEqual(by['publish:v1'], { id: 'publish:v1', kind: 'publish', at: '2026-10-01 09:00:00', actor: sue, version: 1, release_note: 'First release.' });
  assert.equal(by['publish:v2'].release_note, null);
  assert.deepEqual(by[`review:${released}`], {
    id: `review:${released}`, kind: 'review', at: '2026-10-01 09:00:00', actor: rex, version: 1, decision: 'approved', reviewer: rex, requested_by: sue,
    requested_at: '2026-09-30 13:00:00', decided_at: '2026-10-01 09:00:00', comment: 'Looks right.',
  });
  assert.deepEqual([by[`review:${asked}`].decision, by[`review:${asked}`].comment, by[`review:${asked}`].actor], ['changes_requested', 'Name the source of each metric.', rex]);
  // A withdrawal is nobody's decision on the row, and carries no comment.
  assert.deepEqual([by[`review:${withdrawn}`].decision, by[`review:${withdrawn}`].actor, by[`review:${withdrawn}`].reviewer, by[`review:${withdrawn}`].comment],
    ['withdrawn', null, rex, null]);
  const restore = t.rows[3];
  assert.deepEqual(restore, { id: restore.id, kind: 'draft_restore', at: '2026-10-02 10:00:00', actor: sue, version: null, source_version: 1,
    reason: 'v2 dropped the highlights; back to v1.', discarded_draft: true });
  assert.match(restore.id, /^draft_restore:\d+$/);
  assert.deepEqual(by.retirement, { id: 'retirement', kind: 'retirement', at: '2026-10-04 07:00:00', actor: sue, version: null,
    reason: 'Replaced by the quarterly letter skill.', replacement: { uid: replacement, name: 'Draft the quarterly investor letter' }, pinned_agents: 2 });
  const text = JSON.stringify(t);
  for (const leak of ['@example.test', 'An unpublished draft text', 'A note that was never sent.', 'Another skill entirely.', 'evidence']) {
    assert.ok(!text.includes(leak), `the timeline must not carry ${leak}`);
  }
  // The row identities are stable: a second read answers the same ids in the same order.
  assert.deepEqual((await timeline(w, uid)).rows.map((r: any) => r.id), t.rows.map((r: any) => r.id));
  // The other skill reads only its own restore.
  assert.deepEqual((await timeline(w, other)).rows.map((r: any) => [r.kind, r.reason]), [['draft_restore', 'Another skill entirely.']]);
});

test('D4533 part 5: what the real routes write reads back: publishes, their approvals, a restore and a retirement', async () => {
  const w = world();
  const uid = await newSkill(w);
  await passHqGate(w.db, uid, SUPER2, SUPER);
  assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`, { release_note: 'The first version.' })).status, 200);
  assert.equal((await call(w, SUPER, 'PATCH', `/api/teams/skills/${uid}`, { steps: ['Read the recorded metrics', 'Write the highlights', 'List the asks'] })).status, 200);
  await passHqGate(w.db, uid, SUPER2, SUPER);
  assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`)).status, 200);
  const restored = await call(w, SUPER, 'POST', `${HQ}/${uid}/restore`, { from_version: 1, reason: 'v2 asks for too much; back to v1.' });
  assert.equal(restored.status, 200, restored.text);
  const replacement = await newSkill(w, SUPER, { name: 'Draft the quarterly investor letter' });
  await passHqGate(w.db, replacement, SUPER2, SUPER);
  assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${replacement}/publish`)).status, 200);
  const retired = await call(w, SUPER, 'POST', `${HQ}/${uid}/retire`, { replacement_uid: replacement, reason: 'Replaced by the quarterly letter skill.' });
  assert.equal(retired.status, 200, retired.text);

  // The routes stamp the real time, so this checks the rows, not their order (test 1 holds the order).
  const t = await timeline(w, uid);
  const kinds = t.rows.map((r: any) => `${r.kind}:${r.version}`).sort();
  assert.deepEqual(kinds, ['draft_restore:null', 'publish:1', 'publish:2', 'retirement:null', 'review:1', 'review:2']);
  const restore = t.rows.find((r: any) => r.kind === 'draft_restore');
  assert.deepEqual([restore.source_version, restore.reason, restore.discarded_draft, restore.actor], [1, 'v2 asks for too much; back to v1.', false, { uid: 'u-super', name: 'Sue Super' }]);
  assert.deepEqual(t.rows.filter((r: any) => r.kind === 'publish').map((r: any) => [r.version, r.release_note]).sort(), [[1, 'The first version.'], [2, null]]);
  const retirement = t.rows.find((r: any) => r.kind === 'retirement');
  assert.deepEqual([retirement.reason, retirement.replacement.uid, retirement.pinned_agents], ['Replaced by the quarterly letter skill.', replacement, 0]);
  assert.ok(t.rows.filter((r: any) => r.kind === 'review').every((r: any) => r.decision === 'approved' && r.reviewer.uid === 'u-super2'));
});

test('D4533 part 5: the timeline is Super Admin only, and a company skill is not HQ\'s', async () => {
  const w = world();
  const uid = await newSkill(w);
  version(w, idOf(w, uid), 1, '2026-10-01 09:00:00', { note: 'Kept from other admins.' });
  for (const who of [ADMIN, EDITOR]) {
    const r = await call(w, who, 'GET', `${HQ}/${uid}`);
    assert.equal(r.status, 403, r.text);
    assert.ok(!r.text.includes('Kept from other admins.'));
  }
  const co = await newSkill(w, EDITOR, { scope: 'company', company: 'co-uid-1', name: 'Acme brief' });
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/${co}`)).status, 404);
  assert.equal((await timeline(w, uid)).rows.length, 1);
});

test('D4533 part 5: at most 200 rows, newest first; an unreadable audit log leaves restores out and says so', async () => {
  const w = world();
  const uid = await newSkill(w);
  const id = idOf(w, uid);
  for (let v = 1; v <= TIMELINE_MAX + 5; v += 1) {
    version(w, id, v, `2026-10-01 ${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`);
  }
  restoreAudit(w, uid, '2026-09-01 09:00:00', { reason: 'An old restore, past the cap.', from_version: 1 });
  const t = await timeline(w, uid);
  assert.equal(t.rows.length, TIMELINE_MAX);
  assert.equal(t.truncated, true);
  assert.equal(t.rows[0].id, `publish:v${TIMELINE_MAX + 5}`);
  assert.equal(t.rows.at(-1).id, 'publish:v6');

  // One source alone one past the cap still reads as cut: each source reads one more row than it shows.
  const w1 = world();
  const uid1 = await newSkill(w1);
  for (let v = 1; v <= TIMELINE_MAX + 1; v += 1) {
    version(w1, idOf(w1, uid1), v, `2026-10-01 ${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`);
  }
  const t1 = await timeline(w1, uid1);
  assert.deepEqual([t1.rows.length, t1.truncated, t1.rows.at(-1).id], [TIMELINE_MAX, true, 'publish:v2']);

  const w2 = world();
  const uid2 = await newSkill(w2);
  version(w2, idOf(w2, uid2), 1, '2026-10-01 09:00:00');
  restoreAudit(w2, uid2, '2026-10-02 09:00:00', { reason: 'A restore whose record cannot be read.', from_version: 1 });
  assert.deepEqual((await timeline(w2, uid2)).rows.map((r: any) => r.kind), ['draft_restore', 'publish']);
  w2.db.exec('ALTER TABLE admin_audit_log RENAME TO admin_audit_log_gone');
  const t2 = await timeline(w2, uid2);
  assert.deepEqual(t2.unreadable, ['draft_restore']);
  assert.deepEqual(t2.rows.map((r: any) => r.id), ['publish:v1']);
  assert.equal(t2.truncated, false);
});

// Mutation checked: 20 of 20 caught. Each was applied by a script, this file run, and the source restored.
//   - orderTimeline: the same-second rank dropped → tests 1, 2; the source-row tie-break reversed → test 1;
//     an unreadable time sorted first → test 1; oldest first → tests 1, 2, 5.
//   - an approval's version never proven (always null) → tests 2, 3.
//   - a withdrawal's actor read as the reviewer → test 2; a withdrawal's comment shown → test 2.
//   - open requests listed → test 2; restores not filtered to the skill → test 2; `discarded_draft` always false → test 2.
//   - `unreadable` never reported → test 5; `truncated` always false → test 5; no cap → test 5;
//     each source reading only TIMELINE_MAX rows (one source one past the cap read as whole) → test 5.
//   - the release note, the replacement or the source version dropped → tests 2, 3; a person's email read as the name → tests 2, 3.
//   - `timeline` not answered by GET /:uid → tests 2–5; GET /:uid without `requireSuperAdmin` → test 4.
