// D4137 (#4137) — HQ › AI agents: the model's words and rules, the routes, and
// that nothing on the page claims a control the Worker would only refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AREAS, BUILD, GUARDRAILS, NOT_RECORDED, PAUSE_WORD, SUBTABS, TABS,
  areaOf, areaTiles, levelOf, notYet, overviewTiles, pauseArmed, reasonOk, shown, skillRow, viewFor,
} from '../src/pages/hq/aiAgents/aiAgentsModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const PAGE = read('pages/hq/aiAgents/HqAiAgentsPage.jsx');
const APP = read('App.jsx');

test('the four tabs and their sub-tabs at the canvas addresses (SA0–SA8)', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.to]), [
    ['Overview', '/hq/ai-agents'], ['Roster', '/hq/ai-agents/roster'],
    ['Skills library', '/hq/ai-agents/skills'], ['Operations', '/hq/ai-agents/operations'],
  ]);
  assert.deepEqual(SUBTABS.skills.map((t) => t.label), ['From Axal', 'Company skills']);
  assert.deepEqual(SUBTABS.operations.map((t) => t.label), ['Runs', 'Spend', 'Policies', 'Audit']);
});

test('every address the page answers is a registered, Super Admin-only route', () => {
  for (const to of [...TABS, ...SUBTABS.skills, ...SUBTABS.operations].map((t) => t.to)) {
    assert.match(APP, new RegExp(`<Route path="${to}" element=\\{guard\\(\\['admin'\\], hqOnly\\(<HqAiAgentsPage />\\)\\)\\} />`), to);
  }
  for (const p of ['/hq/ai-agents/roster/:agent', '/hq/ai-agents/skills/:skillUid/edit']) assert.ok(APP.includes(`path="${p}" element={guard(['admin'], hqOnly(<HqAiAgentsPage />))}`), p);
});

test('viewFor maps each address to its board, and an unknown sub-path to its tab', () => {
  assert.deepEqual(viewFor('/hq/ai-agents'), { tab: 'overview', sub: null });
  assert.deepEqual(viewFor('/hq/ai-agents/roster'), { tab: 'roster', sub: 'list', agent: null });
  assert.deepEqual(viewFor('/hq/ai-agents/roster/vesta'), { tab: 'roster', sub: 'agent', agent: 'vesta' });
  assert.deepEqual(viewFor('/hq/ai-agents/skills/'), { tab: 'skills', sub: 'axal' });
  assert.deepEqual(viewFor('/hq/ai-agents/skills/companies'), { tab: 'skills', sub: 'companies' });
  assert.deepEqual(viewFor('/hq/ai-agents/skills/sk_1/edit'), { tab: 'skills', sub: 'editor', skill: 'sk_1' });
  assert.deepEqual(viewFor('/hq/ai-agents/operations/policies'), { tab: 'operations', sub: 'policies' });
  assert.deepEqual(viewFor('/hq/ai-agents/operations/nope'), { tab: 'operations', sub: 'runs' });
});

test('each build task names its issue, and none is live before its routes land', () => {
  assert.deepEqual(Object.entries(BUILD).map(([k, b]) => [k, b.issue]), [['H1', 4158], ['H2', 4160], ['H3', 4161], ['H4', 4162], ['H5', 4163]]);
  // Roster, company moderation, policies and operations are wired; the HQ editor still waits.
  assert.deepEqual(Object.entries(BUILD).map(([k, b]) => [k, b.live]), [['H1', true], ['H2', false], ['H3', true], ['H4', true], ['H5', true]]);
  assert.equal(notYet('H4'), 'Not switched on yet. Platform AI policy and the kill switch arrives with #4162.');
});

test('"Not recorded" is never a 0, and a real 0 is a 0', () => {
  assert.equal(shown(null), NOT_RECORDED);
  assert.equal(shown(undefined), NOT_RECORDED);
  assert.equal(shown(Number.NaN), NOT_RECORDED);
  assert.equal(shown(0), '0');
  const tiles = overviewTiles({ hqSkills: null });
  assert.ok(tiles.every((t) => t.value === NOT_RECORDED), 'nothing reads as zero when nothing was read');
  const live = overviewTiles({ hqSkills: [{ status: 'published' }, { status: 'draft' }, { status: 'published' }] });
  assert.equal(live.find((t) => t.key === 'skills').value, '2');
  assert.equal(live.filter((t) => t.value === NOT_RECORDED).length, 5, 'the other five wait for #4163');
});

