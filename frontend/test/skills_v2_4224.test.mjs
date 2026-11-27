// #4224 (SK-v2, D4116) — Team › Skills rebuilt to the v2 boards: the 8 areas
// of the /studio radar instead of agent roles, any skill on any agent (natural
// fit only sorts), and an energy image and a run cost line on every card.
//
// The tab is mounted on the Worker's own answers (`GET /api/teams/skills`,
// `GET /api/teams/skills/:uid`, `/assignable`, `/assign`), stubbed at fetch.
// Names and figures are fixtures only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skills_v2_4224.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import SkillsTab from '../src/pages/team/SkillsTab.jsx';
import { SkillCard } from '../src/pages/team/SkillParts.jsx';
import { AssignList } from '../src/pages/team/SkillSheets.jsx';
import {
  AREAS, areaCounts, areaFromParam, assignRows, costChangeWords, fromWorkerLibrary, fromWorkerSkill, naturalFit, runCostWords,
} from '../src/pages/team/skillsModel.js';
import { SKILL_AREAS } from '../src/lib/skillAreas.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// ---------------------------------------------------------------- the Worker's answers

const uid = (n) => String(n).padStart(32, 'a');
const card = (n, over = {}) => ({
  uid: uid(n), scope: 'hq', slug: `skill-${n}`, status: 'published', version: 2, author: 'Axal',
  name: `Skill ${n}`, purpose: `Does thing ${n}.`, steps: ['Read.', 'Draft.'], tools: ['mercury.read'], output_kind: 'draft', output_label: 'A draft',
  roles: [{ key: 'investor_relations', label: 'Investor relations' }],
  tags: [{ slug: 'fundraising', label: 'Fundraising', category: 'capital_network', level: 'proficient' }],
  used_by: 214, updated_at: '2026-10-30T00:00:00Z', can_write: false, ...over,
});
const LIB = (canWrite) => ({
  roles: [{ key: 'investor_relations', label: 'Investor relations', skills: 2, agents: 1 }],
  hq: [card(1), card(2, { tags: [{ slug: 'budgeting', label: 'Budgeting', category: 'finance_ops', level: 'working' }] }), card(3, { tags: [] })],
  company: { uid: 'nw1', name: '[Northwind Labs]', skills: [card(4, { scope: 'company', author: '[Northwind Labs]', can_write: canWrite })], can_write: canWrite },
  can_write_hq: false,
});
const PAGE = { skill: { ...card(1), skill_md: '---\nname: skill-1\n---\n1. Read.' }, versions: [{ version: 2, published_at: '2026-10-30', by: { uid: 'u1', name: 'Ada Founder' } }], agents: [] };
// Outside the skill's natural fit: an Engineering persona, and the Worker's old D1612 `role_mismatch`.
const ASSIGNABLE = { agents: [
  { uid: 'ag-eng', name: 'Corvane', role_key: 'cto', skill_count: 1, assigned: false, blocked: { code: 'role_mismatch', tool: null }, scope: { kind: 'company', company_name: '[Northwind Labs]' } },
  { uid: 'ag-cap', name: 'Solen', role_key: 'investor_relations', skill_count: 2, assigned: false, blocked: null, scope: { kind: 'company', company_name: '[Northwind Labs]' } },
] };
const TEAM_AGENTS = (manage) => ({ available: true, value: { can_manage: manage, plan_ok: true, agents: [
  { uid: 'ag-eng', persona: { key: 'corvane', natural_fit: ['engineering', 'product'] } },
  { uid: 'ag-cap', persona: { key: 'solen', natural_fit: ['capital', 'gtm'] } },
] } });

