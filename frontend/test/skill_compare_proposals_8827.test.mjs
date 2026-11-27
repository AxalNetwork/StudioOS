// D8827 (#8827, D5963 SK-17) — Eadwyn's proposals on Compare with Axal: quoted, then run on the approved quote; a
// summary and a proposal per conflicting part; Accept fills in the rebase sheet and nothing else writes. The page is
// mounted on the Worker's stubbed answers at fetch, so no model is called. Every record below is an invented fixture.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_compare_proposals_8827.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import SkillComparePage from '../src/pages/team/SkillComparePage.jsx';
import { compareHref, compareView } from '../src/pages/team/extensionCompareModel.js';
import {
  acceptedChoices, basisMatches, holdWords, partList, proposalLead, proposalsView, rebaseChoiceOf, refusalState,
} from '../src/pages/team/skillProposalsModel.js';
import { fromWorkerSkill } from '../src/pages/team/skillsModel.js';

const h = React.createElement;

// ---------------------------------------------------------------- fixtures (invented)

const uid = (n) => String(n).padStart(32, 'd');
const HQ = uid(1);
const EXT = uid(2);
const CO = 'cofix27';
const HASH = 'e'.repeat(64);
const S3 = ['Define the market.', 'Estimate buyers.', 'State every assumption.'];
const SM = [S3[0], 'List buyer teams from the CRM.', S3[2]];
const S5 = [S3[0], 'Estimate buyers from filings.', 'Cross-check bottom-up.', S3[2]];
const parts = (o) => ({
  name: '[Proposal fixture]', purpose: 'Sizes a market.', steps: S3, tools: ['crm.read', 'web.search'], output_kind: 'brief', output_label: 'A brief',
  tags: [{ slug: 'market-research', label: 'Market research', category: 'gtm_sales', level: 'proficient' }], roles: [{ key: 'analyst', label: 'Analyst' }], ...o,
});
const V3 = parts({});
const MINE = parts({ steps: SM, tools: ['crm.read'] });
const V5 = parts({ purpose: 'Sizes a market and names sources.', steps: S5, tools: ['crm.read', 'web.search', 'filings.read'] });
const FIELDS = [
  { field: 'name', company_changed: false, base_changed: false, conflict: false },
  { field: 'purpose', company_changed: false, base_changed: true, conflict: false },
  { field: 'steps', company_changed: true, base_changed: true, conflict: true },
  { field: 'tools', company_changed: true, base_changed: true, conflict: true },
  { field: 'output_kind', company_changed: false, base_changed: false, conflict: false },
  { field: 'tags', company_changed: false, base_changed: false, conflict: false },
  { field: 'roles', company_changed: false, base_changed: false, conflict: false },
];
const lineage = (over = {}) => ({
  based_on: { skill_uid: HQ, version: 3 }, reason: 'Our buyers are procurement teams.', versions: [{ version: 2, based_on_version: 3 }],
  base: { uid: HQ, name: '[Proposal fixture]', status: 'published', current_version: 5, retired: false, suspended: false, version: { version: 3, ...V3 }, newest: { version: 5, ...V5 } },
  base_update_available: true, company: { side: 'version', version: 2 }, fields: FIELDS, ...over,
});
const extCard = (over = {}) => ({
  uid: EXT, scope: 'company', slug: 'sizing-ours', status: 'published', version: 2, author: '[Fixture Co]', ...MINE,
  used_by: 1, updated_at: '2026-11-27T00:00:00Z', can_write: true, based_on: { skill_uid: HQ, version: 3 }, draft_hash: HASH, ...over,
});
const ESTIMATE = { hold_microusd: 4200, model: '@cf/fixture/model' };
const BASIS = { based_on_version: 3, version: 5, company: { side: 'version', version: 2 } };
const ANSWER = {
  basis: BASIS,
  summary: [{ part: 'purpose', text: 'Axal now asks for each source.' }, { part: 'steps', text: 'Axal adds filings and a cross-check.' }],
  changed: ['purpose', 'steps', 'tools'],
  unchanged: ['name', 'output_kind', 'tags', 'roles'],
  proposals: [
    { part: 'steps', choice: 'edit', value: [S3[0], 'List buyer teams from the CRM.', 'Cross-check bottom-up.', S3[2]], why: 'Keep your CRM step; take Axal’s cross-check.' },
    { part: 'purpose', choice: 'axal', why: 'Not a conflict, so never shown.' },
  ],
  missing: [],
  withheld: [{ part: 'tools', code: 'tool_not_in_base', tool: 'slack.post', message: 'Eadwyn’s proposal for Tools named slack.post, which is not a tool of Axal v5, so it is not shown.' }],
  receipt: { held_microusd: 4200, charged_microusd: 3100 },
};

