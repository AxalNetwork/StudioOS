// D6086 (#6086, RA-27, RA-28) — a vesting schedule on an option grant, without
// Carta: Record an issuance's Vesting fields and their Modelled preview, the
// body the owner records and a co-founder proposes, the proposal that shows
// the schedule to the owner, and the Grants table and holder drawer reading it
// back with vested and unvested. Fixtures follow the Worker's shapes
// (services/capTableRecord.ts, services/capTableRegister.ts); every name and
// figure is synthetic, and every date is fixed.
import { withCapabilities } from './_cap_table_capabilities.mjs';
import './_cycleSteps.mjs'; // D4574 (#4574, H5): CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { grantBody } from '../src/pages/raise/captable/IssuanceDialogs.jsx';
import { issuanceBody } from '../src/pages/raise/captable/historyModel.js';
import { holderView } from '../src/pages/raise/captable/overviewModel.js';
import {
  VESTING_PRESETS, addMonths, emptyVesting, grantRows, vestedBasis, vestingBody, vestingPreview, vestingWords,
} from '../src/pages/raise/captable/poolModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const SCHEDULE = { start_date: '2026-03-01', total_months: 48, cliff_months: 12 };
const iss = (o) => ({ status: 'recorded', source: 'typed', origin: 'owner', origin_ref: null, from_holder: null, class_uid: null, shares: null, amount_cents: null, currency: 'USD', price_per_share_micros: null, issued_on: null, terms: {}, document_ref: null, safe_issuance_uid: null, correction_reason: null, void_reason: null, dismiss_reason: null, created_at: '2026-10-01 10:00:00', ...o });
const RECORD = {
  project_id: 3,
  currency: { code: 'USD', source: 'default' },
  classes: { available: true, reason: null, rows: [{ uid: 'c1', name: 'Common', kind: 'common' }, { uid: 'c3', name: 'Options', kind: 'option_pool' }] },
  by_holder: { available: true, reason: null, rows: [
    { holder_id: 12, name: 'Synthetic Founder', kind: 'founder', shares: 4000000, options: 0, by_class: [{ class_uid: 'c1', shares: 4000000 }] },
    { holder_id: 15, name: 'Synthetic Engineer', kind: 'employee', shares: 0, options: 60000, by_class: [{ class_uid: 'c3', shares: 60000 }] },
  ] },
  by_class: { available: true, reason: null, rows: [] },
  outstanding: { available: true, reason: null, shares: 4000000, common: 4000000, preferred: 0 },
  fully_diluted: { available: true, reason: null, shares: 5000000, outstanding: 4000000, options_granted: 60000, unallocated_pool: 940000, pool_recorded: true },
  instruments: { available: true, reason: null, rows: [] },
  issuances: { available: true, reason: null, rows: [
    iss({ uid: 'g-old', kind: 'grant', holder: { holder_id: 15, name: 'Synthetic Engineer' }, class_uid: 'c3', shares: 12000, price_per_share_micros: 300000, issued_on: '2026-01-15', vesting: null }),
    iss({ uid: 'g-new', kind: 'grant', holder: { holder_id: 15, name: 'Synthetic Engineer' }, class_uid: 'c3', shares: 48000, price_per_share_micros: 420000, issued_on: '2026-03-01', vesting: SCHEDULE }),
    iss({ uid: 'g-name', kind: 'grant', holder: { holder_id: null, name: 'Synthetic Advisor' }, class_uid: 'c3', shares: 2000, price_per_share_micros: 500000, issued_on: '2026-05-01', vesting: null }),
  ] },
  proposals: { available: true, reason: null, rows: [
    iss({ uid: 'p6', status: 'proposed', kind: 'grant', origin: 'cofounder', holder: { holder_id: 15, name: 'Synthetic Engineer' }, class_uid: 'c3', shares: 20000, vesting: SCHEDULE }),
    iss({ uid: 'p7', status: 'proposed', kind: 'grant', origin: 'cofounder', holder: { holder_id: 15, name: 'Synthetic Engineer' }, class_uid: 'c3', shares: 5000, vesting: null }),
  ] },
};
// As `GET /equity-plan?project_id=` answers on 2027-04-01 for the grant recorded with its schedule.
const PLAN = {
  scope: { kind: 'venture', project_id: 3 }, pools: [], elections: { available: true, rows: [] },
  grants: [{ id: 21, holder_id: 15, security_id: null, start_date: '2026-03-01', cliff_months: 12, total_months: 48, total_shares: 48000, vested_shares: 13000, unvested_shares: 35000,
    vested_basis: 'schedule', vested_as_of: '2027-04-01', issuance_uid: 'g-new', source: 'manual', as_of: '2026-03-01 10:00:00' }],
  summary: { pool_count: 0, grant_count: 1, granted_shares: 48000, vested_shares: 13000, unvested_shares: 35000 },
};
const GRANTS = { grants: [], can_change: true, levels: [] };
const OWNER = { id: 2, role: 'founder', founder_id: 20, subscription_tier: 'studio', name: 'Synthetic Founder' };