function stubFetch(routes) {
  const seen = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    seen.push({ key, search: url.search, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes[key];
    const [status, body] = typeof hit === 'function' ? hit() : hit || [500, { error: 'boom' }];
    return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { seen, restore: () => { globalThis.fetch = previous; } };
}

const ROUTES = (canWrite = true) => ({
  'GET /api/teams/skills': [200, LIB(canWrite)],
  [`GET /api/teams/skills/${uid(1)}`]: [200, PAGE],
  [`GET /api/teams/skills/${uid(1)}/agents`]: [200, { agents: [] }],
  [`GET /api/teams/skills/${uid(1)}/assignable`]: [200, ASSIGNABLE],
  [`POST /api/teams/skills/${uid(1)}/assign`]: [200, { added: 1, refused: [], used_by: 215 }],
});

const SCOPE = { kind: 'company', company: { uid: 'nw1', name: '[Northwind Labs]' } };
const settle = async (m) => { for (let i = 0; i < 4; i += 1) await m.flush(); };

async function mountTab(url, { routes = ROUTES(), agentsBlock = TEAM_AGENTS(true) } = {}) {
  const net = stubFetch(routes);
  const m = await mountContracts(h(SkillsTab, { scope: SCOPE, agentsBlock }), url);
  await settle(m);
  const byTestId = (re) => m.nodes().filter((n) => { const id = m.props(n)?.['data-testid']; return typeof id === 'string' && (typeof re === 'string' ? id === re : re.test(id)); });
  return {
    ...m, net, byTestId,
    async press(id) { const [n] = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { m.props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(m); },
    async tick(id) { const [n] = byTestId(id); assert.ok(n, `no ${id}`); assert.ok(!m.props(n).disabled, `${id} is disabled`); await act(async () => { m.props(n).onChange({ target: {} }); }); await settle(m); },
    async done() { await m.unmount(); net.restore(); },
  };
}

const ROLE_WORDS = /Investor relations|\bRoles?\b|\brole\b/;

// ---------------------------------------------------------------- the model

test('the 8 areas are the radar\'s, from the one area table; an address takes a key or a slug, never a role', () => {
  assert.deepEqual(AREAS.map((a) => a.key), SKILL_AREAS.map((a) => a.key));
  assert.deepEqual(AREAS.map((a) => a.key), ['product', 'engineering', 'design', 'gtm', 'marketing', 'finance', 'legal', 'capital']);
  assert.equal(areaFromParam('finance').key, 'finance');
  assert.equal(areaFromParam('finance_ops').key, 'finance');
  assert.equal(areaFromParam('investor_relations'), null);
  assert.equal(areaFromParam('all'), null);
  assert.equal(areaFromParam(null), null);
});

test('A1\'s answer becomes one list; roles survive only as `fit`, a hint; area counts count every area a skill is in', () => {
  const v = fromWorkerLibrary(LIB(true));
  assert.equal(v.can_edit, true);
  assert.deepEqual(v.figures.skills, { axal: 3, company: 1 });
  assert.equal(v.figures.agents_with_skills, null, 'not read: "Not recorded", never 0');
  const s = v.skills[0];
  assert.deepEqual(s.fit, ['investor_relations']);
  assert.equal('roles' in s, false);
  assert.deepEqual(s.taxonomy[0], { skill_slug: 'fundraising', skill_label: 'Fundraising', category_slug: 'capital_network', category_label: 'Capital', level: 'proficient' });
  assert.deepEqual(s.tools, [{ key: 'mercury.read', label: 'Mercury' }]);
  assert.equal(s.description, 'Does thing 1.');
  assert.deepEqual(v.skills[3].author, { kind: 'company', name: '[Northwind Labs]' });
  const c = areaCounts(v.skills);
  assert.equal(c.capital, 2);
  assert.equal(c.finance, 1);
  assert.equal(c.design, 0);
  assert.equal(fromWorkerLibrary({ hq: [], company: null }).can_edit, false);
});

test('R5: the run cost is "Not recorded" until #4121 serves it, never "$0"', () => {
  assert.equal(runCostWords(fromWorkerSkill(card(1))), null);
  assert.equal(runCostWords({}), null);
  assert.equal(runCostWords({ run_cost_microusd: 40000 }), '$0.04 a run');
  assert.equal(costChangeWords({}), null);
  assert.equal(costChangeWords({ run_cost_change_microusd: 20000 }), '+$0.02 a run');
  const out = renderedText(html(h(SkillCard, { s: fromWorkerSkill(card(1)), onOpen() {}, onAssign() {} })));
  assert.match(out, /Run cost · Not recorded/);
  assert.doesNotMatch(out, /\$0\b|\$0\.00/);
});

test('natural fit sorts Assign first and excludes nobody; a role mismatch is no block', () => {
  const skill = fromWorkerSkill(card(1));
  const personas = { 'ag-eng': { natural_fit: ['engineering', 'product'] }, 'ag-cap': { natural_fit: ['capital', 'gtm'] } };
  assert.equal(naturalFit({ persona: personas['ag-cap'] }, skill), true);
  assert.equal(naturalFit({ persona: personas['ag-eng'] }, skill), false);
  const rows = assignRows(ASSIGNABLE.agents, skill, (u) => personas[u]);
  assert.deepEqual(rows.map((r) => [r.uid, r.fit]), [['ag-cap', true], ['ag-eng', false]]);
  assert.equal(rows.find((r) => r.uid === 'ag-eng').blocked, null);
  const tool = assignRows([{ uid: 'x', blocked: { code: 'tool_not_approved', tool: { label: 'HubSpot' } } }], skill);
  assert.equal(tool[0].blocked.code, 'tool_not_approved', 'a real gate still blocks');
  const out = html(h(AssignList, { rows, picked: new Set(), onTick() {} }));
  assert.match(out, /data-testid="assign-agent-ag-eng" data-fit="0"/);
  assert.doesNotMatch(out.match(/data-testid="assign-tick-ag-eng"[^>]*/)?.[0] || /x/.source, /disabled/);
  assert.match(renderedText(out), /Run cost change · Not recorded/);
});

// ---------------------------------------------------------------- the tab, mounted

test('no role label renders on the tab: the areas, the All directory, an old role= link and a skill page', async () => {
  const t = await mountTab('/team?tab=skills');
  try {
    assert.equal(t.byTestId('skills-areas').length, 1);
    assert.equal(t.byTestId(/^skills-area-open-/).length, 8);
    assert.match(t.text(), /Capital\s*2 skills/);
    assert.doesNotMatch(t.text(), ROLE_WORDS);
    assert.ok(t.net.seen.some((r) => r.key === 'GET /api/teams/skills' && r.search === '?company=nw1'));
    await t.press('skills-all-areas');
    assert.equal(t.byTestId('skills-directory').length, 1);
    assert.doesNotMatch(t.text(), ROLE_WORDS);
    await t.press(`skill-open-${uid(1)}`);
    assert.equal(t.byTestId('skill-page').length, 1);
    assert.doesNotMatch(t.text(), ROLE_WORDS);
  } finally { await t.done(); }
  const old = await mountTab('/team?tab=skills&role=investor_relations');
  try {
    assert.equal(old.byTestId('skills-directory').length, 1, 'an old role= link opens All');
    assert.match(old.text(), /All areas/);
    assert.equal(old.byTestId(/^skill-card-/).length, 4);
  } finally { await old.done(); }
  const area = await mountTab('/team?tab=skills&area=finance');
  try {
    assert.match(area.text(), /‹ Areas\s*·\s*Finance/);
    assert.deepEqual(area.byTestId(/^skill-card-/).map((n) => area.props(n)['data-testid']), [`skill-card-${uid(2)}`]);
  } finally { await area.done(); }
});

test('every card has an energy image and a cost line', async () => {
  const t = await mountTab('/team?tab=skills&area=all');
  try {
    const cards = t.byTestId(/^skill-card-/);
    assert.equal(cards.length, 4);
    const within = (n, id) => { const walk = (x) => [x, ...(x.childNodes || []).flatMap(walk)]; return walk(n).filter((x) => t.props(x)?.['data-testid'] === id).length; };
    for (const c of cards) {
      assert.equal(within(c, 'skill-energy') + within(c, 'skill-image-none'), 1, `${t.props(c)['data-testid']}: one image`);
      assert.equal(within(c, 'skill-cost'), 1, `${t.props(c)['data-testid']}: a cost line`);
    }
    assert.equal(t.byTestId('skill-energy').length, 3, 'the three skills with an area draw their energy');
    assert.equal(t.byTestId('skill-image-none').length, 1, 'the one without draws an empty frame, never a made-up area');
    assert.equal((t.text().match(/Run cost · Not recorded/g) || []).length, 4);
  } finally { await t.done(); }
});

test('a skill can be assigned to an agent outside its natural fit', async () => {
  const t = await mountTab('/team?tab=skills&area=all');
  try {
    await t.press(`skill-assign-${uid(1)}`);
    assert.equal(t.byTestId('assign-skill-sheet').length, 1);
    assert.equal(t.byTestId(/^assign-agent-/).length, 2, 'nobody is left out');
    assert.deepEqual(t.byTestId(/^assign-agent-/).map((n) => t.props(n)['data-fit']), ['1', '0'], 'natural fit first');
    assert.equal(t.byTestId('skill-cost-explainer').length, 1, 'SK5 inline');
    await t.tick('assign-tick-ag-eng');
    await t.press('assign-skill-save');
    const post = t.net.seen.find((r) => r.key === `POST /api/teams/skills/${uid(1)}/assign`);
    assert.deepEqual(post?.body, { agent_uids: ['ag-eng'] });
    assert.match(t.text(), /Added to 1 agent/);
  } finally { await t.done(); }
});

test('read-only member: no New and no Assign, on the areas, the directory and the skill page', async () => {
  for (const url of ['/team?tab=skills', '/team?tab=skills&area=all', `/team?tab=skills&skill=${uid(1)}`]) {
    const t = await mountTab(url, { routes: ROUTES(false), agentsBlock: TEAM_AGENTS(false) });
    try {
      assert.equal(t.byTestId('skills-new').length, 0, `${url}: New`);
      assert.equal(t.byTestId(/^skill-assign-|^skill-page-assign$/).length, 0, `${url}: Assign`);
      if (!url.includes('skill=')) assert.match(t.text(), /Only this Team’s editors add skills or assign them to agents/);
    } finally { await t.done(); }
  }
  const editor = await mountTab('/team?tab=skills&area=all');
  try {
    assert.equal(editor.byTestId('skills-new').length, 1);
    assert.equal(editor.byTestId(/^skill-assign-/).length, 4);
  } finally { await editor.done(); }
});

test('a failed read is never "No skills"', async () => {
  for (const url of ['/team?tab=skills', '/team?tab=skills&area=design']) {
    const t = await mountTab(url, { routes: { 'GET /api/teams/skills': [500, { error: 'boom' }] } });
    try {
      assert.equal(t.byTestId('skills-unreadable').length, 1, url);
      assert.match(t.text(), /Skills could not be read\.\s*Try again/);
      assert.doesNotMatch(t.text(), /No skills/);
      assert.equal(t.byTestId('skills-empty').length, 0);
    } finally { await t.done(); }
  }
  const off = await mountTab('/team?tab=skills', { routes: { 'GET /api/teams/skills': [404, { error: 'team_agents_off' }] } });
  try {
    assert.match(off.text(), /AI agents aren’t switched on yet/);
    assert.doesNotMatch(off.text(), /No skills/);
    assert.match(off.text(), /Skills\s*Not recorded/, 'the area tiles say "Not recorded", never 0');
  } finally { await off.done(); }
  const empty = await mountTab('/team?tab=skills&area=design');
  try {
    assert.match(empty.text(), /No skills in Design yet/, 'only an answered, empty area says so');
  } finally { await empty.done(); }
});

test('values belong to agents, never to skills: no value is drawn on a skill card or page', async () => {
  const VALUES = /Integrity|Stewardship|Curiosity|Resilience|Collaboration|Ambition|Candour|Values/;
  assert.doesNotMatch(renderedText(html(h(SkillCard, { s: fromWorkerSkill(card(1)), onOpen() {}, onAssign() {} }))), VALUES);
  const t = await mountTab(`/team?tab=skills&skill=${uid(1)}`);
  try { assert.doesNotMatch(t.text(), VALUES); } finally { await t.done(); }
});
