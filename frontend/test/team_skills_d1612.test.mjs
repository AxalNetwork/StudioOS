// D1612 (#3952, part C of #3945) — Team › Skills: the client and its seam, the
// model's rules, and the screens mounted on a stubbed fetch: the roles and a
// role's directory, a skill's page and "Assign to agents…", the new-skill
// sheet's two modes, the agent's Skills card and radar, and the Skills step
// in Add an agent. Sample names are fixtures only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/team_skills_d1612.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import * as adapter from '../src/pages/team/agentsAdapter.js';
import { TABS } from '../src/pages/team/teamModel.js';
import { assignHint, draftBody, groupAgents, libraryGroups, moveStep, radarVector, skillFileName, tagChip, usedByWords } from '../src/pages/team/skillsModel.js';
import SkillsTab from '../src/pages/team/SkillsTab.jsx';
import { AssignSheet } from '../src/pages/team/SkillDetailSheet.jsx';
import SkillEditorSheet from '../src/pages/team/SkillEditorSheet.jsx';
import { AgentSkillsView } from '../src/pages/team/AgentSkillsCard.jsx';
import AddAgentSheet from '../src/pages/team/AddAgentSheet.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const render = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// ---------------------------------------------------------------- fixtures

const TAGS = [{ slug: 'investor_reporting', label: 'Investor reporting', category: 'finance_ops', level: 'proficient' }];
const skill = (over = {}) => ({
  uid: 's'.repeat(31) + '1', scope: 'hq', slug: 'monthly-update', status: 'published', version: 2, author: 'Axal',
  name: '[Draft the monthly investor update]', purpose: 'From recorded metrics.', steps: ['Read the metrics', 'Draft it'], tools: [],
  output_kind: 'draft', roles: [{ key: 'cfo', label: 'CFO' }], tags: TAGS, used_by: 3, updated_at: '2026-11-01 10:00:00', can_write: false, ...over,
});
const LIBRARY = {
  roles: [{ key: 'cfo', label: 'CFO', skills: 2, agents: 1 }, { key: 'investor_relations', label: 'Investor relations', skills: 0, agents: 0 }],
  hq: [skill()],
  company: { uid: 'nw1', name: '[Northwind Labs]', skills: [skill({ uid: 'c'.repeat(32), scope: 'company', author: '[Northwind Labs]', name: '[Board brief]', used_by: 0, tools: ['hubspot.read_deals'] })], can_write: true },
  can_write_hq: false,
};
const AGENT_CFO = { uid: 'a'.repeat(32), role_key: 'cfo', role_name: 'CFO', first_name: '[Nora]', last_name: '[Vale]', status: 'active', tools: [], scope_kind: 'company', project: null };
const AGENT_IR = { uid: 'b'.repeat(32), role_key: 'investor_relations', role_name: 'Investor relations', first_name: '[Ivy]', status: 'active', tools: [], scope_kind: 'company', project: null };
const AGENT_PROJECT = { ...AGENT_CFO, uid: 'p'.repeat(32), first_name: '[Rory]', scope_kind: 'project', project: { id: 7, name: '[Rocket]' } };

