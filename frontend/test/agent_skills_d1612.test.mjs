// D1612 (#3945, #3952) — Team › Agents › Skills, boards SK0–SK9.
//
// The model (levels, categories, sort, radar, coverage, the SKILL.md preview),
// each board's view in its states, the seam (every skill read and write is
// unavailable until A1 #3951 and A2 #3956 land, and no client method exists
// for them yet), and the canvases. Names and figures are the canvas's own
// samples, used as fixtures only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/agent_skills_d1612.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import * as adapter from '../src/pages/team/agentsAdapter.js';
import {
  LEVELS, assignGroups, coverageRows, coverageSummary, directory, groups, levelOf, parseSkillMd, previewRadar, problemWords, radarLines,
  radarVector, scopeChip, skillFileName, skillRefusalWords, tagChip, updateLabel, usedBy,
} from '../src/pages/team/skillsModel.js';
import { TABS, tabFrom } from '../src/pages/team/teamModel.js';
import { Directory, RoleTile, SkillFigures, SkillPage, SkillsUnreadable, UsingAgents } from '../src/pages/team/SkillsTab.jsx';
import { AgentSkillsView, ValuesCard } from '../src/pages/team/AgentSkillsCard.jsx';
import { CoverageTable } from '../src/pages/team/TeamCoverageCard.jsx';
import { PastePreview, assignedWords } from '../src/pages/team/SkillSheets.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const TEAM = 'frontend/src/pages/team';
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));

// ---------------------------------------------------------------- fixtures (SK1's samples)

const tag = (category_slug, category_label, level, skill_label) => ({ category_slug, category_label, level, skill_slug: `${category_slug}-x`, skill_label: skill_label || category_label });
const AX = [
  { uid: 's1', scope: 'hq', author: { kind: 'axal' }, name: 'Monthly investor update', description: 'Drafts the monthly update from your recorded figures and milestones.', roles: ['ir'], taxonomy: [tag('capital_network', 'Capital / Network', 3, 'Investor relations'), tag('finance_ops', 'Finance / Ops', 2)], tools: [{ key: 'mercury.read', label: 'Mercury' }, { key: 'stripe.read', label: 'Stripe' }], output_kind: 'draft', output_label: 'An update draft in Grow › Updates', version: 3, status: 'published', used_by: 214 },
  { uid: 's2', scope: 'hq', author: { kind: 'axal' }, name: 'Data room checklist', description: 'Finds gaps in the data room against the diligence list.', roles: ['ir'], taxonomy: [tag('legal_compliance', 'Legal / Compliance', 2)], tools: [{ key: 'dataroom.read', label: 'Data room' }], output_kind: 'record_change', version: 2, status: 'published', used_by: 168 },
  { uid: 's3', scope: 'hq', author: { kind: 'axal' }, name: 'Cap table summary for diligence', description: 'Writes a one-page ownership summary.', roles: ['fo'], taxonomy: [tag('finance_ops', 'Finance / Ops', 3)], tools: [], output_kind: 'brief', version: 1, status: 'published', used_by: null },
];
const CO = [{ uid: 'c1', scope: 'company', author: { kind: 'company', name: '[Northwind Labs]' }, name: '[Northwind] board pack', description: 'Assembles the quarterly board pack outline.', roles: ['ir'], taxonomy: [tag('finance_ops', 'Finance / Ops', 3)], tools: [{ key: 'notion.read', label: 'Notion' }], output_kind: 'draft', version: 1, status: 'published', used_by: 2 }];
const LIB = { can_edit: true, figures: { skills: { axal: 52, company: 16 }, updates_available: 3 }, roles: [{ key: 'ir', skill_count: 12, agent_count: 3 }, { key: 'sd', skill_count: 8, agent_count: 0 }], skills: [...AX, ...CO] };
const ROLE = { key: 'ir', name: 'Investor relations', mission: 'Investor updates, data rooms and follow-ups.' };

// ---------------------------------------------------------------- the model

