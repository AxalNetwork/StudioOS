/**
 * D4819 part 5 (#5931) — New licence steps 1 and 3 to 6 (Licences v2 boards L41 to L47), mounted on a fake Worker.
 *
 *   - each step draws its board's card: title, fields, primary action and footer line;
 *   - a field error sits on its field and is tied to it with aria-describedby, in the Worker's words where the
 *     Worker refused;
 *   - step 3 is two writes, and a failed second write says "Seats were saved. The money terms were not.";
 *   - the Issue step lists every value, Not recorded / None / Unreadable apart, asks the consequence sheet's four
 *     questions, and a refusal on Issue keeps every value entered on the earlier steps;
 *   - no Worker route is added: every call is one api.js already makes.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/new_licence_steps_d5931.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { NewLicenceStep } from '../src/pages/admin/licences/NewLicenceSteps.jsx';
import {
  blockerStep, issueConsequence, percentToBps, placeRefusal, planCreate, planEntity, planTerms, proposeRenewal, reviewGroups,
  stepLine, unfilledWhere,
} from '../src/pages/admin/licences/newLicenceModel.js';
import { CONSEQUENCE_QUESTIONS } from '../src/pages/admin/licenceConsequenceModel.js';
import { SEAT_TYPES } from '../src/pages/admin/licences/licenceShared.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const DRAFT = {
  uid: 'lic_1', licence_ref: 'WL-CH-001', legal_entity_name: 'Helvetic Ventures SA', brand_name: 'Helvetic Ventures', kind: 'white_label',
  status: 'draft', registered_address: null, signatory_name: 'A. Keller', signatory_title: null, territories: ['CH'],
  seats: { founder: 12, investor: 6, advisor: 4, partner: 2 }, annual_fee_cents: 12000000, currency: 'EUR',
  revenue_share_bps: 1250, token_split_bps: null, term_years: 3, starts_on: '2027-01-01', renews_on: '2030-01-01',
  terms_revision: 0, revision: 4, brand_kit: { primary_hex: '#0F766E', accent_hex: '#B45309' }, brand_kit_available: true,
  deployment: null, deployment_available: true,
};

/** The Worker, as far as these steps read and write it. `on[key]` overrides one answer: `(body, url) => response`. */
function worker(on = {}) {
  const calls = [];
  const handle = (url, options = {}) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path: p, body });
    const key = `${method} ${p.replace(/lic_1/, ':uid')}`;
    if (on[key]) return on[key](body, u);
    if (key === 'POST /admin/licences') return response({ uid: 'lic_1', licence_ref: body.licence_ref, status: 'draft', kind: body.kind }, 201);
    if (key === 'GET /admin/licences/:uid') return response(DRAFT);
    if (key === 'GET /admin/licences/:uid/admins') return response({ items: [] });
    if (key === 'GET /admin/licences/:uid/contract') return response({ contracts: [], contracts_available: true, templates: [] , templates_reason: 'HQ has authored no master templates yet, so there is nothing to instantiate. The library lives on Contracts.' });
    if (key === 'GET /admin/licences/:uid/activation') return response({ blockers: [], can_activate: true, notes: ['A pending signature does not block activation.'] });
    return response({ ok: true });
  };
  return { calls, handle };
}

