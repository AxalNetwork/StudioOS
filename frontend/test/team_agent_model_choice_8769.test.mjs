// D8769 (#8769, `design/incoming/Team Agent and Model Choice Page.dc.html`) —
// choosing an agent and its model by the work, whether it can run, and what a
// run costs.
//
//   · the roster: "Can it run now" in the canvas's priority (paused, no
//     skills, not read, active), the team's engine as one line above the
//     table and never a row's pill, and both controls named by the displayed
//     name and what they open, never the persona's motto; ⋯ opens a real menu;
//   · the profile leads with readiness, what it does, skills, sponsor and cap,
//     then permissions; the persona stays whole under "About {name}";
//   · Who searches by work, "Good for" first, and each card leads with the work;
//   · the model step groups models by the work they support, marks the plan
//     lock and the team's allowlist, reads one estimate per model it can offer
//     ("≈ $0.20 per 100 runs"), says "Estimate unavailable" with a retry that
//     re-reads that model only, and shows token prices only on demand;
//   · coverage: eight empty rows read "No category is mapped yet.", and the
//     card says it is reading instead of drawing nothing.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/team_agent_model_choice_8769.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import { AgentProfile } from '../src/pages/team/AgentProfileSheet.jsx';
import { WhoStep } from '../src/pages/team/AddAgentSheet.jsx';
import ModelChoice from '../src/pages/team/ModelChoice.jsx';
import TeamCoverageCard, { CoverageTable } from '../src/pages/team/TeamCoverageCard.jsx';
import { coverageRows } from '../src/pages/team/skillsModel.js';
import { gallery, personaWork } from '../src/pages/team/personaModel.js';
import {
  ENGINE_NOTE, ROLE_JOB, aboutRuns, actionItems, agentReadiness, allowedModels, basisLine, capRunsLine, coverageSentence, engineNote,
  engineState, modelGroups, modelOffer, moreActionsLabel, per100Line, rowOpenLabel, strengthsLine,
} from '../src/pages/team/agentChoiceModel.js';