test('levels and chips use the /studio scale; a chip without a level is not drawn', () => {
  assert.deepEqual(LEVELS.slice(1), ['Aware', 'Working', 'Proficient', 'Advanced', 'Expert']);
  assert.equal(levelOf('proficient'), 3);
  assert.equal(levelOf(5), 5);
  assert.equal(levelOf(0), null);
  assert.equal(levelOf('guru'), null);
  assert.deepEqual(tagChip(tag('capital_network', 'Capital / Network', 3, 'Investor relations')), { text: 'Capital / Network · Proficient', title: 'Investor relations · Proficient' });
  assert.equal(tagChip({ category_slug: 'finance_ops', level: null }), null);
});

test('"Used by N agents" is the install count; no count is null, never 0', () => {
  assert.equal(usedBy(214), '214 agents');
  assert.equal(usedBy(1), '1 agent');
  assert.equal(usedBy(0), '0 agents', 'a counted zero is a zero');
  assert.equal(usedBy(null), null);
  assert.equal(usedBy(undefined), null);
});

test('SK1: role, category and search filter; Popular puts an uncounted skill last; groups split Axal from the company', () => {
  const all = [...AX, ...CO];
  assert.deepEqual(directory(all, { role: 'ir' }).map((s) => s.uid), ['s1', 's2', 'c1']);
  assert.deepEqual(directory(all, { category: 'legal_compliance' }).map((s) => s.uid), ['s2']);
  assert.deepEqual(directory(all, { q: 'board' }).map((s) => s.uid), ['c1']);
  assert.deepEqual(directory(all, { sort: 'popular' }).map((s) => s.uid), ['s1', 's2', 'c1', 's3']);
  assert.deepEqual(directory(all, { sort: 'az' }).map((s) => s.name)[0], '[Northwind] board pack');
  const g = groups(all);
  assert.deepEqual(g.axal.map((s) => s.uid), ['s1', 's2', 's3']);
  assert.deepEqual(g.company.map((s) => s.uid), ['c1']);
});

test('SK4: the radar is the Worker\'s; no skills is null ("Not recorded"), and only levelled axes are listed', () => {
  assert.equal(radarVector(null), null);
  assert.equal(radarVector({ axes: [{ slug: 'finance_ops', level: null }] }), null, 'all-null axes are not a radar of zeros');
  const radar = { axes: [{ slug: 'capital_network', label: 'Capital / Network', level: 4 }, { slug: 'finance_ops', label: 'Finance / Ops', level: 3 }, { slug: 'legal_compliance', label: 'Legal / Compliance', level: 2 }, { slug: 'design', level: null }] };
  const v = radarVector(radar);
  assert.equal(v.capital_network, 4);
  assert.equal(v.design, 0, 'drawn at the centre, never listed');
  assert.equal(Object.keys(v).length, 8);
  assert.deepEqual(radarLines(radar), [{ label: 'Capital / Network', text: 'Advanced' }, { label: 'Finance / Ops', text: 'Proficient' }, { label: 'Legal / Compliance', text: 'Working' }]);
  const next = previewRadar(radar, [{ taxonomy: [tag('legal_compliance', 'Legal / Compliance', 3)] }]);
  assert.equal(next.legal_compliance, 3, 'SK5: the preview raises Legal / Compliance to Proficient');
  assert.equal(next.capital_network, 4, 'and never lowers an axis');
});

test('SK8: an axis covered only by agents is a people gap; an unread level is "Not recorded"', () => {
  const rows = coverageRows([{ slug: 'legal_compliance', people_level: null, agent_level: 2 }, { slug: 'product', people_level: 4, agent_level: null }]);
  const legal = rows.find((r) => r.slug === 'legal_compliance');
  assert.deepEqual({ people: legal.people, agent: legal.agent, gap: legal.peopleGap }, { people: null, agent: 'Working', gap: true });
  assert.equal(rows.find((r) => r.slug === 'product').peopleGap, false);
  assert.equal(coverageSummary(rows), 'One people gap: Legal / Compliance is covered only by an agent.');
  const out = text(h(CoverageTable, { axes: [{ slug: 'legal_compliance', people_level: null, agent_level: 2 }] }));
  assert.match(out, /People gap · covered only by agents/);
  assert.match(out, /Agent · Working/);
  assert.match(out, /Not recorded/);
  assert.doesNotMatch(out, /\b0\b/);
});

