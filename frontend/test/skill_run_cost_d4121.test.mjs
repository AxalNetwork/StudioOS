// D4121 (#4121, Roster R5 of #4116) — the run-cost line, the specialist hint
// and the SK6 explainer on the page: the words, "Not recorded" never "$0.00"
// for a price nobody read, and the four places they are drawn.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_run_cost_d4121.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  changeLine, costLine, costRatio, explainer, hintLine, perRunUsd, skillTokensLine, tokensWord, warningLine,
} from '../src/pages/team/skillsModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const TEAM = 'pages/team';

const EST = {
  available: true, skills: 4, tokens_per_run: 6000, est_usd_per_run: 0.05, monthly_at_cap: 400, cap_usd: 20,
  before: { skills: 3, tokens_per_run: 4800, est_usd_per_run: 0.03 }, baseline: { skills: 0, tokens_per_run: 1800, est_usd_per_run: 0.02 },
  delta: { skills: 1, tokens_per_run: 1200, est_usd_per_run: 0.02 }, hint: null,
};
const UNKNOWN = { available: false, reason: 'pricing_unreadable' };

test('1: the cost line, and "Not recorded" never "$0.00" when the price is unknown', () => {
  // Mutation checked: perRunUsd formatting a missing figure as `$${(v ?? 0).toFixed(2)}` → the unknown case reads "$0.00" and this fails.
  assert.equal(costLine(EST), 'With 4 skills ≈ $0.05 per run · cap $20/month');
  assert.equal(costLine({ ...EST, skills: 6 }, { lead: 'count' }), '6 skills ≈ $0.05 per run · cap $20/month');
  assert.equal(costLine({ ...EST, skills: 1, cap_usd: null }), 'With 1 skill ≈ $0.05 per run');
  assert.equal(costLine({ ...EST, skills: 0 }, { lead: 'count' }), 'No skills ≈ $0.05 per run · cap $20/month');
  assert.equal(costLine(UNKNOWN), 'Cost per run: Not recorded');
  assert.equal(costLine(undefined), 'Cost per run: Not recorded');
  for (const v of [undefined, null, Number.NaN]) assert.equal(perRunUsd(v), 'Not recorded');
  assert.equal(perRunUsd(0.0004), '< $0.01', 'a real fraction of a cent is not $0.00');
  assert.equal(perRunUsd(0.051), '$0.05');
  for (const s of [costLine(UNKNOWN), changeLine('Ilyse', UNKNOWN), perRunUsd(undefined)]) assert.doesNotMatch(s, /\$0\.00/);
});

test('2: a skill card\'s tokens, and SK3\'s change line', () => {
  assert.equal(tokensWord(1240), '1.2k');
  assert.equal(tokensWord(800), '800');
  assert.equal(skillTokensLine(1240), '+≈1.2k tokens per run');
  assert.equal(skillTokensLine(null), null, 'a draft never published shows no line');
  assert.equal(changeLine('Ilyse', EST), 'Ilyse: $0.03 → $0.05 per run');
  assert.equal(changeLine('Ilyse', UNKNOWN), 'Ilyse: Not recorded');
});

test('3: the specialist hint and SK3\'s warning, from the Worker\'s hint', () => {
  // Mutation checked: hintLine ignoring `suggest` → the line names no persona and the first assert fails.
  const hinted = { ...EST, skills: 9, est_usd_per_run: 0.04, hint: { reason: 'skills', area: 'gtm', suggest: { key: 'ilyse', name: 'Ilyse' } } };
  assert.equal(hintLine(hinted), 'Specialists are cheaper. Consider adding Ilyse for GTM instead.');
  assert.equal(hintLine({ ...hinted, hint: { reason: 'cost', area: 'finance', suggest: null } }), 'Specialists are cheaper. Consider a specialist for Finance.');
  assert.equal(hintLine(EST), null, 'no hint below the thresholds');
  assert.equal(costRatio(hinted), 2);
  assert.equal(warningLine('Kade', hinted), 'Kade now has 9 skills: more capable, but ≈ 2× the cost per run. Consider a specialist.');
  assert.equal(warningLine('Kade', EST), null);
  assert.equal(costRatio(UNKNOWN), null);
});