// ---------------------------------------------------------------- the model

test('the model: only conflicts keep a proposal; an accepted one becomes the rebase sheet\'s choice in the hand editor\'s form', () => {
  const view = compareView(fromWorkerSkill(extCard()), lineage());
  const shown = proposalsView(ANSWER, view);
  assert.deepEqual(shown.proposals.map((p) => p.part), ['steps'], 'a proposal for a part that does not conflict is dropped');
  assert.deepEqual(shown.undescribed, ['tools']);
  assert.equal(shown.withheld.length, 1);
  assert.equal(proposalsView({ summary: [] }, view), null, 'no proposals list is no answer');
  assert.deepEqual(rebaseChoiceOf(ANSWER.proposals[0]), { choice: 'edit', value: ANSWER.proposals[0].value.join('\n') });
  assert.deepEqual(rebaseChoiceOf({ part: 'tools', choice: 'edit', value: ['crm.read'] }), { choice: 'edit', value: ['crm.read'] });
  assert.deepEqual(rebaseChoiceOf({ part: 'name', choice: 'edit', value: 'Ours' }), { choice: 'edit', value: 'Ours' });
  assert.deepEqual(rebaseChoiceOf({ part: 'tools', choice: 'mine', value: ['ignored'] }), { choice: 'mine' });
  assert.equal(rebaseChoiceOf({ part: 'tools', choice: 'merge' }), null);
  assert.deepEqual(acceptedChoices(shown.proposals, {}), {}, 'nothing accepted, nothing chosen');
  assert.deepEqual(Object.keys(acceptedChoices(shown.proposals, { steps: true })), ['steps']);
  assert.equal(basisMatches(BASIS, view), true);
  assert.equal(basisMatches({ ...BASIS, version: 6 }, view), false);
  assert.equal(basisMatches({ ...BASIS, company: { side: 'draft', version: null } }, view), false);
  assert.equal(proposalLead({ choice: 'axal' }, 5), 'Take Axal v5.');
  assert.equal(proposalLead({ choice: 'mine' }, 5), 'Keep yours.');
  assert.equal(partList(['name', 'output_kind', 'roles']), 'Name, Output and Roles');
  assert.equal(holdWords(4200), '$0.0042');
  assert.deepEqual(refusalState({ refused: true, code: 'quote_changed', estimate: ESTIMATE }), { kind: 'quote', estimate: ESTIMATE, changed: true });
  assert.equal(refusalState({ refused: true, code: 'budget_user_month', reason: 'Add tokens.' }).kind, 'refused');
  assert.equal(refusalState({ refused: true, code: 'proposals_unavailable', reason: 'Down.' }).kind, 'unavailable');
  assert.equal(refusalState({ unreadable: true }).kind, 'unavailable');
});

// ---------------------------------------------------------------- the page

function stubFetch(routes) {
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ key, body });
    const hit = routes[key];
    const [status, out] = typeof hit === 'function' ? hit(body) : hit || [500, { error: 'boom' }];
    return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => out, text: async () => JSON.stringify(out) };
  };
  return { seen, restore: () => { globalThis.fetch = previous; } };
}
const settle = async (m) => { for (let i = 0; i < 6; i += 1) await m.flush(); };
const LIB = { hq: [], company: { uid: CO, name: '[Fixture Co]', skills: [], can_write: true }, can_write_hq: false };
const PROPOSALS = `POST /api/teams/skills/${EXT}/proposals`;
const ROUTES = ({ ext = extCard(), lin = lineage(), proposals = (b) => (b?.estimate ? [200, { estimate: ESTIMATE, basis: BASIS }] : [200, ANSWER]) } = {}) => ({
  [`GET /api/teams/skills/${EXT}`]: [200, { skill: ext, versions: [], agents: [] }],
  [`GET /api/teams/skills/${EXT}/base`]: [200, { lineage: lin }],
  'GET /api/teams/skills': [200, LIB],
  [PROPOSALS]: proposals,
});
async function mountPage(routes) {
  const net = stubFetch(routes);
  const el = h(Routes, null,
    h(Route, { path: '/account/companies/:uid/settings/team/skills/:skillUid/base', element: h(SkillComparePage) }),
    h(Route, { path: '/account/companies/:uid/settings/team', element: h('p', { 'data-testid': 'team-page' }, 'Team page') }));
  const m = await mountContracts(el, compareHref(CO, EXT));
  await settle(m);
  const byTestId = (id) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === id);
  const fire = async (id, prop = 'onClick', arg = { stopPropagation() {} }) => {
    const [node] = byTestId(id);
    assert.ok(node, `missing ${id}`);
    await act(async () => { m.props(node)[prop](arg); });
    await settle(m);
  };
  return { ...m, net, byTestId, fire, async done() { await m.unmount(); net.restore(); } };
}
const writes = (m) => m.net.seen.filter((s) => s.key !== PROPOSALS && /^(POST|PUT|PATCH|DELETE)/.test(s.key));

