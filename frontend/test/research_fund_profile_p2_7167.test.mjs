/**
 * D7167 part 2 (#7167) — Research › Funds profile, the frontend part 1 left:
 * the project picker with each project's membership and archived projects
 * read-only (FND-P05, RFP08 C); Compare in project into an existing comparison
 * with n of 6 (FND-P06 B); Back to results keeping the row selected and
 * focusing it, or the results heading (FND-P10); and the phone comparison By
 * fund and By attribute (FND-P08 D and E).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_fund_profile_p2_7167.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AddToResearch from '../src/pages/research/AddToResearch.jsx';
import { ProjectComparisons } from '../src/pages/research/ProjectComparisons.jsx';
import { FundDirectoryView } from '../src/pages/research/FundDirectory.jsx';
import { EMPTY_QUERY } from '../src/pages/research/fundDirectoryRead.js';
import { returnTarget } from '../src/pages/research/fundProfileRead.js';
import { MEMBERSHIP_READS, columnAfterRemoval, fundPage, joinChoices, joinOutcome, pickerView } from '../src/pages/research/researchComparisons.js';
import { researchProjectsApi } from '../src/lib/api/researchProjects.js';
import { researchProjectComparisonsApi } from '../src/lib/api/researchProjectComparisons.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const settle = async (m) => { for (let i = 0; i < 6; i += 1) await m.flush(); };
const press = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: null }); }); await settle(m); };
const pick = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onChange(); }); await settle(m); };
const submit = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onSubmit({ preventDefault() {} }); }); await settle(m); };
const fail = (status, code) => Object.assign(new Error(code), { status, code, data: { detail: code } });

const OPP = { uid: 'dawncapital-opp', name: 'Dawn Capital Opp' };
const PROJECTS = { items: [
  { uid: 'p1', title: '[Seed funds]', status: 'in_progress', updated_at: '2026-11-12 14:02:00' },
  { uid: 'p2', title: '[EU growth]', status: 'in_progress', updated_at: '2026-11-18 09:00:00' },
  { uid: 'p3', title: '[Old thesis]', status: 'archived', archived_at: '2026-03-03 10:00:00', updated_at: '2026-03-03 10:00:00' },
] };
const subject = (uid) => ({ kind: 'fund', uid, name: uid, state: 'listed' });
const member = (uid) => ({ ...subject(uid), values: {} });
const READS = {
  // p1 already holds Opp; p2 holds two other funds and two comparisons, one of them full.
  p1: { subjects: [subject('dawncapital-opp'), subject('afore-iv')], comparisons: [], limits: { members: 6 } },
  p2: {
    limits: { members: 6 },
    subjects: [subject('afore-iv'), subject('dawncapital-v')],
    comparisons: [
      { uid: 'k1', kind: 'fund', title: 'Dawn Capital V · Afore IV', members: [member('dawncapital-v'), member('afore-iv')] },
      { uid: 'k2', kind: 'fund', title: '[Seed vehicles · long list]', members: ['a', 'b', 'c', 'd', 'e', 'f'].map(member) },
      { uid: 'k3', kind: 'company', title: 'Companies', members: [] },
    ],
  },
};
const ok = (value) => ({ status: 'ok', value });

test('pickerView: active projects with what they hold, Already here not offered for Add, archived apart and read-only', () => {
  const memberships = new Map([['p1', ok(READS.p1)], ['p2', ok(READS.p2)]]);
  const v = pickerView(ok(PROJECTS), memberships, [OPP], 'fund', 'add');
  assert.equal(v.state, 'ok');
  // Mutation checked: leave a project that holds the fund offered → p1 is offered.
  assert.deepEqual(v.active.map((p) => [p.uid, p.offered, p.chip, p.meta]), [
    ['p1', false, 'Already here', 'Funds · 2 · updated 12 Nov 2026'],
    ['p2', true, null, 'Funds · 2 · updated 18 Nov 2026'],
  ]);
  // Mutation checked: drop the archived filter on `active` → p3 is offered among the active.
  assert.deepEqual(v.archived.map((p) => [p.uid, p.offered, p.chip, p.meta]), [['p3', false, 'Read-only', 'Archived 3 Mar 2026 · restore it in My Research to change it']]);
  // Compare may still use a project that holds the fund: the comparison is what matters there.
  assert.equal(pickerView(ok(PROJECTS), memberships, [OPP], 'fund', 'compare').active[0].offered, true);
  // Two items, one of them there: offered, and it says so.
  const two = pickerView(ok(PROJECTS), memberships, [OPP, { uid: 'x', name: 'X' }], 'fund', 'add');
  assert.deepEqual([two.active[0].offered, two.active[0].note], [true, '1 of 2 already here']);
});

test('pickerView: a contents read that failed says Unavailable and stays offered; loading, unchecked, an answer and a failed list', () => {
  const failed = pickerView(ok(PROJECTS), new Map([['p1', { status: 'failed' }], ['p2', { status: 'loading' }]]), [OPP], 'fund');
  // Mutation checked: read a failed contents read as "holds nothing" → meta 'Funds · 0 …' and no Unavailable.
  assert.deepEqual(failed.active.map((p) => [p.offered, p.meta]), [
    [true, 'Unavailable: what it holds could not be read · updated 12 Nov 2026'],
    [true, 'Checking what it holds… · updated 18 Nov 2026'],
  ]);
  assert.doesNotMatch(failed.active[0].meta, /\b0\b/);
  const many = { items: Array.from({ length: MEMBERSHIP_READS + 1 }, (_, i) => ({ uid: `q${i}`, title: `P${i}`, status: 'in_progress' })) };
  assert.equal(pickerView(ok(many), new Map(), [OPP], 'fund').active[MEMBERSHIP_READS].meta, 'What it holds was not checked');
  const answer = pickerView(ok(PROJECTS), new Map(), [{ uid: 'ans', name: 'A' }], 'answer');
  assert.deepEqual(answer.active.map((p) => [p.offered, p.chip]), [[true, null], [true, null]]);
  assert.equal(pickerView({ status: 'failed' }, new Map(), [OPP], 'fund').state, 'unreadable');
  assert.equal(pickerView({ status: 'loading' }, new Map(), [OPP], 'fund').state, 'loading');
});

test('joinChoices and joinOutcome: n of 6, Full and Already in it not offered, the sentence after joining', () => {
  const j = joinChoices(ok(READS.p2), 'fund', 'dawncapital-opp');
  // Mutation checked: offer a full comparison → k2 offered; count the kind wrongly → k3 listed.
  assert.deepEqual(j.choices.map((k) => [k.uid, k.offered, k.chip, k.meta]), [
    ['k1', true, null, '2 of 6 funds'],
    ['k2', false, 'Full', '6 of 6 funds · remove one there first'],
  ]);
  const there = joinChoices(ok(READS.p2), 'fund', 'afore-iv').choices[0];
  assert.deepEqual([there.offered, there.chip], [false, 'Already in it']);
  assert.equal(joinChoices({ status: 'failed' }, 'fund', 'x').state, 'unreadable');
  // Mutation checked: print the count before the add → "2 of 6".
  assert.equal(joinOutcome('Dawn Capital Opp', j.choices[0], { ok: true, added: true }), 'Added Dawn Capital Opp to “Dawn Capital V · Afore IV”. 3 of 6.');
  assert.equal(joinOutcome('Dawn Capital Opp', j.choices[0], { ok: true, added: false }), 'Dawn Capital Opp is already in “Dawn Capital V · Afore IV”. Nothing was added.');
});

test('fundPage and returnTarget: the pager stops at either end; focus goes to the row, or to the heading when it left', () => {
  assert.deepEqual(fundPage(6, 2), { index: 2, count: 6, label: 'Fund 3 of 6', first: false, last: false });
  // Mutation checked: wrap around like the attribute stepper → index 0 for 6.
  assert.deepEqual([fundPage(6, 9).index, fundPage(6, 9).last, fundPage(6, -1).index, fundPage(6, -1).first], [5, true, 0, true]);
  assert.equal(fundPage(0, 0).label, null);
  assert.deepEqual(returnTarget('b', [{ uid: 'a' }, { uid: 'b' }]), { focus: 'row', uid: 'b' });
  // Mutation checked: return null when the row is gone → focus stays nowhere.
  assert.deepEqual(returnTarget('z', [{ uid: 'a' }]), { focus: 'heading', uid: null });
  assert.equal(returnTarget(null, [{ uid: 'a' }]), null);
  // FND-P10: a removed column hands focus to the one that took its place, else the new last one, else Add fund (null).
  // Mutation checked: always focus the first column → 'a' for index 1.
  assert.equal(columnAfterRemoval([{ uid: 'a' }, { uid: 'c' }], 1), 'c');
  assert.equal(columnAfterRemoval([{ uid: 'a' }], 1), 'a');
  assert.equal(columnAfterRemoval([], 0), null);
});

function mountPicker(props, comparisons = {}) {
  const real = { ...researchProjectsApi };
  const realCompared = { ...researchProjectComparisonsApi };
  const calls = [];
  Object.assign(researchProjectsApi, { list: async (status) => { calls.push(['list', status]); return PROJECTS; } });
  Object.assign(researchProjectComparisonsApi, {
    list: async (uid) => { if (!READS[uid]) throw fail(404, 'not_found'); return READS[uid]; },
    addSubjects: async (...args) => { calls.push(['add', ...args]); return { ok: true, added: 1, already: 0 }; },
    addMember: async (...args) => { calls.push(['member', ...args]); return { ok: true, added: true }; },
    ...comparisons,
  });
  return mountContracts(h(AddToResearch, { kind: 'fund', items: [OPP], onClose() {}, ...props }), '/research/funds', { id: 1, role: 'founder' }).then((m) => ({
    m, calls, restore() { Object.assign(researchProjectsApi, real); Object.assign(researchProjectComparisonsApi, realCompared); },
  }));
}

test('Add to research project: every project is read; the one holding the fund says Already here; the archived one is read-only', async () => {
  const { m, calls, restore } = await mountPicker({ mode: 'add' });
  try {
    await settle(m);
    // Mutation checked: read `active` only → the archived project is never listed.
    assert.deepEqual(calls[0], ['list', 'all']);
    assert.equal(m.props(byTid(m, 'research-target-p1')).disabled, true);
    assert.match(textOf(byTid(m, 'research-target-p1-row')), /\[Seed funds\]Funds · 2 · updated 12 Nov 2026Already here/);
    assert.equal(m.props(byTid(m, 'research-target-p3')).disabled, true);
    assert.match(textOf(byTid(m, 'project-picker')), /Archived · read-only\[Old thesis\]Archived 3 Mar 2026 · restore it in My Research to change itRead-only/);
    assert.equal(m.props(byTid(m, 'research-target-p2')).disabled, false);
    await pick(m, 'research-target-p2');
    await submit(m, 'form-add-to-research');
    assert.deepEqual(calls.filter((c) => c[0] === 'add'), [['add', 'p2', 'fund', ['dawncapital-opp']]]);
    assert.match(textOf(byTid(m, 'add-to-research-result')), /Added Dawn Capital Opp to “\[EU growth\]”\./);
  } finally { await m.unmount(); restore(); }
});

test('Compare in project: joins an existing comparison by the members route, says 3 of 6, and a full one is not offered', async () => {
  const { m, calls, restore } = await mountPicker({ mode: 'compare' });
  try {
    await settle(m);
    await pick(m, 'research-target-p2');
    assert.match(textOf(byTid(m, 'join-k1-row')), /Dawn Capital V · Afore IV2 of 6 funds/);
    // Mutation checked: offer a full comparison → join-k2 is enabled.
    assert.equal(m.props(byTid(m, 'join-k2')).disabled, true);
    assert.match(textOf(byTid(m, 'join-k2-row')), /6 of 6 funds · remove one there firstFull/);
    assert.equal(Boolean(byTid(m, 'join-k3')), false, 'a comparison of companies is not offered for a fund');
    await pick(m, 'join-k1');
    assert.match(textOf(byTid(m, 'button-add-to-research-confirm')), /Add to comparison/);
    await submit(m, 'form-add-to-research');
    // Mutation checked: create a new comparison instead → no 'member' call.
    assert.deepEqual(calls.filter((c) => c[0] === 'member'), [['member', 'p2', 'k1', 'dawncapital-opp']]);
    assert.match(textOf(byTid(m, 'add-to-research-result')), /Added Dawn Capital Opp to “Dawn Capital V · Afore IV”\. 3 of 6\./);
    assert.equal(m.props(byTid(m, 'add-to-research-open')).href, '/research/projects/p2/comparisons#comparison-k1');
  } finally { await m.unmount(); restore(); }
});

test('Compare in project: a seventh fund refused by the Worker says the limit and that nothing was added', async () => {
  const { m, restore } = await mountPicker({ mode: 'compare' }, { addMember: async () => { throw fail(409, 'comparison_full'); } });
  try {
    await settle(m);
    await pick(m, 'research-target-p2');
    await pick(m, 'join-k1');
    await submit(m, 'form-add-to-research');
    const out = byTid(m, 'add-to-research-result');
    assert.equal(m.props(out).role, 'alert');
    // Mutation checked: treat a 409 as an unknown outcome → no "Nothing was added".
    assert.match(textOf(out), /A comparison holds at most 6 columns\. Remove one first, or start another comparison\. Nothing was added\./);
    assert.ok(byTid(m, 'button-outcome-back'));
  } finally { await m.unmount(); restore(); }
});

const FUND_ATTRS = [['manager', 'Manager'], ['size', 'Reported size'], ['vintage', 'Vintage']].map(([key, label]) => ({ key, label }));
const rec = (value, extra = {}) => ({ status: 'recorded', value, source: { name: 'List', url: null }, as_of: '2026-10-04', ...extra });
const SIX = ['Dawn Capital Opp', 'Afore IV', 'Fund C', 'Fund D', 'Fund E', 'Fund F'].map((name, i) => ({
  kind: 'fund', uid: `f${i}`, name, state: 'listed', comparisons: 1,
  values: { manager: rec(name.split(' ')[0]), size: i === 1 ? rec(18_500_000_000, { currency: 'USD' }) : { status: 'not_recorded', reason: 'The list records no size for this vehicle.' }, vintage: rec(2020 + i) },
}));
const COMPARED = {
  project: { uid: 'p2', status: 'in_progress' }, directory: { company: 'ok', fund: 'ok' }, attributes: { company: [], fund: FUND_ATTRS },
  limits: { members: 6, add: 25, title: 160 }, subjects: SIX.map(({ values, ...s }) => s),
  comparisons: [{ uid: 'k2', kind: 'fund', title: '[Seed vehicles · long list]', created_at: '', updated_at: '', members: SIX }],
};

test('the phone comparison of funds: By fund pages one fund at a time, By attribute lists one attribute, n of 6 in its line', async () => {
  const m = await mountContracts(h(ProjectComparisons, { projectUid: 'p2', read: ok(COMPARED), retry() {}, archived: false, onChanged() {} }), '/research/projects/p2/comparisons', { id: 1, role: 'founder' });
  try {
    await settle(m);
    assert.equal(textOf(byTid(m, 'comparison-line-k2')), '6 of 6 funds · as reported by each source · no conversion, total or score');
    // Mutation checked: keep By company for funds → the By fund option is missing.
    assert.equal(textOf(byTid(m, 'phone-layout-k2-fund')), 'By fund');
    assert.equal(m.props(byTid(m, 'phone-layout-k2-attribute'))['aria-checked'], 'true');
    assert.ok(byTid(m, 'comparison-attribute-phone-k2'));
    await press(m, 'phone-layout-k2-fund');
    assert.equal(textOf(byTid(m, 'fund-page-k2')), 'Fund 1 of 6');
    assert.equal(m.props(byTid(m, 'button-fund-prev-k2')).disabled, true);
    await press(m, 'button-fund-next-k2');
    assert.equal(textOf(byTid(m, 'fund-page-k2')), 'Fund 2 of 6');
    const card = textOf(byTid(m, 'fund-card-k2-f1'));
    assert.match(card, /Afore IV/);
    assert.match(card, /Reported sizeUS\$185mUSD/);
    assert.equal(Boolean(byTid(m, 'fund-card-k2-f0')), false, 'one fund at a time');
    assert.match(textOf(byTid(m, 'button-card-remove-k2-f1')), /Remove from comparison/);
  } finally { await m.unmount(); }
});

test('Back to results: the row of the fund just viewed keeps its selected style until another row is opened', () => {
  const items = [{ uid: 'a', name: 'Alpha Fund', source_name: 'L' }, { uid: 'b', name: 'Beta Fund', source_name: 'L' }];
  const render = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(FundDirectoryView, {
    query: EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: null, onSelect() {}, onClose() {}, selected: null,
    result: { loading: false, error: null, data: { items, total: 2, limit: 25, offset: 0, sources: [], removed_sources: [] } }, ...props,
  })));
  const back = render({ returnedUid: 'b' });
  // Mutation checked: ignore returnedUid → no row is marked.
  assert.equal((back.match(/data-returned="true"/g) || []).length, 2, 'the card and the table row of Beta');
  assert.match(back, /<tr class="bg-violet-50\/70[^"]*" data-returned="true">[\s\S]*?data-fund-uid="b"/);
  assert.doesNotMatch(render({ returnedUid: 'b', selected: items[0] }), /data-returned/);
});
