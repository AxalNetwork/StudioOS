// D8768 part 3 (#8768) — the skill picker's keyboard and its TMS09 states. TMS15 draws the rows as a listbox:
// `/` focuses search, ↑ ↓ Home End move, Space ticks an eligible row and says why any other stays unticked, Enter
// opens details and Esc comes back, Esc in search clears the words before it closes the drawer, and a polite live
// line says what the list holds after each search or area change. TMS09 draws loading ("—" counts, never 0), a
// failed read with Try again that keeps the picks, offline (the picks kept, Add waits) and a refusal at save after
// a race (the skill unticked, the rest kept, nothing changed).
//
// Names and figures are synthetic fixtures.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_picker_keyboard_8768.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { AddSkillsSheet, SkillPicker } from '../src/pages/team/SkillSheets.jsx';
import { YourAgents } from '../src/pages/team/SkillsTab.jsx';
import { through } from '../src/pages/team/agentsAdapter.js';
import {
  COUNTS_LOADING, fromWorkerEligible, listboxMove, offlineWords, pickerFailureWords, pickerLiveLine, raceRefusal, readAtWords, spaceOnRow, yourAgentsLine,
} from '../src/pages/team/skillsModel.js';

const h = React.createElement;
const uid = (n) => String(n).padStart(32, 'c');

const card = (n, eligibility, over = {}) => ({
  uid: uid(n), scope: 'hq', slug: `skill-${n}`, status: 'published', version: 1, author: 'Axal',
  name: `[Skill ${n}]`, purpose: `Does thing ${n}.`, job: `Does thing ${n}.`, steps: ['Read.'], tools: [], output_kind: 'brief', output_label: 'A brief',
  roles: [], tags: [{ slug: 'budgeting', label: 'Budgeting', category: 'finance_ops', level: 'working' }], used_by: 1, can_write: false,
  inputs: null, eligibility: { state: 'eligible', code: null, tool: null, fit: false, ...eligibility }, ...over,
});
const LEGAL_TAG = { slug: 'contracts', label: 'Contracts', category: 'legal_compliance', level: 'working' };
const AVAILABLE = {
  skills: [
    card(1, { fit: true }, { name: '[Runway snapshot]' }),
    card(2, { state: 'blocked', code: 'tool_not_approved', tool: { key: 'mercury.read', label: 'mercury.read' }, fit: true }, { name: '[Burn report]' }),
    card(3, {}, { name: '[Contract digest]', tags: [LEGAL_TAG] }),
  ],
  counts: { listed: 3, published: 3, eligible: 2, attached: 0, blocked: 1, unreadable: 0, drafts: 0 },
  areas: [
    { area: 'finance_ops', listed: 2, published: 2, eligible: 1, attached: 0, blocked: 1, unreadable: 0, drafts: 0 },
    { area: 'legal_compliance', listed: 1, published: 1, eligible: 1, attached: 0, blocked: 0, unreadable: 0, drafts: 0 },
  ],
};

// ---------------------------------------------------------------- the model

test('listboxMove: ↑ ↓ Home End move and stop at the ends; any other key is let through', () => {
  // Mutation checked: ArrowDown wrapping to 0 at the end → the end assert fails.
  assert.equal(listboxMove(0, 'ArrowDown', 3), 1);
  assert.equal(listboxMove(2, 'ArrowDown', 3), 2, 'stops at the last row');
  assert.equal(listboxMove(0, 'ArrowUp', 3), 0);
  assert.equal(listboxMove(1, 'Home', 3), 0);
  assert.equal(listboxMove(0, 'End', 3), 2);
  assert.equal(listboxMove(7, 'ArrowUp', 3), 0, 'a stale index starts again at the top');
  assert.equal(listboxMove(0, 'a', 3), null);
  assert.equal(listboxMove(0, 'ArrowDown', 0), null);
});

