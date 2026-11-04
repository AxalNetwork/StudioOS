// #4363 — a visible Skills link wherever a company's or a project's agents
// appear. Before it, a company's own skills were reached only through
// Settings › Team and then the Skills tab, and the owner could not find them.
//
// Pinned here: every Skills link, where it is drawn and its literal `to`, one
// per Team form in routes/team.jsx; who sees it (the Team route's guard); the
// scope an agent's profile links to; and HQ, which keeps its own Skills
// library tab and draws no such link.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skills_link_4363.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import SkillsLink from '../src/pages/team/SkillsLink.jsx';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import AgentSkillsCard from '../src/pages/team/AgentSkillsCard.jsx';
import { agentSkillsScope, canOpenTeam } from '../src/pages/team/teamModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const SRC = 'frontend/src';
const draw = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
/** Every `href` a link with this test id draws, from the static markup. */
const hrefsOf = (html, testId) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
  .filter((a) => a.includes(`data-testid="${testId}"`)).map((a) => /href="([^"]*)"/.exec(a)?.[1].replace(/&amp;/g, '&'));

/** The signed-in account, as the pages read it (`safeReadJSON('user')`). */
function asUser(user, run) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map([['user', JSON.stringify(user)]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });
  try { return run(); } finally { if (prev) Object.defineProperty(globalThis, 'localStorage', prev); else delete globalThis.localStorage; }
}

const ADMIN = { id: 1, role: 'admin' };
const COMPANY = { kind: 'company', company: { uid: 'nw1', name: '[Northwind Labs]' }, project: null };
const COMPANY_PROJECT = { kind: 'company_project', company: { uid: 'nw1', name: '[Northwind Labs]' }, project: { id: 42, name: '[Atlas]' } };
const PROJECT = { kind: 'project', company: null, project: { id: 7, name: '[Harbor]' } };

// ---------------------------------------------------------------- the three addresses

test('SkillsLink opens each Team form at ?tab=skills, one literal `to` per form', () => {
  const href = (scope) => hrefsOf(draw(h(SkillsLink, { scope, user: ADMIN })), 'skills-link');
  assert.deepEqual(href(COMPANY), ['/account/companies/nw1/settings/team?tab=skills']);
  assert.deepEqual(href(COMPANY_PROJECT), ['/account/companies/nw1/settings/projects/42/team?tab=skills']);
  assert.deepEqual(href(PROJECT), ['/projects/7/settings/team?tab=skills']);
  // A project under a company this account cannot name: the project form, which forwards keeping ?tab=.
  assert.deepEqual(href({ kind: 'company_project', company: { uid: null, name: 'its company' }, project: { id: 42 } }), ['/projects/42/settings/team?tab=skills']);
  // Each value is encoded into its segment.
  assert.deepEqual(href({ kind: 'company', company: { uid: 'a/b c' } }), ['/account/companies/a%2Fb%20c/settings/team?tab=skills']);
  // Nothing to address, no link.
  assert.deepEqual(href(null), []);
  assert.deepEqual(href({ kind: 'company', company: { uid: null } }), []);
  assert.deepEqual(href({ kind: 'project', project: { id: null } }), []);
  // The words are the issue's: "Skills".
  assert.match(draw(h(SkillsLink, { scope: COMPANY, user: ADMIN })), />Skills<\/a>/);
});

test('each address is written as a literal `to`, so the reachability walk counts it, and each is a real Team route', () => {
  const code = codeOnly(read(`${SRC}/pages/team/SkillsLink.jsx`));
  const routes = read(`${SRC}/routes/team.jsx`);
  const LITERALS = [
    ['to={`/account/companies/${encodeURIComponent(uid)}/settings/team?tab=skills`}', '/account/companies/:uid/settings/team'],
    ['to={`/account/companies/${encodeURIComponent(uid)}/settings/projects/${encodeURIComponent(id)}/team?tab=skills`}', '/account/companies/:uid/settings/projects/:id/team'],
    ['to={`/projects/${encodeURIComponent(id)}/settings/team?tab=skills`}', '/projects/:id/settings/team'],
  ];
  for (const [literal, route] of LITERALS) {
    assert.ok(code.includes(literal), `SkillsLink writes ${literal}`);
    assert.ok(routes.includes(`path="${route}"`), `${route} is a Team route`);
  }
  assert.equal((code.match(/<Link\b/g) || []).length, LITERALS.length, 'one link per form, no computed address');
  // `?tab=skills` is the Team page's Skills tab.
  assert.match(read(`${SRC}/pages/team/teamModel.js`), /\{ key: 'skills', label: 'Skills' \}/);
});

