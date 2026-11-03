// D4121 (#4121, Roster R5 of #4116) — the run-cost line and the specialist
// hint on the page. A run carries one skill (#3954), so an agent's cost per run
// is a range, a skill's cost is per run that uses it, and "Not recorded" is
// never "$0.00" for a price nobody read.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_run_cost_d4121.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  changeLine, costLine, hintLine, perRunRange, perRunUsd, skillTokensLine, tokensWord, warningLine,
} from '../src/pages/team/skillsModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const TEAM = 'pages/team';
const SKILL = 'f'.repeat(32);

const EST = {
  available: true, skills: 4, tokens_per_run: 6000, est_usd_per_run: 0.05, monthly_at_cap: 400, cap_usd: 20,
  cheapest: { tokens_per_run: 3000, est_usd_per_run: 0.03 }, baseline: { tokens_per_run: 1800, est_usd_per_run: 0.02 },
  runs: [{ skill_uid: SKILL, tokens_per_run: 4200, est_usd_per_run: 0.04 }],
  before: { skills: 3, tokens_per_run: 4800, est_usd_per_run: 0.03 }, delta: { skills: 1, tokens_per_run: 1200, est_usd_per_run: 0.02 }, hint: null,
};
const UNKNOWN = { available: false, reason: 'pricing_unreadable' };

test('1: the cost line is a range, and "Not recorded" never "$0.00" when the price is unknown', () => {
  // Mutation checked: perRunUsd formatting a missing figure as $0.00 → the unknown case reads "$0.00" and this fails.
  assert.equal(costLine(EST), 'With 4 skills ≈ $0.03–$0.05 per run · cap $20/month');
  assert.equal(costLine({ ...EST, skills: 6 }, { lead: 'count' }), '6 skills ≈ $0.03–$0.05 per run · cap $20/month');
  assert.equal(costLine({ ...EST, skills: 1, cap_usd: null, cheapest: { est_usd_per_run: 0.05 } }), 'With 1 skill ≈ $0.05 per run', 'one figure when both ends match');
  assert.equal(costLine(UNKNOWN), 'Cost per run: Not recorded');
  assert.equal(costLine(undefined), 'Cost per run: Not recorded');
  for (const v of [undefined, null, Number.NaN]) assert.equal(perRunUsd(v), 'Not recorded');
  assert.equal(perRunUsd(0.0004), '< $0.01', 'a real fraction of a cent is not $0.00');
  assert.equal(perRunRange(EST), '$0.03–$0.05');
  for (const s of [costLine(UNKNOWN), changeLine('Ilyse', UNKNOWN, SKILL), perRunUsd(undefined)]) assert.doesNotMatch(s, /\$0\.00/);
});

test('2: a skill costs its tokens on each run that uses it; SK3 compares a run with it to a run with none', () => {
  // Mutation checked: changeLine reading the dearest run instead of this skill's → it reads $0.05, not $0.04, and this fails.
  assert.equal(tokensWord(1240), '1.2k');
  assert.equal(tokensWord(800), '800');
  assert.equal(skillTokensLine(1240), '+≈1.2k tokens on each run that uses it');
  assert.equal(skillTokensLine(null), null, 'a draft never published shows no line');
  assert.equal(changeLine('Ilyse', EST, SKILL), 'Ilyse: $0.02 → $0.04 per run with this skill');
  assert.equal(changeLine('Ilyse', EST, 'e'.repeat(32)), 'Ilyse: Not recorded', 'no run for that skill: nothing invented');
  assert.equal(changeLine('Ilyse', UNKNOWN, SKILL), 'Ilyse: Not recorded');
});