test('an editor asks: the hold is quoted first, the run carries that quote, and the answer writes nothing', async () => {
  const m = await mountPage(ROUTES());
  try {
    assert.equal(m.byTestId('skill-proposals').length, 1);
    assert.equal(m.net.seen.filter((s) => s.key === PROPOSALS).length, 0, 'nothing is asked until the editor presses');
    await m.fire('proposals-ask');
    assert.deepEqual(m.net.seen.filter((s) => s.key === PROPOSALS).map((s) => s.body), [{ estimate: true }]);
    assert.match(m.text(), /This read holds up to \$0\.0042 of your AI tokens/);
    await m.fire('proposals-run');
    assert.deepEqual(m.net.seen.filter((s) => s.key === PROPOSALS)[1].body, { quote: ESTIMATE });
    const t = m.text();
    assert.match(t, /Proposal · what Axal changed, v3 → v5/);
    assert.match(t, /Purpose Axal now asks for each source\./);
    assert.match(t, /Tools changed; Eadwyn did not describe it\./);
    assert.match(t, /Name, Output, Skill tags and Roles unchanged\./);
    assert.match(t, /Combine: Keep your CRM step; take Axal’s cross-check\./);
    assert.equal(m.byTestId('proposal-purpose').length, 0, 'no proposal for a part that does not conflict');
    assert.match(t, /named slack\.post, which is not a tool of Axal v5, so it is not shown\./);
    assert.match(t, /Charged \$0\.0031\./);
    assert.equal(writes(m).length, 0, 'asking Eadwyn writes no draft');
  } finally { await m.done(); }
});

test('Accept fills in the rebase sheet; the draft is written only by Create draft, through the rebase route', async () => {
  const routes = { ...ROUTES(), [`POST /api/teams/skills/${EXT}/rebase`]: [200, { skill: extCard({ status: 'draft' }), base: { uid: HQ, version: 5 } }] };
  const m = await mountPage(routes);
  try {
    await m.fire('proposals-ask');
    await m.fire('proposals-run');
    await m.fire('proposal-steps-accept');
    assert.equal(writes(m).length, 0, 'accepting saves nothing');
    assert.equal(m.byTestId('rebase-sheet').length, 1, 'the rebase sheet opens');
    assert.equal(m.props(m.byTestId('rebase-steps-edit')[0]).checked, true, 'the accepted choice is chosen');
    assert.equal(m.props(m.byTestId('rebase-hand-steps')[0]).value, ANSWER.proposals[0].value.join('\n'));
    for (const c of ['mine', 'axal', 'edit']) assert.equal(m.props(m.byTestId(`rebase-tools-${c}`)[0]).checked, false, 'a part with no accepted proposal starts unchosen');
    await m.fire('rebase-tools-axal', 'onChange', { target: { checked: true } });
    await m.fire('rebase-create');
    const sent = writes(m);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].key, `POST /api/teams/skills/${EXT}/rebase`);
    assert.deepEqual(sent[0].body, { version: 5, expected_draft_hash: HASH, resolutions: { steps: { choice: 'edit', value: ANSWER.proposals[0].value }, tools: { choice: 'axal' } } });
  } finally { await m.done(); }
});