async function mount(props, w) {
  const restore = installDocument('', { focus: true });
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, options = {}) => w.handle(String(u), options);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const state = { step: props.step, licence: props.licence ?? null };
  function Host() {
    const [step, setStep] = React.useState(props.step);
    const [licence, setLicence] = React.useState(props.licence ?? null);
    state.step = step; state.licence = licence; state.go = setStep;
    return h(NewLicenceStep, { step, licence, onLicence: setLicence, onStep: setStep });
  }
  await act(async () => root.render(h(Host)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  const byDomId = (id) => nodes().find((n) => props_(n).id === id);
  return {
    state, flush, nodes, byId, byDomId, props: props_,
    text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    async click(id) { const p = props_(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const p = props_(byId(id)); assert.ok(p.onChange, `no ${id} to type in`); await act(async () => { p.onChange({ target: { value } }); }); await flush(); },
    value: (id) => props_(byId(id)).value,
    /** The field's error, read through the field's own aria-describedby. */
    describedError(id) {
      const field = props_(byId(id));
      assert.equal(field['aria-invalid'], 'true', `${id} is not marked invalid`);
      const ids = String(field['aria-describedby'] || '').split(' ').filter(Boolean);
      assert.ok(ids.length, `${id} names no description`);
      return ids.map((x) => text(byDomId(x))).join(' ');
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

// ── the model ────────────────────────────────────────────────────────────────

test('the step line and the four questions are the frame’s and the consequence sheet’s', () => {
  assert.equal(stepLine(2), 'Step 3 of 6 · Commercial terms');
  assert.equal(stepLine(5), 'Step 6 of 6 · Issue');
  const q = issueConsequence(DRAFT);
  assert.deepEqual(q.map((x) => x.title), [...CONSEQUENCE_QUESTIONS]);
  assert.equal(q[0].lines[0], 'WL-CH-001 becomes Active for CH; its studio can use 24 seats.');
  assert.ok(q[1].lines.includes('Renewal is tracked from 1 Jan 2030.'));
  assert.ok(q[1].lines.some((l) => /No branch is deployed for this licence yet/.test(l)), 'the branch sentence is the activate sheet’s own');
  assert.match(q[2].lines[0], /No reason is recorded/);
  assert.equal(q[3].reversible, false);
});

test('percent to basis points is exact, and only 0 to 100 is the field’s own check', () => {
  assert.deepEqual(percentToBps('12.5'), { ok: true, value: 1250 });
  assert.deepEqual(percentToBps('0.07'), { ok: true, value: 7 });
  assert.deepEqual(percentToBps('100'), { ok: true, value: 10000 });
  assert.deepEqual(percentToBps(''), { ok: true, value: null });
  assert.deepEqual(percentToBps('112.5'), { ok: false, message: 'Enter a percentage from 0 to 100' });
  assert.deepEqual(percentToBps('12.505'), { ok: true, value: 1250.5 }, 'not whole basis points: sent for the Worker to refuse');
});

test('create sends the address and signatory; a cleared recorded value is refused in the Worker’s words', () => {
  const c = planCreate({ licence_ref: ' wl-ch-001 ', legal_entity_name: 'Helvetic Ventures SA', brand_name: '', kind: 'white_label', registered_address: 'Bahnhofstrasse 1', signatory_name: '', signatory_title: 'Director' });
  assert.deepEqual(c.body, { licence_ref: 'WL-CH-001', legal_entity_name: 'Helvetic Ventures SA', brand_name: '', kind: 'white_label', registered_address: 'Bahnhofstrasse 1', signatory_title: 'Director' });
  assert.deepEqual(planCreate({}).errors, { licence_ref: 'Enter a licence reference', legal_entity_name: 'Enter the legal entity name' });
  const e = planEntity({ ...DRAFT, signatory_name: '', registered_address: 'Bahnhofstrasse 1' }, DRAFT);
  assert.deepEqual(e.errors, { signatory_name: 'signatory_name cannot be blank' });
  assert.deepEqual(e.body, { registered_address: 'Bahnhofstrasse 1' });
});

test('step 3 sends only what changed, in basis points and cents, with the revision it read', () => {
  const form = { seats: { founder: '12', investor: '6', advisor: '4', partner: '2' }, term_years: '3', annual_fee: '120,000', currency: 'EUR', revenue_share_pct: '12.5', token_split_pct: '5', starts_on: '2027-01-01', renews_on: '2030-01-01', reason: 'Terms recorded at issue' };
  const blank = { ...DRAFT, annual_fee_cents: null, revenue_share_bps: null, token_split_bps: null, term_years: null, starts_on: null, renews_on: null, terms_revision: 2 };
  const p = planTerms(form, blank, SEAT_TYPES);
  assert.equal(p.ok, true);
  assert.deepEqual(p.seats, { founder: 12, investor: 6, advisor: 4, partner: 2 });
  assert.deepEqual(p.terms, { term_years: 3, annual_fee_cents: 12000000, revenue_share_bps: 1250, token_split_bps: 500, starts_on: '2027-01-01', renews_on: '2030-01-01', reason: 'Terms recorded at issue', expected_revision: 2 });
  const bad = planTerms({ ...form, seats: { ...form.seats, founder: '-2' }, revenue_share_pct: '112.5', reason: 'At issue' }, blank, SEAT_TYPES);
  assert.deepEqual(bad.errors, { seat_founder: 'founder seats cannot be negative', revenue_share_bps: 'Enter a percentage from 0 to 100', reason: 'A reason of at least 10 characters is required' });
  assert.equal(proposeRenewal('2027-01-01', '3'), '2030-01-01');
  assert.equal(proposeRenewal('2028-02-29', '1'), null);
});

test('refusals land on their fields, and blockers and unfilled fields point at their steps', () => {
  assert.deepEqual(placeRefusal('create', { status: 409, message: 'WL-CH-001 is already in use' }), { field: 'licence_ref', message: 'WL-CH-001 is already in use' });
  assert.deepEqual(placeRefusal('admin', { status: 404, message: 'no account with that address' }), { field: 'email', message: 'No account with that address' });
  assert.deepEqual(placeRefusal('admin', { status: 409, message: 'that account already administers DACH-001' }), { field: 'email', message: 'That account already administers DACH-001' });
  assert.deepEqual(placeRefusal('terms', { status: 400, message: 'x', data: { errors: [{ field: 'renews_on', message: 'must be a real date as YYYY-MM-DD, or null to clear it' }] } }).fields,
    { renews_on: 'renews_on must be a real date as YYYY-MM-DD, or null to clear it' });
  assert.equal(placeRefusal('terms', { status: 403, message: 'TOTP required' }).message, 'Sign in again with your authenticator app to make this change.');
  assert.equal(placeRefusal('entity', { status: 403, message: 'Super admin required' }).message, 'Only HQ Super Admins can issue licences; ask a Super Admin.');
  assert.equal(blockerStep('This is a white-label licence and its brand kit has no colours.'), 0);
  assert.equal(blockerStep('No territory is assigned. A licence with no country grants nothing.'), 1);
  assert.equal(blockerStep('No renewal date is set.'), 2);
  assert.equal(unfilledWhere('licence.signatory_title').text, 'set in step 1');
  assert.equal(unfilledWhere('terms.notice_period').text, 'set on the licence’s Terms page after issuing');
});

test('the review keeps Not recorded, None and Unreadable apart', () => {
  const g = reviewGroups({ ...DRAFT, brand_kit_available: false }, { admins: [], contract: false, seatTypes: SEAT_TYPES });
  const row = (step, label) => g[step].rows.find((r) => r.label === label);
  assert.equal(row(0, 'Registered address').state, 'not_recorded');
  assert.equal(row(0, 'Brand kit').state, 'unreadable');
  assert.equal(row(2, 'Token split to the Licensee').state, 'not_recorded');
  assert.equal(row(2, 'Revenue share').text, '12.5% · 1,250 bp');
  assert.equal(row(2, 'Annual fee').text, 'EUR 120,000 per licence year');
  assert.equal(row(3, 'Appointed').state, 'none');
  assert.equal(row(4, 'Draft contract').state, 'unreadable');
  assert.equal(reviewGroups(DRAFT, { admins: false, seatTypes: SEAT_TYPES })[3].rows[0].state, 'unreadable');
});

// ── the steps, mounted ─────────────────────────────────────────────────────────

test('L41: step 1 creates the draft with the agreement fields and continues; a taken reference is shown on its field', async () => {
  let taken = true;
  const w = worker({ 'POST /admin/licences': (b) => (taken ? response({ error: `${b.licence_ref} is already in use` }, 409) : response({ uid: 'lic_1', licence_ref: b.licence_ref, status: 'draft', kind: b.kind }, 201)) });
  const v = await mount({ step: 0 }, w);
  try {
    assert.match(v.text(), /Who receives this licence\?/);
    assert.equal(v.textOf('nl-primary'), 'Create draft and continue');
    assert.match(v.textOf('nl-consequence'), /as a draft in the ledger\. It grants nothing until it is issued\. Reference and kind cannot be changed afterwards\./);
    await v.click('nl-primary');
    assert.equal(v.describedError('nl-licence_ref'), '✕ Enter a licence reference Unique across every licence family · up to 40 characters, saved in capitals');
    await v.type('nl-licence_ref', 'wl-ch-001');
    await v.type('nl-legal_entity_name', 'Helvetic Ventures SA');
    await v.type('nl-signatory_name', 'A. Keller');
    await v.click('nl-primary');
    assert.match(v.describedError('nl-licence_ref'), /WL-CH-001 is already in use/);
    assert.equal(v.value('nl-legal_entity_name'), 'Helvetic Ventures SA', 'the refusal kept the typed values');
    taken = false;
    await v.click('nl-primary');
    const post = w.calls.filter((c) => c.method === 'POST' && c.path === '/admin/licences').pop();
    assert.equal(post.body.signatory_name, 'A. Keller', 'the signatory goes with the create');
    assert.equal(v.state.step, 1, 'continues to Territory');
    assert.equal(v.state.licence.uid, 'lic_1');
  } finally { await v.close(); }
});

test('L41B: after the draft exists, reference and kind are fixed and a white-label saves its brand kit', async () => {
  const w = worker();
  const v = await mount({ step: 0, licence: { ...DRAFT, brand_kit: null } }, w);
  try {
    assert.equal(v.props(v.byId('nl-licence_ref')).readOnly, true);
    assert.equal(v.props(v.byId('nl-kind-white_label')).disabled, true);
    assert.ok(v.has('nl-brand-kit'));
    assert.match(v.textOf('nl-brand-kit'), /Asks for your authenticator code · saving the brand kit/);
    await v.type('nl-primary_hex', '#0F76');
    await v.click('nl-primary');
    assert.match(v.describedError('nl-primary_hex'), /Both a primary and an accent colour are required, each as a hex value such as #0f766e/);
    await v.type('nl-primary_hex', '#0F766E'); await v.type('nl-accent_hex', '#B45309');
    await v.click('nl-primary');
    assert.deepEqual(w.calls.find((c) => c.method === 'PUT' && c.path === '/admin/licences/lic_1/brand').body, { primary_hex: '#0F766E', accent_hex: '#B45309' });
    assert.equal(v.state.step, 1);
  } finally { await v.close(); }
});

test('L42: step 3 saves seats then money terms; a failed second write says which half landed and keeps every value', async () => {
  const blank = { ...DRAFT, seats: {}, annual_fee_cents: null, revenue_share_bps: null, term_years: null, starts_on: null, renews_on: null };
  const w = worker({
    'GET /admin/licences/:uid': () => response(blank),
    'PATCH /admin/licences/:uid/terms': () => response({ error: 'invalid_terms', message: 'renews_on must be a real date as YYYY-MM-DD, or null to clear it.', errors: [{ field: 'renews_on', message: 'must be a real date as YYYY-MM-DD, or null to clear it' }] }, 400),
  });
  const v = await mount({ step: 2, licence: blank }, w);
  try {
    assert.match(v.text(), /What are the commercial terms\?/);
    assert.equal(v.textOf('nl-primary'), 'Save terms and continue');
    assert.match(v.textOf('nl-totp-note'), /saving the fee, shares, term and dates\. Seats save without one\./);
    assert.equal(v.value('nl-reason'), 'Terms recorded at issue');
    for (const [k, n] of [['founder', '12'], ['investor', '6'], ['advisor', '4'], ['partner', '2']]) await v.type(`nl-seat-${k}`, n);
    assert.match(v.textOf('nl-seats-total'), /24 seats across 4 types/);
    await v.type('nl-annual_fee', '120,000');
    await v.type('nl-revenue_share_bps', '112.5');
    await v.type('nl-term_years', '3');
    await v.type('nl-starts_on', '2027-01-01');
    assert.match(v.textOf('nl-renewal-proposal'), /renew on 1 Jan 2030/);
    await v.click('nl-primary');
    assert.match(v.describedError('nl-revenue_share_bps'), /Enter a percentage from 0 to 100/);
    assert.equal(w.calls.filter((c) => c.method !== 'GET').length, 0, 'the field’s own check sends nothing');
    await v.type('nl-revenue_share_bps', '12.5');
    await v.type('nl-renews_on', '2030-02-30');
    await v.click('nl-primary');
    assert.deepEqual(w.calls.find((c) => c.method === 'PUT').body, { seats: { founder: 12, investor: 6, advisor: 4, partner: 2 } });
    assert.equal(w.calls.find((c) => c.method === 'PATCH').body.revenue_share_bps, 1250);
    assert.match(v.textOf('nl-step3-notice'), /Seats were saved\. The money terms were not\./);
    assert.match(v.describedError('nl-renews_on'), /renews_on must be a real date as YYYY-MM-DD, or null to clear it/);
    assert.equal(v.value('nl-annual_fee'), '120,000', 'every typed value stays');
    assert.equal(v.state.step, 2, 'it does not continue');
  } finally { await v.close(); }
});

test('L43: step 4 is optional; appointing asks for a reason and shows the Worker’s refusal on the email', async () => {
  const w = worker({ 'POST /admin/licences/:uid/admins': () => response({ error: 'no account with that address' }, 404) });
  const v = await mount({ step: 3, licence: DRAFT }, w);
  try {
    assert.match(v.textOf('nl-admins-none'), /No administrator appointed yet/);
    assert.match(v.textOf('nl-footer-note'), /Optional for issuing\. Administrators can be appointed later on the licence’s Access page\./);
    assert.equal(v.textOf('nl-primary'), 'Continue to agreement');
    assert.ok(v.has('nl-skip'));
    await v.type('nl-admin-email', 'nobody@sample');
    await v.type('nl-admin-reason', 'Ops');
    await v.click('nl-appoint-submit');
    assert.match(v.describedError('nl-admin-reason'), /A reason of at least 10 characters is required/);
    await v.type('nl-admin-reason', 'Runs day-to-day operations');
    await v.click('nl-appoint-submit');
    assert.match(v.describedError('nl-admin-email'), /No account with that address/);
    assert.equal(v.value('nl-admin-reason'), 'Runs day-to-day operations');
  } finally { await v.close(); }
});

test('L44: step 5 offers usable templates, shows the generated text once, and lists where each unfilled field is set', async () => {
  const contracts = [];
  const w = worker({
    'GET /admin/licences/:uid/contract': () => response({ contracts, contracts_available: true, templates: [
      { slug: 'wl', title: 'White-label Licence Agreement', version: 3, counsel_review: true, safety: { restricted: false, incomplete: false } },
      { slug: 'sp', title: 'Service Partner Schedule', version: 1, counsel_review: false, safety: { restricted: true, incomplete: false } },
    ] }),
    'POST /admin/licences/:uid/contract': () => {
      contracts.push({ uid: 'k1', template_slug: 'wl', template_title: 'White-label Licence Agreement', template_version: 3, body_sha256: '7a3e00000000c41b', unfilled_fields: ['licence.signatory_title', 'terms.notice_period'], status: 'draft', created_at: '2026-11-14T10:31:00Z', superseded_at: null });
      return response({ uid: 'k1', body_md: '1. Parties … {{licence.signatory_title}}', status: 'draft' }, 201);
    },
  });
  const v = await mount({ step: 4, licence: DRAFT }, w);
  try {
    assert.match(v.textOf('nl-templates'), /◔ Counsel review pending/);
    assert.equal(v.props(v.byId('nl-template-sp')).disabled, true, 'a restricted template cannot be chosen');
    assert.match(v.textOf('nl-templates'), /⊘ Legal review required/);
    assert.match(v.textOf('nl-signature-line'), /Issuing does not wait for a signature/);
    await v.click('nl-generate');
    assert.match(v.textOf('nl-doc-text'), /\{\{licence\.signatory_title\}\}/);
    assert.match(v.textOf('nl-unfilled'), /licence\.signatory_titleset in step 1Go to step 1/);
    assert.match(v.textOf('nl-unfilled'), /terms\.notice_periodset on the licence’s Terms page after issuing/);
    assert.equal(v.textOf('nl-primary'), 'Continue to review');
  } finally { await v.close(); }
});

test('L45: Issue lists every value from steps 1 to 5, asks the consequence sheet’s four questions, and Edit returns to the step', async () => {
  const v = await mount({ step: 5, licence: DRAFT }, worker());
  try {
    assert.match(v.text(), /Review and issue/);
    for (const n of [1, 2, 3, 4, 5]) assert.ok(v.has(`nl-review-${n}`), `group ${n}`);
    assert.match(v.textOf('nl-review-1'), /Registered address— Not recorded/);
    assert.match(v.textOf('nl-review-1'), /Brand kit#0F766E primary · #B45309 accent/);
    assert.match(v.textOf('nl-review-3'), /Annual feeEUR 120,000 per licence year/);
    assert.match(v.textOf('nl-review-4'), /Appointed○ None/);
    assert.match(v.textOf('nl-review-5'), /Draft contract○ None/);
    assert.deepEqual([1, 2, 3, 4].map((n) => v.textOf(`nl-question-${n}`).slice(0, 4 + CONSEQUENCE_QUESTIONS[n - 1].length)),
      CONSEQUENCE_QUESTIONS.map((q, i) => `${i + 1} · ${q}`));
    assert.match(v.textOf('nl-question-1'), /WL-CH-001 becomes Active for CH; its studio can use 24 seats\./);
    assert.match(v.textOf('nl-blockers'), /✓ Nothing blocks issuing\..*A pending signature does not block activation\./);
    assert.equal(v.props(v.byId('nl-issue')).disabled, false);
    await v.click('nl-edit-3');
    assert.equal(v.state.step, 2);
    assert.match(v.text(), /What are the commercial terms\?/);
  } finally { await v.close(); }
});

test('L46: Issue stays off while the blockers cannot be read', async () => {
  const v = await mount({ step: 5, licence: DRAFT }, worker({ 'GET /admin/licences/:uid/activation': () => response({ error: 'down' }, 500) }));
  try {
    assert.match(v.textOf('nl-blockers'), /We could not check what blocks issuing\./);
    assert.equal(v.props(v.byId('nl-issue')).disabled, true);
    assert.match(v.textOf('nl-footer-note'), /Issue licence is off: we could not check what blocks issuing\./);
  } finally { await v.close(); }
});

test('L47: a refusal on Issue keeps every value typed on the earlier steps, and Issue never clears them', async () => {
  let refuse = 'blocked';
  const w = worker({
    'POST /admin/licences/:uid/activate': () => {
      if (refuse === 'blocked') return response({ error: 'blocked', blockers: ['No renewal date is set.'] }, 409);
      if (refuse === 'changed') return response({ error: 'licence_changed', message: 'This licence changed while your request was being handled, so nothing was changed. Reload it and try again.' }, 409);
      return response({ ok: true, status: 'active', pushed: { ok: false, code: 'fr', retry: true, failure_code: 'unreachable' } });
    },
  });
  const v = await mount({ step: 2, licence: DRAFT }, w);
  try {
    await v.type('nl-token_split_bps', '5');
    await v.type('nl-reason', 'Terms recorded at issue, typed');
    await v.click('nl-back'); // to Territory, which is L21's step
    assert.equal(v.state.step, 1);
    await setStep(v, 5);
    await v.click('nl-issue');
    assert.match(v.textOf('nl-blockers'), /Not issued · 1 thing blocks issuing/);
    assert.match(v.textOf('nl-blockers'), /No renewal date is set\.Step 3 · Commercial terms/);
    assert.equal(v.props(v.byId('nl-issue')).disabled, true, 'Issue is off while something blocks it');
    await setStep(v, 2);
    assert.equal(v.value('nl-token_split_bps'), '5', 'the refusal kept step 3’s typed values');
    assert.equal(v.value('nl-reason'), 'Terms recorded at issue, typed');
    await setStep(v, 5);
    refuse = 'changed';
    await v.click('nl-issue');
    assert.match(v.textOf('nl-issue-refused'), /This licence changed while your request was being handled, so nothing was changed\..*Every value is kept\./);
    refuse = null;
    await v.click('nl-issue');
    assert.match(v.textOf('nl-issue-outcome'), /Issued at HQ · branch copy not delivered yet\..*HQ retries automatically/);
    assert.ok(v.props(v.byId('nl-issue')).disabled, 'issued once: the button is off');
    await setStep(v, 2);
    assert.equal(v.value('nl-token_split_bps'), '5');
  } finally { await v.close(); }
});

/** Moves the host to another step, as L21's step list does. */
async function setStep(v, i) {
  await act(async () => { v.state.go(i); });
  await v.flush();
}

test('no Worker route is added: every call is an api.js method that already existed', () => {
  const src = read('src/pages/admin/licences/NewLicenceSteps.jsx');
  const used = [...new Set([...src.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]))].sort();
  assert.deepEqual(used, ['licence', 'licenceActivate', 'licenceActivation', 'licenceAdminAdd', 'licenceBrandSet', 'licenceContractCreate', 'licenceCreate', 'licenceEntityComplete', 'licenceSetSeats', 'licenceSetTerms']);
  const apiSrc = read('src/lib/api.js');
  for (const m of used) assert.match(apiSrc, new RegExp(`\\b${m}: \\(`), `${m} is an existing api.js method`);
});
