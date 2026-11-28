/**
 * D5929 (#5929) — New licence as a stepped issuance (Licences v2 board L21), mounted on a fake Worker.
 *
 *   - the frame names the six steps of the canvas and marks the current one with aria-current="step";
 *   - the territory step shows a conflict with a held or suspended territory at once, naming the holder, with the
 *     rule (a suspended licence still holds its countries; overlap is refused), and Continue stays off;
 *   - the Worker's refusal of an overlap is shown in its own words, and every chosen country stays chosen;
 *   - steps 1 and 3 to 6 are #5931's cards in the frame's card slot, and their values survive a visit to step 2;
 *   - leaving with a draft or anything typed asks first, in a dialog.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_issue_flow_d5929.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import IssueLicenceFlow from '../src/pages/admin/licences/IssueLicenceFlow.jsx';
import {
  NEW_LICENCE_STEPS, canOpenStep, conflictSentence, conflictTitle, leavePlan, readCountryCode, stepMarks, territoryConflicts,
  territoryPlan, territoryRefusal,
} from '../src/pages/admin/licences/issueLicenceFlowModel.js';

const h = React.createElement;

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const DRAFT = {
  uid: 'lic_1', licence_ref: 'WL-ZZ-001', legal_entity_name: 'Example Holdings SA', brand_name: 'Example', kind: 'subsidiary',
  status: 'draft', territories: [], seats: {}, annual_fee_cents: null, currency: 'EUR', revenue_share_bps: null,
  token_split_bps: null, term_years: null, starts_on: null, renews_on: null, terms_revision: 0, revision: 1,
};

/** Who holds what: AT by a suspended licence, DE by an active one, and this draft's own FR. */
const HELD = [
  { country_code: 'AT', licence_uid: 'lic_9', licence_ref: 'AXL-009', brand_name: 'Sample Studio East', status: 'suspended' },
  { country_code: 'DE', licence_uid: 'lic_8', licence_ref: 'AXL-008', brand_name: 'Sample Studio North', status: 'active' },
  { country_code: 'FR', licence_uid: 'lic_1', licence_ref: 'WL-ZZ-001', brand_name: 'Example', status: 'draft' },
];

/** The Worker, as far as the flow reads and writes it. `on[key]` overrides one answer: `(body, url) => response`. */
function worker(on = {}) {
  const calls = [];
  let draft = { ...DRAFT };
  const handle = (url, options = {}) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path: p, body });
    const key = `${method} ${p.replace(/lic_1/, ':uid')}`;
    if (on[key]) return on[key](body, u);
    if (key === 'GET /admin/licences/territories') return response({ items: HELD });
    if (key === 'POST /admin/licences') { draft = { ...draft, licence_ref: body.licence_ref, legal_entity_name: body.legal_entity_name }; return response({ uid: 'lic_1', licence_ref: body.licence_ref, status: 'draft', kind: body.kind }, 201); }
    if (key === 'GET /admin/licences/:uid') return response(draft);
    if (key === 'PUT /admin/licences/:uid/territories') { draft = { ...draft, territories: body.countries }; return response({ ok: true, countries: body.countries, pushed: null }); }
    return response({ ok: true });
  };
  return { calls, handle };
}