test('4: SK6 — three specialists cost less than one generalist for the same week', () => {
  // Mutation checked: the specialists counted at the generalist's skill count → their week is not cheaper and this fails.
  const x = explainer(EST);
  assert.equal(x.generalist.skills, 8);
  assert.equal(x.specialists.count, 3);
  assert.equal(x.specialists.skills, 3);
  assert.equal(x.generalist.tokens, 1800 + 8 * 1050);
  assert.equal(x.specialists.tokens, 1800 + 3 * 1050);
  assert.ok(x.specialists.week_usd < x.generalist.week_usd);
  assert.equal(explainer(EST, { skillTokens: 1200 }).generalist.tokens, 1800 + 8 * 1200, 'a skill\'s own tokens when it has them');
  assert.equal(explainer(UNKNOWN), null, 'nothing is drawn on an unknown price');
  assert.equal(explainer({ ...EST, skills: 0 }), null, 'no skill to measure, no figure');
});

test('5: the client and adapter call the two estimate routes', () => {
  const client = read('lib/api/teamAgents.js');
  assert.match(client, /costEstimate: \(uid, \{ add = \[\], remove = \[\] \} = \{\}\) => \{/);
  assert.match(client, /return request\(`\/teams\/agents\/\$\{enc\(uid\)\}\/cost-estimate\$\{qs \? `\?\$\{qs\}` : ''\}`\);/);
  assert.match(client, /return request\(`\$\{base\(scope, id\)\}\/cost-estimate\?\$\{q\.toString\(\)\}`\);/);
  const adapter = read(`${TEAM}/agentsAdapter.js`);
  assert.match(adapter, /export const costEstimate = \(uid, change = \{\}\) => throughSkill\(\(\) => teamAgentsApi\.costEstimate\(uid, change\)\);/);
  assert.match(adapter, /export const draftCostEstimate = \(scope, id, draft\) => throughSkill\(\(\) => teamAgentsApi\.draftCostEstimate\(scope, id, draft\)\);/);
});

test('6: drawn on AG3, SK3, SK4 (the profile), SK5 and every skill row', () => {
  // Mutation checked: the profile's CostLine removed → the AgentSkillsCard assert fails.
  const sheets = read(`${TEAM}/SkillSheets.jsx`);
  assert.match(sheets, /agents\.costEstimate\(a\.uid, \{ add: \[skill\.uid\] \}\)/, 'SK3: each agent with the skill added');
  assert.match(sheets, /data-testid="assign-cost">\{changeLine\(a\.name, costs\[a\.uid\]\)\}/);
  assert.match(sheets, /agents\.costEstimate\(agent\.uid, \{ add: chosen\.map\(\(s\) => s\.uid\) \}\)/, 'SK5: the picks');
  assert.match(sheets, /agents\.draftCostEstimate\(kind, scopeId, \{ model, role, skills: pickList \}\)/, 'AG3: an agent not yet added');
  assert.equal((sheets.match(/<CostExplainer /g) || []).length, 2, 'SK6 on SK3 and SK5');
  assert.match(read(`${TEAM}/AddAgentSheet.jsx`), /<SkillsStep scope=\{scope\} role=\{role\} model=\{model\}/);
  assert.match(read(`${TEAM}/AgentSkillsCard.jsx`), /<CostLine est=\{cost\} lead="count" \/>/);
  assert.match(read(`${TEAM}/SkillParts.jsx`), /data-testid="skill-tokens">\{skillTokensLine\(s\.context_tokens\)\}/);
  for (const f of ['SkillSheets.jsx', 'SkillParts.jsx', 'AgentSkillsCard.jsx', 'skillsModel.js']) {
    assert.doesNotMatch(read(`${TEAM}/${f}`), /\badvis(or|e)\b/i, f);
  }
});
