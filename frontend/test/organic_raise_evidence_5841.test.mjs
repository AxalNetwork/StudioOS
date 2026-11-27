/**
 * #5841 part 2 (D5841-p2): the founder's explicit path from Grow's organic report to Raise evidence, on #5842's client.
 * Viewing writes nothing; a pin needs a preview, a claim the founder picks and a confirm; only organic-search claims
 * are offered; withdraw and re-review states are drawn and send exactly what the founder confirmed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/organic_raise_evidence_5841.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { mutationCheck } from './_form_d695.mjs';
import { OrganicSearchEvidence } from '../src/pages/cycles/evidence/OrganicSearchEvidence.jsx';
import { SearchConsoleReport } from '../src/pages/cycles/distribution/SearchConsoleResults.jsx';
import { ClaimDrawer } from '../src/pages/cycles/evidence/EvidenceDrawers.jsx';
import { viewModel } from '../src/pages/cycles/evidence/evidenceView.js';
import {
  eligibleClaims, organicError, organicFigure, organicHref, organicSearch, pinnableWeeks, selectionState,
} from '../src/pages/cycles/evidence/organicEvidenceModel.js';

const h = React.createElement;
const HASH = 'a'.repeat(64), REVISED_HASH = 'b'.repeat(64);
const SITE = 'sc-domain:example.invalid';
// Synthetic, immutable fixtures: provider dates are fixed Monday–Sunday weeks.
const week = (start, end, complete) => ({ week_start: start, week_end: end, complete, clicks: 120, impressions: 4000, ctr: 0.03, days_reported: 7, days_not_returned: 0, days_not_fetched: complete ? 0 : 2 });
const results = { property: { site_url: SITE, property_kind: 'domain', access_state: 'ok' }, last_status: 'ok', last_success_at: '2026-10-20T00:00:00Z', fetched_through: '2026-10-18',
  weeks: [week('2026-10-05', '2026-10-11', true), week('2026-10-12', '2026-10-18', true), week('2026-10-19', '2026-10-25', false)] };
const claim = (uid, claim_kind, stated_value) => ({ uid, surface: 'narrative', surface_version: 'v2', field_key: `traction#${claim_kind}`, claim_kind, stated_value, state: 'not_backed', record: null, links: [] });
const CLAIMS = [claim('c-clicks', 'organic_search_clicks', '120'), claim('c-ctr', 'organic_search_ctr', '3'), claim('c-cust', 'paying_customers', '42'), claim('c-rev', 'revenue', '9000'), claim('c-proof', 'traction_proof', null)];
const candidate = (metric, value, hash = HASH, numerator = null, denominator = null) => ({ snapshot_hash: hash, value_num: value, value_unit: metric === 'ctr' ? 'ratio' : 'count',
  search_console: { site_url: SITE, window: { from: '2026-10-12', to: '2026-10-18' }, metric, numerator, denominator, coverage: { days: 7, days_reported: 6, days_not_returned: 1, days_not_fetched: 0 } } });
const selection = (uid, status, source, o = {}) => ({ uid, status, aggregate: { site_url: SITE, window: { from: '2026-10-05', to: '2026-10-11' }, metric: 'clicks', unit: 'count', value: 120, coverage: { days: 7, days_reported: 7, days_not_returned: 0 } },
  source, item: { uid: `item-${uid}`, state: status === 'current' ? 'pinned' : 'unpinned', visibility: 'private' }, claim: { uid: 'c-clicks', claim_kind: 'organic_search_clicks' }, ...o });
const CURRENT = { state: 'current', stale: false, original: null, revised: null, corrected_days: [] };

function fakeApi(over = {}) {
  const calls = { preview: [], pin: [], review: [], withdraw: [], selections: 0 };
  const api = {
    selections: async () => { calls.selections++; return { selections: over.selections ?? [] }; },
    preview: async (p, q) => { calls.preview.push([p, q]); return over.preview ? over.preview(q) : { preview: { state: 'selectable', reason: null, candidate: candidate(q.metric, q.metric === 'ctr' ? 0.069 : 130) } }; },
    pin: async (...a) => { calls.pin.push(a); if (over.pin) return over.pin(...a); return { selection: {} }; },
    review: async (...a) => { calls.review.push(a); return { selection: {} }; },
    withdraw: async (...a) => { calls.withdraw.push(a); return { selection: {} }; },
  };
  return { api, calls };
}
const resultsApi = (r = results) => ({ results: async () => r });
async function mount(props) {
  const m = await mountContracts(h(OrganicSearchEvidence, { projectId: 41, claims: CLAIMS, ...props }), '/raise/evidence?project_id=41&organic=open', { id: 10, role: 'founder' });
  await m.flush(); await m.flush();
  return m;
}
const writes = (c) => c.pin.length + c.review.length + c.withdraw.length;

test('model: only organic-search claims of the same metric are offered; never customers, revenue or traction proof', () => {
  assert.deepEqual(eligibleClaims(CLAIMS, 'clicks').map((c) => c.uid), ['c-clicks']);
  assert.deepEqual(eligibleClaims(CLAIMS, 'ctr').map((c) => c.uid), ['c-ctr']);
  assert.deepEqual(eligibleClaims(CLAIMS, 'impressions'), []);
  assert.deepEqual(eligibleClaims(null, 'clicks'), []);
  assert.deepEqual(pinnableWeeks(results).map((w) => w.week_start), ['2026-10-12', '2026-10-05']);
  assert.deepEqual(pinnableWeeks({ ...results, property: null }), []);
  assert.equal(organicFigure('clicks', null), 'Not recorded'); assert.equal(organicFigure('clicks', 0), '0');
  assert.equal(organicFigure('ctr', 0.069), '6.9%'); assert.equal(organicFigure('impressions', 61000), '61,000');
  assert.equal(organicSearch('?project_id=41&organic_claim=old', { week: '2026-10-12' }), '?project_id=41&organic=2026-10-12');
  assert.equal(organicSearch('?project_id=41', { claim: 'c-clicks' }), '?project_id=41&organic=open&organic_claim=c-clicks');
  assert.equal(organicHref(41, 'not-a-date'), '/raise/evidence?project_id=41&organic=open');
});

test('model: withdraw only while current, re-review only when corrected; closed selections take no action', () => {
  const corrected = selectionState(selection('s1', 'current', { ...CURRENT, state: 'corrected', stale: true }));
  assert.equal(corrected.key, 'corrected'); assert.equal(corrected.canReview, true); assert.equal(corrected.canWithdraw, true); assert.equal(corrected.stale, true);
  const revoked = selectionState(selection('s2', 'current', { ...CURRENT, state: 'revoked' }));
  assert.equal(revoked.canReview, false); assert.equal(revoked.canWithdraw, true);
  for (const status of ['withdrawn', 'replaced']) {
    const s = selectionState(selection('s3', status, { state: status }));
    assert.equal(s.key, status); assert.equal(s.canWithdraw, false); assert.equal(s.canReview, false);
  }
  assert.equal(selectionState({ status: 'current', source: { state: 'surprise' } }).key, 'unknown');
  // A raw error never reaches the founder; a known code gets this page's sentence.
  assert.match(organicError({ status: 503, code: 'search_console_unavailable', message: 'SECRET SQL' }), /unavailable until its app is approved/);
  assert.doesNotMatch(organicError(new TypeError('RAW STACK at x.js:1:2')), /RAW STACK/);
});

test('opening the sheet, choosing a week and previewing write nothing; a preview is only on click', async () => {
  const { api, calls } = fakeApi();
  const m = await mount({ api, resultsApi: resultsApi() });
  try {
    assert.equal(writes(calls), 0); assert.equal(calls.preview.length, 0); assert.equal(calls.selections, 1);
    assert.match(m.text(), /creates and shares nothing/); assert.match(m.text(), /Nothing from Search Console is pinned/);
    assert.match(m.text(), /2026-10-12 to 2026-10-18/); assert.doesNotMatch(m.text(), /2026-10-19 to 2026-10-25/); // the partial week is never offered
    await m.click('Preview figure'); await m.flush();
    assert.deepEqual(calls.preview, [[41, { site_url: SITE, week_start: '2026-10-12', metric: 'clicks' }]]);
    assert.match(m.text(), /130/); assert.match(m.text(), /6 of 7 days reported, 1 with no row from Google \(not zero\)/);
    assert.equal(writes(calls), 0);
    const pinButton = m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)?.['data-testid'] === 'organic-pin');
    assert.equal(m.props(pinButton).disabled, true); // no claim is chosen for the founder
    assert.doesNotMatch(m.text(), /Paying customers|Monthly revenue|Traction proof/);
  } finally { await m.unmount(); }
});

test('a pin sends the previewed hash and the claim the founder picked, only after the confirm', async () => {
  const { api, calls } = fakeApi();
  let changed = 0;
  const m = await mount({ api, resultsApi: resultsApi(), onChanged: () => { changed++; } });
  try {
    await m.fill('Figure', 'ctr'); await m.click('Preview figure'); await m.flush();
    assert.match(m.text(), /6\.9%/); assert.match(m.text(), /Organic search CTR/);
    await m.fill('The claim it backs', 'c-ctr');
    await m.click('Pin to this claim');
    assert.equal(calls.pin.length, 0); assert.match(m.text(), /pinned and Private: no investor sees it until you share it/);
    await m.click('Pin, Private'); await m.flush(); await m.flush();
    assert.deepEqual(calls.pin, [[41, { site_url: SITE, week_start: '2026-10-12', metric: 'ctr', snapshot_hash: HASH, claim_id: 'c-ctr' }]]);
    assert.equal(changed, 1); assert.match(m.text(), /Pinned to the claim, Private/); assert.equal(calls.selections, 2);
  } finally { await m.unmount(); }
});

test('a refused pin shows the Worker sentence, never the raw error, and writes nothing else', async () => {
  const refusal = Object.assign(new Error('SQLITE_CONSTRAINT raw'), { status: 409, code: 'claim_refused', data: { error: 'claim_refused', message: 'Organic search activity cannot back this claim.' } });
  const { api } = fakeApi({ pin: async () => { throw refusal; } });
  const m = await mount({ api, resultsApi: resultsApi(), claim: 'c-clicks' });
  try {
    await m.click('Preview figure'); await m.flush();
    await m.click('Pin to this claim'); await m.click('Pin, Private'); await m.flush();
    assert.match(m.text(), /Organic search activity cannot back this claim/); assert.doesNotMatch(m.text(), /SQLITE/);
  } finally { await m.unmount(); }
});

test('no organic claim: the founder is told how to state one, and nothing can be pinned', async () => {
  const { api } = fakeApi();
  const m = await mount({ api, resultsApi: resultsApi(), claims: CLAIMS.filter((c) => !c.claim_kind.startsWith('organic')) });
  try {
    await m.click('Preview figure'); await m.flush();
    assert.match(m.text(), /No claim states organic search clicks yet/); assert.match(m.text(), /4,200 organic search clicks/);
    const pinButton = m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)?.['data-testid'] === 'organic-pin');
    assert.equal(m.props(pinButton).disabled, true);
  } finally { await m.unmount(); }
});

test('a preview the Worker refuses says why, with no figure', async () => {
  const { api } = fakeApi({ preview: () => ({ preview: { state: 'revoked', reason: 'Google no longer grants access to this property. Nothing from it can be attached.', candidate: null } }) });
  const m = await mount({ api, resultsApi: resultsApi() });
  try {
    await m.click('Preview figure'); await m.flush();
    assert.match(m.text(), /Cannot be pinned: Google no longer grants access/);
    assert.equal(m.nodes().some((n) => m.props(n)?.['data-testid'] === 'organic-pin'), false);
  } finally { await m.unmount(); }
});

test('withdraw is confirmed, sends the selection uid, and a closed selection shows its state with no action', async () => {
  const { api, calls } = fakeApi({ selections: [selection('s-current', 'current', CURRENT), selection('s-gone', 'withdrawn', null)] });
  const m = await mount({ api, resultsApi: resultsApi() });
  try {
    assert.match(m.text(), /Current/); assert.match(m.text(), /Withdrawn/); assert.match(m.text(), /Investors no longer see it/);
    const withdrawButtons = m.nodes().filter((n) => n.tagName === 'BUTTON' && m.props(n)?.['data-testid'] === 'organic-withdraw');
    assert.equal(withdrawButtons.length, 1);
    await m.click('Withdraw'); assert.equal(calls.withdraw.length, 0); assert.match(m.text(), /removed from its claim/);
    const confirm = m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)?.['data-testid'] === 'organic-withdraw-dialog-confirm');
    await act(async () => { await m.props(confirm).onClick(); }); await m.flush();
    assert.deepEqual(calls.withdraw, [[41, 's-current']]);
  } finally { await m.unmount(); }
});

test('a corrected week shows pinned beside revised and re-reviews with the revised preview hash', async () => {
  const corrected = { state: 'corrected', stale: false, original: { value: 120 }, revised: { value: 118 }, corrected_days: ['2026-10-07'] };
  const { api, calls } = fakeApi({ selections: [selection('s-fix', 'current', corrected)], preview: () => ({ preview: { state: 'selectable', reason: null, candidate: { ...candidate('clicks', 118, REVISED_HASH), search_console: { ...candidate('clicks', 118).search_console, window: { from: '2026-10-05', to: '2026-10-11' } } } } }) });
  const m = await mount({ api, resultsApi: resultsApi() });
  try {
    assert.match(m.text(), /Corrected by Google: re-review/); assert.match(m.text(), /Pinned 120; revised 118 \(2026-10-07\)/);
    await m.click('Re-review'); await m.flush();
    assert.deepEqual(calls.preview.at(-1), [41, { site_url: SITE, week_start: '2026-10-05', metric: 'clicks' }]);
    assert.equal(calls.review.length, 0); assert.match(m.text(), /Revised by Google/);
    await m.click('Use the revised figure, Private'); await m.flush(); await m.flush();
    assert.deepEqual(calls.review, [[41, 's-fix', { snapshot_hash: REVISED_HASH }]]);
  } finally { await m.unmount(); }
});

test('unavailable Search Console reads say so, never an empty list or a raw error', async () => {
  const down = Object.assign(new Error('RAW PROVIDER TEXT'), { status: 503, code: 'search_console_unavailable', data: { error: 'search_console_unavailable' } });
  const api = { ...fakeApi().api, selections: async () => { throw down; } };
  const m = await mount({ api, resultsApi: { results: async () => { throw down; } } });
  try {
    assert.match(m.text(), /unavailable until its app is approved/); assert.doesNotMatch(m.text(), /RAW PROVIDER|Nothing from Search Console is pinned|No Search Console property is selected/);
    assert.equal(m.text().match(/unavailable until its app is approved/g).length, 2); // each block says so, with its own Try again
  } finally { await m.unmount(); }
});

test('Grow report: a link to Raise for the newest whole week, never a write; none when no week is whole', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(SearchConsoleReport, { data: results, projectId: 41 })));
  assert.match(html, /href="\/raise\/evidence\?project_id=41&amp;organic=2026-10-12"/);
  assert.match(html, /Viewing this report creates and shares nothing/);
  const partial = renderToStaticMarkup(h(MemoryRouter, null, h(SearchConsoleReport, { data: { ...results, weeks: [results.weeks[2]] }, projectId: 41 })));
  assert.doesNotMatch(partial, /organic=/); assert.match(partial, /No whole week is stored in full yet/);
});

test('claim drawer: an organic-search claim offers the Search Console path to its founder only; other claims do not', () => {
  const read = (canDecide) => ({ items: { state: 'recorded', has_more: false, rows: [] }, proposals: { state: 'recorded', has_more: false, rows: [] },
    claims: { state: 'recorded', has_more: false, rows: CLAIMS }, coverage: { state: 'recorded', groups: [] }, permissions: { can_decide: canDecide, can_share: canDecide } });
  const drawer = (id, canDecide = true) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [`/raise/evidence/claim/${id}`] },
    h(ClaimDrawer, { id, model: viewModel(read(canDecide)), search: '?project_id=41', projectId: 41 })));
  assert.match(drawer('c-clicks'), /href="\/raise\/evidence\?project_id=41&amp;organic=open&amp;organic_claim=c-clicks"[^>]*>Back with Search Console/);
  assert.doesNotMatch(drawer('c-cust'), /Back with Search Console/);
  assert.doesNotMatch(drawer('c-clicks', false), /Back with Search Console/);
});

test('mutations: offered claims, whole weeks, missing figures and allowed actions', async () => {
  const path = 'pages/cycles/evidence/organicEvidenceModel.js';
  await mutationCheck(readFileSync(new URL('../src/' + path, import.meta.url), 'utf8'), path, (mod) => {
    assert.deepEqual(mod.eligibleClaims(CLAIMS, 'clicks').map((c) => c.uid), ['c-clicks']);
    assert.deepEqual(mod.eligibleClaims(CLAIMS, 'ctr').map((c) => c.uid), ['c-ctr']);
    assert.deepEqual(mod.pinnableWeeks(results).map((w) => w.week_start), ['2026-10-12', '2026-10-05']);
    assert.equal(mod.organicFigure('clicks', null), 'Not recorded');
    assert.equal(mod.organicFigure('ctr', 0.069), '6.9%');
    assert.equal(mod.selectionState(selection('x', 'current', { state: 'revoked' })).canReview, false);
    assert.equal(mod.selectionState(selection('x', 'withdrawn', null)).canWithdraw, false);
  }, [
    ["filter((c) => c?.uid && mayBack(metric, c.claim_kind))", "filter((c) => c?.uid)"],
    ["clicks: ['organic_search', 'organic_search_clicks', 'distribution']", "clicks: ['organic_search', 'organic_search_clicks', 'organic_search_ctr', 'distribution']"],
    ["w?.complete === true && ", ""],
    [".sort((a, b) => (a.week_start < b.week_start ? 1 : -1))", ""],
    ["if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not recorded';", "if (value == null) return '0';"],
    ["`${(value * 100).toLocaleString", "`${(value).toLocaleString"],
    ["canReview: sel?.status === 'current' && sel?.source?.state === 'corrected'", "canReview: sel?.status === 'current'"],
    ["canWithdraw: sel?.status === 'current'", "canWithdraw: true"],
  ]);
});