async function mount(w) {
  const restore = installDocument('', { focus: true });
  const previous = globalThis.fetch;
  const prevMatch = globalThis.matchMedia;
  globalThis.fetch = async (u, options = {}) => w.handle(String(u), options);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const left = [];
  await act(async () => root.render(h(IssueLicenceFlow, { onLeave: (l) => left.push(l) })));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    left, flush, nodes, byId, props,
    text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    attr: (id, a) => props(byId(id))[a],
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to type in`); await act(async () => { p.onChange({ target: { value } }); }); await flush(); },
    async submit(id) { const form = byId(id).parentNode?.parentNode; const p = props(form); assert.ok(p.onSubmit, 'no form'); await act(async () => { p.onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; globalThis.matchMedia = prevMatch; restore(); },
  };
}

/** Mount and create the draft through step 1, which lands on step 2. */
async function atTerritory(w) {
  const v = await mount(w);
  await v.type('nl-licence_ref', 'wl-zz-001');
  await v.type('nl-legal_entity_name', 'Example Holdings SA');
  await v.click('nl-primary');
  return v;
}

const listState = (v) => NEW_LICENCE_STEPS.map((_, i) => v.attr(`nl-steplist-${i + 1}`, 'data-state'));
const currentSteps = (v) => NEW_LICENCE_STEPS.map((_, i) => v.attr(`nl-steplist-${i + 1}`, 'aria-current')).filter(Boolean);

// ── the model ────────────────────────────────────────────────────────────────

test('the six steps: one current, done only once left forwards, and no step past the draft or the furthest reached', () => {
  assert.deepEqual(NEW_LICENCE_STEPS, ['Legal entity', 'Territory', 'Commercial terms', 'Administrators', 'Agreement', 'Issue']);
  assert.deepEqual(stepMarks(1, [0]).map((s) => s.state), ['done', 'current', 'todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(stepMarks(0, [0, 1]).map((s) => s.state), ['current', 'done', 'todo', 'todo', 'todo', 'todo']);
  assert.equal(canOpenStep(0, {}), true);
  assert.equal(canOpenStep(1, { licence: null, reached: 3 }), false, 'nothing past step 1 without the draft');
  assert.equal(canOpenStep(3, { licence: DRAFT, reached: 3 }), true);
  assert.equal(canOpenStep(4, { licence: DRAFT, reached: 3 }), false, 'not past the furthest step reached');
});

test('a conflict names its holder and says the rule; your own country and a free one are not conflicts', () => {
  const c = territoryConflicts(['AT', 'DE', 'FR', 'IT'], HELD, 'lic_1');
  assert.deepEqual(c.map((x) => x.code), ['AT', 'DE']);
  assert.equal(conflictTitle(c[0]), 'Austria is already held');
  assert.equal(conflictSentence(c[0]), 'Sample Studio East (suspended) holds Austria (suspended licences still hold their countries). Overlapping territories are refused; remove Austria or terminate the other licence first.');
  assert.equal(conflictSentence(c[1]), 'Sample Studio North holds Germany (suspended licences still hold their countries). Overlapping territories are refused; remove Germany or terminate the other licence first.');
  assert.deepEqual(territoryPlan(['AT', 'IT'], c.slice(0, 1)), { ok: false, why: 'Remove Austria to continue.' });
  assert.deepEqual(territoryPlan([], []), { ok: false, why: 'Choose at least one country. Issuing needs one.' });
  assert.deepEqual(territoryPlan(['IT'], []), { ok: true, countries: ['IT'] });
  assert.deepEqual(readCountryCode(' ch '), { ok: true, code: 'CH' });
  assert.equal(readCountryCode('CHE').ok, false);
  assert.equal(readCountryCode('').ok, false);
});

test('the Worker’s refusal is read in its own words; no answer is unknown, never refused', () => {
  const e = Object.assign(new Error('AT is held by AXL-009 (suspended)'), { status: 409, code: 'territory_conflict', data: { conflicts: [{ country_code: 'AT' }] } });
  assert.deepEqual(territoryRefusal(e), { kind: 'conflict', message: 'AT is held by AXL-009 (suspended)', conflicts: [{ country_code: 'AT' }] });
  assert.equal(territoryRefusal(Object.assign(new Error('a terminated licence cannot be given territory'), { status: 409 })).message, 'a terminated licence cannot be given territory');
  assert.equal(territoryRefusal(Object.assign(new Error('a terminated licence cannot be given territory'), { status: 409 })).kind, 'refused');
  assert.equal(territoryRefusal(new Error('Failed to fetch')).kind, 'unknown');
});

test('leaving asks with a draft or typed values, and says what stays', () => {
  assert.deepEqual(leavePlan({ licence: null, dirty: false }), { ask: false });
  assert.equal(leavePlan({ licence: null, dirty: true }).ask, true);
  const draft = leavePlan({ licence: DRAFT, dirty: false });
  assert.equal(draft.ask, true);
  assert.equal(draft.body, 'The draft WL-ZZ-001 stays in the ledger as Draft, with everything saved so far. You can finish it from its licence page. Values typed on this step and not yet saved are discarded.');
  assert.deepEqual(leavePlan({ licence: { ...DRAFT, status: 'active' }, dirty: true }), { ask: false }, 'an issued licence is not a draft to lose');
});

// ── the frame ────────────────────────────────────────────────────────────────

test('New licence opens on step 1 of the six, marked aria-current, with nothing saved yet', async () => {
  const v = await mount(worker());
  try {
    assert.match(v.text(), /Issue a licence/);
    assert.equal(v.textOf('nl-step-line'), 'Step 1 of 6 · Legal entity');
    assert.equal(v.textOf('nl-steplist'), '1Legal entityCurrent2Territory3Commercial terms4Administrators5Agreement6Issue');
    assert.deepEqual(currentSteps(v), ['step']);
    assert.equal(v.attr('nl-steplist-1', 'aria-current'), 'step');
    assert.equal(v.textOf('nl-saved'), 'Nothing is saved until you create the draft');
    assert.ok(v.has('nl-step-1'), 'step 1 is #5931’s card');
    assert.equal(v.has('nl-goto-2'), false, 'Territory cannot be opened before the draft exists');
    assert.match(v.textOf('nl-kind-hosts'), /Members land on a platform host at activation/);
  } finally { await v.close(); }
});

test('creating the draft moves to Territory: step 1 is done, step 2 is current, the draft is named', async () => {
  const w = worker();
  const v = await atTerritory(w);
  try {
    assert.equal(v.textOf('nl-step-line'), 'Step 2 of 6 · Territory');
    assert.deepEqual(listState(v), ['done', 'current', 'todo', 'todo', 'todo', 'todo']);
    assert.equal(v.attr('nl-steplist-2', 'aria-current'), 'step');
    assert.deepEqual(currentSteps(v), ['step']);
    assert.match(v.textOf('nl-step-2'), /Which countries does Example Holdings SA hold\?/);
    assert.equal(v.textOf('nl-saved'), 'WL-ZZ-001 · Example Holdings SA');
    assert.match(v.textOf('nl-status'), /Draft/);
    assert.equal(v.attr('nl-territory-continue', 'aria-disabled'), 'true', 'no country chosen yet');
    assert.equal(v.textOf('nl-territory-note'), 'Choose at least one country. Issuing needs one.');
  } finally { await v.close(); }
});

test('a country a suspended licence holds is a conflict at once, with its holder and the rule; Continue stays off', async () => {
  const w = worker();
  const v = await atTerritory(w);
  try {
    assert.equal(v.attr('nl-country-AT', 'data-held'), 'suspended', 'the chip says the country is held');
    assert.equal(v.has('nl-conflict-AT'), false);
    await v.click('nl-country-AT');
    assert.equal(v.attr('nl-country-AT', 'aria-checked'), true);
    assert.equal(v.attr('nl-conflict-AT', 'role'), 'alert');
    assert.equal(v.textOf('nl-conflict-AT'), '!Austria is already heldSample Studio East (suspended) holds Austria (suspended licences still hold their countries). Overlapping territories are refused; remove Austria or terminate the other licence first.Remove Austria');
    assert.equal(v.attr('nl-territory-continue', 'aria-disabled'), 'true');
    assert.equal(v.textOf('nl-territory-note'), 'Remove Austria to continue.');
    await v.click('nl-territory-continue');
    assert.equal(w.calls.filter((c) => c.method === 'PUT').length, 0, 'an overlap is not sent');
    await v.click('nl-conflict-remove-AT');
    assert.equal(v.has('nl-conflict-AT'), false);
    assert.equal(v.attr('nl-country-AT', 'aria-checked'), false);
  } finally { await v.close(); }
});

test('the Worker’s refusal of an overlap is shown in its words, every chosen country stays, and the holders are read again', async () => {
  const w = worker({
    'GET /admin/licences/territories': () => response({ items: [] }),
    'PUT /admin/licences/:uid/territories': () => response({ error: 'territory_conflict', conflicts: [{ country_code: 'IT', licence_ref: 'AXL-007', status: 'active' }], message: 'IT is held by AXL-007 (active)' }, 409),
  });
  const v = await atTerritory(w);
  try {
    await v.click('nl-country-IT');
    await v.click('nl-country-PT');
    assert.equal(v.attr('nl-territory-continue', 'aria-disabled'), undefined);
    await v.click('nl-territory-continue');
    assert.equal(v.textOf('nl-territory-refused'), '!Not saved. IT is held by AXL-007 (active) Every country you chose is still chosen.');
    assert.equal(v.attr('nl-territory-refused', 'role'), 'alert');
    assert.equal(v.attr('nl-country-IT', 'aria-checked'), true);
    assert.equal(v.attr('nl-country-PT', 'aria-checked'), true);
    assert.equal(v.textOf('nl-step-line'), 'Step 2 of 6 · Territory', 'still on the step');
    assert.equal(w.calls.filter((c) => c.path === '/admin/licences/territories').length, 2, 'who holds what is read again');
  } finally { await v.close(); }
});

test('Continue saves the countries to the draft and opens step 3; Back returns with the countries kept', async () => {
  const w = worker();
  const v = await atTerritory(w);
  try {
    await v.click('nl-country-IT');
    await v.type('nl-country-other', 'ch');
    await v.submit('nl-country-other');
    assert.equal(v.attr('nl-country-CH', 'aria-checked'), true, 'a country outside the EU, by its code');
    await v.click('nl-territory-continue');
    const put = w.calls.find((c) => c.method === 'PUT');
    assert.deepEqual(put, { method: 'PUT', path: '/admin/licences/lic_1/territories', body: { countries: ['IT', 'CH'] } });
    assert.equal(v.textOf('nl-step-line'), 'Step 3 of 6 · Commercial terms');
    assert.ok(v.has('nl-step-3'), 'step 3 is #5931’s card');
    assert.deepEqual(listState(v), ['done', 'done', 'current', 'todo', 'todo', 'todo']);
    await v.click('nl-back');
    assert.equal(v.textOf('nl-step-line'), 'Step 2 of 6 · Territory');
    assert.equal(v.attr('nl-country-IT', 'aria-checked'), true);
    assert.equal(v.attr('nl-country-CH', 'aria-checked'), true);
    // The list opens a step already reached.
    await v.click('nl-goto-3');
    assert.equal(v.textOf('nl-step-line'), 'Step 3 of 6 · Commercial terms');
  } finally { await v.close(); }
});

test('a holder read that fails says so, with Try again, and does not claim the countries are free', async () => {
  let fail = true;
  const w = worker({ 'GET /admin/licences/territories': () => (fail ? response({ error: 'down' }, 500) : response({ items: HELD })) });
  const v = await atTerritory(w);
  try {
    assert.match(v.textOf('nl-holders-unreadable'), /Who holds which country could not be read\. A conflict cannot be shown before you continue\. The platform still refuses an overlap when you save\./);
    assert.equal(v.attr('nl-country-AT', 'data-held'), undefined);
    fail = false;
    await v.click('nl-holders-retry');
    assert.equal(v.has('nl-holders-unreadable'), false);
    assert.equal(v.attr('nl-country-AT', 'data-held'), 'suspended');
  } finally { await v.close(); }
});

test('leaving with nothing entered closes at once; with a value typed, or a draft, a dialog asks first', async () => {
  const quiet = await mount(worker());
  try {
    await quiet.click('nl-leave');
    assert.deepEqual(quiet.left, [null]);
    assert.equal(quiet.has('nl-leave-dialog'), false);
  } finally { await quiet.close(); }

  const typed = await mount(worker());
  try {
    await act(async () => { typed.props(typed.byId('licence-issue-flow')).onInput(); });
    await typed.click('nl-leave');
    assert.deepEqual(typed.left, [], 'nothing closed yet');
    assert.equal(typed.attr('nl-leave-dialog', 'role'), 'dialog');
    assert.match(typed.textOf('nl-leave-dialog'), /Leave New licence\?/);
    assert.equal(typed.textOf('nl-leave-body'), 'Nothing has been saved yet: no draft exists until step 1 creates it. The values you typed are discarded.');
    await typed.click('nl-leave-stay');
    assert.equal(typed.has('nl-leave-dialog'), false);
    assert.deepEqual(typed.left, []);
  } finally { await typed.close(); }

  const v = await atTerritory(worker());
  try {
    await v.click('nl-leave');
    assert.match(v.textOf('nl-leave-body'), /^The draft WL-ZZ-001 stays in the ledger as Draft/);
    await v.click('nl-leave-confirm');
    assert.equal(v.left.length, 1);
    assert.equal(v.left[0].uid, 'lic_1', 'the page is told a draft exists, so it reads the ledger again');
  } finally { await v.close(); }
});
