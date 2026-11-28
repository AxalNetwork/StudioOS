// D8768 (#8768) — one skill-eligibility rule at every picker. The screens draw the Worker's answer
// (`services/agents/skillEligibility.ts`): six states with their own word and glyph, counts with the way on, natural
// fit that sorts and labels but never removes, and picks that survive a search, an area and a trip to the details.
//
// The cases: a draft-only area (Legal: listed, none published, with Finance as the way on), an eligible cross-area
// skill (outside the agent's natural fit, still tickable), and an opted-out tool (blocked, the tool named, the
// recovery said). Names and figures are synthetic fixtures.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_eligibility_8768.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { SkillPicker, SkillsStep } from '../src/pages/team/SkillSheets.jsx';
import {
  ELIGIBILITY, areaLine, countsLine, eligibilityOf, eligibilityWhy, emptyEligible, fromWorkerEligible, fromWorkerSkill, inputsLine, matchesSkill,
  pickerRows, wizardSkillsNext,
} from '../src/pages/team/skillsModel.js';

const h = React.createElement;
const uid = (n) => String(n).padStart(32, 'b');

/** A Worker card of `GET /agents/:uid/skills/available` (D8768), with its eligibility. */
const card = (n, eligibility, over = {}) => ({
  uid: uid(n), scope: 'hq', slug: `skill-${n}`, status: 'published', version: 1, author: 'Axal',
  name: `[Skill ${n}]`, purpose: `Does thing ${n} when a finance user asks.`, job: `Does thing ${n}.`, steps: ['Read.', 'Draft.'], tools: [], output_kind: 'brief', output_label: 'A brief',
  roles: [], tags: [{ slug: 'budgeting', label: 'Budgeting', category: 'finance_ops', level: 'working' }], used_by: 1, can_write: false,
  inputs: null, eligibility: { state: 'eligible', code: null, tool: null, fit: false, ...eligibility }, ...over,
});
const LEGAL = { slug: 'contracts', label: 'Contracts', category: 'legal_compliance', level: 'working' };
const AREAS_READ = [
  { area: 'finance_ops', listed: 3, published: 3, eligible: 2, attached: 0, blocked: 1, unreadable: 0, drafts: 0 },
  { area: 'legal_compliance', listed: 20, published: 0, eligible: 0, attached: 0, blocked: 0, unreadable: 0, drafts: 20 },
];
const AVAILABLE = {
  skills: [
    card(1, { fit: true }, { name: '[Cash runway snapshot]', inputs: [{ field: 'recorded balances', required: true }] }),
    card(2, { fit: false }, { name: '[Cross-area brief]', tags: [{ slug: 'product_strategy', label: 'Product strategy', category: 'product', level: 'working' }] }),
    card(3, { state: 'blocked', code: 'tool_not_approved', tool: { key: 'mercury.read', label: 'mercury.read' }, fit: true }, { name: '[Burn report]', tools: ['mercury.read'] }),
  ],
  counts: { listed: 23, published: 3, eligible: 2, attached: 0, blocked: 1, unreadable: 0, drafts: 20 },
  areas: AREAS_READ,
};

// ---------------------------------------------------------------- the model

test('the six states, each with its own word and glyph; a pre-D8768 read still maps, and role_mismatch is never a block', () => {
  // Mutation checked: eligibilityOf treating role_mismatch as blocked → the legacy assert fails.
  assert.deepEqual(Object.keys(ELIGIBILITY), ['listed', 'published', 'eligible', 'attached', 'blocked', 'unreadable']);
  assert.equal(new Set(Object.values(ELIGIBILITY).map((x) => x.word)).size, 6);
  assert.equal(new Set(Object.values(ELIGIBILITY).map((x) => x.glyph)).size, 6);
  assert.deepEqual(eligibilityOf({ eligibility: { state: 'blocked', code: 'tool_not_approved', tool: { key: 't' }, fit: true } }), { state: 'blocked', code: 'tool_not_approved', tool: { key: 't' }, fit: true });
  assert.equal(eligibilityOf({ blocked: { code: 'role_mismatch' } }).state, 'eligible', 'D4116: an old role refusal is fit, not a block');
  assert.equal(eligibilityOf({ blocked: { code: 'tool_not_approved', tool: { key: 't' } } }).state, 'blocked');
  assert.equal(eligibilityOf({ assigned: true }).state, 'attached');
  assert.equal(eligibilityOf({ status: 'draft' }).state, 'listed');
  assert.equal(eligibilityOf({ eligibility: { state: 'nonsense' }, status: 'published' }).state, 'eligible');
});

