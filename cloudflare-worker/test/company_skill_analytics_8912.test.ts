/**
 * D8912 (#8912) — a company administrator's read of their own company's skill analytics
 * (`GET /api/teams/skills/analytics?company=<uid>`, `routes/team_skill_analytics.ts`).
 *
 * What is held:
 *   - the company is the caller's own editor seat (`canEditAsMember`), never the uid alone: another company, an HQ
 *     admin with no seat and an unknown uid all read 404 `not_found`; a member without an editor seat reads 403
 *     `not_company_admin`; the primary admin is an editor whatever their role;
 *   - only that company's skills are counted and named: no HQ skill (a draft included) and no other company's uid,
 *     slug or count is in the response;
 *   - the HQ read's measures, filters, window and integer micro-USD charges apply unchanged; `scope` takes `company`;
 *   - a company with no skills reads observed zeros for counts and `{ available: false }` for measures that need a
 *     row; an unreadable run history is unavailable, never zeros; published evaluation is unavailable (#4533);
 *   - nothing is written, and #3851's proposal board is not read.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_skill_analytics_8912.test.ts
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
import { mount } from '../src/routes/team_skill_analytics.ts';
import { FILTER_MODEL_IDS, COMPANY_COVERAGE_SQL, COMPANY_LINKS_SQL, catalogueCoverage, matchesSkill, parseSkillFilters, type CoverageRow } from '../src/services/agents/skillCoverage.ts';
import { COMPANY_EXECUTIONS_SQL, COMPANY_OUTCOMES_SQL, skillExecutions, type ExecutionRow } from '../src/services/agents/skillExecutions.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, EDITOR = 10, MEMBER = 11, RIVAL = 12, PRIMARY = 13, LONER = 14;
const PATH = '/api/teams/skills/analytics';
const [M1] = FILTER_MODEL_IDS;
const UID_HQ = 'a'.repeat(32), UID_HQ_DRAFT = 'd'.repeat(32), UID_OWN = 'c'.repeat(32), UID_OWN_DRAFT = 'e'.repeat(32), UID_RIVAL = 'f'.repeat(32);
const RANGE = '&from=2026-11-01&to=2026-11-20';
const SECRETS = [UID_HQ, UID_HQ_DRAFT, UID_RIVAL, 'hq-secret-draft', 'axal-public', 'beta-private'];

function world(o: { teams?: boolean } = {}) {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const m of ['199_super_admin.sql', '089_skills_values_taxonomy.sql', '712_team_agents.sql', '759_agent_skills.sql',
    '202611022326_agent_skill_context_tokens.sql', '202611022055_agent_skill_moderation.sql', '202611022140_hq_skill_lifecycle.sql',
    '202611090904_skill_eval_result_identity.sql', '202611081919_skill_release_evidence.sql', '202611092030_skill_version_release_note.sql',
    '202611022313_agent_skill_runs.sql', '202611090905_skill_version_eval_identity.sql', '202611062149_skill_eval_campaigns.sql']) db.exec(sql(`migrations/${m}`));
  db.exec(sql('migrations/728_agent_engine.sql').match(/CREATE TABLE IF NOT EXISTS agent_task_runs \([\s\S]*?\n\);/)![0].replace(/REFERENCES \w+\([^)]*\)( ON DELETE CASCADE)?/g, ''));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(RIVAL, 'u-rival', 'rival@example.test', 'Rae Rival', 'founder', 102);
  user.run(PRIMARY, 'u-primary', 'primary@example.test', 'Pia Primary', 'founder', 103);
  user.run(LONER, 'u-loner', 'loner@example.test', 'Lou Loner', 'founder', 104);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-acme', 'Acme'), (2, 'co-beta', 'Beta'), (3, 'co-empty', 'Empty')`);
  const seat = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES (?, ?, ?, ?, ?)');
  seat.run('l1', 1, EDITOR, 'Owner', 0);
  seat.run('l2', 1, MEMBER, 'Member', 0);
  seat.run('l3', 2, RIVAL, 'Owner', 0);
  seat.run('l4', 1, PRIMARY, 'Member', 1);
  seat.run('l5', 3, LONER, 'Admin', 0);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  const agent = db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', ?, 'cfo', 'Carla', ?, '[]', ?, 5000000, ?)`);
  const acmeAgent = Number(agent.run('9'.repeat(32), 1, M1, EDITOR, EDITOR).lastInsertRowid);
  const betaAgent = Number(agent.run('8'.repeat(32), 2, M1, RIVAL, RIVAL).lastInsertRowid);
  const skill = db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, status, current_version, created_by)
    VALUES (?, ?, ?, ?, ?, 'A fixture.', 'brief', ?, ?, ?)`);
  const version = db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, 1, '---', 'n', 'p', '[]', '[]', 'brief', ?, ?, ?)`);
  const fin = JSON.stringify([{ slug: 'investor_reporting', level: 'proficient' }]);
  const cfo = JSON.stringify(['cfo']);
  const hq = Number(skill.run(UID_HQ, 'hq', null, 'axal-public', 'Axal', 'published', 1, SUPER).lastInsertRowid);
  version.run(hq, fin, cfo, SUPER);
  skill.run(UID_HQ_DRAFT, 'hq', null, 'hq-secret-draft', 'Secret', 'draft', 0, SUPER);
  const own = Number(skill.run(UID_OWN, 'company', 1, 'acme-runway', 'Runway', 'published', 1, EDITOR).lastInsertRowid);
  version.run(own, fin, cfo, EDITOR);
  skill.run(UID_OWN_DRAFT, 'company', 1, 'acme-draft', 'Draft', 'draft', 0, EDITOR);
  const rival = Number(skill.run(UID_RIVAL, 'company', 2, 'beta-private', 'Beta', 'published', 1, RIVAL).lastInsertRowid);
  version.run(rival, fin, cfo, RIVAL);
  const link = db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, ?, 1, ?)');
  link.run(acmeAgent, own, EDITOR);
  link.run(acmeAgent, hq, EDITOR);
  link.run(betaAgent, rival, RIVAL);

  const usage = db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, latency_ms, prompt_tokens, completion_tokens, charged_microusd, guard_for, agent_id, skill_id, skill_version, created_at)
    VALUES (?, 'agent', ?, ?, 10, 5, ?, ?, ?, ?, 1, '2026-11-10 12:00:00')`);
  const use = (who: number, agentId: number, skillId: number, charge: number | null, latency = 100, guard: number | null = null) =>
    Number(usage.run(who, M1, latency, charge, guard, agentId, skillId).lastInsertRowid);
  // Acme's skill: a run charged 1000 with a guard row charged 200, and a run whose charge is not recorded.
  const r1 = use(EDITOR, acmeAgent, own, 1000, 100); use(EDITOR, acmeAgent, own, 200, 0, r1);
  use(EDITOR, acmeAgent, own, null, 300);
  // Not Acme's skills: the HQ skill run by Acme's agent, and Beta's skill (three runs, so a leak would show as a count).
  use(EDITOR, acmeAgent, hq, 5000);
  for (let i = 0; i < 3; i++) use(RIVAL, betaAgent, rival, 7000);
  const marked = (agentId: number, kind: string, detail: object) =>
    db.prepare(`INSERT INTO team_agent_events (agent_id, actor_user_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?, '2026-11-12 09:00:00')`)
      .run(agentId, EDITOR, kind, JSON.stringify(detail));
  marked(acmeAgent, 'run', { outcome_v: 1, skill: { uid: UID_OWN, version: 1 } });
  marked(acmeAgent, 'refused', { code: 'skill_not_ready', status: 422, outcome_v: 1, skill: { uid: UID_OWN, version: 1 } });
  marked(acmeAgent, 'refused', { code: 'skill_not_ready', status: 422, outcome_v: 1, skill: { uid: UID_HQ, version: 1 } });
  marked(betaAgent, 'refused', { code: 'model_throttled', status: 503, outcome_v: 1, skill: { uid: UID_RIVAL, version: 1 } });
  const env: any = { DB, JWT_SECRET: 'd8912-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: o.teams === false ? 'false' : 'true' };
  return { db, env };
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
async function get(w: W, query: string, who: number) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`${PATH}${query}`, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
const leaks = (text: string) => SECRETS.filter((s) => text.includes(s));

test('D8912: an editor reads their own company\'s coverage and executions, and nothing of HQ\'s or another company\'s', async () => {
  const w = world();
  const r = await get(w, `?company=co-acme${RANGE}`, EDITOR);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.company, { uid: 'co-acme', name: 'Acme' });
  // Mutation checked: dropping `s.company_id = ?` from COMPANY_COVERAGE_SQL counts Beta's published skill (2 published).
  assert.deepEqual(r.body.coverage.by_scope, { company: { draft: 1, published: 1, retired: 0, review_requested: 0 } }, 'no HQ key, no HQ draft');
  assert.deepEqual(r.body.coverage.by_role.find((x: any) => x.role === 'cfo'), { role: 'cfo', published: 1 });
  // Only Acme's own pin counts: its pin of the HQ skill and Beta's pin are not this company's skills.
  assert.deepEqual([r.body.coverage.adoption.links, r.body.coverage.adoption.agents], [1, 1]);
  assert.equal(r.body.coverage.sources.available, false);
  assert.equal(r.body.coverage.drafts.without_current_evaluation.available, false);
  const e = r.body.executions;
  // Mutation checked: dropping the company narrowing in COMPANY_EXECUTIONS_SQL counts Beta's three runs.
  assert.equal(e.totals.completed, 2);
  assert.deepEqual(e.totals.charge, { microusd: 1200, runs_recorded: 1, runs_unrecorded: 1, runs_incomplete: 0 }, 'integer micro-USD, the guard row included');
  assert.equal(e.totals.cost_per_completed_microusd, 1200);
  assert.deepEqual(e.by_scope, { company: { completed: 2 } });
  assert.deepEqual(e.skills.map((s: any) => s.skill_uid), [UID_OWN]);
  assert.deepEqual(e.window, { since: '2026-11-01 00:00:00', until: '2026-11-21 00:00:00', days: 20, source: 'filter' });
  assert.deepEqual(e.totals.model_latency_ms, { p50: 100, p95: 300, runs_measured: 2 });
  // Mutation checked: dropping `s.company_id = ?` from COMPANY_OUTCOMES_SQL joins Beta's refusal (failed 1).
  assert.deepEqual([e.outcomes.totals.completed, e.outcomes.totals.refused, e.outcomes.totals.failed], [1, 1, 0]);
  assert.equal(e.workflows.available, false, 'workflows wait on #4535');
  assert.equal(r.body.published_evaluation.available, false);
  assert.match(r.body.published_evaluation.reason, /#4533/);
  assert.deepEqual(leaks(r.text), [], 'no HQ or other company identity in the response');
});

test('D8912: the company comes from the caller\'s editor seat, never the uid alone', async () => {
  const w = world();
  const code = async (q: string, who: number) => { const r = await get(w, q, who); return [r.status, r.body?.error]; };
  // Mutation checked: answering the not-a-seat case with 403 instead of 404 fails the three cross-company lines.
  assert.deepEqual(await code('?company=co-beta', EDITOR), [404, 'not_found'], 'another company is not confirmed');
  assert.deepEqual(await code('?company=co-acme', RIVAL), [404, 'not_found']);
  assert.deepEqual(await code('?company=co-acme', SUPER), [404, 'not_found'], 'an HQ admin with no seat reads HQ\'s own route');
  assert.deepEqual(await code('?company=co-nope', EDITOR), [404, 'not_found']);
  // Mutation checked: replacing canEditAsMember with a membership check lets the member in (200).
  assert.deepEqual(await code('?company=co-acme', MEMBER), [403, 'not_company_admin']);
  const unfiltered = await get(w, '?company=co-acme', PRIMARY);
  assert.equal(unfiltered.status, 200, 'the primary admin is an editor whatever their role');
  // Unfiltered, so these are the company read's own reasons, not a filter's.
  assert.match(unfiltered.body.coverage.sources.reason, /Axal's files/);
  assert.match(unfiltered.body.coverage.drafts.without_current_evaluation.reason, /#4533/);
  assert.deepEqual(await code('', EDITOR), [400, 'company_required']);
  assert.deepEqual(await code('?company=co-acme&company=co-beta', EDITOR), [400, 'company_required']);
  const off = world({ teams: false });
  assert.equal((await get(off, '?company=co-acme', EDITOR)).body.error, 'team_agents_off');
});

test('D8912: a company with no skills reads observed zeros, and unavailable where a measure needs a row', async () => {
  const w = world();
  const r = await get(w, `?company=co-empty${RANGE}`, LONER);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.coverage.by_scope, { company: { draft: 0, published: 0, retired: 0, review_requested: 0 } });
  assert.deepEqual(r.body.coverage.adoption, { links: 0, agents: 0, pinned_behind_current: 0, published_without_links: 0 });
  const e = r.body.executions;
  assert.equal(e.available, true);
  assert.equal(e.totals.completed, 0, 'an observed zero is 0');
  assert.deepEqual(e.by_scope, { company: { completed: 0 } });
  assert.deepEqual(e.skills, []);
  assert.equal(e.totals.cost_per_completed_microusd.available, false, 'no run: no cost per run, never 0');
  assert.equal(e.totals.model_latency_ms.available, false);
  assert.equal(e.outcomes.available, false);
  assert.deepEqual(leaks(r.text), []);
});

test('D8912: an unreadable run history is unavailable, never zeros', async () => {
  const w = world();
  w.db.exec('DROP TABLE agent_task_runs');
  const r = await get(w, `?company=co-acme${RANGE}`, EDITOR);
  assert.equal(r.status, 200, 'coverage still answers');
  assert.equal(r.body.executions.available, false);
  assert.ok(!('totals' in r.body.executions));
});

test('D8912: the HQ read\'s filters apply; `scope` takes `company`, and a filter matching nothing gives zeros, not the unfiltered figures', async () => {
  const w = world();
  const bad = await get(w, `?company=co-acme&scope=hq`, EDITOR);
  assert.deepEqual([bad.status, bad.body.error], [400, 'scope_not_served']);
  assert.deepEqual((await get(w, `?company=co-acme&role=nope`, EDITOR)).body.error, 'role_unknown');
  assert.deepEqual((await get(w, `?company=co-acme&from=2026-11-01`, EDITOR)).body.error, 'window_incomplete');
  const cfo = await get(w, `?company=co-acme&scope=company&role=cfo${RANGE}`, EDITOR);
  assert.equal(cfo.status, 200, cfo.text);
  assert.deepEqual(cfo.body.coverage.by_scope.company, { draft: 0, published: 1, retired: 0, review_requested: 0 });
  assert.equal(cfo.body.executions.totals.completed, 2);
  assert.deepEqual(cfo.body.filters.applied, { scope: 'company', role: 'cfo', from: '2026-11-01', to: '2026-11-20' });
  assert.ok(!('skills' in cfo.body.filters), 'this read serves no skill list');
  // Mutation checked: ignoring the filter in the company read serves the unfiltered 2 runs here.
  const cto = await get(w, `?company=co-acme&role=cto${RANGE}`, EDITOR);
  assert.deepEqual(cto.body.coverage.by_scope.company, { draft: 0, published: 0, retired: 0, review_requested: 0 });
  assert.equal(cto.body.executions.totals.completed, 0);
  assert.equal(cto.body.executions.outcomes.available, false);
  const other = await get(w, `?company=co-acme&uid=${UID_RIVAL}${RANGE}`, EDITOR);
  assert.equal(other.body.executions.totals.completed, 0, 'another company\'s uid matches nothing');
  assert.deepEqual(leaks(other.text.replace(new RegExp(UID_RIVAL, 'g'), '')), []);
});

test('D8912: the pure measures detail the subject only; an HQ row in a company read is dropped, never counted', () => {
  const row = (o: Partial<CoverageRow>): CoverageRow => ({
    scope: 'company', status: 'published', slug: 'own', uid: UID_OWN, current_version: 1,
    published_roles_json: '["cfo"]', published_tags_json: '[{"slug":"investor_reporting","level":"working"}]',
    live_cases: 0, draft_roles: 1, draft_tags: 1, review_requested: 0, ...o,
  });
  const category = new Map([['investor_reporting', 'finance_ops']]);
  const c = catalogueCoverage([row({}), row({ scope: 'hq', uid: UID_HQ, slug: 'axal-public' })], {
    subject: 'company', category, roleKeys: ['cfo'], librarySlugs: [], draftsWithoutCurrentEvaluation: null,
    adoption: { links: 0, agents: 0, behind_current: 0, published_without_links: 0 },
  });
  // Mutation checked: detailing `r.scope !== 'hq'` again (the HQ default) counts the HQ row for cfo, not the company's.
  assert.deepEqual(c.by_role, [{ role: 'cfo', published: 1 }]);
  assert.deepEqual(Object.keys(c.by_scope), ['company']);
  const p = parseSkillFilters({ role: ['cfo'] }, { categories: [], tags: new Set(), roleKeys: ['cfo'], modelIds: [], scope: 'company' });
  assert.ok(p.ok && p.filters);
  const f = (p as any).filters;
  assert.equal(matchesSkill(row({}), f, category, 'company'), true);
  assert.equal(matchesSkill(row({ scope: 'hq' }), f, category, 'company'), false);
  assert.equal(matchesSkill(row({}), f, category), false, 'the HQ read still never matches a company skill');
  const ex = (o: Partial<ExecutionRow>): ExecutionRow => ({
    skill_id: 1, scope: 'company', status: 'published', current_version: 1, uid: UID_OWN, published_roles_json: '["cfo"]', published_tags_json: null,
    version: 1, model: M1, role_key: 'cfo', scheduled: 0, completed: 2, tokens: 30, charge_recorded: 2, charge_unrecorded: 0, charge_incomplete: 0, charge_microusd: 500, ...o,
  });
  const window = { since: '2026-11-01 00:00:00', until: '2026-11-21 00:00:00', days: 20, source: 'filter' as const };
  const e = skillExecutions([ex({}), ex({ scope: 'hq', uid: UID_HQ, completed: 9 })], [], { filters: null, category, window, published: [], subject: 'company' });
  // Mutation checked: dropping the subject check (`r.scope !== subject`) counts the HQ row and makes this 11.
  assert.deepEqual(e.by_scope, { company: { completed: 2 } });
  assert.deepEqual(e.skills.map((s) => s.skill_uid), [UID_OWN]);
  // An outcome row of another scope is never this company's rate.
  const hqOutcome = { skill_id: 2, uid: UID_HQ, status: 'published', current_version: 1, scope: 'hq' as const, published_roles_json: null, published_tags_json: null,
    kind: 'run' as const, code: null, http_status: null, version: 1, n: 4, first_at: '2026-11-12 09:00:00' };
  const o = skillExecutions([], [], { filters: null, category, window, published: [], subject: 'company', outcomes: [hqOutcome] });
  assert.equal((o.outcomes as any).available, false);
});

test('D8912: every company read is narrowed to the company in SQL and names no proposal table', () => {
  for (const text of [COMPANY_COVERAGE_SQL, COMPANY_LINKS_SQL, COMPANY_EXECUTIONS_SQL, COMPANY_OUTCOMES_SQL]) {
    assert.match(text, /s(cope = 'company' AND company_id = \?|\.scope = 'company' AND s\.company_id = \?)/);
    assert.doesNotMatch(text, /ai_rail_proposals|proposal|acceptance/i);
  }
  const route = readFileSync(new URL('../src/routes/team_skill_analytics.ts', import.meta.url), 'utf8');
  assert.match(route, /canEditAsMember\(/);
  assert.doesNotMatch(route, /INSERT |UPDATE |logAdminAction|from '[^']*\/evaluation'/, 'a read writes nothing and reads no proposal board');
});