// ---------------------------------------------------------------- who sees it

test('canOpenTeam is the Team routes\' guard: five profiles for a company, the four or the Lab for a standalone project', () => {
  for (const role of ['admin', 'founder', 'partner', 'investor', 'advisor']) {
    assert.equal(canOpenTeam({ role }, 'company'), true, `${role}: company`);
    assert.equal(canOpenTeam({ role }, 'company_project'), true, `${role}: company project`);
  }
  for (const role of ['admin', 'founder', 'partner', 'investor']) assert.equal(canOpenTeam({ role }, 'project'), true, `${role}: project`);
  assert.equal(canOpenTeam({ role: 'advisor' }, 'project'), false, 'an advisor is not admitted to a standalone project\'s Team');
  assert.equal(canOpenTeam({ role: 'exploring' }, 'company'), false, 'an Explorer opens Portfolio, not a company\'s Team');
  assert.equal(canOpenTeam({ role: 'exploring' }, 'project'), false);
  assert.equal(canOpenTeam({ role: 'exploring', spinout_lab_active: 1 }, 'project'), true, 'labRoles admits anyone in the Lab');
  assert.equal(canOpenTeam({ role: 'exploring', spinout_lab_active: 1 }, 'company'), false, 'the Lab does not open a company\'s settings');
  assert.equal(canOpenTeam({}, 'company'), false, 'signed out');
  assert.equal(canOpenTeam({ role: 'admin' }, 'hq'), false, 'no other form');

  // The lists are the routes' own: a change to either side fails here.
  const routes = read(`${SRC}/routes/team.jsx`);
  const guardOf = (path) => {
    const line = routes.split('\n').find((l) => l.includes(`path="${path}"`));
    return JSON.parse(/guard\((?:labRoles\()?(\[[^\]]*\])/.exec(line)[1].replace(/'/g, '"'));
  };
  const model = read(`${SRC}/pages/team/teamModel.js`);
  const listOf = (name) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(model)[1].replace(/'/g, '"'));
  assert.deepEqual(listOf('COMPANY_TEAM_ROLES'), guardOf('/account/companies/:uid/settings/team'));
  assert.deepEqual(listOf('COMPANY_TEAM_ROLES'), guardOf('/account/companies/:uid/settings/projects/:id/team'));
  assert.deepEqual(listOf('PROJECT_TEAM_ROLES'), guardOf('/projects/:id/settings/team'));
  assert.match(routes, /path="\/projects\/:id\/settings\/team" element=\{guard\(labRoles\(/, 'the project form goes through labRoles');
});

test('SkillsLink draws only for a viewer the route admits', () => {
  const html = (scope, user) => draw(h(SkillsLink, { scope, user }));
  assert.equal(html(COMPANY, { role: 'exploring' }), '');
  assert.equal(html(PROJECT, { role: 'advisor' }), '');
  assert.match(html(COMPANY_PROJECT, { role: 'advisor' }), /tab=skills/);
  // A company project this account cannot name goes through the project form, so its guard decides.
  assert.equal(html({ kind: 'company_project', company: { uid: null }, project: { id: 42 } }, { role: 'advisor' }), '');
  // With no user passed, it reads the signed-in account.
  assert.equal(asUser({ role: 'exploring' }, () => draw(h(SkillsLink, { scope: COMPANY }))), '');
  assert.match(asUser({ role: 'founder' }, () => draw(h(SkillsLink, { scope: COMPANY }))), /tab=skills/);
});

// ---------------------------------------------------------------- where it is drawn

test('the AI agents card carries the Skills link in every state', () => {
  const card = (props) => asUser({ role: 'founder' }, () => draw(h(AgentsCard, { kind: 'company', scope: COMPANY, companyName: '[Northwind Labs]', onOpen() {}, onRetry() {}, ...props })));
  const want = ['/account/companies/nw1/settings/team?tab=skills'];
  const agent = { uid: 'ag1', role_key: 'cfo', status: 'active', first_name: 'Ada', last_name: 'Quinn', scope_kind: 'company' };
  for (const [label, props] of [
    ['loading', { loading: true }],
    ['unavailable', { block: { available: false, reason: 'AI agents aren’t switched on yet.' } }],
    ['unreadable', { block: { available: false, unreadable: true } }],
    ['plan lock', { block: { available: false, locked: 'plan', reason: 'AI agents come with a paid Founder plan.' } }],
    ['empty', { block: { available: true, value: { agents: [] } } }],
    ['the table', { block: { available: true, value: { agents: [agent] } } }],
  ]) assert.deepEqual(hrefsOf(card(props), 'team-agents-skills'), want, label);
  // A project's card opens the project's Skills.
  assert.deepEqual(hrefsOf(asUser({ role: 'founder' }, () => draw(h(AgentsCard, { kind: 'project', scope: PROJECT, loading: true }))), 'team-agents-skills'), ['/projects/7/settings/team?tab=skills']);
});

test('an agent\'s Skills and values links to its scope\'s Skills tab', () => {
  const html = asUser({ role: 'founder' }, () => draw(h(AgentSkillsCard, { agent: { uid: 'ag1' }, canManage: false, skillsScope: COMPANY_PROJECT })));
  assert.deepEqual(hrefsOf(html, 'agent-skills-library'), ['/account/companies/nw1/settings/projects/42/team?tab=skills']);
  assert.match(html, /Skills and values/);
  // No scope (the sheet opened outside a Team page): no link, the card is unchanged.
  assert.deepEqual(hrefsOf(asUser({ role: 'founder' }, () => draw(h(AgentSkillsCard, { agent: { uid: 'ag1' } }))), 'agent-skills-library'), []);
});

test('agentSkillsScope: a company editor\'s project agent opens that project\'s Skills; any other agent the page\'s', () => {
  assert.deepEqual(agentSkillsScope(COMPANY, { scope_kind: 'project', project: { id: 42, name: '[Atlas]' } }),
    { kind: 'company_project', company: COMPANY.company, project: { id: 42 } });
  assert.equal(agentSkillsScope(COMPANY, { scope_kind: 'company', project: null }), COMPANY);
  assert.equal(agentSkillsScope(COMPANY, { scope_kind: 'project', project: null }), COMPANY, 'no project read: the page\'s scope');
  assert.equal(agentSkillsScope(COMPANY, { scope_kind: 'project', project: { id: null, name: '[Atlas]' } }), COMPANY, 'a project without its id: the page\'s scope');
  assert.equal(agentSkillsScope(PROJECT, { scope_kind: 'project', project: { id: 7 } }), PROJECT);
  assert.equal(agentSkillsScope(COMPANY_PROJECT, { scope_kind: 'project', project: { id: 42 } }), COMPANY_PROJECT);
  assert.equal(agentSkillsScope(null, { scope_kind: 'project', project: { id: 42 } }), null);
});

test('every place a company\'s or a project\'s team or agents are shown draws the Skills link', () => {
  const PLACES = [
    // [file, the exact mount, what it is]
    ['pages/team/AgentsCard.jsx', '<SkillsLink scope={scope} testId="team-agents-skills" />', 'the agents card (Team › People and agents)'],
    ['pages/team/TeamAgentsPage.jsx', '<AgentsCard block={agentsBlock} loading={!agentsBlock} kind={kind} scope={scope}', 'the Team page hands the card its scope'],
    ['pages/team/TeamAgentsPage.jsx', '<AgentProfileSheet uid={sheet.uid} scope={scope}', 'and the agent profile'],
    ['pages/team/AgentProfileSheet.jsx', 'skillsScope={agentSkillsScope(scope, a)}', 'the profile hands AgentSkillsCard the agent\'s scope'],
    ['pages/team/AgentSkillsCard.jsx', '<SkillsLink scope={skillsScope} testId="agent-skills-library" />', 'the agent page\'s Skills and values'],
    ['pages/account/companies/CompanyPage.jsx', '<SkillsLink scope={{ kind: \'company\', company: { uid } }} className={LINK} testId="company-skills-link" />', 'the company page\'s Team card'],
    ['pages/account/companies/ProjectPage.jsx', '<SkillsLink scope={ready ? scope : null} className={LINK} testId="project-skills-link" />', 'the project page\'s Team card'],
    ['pages/account/companies/CompanySettingsTabs.jsx', '<SkillsLink scope={{ kind: \'company_project\', company: { uid }, project: { id } }} className={LINK} testId="company-project-skills-link" />', 'Company settings › Projects, its Agents row'],
    ['pages/ProjectDetail.jsx', '<SkillsLink scope={{ kind: \'project\', project: { id: projectId } }}', 'the project workspace\'s Team section'],
  ];
  for (const [file, mount, what] of PLACES) assert.ok(codeOnly(read(`${SRC}/${file}`)).includes(mount), `${what}: ${file}`);
  // Each sits beside the Team entry it extends.
  const beside = [
    ['pages/account/companies/CompanyPage.jsx', 'data-testid="company-team-link">Team</Link>', 'company-skills-link'],
    ['pages/account/companies/ProjectPage.jsx', '<Link to={teamTo} className={LINK}>Open Team</Link>', 'project-skills-link'],
    ['pages/account/companies/CompanySettingsTabs.jsx', 'data-testid="company-project-agents">', 'company-project-skills-link'],
    ['pages/ProjectDetail.jsx', 'data-testid="project-team-link">Team ›</Link>', 'project-skills-link'],
  ];
  for (const [file, team, testId] of beside) {
    const code = codeOnly(read(`${SRC}/${file}`));
    const at = code.indexOf(team);
    const link = code.indexOf(`testId="${testId}"`);
    assert.ok(at >= 0 && link > at && link - at < 400, `${file}: the Skills link follows its Team entry`);
  }
  // Every mount is one of these: a new one is pinned here too.
  const mounts = [];
  const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.jsx?$/.test(n) && !p.endsWith('SkillsLink.jsx') && codeOnly(read(p)).includes('<SkillsLink')) mounts.push(p.slice(SRC.length + 1)); } };
  walk(SRC);
  assert.deepEqual(mounts.sort(), [...new Set(PLACES.filter(([, m]) => m.startsWith('<SkillsLink')).map(([f]) => f))].sort());
});

// ---------------------------------------------------------------- HQ

test('HQ is unchanged: its Skills library tab stays, and no HQ page draws a Team Skills link', () => {
  const hq = read(`${SRC}/pages/hq/aiAgents/HqAiAgentsPage.jsx`);
  assert.ok(hq.includes('<HeaderTab to="/hq/ai-agents/skills" end={false} data-testid="ai-agents-tab-skills"'), 'the Skills library tab is where it was');
  assert.match(hq, />Skills library<\/HeaderTab>/);
  const files = [];
  const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.jsx?$/.test(n)) files.push(p); } };
  walk(`${SRC}/pages/hq`);
  for (const f of files) {
    const code = codeOnly(read(f));
    assert.ok(!code.includes('SkillsLink'), `${f} draws no SkillsLink`);
    assert.ok(!code.includes('settings/team?tab=skills'), `${f} links no Team Skills tab`);
  }
  // Its routes are the three it had.
  const app = read(`${SRC}/App.jsx`);
  assert.deepEqual([...app.matchAll(/<Route path="(\/hq\/ai-agents\/skills[^"]*)"/g)].map((m) => m[1]),
    ['/hq/ai-agents/skills', '/hq/ai-agents/skills/companies', '/hq/ai-agents/skills/:skillUid/edit']);
});