test('Discard and Undo: a discarded proposal goes, an undone one is no longer chosen', async () => {
  const m = await mountPage(ROUTES());
  try {
    await m.fire('proposals-ask');
    await m.fire('proposals-run');
    await m.fire('proposal-steps-accept');
    assert.equal(m.byTestId('proposal-steps-accepted').length, 1);
    await m.fire('proposal-steps-undo');
    assert.equal(m.byTestId('proposal-steps-accepted').length, 0, 'undone: no longer accepted');
    assert.equal(m.byTestId('proposal-steps-accept').length, 1, 'and it can be accepted again');
    assert.equal(writes(m).length, 0);
  } finally { await m.done(); }
  const d = await mountPage(ROUTES());
  try {
    await d.fire('proposals-ask');
    await d.fire('proposals-run');
    await d.fire('proposal-steps-discard');
    assert.equal(d.byTestId('proposal-steps').length, 0);
    assert.equal(writes(d).length, 0);
  } finally { await d.done(); }
});

test('Eadwyn unavailable: the panel says so and draws nothing in its place; a changed cost asks again; a budget stop keeps its words', async () => {
  const down = await mountPage(ROUTES({ proposals: (b) => (b?.estimate ? [200, { estimate: ESTIMATE, basis: BASIS }] : [503, { error: 'proposals_unavailable', message: 'Eadwyn could not be reached. Nothing was proposed, and nothing was charged.' }]) }));
  try {
    await down.fire('proposals-ask');
    await down.fire('proposals-run');
    const t = down.text();
    assert.match(t, /Eadwyn is unavailable/);
    assert.match(t, /Nothing was proposed, and nothing was charged\./);
    assert.match(t, /The comparison and Rebase still work without Eadwyn\./);
    assert.equal(down.byTestId('proposals-answer').length, 0);
    assert.equal(down.byTestId('proposal-summary').length, 0, 'no summary is invented');
    assert.equal(down.byTestId('compare-rebase').length, 1, 'Rebase is still offered');
  } finally { await down.done(); }
  const moved = await mountPage(ROUTES({ proposals: (b) => (b?.estimate ? [200, { estimate: ESTIMATE, basis: BASIS }] : [409, { error: 'quote_changed', message: 'The cost changed.', estimate: { hold_microusd: 5100, model: ESTIMATE.model } }]) }));
  try {
    await moved.fire('proposals-ask');
    await moved.fire('proposals-run');
    assert.match(moved.text(), /The cost changed since you looked\. This read holds up to \$0\.0051/);
  } finally { await moved.done(); }
  const broke = await mountPage(ROUTES({ proposals: () => [402, { error: 'budget_user_month', message: 'The included AI allowance and top-up balance cannot cover this run. Add tokens to continue.' }] }));
  try {
    await broke.fire('proposals-ask');
    assert.match(broke.text(), /cannot cover this run\. Add tokens to continue\./);
    assert.equal(broke.byTestId('proposals-refused').length, 1);
  } finally { await broke.done(); }
  const garbled = await mountPage(ROUTES({ proposals: (b) => (b?.estimate ? [200, { estimate: ESTIMATE, basis: BASIS }] : [200, { summary: 'nope' }]) }));
  try {
    await garbled.fire('proposals-ask');
    await garbled.fire('proposals-run');
    assert.match(garbled.text(), /could not be matched to this comparison/);
    assert.equal(garbled.byTestId('proposals-answer').length, 0);
  } finally { await garbled.done(); }
});

test('no panel for members, HQ, a suspended or current base, or a card without its draft hash', async () => {
  for (const routes of [
    ROUTES({ ext: extCard({ can_write: false, draft_hash: null }) }),
    ROUTES({ lin: lineage({ base: { ...lineage().base, suspended: true } }) }),
    ROUTES({ lin: lineage({ base_update_available: false }) }),
    ROUTES({ ext: extCard({ draft_hash: null }) }),
  ]) {
    const m = await mountPage(routes);
    try { assert.equal(m.byTestId('skill-proposals').length, 0); } finally { await m.done(); }
  }
});

test('dark mode: every colour on the new panel has its dark: pair', () => {
  const src = readFileSync(new URL('../src/pages/team/SkillProposals.jsx', import.meta.url), 'utf8');
  let checked = 0;
  for (const cls of src.match(/(?:className=\{?|const \w+ = )[`"'][^`"']*[`"']/g) || []) {
    const light = cls.match(/(?<![:\w-])(bg|text|border)-(red|emerald|amber|axal-lavender|axal-ground|axal-ink|axal-hairline|white)[\w/-]*/g) || [];
    if (light.length) { checked += 1; assert.match(cls, /dark:/, cls); }
  }
  assert.ok(checked >= 5);
});