const h = React.createElement;
const render = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Avery Stone]' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    seen.push({ key: `${(init.method || 'GET').toUpperCase()} ${url.pathname}`, query: Object.fromEntries(url.searchParams) });
    return handle(url, init);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await tick(); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (node, name, arg) => { assert.ok(node, 'no node'); await act(async () => { props(node)[name](arg); }); await settle(); };
  return {
    seen, text: () => textOf(document.body), has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k], textOf: (id) => (byId(id) ? textOf(byId(id)) : null),
    radioIn: (id) => walk(byId(id) || { childNodes: [] }).map(props).find((p) => p?.type === 'radio'),
    click: (id) => fire(byId(id), 'onClick', { stopPropagation() {} }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const persona = (key, name, tagline, fit = ['finance']) => ({ key, name, tagline, natural_fit: fit, top_values: ['integrity', 'stewardship', 'curiosity'], risk: 3, story: `${name}'s story.`, goal: `${name}'s goal.`, values: {} });
const AGENT = (uid, over = {}) => ({
  uid, role_key: 'coo', persona: persona('tessaly', 'Tessaly', '[What do the instruments say?]'), first_name: null, last_name: null, model_id: 'm-a', model_label: '[Model A]',
  tools: [], sponsor: { uid: 'u1', name: '[Maya Ruiz]' }, status: 'active', paused_reason: null, monthly_cap_microusd: 25_000_000,
  month_spend: { available: true, value_microusd: 3_840_000 }, last_activity_at: null, project: null, skill_count: 3, ...over,
});

// ---------------------------------------------------------------- readiness

test('agentReadiness: paused, then no skills, then not read, then Active; an unread count is never Active', () => {
  // Mutations checked: the no-skills check placed before paused → the paused-with-no-skills row reads "No skills yet" and fails;
  // a missing skill_count treated as 0 → the not-read rows read "No skills yet" and fail; treated as ready → they read Active and fail.
  assert.deepEqual(agentReadiness({ status: 'active', skill_count: 3 }), { key: 'active', pill: 'Active', tone: 'ok', line: '3 skills' });
  assert.equal(agentReadiness({ status: 'active', skill_count: 1 }).line, '1 skill');
  assert.deepEqual(agentReadiness({ status: 'paused', skill_count: 0 }), { key: 'paused', pill: 'Paused', tone: 'amber', line: 'Paused · also no skills' });
  assert.equal(agentReadiness({ status: 'paused', skill_count: 2 }).line, 'Paused');
  assert.deepEqual(agentReadiness({ status: 'active', skill_count: 0 }), { key: 'no_skills', pill: 'No skills yet', tone: 'amber', line: 'Can’t run until a skill is added' });
  for (const missing of [undefined, null, '', 'x']) {
    const r = agentReadiness({ status: 'active', skill_count: missing });
    assert.equal(r.key, 'not_read', String(missing));
    assert.equal(r.pill, 'Not recorded');
  }
  assert.equal(agentReadiness({ status: 'active', source: 'mcp_client', skill_count: null }).key, 'active', 'an outside assistant holds no Axal skills');
});

test('the engine is read from agentEngineApi.engine and said once above the table, never as a row\'s pill', () => {
  // Mutation checked: agentReadiness taking the engine and returning "Off for this team" → the roster's Active pill fails under engine off.
  assert.equal(engineState({ status: 'off' }), 'off');
  assert.equal(engineState({ status: 'ready', data: { engine: 'on', halted: false, scope_paused: false } }), 'on');
  assert.equal(engineState({ status: 'ready', data: { engine: 'on', halted: true } }), 'platform');
  assert.equal(engineState({ status: 'ready', data: { engine: 'paused' } }), 'platform');
  assert.equal(engineState({ status: 'ready', data: { engine: 'on', scope_paused: true } }), 'team');
  for (const s of ['loading', 'error', 'refused']) assert.equal(engineState({ status: s }), 'unknown', s);
  assert.equal(engineNote('on'), null);
  assert.equal(engineNote('unknown'), null, 'an engine not read says nothing');
  const block = { available: true, value: { can_manage: true, agents: [AGENT('a1')] } };
  const off = render(h(AgentsCard, { block, kind: 'project', companyName: 'x', engine: 'off' }));
  assert.match(off, /role="status"[^>]*data-testid="team-agents-engine" data-engine="off">/);
  assert.match(renderedText(off), new RegExp(ENGINE_NOTE.off.replace(/[.]/g, '\\.')));
  assert.match(off, /data-testid="agent-can-run-a1" data-state="active"/, 'the row still says what the agent itself can do');
  assert.doesNotMatch(render(h(AgentsCard, { block, kind: 'project', companyName: 'x', engine: 'on' })), /team-agents-engine/);
});

// ---------------------------------------------------------------- the roster

test('the roster: columns lead with the work and whether it can run; every state has its words; controls are named by the displayed name', () => {
  // Mutations checked: the ⋯ label built from roleOrUnrecorded (the motto) → the motto check fails;
  // the row button's label without "open profile" → the name check fails; COLS left as Source/Status → the header check fails.
  const agents = [
    AGENT('a1'),
    AGENT('a2', { role_key: 'general_counsel', persona: persona('vesta', 'Vesta', '[Read the clause twice.]', ['legal']), status: 'paused', paused_reason: 'cap', skill_count: 2 }),
    AGENT('a3', { role_key: 'cmo', persona: persona('kade', 'Kade', '[Light ten lanterns.]', ['marketing']), skill_count: 0 }),
    AGENT('a4', { role_key: 'research_analyst', persona: persona('ryssa', 'Ryssa', '[If the plan survives me.]', ['product']), skill_count: undefined }),
  ];
  const html = render(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents } }, kind: 'project', companyName: 'x' }));
  const heads = [...html.matchAll(/role="columnheader"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Agent', 'What it does', 'Can it run now', 'Sponsor', 'This month', 'Actions']);
  for (const [uid, name, work, state, pill] of [
    ['a1', 'Tessaly', 'Operations', 'active', 'Active'],
    ['a2', 'Vesta', 'Legal', 'paused', 'Paused'],
    ['a3', 'Kade', 'Marketing and growth', 'no_skills', 'No skills yet'],
    ['a4', 'Ryssa', 'Research', 'not_read', 'Not recorded'],
  ]) {
    const row = html.slice(html.indexOf(`data-testid="agent-${uid}"`)).split('role="row"')[0];
    assert.match(row, new RegExp(`aria-label="${name}, AI agent, ${work}: open profile"[^>]*data-testid="agent-open-${uid}">${name}<`), uid);
    assert.match(row, new RegExp(`aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${name}"`), uid);
    assert.match(row, new RegExp(`data-testid="agent-can-run-${uid}" data-state="${state}"><span[^>]*>${pill}<`), uid);
    assert.match(row, new RegExp(`data-testid="agent-does-${uid}"><span[^>]*>${work}<`), uid);
  }
  assert.doesNotMatch(html, /Actions for the/);
  for (const motto of ['What do the instruments say', 'Read the clause twice', 'Light ten lanterns', 'If the plan survives me']) {
    assert.doesNotMatch(html, new RegExp(`<button[^>]*aria-label="[^"]*${motto}`), `no control is named by the motto: ${motto}`);
  }
  const text = renderedText(html);
  assert.match(text, /Can’t run until a skill is added/);
  assert.match(text, /Its skills could not be read/);
  assert.match(text, /Reached its monthly capRaise the cap/, 'the paused row keeps its reason and one fix');
  assert.equal(rowOpenLabel('Tessaly', { role_key: 'coo' }), 'Tessaly, AI agent, Operations: open profile');
  assert.equal(rowOpenLabel('[Iris]', { source: 'mcp_client' }), '[Iris], AI agent, Connected app: open profile');
  assert.equal(moreActionsLabel('Kade'), 'More actions for Kade');
});