test('SK3: agents are grouped by company, each company\'s own agents before its projects; "Added to 3 agents"', () => {
  const g = assignGroups([
    { uid: 'a2', name: 'IR', scope: { kind: 'project', company_name: '[Northwind Labs]', project_name: '[Pilot app]' } },
    { uid: 'a1', name: 'IR', scope: { kind: 'company', company_name: '[Northwind Labs]' } },
    { uid: 'a3', name: 'IR', scope: { kind: 'company', company_name: '[Bluefern Health]' } },
  ]);
  assert.deepEqual(g.map((x) => [x.company, x.agents.map((a) => a.uid)]), [['[Northwind Labs]', ['a1', 'a2']], ['[Bluefern Health]', ['a3']]]);
  assert.equal(assignedWords({ added: 3, refused: [] }), 'Added to 3 agents');
  assert.equal(assignedWords({ added: 1, refused: [{ agent_uid: 'x', code: 'tool_not_approved' }] }), 'Added to 1 agent. 1 could not be added.');
  assert.equal(scopeChip({ kind: 'project', company_name: 'Acme', project_name: 'Pilot app' }), 'Acme › Pilot app');
  assert.equal(scopeChip({ kind: 'company', company_name: 'Acme Inc.' }), 'Acme Inc.');
});

test('SK7 Paste: the preview parses the frontmatter and the steps, and flags a write tool before anything is saved', () => {
  const md = '---\nname: board-meeting-prep\nroles: [investor-relations]\ntools: [notion.read, hubspot.write]\noutput: draft\n---\n1. Read the last board notes.\n2. Outline the agenda.\n';
  const p = parseSkillMd(md);
  assert.equal(p.front.name, 'board-meeting-prep');
  assert.deepEqual(p.front.roles, ['investor-relations']);
  assert.deepEqual(p.steps, ['Read the last board notes.', 'Outline the agenda.']);
  assert.deepEqual(p.problems, ['write_tool']);
  assert.equal(p.rows.find((r) => r.key === 'tools').ok, false);
  assert.equal(problemWords('write_tool', p), 'Write tools aren’t allowed: agents only read. Replace hubspot.write with hubspot.read, or remove it.');
  assert.deepEqual(parseSkillMd('just text').problems, ['missing_name', 'unknown_role', 'no_steps']);
  assert.ok(parseSkillMd(`---\nname: x\nroles: [a]\n---\n1. y\n${'z'.repeat(33 * 1024)}`).problems.includes('too_long'));
  const out = html(h(PastePreview, { parsed: p }));
  assert.match(out, /data-testid="paste-problem-write_tool"/);
  assert.match(out, /data-testid="paste-row-tools" data-ok="0"/);
  assert.match(out, /data-testid="paste-row-name" data-ok="1"/);
});

test('a pasted SKILL.md is drawn as text: markup in it is escaped, never rendered', () => {
  const evil = { available: true, value: { skill: { ...AX[0], markdown: '---\nname: x\n---\n<img src=x onerror=alert(1)>', steps: ['<b>bold</b>'], versions: [] } } };
  const out = html(h(SkillPage, { block: evil, agentsBlock: { available: true, value: { agents: [] } }, roleNames: () => 'Investor relations', onBack() {}, onAssign() {}, canEdit: true }));
  assert.doesNotMatch(out, /<img src=x/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /&lt;b&gt;bold&lt;\/b&gt;/);
  for (const f of ['SkillsTab.jsx', 'SkillSheets.jsx', 'SkillParts.jsx', 'AgentSkillsCard.jsx']) assert.doesNotMatch(read(`${TEAM}/${f}`), /dangerouslySetInnerHTML/, f);
});