test('spaceOnRow: only an eligible row ticks; any other says its state and why', () => {
  // Mutation checked: spaceOnRow ticking a blocked row → the tick assert fails.
  const [ok, blocked] = AVAILABLE.skills;
  assert.deepEqual(spaceOnRow(ok, new Set()), { tick: true, say: '[Runway snapshot] picked.' });
  assert.deepEqual(spaceOnRow(ok, new Set([ok.uid])), { tick: true, say: '[Runway snapshot] removed from your picks.' });
  const r = spaceOnRow(blocked, new Set());
  assert.equal(r.tick, false);
  assert.match(r.say, /^\[Burn report\]: Blocked by policy\. Needs the mercury\.read read tool, which its sponsor hasn’t approved\./);
  assert.match(spaceOnRow(card(9, { state: 'attached' }), new Set()).say, /Attached\. Already attached\./);
});

test('pickerLiveLine counts the rows shown, with the area and the search words', () => {
  // Mutation checked: counting every skill instead of the rows shown → the Finance line reads 2 can attach.
  const fin = AVAILABLE.skills.slice(0, 2);
  assert.equal(pickerLiveLine(fin, { area: 'finance_ops' }), '1 can attach, 1 blocked in Finance.');
  assert.equal(pickerLiveLine(AVAILABLE.skills, { q: 'thing' }), '2 can attach, 1 blocked in all areas for “thing”.');
  assert.equal(pickerLiveLine([card(5, { state: 'attached' }), card(6, { state: 'unreadable', code: 'unreadable' })]), '0 can attach, 0 blocked in all areas; 1 attached, 1 couldn’t be read.');
});

test('TMS09 words: loading never reads 0, a failure is never "No skills", offline keeps the picks', () => {
  assert.doesNotMatch(COUNTS_LOADING, /\b0\b/);
  assert.match(COUNTS_LOADING, /^— listed · — published/);
  assert.equal(pickerFailureWords(0), 'Nothing below is a guess, and this isn’t “No skills”.');
  assert.match(pickerFailureWords(2), /Your 2 picks are kept\./);
  assert.equal(readAtWords(new Date(2026, 10, 27, 9, 5)), '09:05');
  assert.equal(readAtWords('nonsense'), null);
  assert.equal(offlineWords(2, new Date(2026, 10, 27, 10, 42)), 'The list is from 10:42. Your 2 picks are kept; adding waits until you’re back.');
  assert.equal(offlineWords(0), 'Adding waits until you’re back.');
});

test('raceRefusal names the refused pick, says nothing changed, and leaves other refusals alone', () => {
  // Mutation checked: raceRefusal matching any refusal code → the not_manager assert fails.
  const chosen = [AVAILABLE.skills[0], AVAILABLE.skills[2]];
  const r = raceRefusal({ available: false, refused: true, code: 'skill_suspended', skill_uid: uid(3) }, chosen);
  assert.equal(r.uid, uid(3));
  assert.equal(r.text, '[Contract digest] was not added: HQ suspended it a moment ago (skill_suspended). Nothing changed. It is taken out of your picks; Add again for the other 1.');
  assert.equal(raceRefusal({ available: false, refused: true, code: 'not_manager', skill_uid: uid(3) }, chosen), null);
  assert.equal(raceRefusal({ available: false, refused: true, code: 'skill_suspended', skill_uid: uid(8) }, chosen), null, 'not one of the picks');
  assert.equal(raceRefusal({ available: false, refused: true, code: 'skill_suspended' }, chosen), null);
});

test('the adapter keeps the Worker’s skill_uid on a refused skill list', async () => {
  // Mutation checked: `through` dropping skill_uid → both asserts fail.
  const fail = (status, data) => async () => { const e = new Error('x'); e.status = status; e.code = data.error; e.data = data; throw e; };
  const a = await through(fail(409, { error: 'skill_suspended', skill_uid: uid(4) }));
  assert.equal(a.skill_uid, uid(4));
  const b = await through(fail(403, { error: 'capability_missing', skill_uid: uid(5) }));
  assert.equal(b.skill_uid, uid(5));
});

// ---------------------------------------------------------------- mounted