test('⋯ opens a real menu: the profile for everyone, and a paused row\'s fix for a manager only', async () => {
  // Mutations checked: actionItems ignoring canManage → the reader's menu has the fix and fails; the fix picked without its action → onOpen gets null and fails.
  const paused = AGENT('a2', { persona: persona('vesta', 'Vesta', '[Read the clause twice.]'), status: 'paused', paused_reason: 'cap' });
  assert.deepEqual(actionItems({ name: 'Vesta', pause: { fix: 'Raise the cap', action: 'cap' } }, false).map((i) => i.label), ['Open Vesta’s profile']);
  assert.deepEqual(actionItems({ name: 'Vesta', pause: { fix: 'Raise the cap', action: 'cap' } }, true).map((i) => [i.label, i.action ?? null]), [['Open Vesta’s profile', null], ['Raise the cap', 'cap'], ['Add skills for Vesta', 'skills'], ['Change Vesta’s sponsor', 'sponsor']], 'part 3: the fix stands for Edit cap, which is not repeated');
  const opened = [];
  const v = await mount(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents: [paused] } }, kind: 'project', companyName: 'x', onOpen: (row, action) => opened.push([row.uid, action ?? null]) }), () => response({}));
  try {
    assert.equal(v.has('agent-menu-a2-items'), false, 'closed until pressed');
    await v.click('agent-menu-a2');
    assert.equal(v.prop('agent-menu-a2', 'aria-expanded'), true);
    assert.equal(v.textOf('agent-menu-a2-items'), 'Open Vesta’s profileRaise the capAdd skills for VestaChange Vesta’s sponsor');
    assert.equal(v.prop('agent-menu-a2-items', 'role'), 'menu');
    await v.click('agent-menu-a2-fix');
    await v.click('agent-menu-a2');
    await v.click('agent-menu-a2-open');
    await v.click('agent-open-a2');
    assert.deepEqual(opened, [['a2', 'cap'], ['a2', null], ['a2', null]]);
  } finally { await v.close(); }
  const r = await mount(h(AgentsCard, { block: { available: true, value: { can_manage: false, agents: [paused] } }, kind: 'project', companyName: 'x', onOpen() {} }), () => response({}));
  try {
    await r.click('agent-menu-a2');
    assert.equal(r.textOf('agent-menu-a2-items'), 'Open Vesta’s profile', 'a reader sees only the profile');
  } finally { await r.close(); }
});

// ---------------------------------------------------------------- the profile