test('refusals come back in words, and update/file helpers', () => {
  assert.equal(skillRefusalWords('role_mismatch'), 'An agent can only be given skills of its own role.');
  assert.equal(skillRefusalWords('tool_not_approved', 'HubSpot'), 'Needs the HubSpot read tool, which its sponsor hasn’t approved.');
  assert.equal(skillRefusalWords('nope'), 'It could not be saved. Try again.');
  assert.equal(updateLabel({ pinned_version: 2, current_version: 3 }), 'Update to v3');
  assert.equal(updateLabel({ pinned_version: 3, current_version: 3 }), null);
  assert.equal(skillFileName({ name: 'Monthly investor update' }), 'monthly-investor-update.skill.md');
  assert.equal(skillFileName({ slug: '../../etc' }), 'etc.skill.md');
});

// ---------------------------------------------------------------- the boards

test('SK0: the Skills tab sits after People and agents; the figures and role tiles say "Not recorded" for a count not read', () => {
  assert.deepEqual(TABS.map((t) => t.key), ['people', 'skills', 'roles', 'approvals', 'settings']);
  assert.equal(tabFrom('?tab=skills'), 'skills');
  const figs = text(h(SkillFigures, { figures: LIB.figures }));
  assert.match(figs, /Skills available\s*68/);
  assert.match(figs, /From Axal 52 · yours 16/);
  assert.match(figs, /Agents with skills\s*Not recorded/);
  assert.match(figs, /Updates available\s*3/);
  assert.match(text(h(RoleTile, { role: ROLE, counts: LIB.roles[0], onOpen() {} })), /12 skills\s*3 agents/);
  const none = text(h(RoleTile, { role: { key: 'sd', name: 'Sales development' }, counts: LIB.roles[1], onOpen() {}, onAddAgent() {} }));
  assert.match(none, /No agents yet · Add one/);
  assert.match(text(h(RoleTile, { role: ROLE, counts: null, onOpen: null })), /Skills\s*Not recorded/);
  assert.doesNotMatch(text(h(RoleTile, { role: ROLE, counts: null, onOpen: null })), /\b0 skills/);
});

