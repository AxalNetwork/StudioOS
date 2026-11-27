// D8768 (#8768) — one skill-eligibility rule at every picker (`services/agents/skillEligibility.ts`).
//
//   · the six states (listed, published, eligible, attached, blocked, unreadable) and their counts;
//   · fit is a recommendation: a skill written for another role, or outside the persona's areas, is eligible and
//     sorts after the natural fit, at the drawer, at Assign to agents and in the wizard;
//   · a draft-only area is counted, never named, and says so per area on GET /skills and on the drawer;
//   · an opted-out tool blocks with the tool named; the wizard names the tools step 3 will ask for, and a sponsor
//     whose tools cannot be read gets `unreadable`, never eligible;
//   · cards carry the customer's job line (no routing clause, no planning text) and D4667's inputs, or null;
//   · a draft's page says why it cannot be attached and offers a published alternative in its area.
//
// Real SQLite with the migrations the routes read, synthetic names only. Each case names the mutations it was
// checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_eligibility_8768.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { passHqGate } from './_hq_skill_gate.ts';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamSkills from '../src/routes/team_skills.ts';
import teamAgents from '../src/routes/team_agents.ts';
import {
  ELIGIBILITY_STATES, areaEligibility, byEligibility, countEligibility, customerJob, fitOf, pickAlternative, skillInputsOf, toolsToGrant,
} from '../src/services/agents/skillEligibility.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, EDITOR = 10, MEMBER = 11, STRANGER = 12;
const IN_CO = 7;
const CFO = 'a'.repeat(32), IR = 'b'.repeat(32), PROJECT_CFO = 'c'.repeat(32);

function world(env: Record<string, unknown> = {}) {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'integrations'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/199_super_admin.sql'));
  db.exec(sql('migrations/089_skills_values_taxonomy.sql'));
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/202611021724_team_agents_persona.sql'));
  db.exec(sql('migrations/759_agent_skills.sql'));
  db.exec(sql('migrations/202611022326_agent_skill_context_tokens.sql'));
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql'));
  db.exec(sql('migrations/202611022140_hq_skill_lifecycle.sql'));
  db.exec(sql('migrations/202611090904_skill_eval_result_identity.sql'));
  db.exec(sql('migrations/202611081919_skill_release_evidence.sql'));
  db.exec(sql('migrations/202611092030_skill_version_release_note.sql'));
  db.exec(sql('migrations/202611070826_team_agent_skill_events.sql'));
  db.exec(`CREATE TABLE project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invited_by INTEGER, created_at TEXT, updated_at TEXT)`);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(2, 'u-reviewer', 'reviewer@example.test', 'Rae Reviewer', 'admin', null); // passHqGate's second Super Admin
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', '[Atlas Orchard]')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member');
  db.prepare('INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 100, ?)').run(IN_CO, 'p7', '[Pilot]', 1);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES
    ('fp_and_a', 'finance_ops', 'FP&A'), ('investor_relations', 'capital_network', 'Investor relations'),
    ('contracts', 'legal_compliance', 'Contracts'), ('product_strategy', 'product', 'Product strategy')`);
  const agent = db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, persona_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${EDITOR}, 5000000, ${EDITOR})`);
  agent.run(CFO, 'company', 1, null, 'cfo', 'tessaly', 'Tessaly', MODEL, '[]');
  agent.run(IR, 'company', 1, null, 'investor_relations', 'vesta', 'Vesta', MODEL, JSON.stringify([{ integration_uid: 'i1', tool: 'hubspot.read_contacts' }]));
  agent.run(PROJECT_CFO, 'project', null, IN_CO, 'cfo', 'kade', 'Kade', MODEL, '[]');
  return { db, env: { DB, JWT_SECRET: 'd8768-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true', ...env } as any };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamAgents);
  a.route('/api/teams', teamSkills);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}

