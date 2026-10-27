/**
 * D1069 (#2939) — Validate → Build part 6: the plan complete. VB1's strip,
 * proposal cards and the one line an accepted item collapses to; VB3's states;
 * VB4's Edit and accept; VB5's wording folded into the cards; VB2a's entry on
 * the Verdict record; VB13's new evidence; VB14's Withheld and Stop; VB16's
 * read-only admin; VB17–VB19's empty, loading and failed states; VB20b's Lab
 * venture; VB21's phone accordions.
 *
 * Mounted against the Worker's own shapes (D1065's read with D1069's verdict,
 * D1066's writes, D1067's since, pause and resume, D1071's wording) through a
 * stubbed fetch. Every venture, item and label is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_plan_d1069.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import BuildPlan, { VerdictRecordWithPlan } from '../src/pages/cycles/BuildPlan.jsx';
import {
  acceptAllLine, becauseChips, dayTime, decidedLine, editPayload, landsIn, moduleItems, planCounts, planScope, planSearch, sinceLine, ventureSearch, verdictState, writeRefusal,
} from '../src/pages/cycles/buildPlanModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const FEAT = '11111111-1111-4111-8111-111111111111';
const RISK = '22222222-2222-4222-8222-222222222222';
const DONE = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';
const MUST = '55555555-5555-4555-8555-555555555555';
const DOOR = '66666666-6666-4666-8666-666666666666';
const OLD = '77777777-7777-4777-8777-777777777777';
const W = '88888888-8888-4888-8888-888888888888';
const PAIN = { kind: 'pain_group', ref: '1', label: 'Setup takes weeks', source_label: 'Recorded' };
const H1 = { kind: 'hypothesis', ref: '1', label: 'Ops leads switch for setup in a day', source_label: 'Typed' };
const LOI = (n) => ({ kind: 'signal', ref: String(n), label: 'loi', source_label: 'Document' });

const PLAN = (o = {}) => ({
  plan: { uid: 'plan-uid', scope: 'venture', trigger: 'decision', decision_id: 9, status: 'open', evidence_hash: 'h', prepared_at: '2026-10-12 14:05:00', updated_at: '2026-10-12 14:05:00', ...o.plan },
  verdict: 'verdict' in o ? o.verdict : { id: 9, decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', evidence_count: 6, bar: 5 },
  brief: { audience: [{ key: 'segment-1', label: 'Small ops teams' }], problems: [{ key: 'theme-1', label: 'Setup takes weeks' }], positioning: { valueProp: 'Set up in a day' }, replaces: [{ key: 'finding-1', label: 'Spreadsheets' }] },
  modules: {
    'solution-design': [
      { uid: DONE, kind: 'feature', status: 'accepted', payload: { title: 'Live ETA panel' }, evidence: [PAIN], decided_at: '2026-10-12 15:00:00' },
      { uid: FEAT, kind: 'feature', status: 'proposed', payload: { title: 'One-day setup wizard', description: 'A guided setup.', added_value: 'High', effort: 'M' }, evidence: [PAIN, H1] },
      { uid: RISK, kind: 'risk', status: 'proposed', payload: { title: 'Test the price objection', severity: 'high' }, evidence: [{ kind: 'finding', ref: '3', label: 'price objection', source_label: 'Recorded' }] },
      { uid: GONE, kind: 'feature', status: 'discarded', payload: { title: 'Driver mobile app' }, evidence: [PAIN], decided_at: '2026-10-12 15:10:00' },
      { uid: OLD, kind: 'feature', status: 'withdrawn', payload: { title: 'Offline mode' }, evidence: [PAIN] },
    ],
    'prototype-mvp': [{ uid: MUST, kind: 'prototype-test', status: 'proposed', payload: { title: 'Test setup in a day', method: 'Prototype test', target: '3 confirmed demand signals to invite' }, evidence: [H1, LOI(1), LOI(2), LOI(3)] }],
    'product-roadmap': [], 'company-creation': [],
    'operating-systems': [{ uid: DOOR, kind: 'connect-door', status: 'proposed', payload: { title: 'Connect GitHub (Code)', href: '/build/connect?tool=github&project_id=3' }, evidence: [H1] }],
    'founding-team': [],
  },
  ...(o.extra || {}),
});

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (/\/cycles\/build\/plan\/word\?/.test(url) && method === 'GET') return response({ wording: null });
    if (/\/cycles\/build\/plan\/since\?/.test(url)) return response({ plan: 'plan-uid', status: 'open', changed: false, new: 0, contradicting: 0 });
    if (/\/cycles\/build\/plan\?/.test(url) && method === 'GET') return response(PLAN());
    if (/\/cycles\/build\/plan\/items\/[^/]+\/accept/.test(url)) return response({ uid: FEAT, status: 'accepted', landed_table: 'mvp_features', landed_id: '5' });
    if (url.includes('/ai/me/spend')) return response({ recorded: true, by_task_recorded: true, by_task: [] });
    if (url.includes('/cycles/validate/overview')) return response({ cards: [] });
    return response({});
  };
}

async function mounted({ handle = handler(), props = {}, el = null } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el || h(BuildPlan, { tab: 'plan', projectId: 3, search: '?project_id=3', cards: [], role: 'founder', ...props }))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(container),
    ids: (prefix) => nodes().map((n) => props_(n)['data-testid']).filter((x) => typeof x === 'string' && x.startsWith(prefix)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    type: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET');

test('the model: where each kind lands, its chips, the counts, the order, and the scope kept', () => {
  assert.equal(landsIn({ kind: 'feature' }), 'Solution design › Features');
  assert.equal(landsIn({ kind: 'roadmap', payload: { lane: 'Later' } }), 'Product roadmap › Later');
  assert.equal(landsIn({ kind: 'roadmap', payload: { from_commitment: 4 } }), 'Product roadmap › Next', 'a commitment lands in Next (D1066 §1)');
  assert.equal(landsIn({ kind: 'connect-door' }), null, 'a door lands nothing');
  assert.deepEqual(becauseChips({ evidence: [PAIN, H1, LOI(1), LOI(2)] }), [
    { source: 'Recorded', text: 'Problem discovery · Setup takes weeks' },
    { source: 'Typed', text: 'Hypothesis · Ops leads switch for setup in a day' },
    { source: 'Document', text: 'Demand · 2 confirmed signals' },
  ], 'each chip with its source word; signals counted, never listed by name');
  assert.deepEqual(planCounts(PLAN()), { proposed: 4, accepted: 1, dismissed: 1 }, 'the read\'s own numbers; withdrawn is none of them');
  assert.deepEqual(moduleItems(PLAN(), 'solution-design').map((i) => i.uid), [FEAT, RISK, DONE, GONE, OLD], 'proposals first, then decided, dismissed, withdrawn');
  assert.equal(decidedLine(PLAN().modules['solution-design'][0]), 'Accepted 12 Oct · Solution design › Features');
  assert.equal(decidedLine({ status: 'discarded', decided_at: '2026-10-12' }), 'Dismissed 12 Oct · it will not be proposed again');
  assert.equal(dayTime('2026-10-12 14:05:00'), '12 Oct, 14:05 UTC');
  assert.equal(planSearch('?project_id=3&scope=h-2'), '?project_id=3&scope=h-2');
  assert.equal(planScope('?project_id=3&scope=h-2'), 'h-2');
  assert.equal(planScope('?project_id=3&scope=all'), 'venture');
  assert.equal(ventureSearch('?project_id=3&scope=h-2'), '?project_id=3');
});

test('the model: the verdict\'s three states, new evidence since, and a refusal in words', () => {
  assert.deepEqual(verdictState({ decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', evidence_count: 6 }), { kind: 'given', strip: 'From your Verdict: Proceed · 12 Oct · 6 pieces of evidence' });
  assert.match(verdictState({ decision: 'proceed', state: 'withheld', evidence_count: 2, bar: 5 }).line, /^Your verdict is withheld: 2 of 5 pieces of evidence\. You can still plan, but Raise will show the plan as resting on withheld evidence\.$/);
  assert.equal(verdictState({ decision: 'stop', state: 'given' }).kind, 'stop');
  assert.equal(verdictState(null).kind, 'none', 'no decision is none, never a Proceed');
  assert.equal(sinceLine({ plan: 'p', changed: true, new: 4, contradicting: 1 }), '4 new pieces of evidence since this plan, 1 contradicting.');
  assert.match(sinceLine({ plan: 'p', changed: true, new: null, contradicting: null }), /was not recorded for this plan/, 'a plan before D1067 counts nothing: never 0');
  assert.equal(sinceLine({ plan: 'p', changed: false, new: 0, contradicting: 0 }), null);
  assert.equal(sinceLine({ plan: null }), null);
  const item = PLAN().modules['solution-design'][1];
  assert.deepEqual(editPayload(item, { title: 'One-day setup wizard', description: 'A guided setup.', added_value: 'High', effort: 'M' }), { edit: null }, 'untouched: accepted, not edited');
  assert.deepEqual(editPayload(item, { title: 'Setup wizard', description: 'A guided setup.', added_value: 'Medium', effort: 'M' }), { edit: { title: 'Setup wizard', added_value: 'Medium' } }, 'only what changed');
  assert.equal(editPayload(item, { title: ' ' }).error, 'A title is required.');
  assert.match(editPayload(item, { title: 'x', effort: 'Huge' }).error, /Effort is not a value/);
  assert.equal(writeRefusal({ data: { code: 'writer_refused', message: 'The feature this item names is no longer on this venture.' } }, 'product-roadmap'),
    'Product roadmap could not save this: The feature this item names is no longer on this venture.');
  assert.equal(writeRefusal({ data: { code: 'unreadable', detail: 'unreadable' } }, 'solution-design'), 'This could not be saved. Nothing was saved; try again.');
  assert.equal(acceptAllLine({ accepted: 2, results: [{ ok: true }, { ok: true }, { ok: false, message: 'This item is already decided.' }], more: true }),
    '2 accepted. 1 could not be: This item is already decided. More are waiting. Press Accept all again.');
});

test('VB1 mounted: the strip, each module\'s cards with kind, Because and where it lands, accepted collapsed, dismissed struck, withdrawn said', async () => {
  const r = await mounted();
  try {
    assert.equal(r.textOf('plan-strip-verdict'), '◆ From your Verdict: Proceed · 12 Oct · 6 pieces of evidence');
    assert.equal(r.textOf('plan-strip-prepared'), 'Prepared 12 Oct, 14:05 UTC · rules only, no AI cost');
    assert.equal(r.textOf('plan-strip-counts'), '4 proposed · 1 accepted · 1 dismissed');
    assert.match(r.textOf('plan-section-solution-design'), /^Solution design · 2 proposedAccept all in Solution design/);
    const card = r.textOf(`plan-item-${FEAT}`);
    assert.match(card, /^Feature○ ProposedOne-day setup wizardA guided setup\./);
    assert.match(card, /Recorded · Problem discovery · Setup takes weeks.*Typed · Hypothesis/);
    assert.match(card, /Lands in Solution design › Features/);
    assert.match(r.textOf(`plan-item-${MUST}`), /Document · Demand · 3 confirmed signals/);
    assert.equal(r.textOf(`plan-done-${DONE}`), '✓Live ETA panelAccepted 12 Oct · Solution design › FeaturesOpen');
    assert.equal(r.props(`plan-done-open-${DONE}`).href, '/build/solution-design?project_id=3');
    assert.match(r.textOf(`plan-done-${GONE}`), /Driver mobile appDismissed 12 Oct · it will not be proposed again$/);
    assert.ok(!r.has(`plan-done-open-${GONE}`), 'a dismissed item opens nothing');
    assert.match(r.textOf(`plan-item-${OLD}`), /↺ Withdrawn.*A newer decision replaced this plan\./);
    assert.ok(!r.has(`plan-item-accept-${OLD}`), 'a withdrawn item cannot be accepted');
    assert.match(r.textOf('plan-brief'), /ForSmall ops teams.*ProblemSetup takes weeks.*PromiseSet up in a day.*ReplacesSpreadsheets/);
    assert.equal(r.props(`plan-item-connect-${DOOR}`).href, '/build/connect?tool=github&project_id=3', 'a door connects; nothing connects for you');
    assert.ok(!r.has(`plan-item-edit-${DOOR}`), 'a door has nothing to edit');
    assert.match(r.textOf('plan-section-none-product-roadmap'), /proposes nothing here yet/, 'a module the read answered with none says so, after a real read');
    assert.match(r.textOf('plan-founding-team'), /Founding team takes no proposals/);
    assert.ok(r.has('plan-wording'), 'VB5\'s press is on the plan');
    assert.ok(!r.has('plan-wording-items'), 'the wording is in the cards, not listed a second time');
    // Accept lands it: one press, then the plan is read again.
    const before = r.requests.length;
    await r.click(`plan-item-accept-${FEAT}`);
    const acc = writes(r).find((q) => q.url.includes(`/items/${FEAT}/accept`));
    assert.deepEqual(acc.body, {}, 'Accept sends no edit');
    assert.ok(r.requests.slice(before).some((q) => q.method === 'GET' && /\/cycles\/build\/plan\?/.test(q.url)), 'the plan is read again');
  } finally { await r.close(); }
});

test('VB3: a write the module refused is said in its card, with Try again; nothing is claimed done', async () => {
  const r = await mounted({ handle: handler({ [`/items/${FEAT}/accept`]: { method: 'POST', answer: () => response({ error: 'writer_refused', code: 'writer_refused', message: 'Build could not save this item. Nothing was saved; try again.', detail: 'Build could not save this item. Nothing was saved; try again.' }, 502) } }) });
  try {
    await r.click(`plan-item-accept-${FEAT}`);
    assert.equal(r.textOf(`plan-item-error-${FEAT}`), 'Solution design could not save this: Build could not save this item. Nothing was saved; try again.Try again');
    assert.equal(r.textOf(`plan-item-status-${FEAT}`), '○ Proposed', 'still proposed');
  } finally { await r.close(); }
});

test('VB4: Edit and accept in the module\'s own fields, the evidence kept, only what changed sent; a refusal stays in the dialog', async () => {
  let refuse = true;
  const r = await mounted({ handle: handler({ [`/items/${FEAT}/accept`]: { method: 'POST', answer: () => (refuse
    ? response({ error: 'invalid_edit', code: 'invalid_edit', message: 'title is not a value this item takes.' }, 400)
    : response({ uid: FEAT, status: 'edited' })) } }) });
  try {
    await r.click(`plan-item-edit-${FEAT}`);
    assert.equal(r.props('plan-edit').role, 'dialog', 'D1317: Edit and accept is the shared Sheet');
    assert.ok(r.props('plan-edit')['aria-labelledby']);
    assert.equal(r.props('plan-edit')['data-width'], 640, 'its 620px snaps to the owner’s 640');
    assert.match(r.textOf('plan-edit'), /Feature · One-day setup wizard.*The evidence stays with the item\. It cannot be removed here\..*Recorded · Problem discovery/s);
    for (const id of ['plan-edit-title', 'plan-edit-description', 'plan-edit-added_value-High', 'plan-edit-effort-XL']) assert.ok(r.has(id), id);
    await r.type('plan-edit-title', 'Setup wizard');
    await r.click('plan-edit-added_value-Medium');
    await r.click('plan-edit-accept');
    assert.equal(r.textOf('plan-edit-refused'), 'title is not a value this item takes.');
    assert.ok(r.has('plan-edit'), 'the dialog stays open on a refusal');
    refuse = false;
    await r.click('plan-edit-accept');
    const sent = writes(r).filter((q) => q.url.includes(`/items/${FEAT}/accept`)).at(-1);
    assert.deepEqual(sent.body, { payload: { title: 'Setup wizard', added_value: 'Medium' } });
    assert.ok(!r.has('plan-edit'), 'closed once accepted');
  } finally { await r.close(); }
});

test('Dismiss and Accept all each open an in-page dialog first; Accept all reports every outcome', async () => {
  const r = await mounted({ handle: handler({ '/modules/solution-design/accept': { method: 'POST', answer: () => response({ module: 'solution-design', accepted: 1, results: [{ uid: FEAT, ok: true }, { uid: RISK, ok: false, code: 'decided', message: 'This item is already decided.' }], more: false }) } }) });
  try {
    await r.click(`plan-item-dismiss-${RISK}`);
    assert.match(r.textOf('plan-dismiss'), /It will not be proposed again\. Nothing is written to Build\./);
    assert.equal(writes(r).length, 0, 'nothing is dismissed before the dialog says so');
    await r.click('plan-dismiss-confirm');
    assert.ok(writes(r).some((q) => q.url.includes(`/items/${RISK}/dismiss`)));
    await r.click('plan-accept-all-solution-design');
    assert.match(r.textOf('plan-accept-all'), /This accepts the 2 proposals waiting in Solution design/);
    await r.click('plan-accept-all-confirm');
    assert.ok(writes(r).some((q) => /\/modules\/solution-design\/accept\?project=3&scope=venture/.test(q.url)));
    assert.equal(r.textOf('plan-section-said-solution-design'), '1 accepted. 1 could not be: This item is already decided.');
  } finally { await r.close(); }
});

test('VB5 in the cards: Eadwyn\'s wording in lavender beside the rule\'s title; Keep is the item\'s Save, the brief\'s goes to the wording row', async () => {
  const wording = { uid: W, removed: 0, items: { [FEAT]: { title: 'Set up your routes in one sitting' } }, brief: { summary: 'Setup in a day for small ops teams' }, lovable_prompt: null, kept: { brief: null, prompt: null } };
  const r = await mounted({ handle: handler({ '/cycles/build/plan/word?': { method: 'GET', answer: () => response({ wording }) } }) });
  try {
    assert.match(r.textOf(`plan-item-${FEAT}`), /Set up your routes in one sittingEadwyn’s wording · not savedRule’s title: One-day setup wizard/);
    assert.ok(!r.has(`plan-item-wording-${RISK}`), 'only what was worded');
    assert.match(r.textOf('plan-brief-wording'), /Setup in a day for small ops teams/);
    await r.click(`plan-item-keep-${FEAT}`);
    assert.deepEqual(writes(r).at(-1), { url: writes(r).at(-1).url, method: 'PATCH', body: { wording: W } });
    assert.ok(writes(r).at(-1).url.endsWith(`/cycles/build/plan/items/${FEAT}`));
    await r.click('plan-brief-keep');
    const kept = writes(r).at(-1);
    assert.ok(kept.url.includes(`/word/${W}/keep?project=3&scope=venture`)); assert.deepEqual(kept.body, { target: 'brief' });
  } finally { await r.close(); }
});

test('VB13: new evidence since the plan, Update the plan through a dialog; a legacy plan counts nothing; a failed since read is its own block', async () => {
  let since = { plan: 'plan-uid', status: 'open', changed: true, new: 4, contradicting: 1 };
  const r = await mounted({ handle: handler({ '/plan/since?': { answer: () => (since ? response(since) : response({ code: 'unreadable', detail: 'down' }, 503)) } }) });
  try {
    assert.equal(r.textOf('plan-since'), '4 new pieces of evidence since this plan, 1 contradicting.No accepted item is changed by itself. Open it to decide.Update the plan');
    await r.click('plan-since-update');
    assert.match(r.textOf('plan-prepare-dialog'), /No accepted item is changed\./);
    await r.click('plan-prepare-dialog-confirm');
    assert.ok(writes(r).some((q) => q.method === 'POST' && /\/cycles\/build\/plan\?project=3&scope=venture$/.test(q.url)), 'Update is D1065\'s own preparation');
  } finally { await r.close(); }
  since = { plan: 'plan-uid', status: 'open', changed: true, new: null, contradicting: null };
  const legacy = await mounted({ handle: handler({ '/plan/since?': { answer: () => response(since) } }) });
  try { assert.match(legacy.textOf('plan-since'), /How many pieces are new was not recorded for this plan/); } finally { await legacy.close(); }
  since = null;
  const down = await mounted({ handle: handler({ '/plan/since?': { answer: () => response({ code: 'unreadable', detail: 'down' }, 503) } }) });
  try {
    assert.match(down.all(), /New evidence since the plan could not be read\. This is not a claim that there is none\./);
    assert.ok(down.has(`plan-item-${FEAT}`), 'the plan still draws');
  } finally { await down.close(); }
});

test('VB14 and VB17: withheld plans anyway through a dialog; nothing accepted reads empty; Stop pauses and keeps accepted items; the founder\'s pause resumes', async () => {
  const withheld = { id: 9, decision: 'proceed', state: 'withheld', decided_at: '2026-10-12', evidence_count: 2, bar: 5 };
  const r = await mounted({ handle: handler({
    '/cycles/build/plan?project=3&scope=venture': { method: 'GET', answer: () => response({ plan: null, modules: {}, brief: null, verdict: withheld }) },
    '/cycles/build/plan?': { method: 'POST', answer: () => response({ code: 'no_evidence', detail: 'Accept findings in Validate before preparing a plan.' }, 409) },
  }) });
  try {
    assert.equal(r.textOf('plan-verdict-withheld'), '! Your verdict is withheld: 2 of 5 pieces of evidence. You can still plan, but Raise will show the plan as resting on withheld evidence.Plan anyway');
    assert.ok(!r.has('plan-strip-verdict'), 'a withheld verdict is never "From your Verdict"');
    await r.click('plan-anyway');
    await r.click('plan-prepare-dialog-confirm');
    assert.match(r.textOf('plan-empty'), /Nothing to plan from yet\..*The plan reads only what you accepted in Validate\. Accept findings from your interviews first\..*Record a session.*Open Validate/s);
  } finally { await r.close(); }
  const stop = await mounted({ handle: handler({ '/cycles/build/plan?project=3&scope=venture': { method: 'GET', answer: () => response(PLAN({ plan: { status: 'paused' }, verdict: { id: 10, decision: 'stop', state: 'given', decided_at: '2026-10-20', evidence_count: 5, bar: 5 } })) } }) });
  try {
    assert.equal(stop.textOf('plan-verdict-stop'), '‖ Your verdict is Stop. The plan is paused. Accepted items stay.Record a new decision to resume.');
    assert.deepEqual(stop.ids('plan-item-accept-'), [], 'a paused plan accepts nothing');
    assert.ok(!stop.has('plan-tools') && !stop.has('plan-resume') && !stop.has('plan-wording'), 'no Update, Pause, Resume or wording under a Stop');
    assert.ok(stop.has(`plan-done-${DONE}`), 'accepted items stay');
  } finally { await stop.close(); }
  const paused = await mounted({ handle: handler({ '/cycles/build/plan?project=3&scope=venture': { method: 'GET', answer: () => response(PLAN({ plan: { status: 'paused' } })) } }) });
  try {
    assert.match(paused.textOf('plan-paused'), /You paused the plan\. Accepted items stay\./);
    await paused.click('plan-resume');
    await paused.click('plan-resume-dialog-confirm');
    assert.ok(writes(paused).some((q) => /\/plan\/resume\?project=3&scope=venture/.test(q.url)));
  } finally { await paused.close(); }
});

test('Pause the plan opens a dialog that says what it changes, then pauses', async () => {
  const r = await mounted();
  try {
    await r.click('plan-pause');
    assert.match(r.textOf('plan-pause-dialog'), /Nothing is prepared or accepted while the plan is paused\. Accepted items stay as they are\./);
    assert.equal(writes(r).length, 0);
    await r.click('plan-pause-dialog-confirm');
    assert.ok(writes(r).some((q) => /\/plan\/pause\?project=3&scope=venture/.test(q.url)));
  } finally { await r.close(); }
});

test('VB16: an admin reads the plan, with no Accept, Edit, Dismiss, Accept all, wording or tools, and asks for no wording', async () => {
  const r = await mounted({ props: { role: 'admin' } });
  try {
    assert.equal(r.textOf('plan-read-only-pill'), '◉ Read only');
    assert.match(r.textOf('plan-read-only'), /Founders accept their plan\. You can read it\..*If the owner allows admins to accept, Accept appears here\./);
    for (const p of ['plan-item-accept-', 'plan-item-edit-', 'plan-item-dismiss-', 'plan-accept-all-', 'plan-done-open-']) assert.deepEqual(r.ids(p), [], p);
    assert.ok(!r.has('plan-wording') && !r.has('plan-tools') && !r.has('plan-strip-verdict'));
    assert.ok(!r.requests.some((q) => q.url.includes('/plan/word')), 'the wording is a founder\'s (D1071): never asked for');
    assert.ok(r.has(`plan-item-${FEAT}`), 'the plan is read');
  } finally { await r.close(); }
});

test('VB18, VB19 and VB20: loading at once, a failed read said, a plan that is not yours, and a Lab venture', async () => {
  const pending = await mounted({ handle: handler({ '/cycles/build/plan?project=3': { method: 'GET', answer: () => new Promise(() => {}) } }) });
  try {
    assert.ok(pending.has('build-plan-plan-page') && pending.has('plan-tabs'), 'header and tabs at once');
    assert.equal(pending.textOf('plan-strip-reading'), 'Reading…');
    assert.ok(pending.has('plan-board-loading'));
    assert.ok(!pending.has('plan-strip-counts'), 'no count before it is read');
  } finally { await pending.close(); }
  const down = await mounted({ handle: handler({ '/cycles/build/plan?project=3': { method: 'GET', answer: () => response({ code: 'unreadable', detail: 'down' }, 503) } }) });
  try {
    assert.match(down.all(), /The plan could not be read\. This is not a claim that there is nothing to build\./);
    assert.ok(!down.has('plan-strip-counts') && !down.has('plan-empty'), 'a failed read is never an empty plan');
  } finally { await down.close(); }
  const theirs = await mounted({ handle: handler({ '/cycles/build/plan?project=3': { method: 'GET', answer: () => response({ code: 'not_this_project', detail: 'This plan belongs to the venture’s founders.' }, 404) } }) });
  try { assert.match(theirs.textOf('plan-not-yours'), /This plan belongs to the venture’s founders\..*Go to your home/s); } finally { await theirs.close(); }
  const lab = await mounted({ props: { lab: true } });
  try { assert.equal(lab.textOf('plan-strip-lab'), '◆ Spin-Out Lab venture'); } finally { await lab.close(); }
});

test('VB21: on a phone the modules are accordions, the first open, and every button is 44px', async () => {
  const r = await mounted({ props: { phone: true } });
  try {
    assert.equal(r.props('plan-section-toggle-solution-design')['aria-expanded'], true);
    assert.equal(r.props('plan-section-toggle-prototype-mvp')['aria-expanded'], false);
    assert.ok(!r.has(`plan-item-${MUST}`), 'a closed module draws no card');
    await r.click('plan-section-toggle-prototype-mvp');
    assert.ok(r.has(`plan-item-${MUST}`));
    for (const id of [`plan-item-accept-${FEAT}`, `plan-item-edit-${FEAT}`, `plan-item-dismiss-${FEAT}`, 'plan-accept-all-solution-design']) assert.match(r.props(id).className, /min-h-\[44px\]/, id);
  } finally { await r.close(); }
});

test('VB2a: the Verdict record says Plan the build with the plan\'s own count, and draws the link once', async () => {
  const seen = [];
  const record = { title: 'Proceed · the venture', actions: [{ key: 'record-new-decision', kind: 'link', href: '/validate/verdict/new' }, { key: 'plan-build', label: 'Plan the build', kind: 'link', href: '/build/plan?project_id=3' }] };
  const r = await mounted({ el: h(VerdictRecordWithPlan, { read: record, render: (rec) => { seen.push(rec.actions.map((a) => a.key)); return h('p', null, rec.title); } }) });
  try {
    assert.equal(r.textOf('verdict-plan-build'), 'Plan the build from this evidence. 4 proposals are ready.Plan the build');
    assert.equal(r.props('verdict-plan-build-open').href, '/build/plan?project_id=3');
    assert.deepEqual(seen.at(-1), ['record-new-decision'], 'the record draws the link once, as the panel');
  } finally { await r.close(); }
  const failed = await mounted({ handle: handler({ '/cycles/build/plan?': { method: 'GET', answer: () => response({ code: 'unreadable' }, 503) } }),
    el: h(VerdictRecordWithPlan, { read: record, render: () => null }) });
  try { assert.equal(failed.textOf('verdict-plan-build'), 'Plan the build from this evidence.Plan the build', 'no count is guessed when the read fails'); } finally { await failed.close(); }
  const none = await mounted({ el: h(VerdictRecordWithPlan, { read: { actions: [{ key: 'record-new-decision' }] }, render: () => h('p', null, 'record') }) });
  try { assert.ok(!none.has('verdict-plan-build'), 'no Proceed, no panel'); } finally { await none.close(); }
});

test('wiring: CycleRoute hands the plan the viewer\'s role and Lab flag and draws the Verdict record with its panel; no browser pop-up', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  const at = route.indexOf('<BuildPlan tab={buildPlan}');
  assert.ok(at > 0);
  assert.ok(route.slice(at, route.indexOf('/>', at)).includes("role={user?.role ?? null} lab={user?.spinout_lab_active === 1 && user?.role !== 'admin'}"));
  assert.match(route, /verdict: \(read, ctx\) => <VerdictRecordWithPlan read=\{read\}/);
  const client = read('frontend/src/lib/api/buildPlan.js');
  for (const m of ['pause:', 'resume:', 'since:']) assert.ok(client.includes(m), m);
  for (const f of ['frontend/src/pages/cycles/BuildPlan.jsx', 'frontend/src/pages/cycles/BuildPlanCards.jsx']) assert.doesNotMatch(read(f), /window\.(alert|confirm)|\balert\(|\bconfirm\(/, f);
  assert.doesNotMatch(read('frontend/src/pages/cycles/BuildPlanCards.jsx'), /credits/i, 'AI tokens, never credits');
});