test('SK1: the directory groups From Axal and the company\'s skills, with Assign only for an editor', () => {
  const out = html(h(Directory, { role: ROLE, value: LIB, companyName: '[Northwind Labs]', canEdit: true, onBack() {}, onOpen() {}, onAssign() {}, onNew() {} }));
  const t = renderedText(out);
  assert.match(t, /From Axal\s*2/);
  assert.match(t, /\[Northwind Labs\]’s skills\s*1/);
  assert.match(t, /Capital \/ Network · Proficient/);
  assert.match(t, /Mercury · read/);
  assert.match(t, /Used by\s*214 agents/);
  assert.match(t, /By \[Northwind Labs\]/);
  assert.match(out, /data-testid="skill-assign-s1"/);
  assert.match(out, /data-testid="skills-new"/);
  for (const c of ['All', 'Product', 'Engineering', 'Design', 'GTM / Sales', 'Marketing / Brand', 'Finance / Ops', 'Legal / Compliance', 'Capital / Network']) assert.match(t, new RegExp(c.replace(/\//g, '\\/')));
  const ro = html(h(Directory, { role: ROLE, value: { ...LIB, can_edit: false }, companyName: '[Northwind Labs]', canEdit: false, onBack() {}, onOpen() {}, onAssign() {}, onNew() {} }));
  assert.doesNotMatch(ro, /skill-assign-|skills-new/);
  assert.match(renderedText(ro), /Only company editors add skills or assign them/);
  const empty = text(h(Directory, { role: { key: 'sd', name: 'Sales development' }, value: LIB, canEdit: true, onBack() {}, onOpen() {}, onAssign() {}, onNew() {} }));
  assert.match(empty, /No skills for Sales development yet\. Axal adds skills as roles grow; editors can write one\./);
});

test('SK2: the skill page shows steps, tags, tools, output, versions and the agents using it, grouped', () => {
  const block = { available: true, value: { can_edit: true, skill: { ...AX[0], markdown: '---\nname: monthly-investor-update\n---\n1. Read', steps: ['Read last month’s figures.', 'Draft highlights.'], versions: [{ version: 3, published_at: '2026-10-28', note: 'Adds the “Not recorded” step.' }] } } };
  const usingIt = { available: true, value: { agents: [{ uid: 'a1', name: 'Investor relations', pinned_version: 3, scope: { kind: 'company', company_name: '[Northwind Labs]' } }, { uid: 'a2', name: 'Investor relations', pinned_version: 2, scope: { kind: 'project', company_name: '[Northwind Labs]', project_name: '[Pilot app]' } }] } };
  const out = html(h(SkillPage, { block, agentsBlock: usingIt, canEdit: true, roleName: 'Investor relations', roleNames: () => 'Investor relations', onBack() {}, onAssign() {} }));
  const t = renderedText(out);
  for (const w of ['Monthly investor update', 'Read last month’s figures.', 'Draft highlights.', 'Adds the “Not recorded” step.', '[Pilot app] · project', 'A named person accepts it']) assert.ok(t.includes(w), w);
  for (const id of ['skill-copy', 'skill-download', 'skill-page-assign', 'skill-md']) assert.match(out, new RegExp(`data-testid="${id}"`), id);
  assert.match(text(h(UsingAgents, { block: { available: false, reason: 'x' } })), /Who uses it is not open yet/);
  assert.match(text(h(UsingAgents, { block: { available: false, unreadable: true } })), /could not be read/);
  assert.match(text(h(SkillsUnreadable, { onRetry() {} })), /Skills could not be read\.\s*Try again/);
});

test('SK4, SK9b: the agent\'s skills with pinned versions, Update to v3, a retired skill still pinned, and values "Set by"', () => {
  const value = {
    can_manage: true,
    skills: [{ uid: 's1', name: 'Monthly investor update', pinned_version: 2, current_version: 3, status: 'published', tools: [{ key: 'mercury.read', label: 'Mercury' }] },
      { uid: 'r1', name: 'Quarterly LP letter', pinned_version: 2, current_version: 2, status: 'retired', tools: [] }],
    radar: { axes: [{ slug: 'capital_network', label: 'Capital / Network', level: 4 }] },
    values: { set_by: '[Northwind Labs]', dims: [{ key: 'candour', label: 'Candour', value: 4, note: 'Says what the record shows.' }, { key: 'pace', label: 'Pace', value: null }] },
  };
  const out = html(h(AgentSkillsView, { value, agent: { uid: 'g1', role_name: 'Investor relations', scope: { kind: 'project', company_name: '[Northwind Labs]', project_name: '[Pilot app]' } }, canManage: true, onAdd() {}, onUpdate() {}, onRemove() {} }));
  const t = renderedText(out);
  assert.match(t, /\[Northwind Labs\] › \[Pilot app\]/);
  assert.match(t, /Update to v3/);
  assert.match(t, /Retired · still pinned/);
  assert.match(t, /keeps working at v2; pick a replacement/);
  assert.match(t, /Capital \/ Network · Advanced/);
  assert.match(t, /Values · set by \[Northwind Labs\]/);
  assert.match(t, /4 \/ 5/);
  assert.match(t, /Pace[\s\S]*Not recorded/, 'an unset value is "Not recorded", never 0 / 5');
  assert.doesNotMatch(t, /0 \/ 5/);
  assert.match(out, /data-testid="agent-skills-add"/);
  const none = text(h(AgentSkillsView, { value: { skills: [], radar: null, values: null }, agent: {}, canManage: false }));
  assert.match(none, /Not recorded/);
  assert.match(none, /This agent has no skills yet/);
  assert.match(none, /No values are set for this agent’s role/);
  assert.doesNotMatch(html(h(AgentSkillsView, { value, agent: {}, canManage: false })), /agent-skills-add|agent-skill-remove/);
  assert.match(text(h(ValuesCard, { values: null })), /A company sets them in the role’s rule book/);
});

// ---------------------------------------------------------------- the seam

test('every skill read and write is unavailable until A1 and A2 land, and no client method exists for them', async () => {
  const methods = ['skillLibrary', 'skill', 'createSkill', 'updateSkill', 'publishSkill', 'importSkill', 'agentSkills', 'setAgentSkills', 'availableSkills', 'skillAgents', 'assignable', 'assignSkill', 'coverage'];
  for (const m of methods) {
    assert.equal(typeof adapter[m], 'function', m);
    const out = await adapter[m]('company', 'nw1', {});
    assert.equal(out.available, false, m);
    assert.equal(out.reason, adapter.AGENTS_OFF_REASON, m);
  }
  const client = [read('frontend/src/lib/api.js'), ...readdirSync('frontend/src/lib/api').filter((f) => f.endsWith('.js')).map((f) => read(`frontend/src/lib/api/${f}`))].join('\n');
  assert.doesNotMatch(codeOnly(client), /\/teams\/[^'"`\n]*\/(skills|coverage)\b|\/teams\/skills\b/, 'no client path for a skill route before it is on main');
  const src = codeOnly(read(`${TEAM}/agentsAdapter.js`));
  for (const m of methods) assert.match(src, new RegExp(`export const ${m} = \\([^)]*\\) => off\\(\\);`), `${m} stays a one-line off()`);
  const refused = await adapter.throughSkill(async () => { const e = new Error('x'); e.status = 422; e.code = 'role_mismatch'; throw e; });
  assert.equal(refused.reason, 'An agent can only be given skills of its own role.');
});

test('the Add-an-agent sheet has a Skills step, and sends `skills` only when some were picked', () => {
  const src = read(`${TEAM}/AddAgentSheet.jsx`);
  assert.match(src, /const STEPS = \['Role', 'Agent', 'Skills', 'Review'\];/);
  assert.match(src, /chosenSkills\.length \? \{ skills:/);
  assert.match(src, /<SkillsStep /);
  assert.match(read(`${TEAM}/TeamAgentsPage.jsx`), /tab === 'skills' \? <SkillsTab /);
  assert.match(read(`${TEAM}/TeamAgentsPage.jsx`), /<TeamCoverageCard kind=\{kind\} id=\{id\} \/>/);
  assert.match(read(`${TEAM}/AgentProfileSheet.jsx`), /<AgentSkillsCard /);
});

test('the copy follows the rules: Ask never Fill, no chat, no "advisor" or "advice", no email', () => {
  for (const f of ['SkillsTab.jsx', 'SkillSheets.jsx', 'SkillParts.jsx', 'AgentSkillsCard.jsx', 'TeamCoverageCard.jsx', 'skillsModel.js']) {
    const src = read(`${TEAM}/${f}`);
    assert.doesNotMatch(src, />\s*Fill\b|'Fill'|"Fill"/, `${f}: Fill`);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /\badvi(sor|ce)\b/i, `${f}: advisor or advice`);
    assert.doesNotMatch(src, /\.email\b/, `${f}: an email is drawn`);
  }
});

// ---------------------------------------------------------------- the canvases

test('the two canvases are in design/incoming, and D1612 names each board', () => {
  const page = 'design/incoming/Agent Skills Page.dc.html';
  const boards = 'design/incoming/Agent Skills · Boards.dc.html';
  assert.ok(existsSync(page) && existsSync(boards));
  const b = read(boards);
  assert.match(b, /dc-import name="Agent Skills Page"/);
  for (const id of ['SK0', 'SK1', 'SK2', 'SK3', 'SK4', 'SK5', 'SK6', 'SK7', 'SK8', 'SK9']) assert.ok(b.includes(`B('${id}'`), id);
  assert.match(read(page), /\/axal-mark\.png/);
  const d = read('documentation/architecture/decisions/D1612.md');
  for (const id of ['SK0', 'SK1', 'SK2', 'SK3', 'SK4', 'SK5', 'SK6', 'SK7', 'SK8', 'SK9', '#3951', '#3956', '#3953', '#3954', 'migration 757']) assert.ok(d.includes(id), id);
});