const skill = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: '[Cash runway snapshot]', purpose: 'Reports cash on hand and runway from recorded balances and burn.',
  steps: ['Read the recorded balances', 'Write the runway'], tools: [], output_kind: 'brief', roles: ['cfo'],
  tags: [{ slug: 'fp_and_a', level: 'proficient' }], ...over,
});
async function published(w: W, body: Record<string, unknown>) {
  const made = await call(w, SUPER, 'POST', '/skills', body);
  assert.equal(made.status, 201, made.text);
  await passHqGate(w.db, made.body.skill.uid);
  const pub = await call(w, SUPER, 'POST', `/skills/${made.body.skill.uid}/publish`);
  assert.equal(pub.status, 200, pub.text);
  return made.body.skill.uid as string;
}
async function draft(w: W, body: Record<string, unknown>) {
  const made = await call(w, SUPER, 'POST', '/skills', body);
  assert.equal(made.status, 201, made.text);
  return made.body.skill.uid as string;
}
const legal = (name: string) => skill({ name, purpose: 'Summarises a contract in plain language.', roles: ['general_counsel'], tags: [{ slug: 'contracts', level: 'working' }] });
const area = (areas: any[], slug: string) => areas.find((a) => a.area === slug);

// ── The pure rule ──────────────────────────────────────────────────────────────

test('customerJob: the routing clause and planning text go; constraints and the job stay', () => {
  // Mutations checked: the "only when" guard dropped → the runway line loses its constraint; the participle kept out
  // → the marketplace line loses "keeping …"; BOILERPLATE not applied → the planning sentence stays.
  assert.equal(customerJob('Builds a rolling 13-week cash forecast from dated recorded receipts and payments when reviewing liquidity needs.'),
    'Builds a rolling 13-week cash forecast from dated recorded receipts and payments.');
  assert.equal(customerJob('Diagnoses marketplace matching when demand, supply and outcome records exist, keeping segment fit visible.'),
    'Diagnoses marketplace matching, keeping segment fit visible.');
  assert.equal(customerJob('Diagnoses observed activation losses when funnel counts are available, without inferring causes from correlation.'),
    'Diagnoses observed activation losses, without inferring causes from correlation.');
  assert.equal(customerJob('Writes the script a team member reads aloud when testing a prototype: intro, tasks and wrap-up.'),
    'Writes the script a team member reads aloud: intro, tasks and wrap-up.');
  assert.equal(customerJob('Reports cash on hand and runway from recorded balances and burn, computing runway only when both are recorded.'),
    'Reports cash on hand and runway from recorded balances and burn, computing runway only when both are recorded.');
  assert.equal(customerJob('Compares the month\'s spending against the budget. Catalogue wave 3 of the roadmap, see #4225 and D4116. Use this skill when the CFO asks.'),
    'Compares the month\'s spending against the budget.');
  assert.equal(customerJob('Drafts the board pack. Then the infrastructure team deploys it on Cloudflare D1 behind the wor…'), 'Drafts the board pack.');
  assert.equal(customerJob('Drafts the board pack from the recorded…'), 'Drafts the board pack from the recorded.');
  assert.equal(customerJob('  '), null);
  assert.equal(customerJob(null), null);
});

