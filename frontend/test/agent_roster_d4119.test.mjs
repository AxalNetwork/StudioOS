// D4119 (#4119, Roster R3 of #4116) — the agent card, the 16-agent gallery,
// Add an AI agent (Who · Skills · Model and cap) and the agent profile.
//
//   · no job title renders on any agent surface, and no Schwartz value,
//     philosophy, outlook or trade-off anywhere;
//   · a radar with no skills, and the cost line until R5, read "Not recorded";
//   · the gallery's filters (top core value, natural fit, risk) and search;
//   · a persona already on the team shows "On your team" and cannot be chosen;
//   · avatars carry "[Name], [tagline]" and fall back to initials;
//   · people and agents draw their values with the same component; the agent
//     profile shows six bars with exactly three highlighted, captioned Fixed.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/agent_roster_d4119.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';

import AgentCard, { AgentAvatar, ON_TEAM } from '../src/pages/team/AgentCard.jsx';
import { CompareDialog, CoverageLines, WhoStep } from '../src/pages/team/AddAgentSheet.jsx';
import { AgentProfile } from '../src/pages/team/AgentProfileSheet.jsx';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import AxalValuesBars from '../src/components/profile/AxalValuesBars.jsx';
import {
  COMPARE_MAX, FORBIDDEN_TITLES, FORBIDDEN_VALUES, WORK_LABEL, agentValueBars, avatarAlt, compareRows, filterOptions, fixedCaption, gallery,
  galleryCount, onTeamKeys, riskLine, rolesFor, toggleCompare, workLabel,
} from '../src/pages/team/personaModel.js';

const h = React.createElement;
const render = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(p, 'utf8');

// The six Axal values' legend, as `GET /api/teams/personas` sends it (D4117).
const LEGEND = [
  { key: 'integrity', label: 'Integrity', description: 'Does what it says.' },
  { key: 'stewardship', label: 'Stewardship', description: 'Looks after what it is trusted with.' },
  { key: 'curiosity', label: 'Curiosity', description: 'Asks why.' },
  { key: 'resilience', label: 'Resilience', description: 'Holds steady.' },
  { key: 'collaboration', label: 'Collaboration', description: 'Works through others.' },
  { key: 'ambition', label: 'Ambition', description: 'Driven to build something lasting and consequential, not merely comfortable.' },
];
const P = (key, name, gender, risk, top, fit, tagline) => ({
  key, name, gender, risk, top_values: top, natural_fit: fit, tagline, goal: `${name}'s goal.`, story: `${name}'s story.`, personality: 'Calm.',
  values: Object.fromEntries(LEGEND.map((v, i) => [v.key, top.includes(v.key) ? [0.9, 0.8, 0.7][top.indexOf(v.key)] : [0.5, 0.4, 0.3][i % 3]])),
});
const PERSONAS = [
  P('vesta', 'Vesta', 'woman', 1, ['integrity', 'stewardship', 'resilience'], ['legal', 'finance'], 'No gate opens without its seal.'),
  P('kade', 'Kade', 'man', 5, ['curiosity', 'ambition', 'collaboration'], ['product', 'marketing'], 'Light ten lanterns, follow the brightest.'),
  P('orrin', 'Orrin', 'man', 3, ['stewardship', 'integrity', 'resilience'], ['finance', 'legal'], 'Every road ends at a market.'),
  P('ryssa', 'Ryssa', 'woman', 4, ['ambition', 'curiosity', 'integrity'], ['capital', 'gtm'], 'If the plan survives me, it survives the patrons.'),
];
const BLOCK = { available: true, value: { personas: PERSONAS, values: LEGEND, areas: [] } };
const titleRe = new RegExp(`\\b(${FORBIDDEN_TITLES.map((t) => t.replace(/ /g, '\\s')).join('|')})\\b`);
const valuesRe = new RegExp(`\\b(${FORBIDDEN_VALUES.join('|')})\\b`, 'i');