test('3: the specialist hint is about breadth, never cost', () => {
  // Mutation checked: hintLine ignoring `suggest` → the line names no persona and the first assert fails.
  const hinted = { ...EST, skills: 9, hint: { reason: 'skills', area: 'gtm', areas: 3, suggest: { key: 'ilyse', name: 'Ilyse' } } };
  assert.equal(hintLine(hinted), '9 skills across 3 areas. Consider adding Ilyse for GTM: a specialist keeps each agent focused.');
  assert.equal(hintLine({ ...hinted, hint: { reason: 'skills', area: 'finance', areas: 1, suggest: null } }), '9 skills. Consider a specialist for Finance: it keeps each agent focused.');
  assert.equal(hintLine(EST), null, 'no hint at 6 skills or fewer');
  assert.equal(warningLine('Kade', hinted), 'Kade would have 9 skills across 3 areas. Consider a specialist.');
  assert.equal(warningLine('Kade', EST), null);
  for (const s of [hintLine(hinted), warningLine('Kade', hinted)]) assert.doesNotMatch(s, /cheap|cost|×/i, 'more skills do not cost more per run');
});

test('4: the client and adapter call the two estimate routes', () => {
  const client = read('lib/api/teamAgents.js');
  assert.match(client, /costEstimate: \(uid, \{ add = \[\], remove = \[\] \} = \{\}\) => \{/);
  assert.match(client, /return request\(`\/teams\/agents\/\$\{enc\(uid\)\}\/cost-estimate\$\{qs \? `\?\$\{qs\}` : ''\}`\);/);
  assert.match(client, /return request\(`\$\{base\(scope, id\)\}\/cost-estimate\?\$\{q\.toString\(\)\}`\);/);
  const adapter = read(`${TEAM}/agentsAdapter.js`);
  assert.match(adapter, /export const costEstimate = \(uid, change = \{\}\) => throughSkill\(\(\) => teamAgentsApi\.costEstimate\(uid, change\)\);/);
  assert.match(adapter, /export const draftCostEstimate = \(scope, id, draft\) => throughSkill\(\(\) => teamAgentsApi\.draftCostEstimate\(scope, id, draft\)\);/);
});

test('5: drawn on AG3, SK3, SK4 (the profile), SK5 and every skill row', () => {
  // Mutation checked: the profile's RunCostLine removed → the AgentSkillsCard assert fails.
  const sheets = read(`${TEAM}/SkillSheets.jsx`);
  // SK3 is #4224's list: the Worker serves each agent's run_cost_change_microusd on the assignable read, and costChangeWords draws it.
  assert.match(sheets, /const change = costChangeWords\(a\);/);
  assert.match(read(`${TEAM}/skillsModel.js`), /const m = agent\?\.run_cost_change_microusd;/);
  assert.match(sheets, /agents\.costEstimate\(agent\.uid, \{ add: chosen\.map\(\(s\) => s\.uid\) \}\)/, 'SK5: the picks');
  assert.match(sheets, /agents\.draftCostEstimate\(kind, scopeId, \{ model, role, persona, skills: pickList \}\)/, 'AG3: an agent not yet added');
  assert.equal((sheets.match(/<RunCostLine est=\{cost\} \/>/g) || []).length, 2, 'SK5 and AG3');
  assert.match(read(`${TEAM}/AddAgentSheet.jsx`), /<SkillsStep scope=\{scope\} role=\{roleKey\} model=\{model\} persona=\{chosen\}/);
  assert.match(read(`${TEAM}/AgentSkillsCard.jsx`), /<RunCostLine est=\{cost\} lead="count" \/>/);
  assert.match(read(`${TEAM}/SkillParts.jsx`), /data-testid="skill-tokens">\{skillTokensLine\(s\.context_tokens\)\}/);
  for (const f of ['SkillSheets.jsx', 'SkillParts.jsx', 'AgentSkillsCard.jsx', 'skillsModel.js']) {
    const src = read(`${TEAM}/${f}`);
    assert.doesNotMatch(src, /\badvis(or|e)\b/i, f);
    assert.doesNotMatch(src, /generalist/, `${f}: no generalist-versus-specialists sum when a run carries one skill`);
  }
});