// ---------------------------------------------------------------- a stubbed Worker

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const refusal = (status, code, extra = {}) => response({ ...extra, error: code, message: extra.message || 'A sentence from the Worker.', detail: extra.message || 'A sentence from the Worker.' }, status);

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Avery Stone]' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push({ key, url: String(u), body: init.body ? JSON.parse(init.body) : null });
    return (handle[key] || (() => response({ error: 'team_agents_off' }, 404)))(init, String(u));
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const ctx = { company: null, setCompany() {}, companies: [], setCompanies() {} };
  await act(async () => root.render(h(MemoryRouter, null, h(ActiveCompanyContext.Provider, { value: ctx }, h(Routes, null, h(Route, { path: '*', element }))))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  const inside = (id) => walk(byId(id) || { childNodes: [] }).map(props).filter(Boolean);
  return {
    seen, text: () => textOf(document.body), has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k], inside,
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v } }),
    async check(id) { const box = inside(id).find((p) => p.type === 'checkbox'); assert.ok(box, `no checkbox in ${id}`); await act(async () => { box.onChange(); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ---------------------------------------------------------------- the client and the seam

test('the client: one module for #3951\'s routes, re-exported from api.js, and the seam calls it', () => {
  const client = read('frontend/src/lib/api/teamSkills.js');
  for (const path of ["'/teams/skills'", '`/teams/skills/${enc(uid)}`', '`/teams/skills/${enc(uid)}/publish`', '`/teams/skills/${enc(uid)}/assign`', '`/teams/agents/${enc(uid)}/skills`']) {
    assert.ok(client.includes(path), path);
  }
  assert.match(read('frontend/src/lib/api.js'), /^export \* from '\.\/api\/teamSkills\.js';$/m);
  const seam = codeOnly(read('frontend/src/pages/team/agentsAdapter.js'));
  for (const m of ['skillLibrary', 'skill', 'createSkill', 'updateSkill', 'publishSkill', 'assignSkill', 'agentSkills', 'setAgentSkills']) {
    assert.match(seam, new RegExp(`export const ${m} = [^\\n]*throughSkill\\(\\(\\) => teamSkillsApi\\.${m}\\(`), m);
  }
  assert.deepEqual(TABS.map((t) => t.key), ['people', 'roles', 'skills', 'approvals', 'settings']);
});

test('throughSkill: switched off, a refusal in the Worker\'s own words with its refusals, unreadable never empty', async () => {
  const fail = (status, code, data, message = 'A sentence.') => adapter.throughSkill(() => Promise.reject(Object.assign(new Error(message), { status, code, data })));
  assert.deepEqual(await fail(404, 'team_agents_off'), { available: false, reason: 'AI agents aren’t switched on yet.' });
  const r = await fail(409, 'skill_not_attachable', { refusals: [{ agent_uid: 'x', reason: 'Needs the hubspot.read_deals tool.' }] }, 'Needs the hubspot.read_deals tool.');
  assert.equal(r.reason, 'Needs the hubspot.read_deals tool.');
  assert.deepEqual(r.refusals, [{ agent_uid: 'x', reason: 'Needs the hubspot.read_deals tool.' }]);
  assert.equal((await fail(400, 'tag_unknown', null, 'One of the tags is not a skill in the /studio taxonomy.')).reason, 'One of the tags is not a skill in the /studio taxonomy.');
  assert.deepEqual(await fail(500, 'boom'), { available: false, unreadable: true, reason: 'could not be read' });
  assert.deepEqual(await adapter.throughSkill(async () => ({ hq: [] })), { available: true, value: { hq: [] } });
});

// ---------------------------------------------------------------- the model

test('the model: "Not recorded" axes stay out of the radar, greying in words, groups, file names', () => {
  const radar = radarVector([
    { slug: 'finance_ops', label: 'Finance / Ops', value: { available: true, value: 3 } },
    { slug: 'product', label: 'Product', value: { available: false, reason: 'Not recorded' } },
  ]);
  assert.deepEqual(radar.vector, { finance_ops: 3 });
  assert.equal('product' in radar.vector, false, 'never a 0');
  assert.deepEqual(radar.missing, ['Product']);
  assert.equal(radarVector([{ slug: 'product', value: { available: false } }]).recorded, false);
  assert.equal(assignHint(skill(), AGENT_CFO), null);
  assert.equal(assignHint(skill(), AGENT_IR), "This skill is not one of the Investor relations role's skills.");
  assert.equal(assignHint(skill({ tools: ['hubspot.read_deals'] }), AGENT_CFO), "Needs the hubspot.read_deals tool, which this agent's sponsor hasn't approved.");
  assert.equal(assignHint(skill({ tools: ['hubspot.read_deals'] }), { ...AGENT_CFO, tools: [{ integration_uid: 'i', tool: 'hubspot.read_deals' }] }), null);
  const g = groupAgents([AGENT_CFO, AGENT_PROJECT], '[Northwind Labs]');
  assert.deepEqual([g.agents.map((a) => a.uid), g.projects.map((p) => [p.name, p.agents.length])], [[AGENT_CFO.uid], [['[Rocket]', 1]]]);
  assert.equal(skillFileName({ slug: 'monthly-update' }), 'monthly-update.skill.md');
  assert.equal(tagChip(TAGS[0]), 'Investor reporting · Proficient');
  assert.equal(usedByWords(1), 'Used by 1 agent');
  assert.equal(usedByWords(undefined), 'Not recorded');
  assert.deepEqual(moveStep(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(moveStep(['a', 'b'], 0, -1), ['a', 'b']);
  assert.deepEqual(draftBody({ name: ' N ', purpose: 'P', steps: ['x', ' ', 'y'], tools: [], output_kind: 'brief', roles: ['cfo'], tags: [{ slug: 'a', level: 'aware' }, { slug: 'b' }] }),
    { name: 'N', purpose: 'P', steps: ['x', 'y'], tools: [], output_kind: 'brief', roles: ['cfo'], tags: [{ slug: 'a', level: 'aware' }] });
  assert.equal(libraryGroups({}).company, null);
});

// ---------------------------------------------------------------- the agent's Skills card

test('SK4: no skills draws no radar and says "Not recorded"; Update to vN and Remove are for its managers', () => {
  const none = renderedText(render(h(AgentSkillsView, { data: { skills: [], radar: [{ slug: 'product', label: 'Product', value: { available: false, reason: 'Not recorded' } }] }, canManage: false })));
  assert.match(none, /Skills profile: Not recorded\./);
  assert.match(none, /This agent has no skills yet\./);
  assert.doesNotMatch(none, /Add skills/);
  const data = {
    skills: [{ ...skill(), version: 1, latest_version: 2, update_available: true }],
    radar: [{ slug: 'finance_ops', label: 'Finance / Ops', value: { available: true, value: 3 } }, { slug: 'design', label: 'Design', value: { available: false, reason: 'Not recorded' } }],
  };
  const html = render(h(AgentSkillsView, { data, canManage: true, onUpdate() {}, onRemove() {}, onAdd() {} }));
  assert.match(html, /data-testid="agent-skills-radar"/);
  const text = renderedText(html);
  assert.match(text, /Not recorded: Design\./);
  assert.match(text, /Update to v2/);
  assert.match(text, /Remove/);
  assert.match(text, /Add skills/);
  assert.doesNotMatch(renderedText(render(h(AgentSkillsView, { data, canManage: false }))), /Update to v2|Remove|Add skills/);
});

// ---------------------------------------------------------------- the Skills tab

test('SK0 and SK1: the roles, then a role\'s directory in two groups; New skill only for a writer', async () => {
  const handle = { 'GET /api/teams/skills': () => response(LIBRARY) };
  const v = await mount(h(SkillsTab, { scope: { kind: 'company', company: { uid: 'nw1', name: '[Northwind Labs]' } }, teamAgents: [AGENT_CFO] }), handle);
  try {
    assert.ok(v.has('skills-roles'));
    assert.match(v.text(), /CFO2 skills · 1 agent/);
    assert.ok(v.has('skills-new'), 'the company can_write');
    await v.click('skills-role-cfo');
    const last = v.seen.at(-1).url;
    assert.match(last, /company=nw1/);
    assert.match(last, /role=cfo/);
    assert.match(last, /sort=popular/);
    assert.ok(v.has('skills-group-hq') && v.has('skills-group-company'));
    const text = v.text();
    assert.match(text, /From Axal/);
    assert.match(text, /\[Northwind Labs\]'s skills/);
    assert.match(text, /Investor reporting · Proficient/);
    assert.match(text, /Used by 3 agents/);
    assert.match(text, /Used by 0 agents/, 'a recorded 0 is 0');
    await v.click('skills-category-finance_ops');
    assert.match(v.seen.at(-1).url, /category=finance_ops/);
  } finally { await v.close(); }
  const reader = await mount(h(SkillsTab, { scope: { kind: 'project', project: { id: 8, name: '[Solo]' } } }), {
    'GET /api/teams/skills': () => response({ ...LIBRARY, company: null, can_write_hq: false }),
  });
  try {
    assert.ok(!reader.has('skills-new'), 'no New skill for a reader');
    assert.doesNotMatch(reader.seen[0].url, /company=/, 'a standalone project reads Axal\'s skills only');
  } finally { await reader.close(); }
});

test('SK9: "Skills could not be read · Try again", switched off, never "none"', async () => {
  let calls = 0;
  const v = await mount(h(SkillsTab, { scope: { kind: 'company', company: { uid: 'nw1', name: 'x' } } }), {
    'GET /api/teams/skills': () => { calls += 1; return calls === 1 ? response({ error: 'boom' }, 500) : response(LIBRARY); },
  });
  try {
    assert.match(v.text(), /Skills could not be read\. That is not the same as having none\.Try again/);
    await v.click('skills-retry');
    assert.equal(calls, 2);
    assert.ok(v.has('skills-roles'), 'the second read draws the roles');
  } finally { await v.close(); }
  const off = await mount(h(SkillsTab, { scope: { kind: 'company', company: { uid: 'nw1', name: 'x' } } }), {});
  try { assert.match(off.text(), /AI agents aren’t switched on yet\. That is not the same as having none\./); } finally { await off.close(); }
});

// ---------------------------------------------------------------- assign, edit, add

test('SK3: an agent the Worker would refuse is greyed with its reason; Save is all or nothing and says how many', async () => {
  const s = skill({ tools: [] });
  let done = '';
  const v = await mount(h(AssignSheet, { skill: s, teamAgents: [AGENT_CFO, AGENT_IR, AGENT_PROJECT], companyName: '[Northwind Labs]', onClose() {}, onDone: (w) => { done = w; } }), {
    [`POST /api/teams/skills/${s.uid}/assign`]: () => response({ added: 2, already: 0, used_by: 5 }),
  });
  try {
    assert.match(v.text(), /This skill is not one of the Investor relations role's skills\./);
    assert.equal(v.inside(`assign-agent-${AGENT_IR.uid}`).find((p) => p.type === 'checkbox').disabled, true);
    assert.match(v.text(), /\[Northwind Labs\] › \[Rocket\]/);
    await v.check(`assign-agent-${AGENT_CFO.uid}`);
    await v.check(`assign-agent-${AGENT_PROJECT.uid}`);
    await v.click('assign-save');
    assert.deepEqual(v.seen.at(-1).body, { agents: [AGENT_CFO.uid, AGENT_PROJECT.uid] });
    assert.equal(done, 'Added to 2 agents.');
  } finally { await v.close(); }
  const refused = await mount(h(AssignSheet, { skill: s, teamAgents: [AGENT_CFO], onClose() {}, onDone() {} }), {
    [`POST /api/teams/skills/${s.uid}/assign`]: () => refusal(409, 'skill_not_attachable', { message: 'This skill belongs to another company.', refusals: [{ agent_uid: AGENT_CFO.uid, reason: 'This skill belongs to another company.' }] }),
  });
  try {
    await refused.check(`assign-agent-${AGENT_CFO.uid}`);
    await refused.click('assign-save');
    assert.match(refused.text(), /This skill belongs to another company\./);
    assert.ok(!refused.text().includes('skill_not_attachable'));
  } finally { await refused.close(); }
});

test('SK7: Paste a SKILL.md posts the text as it is, as a draft; Write then Publish posts the draft and publishes it', async () => {
  const created = skill({ uid: 'n'.repeat(32), status: 'draft', version: null, can_write: true });
  let saved = null;
  const handle = {
    'GET /api/skills/taxonomy': () => response({ categories: [{ slug: 'finance_ops', label: 'Finance / Ops', skills: [{ slug: 'investor_reporting', label: 'Investor reporting' }] }] }),
    'POST /api/teams/skills': () => response({ skill: created }, 201),
    [`POST /api/teams/skills/${created.uid}/publish`]: () => response({ skill: { ...created, version: 1, status: 'published' } }),
  };
  const props = { company: { uid: 'nw1', name: '[Northwind Labs]' }, canWriteHq: false, canWriteCompany: true, roles: LIBRARY.roles, presetRole: 'cfo', onClose() {}, onSaved: (s) => { saved = s; } };
  const v = await mount(h(SkillEditorSheet, props), handle);
  try {
    await v.click('skill-mode-paste');
    await v.change('skill-paste', '---\nname: "x"\ndescription: "y"\n---\n1. a');
    await v.click('skill-save-draft');
    assert.deepEqual(v.seen.find((s) => s.key === 'POST /api/teams/skills').body, { scope: 'company', company: 'nw1', skill_md: '---\nname: "x"\ndescription: "y"\n---\n1. a' });
    assert.equal(saved.uid, created.uid);
  } finally { await v.close(); }
  const w = await mount(h(SkillEditorSheet, props), handle);
  try {
    await w.change('skill-name', '[Board brief]');
    await w.change('skill-purpose', 'Before each board meeting.');
    await w.change('skill-tag-investor_reporting', 'working');
    await w.click('skill-save-publish');
    const post = w.seen.find((s) => s.key === 'POST /api/teams/skills').body;
    assert.deepEqual(post, { scope: 'company', company: 'nw1', name: '[Board brief]', purpose: 'Before each board meeting.', steps: [], tools: [], output_kind: 'draft', roles: ['cfo'], tags: [{ slug: 'investor_reporting', level: 'working' }] });
    assert.ok(w.seen.some((s) => s.key === `POST /api/teams/skills/${created.uid}/publish`));
    assert.equal(saved.version, 1);
  } finally { await w.close(); }
  const bad = await mount(h(SkillEditorSheet, props), { ...handle, 'POST /api/teams/skills': () => refusal(400, 'steps_invalid', { message: 'Give between 1 and 20 steps, each up to 400 characters.' }) });
  try {
    await bad.change('skill-name', 'n'); await bad.change('skill-purpose', 'p');
    await bad.click('skill-save-draft');
    assert.match(bad.text(), /Give between 1 and 20 steps, each up to 400 characters\./);
  } finally { await bad.close(); }
});

test('SK6: Add an agent\'s Skills step pre-selects the role\'s skills its tools cover and saves them on the new agent', async () => {
  const covered = skill({ uid: 'k'.repeat(32), name: '[Covered]' });
  const needsTool = skill({ uid: 'm'.repeat(32), name: '[Needs a tool]', tools: ['hubspot.read_deals'] });
  const newUid = 'z'.repeat(32);
  const handle = {
    'GET /api/teams/skills': () => response({ ...LIBRARY, hq: [covered, needsTool], company: null }),
    'POST /api/teams/company/nw1/agents': () => response({ agent: { uid: newUid, role_key: 'cfo' } }, 201),
    [`PUT /api/teams/agents/${newUid}/skills`]: () => response({ agent: { uid: newUid }, skills: [], radar: [], can_manage: true }),
  };
  const roles = [{ key: 'cfo', name: 'CFO', mission: 'Keeps the money honest.', works_in: [], default_rules: {} }];
  const v = await mount(h(AddAgentSheet, { scope: { kind: 'company', company: { uid: 'nw1' } }, companyUid: 'nw1', roles, models: [{ id: 'm-a', label: '[Model A]' }], held: [], me: { name: '[Avery Stone]' }, onClose() {}, onAdded() {} }), handle);
  try {
    await v.click('add-agent-role-cfo');
    await v.click('add-agent-next');
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
    const radio = walk(document.body).map(props).find((p) => p?.type === 'radio' && p?.name === 'model');
    await act(async () => { radio.onChange(); });
    await v.click('add-agent-next');
    assert.match(v.seen.at(-1).url, /role=cfo/);
    assert.equal(v.inside(`add-agent-skill-${covered.uid}`).find((p) => p.type === 'checkbox').checked, true, 'pre-selected');
    const blocked = v.inside(`add-agent-skill-${needsTool.uid}`).find((p) => p.type === 'checkbox');
    assert.deepEqual([blocked.checked, blocked.disabled], [false, true]);
    assert.match(v.text(), /Needs the hubspot\.read_deals tool, which this agent's sponsor hasn't approved\./);
    await v.click('add-agent-next');
    assert.match(v.text(), /\[Covered\]/);
    await v.change('add-agent-cap', '25');
    await v.click('add-agent-next');
    assert.deepEqual(v.seen.find((s) => s.key === `PUT /api/teams/agents/${newUid}/skills`).body, { skills: [{ uid: covered.uid }] });
  } finally { await v.close(); }
});

test('no Team file reaches the network itself, and the screens say "Ask", never "Fill"', () => {
  for (const f of ['SkillsTab.jsx', 'SkillDetailSheet.jsx', 'SkillEditorSheet.jsx', 'AgentSkillsCard.jsx', 'skillsModel.js']) {
    const src = read(`frontend/src/pages/team/${f}`);
    assert.doesNotMatch(src, /request\(|fetch\(/, f);
    assert.doesNotMatch(codeOnly(src), /\bFill\b/, f);
    assert.doesNotMatch(src, /\badvi(c|s)e\b/i, `${f}: never "advice" on an AI surface`);
  }
});