test('the card at three sizes: name, archetype, tagline, top 3 values, risk and natural fit; no job title, no Schwartz value', () => {
  const full = renderedText(render(h(AgentCard, { persona: PERSONAS[2], legend: LEGEND })));
  assert.match(full, /OrrinDisciplined Allocator/);
  assert.match(full, /He\/him/);
  assert.match(full, /“Every road ends at a market\.”/);
  assert.match(full, /Core valuesStewardshipIntegrityResilience/);
  assert.match(full, /RiskCautious[^]*Bold/);
  assert.match(full, /Natural fitFinanceLegal/);
  const compact = renderedText(render(h(AgentCard, { persona: PERSONAS[0], size: 'compact' })));
  assert.match(compact, /VestaAccountability AnchorNo gate opens without its seal\./);
  const chip = render(h(AgentCard, { persona: PERSONAS[1], size: 'chip' }));
  assert.match(chip, /data-testid="agent-card-chip"/);
  assert.match(renderedText(chip), /Kade/);
  for (const html of [full, compact, chip]) {
    assert.doesNotMatch(renderedText(html), titleRe, 'no job title');
    assert.doesNotMatch(renderedText(html), valuesRe, 'no Schwartz value, outlook, philosophy or trade-off');
  }
  assert.equal(riskLine({ risk: 9 }), 'Not recorded');
});

test('avatars: a square agent mark with initials when the portrait is missing, alt "[Name], [tagline]" and that the portrait is not added yet', () => {
  const html = render(h(AgentAvatar, { persona: PERSONAS[0], size: 40 }));
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Vesta, No gate opens without its seal\. \(portrait not added yet\)"/);
  assert.match(html, /data-shape="square"/, 'an agent is never drawn as a person');
  assert.match(html, />V</);
  assert.equal(avatarAlt(PERSONAS[1], { portrait: true }), 'Kade, Light ten lanterns, follow the brightest.');
  assert.equal(avatarAlt({}), 'An AI agent (portrait not added yet)');
});

test('the gallery filters by top core value, natural fit and risk, searches by name, and counts', () => {
  const opts = filterOptions(PERSONAS, LEGEND);
  assert.deepEqual(opts.value.map((o) => o.label), ['Any top value', 'Integrity', 'Stewardship', 'Curiosity', 'Resilience', 'Collaboration', 'Ambition']);
  assert.deepEqual(opts.fit.map((o) => o.label), ['Any natural fit', 'Product', 'GTM', 'Marketing', 'Finance', 'Legal', 'Capital']);
  assert.deepEqual(opts.risk.map((o) => o.value), ['', 'cautious', 'balanced', 'bold']);
  assert.deepEqual(gallery(PERSONAS, { value: 'ambition' }).map((p) => p.key), ['kade', 'ryssa']);
  assert.deepEqual(gallery(PERSONAS, { fit: 'finance' }).map((p) => p.key), ['vesta', 'orrin']);
  assert.deepEqual(gallery(PERSONAS, { risk: 'cautious' }).map((p) => p.key), ['vesta']);
  assert.deepEqual(gallery(PERSONAS, { risk: 'bold' }).map((p) => p.key), ['kade', 'ryssa']);
  assert.deepEqual(gallery(PERSONAS, { risk: 'balanced' }).map((p) => p.key), ['orrin']);
  assert.deepEqual(gallery(PERSONAS, { q: 'ORR' }).map((p) => p.key), ['orrin']);
  assert.deepEqual(gallery(PERSONAS, { q: 'market' }).map((p) => p.key), ['orrin'], 'the tagline is searched too');
  assert.deepEqual(gallery(PERSONAS, { value: 'integrity', fit: 'legal', risk: 'balanced' }).map((p) => p.key), ['orrin']);
  assert.equal(galleryCount(PERSONAS, PERSONAS), '4 agents');
  assert.equal(galleryCount(PERSONAS.slice(0, 1), PERSONAS), '1 of 4 agents');
  const html = renderedText(render(h(WhoStep, { block: BLOCK, scopeName: '[Northwind Labs]', onTeam: new Set(), chosen: null, setChosen() {} })));
  assert.match(html, /4 agents/);
  assert.match(html, /Choose who joins \[Northwind Labs\]/);
  assert.doesNotMatch(html, valuesRe);
  assert.doesNotMatch(html, titleRe);
});

test('the Add agent picker shows Ilyse’s portrait and Studio archetype', () => {
  const ilyse = { ...P('ilyse', 'Ilyse', 'woman', 5, ['curiosity', 'ambition', 'resilience'], ['gtm', 'marketing'], 'What lies past the last beacon?'), avatar: '/agents/ilyse.webp' };
  const block = { available: true, value: { ...BLOCK.value, personas: [ilyse] } };
  const html = render(h(WhoStep, { block, scopeName: 'x', onTeam: new Set(), chosen: null, setChosen() {} }));
  assert.match(html, /<img src="\/agents\/ilyse\.webp"/);
  assert.match(renderedText(html), /IlyseThe Rocketeer/);
  assert.doesNotMatch(html, /data-testid="agent-pill"|portrait not added yet/);
});