test('counts, fit, ordering, alternatives and inputs', () => {
  // Mutations checked: hidden drafts left out of `listed` → the listed assert fails; persona fit ignored → Tessaly's
  // capital skill is not fit; the sort putting state before fit → the order assert fails.
  assert.deepEqual([...ELIGIBILITY_STATES], ['listed', 'published', 'eligible', 'attached', 'blocked', 'unreadable']);
  assert.deepEqual(countEligibility(['eligible', 'attached', 'blocked', 'blocked', 'unreadable', 'listed'], 14),
    { listed: 20, published: 4, eligible: 1, attached: 1, blocked: 2, unreadable: 1, drafts: 15 });
  const legalArea = area(areaEligibility([{ axes: ['legal_compliance'], state: 'listed' }, { axes: ['legal_compliance', 'finance_ops'], state: 'listed' }]), 'legal_compliance');
  assert.deepEqual([legalArea.listed, legalArea.published, legalArea.drafts], [2, 0, 2]);
  const category = new Map([['investor_relations', 'capital_network'], ['contracts', 'legal_compliance']]);
  const capital = { roles: ['investor_relations'], tags: [{ slug: 'investor_relations', level: 'working' as const }] };
  assert.equal(fitOf(capital, { role_key: 'cfo', persona_key: 'tessaly' }, category), true, 'Tessaly: finance and capital');
  assert.equal(fitOf(capital, { role_key: 'cfo', persona_key: 'vesta' }, category), false, 'Vesta: legal and finance');
  assert.equal(fitOf(capital, { role_key: 'investor_relations', persona_key: null }, category), true, 'written for the role');
  assert.equal(fitOf(capital, null, category), false);
  const row = (name: string, fit: boolean, state: any, used_by = 0) => ({ name, used_by, eligibility: { state, fit, code: null, tool: null } });
  assert.deepEqual([row('B', false, 'eligible', 9), row('A', true, 'blocked'), row('C', true, 'eligible')].sort(byEligibility).map((r) => r.name), ['C', 'A', 'B']);
  const cands = [
    { uid: 'x', name: 'Burn report', output_kind: 'draft', axes: ['finance_ops'], used_by: 9 },
    { uid: 'y', name: 'Runway brief', output_kind: 'brief', axes: ['finance_ops'], used_by: 1 },
    { uid: 'z', name: 'Board pack', output_kind: 'brief', axes: ['product'], used_by: 50 },
  ];
  assert.equal(pickAlternative({ uid: 'd', output_kind: 'brief', axes: ['finance_ops'] }, cands)?.uid, 'y', 'same area, same output first');
  assert.equal(pickAlternative({ uid: 'd', output_kind: 'brief', axes: ['legal_compliance'] }, cands), null, 'none in its area');
  assert.deepEqual(skillInputsOf('cash-runway-snapshot'), [
    { field: 'recorded account balances and the balance date', required: true }, { field: 'monthly burn for the last three months', required: true },
  ]);
  assert.equal(skillInputsOf('a-skill-with-no-recorded-inputs'), null, 'Not recorded, never an empty list');
  assert.deepEqual(toolsToGrant(['stripe.read', 'mercury.read', 'stripe.read'], [{ integration_uid: 'i', tool: 'stripe.read' }]), ['stripe.read']);
});

// ── The routes ─────────────────────────────────────────────────────────────────

test('draft-only area: Legal is counted at the directory and the drawer, never named, and nothing in it can be attached', async () => {
  // Mutations checked: drafts listed to readers → the names leak; the per-area counts reading drafts as published →
  // the legal published assert fails.
  const w = world();
  await published(w, skill());
  await draft(w, legal('[Clause extraction draft]'));
  await draft(w, legal('[NDA review draft]'));
  const lib = await call(w, MEMBER, 'GET', '/skills?company=co-uid-1');
  assert.equal(lib.status, 200, lib.text);
  assert.deepEqual(area(lib.body.areas, 'legal_compliance'), { area: 'legal_compliance', label: area(lib.body.areas, 'legal_compliance').label, listed: 2, published: 0, drafts_axal: 2, drafts_company: 0, unreadable: 0 });
  assert.deepEqual([area(lib.body.areas, 'finance_ops').listed, area(lib.body.areas, 'finance_ops').published], [1, 1]);
  assert.ok(!lib.text.includes('Clause extraction draft') && !lib.text.includes('NDA review draft'), 'a reader never sees a draft\'s name');
  const drawer = await call(w, MEMBER, 'GET', `/agents/${IR}/skills/available`);
  assert.equal(drawer.status, 200, drawer.text);
  assert.deepEqual([area(drawer.body.areas, 'legal_compliance').listed, area(drawer.body.areas, 'legal_compliance').published], [2, 0]);
  assert.equal(drawer.body.counts.drafts, 2);
  assert.ok(!drawer.text.includes('NDA review draft'));
  assert.deepEqual(drawer.body.skills.map((k: any) => k.eligibility.state), ['eligible'], 'the published Finance skill is the way on');
});