test('every state that cannot be ticked says why and what to do; counts and areas read as one line', () => {
  // Mutations checked: the tool recovery dropped → the Settings assert fails; drafts counted as published in
  // areaLine → the Legal line reads "20 published".
  assert.match(eligibilityWhy({ state: 'blocked', code: 'tool_not_approved', tool: { label: 'mercury.read' } }), /Needs the mercury\.read read tool, which its sponsor hasn’t approved\. Approve it in Settings › Connected tools/);
  assert.match(eligibilityWhy({ state: 'listed' }), /Not published yet, so it can’t be attached\. Axal publishes a skill only once it passes the golden-case bar/);
  assert.match(eligibilityWhy({ state: 'unreadable', code: 'tools_unreadable' }), /couldn’t be read/);
  assert.equal(eligibilityWhy({ state: 'eligible' }), null);
  assert.equal(countsLine(AVAILABLE.counts), '23 listed · 3 published · 2 can attach · 0 attached · 1 blocked by policy · 0 couldn’t be read');
  assert.equal(countsLine(null), null, 'no counts read: nothing drawn, never zeros');
  assert.equal(areaLine({ listed: 21, published: 6, drafts_company: 1, drafts_axal: 14, unreadable: 0 }),
    '21 listed · 6 published · 1 draft of yours · 14 Axal drafts in qualification · 0 couldn’t be read');
  assert.equal(inputsLine(null), null);
  assert.equal(inputsLine([{ field: 'balances', required: true }, { field: 'burn', required: false }]), 'balances · burn (optional)');
});

test('the empty state: a draft-only area says so and offers the area with something to attach; never "of this role"', () => {
  // Mutation checked: emptyEligible ignoring the area's counts → the draft-only text is missing.
  const legal = emptyEligible({ counts: AVAILABLE.counts, areas: AREAS_READ, area: 'legal_compliance' });
  assert.equal(legal.text, 'Legal is a draft-only area: 20 listed, none published yet. A draft can’t be attached.');
  assert.deepEqual(legal.way, { area: 'finance_ops', text: 'Finance has 2 you can attach.' });
  assert.match(emptyEligible({ q: 'zzz' }).text, /Your picks are kept/);
  assert.match(emptyEligible({ counts: { listed: 20, published: 0, eligible: 0, attached: 0, blocked: 0, unreadable: 0 }, areas: [] }).text, /None of the 20 listed skills is published yet/);
  assert.doesNotMatch(read('frontend/src/pages/team/SkillSheets.jsx'), /of this role/, 'the old drawer sentence is gone');
  assert.equal(wizardSkillsNext(0), 'Next: model and cap, with no skills');
  assert.equal(wizardSkillsNext(2), 'Next: model and cap');
  assert.match(read('frontend/src/pages/team/AddAgentSheet.jsx'), /wizardSkillsNext\(chosenSkills\.length\)/);
});

test('cards read the job line and inputs; search reads job, inputs and output; fit sorts first and removes nothing', () => {
  // Mutations checked: description taken from purpose → the routing clause shows; pickerRows filtering non-fit →
  // the cross-area skill is gone.
  const s = fromWorkerSkill(AVAILABLE.skills[0]);
  assert.equal(s.description, 'Does thing 1.');
  assert.deepEqual(s.inputs, [{ field: 'recorded balances', required: true }]);
  assert.equal(matchesSkill(s, 'recorded balances'), true);
  assert.equal(matchesSkill(s, 'a brief'), true, 'the output');
  assert.equal(matchesSkill(s, 'finance user'), false, 'the routing clause is not the job');
  const v = fromWorkerEligible(AVAILABLE);
  assert.deepEqual(pickerRows(v.skills).map((x) => x.name), ['[Cash runway snapshot]', '[Burn report]', '[Cross-area brief]']);
  assert.deepEqual(v.counts, AVAILABLE.counts);
  assert.equal(fromWorkerEligible({ skills: [] }).counts, null);
});

// ---------------------------------------------------------------- the picker, mounted