test('a persona already on the team shows "On your team" and cannot be chosen twice', () => {
  const onTeam = onTeamKeys([{ persona: { key: 'kade' }, status: 'active' }, { persona: { key: 'vesta' }, status: 'removed' }]);
  assert.deepEqual([...onTeam], ['kade'], 'a removed agent frees its persona');
  assert.deepEqual(gallery(PERSONAS, {}, onTeam).filter((p) => p.on_team).map((p) => p.key), ['kade'], 'kept and marked, never hidden');
  let picked = null;
  const html = render(h(WhoStep, { block: BLOCK, scopeName: 'x', onTeam, chosen: null, setChosen: (k) => { picked = k; } }));
  assert.match(html, new RegExp(`data-testid="agent-pick-kade"[^>]*`));
  assert.match(html, /aria-disabled="true"[^>]*data-testid="agent-pick-kade"|data-testid="agent-pick-kade"[^>]*aria-disabled="true"/);
  assert.match(renderedText(html), new RegExp(`Kade[^]*✓ ${ON_TEAM}`));
  assert.equal(picked, null);
  // The Add sheet never offers a persona on the team to a click.
  assert.match(read('frontend/src/pages/team/AddAgentSheet.jsx'), /const pick = \(p\) => \{ if \(!p\.on_team\) setChosen\(p\.key\); \};/);
});