test('eligible cross-area skill: every picker offers it, fit sorts it after the natural fit, and it attaches', async () => {
  // Mutations checked: /assignable filtered by the skill's roles again → Vesta is missing; /available dropping a
  // non-fit skill → the drawer misses it; the wizard read ignoring persona fit → Ryssa's order changes.
  const w = world();
  const runway = await published(w, skill());
  const legalPub = await published(w, legal('[Contract summary]'));
  // Vesta (investor_relations, legal and finance) and the Finance skill written for the CFO.
  const drawer = await call(w, EDITOR, 'GET', `/agents/${IR}/skills/available`);
  assert.deepEqual(drawer.body.skills.map((k: any) => [k.uid, k.eligibility.state, k.eligibility.fit]), [[runway, 'eligible', true], [legalPub, 'eligible', true]]);
  // Kade (product, marketing) is outside both areas and roles of the legal skill: still eligible, not fit.
  const kade = await call(w, EDITOR, 'GET', `/agents/${PROJECT_CFO}/skills/available`);
  assert.deepEqual(kade.body.skills.map((k: any) => [k.uid, k.eligibility.fit]), [[runway, true], [legalPub, false]]);
  const assignable = await call(w, EDITOR, 'GET', `/skills/${legalPub}/assignable`);
  assert.deepEqual(assignable.body.agents.map((a: any) => [a.uid, a.eligibility.state, a.eligibility.fit]),
    [[CFO, 'eligible', false], [IR, 'eligible', true], [PROJECT_CFO, 'eligible', false]]);
  assert.equal(assignable.body.counts.eligible, 3);
  const put = await call(w, EDITOR, 'PUT', `/agents/${PROJECT_CFO}/skills`, { skills: [{ uid: legalPub }] });
  assert.equal(put.status, 200, put.text);
  // The wizard: Ryssa (capital, finance) in a Legal seat sees the legal skill (her role's) and the Finance one (her area).
  const wiz = await call(w, EDITOR, 'GET', '/company/co-uid-1/skills/eligible?role=general_counsel&persona=ryssa');
  assert.equal(wiz.status, 200, wiz.text);
  assert.deepEqual(wiz.body.skills.map((k: any) => [k.uid, k.eligibility.state, k.eligibility.fit]), [[legalPub, 'eligible', true], [runway, 'eligible', true]], 'both fit: the more used first');
  const wizKade = await call(w, EDITOR, 'GET', '/company/co-uid-1/skills/eligible?role=cto&persona=kade');
  assert.deepEqual(wizKade.body.skills.map((k: any) => [k.eligibility.state, k.eligibility.fit]), [['eligible', false], ['eligible', false]]);
  assert.equal((await call(w, EDITOR, 'GET', '/company/co-uid-1/skills/eligible?role=nobody')).body.error, 'role_unknown');
  assert.equal((await call(w, EDITOR, 'GET', '/company/co-uid-1/skills/eligible?role=cfo&persona=nobody')).body.error, 'persona_unknown');
  assert.equal((await call(w, STRANGER, 'GET', '/company/co-uid-1/skills/eligible?role=cfo')).status, 403);
});