const settle = async (m) => { for (let i = 0; i < 4; i += 1) await m.flush(); };
function helpers(m) {
  const byId = (id) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === id);
  return {
    byId,
    async press(id) { const [n] = byId(id); assert.ok(n, `no ${id}`); await act(async () => { m.props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(m); },
    async tick(id) { const [n] = byId(id); assert.ok(n, `no ${id}`); assert.ok(!m.props(n).disabled, `${id} is disabled`); await act(async () => { m.props(n).onChange({ target: {} }); }); await settle(m); },
    async type(id, value) { const [n] = byId(id); assert.ok(n, `no ${id}`); await act(async () => { m.props(n).onChange({ target: { value } }); }); await settle(m); },
    disabled(id) { const [n] = byId(id); return !!m.props(n)?.disabled; },
  };
}

test('SkillPicker: blocked and cross-area rows, a draft-only area, the way on, and picks kept across search, area and details', async () => {
  // Mutations checked: the picks read from the filtered rows → the "1 pick is kept" and final pick asserts fail; a
  // blocked row tickable → the disabled assert fails; the details Back clearing the picks → the last assert fails.
  let last = null;
  function Harness() {
    const [picked, setPicked] = useState(() => new Set());
    last = picked;
    const tick = (u) => setPicked((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
    return h(SkillPicker, { value: fromWorkerEligible(AVAILABLE), picked, onTick: tick, testPrefix: 'p' });
  }
  const m = await mountContracts(h(Harness), '/x');
  const t = helpers(m);
  try {
    assert.match(m.text(), /23 listed · 3 published · 2 can attach · 0 attached · 1 blocked by policy · 0 couldn’t be read/);
    assert.match(m.text(), /\[Cash runway snapshot\][^]*Can attach[^]*Natural fit/);
    assert.match(m.text(), /\[Cross-area brief\]/, 'outside the natural fit, still listed');
    assert.equal(t.disabled(`p-${uid(3)}`), true, 'the opted-out tool blocks');
    assert.match(m.text(), /Blocked by policy[^]*Needs the mercury\.read read tool, which its sponsor hasn’t approved/);
    await t.tick(`p-${uid(2)}`);
    assert.deepEqual([...last], [uid(2)], 'a cross-area skill is picked like any other');
    await t.type('p-search', 'zzz');
    assert.match(m.text(), /No skill matches this search\. Your picks are kept\./);
    assert.match(m.text(), /Your 1 pick is kept\./);
    await t.type('p-search', '');
    await t.press('p-area-legal_compliance');
    assert.match(m.text(), /Legal is a draft-only area: 20 listed, none published yet\. A draft can’t be attached\./);
    await t.press('p-way');
    assert.match(m.text(), /\[Cash runway snapshot\]/, 'the way on shows Finance');
    await t.press(`p-details-${uid(1)}`);
    assert.equal(t.byId('skill-picker-detail').length, 1);
    assert.match(m.text(), /Needs: recorded balances[^]*You get: A brief[^]*Run cost · Not recorded/);
    await t.press('skill-picker-back');
    assert.equal(t.byId('skill-picker-detail').length, 0);
    assert.deepEqual([...last], [uid(2)], 'the picks survive the details');
  } finally { await m.unmount(); }
});

test('SkillsStep (the wizard) reads the same rule for an agent not yet added: fit picked for you, blocked never, tools for step 3', async () => {
  // Mutations checked: the step filtering by role on the client again (as before D8768) → the cross-area row is
  // missing; the default picks taking a blocked or non-fit skill → the picks assert fails.
  const previous = globalThis.fetch;
  const seen = [];
  const answer = {
    ...AVAILABLE,
    skills: [
      card(1, { fit: true }, { tools: ['stripe.read'], tools_to_grant: ['stripe.read'] }),
      card(2, { fit: false }),
      card(3, { state: 'blocked', code: 'tool_not_approved', tool: { key: 'mercury.read', label: 'mercury.read' }, fit: true }),
      card(4, { fit: true }),
    ],
  };
  globalThis.fetch = async (u) => {
    const url = new URL(String(u), 'http://x');
    seen.push(`${url.pathname}${url.search}`);
    const body = url.pathname === '/api/teams/company/nw1/skills/eligible' ? answer : { available: false };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  let picks = null;
  function Harness() {
    const [picked, setPicked] = useState(null);
    picks = picked;
    return h(SkillsStep, { scope: { kind: 'company', company: { uid: 'nw1' } }, role: 'general_counsel', model: null, persona: 'ryssa', picked, setPicked, onList() {} });
  }
  const m = await mountContracts(h(Harness), '/x');
  try {
    await settle(m);
    assert.ok(seen.includes('/api/teams/company/nw1/skills/eligible?role=general_counsel&persona=ryssa'), seen.join(' '));
    assert.deepEqual([...picks].sort(), [uid(1), uid(4)].sort(), 'eligible and natural fit only');
    assert.match(m.text(), /\[Skill 2\]/, 'a cross-area skill is offered');
    assert.match(m.text(), /Step 3 will ask you to approve stripe\.read\./);
    assert.equal(helpers(m).disabled(`add-agent-skill-${uid(3)}`), true);
  } finally { await m.unmount(); globalThis.fetch = previous; }
});

function read(p) { return readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'); }