function handlerFor(o = {}) {
  return (url, options = {}) => {
    if (/\/captable\/record\/3\/proposals\/[^/]+\/(accept|dismiss)/.test(url)) return response({ issuance: {} });
    if (/\/captable\/record\/3\/proposals$/.test(url)) return response({ issuance: { uid: 'new' } }, 201);
    if (/\/captable\/record\/3\/issuances$/.test(url)) return o.recorded ? o.recorded(url, options) : response({ issuance: { uid: 'new' } }, 201);
    if (url.includes('/captable/equity-plan')) return response(PLAN);
    if (url.includes('/captable/record/3')) return response(withCapabilities(RECORD, OWNER, o.grants || GRANTS));
    if (url.includes('/captable/access/3/grants')) return response(o.grants || GRANTS);
    if (/\/projects\/3(\?|$)/.test(url)) return response({ id: 3, uid: 'p-3' });
    if (url.includes('/data-room/p-3')) return response({ files: [] });
    if (url.includes('/auth/me')) return response(OWNER);
    return response({});
  };
}

async function mounted(url, o = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const handle = handlerFor(o);
  globalThis.fetch = async (u, options = {}) => { requests.push([String(u), options.method || 'GET', options.body]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(OWNER));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Routes, null,
    h(Route, { path: '/raise/cap-table/proposal/:proposal', element: h(CycleRoute, { cycle: 'raise', slug: 'cap-table', capTableProposal: true }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/new', element: h(CycleRoute, { cycle: 'raise', adding: true }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  )))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    by: (id) => all(id)[0], props, ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    labelled: (label) => nodes().find((n) => props(n)['aria-label'] === label),
    text: (n) => { assert.ok(n, 'no such node'); return text(n).replace(/\s+/g, ' ').trim(); },
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async change(node, value) { assert.ok(node, 'no such node'); await act(async () => { props(node).onChange?.({ target: { value } }); }); await flush(); },
    posted: (re) => requests.filter(([u, m]) => re.test(u) && m !== 'GET').map(([u, , b]) => [u, b ? JSON.parse(b) : null]),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ─────────────────────────────────────────────────────────── the model

test('a schedule from the form: blank Start is none, the cliff no longer than the length, and whole months', () => {
  assert.deepEqual(vestingBody(emptyVesting()), { vesting: null, sentence: null }, 'a blank Start records the grant without a schedule');
  assert.deepEqual(vestingBody({ start: '2026-03-01', months: '48', cliff: '12' }), { vesting: SCHEDULE, sentence: null });
  assert.equal(vestingBody({ start: '2026-03-01', months: '48', cliff: '60' }).sentence, 'The cliff can’t be longer than the vesting: 60 months is more than 48.');
  assert.equal(vestingBody({ start: '2026-03-01', months: '48', cliff: '48' }).sentence, null, 'a cliff as long as the schedule is allowed');
  assert.equal(vestingBody({ start: '2026-03-01', months: '0', cliff: '0' }).sentence, 'Vesting runs for a whole number of months, 1 to 600.');
  assert.equal(vestingBody({ start: '2026-03-01', months: '601', cliff: '0' }).sentence, 'Vesting runs for a whole number of months, 1 to 600.');
  assert.equal(vestingBody({ start: '2026-03-01', months: '600', cliff: '0' }).sentence, null);
  assert.equal(vestingBody({ start: '2026-03-01', months: '4.5', cliff: '0' }).sentence, 'Vesting runs for a whole number of months, 1 to 600.');
  assert.equal(vestingBody({ start: '2026-03-01', months: '48', cliff: '' }).sentence, 'The cliff is a whole number of months, 0 for none.');
  assert.equal(vestingBody({ start: '2026-02-30', months: '48', cliff: '12' }).sentence, 'The vesting start is a date.');
  assert.deepEqual(VESTING_PRESETS.map((p) => [p.label, p.months ?? null, p.cliff ?? null]),
    [['4 years, 1-year cliff', '48', '12'], ['4 years, no cliff', '48', '0'], ['Custom', null, null]]);
});

test('the Modelled preview: the cliff’s share and day, then monthly to the end; hidden until the schedule is whole', () => {
  assert.equal(vestingPreview({ start: '2026-03-01', months: '48', cliff: '12' }), '25% vests on 1 Mar 2027, then monthly to 1 Mar 2030');
  assert.equal(vestingPreview({ start: '2026-03-01', months: '36', cliff: '6' }), '16.7% vests on 1 Sep 2026, then monthly to 1 Mar 2029');
  assert.equal(vestingPreview({ start: '2026-03-01', months: '48', cliff: '0' }), 'Vests monthly from 1 Apr 2026 to 1 Mar 2030');
  assert.equal(vestingPreview({ start: '2026-03-01', months: '12', cliff: '12' }), 'All of it vests on 1 Mar 2027');
  assert.equal(vestingPreview({ start: '2026-03-01', months: '48', cliff: '60' }), null);
  assert.equal(vestingPreview({ start: '', months: '48', cliff: '12' }), null);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'a shorter month ends on its last day');
  assert.equal(addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(vestingWords(SCHEDULE), '4 years, 1-year cliff, from 1 Mar 2026');
  assert.equal(vestingWords({ start_date: '2026-03-01', total_months: 36, cliff_months: 0 }), '36 months, no cliff, from 1 Mar 2026');
  assert.equal(vestingWords(null), 'No schedule');
});

test('the grant’s body carries its schedule; a bad one stops it; any other kind is unchanged', () => {
  const form = { kind: 'grant', holder: { id: 15 }, pool_uid: 'c3', shares: '48,000', price: '', date: '2026-03-01', document_ref: '', vest: { preset: '4y1c', start: '2026-03-01', months: '48', cliff: '12' } };
  const ok = grantBody(issuanceBody(form), form);
  assert.equal(ok.sentence, null);
  assert.deepEqual(ok.body.vesting, SCHEDULE);
  const blank = grantBody(issuanceBody({ ...form, vest: emptyVesting() }), { ...form, vest: emptyVesting() });
  assert.ok(!('vesting' in blank.body), 'no Start, no schedule sent');
  const bad = { ...form, vest: { ...form.vest, cliff: '60' } };
  assert.equal(grantBody(issuanceBody(bad), bad).sentence, 'The cliff can’t be longer than the vesting: 60 months is more than 48.');
  const missing = { ...bad, date: '' };
  assert.equal(grantBody(issuanceBody(missing), missing).sentence, 'It still needs a date.', 'what the record needs is said first');
  const founding = { kind: 'founding', holder: { id: 12 }, class_uid: 'c1', shares: '10', date: '2026-01-01', vest: form.vest };
  assert.ok(!('vesting' in grantBody(issuanceBody(founding), founding).body));
});

test('Grants: a row written with a grant reads that grant, with vested, unvested and where Vested comes from', () => {
  const [g] = grantRows(PLAN, RECORD);
  assert.equal(g.strike, '$0.42', 'the grant the row names, not the holder’s older one');
  assert.equal(g.grantDate, '1 Mar 2026');
  assert.equal(g.onGrant, true);
  assert.deepEqual([g.vested, g.unvested, g.vestedBasis], ['13,000', '35,000', 'Worked out from the schedule on 1 Apr 2027']);
  const legacy = grantRows({ ...PLAN, grants: [{ ...PLAN.grants[0], issuance_uid: undefined, unvested_shares: undefined, vested_basis: 'recorded', source: 'connector_carta' }] }, RECORD)[0];
  assert.equal(legacy.grantDate, '1 Mar 2026', 'without a link, the holder’s latest grant, as before');
  assert.deepEqual([legacy.onGrant, legacy.unvested, legacy.vestedBasis], [false, 'Not recorded', 'As Carta reports it']);
  const nameOnly = grantRows({ ...PLAN, grants: [{ ...PLAN.grants[0], holder_id: null, issuance_uid: null }] }, RECORD)[0];
  assert.equal(nameOnly.strike, 'Not recorded', 'a row with no holder and no grant matches nothing, not a name-only grant');
  const older = grantRows({ ...PLAN, grants: [{ ...PLAN.grants[0], issuance_uid: 'g-old' }] }, RECORD)[0];
  assert.deepEqual([older.strike, older.grantDate], ['$0.30', '15 Jan 2026'], 'the named grant, even when the holder has a later one');
  const named = grantRows({ ...PLAN, grants: [{ ...PLAN.grants[0], holder_id: null, issuance_uid: 'g-name' }] }, RECORD)[0];
  assert.deepEqual([named.holder, named.strike], ['Synthetic Advisor', '$0.50'], 'a grant to a name only is named from the grant');
  assert.equal(vestedBasis({ vested_basis: 'recorded', source: 'manual' }), null);
});

test('the holder drawer’s Vesting: vested and unvested, and the day the schedule was worked out on', () => {
  const v = holderView(RECORD, 15, { grants: GRANTS, plan: PLAN, filings: [] });
  assert.equal(v.vesting.length, 1);
  assert.deepEqual([v.vesting[0].vested, v.vesting[0].unvested, v.vesting[0].basis], ['Vested 13,000 of 48,000', 'Unvested 35,000', 'Worked out from the schedule on 1 Apr 2027']);
  const imported = holderView(RECORD, 15, { grants: GRANTS, plan: { ...PLAN, grants: [{ ...PLAN.grants[0], vested_basis: 'recorded' }] }, filings: [] });
  assert.equal(imported.vesting[0].basis, null);
});

// ─────────────────────────────────────────────────────────── the pages

test('RA-27: the owner records a grant with its schedule; a cliff longer than the total stops it before anything is sent', async () => {
  const v = await mounted('/raise/cap-table/new?project_id=3');
  try {
    assert.ok(!v.by('captable-record-vesting'), 'no Vesting on a founding issuance');
    await v.press(v.by('captable-record-type-grant'));
    assert.ok(v.by('captable-record-vesting'), 'a grant has Vesting');
    assert.equal(v.props(v.by('captable-record-vesting-presets')).role, 'radiogroup');
    assert.equal(v.props(v.by('captable-record-vesting-4y1c'))['aria-checked'], true, '4 years, 1-year cliff is the preset');
    assert.match(v.text(v.by('captable-record-vesting-blank')), /Leave Start blank to record the grant without a schedule\./);
    await v.change(v.labelled('Holder'), '15');
    await v.change(v.labelled('Pool'), 'c3');
    await v.change(v.by('captable-record-shares'), '48,000');
    await v.change(v.by('captable-record-date'), '2026-03-01');
    await v.change(v.by('captable-record-vesting-start'), '2026-03-01');
    assert.equal(v.text(v.by('captable-record-vesting-preview')), 'Modelled 25% vests on 1 Mar 2027, then monthly to 1 Mar 2030');
    await v.change(v.by('captable-record-vesting-cliff'), '60');
    assert.equal(v.props(v.by('captable-record-vesting-custom'))['aria-checked'], true, 'a typed cliff is Custom');
    assert.equal(v.text(v.by('captable-record-vesting-error')), 'The cliff can’t be longer than the vesting: 60 months is more than 48.');
    assert.ok(!v.by('captable-record-vesting-preview'), 'the preview hides until the schedule is valid');
    await v.press(v.by('captable-record-dialog-go'));
    assert.equal(v.posted(/\/issuances$/).length, 0, 'checked before anything is sent');
    await v.press(v.by('captable-record-vesting-4y0c'));
    assert.equal(v.text(v.by('captable-record-vesting-preview')), 'Modelled Vests monthly from 1 Apr 2026 to 1 Mar 2030');
    await v.press(v.by('captable-record-dialog-go'));
    assert.deepEqual(v.posted(/\/issuances$/).at(-1), ['/api/captable/record/3/issuances', {
      kind: 'grant', holder_id: 15, class_uid: 'c3', shares: 48000, issued_on: '2026-03-01', source: 'typed',
      vesting: { start_date: '2026-03-01', total_months: 48, cliff_months: 0 },
    }]);
  } finally { await v.close(); }
});

test('RA-28: a co-founder proposes the grant with its schedule, and the owner reads the schedule on the proposal', async () => {
  const w = await mounted('/raise/cap-table/new?project_id=3', { grants: { ...GRANTS, can_change: false } });
  try {
    await w.press(w.by('captable-record-type-grant'));
    await w.change(w.labelled('Holder'), '15');
    await w.change(w.labelled('Pool'), 'c3');
    await w.change(w.by('captable-record-shares'), '20000');
    await w.change(w.by('captable-record-date'), '2026-03-01');
    await w.change(w.by('captable-record-vesting-start'), '2026-03-01');
    await w.press(w.by('captable-record-dialog-go'));
    assert.equal(w.posted(/\/issuances$/).length, 0, 'a co-founder never records');
    assert.deepEqual(w.posted(/\/proposals$/).at(-1)[1].vesting, SCHEDULE);
  } finally { await w.close(); }
  const v = await mounted('/raise/cap-table/proposal/p6?project_id=3');
  try {
    assert.equal(v.text(v.by('captable-proposal-vesting')), 'Vesting · 4 years, 1-year cliff, from 1 Mar 2026');
    await v.press(v.by('captable-proposal-accept'));
    assert.deepEqual(v.posted(/\/proposals\/p6\/accept$/).at(-1)[1], {}, 'Accept sends nothing: the schedule travels with the proposal on the Worker');
  } finally { await v.close(); }
  const none = await mounted('/raise/cap-table/proposal/p7?project_id=3');
  try {
    assert.equal(none.text(none.by('captable-proposal-vesting')), 'Vesting · No schedule');
  } finally { await none.close(); }
});

test('Option pool: the Grants table shows vested, unvested and the grant the schedule is on', async () => {
  const v = await mounted('/raise/cap-table/option-pool?project_id=3');
  try {
    assert.match(v.text(v.by('captable-grants-table')), /Vesting Vested Unvested 83\(b\) or exercise/);
    assert.equal(v.text(v.by('captable-grant-vested')), '13,000 Worked out from the schedule on 1 Apr 2027');
    assert.equal(v.text(v.by('captable-grant-unvested')), '35,000');
    assert.equal(v.text(v.by('captable-grant-on-grant')), 'On the grant');
  } finally { await v.close(); }
});

test('the source: no canvas sample, and the Worker writes and reads what the client sends', () => {
  for (const f of ['IssuanceDialogs.jsx', 'poolModel.js', 'OptionPoolTab.jsx', 'HolderDrawer.jsx', 'ProposalDrawer.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/raise/captable/${f}`), /\[(Mara Quinn|Lee Park|Sam Ortiz|Founder A|Founder B|2025 Equity Plan)\]/, f);
  }
  const svc = read('cloudflare-worker/src/services/capTableRecord.ts');
  assert.match(svc, /export const VESTING_MONTHS_MAX = 600;/, 'the Worker’s bound is the form’s');
  assert.match(read('frontend/src/pages/raise/captable/poolModel.js'), /export const VESTING_MONTHS_MAX = 600;/);
});