test('the profile: readiness, what it does, skills, sponsor and cap, permissions; the persona whole under About', () => {
  // Mutation checked: the persona block moved back above the readiness section → the order check fails.
  const agent = { ...AGENT('a1'), reads_line: 'Works in Finance, Raise', skill_count: 0 };
  const html = render(h(AgentProfile, { data: { agent, matrix: [{ module: 'finance', label: 'Finance', read: true, propose: true }], month_spend: { available: true, value_microusd: 3_840_000 }, events: [] }, skills: h('section', { 'data-testid': 'skills-slot' }, 'Skills') }));
  const at = (needle) => { const i = html.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  const order = ['data-testid="agent-readiness"', 'data-testid="agent-does"', 'data-testid="skills-slot"', 'data-testid="agent-sponsor-cap"', 'aria-label="Permissions"', 'data-testid="agent-about"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const text = renderedText(html);
  assert.match(text, /No skills yetCan’t run until a skill is added/);
  assert.match(text, /What Tessaly doesArea of work · OperationsWorks in Finance, RaisePlatform model · \[Model A\]/);
  assert.match(text, /Sponsor and capSponsor: \[Maya Ruiz\]\$3\.84 of \$25 this month/);
  assert.match(html, /<details[^>]*data-testid="agent-about"><summary[^>]*>About Tessaly: story and values<\/summary>/);
  assert.match(text, /StoryTessaly's story\.Goal · Tessaly's goal\./, 'the persona story is kept');
});

// ---------------------------------------------------------------- who joins

test('Who: search by name or work, "Good for" first, and each card leads with the work it is good for', () => {
  // Mutation checked: gallery searching only the name, tagline, goal and personality → the "research" search fails.
  const personas = [persona('ryssa', 'Ryssa', '[If the plan survives me.]', ['product']), persona('orrin', 'Orrin', '[Every road ends at a market.]', ['finance', 'legal'])];
  assert.deepEqual(personaWork(personas[0]), ['Research', 'Product']);
  assert.deepEqual(personaWork(personas[1]), ['Finance', 'Legal']);
  assert.deepEqual(gallery(personas, { q: 'research' }).map((p) => p.key), ['ryssa']);
  assert.deepEqual(gallery(personas, { q: 'legal' }).map((p) => p.key), ['orrin']);
  const html = render(h(WhoStep, { block: { available: true, value: { personas, values: [] } }, scopeName: '[Atlas Orchard]', onTeam: new Set(), chosen: null, setChosen() {} }));
  assert.match(html, /placeholder="Search by name or work" aria-label="Search by name or work"/);
  assert.ok(html.indexOf('aria-label="Good for"') < html.indexOf('aria-label="Top core value"'), 'Good for is the first filter');
  assert.match(renderedText(html), /Good forResearch · Product/);
  assert.ok(html.indexOf('data-testid="agent-card-lead"') < html.indexOf('Core values'), 'the work comes before the values');
  assert.doesNotMatch(renderedText(html), /0 skills · cost per run/, 'no count it never read');
});

// ---------------------------------------------------------------- the model step

const M = (id, jobs, over = {}) => ({ id, label: id, kind: 'Text Generation', beta: false, plan_locked: false, jobs: jobs.map((k) => ({ key: k, label: k })), capabilities: ['Reasoning'], context_window: 128000, input_usd_per_million: 0.4375, output_usd_per_million: 0.9375, ...over });

test('modelGroups: the area\'s job first, the rest under the first job each is listed for, each model once', () => {
  // Mutations checked: suited models also kept in `others` → the once-only check fails; ROLE_JOB.research_analyst removed → no suited group and fails.
  const models = [M('gpt', ['research', 'reason']), M('kimi', ['research', 'read_images']), M('llama', ['write', 'plan']), M('qwen', ['reason', 'numbers']), M('odd', [])];
  const g = modelGroups(models, 'research_analyst');
  assert.equal(ROLE_JOB.research_analyst, 'research');
  assert.equal(g.suited.title, 'Suited to research');
  assert.deepEqual(g.suited.models.map((m) => m.id), ['gpt', 'kimi']);
  assert.deepEqual(g.others.map((o) => [o.title, o.models.map((m) => m.id)]), [['Reasoning', ['qwen']], ['Writing', ['llama']], ['Other work', ['odd']]]);
  const all = [...g.suited.models, ...g.others.flatMap((o) => o.models)].map((m) => m.id).sort();
  assert.deepEqual(all, ['gpt', 'kimi', 'llama', 'odd', 'qwen'], 'every model, once');
  assert.equal(modelGroups(models, 'cfo').suited.title, 'Suited to numbers');
  assert.equal(modelGroups(models, 'general_counsel').suited, null, 'no model is listed for legal here, so no suited group');
  assert.equal(modelGroups(models, null).suited, null);
});

test('modelOffer: the plan lock and the team\'s allowlist, and nothing marked on an allowlist that was not read', () => {
  // Mutation checked: an unread allowlist treated as "allows nothing" → every model reads Not allowed and fails.
  assert.equal(allowedModels({ available: true, value: { model_ids: null } }), null, 'the plan default');
  assert.deepEqual([...allowedModels({ available: true, value: { model_ids: ['gpt'] } })], ['gpt']);
  assert.equal(allowedModels({ available: false, unreadable: true }), 'unread');
  assert.equal(allowedModels(null), 'unread');
  const allow = new Set(['gpt']);
  assert.equal(modelOffer(M('gpt', []), allow), 'ok');
  assert.equal(modelOffer(M('kimi', []), allow), 'not_allowed');
  assert.equal(modelOffer(M('gpt', [], { plan_locked: true }), allow), 'plan');
  assert.equal(modelOffer(M('kimi', []), 'unread'), 'ok');
  assert.equal(modelOffer(M('kimi', []), null), 'ok');
});

test('the estimate\'s words come only from the Worker\'s answer: per 100 runs, the cap\'s runs, and its basis', () => {
  // Mutations checked: per100Line not multiplying by 100 → "$0.00" and fails; capRunsLine flooring the cap to whole dollars → the $12.50 case fails;
  // a missing estimate drawn as $0.00 → the null checks fail.
  assert.equal(per100Line({ available: true, est_usd_per_run: 0.002 }), '≈ $0.20 per 100 runs');
  assert.equal(per100Line({ available: true, est_usd_per_run: 0.0073 }), '≈ $0.73 per 100 runs');
  assert.equal(per100Line({ available: true, est_usd_per_run: 0.00003 }), '< $0.01 per 100 runs', 'a real fraction of a cent');
  assert.equal(per100Line({ available: false }), null);
  assert.equal(per100Line(null), null);
  assert.equal(capRunsLine({ available: true, est_usd_per_run: 0.002475 }, 25_000_000), 'A $25 cap pays for about 10,100 runs');
  assert.equal(capRunsLine({ available: true, est_usd_per_run: 0.002 }, 12_500_000), 'A $12.50 cap pays for about 6,250 runs');
  assert.equal(capRunsLine({ available: true, est_usd_per_run: 0.002 }, 0), null);
  assert.equal(capRunsLine({ available: false }, 25_000_000), null);
  assert.equal(aboutRuns(999.9), '999');
  assert.equal(aboutRuns(2702), '2,700');
  const basis = { request_tokens: 400, output_tokens: 800, priced_at: 'sponsor' };
  assert.match(basisLine({ available: true, skills: 1, basis }), /its largest skill and a 400-token request in, and a 800-token proposal out, at what you pay/);
  assert.equal(basisLine({ available: true }), null, 'no basis sent, none invented');
  assert.equal(strengthsLine({ capabilities: ['Function calling', 'Reasoning', 'Vision'], context_window: 262144 }), 'Reasons step by step · can use tools · also reads images · reads up to 262k tokens');
  assert.equal(strengthsLine({ capabilities: [], context_window: null }), null);
});

test('ModelChoice: grouped by work, plan and allowlist marked, one estimate per offered model, a retry for that model only, prices on demand', async () => {
  // Mutations checked: estimates read for disallowed models too → the request list fails; Try again re-reading every model → the count fails;
  // prices drawn by default → the hidden check fails.
  const models = [M('gpt', ['research']), M('kimi', ['research']), M('nemo', ['research']), M('deep', ['research'], { plan_locked: true }), M('llama', ['write'])];
  const allow = { model_ids: ['gpt', 'kimi', 'deep', 'llama'] };
  const est = { available: true, skills: 1, est_usd_per_run: 0.002, basis: { request_tokens: 400, output_tokens: 800, priced_at: 'sponsor' } };
  let kimiFails = true;
  const handle = (url) => {
    if (url.pathname.endsWith('/cost-estimate')) {
      const m = url.searchParams.get('model');
      if (m === 'kimi' && kimiFails) return response({ available: false, reason: 'pricing_unreadable' });
      return response({ ...est, model: m });
    }
    return response({});
  };
  let chosen = null;
  const draft = { kind: 'company', id: 'co1', role: 'research_analyst', persona: 'ryssa', skills: ['s1'] };
  const v = await mount(h(ModelChoice, { models, draft, allowBlock: { available: true, value: allow }, model: null, setModel: (id) => { chosen = id; }, onEstimate() {} }), handle);
  try {
    const asked = () => v.seen.filter((s) => s.key === 'GET /api/teams/company/co1/cost-estimate').map((s) => s.query.model).sort();
    assert.deepEqual(asked(), ['gpt', 'kimi'], 'only the suited models that can be chosen; Other models waits until opened');
    const q = v.seen.find((s) => s.query.model === 'gpt').query;
    assert.deepEqual(q, { model: 'gpt', role: 'research_analyst', persona: 'ryssa', skills: 's1' });
    assert.equal(v.prop('model-group-suited', 'role'), 'radiogroup');
    assert.equal(v.prop('model-group-suited', 'aria-label'), 'Suited to research');
    assert.equal(v.textOf('model-est-gpt'), '≈ $0.20 per 100 runs');
    assert.equal(v.textOf('model-est-kimi'), 'Estimate unavailable');
    assert.equal(v.prop('model-retry-kimi', 'aria-label'), 'Try the estimate for kimi again');
    assert.equal(v.textOf('model-est-nemo'), 'Not allowed on this team');
    assert.equal(v.radioIn('model-nemo').disabled, true);
    assert.equal(v.textOf('model-est-deep'), 'Not on your plan');
    assert.equal(v.radioIn('model-deep').disabled, true);
    assert.equal(v.has('model-prices-gpt'), false, 'token prices wait for a press');
    assert.equal(v.prop('model-prices-toggle', 'aria-expanded'), false);
    await v.click('model-prices-toggle');
    assert.equal(v.prop('model-prices-toggle', 'aria-expanded'), true);
    assert.equal(v.textOf('model-prices-gpt'), 'Input $0.4375 / 1M tokens · Output $0.9375 / 1M tokens');
    kimiFails = false;
    await v.click('model-retry-kimi');
    assert.deepEqual(asked(), ['gpt', 'kimi', 'kimi'], 'Try again re-reads that model only');
    assert.equal(v.textOf('model-est-kimi'), '≈ $0.20 per 100 runs');
    assert.match(v.text(), /How the estimate is worked out/);
    assert.match(v.text(), /a 400-token request in, and a 800-token proposal out/);
    assert.match(v.text(), /Other models this team allows · Writing 1/);
    await v.radioIn('model-gpt').onChange();
    assert.equal(chosen, 'gpt');
  } finally { await v.close(); }
});

test('ModelChoice: no model allowed says so, and an unread allowlist is said, not guessed', async () => {
  const models = [M('gpt', ['research']), M('llama', ['write'])];
  const none = await mount(h(ModelChoice, { models, draft: { kind: 'project', id: 7, role: 'cfo', skills: [] }, allowBlock: { available: true, value: { model_ids: [] } }, model: null, setModel() {} }), () => response({ available: false }));
  try {
    assert.match(none.text(), /No model is allowed for this team\. An editor sets the allowed models in Team › Settings\./);
    assert.equal(none.seen.filter((s) => s.key.endsWith('/cost-estimate')).length, 0, 'nothing to estimate');
  } finally { await none.close(); }
  const unread = await mount(h(ModelChoice, { models, draft: { kind: 'project', id: 7, role: 'cfo', skills: [] }, allowBlock: { available: false, unreadable: true }, model: null, setModel() {} }), () => response({ available: false }));
  try {
    assert.match(unread.text(), /The models this team allows could not be read\. Adding still checks them\./);
    assert.equal(unread.radioIn('model-gpt').disabled, false);
  } finally { await unread.close(); }
});

// ---------------------------------------------------------------- coverage

test('coverage: eight empty rows read "No category is mapped yet.", the old sentence only when agents are mapped, and loading is said', () => {
  // Mutations checked: coverageSentence falling back to "Every category…" for empty rows → the zero case fails;
  // the card returning null while it reads → the Reading check fails.
  const empty = coverageRows([]);
  assert.equal(coverageSentence(empty).kind, 'zero');
  const zero = renderedText(render(h(CoverageTable, { axes: [] })));
  assert.match(zero, /No category is mapped yet\.Nobody on this team, person or agent, has a recorded level in any of the eight categories\./);
  assert.doesNotMatch(zero, /Every category with an agent on it also has a person on it/);
  const covered = coverageRows([{ slug: 'finance_ops', people_level: 3, agent_level: 2 }]);
  assert.equal(coverageSentence(covered).text, 'Every category with an agent on it also has a person on it.');
  assert.equal(coverageSentence(coverageRows([{ slug: 'finance_ops', people_level: 3 }])).text, 'No agent covers a category yet.');
  const gap = coverageSentence(coverageRows([{ slug: 'legal_compliance', agent_level: 3 }]));
  assert.equal(gap.kind, 'gaps');
  assert.match(gap.text, /^One people gap: .* is covered only by an agent\.$/);
  const reading = render(h(TeamCoverageCard, { kind: 'project', id: 7 }));
  assert.match(reading, /aria-busy="true"[^>]*data-testid="team-coverage-reading"><p role="status"[^>]*>Reading team coverage…<\/p>/);
});