test('opted-out tool: blocked with the tool named at the drawer; the wizard names what step 3 will ask for', async () => {
  // Mutations checked: a blocked skill dropped from /available (as before for every code but one) → the deals row
  // is missing; the sponsor pool ignored → the wizard's deals skill stays blocked; an unreadable pool read as empty
  // → the wizard says blocked, not unreadable.
  const w = world({ CUSTOM_MCP_ENABLED: 'true' });
  const deals = await published(w, skill({ name: '[Pipeline read]', tools: ['hubspot.read_deals'] }));
  const contacts = await published(w, skill({ name: '[CRM digest]', tools: ['hubspot.read_contacts'] }));
  const drawer = await call(w, EDITOR, 'GET', `/agents/${IR}/skills/available`);
  const by = Object.fromEntries(drawer.body.skills.map((k: any) => [k.uid, k.eligibility]));
  assert.deepEqual([by[deals].state, by[deals].code, by[deals].tool], ['blocked', 'tool_not_approved', { key: 'hubspot.read_deals', label: 'hubspot.read_deals' }]);
  assert.equal(by[contacts].state, 'eligible');
  // The wizard, before the sponsor has approved any tool: both need one, neither can be granted at step 3.
  const none = await call(w, EDITOR, 'GET', '/company/co-uid-1/skills/eligible?role=cfo');
  assert.deepEqual(none.body.skills.map((k: any) => [k.eligibility.state, k.tools_to_grant]), [['blocked', []], ['blocked', []]]);
  assert.equal(none.body.tools_unreadable, false);
  // The sponsor approved hubspot.read_deals on a connected server: step 3 will ask for it.
  w.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, config_json) VALUES ('ig1', ?, 'custom:srv1', '[CRM]', 'active', 'oauth2', ?)`)
    .run(EDITOR, JSON.stringify({ pattern: 'mcp', url: 'https://mcp.example.test', hosts: ['mcp.example.test'], approved: { 'hubspot.read_deals': 'pin-1' } }));
  const some = await call(w, EDITOR, 'GET', '/company/co-uid-1/skills/eligible?role=cfo');
  const wiz = Object.fromEntries(some.body.skills.map((k: any) => [k.uid, [k.eligibility.state, k.tools_to_grant]]));
  assert.deepEqual(wiz[deals], ['eligible', ['hubspot.read_deals']]);
  assert.deepEqual(wiz[contacts][0], 'blocked');
  // A sponsor whose servers cannot be read: a skill that needs a tool is not known to be eligible.
  w.db.exec('DROP TABLE integrations');
  const broken = await call(w, EDITOR, 'GET', '/company/co-uid-1/skills/eligible?role=cfo');
  assert.equal(broken.body.tools_unreadable, true);
  assert.deepEqual(broken.body.skills.map((k: any) => [k.eligibility.state, k.eligibility.code]), [['unreadable', 'tools_unreadable'], ['unreadable', 'tools_unreadable']]);
  assert.equal(broken.body.counts.unreadable, 2);
});

test('a published skill whose version row is missing is unreadable, never eligible or dropped', async () => {
  // Mutation checked: a missing version row treated as no skill → the row is missing and the count is 0.
  const w = world();
  const uid = await published(w, skill());
  // Version rows are immutable (a trigger keeps them), so the pointer names a version that is not there.
  w.db.prepare('UPDATE agent_skills SET current_version = 9 WHERE uid = ?').run(uid);
  const r = await call(w, EDITOR, 'GET', `/agents/${CFO}/skills/available`);
  assert.deepEqual(r.body.skills.map((k: any) => [k.uid, k.eligibility.state]), [[uid, 'unreadable']]);
  assert.equal(r.body.counts.unreadable, 1);
});

test('cards carry the job and the inputs; a draft says why it cannot be attached and offers a published alternative', async () => {
  // Mutations checked: `job` read straight from the purpose → the routing clause stays; the alternative chosen
  // outside the draft's area → it names the product skill; `attach_refusal` null for a draft → the assert fails.
  const w = world();
  const live = await published(w, skill({ name: '[Runway brief]', purpose: 'Reports runway from recorded balances when a finance user asks for it.' }));
  await published(w, skill({ name: '[Roadmap read]', output_kind: 'brief', tags: [{ slug: 'product_strategy', level: 'expert' }] }));
  const d = await draft(w, skill({ name: '[Rolling cash flow forecast]' }));
  w.db.prepare("UPDATE agent_skills SET slug = 'cash-runway-snapshot' WHERE uid = ?").run(live);
  const card = (await call(w, MEMBER, 'GET', `/skills/${live}`)).body.skill;
  assert.equal(card.job, 'Reports runway from recorded balances.');
  assert.equal(card.purpose, 'Reports runway from recorded balances when a finance user asks for it.', 'the stored text is unchanged');
  assert.equal(card.inputs.length, 2);
  assert.deepEqual([card.attach_refusal, card.alternative], [null, null]);
  assert.equal(card.run_cost, null, 'Not recorded until #4536');
  const page = await call(w, SUPER, 'GET', `/skills/${d}`);
  assert.equal(page.status, 200, page.text);
  assert.deepEqual([page.body.skill.attach_refusal, page.body.skill.alternative], ['version_not_published', { uid: live, name: '[Runway brief]' }]);
  assert.equal(page.body.skill.inputs, null, 'its inputs are not recorded');
  // The directory's search reads the job and the inputs.
  const found = await call(w, MEMBER, 'GET', '/skills?company=co-uid-1&q=balance%20date');
  assert.deepEqual(found.body.hq.map((k: any) => k.uid), [live]);
});