test('SA3 rows from a D1612 library card: area and level from the tags, H2 columns "Not recorded"', () => {
  const card = {
    uid: 'sk_1', slug: 'investor-update', name: 'Investor update draft', status: 'published', version: 3, used_by: 41,
    tools: ['stripe.read', 'mercury.read'],
    tags: [{ slug: 'ir', category: 'capital_network', level: 'proficient' }, { slug: 'fr', category: 'finance_ops', level: 'working' }, { slug: 'bc', category: 'capital_network', level: 'working' }],
  };
  assert.equal(areaOf(card), 'capital_network');
  assert.equal(levelOf(card), 'Proficient');
  const r = skillRow(card);
  assert.equal(r.area, 'Capital');
  assert.equal(r.version, 'v3');
  assert.equal(r.status.label, 'Published');
  assert.equal(r.agents, '41');
  assert.equal(r.golden, NOT_RECORDED);
  assert.equal(r.lastEval, NOT_RECORDED);
  const draft = skillRow({ uid: 'x', name: 'New', status: 'draft', version: null, tags: [] });
  assert.equal(draft.version, 'Not published');
  assert.equal(draft.area, NOT_RECORDED);
  assert.equal(draft.agents, NOT_RECORDED, 'a card without used_by is not "0 agents"');
});

test('SA3 area tiles: the 8 areas in the radar order, counts and drafts', () => {
  assert.deepEqual(AREAS.map((a) => a.label), ['Product', 'Engineering', 'Design', 'GTM', 'Marketing', 'Finance', 'Legal', 'Capital']);
  const tiles = areaTiles([
    { status: 'published', tags: [{ category: 'design', level: 'working' }] },
    { status: 'draft', tags: [{ category: 'design', level: 'working' }] },
  ]);
  assert.equal(tiles.find((t) => t.slug === 'design').line, '2 skills · 1 draft');
  assert.equal(tiles.find((t) => t.slug === 'legal_compliance').line, '0 skills');
});

test('SA6b: Pause arms only on the word PAUSE and a reason; the live button requires confirmation', () => {
  assert.equal(PAUSE_WORD, 'PAUSE');
  assert.equal(pauseArmed({ typed: 'PAUSE', reason: 'Model provider incident' }), true);
  assert.equal(pauseArmed({ typed: 'PAU', reason: 'Model provider incident' }), false);
  assert.equal(pauseArmed({ typed: 'pause', reason: 'Model provider incident' }), false);
  assert.equal(pauseArmed({ typed: 'PAUSE', reason: 'short' }), false);
  assert.equal(reasonOk('   ten chars ok   '), true);
  assert.match(read('pages/hq/aiAgents/Operations.jsx'), /api.pauseAll\(reason,\s*confirm\)/);
});

test('SA6 guardrails: the three platform rules, no advice wording in the panel', () => {
  assert.deepEqual(GUARDRAILS.map((g) => g.rule), [
    'Never “advisor” or “advice” on AI surfaces', 'Legal and Capital skills explain or draft, never decide', 'No invented figures',
  ]);
  const prose = PAGE.replace(/GUARDRAILS[^\n]*/g, '');
  assert.doesNotMatch(prose, /\badvis(or|e)\b/i, 'the panel never offers advice outside the rule\'s own name');
});

test('the page reads only routes that exist, and writes only through H1\'s roster', () => {
  const calls = [...PAGE.matchAll(/teamAgentsApi\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)], ['roles']);
  assert.match(read('lib/api/teamAgents.js'), /axalSkills: \(\) => request\('\/teams\/skills'\),/);
  // D4158: the roster's four methods are the page's only admin calls, and its only writes.
  const admin = [...PAGE.matchAll(/adminAiAgentsApi\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(admin)].sort(), ['roster', 'rosterAgent', 'rosterDefaults', 'rosterUpdate']);
  assert.doesNotMatch(PAGE, /method: '(POST|PUT|PATCH|DELETE)'/);
  for (const label of ['Publish…', 'Re-run evals', 'Retire…']) {
    assert.match(PAGE, new RegExp(`<button type="button" disabled className=\\{BTN\\} title=\\{notYet\\('H2'\\)\\}>${label.replace('…', '…')}</button>`), label);
  }
});

test('people are never shown by email on this page', () => {
  assert.doesNotMatch(PAGE, /\.email\b/);
});