test('Compare holds up to three, side by side: six value bars each (top 3 highlighted), risk, natural fit and story', () => {
  assert.equal(COMPARE_MAX, 3);
  assert.deepEqual(toggleCompare(['a', 'b', 'c'], 'd'), ['a', 'b', 'c'], 'a fourth is refused');
  assert.deepEqual(toggleCompare(['a', 'b'], 'a'), ['b']);
  const rows = compareRows(PERSONAS.slice(0, 2), LEGEND);
  assert.deepEqual(rows.map((r) => r.label), ['Integrity', 'Stewardship', 'Curiosity', 'Resilience', 'Collaboration', 'Ambition', 'Risk', 'Natural fit']);
  const html = render(h(CompareDialog, { personas: PERSONAS.slice(0, 2), legend: LEGEND, chosen: 'vesta', onTeam: new Set(), onChoose() {}, onClose() {} }));
  const t = renderedText(html);
  assert.match(t, /Compare 2 agents/);
  assert.match(t, /Values and risk are fixed\. Skills are added after you choose\./);
  assert.match(t, /VestaAccountability Anchor/);
  assert.match(t, /Vesta's story\./);
  assert.match(t, /Choose Kade/);
  assert.equal((html.match(/data-testid="agent-compare-values-vesta-bar"/g) || []).length, 6);
  assert.equal((html.match(/data-testid="agent-compare-values-vesta-bar" data-top="true"/g) || []).length, 3);
  assert.doesNotMatch(t, valuesRe);
});

test('"Not recorded" on a radar with no skills, and on the cost line until R5', () => {
  const none = renderedText(render(h(CoverageLines, { skills: [] })));
  assert.match(none, /Coverage with these skillsNot recorded/);
  assert.match(none, /With 0 skills · cost per run Not recorded/);
  assert.doesNotMatch(none, /\$0|\b0\.00\b/, 'never a zero cost');
  const some = renderedText(render(h(CoverageLines, { skills: [{ taxonomy: [{ category_slug: 'finance_ops', level: 4 }] }] })));
  assert.match(some, /Finance[^]*Advanced/);
  assert.match(some, /With 1 skill · cost per run Not recorded/);
});

test('the profile: the full card, Story and goal, and Values — six bars, three highlighted, "Fixed · part of who Orrin is", with risk', () => {
  const agent = { uid: 'a1', role_key: 'cfo', persona: PERSONAS[2], status: 'active', sponsor: { name: '[Avery Stone]' }, monthly_cap_microusd: 25_000_000 };
  const html = render(h(AgentProfile, { data: { agent, matrix: [], month_spend: { available: true, value_microusd: 1_000_000 }, events: [] }, legend: LEGEND }));
  const t = renderedText(html);
  assert.match(t, /OrrinDisciplined Allocator/);
  assert.match(t, /Sponsor: \[Avery Stone\]/);
  assert.match(t, /StoryOrrin's story\.Goal · Orrin's goal\./);
  assert.equal((html.match(/data-testid="agent-value-bar"/g) || []).length, 6, 'the six Axal values');
  assert.equal((html.match(/data-testid="agent-value-bar" data-top="true"/g) || []).length, 3, 'exactly three highlighted');
  assert.match(t, new RegExp(fixedCaption('Orrin')));
  assert.equal(fixedCaption('Orrin'), 'Fixed · part of who Orrin is');
  assert.match(html, /data-testid="agent-risk"/);
  assert.doesNotMatch(t, titleRe, 'no job title');
  assert.doesNotMatch(t, valuesRe, 'no Schwartz value');
  assert.doesNotMatch(t, /First name|Surname/, 'the persona is the name');
  const unread = renderedText(render(h(AgentProfile, { data: { agent: { uid: 'a2', status: 'active' }, matrix: [], month_spend: { available: false }, events: [] } })));
  assert.match(unread, /Who this agent is was not recorded/);
});

test('people and agents draw their values with the same component', () => {
  for (const f of ['frontend/src/components/profile/ProfileFitSection.jsx', 'frontend/src/pages/team/AgentProfileSheet.jsx', 'frontend/src/pages/team/AddAgentSheet.jsx']) {
    assert.match(read(f), /import AxalValuesBars from '[./]+(components\/profile\/)?AxalValuesBars\.jsx';/, f);
    assert.match(read(f), /<AxalValuesBars /, f);
  }
  assert.doesNotMatch(read('frontend/src/components/profile/ProfileFitSection.jsx'), /5 Axal behavioral values<\/div>/, 'the old inline block is gone');
  // A person's block: the score out of 5, no highlight, no caption.
  const person = render(h(AxalValuesBars, { testId: 'person-values', title: '6 Axal behavioral values', scale: 'five', bars: [{ key: 'ambition', label: 'Ambition', score: 0.8 }, { key: 'integrity', label: 'Integrity', score: null }] }));
  assert.match(renderedText(person), /6 Axal behavioral valuesAmbition4\.0\/5IntegrityNot recorded/);
  assert.doesNotMatch(person, /data-top=/);
  const bars = agentValueBars(PERSONAS[0], LEGEND);
  assert.deepEqual(bars.map((b) => b.key), ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition']);
  assert.deepEqual(bars.filter((b) => b.top).map((b) => b.key), ['integrity', 'stewardship', 'resilience']);
  assert.equal(agentValueBars({ top_values: [] }, LEGEND).every((b) => b.score === null), true, 'unscored is null, never 0');
});

test('no job title anywhere an agent appears: the Team list, the area of work, and every team source', () => {
  for (const v of Object.values(WORK_LABEL)) assert.doesNotMatch(v, titleRe, v);
  assert.equal(workLabel('cfo'), 'Finance');
  assert.equal(workLabel('custom_x', 'Brand voice'), 'Brand voice', 'a custom role reads its own name');
  assert.equal(workLabel('custom_y'), 'Not recorded');
  assert.deepEqual(rolesFor(PERSONAS[2], ['ceo', 'cfo', 'general_counsel']), ['cfo', 'general_counsel', 'ceo'], 'its own area, then its natural fit');
  assert.deepEqual(rolesFor({ key: 'new', natural_fit: ['marketing'] }, ['cmo', 'cto']), ['cmo', 'cto']);
  assert.deepEqual(rolesFor(PERSONAS[1], ['cpo', 'cmo', 'cto']), ['cmo', 'cpo', 'cto'], 'Kade: its own area (marketing and growth) before its natural fit\'s first (product)');
  const list = renderedText(render(h(AgentsCard, { block: { available: true, value: { agents: [{ uid: 'a1', role_key: 'cfo', persona: PERSONAS[2], status: 'active', month_spend: { available: false }, project: null }] } }, kind: 'project', companyName: 'x' })));
  assert.match(list, /Orrin/);
  assert.match(list, /Every road ends at a market\./);
  assert.doesNotMatch(list, titleRe);
  for (const f of ['AddAgentSheet.jsx', 'AgentProfileSheet.jsx', 'AgentsCard.jsx', 'ApprovalsTab.jsx', 'TeamSettingsTab.jsx', 'WorkingHere.jsx', 'AgentSkillsCard.jsx', 'SkillSheets.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/team/${f}`), /role_name/, `${f} draws no role_name`);
  }
  for (const f of ['AgentCard.jsx', 'AddAgentSheet.jsx', 'AgentProfileSheet.jsx', 'personaModel.js']) {
    const code = read(`frontend/src/pages/team/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/FORBIDDEN_VALUES = \[[^\]]*\]/, '');
    assert.doesNotMatch(code, /\b(Hedonism|Conformity|Tradition|Universalism|Benevolence|Self-direction|Stimulation)\b/, `${f}: a Schwartz value`);
  }
});
