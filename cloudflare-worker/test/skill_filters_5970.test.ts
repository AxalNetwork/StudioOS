/**
 * D5970 (#5970, part of D4536) — validated filters on the HQ library read's `coverage` and `published_evaluation`.
 *
 * What is held:
 *   - an unknown filter name, category, tag, role, status, scope or model, a malformed uid or version, a repeated
 *     filter, and a date range that is incomplete, malformed, reversed or over FILTER_WINDOW_MAX_DAYS are each a 400
 *     with its code; none falls back to "all";
 *   - the window is the `from` day's 00:00:00 inclusive to the day after `to` exclusive (UTC), applied before the
 *     latest row per unit is chosen; a row exactly at each bound is tested;
 *   - a filter that matches nothing gives observed zeros for counts and `{ available: false }` for measures that need a
 *     row, never the unfiltered figures;
 *   - the response's `filters` names what was applied and which block each one narrowed;
 *   - the number of reads is the same with and without filters, whatever the catalogue's size;
 *   - a read with no filter has no `filters` key and the same blocks as before.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_filters_5970.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { EVALUATOR } from '../src/services/agents/skillLifecycle.ts';
import { CATALOGUE } from '../src/services/ai/catalogue.ts';
import { MODEL_CONNECTIONS } from '../src/services/ai/moduleConnections.ts';
import { FILTER_WINDOW_MAX_DAYS, adoptionOf, matchesSkill, parseSkillFilters } from '../src/services/agents/skillCoverage.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, ADMIN = 2, EDITOR = 10;
const HQ = '/api/admin/ai-agents/skills';
const [M1, M2] = CATALOGUE.filter((m) => MODEL_CONNECTIONS[m.id]?.operation === 'chat').map((m) => m.id);
const SHA = 'c'.repeat(64);
const UID_A = 'a'.repeat(32), UID_B = 'b'.repeat(32), UID_D = 'd'.repeat(32), UID_R = 'e'.repeat(32), UID_NONE = 'f'.repeat(32);

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const m of ['199_super_admin.sql', '089_skills_values_taxonomy.sql', '712_team_agents.sql', '759_agent_skills.sql',
    '202611022326_agent_skill_context_tokens.sql', '202611022055_agent_skill_moderation.sql', '202611022140_hq_skill_lifecycle.sql',
    '202611090904_skill_eval_result_identity.sql', '202611081919_skill_release_evidence.sql', '202611092030_skill_version_release_note.sql',
    '202611022313_agent_skill_runs.sql', '202611090905_skill_version_eval_identity.sql', '202611062149_skill_eval_campaigns.sql']) db.exec(sql(`migrations/${m}`));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')`);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting'), ('eng_frontend', 'engineering', 'Frontend')`);
  db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', 1, 'cfo', 'Carla', ?, '[]', ${EDITOR}, 5000000, ${EDITOR})`).run('9'.repeat(32), M1);

  const skill = db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, status, current_version, created_by)
    VALUES (?, ?, ?, ?, ?, 'A fixture.', 'brief', ?, ?, ${SUPER})`);
  const version = db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by, evidence_json)
    VALUES (?, ?, '---', 'n', 'p', '[]', '[]', 'brief', ?, ?, ${SUPER}, ?)`);
  const manifest = JSON.stringify({ models: { required: [M1, M2] } });
  const fin = JSON.stringify([{ slug: 'investor_reporting', level: 'proficient' }]);
  const eng = JSON.stringify([{ slug: 'eng_frontend', level: 'working' }]);
  // A: published at v2 for cfo, tagged finance; pinned by one agent.
  const a = Number(skill.run(UID_A, 'hq', null, 'fixture-a', 'A', 'published', 2).lastInsertRowid);
  version.run(a, 1, fin, JSON.stringify(['cfo']), manifest);
  version.run(a, 2, fin, JSON.stringify(['cfo']), manifest);
  // B: published at v1 for cto, tagged engineering; nobody pins it.
  const b = Number(skill.run(UID_B, 'hq', null, 'fixture-b', 'B', 'published', 1).lastInsertRowid);
  version.run(b, 1, eng, JSON.stringify(['cto']), manifest);
  // D: a draft never published. R: retired. And a company skill.
  skill.run(UID_D, 'hq', null, 'fixture-d', 'D', 'draft', 0);
  const r = Number(skill.run(UID_R, 'hq', null, 'fixture-r', 'R', 'retired', 1).lastInsertRowid);
  version.run(r, 1, fin, JSON.stringify(['cfo']), manifest);
  skill.run('c'.repeat(32), 'company', 1, 'acme-private', 'Acme', 'published', 0);
  db.prepare(`INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (1, ?, 1, ${EDITOR})`).run(a);
  db.prepare(`INSERT INTO agent_skill_eval_campaigns (uid, models_json, status, started_by, started_at, finished_at) VALUES (?, ?, 'complete', ${SUPER}, '2026-11-03 08:00:00', '2026-11-03 10:00:00')`)
    .run('8'.repeat(32), JSON.stringify([M1]));

  const evalRow = db.prepare(`INSERT INTO agent_skill_version_evals (skill_id, version, case_key, case_name, model_id, result, run_by, run_at, evaluator_version, case_sha256)
    VALUES (?, ?, ?, 'Case', ?, ?, ${SUPER}, ?, ?, ?)`);
  const run = (skillId: number, v: number, key: string, model: string, result: string, at: string) => evalRow.run(skillId, v, key, model, result, at, EVALUATOR.version, SHA);
  const env: any = { DB, JWT_SECRET: 'd5970-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env, ids: { a, b, r }, run };
}
type W = ReturnType<typeof world>;

function app() {
  const h = new Hono();
  h.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  h.route(mount.path, mount.router);
  return h;
}
async function get(w: W, path: string, who = SUPER) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
const ok = async (w: W, query: string) => {
  const r = await get(w, `${HQ}${query}`);
  assert.equal(r.status, 200, r.text);
  return r.body;
};
const CTX = { categories: ['finance_ops', 'engineering'], tags: new Set(['investor_reporting']), roleKeys: ['cfo', 'cto'], modelIds: ['m-1'], allowed: ['page'] };
const q = (o: Record<string, string | string[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));

// ── The parser ───────────────────────────────────────────────────────────────

test('D5970: each bad filter is refused with its own code; none is read as "all"', () => {
  const cases: Array<[Record<string, string | string[]>, string]> = [
    [{ categry: 'finance_ops' }, 'filter_unknown'],
    [{ role: ['cfo', 'cto'] }, 'filter_repeated'],
    [{ scope: 'company' }, 'scope_not_served'],
    [{ status: 'live' }, 'status_unknown'],
    [{ uid: 'A'.repeat(32) }, 'uid_malformed'],
    [{ uid: 'a'.repeat(31) }, 'uid_malformed'],
    [{ version: '0' }, 'version_malformed'],
    [{ version: '1.5' }, 'version_malformed'],
    [{ category: 'cooking' }, 'category_unknown'],
    [{ tag: 'eng_frontend' }, 'tag_unknown'],
    [{ role: 'chef' }, 'role_unknown'],
    [{ role: '' }, 'role_unknown'],
    [{ model: 'm-2' }, 'model_unknown'],
    [{ from: '2026-11-01' }, 'window_incomplete'],
    [{ to: '2026-11-01' }, 'window_incomplete'],
    [{ from: '2026-02-30', to: '2026-03-01' }, 'window_malformed'],
    [{ from: '2026-11-01T00:00:00', to: '2026-11-02' }, 'window_malformed'],
    [{ from: '2026-11-02', to: '2026-11-01' }, 'window_reversed'],
  ];
  for (const [query, code] of cases) {
    const r = parseSkillFilters(q(query), CTX);
    assert.equal(r.ok, false, JSON.stringify(query));
    assert.equal((r as any).code, code, JSON.stringify(query));
    assert.match((r as any).message, /^[A-Z].*\.$/, 'a sentence, never a raw error');
  }
});

test('D5970: the window is at most FILTER_WINDOW_MAX_DAYS days, both ends counted; its bounds are the days\' midnights (UTC)', () => {
  assert.equal(FILTER_WINDOW_MAX_DAYS, 366);
  // 2026-01-01 .. 2027-01-01 is 366 days; 2025-12-31 .. 2027-01-01 (367) is refused.
  // Mutation checked: `days > MAX` → `days >= MAX` refuses the 366-day window and this fails.
  const longest = parseSkillFilters(q({ from: '2026-01-01', to: '2027-01-01' }), CTX);
  assert.ok(longest.ok && longest.filters);
  assert.deepEqual(longest.filters!.window, { from: '2026-01-01', to: '2027-01-01', days: 366, since: '2026-01-01 00:00:00', until: '2027-01-02 00:00:00' });
  assert.equal((parseSkillFilters(q({ from: '2025-12-31', to: '2027-01-01' }), CTX) as any).code, 'window_too_long');
  const one = parseSkillFilters(q({ from: '2026-12-31', to: '2026-12-31' }), CTX);
  assert.ok(one.ok);
  assert.deepEqual([one.filters!.window!.days, one.filters!.window!.since, one.filters!.window!.until], [1, '2026-12-31 00:00:00', '2027-01-01 00:00:00']);
});

test('D5970: no filter is null, `page` is not a filter, and every value is kept as given', () => {
  const none = parseSkillFilters(q({ page: '2' }), CTX);
  assert.deepEqual(none, { ok: true, filters: null });
  const all = parseSkillFilters(q({ scope: 'hq', status: 'published', uid: UID_A, version: '2', category: 'finance_ops', tag: 'investor_reporting', role: 'cfo', model: 'm-1' }), CTX);
  assert.ok(all.ok);
  assert.deepEqual({ ...all.filters, window: undefined }, { scope: 'hq', status: 'published', uid: UID_A, version: 2, category: 'finance_ops', tag: 'investor_reporting', role: 'cfo', model: 'm-1', window: undefined });
});

test('D5970: a skill matches on its current published version; a company skill never matches', () => {
  const f = (o: object) => ({ scope: null, status: null, uid: null, version: null, category: null, tag: null, role: null, model: null, window: null, ...o });
  const cat = new Map([['investor_reporting', 'finance_ops']]);
  const s = { scope: 'hq' as const, status: 'published', uid: UID_A, current_version: 2, published_roles_json: '["cfo"]', published_tags_json: '[{"slug":"investor_reporting"}]' };
  assert.equal(matchesSkill(s, f({ role: 'cfo', category: 'finance_ops', tag: 'investor_reporting', version: 2, uid: UID_A, status: 'published' }), cat), true);
  assert.equal(matchesSkill(s, f({ role: 'cto' }), cat), false);
  assert.equal(matchesSkill(s, f({ category: 'engineering' }), cat), false);
  assert.equal(matchesSkill(s, f({ version: 1 }), cat), false);
  assert.equal(matchesSkill({ ...s, scope: 'company' }, f({}), cat), false);
  // Mutation checked: dropping the `current_version < 1` guard matches a never-published skill's leftover roles.
  assert.equal(matchesSkill({ ...s, current_version: 0 }, f({ role: 'cfo' }), cat), false);
  const rows: any[] = [{ scope: 'hq', status: 'published', uid: UID_A }, { scope: 'hq', status: 'published', uid: UID_B }];
  assert.deepEqual(adoptionOf([{ uid: UID_A, links: 2, agent_ids: '7,8', behind_current: 1 }, { uid: UID_R, links: 5, agent_ids: '9', behind_current: 5 }], rows),
    { links: 2, agents: 2, behind_current: 1, published_without_links: 1 }, 'pins of a skill outside the rows are not counted');
});

// ── The route ────────────────────────────────────────────────────────────────

test('D5970: the route refuses each bad filter with a 400 and its code, and stays Super Admin only', async () => {
  const w = world();
  for (const [query, code] of [
    ['?categry=x', 'filter_unknown'], ['?scope=company', 'scope_not_served'], ['?category=cooking', 'category_unknown'],
    ['?tag=not_a_tag', 'tag_unknown'], ['?role=chef', 'role_unknown'], ['?status=live', 'status_unknown'], ['?model=not-a-model', 'model_unknown'],
    ['?uid=s-a', 'uid_malformed'], ['?version=v2', 'version_malformed'], ['?from=2025-12-31&to=2027-01-01', 'window_too_long'],
  ]) {
    const r = await get(w, `${HQ}${query}`);
    assert.equal(r.status, 400, query);
    assert.equal(r.body.error, code, query);
    assert.equal(r.body.coverage, undefined, 'nothing is served on a refusal');
  }
  assert.equal((await get(w, `${HQ}?role=cfo`, ADMIN)).status, 403);
});

test('D5970: an unfiltered read is the read it was: no `filters`, the whole catalogue, the campaign', async () => {
  const w = world();
  const r = await ok(w, '');
  assert.deepEqual(Object.keys(r).sort(), ['coverage', 'executions', 'next_page', 'pass_bar', 'published_evaluation', 'skills']);
  assert.deepEqual(r.coverage.by_scope, { hq: { draft: 1, published: 2, retired: 1, review_requested: 0 }, company: { draft: 0, published: 1, retired: 0, review_requested: 0 } });
  assert.deepEqual(r.coverage.adoption, { links: 1, agents: 1, pinned_behind_current: 1, published_without_links: 1 });
  assert.equal(typeof r.coverage.sources.library_files, 'number');
  assert.equal(r.published_evaluation.versions.published, 2);
  assert.equal(r.published_evaluation.campaign.status, 'complete');
  assert.equal((await ok(w, '?page=1')).filters, undefined, 'a page is not a filter');
});

test('D5970: a role filter narrows both blocks and says so; the skills list is not filtered', async () => {
  const w = world();
  const r = await ok(w, '?role=cfo');
  // Mutation checked: passing every row to catalogueCoverage (no matchesSkill) counts B and these fail.
  assert.deepEqual(r.coverage.by_scope.hq, { draft: 0, published: 1, retired: 1, review_requested: 0 });
  assert.equal(r.coverage.by_scope.company.available, false, 'a company skill\'s roles are never read, so it is not a 0');
  assert.deepEqual(r.coverage.by_role.filter((x: any) => x.published).map((x: any) => x.role), ['cfo']);
  assert.deepEqual(r.coverage.adoption, { links: 1, agents: 1, pinned_behind_current: 1, published_without_links: 0 });
  assert.equal(r.coverage.sources.available, false);
  assert.equal(r.coverage.drafts.without_current_evaluation.available, false);
  // Mutation checked: dropping the matchesSkill filter on the published versions measures B and this fails.
  assert.deepEqual(r.published_evaluation.versions, { published: 1, evaluated: 0, unevaluated: 1, unevaluated_skills: [UID_A] });
  assert.equal(r.published_evaluation.campaign.available, false, 'a campaign is the whole catalogue\'s progress');
  assert.deepEqual(r.filters.applied, { role: 'cfo' });
  assert.deepEqual(r.filters.coverage, { applied: ['role'], not_applicable: [] });
  assert.deepEqual(r.filters.published_evaluation, { applied: ['role'], not_applicable: [] });
  assert.equal(r.skills.length, 4, 'the list is every HQ row, unfiltered');

  const byCategory = await ok(w, '?category=engineering&status=published');
  assert.deepEqual(byCategory.published_evaluation.versions.unevaluated_skills, [UID_B]);
  assert.deepEqual(byCategory.coverage.adoption, { links: 0, agents: 0, pinned_behind_current: 0, published_without_links: 1 });
  assert.deepEqual((await ok(w, '?version=2')).published_evaluation.versions.unevaluated_skills, [UID_A]);
  assert.deepEqual((await ok(w, '?tag=eng_frontend')).published_evaluation.versions.unevaluated_skills, [UID_B]);
  const hqOnly = await ok(w, '?scope=hq');
  assert.deepEqual(hqOnly.coverage.by_scope.hq, { draft: 1, published: 2, retired: 1, review_requested: 0 });
  assert.equal(hqOnly.coverage.by_scope.company.available, false);
});

test('D5970: a filter that matches nothing reads observed zeros and unavailable measures, never the unfiltered figures', async () => {
  const w = world();
  w.run(w.ids.a, 2, 'k1', M1, 'pass', '2026-11-02 09:00:00');
  for (const query of [`?uid=${UID_NONE}`, '?role=cto&tag=investor_reporting', '?status=draft&model=' + encodeURIComponent(M1)]) {
    const r = await ok(w, query);
    const e = r.published_evaluation;
    assert.deepEqual(e.versions, { published: 0, evaluated: 0, unevaluated: 0, unevaluated_skills: [] }, query);
    assert.equal(e.results.available, false, query);
    assert.equal(e.freshness.available, false, query);
    assert.equal(e.regressions.since_previous_run.available, false, query);
    assert.deepEqual([e.required.units, e.required.recorded, e.required.missing], [0, 0, 0], query);
    assert.equal(r.coverage.by_scope.hq.published, 0, query);
    assert.deepEqual(r.coverage.adoption, { links: 0, agents: 0, pinned_behind_current: 0, published_without_links: 0 }, query);
  }
  assert.deepEqual((await ok(w, '?status=draft')).coverage.by_scope.hq, { draft: 1, published: 0, retired: 0, review_requested: 0 });
});

test('D5970: the window keeps a row exactly at `from` 00:00:00 and at `to` 23:59:59, drops one a second outside either, and is applied before the latest row is chosen', async () => {
  const w = world();
  const A = w.ids.a;
  w.run(A, 2, 'k-before', M1, 'fail', '2026-10-31 23:59:59');
  w.run(A, 2, 'k-start', M1, 'pass', '2026-11-01 00:00:00');
  w.run(A, 2, 'k-end', M1, 'pass', '2026-11-30 23:59:59');
  w.run(A, 2, 'k-after', M1, 'fail', '2026-12-01 00:00:00');
  // The same unit run again after the window: inside it, the pass at the start is the latest.
  w.run(A, 2, 'k-start', M1, 'fail', '2026-12-01 00:00:00');
  const r = await ok(w, '?from=2026-11-01&to=2026-11-30');
  const a = r.published_evaluation.skills.find((s: any) => s.skill_uid === UID_A);
  // Mutation checked: `>=` → `>` on `since` drops k-start; `<` → `<=` on `until` keeps k-after and the later k-start fail.
  assert.deepEqual(a.cases.map((c: any) => [c.case_key, c.result, c.run_at]), [['k-end', 'pass', '2026-11-30 23:59:59'], ['k-start', 'pass', '2026-11-01 00:00:00']]);
  assert.deepEqual(r.published_evaluation.results, { pass: 2, fail: 0, not_run: 0 });
  assert.deepEqual(r.filters.window, { since: '2026-11-01 00:00:00', until: '2026-12-01 00:00:00', days: 30, max_days: 366 });
  assert.deepEqual(r.filters.coverage, { applied: [], not_applicable: ['from', 'to'] });
  assert.deepEqual(r.filters.published_evaluation, { applied: ['from', 'to'], not_applicable: [] });
  // Unfiltered, the latest k-start is the fail after the window.
  const all = (await ok(w, '')).published_evaluation.skills.find((s: any) => s.skill_uid === UID_A);
  assert.equal(all.cases.find((c: any) => c.case_key === 'k-start').result, 'fail');
});

test('D5970: the longest window (366 days) keeps a row exactly at each bound and drops one a second outside either; 367 days is refused', async () => {
  const w = world();
  const A = w.ids.a;
  w.run(A, 2, 'k-before', M1, 'fail', '2025-12-31 23:59:59');
  w.run(A, 2, 'k-start', M1, 'pass', '2026-01-01 00:00:00');
  w.run(A, 2, 'k-end', M1, 'pass', '2027-01-01 23:59:59');
  w.run(A, 2, 'k-after', M1, 'fail', '2027-01-02 00:00:00');
  const r = await ok(w, '?from=2026-01-01&to=2027-01-01');
  const a = r.published_evaluation.skills.find((s: any) => s.skill_uid === UID_A);
  assert.deepEqual(a.cases.map((c: any) => c.case_key), ['k-end', 'k-start']);
  assert.deepEqual(r.filters.window, { since: '2026-01-01 00:00:00', until: '2027-01-02 00:00:00', days: 366, max_days: 366 });
  const refused = await get(w, `${HQ}?from=2025-12-31&to=2027-01-01`);
  assert.deepEqual([refused.status, refused.body.error], [400, 'window_too_long']);
});

test('D5970: a model filter keeps that model\'s rows and narrows the required models to it', async () => {
  const w = world();
  w.run(w.ids.a, 2, 'k1', M1, 'pass', '2026-11-02 09:00:00');
  w.run(w.ids.a, 2, 'k1', M2, 'fail', '2026-11-02 09:00:00');
  const r = await ok(w, `?model=${encodeURIComponent(M2)}&uid=${UID_A}`);
  const a = r.published_evaluation.skills[0];
  // Mutation checked: dropping the model term from the history read counts M1's pass and this fails.
  assert.deepEqual(r.published_evaluation.results, { pass: 0, fail: 1, not_run: 0 });
  assert.deepEqual(a.required.models, [M2]);
  assert.deepEqual(Object.keys(a.by_model), [M2]);
  assert.deepEqual(r.filters.coverage, { applied: ['uid'], not_applicable: ['model'] });
});

test('D5970: filters add no read: the same prepared statements with and without them, whatever the catalogue\'s size', async () => {
  const w = world();
  const db = w.env.DB;
  let seen: string[] = [];
  w.env.DB = { ...db, prepare: (query: string) => { seen.push(query); return db.prepare(query); } };
  const reads = async (query: string) => { seen = []; await ok(w, query); return seen.length; };
  const FILTERED = `?scope=hq&status=published&role=cfo&category=finance_ops&tag=investor_reporting&version=2&uid=${UID_A}&model=${encodeURIComponent(M1)}&from=2026-11-01&to=2026-11-30`;
  const plain = await reads('');
  assert.equal(await reads(FILTERED), plain, 'a filter adds no read');
  const insert = w.db.prepare(`INSERT INTO agent_skills (uid, scope, slug, name, purpose, output_kind, status, current_version, created_by)
    VALUES (?, 'hq', ?, ?, 'A fixture.', 'brief', 'published', 1, ${SUPER})`);
  for (let i = 0; i < 30; i++) insert.run(i.toString(16).padStart(32, '0'), `fixture-x${i}`, `X${i}`);
  assert.equal(await reads(FILTERED), plain, 'nor does the catalogue\'s size under a filter');
});

test('D4536: the HQ read suggests only current published HQ pairs in the filtered catalogue', async () => {
  const w = world();
  const skill = w.db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, status, current_version, created_by)
    VALUES (?, ?, ?, ?, ?, 'draft purpose', 'brief', ?, 1, ${SUPER})`);
  const version = w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, 1, '---', 'Synthetic', ?, '[]', '[]', 'brief', ?, ?, ${SUPER})`);
  const first = '1'.repeat(32), second = '2'.repeat(32);
  const purpose = 'Summarize investor reporting entries for the portfolio review.';
  for (const [uid, scope, company, status, text] of [
    [second, 'hq', null, 'published', 'Review portfolio investor reporting entries and summarize exceptions.'],
    [first, 'hq', null, 'published', purpose],
    ['3'.repeat(32), 'company', 1, 'published', purpose],
    ['4'.repeat(32), 'hq', null, 'retired', purpose],
    ['5'.repeat(32), 'hq', null, 'published', 'Describe valuation assumptions and reconcile payment receipts.'],
  ] as const) {
    const id = skill.run(uid, scope, company, 'overlap-' + uid[0], 'Synthetic', status).lastInsertRowid;
    version.run(id, text, '[{"slug":"investor_reporting","level":"proficient"}]', '["cfo"]');
  }
  const all = await ok(w, '?page=1&role=cfo');
  const overlap = all.coverage.overlap;
  assert.deepEqual({ ...overlap, suggestions: undefined }, {
    available: true, source_rows: 4, skipped_metadata: 1, compared_pairs: 3, total_suggestions: 1, suggestions: undefined,
  });
  assert.deepEqual(overlap.suggestions.map(({ score, ...pair }: { score: number }) => {
    assert.ok(score > 0.30);
    return pair;
  }), [{
    label: 'Possible overlap', left: { skill_uid: first, version: 1 }, right: { skill_uid: second, version: 1 },
    shared_roles: ['cfo'], primary_tag: 'investor_reporting', output_kind: 'brief',
  }]);
  assert.deepEqual((await ok(w, '?uid=' + first)).coverage.overlap.suggestions, []);
  assert.deepEqual((await ok(w, '?status=draft')).coverage.overlap, {
    available: true, source_rows: 0, skipped_metadata: 0, compared_pairs: 0, total_suggestions: 0, suggestions: [],
  });
  assert.deepEqual((await ok(w, '?role=cfo&from=2026-10-01&to=2026-10-02')).coverage.overlap, overlap);
  assert.equal((await get(w, HQ, ADMIN)).status, 403);

  const db = w.env.DB;
  w.env.DB = { ...db, prepare: (query: string) => {
    if (query.includes('v.purpose, v.output_kind, v.taxonomy_json, v.roles_json')) throw new Error('Fixture read failed');
    return db.prepare(query);
  } };
  const failed = await ok(w, '');
  assert.equal(failed.coverage.overlap.available, false);
  assert.ok(failed.coverage.by_scope);
  assert.equal(failed.published_evaluation.history, 'published');
});

test('D4536: overlap bounds the scan and keeps a deterministic twenty-pair sample', async () => {
  const w = world();
  const skill = w.db.prepare(`INSERT INTO agent_skills (uid, scope, slug, name, purpose, output_kind, status, current_version, created_by)
    VALUES (?, 'hq', ?, 'Synthetic', 'Draft purpose', 'brief', 'published', 1, ${SUPER})`);
  const version = w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, 1, '---', 'Synthetic', 'Summarize investor reporting entries', '[]', '[]', 'brief',
      '[{"slug":"investor_reporting","level":"proficient"}]', '["cfo"]', ${SUPER})`);
  const uid = (i: number) => i.toString(16).padStart(32, '0');
  for (let i = 7; i >= 1; i--) version.run(skill.run(uid(i), 'synthetic-' + i).lastInsertRowid);
  const capped = (await ok(w, '?role=cfo')).coverage.overlap;
  assert.equal(capped.total_suggestions, 21);
  assert.equal(capped.suggestions.length, 20);
  assert.deepEqual(capped.suggestions[0].left, { skill_uid: uid(1), version: 1 });
  assert.deepEqual(capped.suggestions[0].right, { skill_uid: uid(2), version: 1 });
  assert.equal(capped.suggestions[0].score, 1);
  for (let i = 8; i <= 249; i++) skill.run(uid(i), 'synthetic-' + i);
  assert.deepEqual((await ok(w, '?page=1')).coverage.overlap, {
    available: false, reason: 'Too many published HQ skills to compare. Narrow the catalogue filters.',
  });
  assert.deepEqual((await ok(w, '?role=cfo')).coverage.overlap, capped);
});