const settle = async (m) => { for (let i = 0; i < 5; i += 1) await m.flush(); };
const ev = (key, over = {}) => {
  const e = { key, prevented: false, stopped: false, target: { tagName: 'DIV' }, ...over };
  e.preventDefault = () => { e.prevented = true; };
  e.stopPropagation = () => { e.stopped = true; };
  return e;
};
function helpers(m) {
  const byId = (id) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === id);
  const one = (id) => { const [n] = byId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    byId,
    p: (id) => m.props(one(id)),
    async key(id, e, handler = 'onKeyDown') { await act(async () => { m.props(one(id))[handler](e); }); await settle(m); return e; },
    async press(id) { await act(async () => { m.props(one(id)).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(m); },
    async type(id, value) { await act(async () => { m.props(one(id)).onChange({ target: { value } }); }); await settle(m); },
    activeRow() { return m.nodes().filter((n) => m.props(n)?.role === 'option' && m.props(n)?.tabIndex === 0).map((n) => m.props(n)['data-testid']); },
  };
}

test('SkillPicker as a listbox: one tab stop, arrows move it, Space ticks or says why, Enter and Esc for details, Esc clears search first', async () => {
  // Mutations checked: Space ticking a blocked row → the picks assert after it fails; the search Escape not clearing
  // the words → the q assert fails; the details Esc closing the drawer (not handled) → `prevented` is false; the
  // live line not following the area → the Legal line assert fails.
  let last = null;
  function Harness() {
    const [picked, setPicked] = useState(() => new Set());
    last = picked;
    const tick = (u) => setPicked((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
    return h(SkillPicker, { value: fromWorkerEligible(AVAILABLE), picked, onTick: tick, testPrefix: 'k' });
  }
  const m = await mountContracts(h(Harness), '/x');
  const t = helpers(m);
  try {
    assert.equal(t.p('k-listbox').role, 'listbox');
    assert.equal(t.p('k-listbox')['aria-multiselectable'], 'true');
    assert.deepEqual(t.activeRow(), [`k-option-${uid(1)}`], 'one tab stop, on the first row');
    assert.equal(t.p(`k-option-${uid(2)}`)['aria-disabled'], true);
    assert.equal(t.p('k-live').children, '2 can attach, 1 blocked in all areas.');

    await t.key('k-listbox', ev('ArrowDown'));
    assert.deepEqual(t.activeRow(), [`k-option-${uid(2)}`]);
    const space = await t.key('k-listbox', ev(' '));
    assert.equal(space.prevented, true, 'Space does not scroll the drawer');
    assert.deepEqual([...last], [], 'a blocked row stays unticked');
    assert.match(t.p('k-live').children, /^\[Burn report\]: Blocked by policy\. Needs the mercury\.read read tool/);

    await t.key('k-listbox', ev('Home'));
    await t.key('k-listbox', ev(' '));
    assert.deepEqual([...last], [uid(1)]);
    assert.equal(t.p(`k-option-${uid(1)}`)['aria-selected'], true);
    assert.equal(t.p('k-live').children, '[Runway snapshot] picked.');

    await t.key('k-listbox', ev('End'));
    assert.deepEqual(t.activeRow(), [`k-option-${uid(3)}`]);
    await t.key('k-listbox', ev('Enter'));
    assert.equal(t.byId('skill-picker-detail').length, 1, 'Enter opens details');
    const esc = await t.key('skill-picker-detail', ev('Escape'));
    assert.equal(esc.prevented, true, 'the Sheet leaves an Escape already handled');
    assert.equal(t.byId('skill-picker-detail').length, 0, 'Esc goes back to the list');
    assert.deepEqual([...last], [uid(1)], 'the picks survive the details');
    assert.deepEqual(t.activeRow(), [`k-option-${uid(3)}`], 'the same row');

    await t.type('k-search', 'contract');
    assert.equal(t.p('k-search').value, 'contract');
    assert.equal(t.p('k-live').children, '1 can attach, 0 blocked in all areas for “contract”.');
    const clear = await t.key('k-search', ev('Escape', { target: { tagName: 'INPUT' } }));
    assert.equal(clear.prevented && clear.stopped, true, 'the first Esc clears the words, and the drawer stays');
    assert.equal(t.p('k-search').value, '');
    const close = await t.key('k-search', ev('Escape', { target: { tagName: 'INPUT' } }));
    assert.equal(close.prevented, false, 'with no words, Esc is left to close the drawer');

    await t.press('k-area-legal_compliance');
    assert.equal(t.p('k-live').children, '1 can attach, 0 blocked in Legal.');
    assert.deepEqual([...last], [uid(1)], 'an area never drops a pick');

    const slash = await t.key('k-picker', ev('/'));
    assert.equal(slash.prevented, true, '/ focuses search');
  } finally { await m.unmount(); }
});

test('the 390 layout: search, area chips and rows are 44 px targets on a phone', async () => {
  const m = await mountContracts(h(SkillPicker, { value: fromWorkerEligible(AVAILABLE), picked: new Set(), onTick() {}, testPrefix: 'k' }), '/x');
  const t = helpers(m);
  try {
    assert.match(t.p('k-search').className, /max-sm:h-11/);
    assert.match(t.p('k-area-finance_ops').className, /max-sm:min-h-\[44px\]/);
    assert.match(t.p(`k-option-${uid(1)}`).className, /max-sm:min-h-\[44px\]/);
  } finally { await m.unmount(); }
});

/** A fetch that answers `GET …/skills/available` from `reads` in turn and `PUT …/skills` from `put`. */
function mockFetch({ reads, put }) {
  const seen = [];
  const json = (status, body) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const method = (init.method || 'GET').toUpperCase();
    seen.push(`${method} ${url.pathname}`);
    if (url.pathname.endsWith('/skills/available')) { const r = reads.shift(); return json(r.status, r.body); }
    if (method === 'PUT' && url.pathname.endsWith('/skills')) { seen.push(init.body); return json(put.status, put.body); }
    return json(404, { error: 'not_found' });
  };
  return { fetch, seen };
}

test('Add skills (TMS09): a failed read keeps the picks and tries again; a refusal at save after a race unticks that skill only', async () => {
  // Mutations checked: Try again clearing the picks → the "2 picks are kept" assert fails; the race not unticking →
  // the Add 1 skill label assert fails; the race read not repeated → the third read assert fails.
  const previous = globalThis.fetch;
  const { fetch, seen } = mockFetch({
    reads: [
      { status: 200, body: AVAILABLE },
      { status: 500, body: { error: 'boom' } },
      { status: 200, body: AVAILABLE },
      { status: 200, body: AVAILABLE },
    ],
    put: { status: 409, body: { error: 'skill_suspended', message: 'Suspended.', skill_uid: uid(3) } },
  });
  globalThis.fetch = fetch;
  const m = await mountContracts(h(AddSkillsSheet, { agent: { uid: 'ag1' }, current: [], radar: null, onClose() {}, onSaved() {} }), '/x');
  const t = helpers(m);
  try {
    await settle(m);
    await act(async () => { t.p(`add-skill-${uid(1)}`).onChange({ target: {} }); });
    await act(async () => { t.p(`add-skill-${uid(3)}`).onChange({ target: {} }); });
    await settle(m);
    assert.match(m.text(), /Add 2 skills/);

    await t.press('add-skill-area-legal_compliance');
    await act(async () => { t.p('add-skills-save').onClick(); });
    await settle(m);
    // The PUT is refused (409: suspended after the read), and the list is read again; that read fails (500).
    assert.ok(seen.includes('PUT /api/teams/agents/ag1/skills'), seen.join(' '));
    assert.match(m.text(), /\[Contract digest\] was not added: HQ suspended it a moment ago \(skill_suspended\)\. Nothing changed\./);
    assert.match(m.text(), /The skills it could take couldn’t be read\./);
    assert.match(m.text(), /Nothing below is a guess, and this isn’t “No skills”\. Your 1 pick is kept\./);
    assert.equal(t.byId('add-skill-listbox').length, 0, 'no guessed list under a failure');

    await t.press('add-skills-retry');
    assert.equal(seen.filter((x) => x === 'GET /api/teams/agents/ag1/skills/available').length, 3, 'Try again reads again');
    assert.match(m.text(), /Add 1 skill\b/, 'the refused skill is unticked, the other kept');
    assert.equal(t.p(`add-skill-${uid(1)}`).checked, true);
    assert.equal(t.p(`add-skill-${uid(3)}`).checked, false);
  } finally { await m.unmount(); globalThis.fetch = previous; }
});

test('the skill page’s Your agents (TMS02): every managed agent with the one rule’s state; a failed read shows none as Can attach', async () => {
  // Mutations checked: yourAgentsLine counting from the rows instead of the Worker's counts → the line assert fails;
  // the failed read falling back to "Can attach" rows → the no-chip assert fails.
  assert.equal(yourAgentsLine({ listed: 3, published: 3, eligible: 1, attached: 1, blocked: 1, unreadable: 0 }), 'Your 3 agents · 1 attached · 1 can attach · 1 blocked');
  assert.equal(yourAgentsLine({ listed: 1, published: 1, eligible: 0, attached: 0, blocked: 0, unreadable: 1 }), 'Your 1 agent · 0 attached · 0 can attach · 0 blocked · 1 couldn’t be read');
  assert.equal(yourAgentsLine(null), null);
  const previous = globalThis.fetch;
  const agent = (n, name, eligibility) => ({ uid: `ag${n}`, name, role_key: 'cfo', skill_count: 2, assigned: eligibility.state === 'attached', eligibility: { code: null, tool: null, fit: false, ...eligibility }, scope: { kind: 'company', company_name: '[Atlas]' } });
  const answers = [
    { status: 500, body: { error: 'boom' } },
    { status: 200, body: {
      agents: [
        agent(1, '[Tessa]', { state: 'attached', fit: true }),
        agent(2, '[Kade]', { state: 'eligible' }),
        agent(3, '[Vesta]', { state: 'blocked', code: 'tool_not_approved', tool: { key: 'mercury.read', label: 'mercury.read' } }),
      ],
      counts: { listed: 3, published: 3, eligible: 1, attached: 1, blocked: 1, unreadable: 0, drafts: 0 },
    } },
  ];
  globalThis.fetch = async (u) => {
    const url = new URL(String(u), 'http://x');
    const r = url.pathname.endsWith('/assignable') ? answers.shift() : { status: 404, body: { error: 'not_found' } };
    return { ok: r.status < 400, status: r.status, statusText: String(r.status), headers: { get: () => 'application/json' }, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
  const m = await mountContracts(h(YourAgents, { skill: { uid: uid(1), name: '[Runway snapshot]', status: 'published' } }), '/x');
  const t = helpers(m);
  try {
    await settle(m);
    assert.match(m.text(), /Your agents’ eligibility couldn’t be read\. None is shown as Can attach until it is\./);
    assert.equal(m.nodes().filter((n) => m.props(n)?.['data-testid'] === 'eligibility-chip').length, 0, 'no state is guessed');
    await t.press('skill-your-agents-retry');
    assert.equal(t.p('skill-your-agents-line').children, 'Your 3 agents · 1 attached · 1 can attach · 1 blocked');
    assert.match(m.text(), /\[Tessa\]✓Attached/);
    assert.match(m.text(), /\[Kade\]\+Can attach/, 'outside the natural fit, still Can attach');
    assert.match(m.text(), /\[Vesta\][^]*Blocked by policy[^]*Needs the mercury\.read read tool, which its sponsor hasn’t approved\. Approve it in Settings/);
  } finally { await m.unmount(); globalThis.fetch = previous; }
});

test('Add skills (TMS09): offline says what is kept, and Add waits', async () => {
  // Mutation checked: Add left enabled offline → the disabled assert fails.
  const previous = globalThis.fetch;
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
  globalThis.fetch = mockFetch({ reads: [{ status: 200, body: AVAILABLE }], put: { status: 200, body: {} } }).fetch;
  const m = await mountContracts(h(AddSkillsSheet, { agent: { uid: 'ag1' }, current: [], radar: null, onClose() {}, onSaved() {} }), '/x');
  const t = helpers(m);
  try {
    await settle(m);
    await act(async () => { t.p(`add-skill-${uid(1)}`).onChange({ target: {} }); });
    await settle(m);
    assert.equal(t.byId('add-skills-offline').length, 1);
    assert.match(m.text(), /You’re offline\. The list is from \d\d:\d\d\. Your 1 pick is kept; adding waits until you’re back\./);
    assert.equal(t.p('add-skills-save').disabled, true);
  } finally {
    await m.unmount();
    globalThis.fetch = previous;
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
});
