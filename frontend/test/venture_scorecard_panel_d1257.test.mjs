/**
 * D1257 (#3280, part 4 of #2428) — the scorecard panel and its drawers live
 * (SC1–SC5, SC22), the strip fed by the batch on Deal flow and the deal's
 * Overview (SC6, DL24a), and the states (SC15–SC18), phone (SC19) and dark
 * (SC20). The rules are `scorecardModel.js`'s; the drawing is mounted on a
 * stubbed `fetch`, so every read goes through the real client to a URL.
 *
 * A missing scope is never a bar of zero, and a locked strip draws no bar.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/venture_scorecard_panel_d1257.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import VentureScorecard, { DealScoreStrip, DealStrip, ScopeStrip } from '../src/components/scoring/scorecard/Scorecard.jsx';
import DealFlow, { DealsTableView } from '../src/pages/investor/dealflow/DealFlow.jsx';
import { dealRow } from '../src/pages/investor/dealflow/dealFlowModel.js';
import {
  BAND_HEIGHT, BATCH_MAX, SCOPES, barText, bandWord, batches, gradeMix, inputOf, panelOf, reviewText, scopeOf, scopesOf, stripBar, stripOf,
} from '../src/components/scoring/scorecard/scorecardModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/* ------------------------------------------------------------------ *
 * Fixtures: what part 3's routes return (D1256 §1), synthetic only
 * ------------------------------------------------------------------ */

const AT = '2026-10-27T09:40:00Z';
const TEAM_INPUTS = [
  { key: 'function_coverage', label: 'Function coverage', personal: true, shown: false, state: 'recorded', band: 'Fair', note: 'Counted, not shown' },
  { key: 'build_evidence', label: 'Build evidence', personal: false, shown: true, state: 'recorded', value: 80, grade: 'measured', as_of: '2026-10-20', words: '212 commits in 90 days.', reason: null, weight: 20, contribution: 16, stale: false },
  { key: 'experience', label: 'Experience linked to skills', personal: false, shown: true, state: 'not_recorded', value: null, grade: 'not_recorded', as_of: null, words: 'Not recorded', reason: 'No experience entry is linked to a skill yet.', weight: 15, contribution: null, stale: false },
  { key: 'spinout_terms', label: 'Spin-out terms', personal: false, shown: true, state: 'not_applicable', value: null, grade: 'not_recorded', as_of: null, words: '', reason: 'Not a spin-out.', weight: 10, contribution: null, stale: false },
  { key: 'archetype_mix', label: 'Archetype mix', personal: false, shown: true, state: 'recorded', value: 60, grade: 'stated', as_of: '2026-04-01', words: 'Builder and Operator.', reason: null, weight: 10, contribution: 6, stale: true },
];
const PMF_INPUTS = [
  { key: 'icp_interviews', label: 'ICP interviews held', group: 'who', personal: false, shown: true, state: 'recorded', value: 70, grade: 'measured', as_of: '2026-10-10', words: '14 interviews.', weight: 10, contribution: 7 },
  { key: 'pain_frequency', label: 'Pain frequency', group: 'problem', personal: false, shown: true, state: 'recorded', value: 100, grade: 'measured', as_of: '2026-10-10', words: '10 of 14 name the top pain.', weight: 10, contribution: 10 },
];
const scored = (scope, value, band, word, extra = {}) => ({ scope, state: 'scored', value, band, confidence_word: word, confidence: 0.6, coverage: 0.8, model: '1.0', computed_at: AT, masked: false, review: null, inputs: [], ...extra });
const OPEN = {
  project_id: 7, deal_id: 4, locked: false, nda: true, model: '1.0', masked_reason: null,
  scopes: [
    scored('team', 62, 'Fair', 'Medium', { inputs: TEAM_INPUTS, review: { adjustment: 5, reason: 'Third founder joined last week.', reviewer: 'Operating Partner' } }),
    scored('market', 74, 'Strong', 'High'),
    scored('pmf', 64, 'Fair', 'Medium', { inputs: PMF_INPUTS }),
    scored('technical', 55, 'Fair', 'Medium'),
    scored('traction', 31, 'Weak', 'Medium'),
    scored('financial', 58, 'Fair', 'Low'),
    scored('risk', 51, 'Fair', 'Medium'),
    { scope: 'geographic', state: 'not_enough', band: null, confidence_word: null, value: null, coverage: 0, masked: false, review: null, inputs: [] },
    { scope: 'political', state: 'not_expected', band: null, confidence_word: null, value: null, masked: false, review: null, inputs: [] },
    scored('governance', 81, 'Strong', 'High'),
    { scope: 'legal_ip', state: 'not_read', masked: false, review: null, inputs: [] },
  ],
};
const MASKED = {
  project_id: 7, deal_id: 4, locked: false, nda: false, model: '1.0', masked_reason: 'Sign the NDA with this venture to see its inputs.',
  scopes: OPEN.scopes.map((s) => ({ scope: s.scope, state: s.state, band: s.band ?? null, confidence_word: s.confidence_word ?? null, masked: true, review: null })),
};
const strip = (dealId, extra = {}) => ({ deal_id: dealId, project_id: 70 + dealId, locked: false, scopes: OPEN.scopes.map((s) => ({ scope: s.scope, state: s.state, band: s.band ?? null, confidence_word: s.confidence_word ?? null })), ...extra });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a scope from the Worker: confidence word, band, coverage from the inputs; never-stored is Not scored yet', () => {
  const team = scopeOf(OPEN.scopes[0]);
  assert.equal(team.key, 'team');
  assert.equal(team.confidence, 'medium');
  assert.equal(team.value, 62);
  assert.deepEqual(team.coverage, { present: 3, of: 4 }, 'recorded (a personal one too) of those that apply; Spin-out terms is out');
  assert.equal(scopeOf(OPEN.scopes[10]).state, 'not_scored');
  assert.equal(scopeOf(undefined, 'team').state, 'not_read');
  const noWord = scopeOf({ scope: 'team', state: 'scored', value: 40, band: 'Fair', confidence_word: null });
  assert.equal(stripBar(noWord).kind, 'dashed', 'a value with no confidence is never a bar');
  assert.equal(scopeOf({ scope: 'team', state: 'not_enough', value: 0, band: 'Weak', confidence_word: 'Low' }).value, null, 'not enough carries no number, even a 0');
  assert.equal(scopesOf([OPEN.scopes[3], OPEN.scopes[0]]).map((s) => s.key).join(), SCOPES.map((s) => s.key).join(), 'the one order, whatever the Worker sent');
  assert.equal(scopesOf([OPEN.scopes[0]])[1].state, 'not_read', 'a scope the Worker did not send is unread, not empty');
});

test('the strip with no number: the band sets the height; a missing scope is never a bar of zero', () => {
  assert.deepEqual(BAND_HEIGHT, { Strong: 17, Fair: 11, Weak: 4 });
  assert.deepEqual(stripBar(scopeOf({ scope: 'team', state: 'scored', band: 'Strong', confidence_word: 'High' })), { kind: 'bar', height: 17, opacity: 1 });
  assert.deepEqual(stripBar(scopeOf({ scope: 'team', state: 'scored', band: 'Weak', confidence_word: 'Low' })), { kind: 'bar', height: 4, opacity: 0.3 });
  for (const raw of [{ state: 'not_enough' }, { state: 'not_expected' }, { state: 'unreadable' }, { state: 'not_read' }, undefined]) {
    const b = stripBar(scopeOf(raw && { scope: 'team', ...raw }, 'team'));
    assert.notEqual(b.kind, 'bar', JSON.stringify(raw));
    assert.equal(b.height, undefined);
  }
  assert.equal(stripBar(scopeOf({ scope: 'team', state: 'unreadable' })).kind, 'unreadable');
  assert.equal(stripBar({ key: 'team', state: 'scored', confidence: 'high', value: null, band: null }).kind, 'dashed', 'no number and no band is never a bar');
  assert.equal(scopeOf({ scope: 'team', state: 'not_enough', confidence_word: 'Low', band: 'Weak' }).confidence, null, 'not enough carries no confidence');
  assert.equal(scopeOf({ scope: 'team', state: 'not_enough', confidence_word: 'Low', band: 'Weak' }).band, null, 'nor a band');
  assert.equal(barText(scopeOf({ scope: 'risk', state: 'scored', band: 'Strong', confidence_word: 'High' })), 'Risk: Low risk, high confidence');
  assert.equal(barText(scopeOf({ scope: 'traction', state: 'unreadable' })), 'Traction: Could not be read');
  assert.equal(barText(scopeOf({ scope: 'team', state: 'not_read' })), 'Team: Not scored yet');
});

test('the batch row: locked and closed draw no bar; ids go 200 a call', () => {
  assert.equal(stripOf(undefined).state, 'closed');
  assert.equal(stripOf({ deal_id: 1, locked: true, reason: 'x' }).state, 'locked');
  assert.equal(stripOf({ deal_id: 1, locked: false, unreadable: true }).state, 'unreadable');
  assert.equal(stripOf(strip(1)).scopes.length, 11);
  assert.equal(BATCH_MAX, 200);
  const ids = Array.from({ length: 401 }, (_, i) => String(i + 1));
  assert.deepEqual(batches(ids).map((b) => b.length), [200, 200, 1]);
  assert.deepEqual(batches(['3', '3', 'x', '-1', '0']), [[3]], 'one call per id, and no id that is not a deal');
});

test('the panel states: loading, refused, not found, unreadable, locked, masked, open', () => {
  assert.equal(panelOf({ status: 'loading' }).state, 'loading');
  assert.equal(panelOf({ status: 'error', error: { status: 403, code: 'not_on_deal' } }).state, 'not_on_deal');
  assert.equal(panelOf({ status: 'error', error: { status: 403, code: 'no_access' } }).state, 'no_access');
  assert.equal(panelOf({ status: 'error', error: { status: 404 } }).state, 'not_found');
  assert.equal(panelOf({ status: 'error', error: { status: 503, code: 'scorecard_unreadable' } }).state, 'unreadable');
  assert.equal(panelOf({ status: 'ready', data: { locked: true, reason: 'Off.' } }).reason, 'Off.');
  const masked = panelOf({ status: 'ready', data: MASKED });
  assert.equal(masked.state, 'masked');
  assert.equal(masked.rests, null, 'nothing is counted from inputs a masked read does not carry');
  const open = panelOf({ status: 'ready', data: { ...OPEN, scopes: OPEN.scopes.map((s) => (s.scope === 'traction' ? { scope: 'traction', state: 'unreadable' } : s)) } });
  assert.equal(open.state, 'open');
  assert.deepEqual(open.unreadable, ['traction']);
  assert.equal(open.computed_at, AT);
  assert.deepEqual(open.rests, { measured: 3, reviewed: 0, sourced: 0, stated: 1, not_recorded: 1 });
});

test('inputs: a personal input is a band, never its figure; missing counts as Not recorded; out is out', () => {
  const [personal, built, missing, out, stale] = TEAM_INPUTS.map(inputOf);
  assert.equal(personal.kind, 'counted');
  assert.equal(personal.value, null);
  assert.equal(personal.words, null);
  assert.equal(personal.grade, null);
  assert.equal(inputOf({ ...TEAM_INPUTS[0], value: 77, words: 'secret' }).value, null, 'a personal figure that reached the page is still not drawn');
  assert.equal(built.kind, 'value');
  assert.equal(built.contribution, 16);
  assert.equal(missing.kind, 'missing');
  assert.equal(missing.value, null);
  assert.equal(out.kind, 'out');
  assert.ok(stale.stale);
  assert.deepEqual(gradeMix([personal, built, missing, out, stale]), { measured: 1, reviewed: 0, sourced: 0, stated: 1, not_recorded: 1 });
  assert.equal(bandWord('Weak', 'risk'), 'High risk');
  assert.equal(bandWord('Weak', 'team'), 'Weak');
  assert.equal(reviewText({ adjustment: -4, reason: 'One pilot churned.', reviewer: 'Admin' }), 'Reviewed by Admin: −4 points. One pilot churned.');
  assert.equal(reviewText({ adjustment: 0, note: 'Checked.', reviewer: 'Operating Partner' }), 'Note from Operating Partner: Checked.');
  assert.equal(reviewText(null), null);
});

/* ------------------------------------------------------------------ *
 * Mounted on a stubbed fetch
 * ------------------------------------------------------------------ */

async function mount(el, { deal = () => OPEN, batch = (ids) => ({ items: ids.map((id) => strip(id)), not_readable: 0 }), phone = false, path = '/deals/4/scorecard' } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (u, init = {}) => {
    const p = new URL(String(u), 'http://x').pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || 'GET', path: p, body });
    if (p === '/api/client-error') return json({});
    if (p === '/api/venture-scores/deal/4') { const r = deal(); return r instanceof Response ? r : json(r); }
    if (p === '/api/deals') return json([{ id: 4, project_name: 'Acme', status: 'active' }, { id: 5, project_name: 'Bluefern', status: 'active' }]);
    if (p === '/api/venture-scores/batch') { const r = batch(body.deal_ids); return r instanceof Response ? r : json(r); }
    return json({ detail: 'Not found' }, 404);
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, el)));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const all = () => walk(container);
  return {
    calls, by, props, all, text, has: (id) => Boolean(by(id)),
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    page: () => text(container).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const panel = (extra = {}) => h(VentureScorecard, { dealId: 4, ndaHref: '/deals/4/documents', ...extra });
const styleOf = (v, n) => v.props(n).style || {};

test('SC1: the open read draws each scope, the chart and what it rests on; no missing scope is a zero', async () => {
  const v = await mount(panel());
  try {
    assert.deepEqual(v.calls.filter((c) => c.path.startsWith('/api/venture-scores')).map((c) => `${c.method} ${c.path}`), ['GET /api/venture-scores/deal/4']);
    assert.match(v.of('scorecard-model'), /Model v ?1\.0/);
    assert.match(v.of('scorecard-computed'), /27 Oct 2026, 09:40/);
    assert.match(v.of('scorecard-scope-team'), /Team.*Fair.*62/);
    assert.match(v.of('scorecard-scope-team'), /Reviewed by Operating Partner: \+5 points/);
    assert.match(v.of('scorecard-scope-risk'), /Medium risk/, 'Risk reads as a risk word');
    assert.match(v.of('scorecard-scope-geographic'), /Not enough recorded/);
    assert.match(v.of('scorecard-scope-political'), /Not expected yet/);
    assert.match(v.of('scorecard-scope-legal_ip'), /Not scored yet/);
    for (const k of ['geographic', 'political', 'legal_ip']) {
      assert.doesNotMatch(v.of(`scorecard-scope-${k}`), /(^|\s)0(\s|$)/, `${k} draws no zero`);
      const bars = v.all().filter((n) => styleOf(v, n).width === '0%');
      assert.equal(bars.length, 0, 'no bar of zero anywhere');
    }
    assert.match(v.of('scorecard-glance'), /Governance 81/);
    assert.match(v.of('scorecard-glance'), /Geographic Not enough/);
    assert.match(v.of('scorecard-rests'), /5 inputs across eleven scopes/);
    assert.match(v.of('scorecard-rests'), /Measured .* 3/);
    assert.equal(v.has('scorecard-masked'), false);
  } finally { await v.close(); }
});

test('SC2, SC22: a scope opens its drawer with inputs, grades, dates and points; a personal input is counted, not shown', async () => {
  const v = await mount(panel());
  try {
    await v.click('scorecard-scope-team');
    assert.ok(v.has('scorecard-drawer-team'));
    assert.match(v.of('scorecard-input-build_evidence'), /Build evidence 80 16\.0 pts 212 commits in 90 days\. Measured as of 2026-10-20 weight 20 ?%/);
    assert.match(v.of('scorecard-input-function_coverage'), /Counted, not shown/);
    assert.doesNotMatch(v.of('scorecard-input-function_coverage'), /\d/, 'no figure for a personal input');
    assert.match(v.of('scorecard-input-experience'), /— Not recorded · lowers confidence ?\. No experience entry is linked/);
    assert.match(v.of('scorecard-input-spinout_terms'), /Does not apply here.*Not a spin-out/);
    assert.match(v.of('scorecard-input-archetype_mix'), /Stated Stale/);
    assert.match(v.of('scorecard-review'), /Third founder joined last week\. The computed value stays/);
    assert.match(v.of('scorecard-drawer-team'), /Individual skills and values are never shown/);
    await v.close();
    const p = await mount(panel());
    await p.click('scorecard-scope-pmf');
    const d = p.of('scorecard-drawer-pmf');
    assert.ok(d.indexOf('Who you heard from') < d.indexOf('ICP interviews held') && d.indexOf('The problem') < d.indexOf('Pain frequency'), 'PMF in its groups');
    await p.close();
  } catch (e) { await v.close().catch(() => {}); throw e; }
});

test('SC16: one scope unreadable leaves the others standing, and Try again reads again', async () => {
  let n = 0;
  const v = await mount(panel(), { deal: () => { n += 1; return { ...OPEN, scopes: OPEN.scopes.map((s) => (s.scope === 'traction' && n === 1 ? { scope: 'traction', state: 'unreadable' } : s)) }; } });
  try {
    assert.match(v.of('scorecard-scope-traction'), /Traction could not be read\. The other scopes are current\./);
    assert.match(v.of('scorecard-scope-team'), /62/);
    await v.click('scorecard-retry-traction');
    assert.equal(v.calls.filter((c) => c.path === '/api/venture-scores/deal/4').length, 2);
    assert.match(v.of('scorecard-scope-traction'), /Weak.*31/);
  } finally { await v.close(); }
});

test('SC18: masked before the NDA shows bands and confidence, the NDA door, and no value or input', async () => {
  const v = await mount(panel(), { deal: () => MASKED });
  try {
    assert.match(v.of('scorecard-masked'), /Sign the NDA with this venture to see inputs\. Bands and confidence show now\./);
    assert.equal(v.props(v.by('scorecard-nda')).href, '/deals/4/documents');
    assert.match(v.of('scorecard-scope-team'), /Team Fair ⊘ After the NDA Medium/);
    assert.doesNotMatch(v.page(), /\b62\b|\b81\b/, 'no value is drawn');
    assert.equal(v.has('scorecard-glance'), false);
    assert.equal(v.has('scorecard-rests'), false);
    assert.match(v.of('scorecard-after-nda'), /Every input with its grade and date/);
    await v.click('scorecard-scope-team');
    assert.equal(v.has('scorecard-drawer-team'), false, 'a masked row opens nothing');
  } finally { await v.close(); }
});

test('SC17 and the rest: off the deal, no access, unreadable with Retry, locked — never a scope of zero', async () => {
  const refuse = (status, code) => () => new Response(JSON.stringify({ code, detail: 'x' }), { status, headers: { 'Content-Type': 'application/json' } });
  for (const [deal, id, words] of [
    [refuse(403, 'not_on_deal'), 'scorecard-not-on-deal', /opens when this venture is in your deal flow/],
    [refuse(403, 'no_access'), 'scorecard-no-access', /Scorecards are for investors, founders and studio staff/],
    [refuse(503, 'scorecard_unreadable'), 'scorecard-unreadable', /The scorecard could not be read\. That is not a score of zero\./],
    [() => ({ project_id: 7, deal_id: 4, locked: true, reason: 'The founder has not shared this scorecard with investors.' }), 'scorecard-locked', /The founder has not shared this scorecard with investors\./],
  ]) {
    const v = await mount(panel(), { deal });
    try {
      assert.match(v.of(id), words);
      assert.equal(v.has('scorecard-scope-team'), false, `${id} draws no scope`);
      assert.equal(v.has('scope-strip'), false);
    } finally { await v.close(); }
  }
  const u = await mount(panel(), { deal: refuse(503, 'scorecard_unreadable') });
  try {
    const retry = u.all().find((n) => u.props(n).onClick && /Retry/.test(u.text(n)));
    assert.ok(retry, 'Retry is offered');
    await act(async () => { u.props(retry).onClick(); });
    assert.equal(u.calls.filter((c) => c.path === '/api/venture-scores/deal/4').length, 2);
  } finally { await u.close(); }
});

test('SC15: before the read lands the panel is its shape and "Reading…", with no number', () => {
  const out = html(panel());
  assert.ok(out.includes('data-testid="scorecard-loading"') && out.includes('Reading…'));
  assert.ok(!/>\s*\d+\s*</.test(out), 'no figure while reading');
  const founder = html(h(VentureScorecard, { audience: 'founder', dealId: 4 }));
  assert.ok(founder.includes('data-testid="scorecard-wait-founder"') && !founder.includes('scorecard-loading'), 'the founder’s page is part 5’s');
});

test('SC6: Deal flow’s strips come from one batch; locked and closed rows draw no bar', async () => {
  const rows = [dealRow({ id: 4, project_name: 'Acme', status: 'active' }), dealRow({ id: 5, project_name: 'Bluefern', status: 'active' }), dealRow({ id: 6, project_name: 'Cobalt', status: 'active' })];
  const items = new Map([[4, strip(4)], [5, strip(5, { locked: true, scopes: undefined, reason: 'The founder has not shared this scorecard with investors.' })]]);
  const out = html(h(DealsTableView, { rows, scope: 'mine', strips: { status: 'ready', items } }));
  const row = (id) => out.slice(out.indexOf(`dealflow-row-${id}`), out.indexOf('</tr>', out.indexOf(`dealflow-row-${id}`)));
  assert.ok(row(4).includes('data-testid="scope-strip"') && row(4).includes(`height:${BAND_HEIGHT.Fair}px`));
  assert.ok(row(4).includes('aria-label="Team: Fair, medium confidence;'), 'each bar reads as text');
  for (const id of [5, 6]) {
    assert.ok(row(id).includes('data-testid="scope-strip-locked"'), `row ${id} is locked`);
    assert.ok(!row(id).includes('height:'), `row ${id} draws no bar`);
  }
  assert.ok(row(5).includes('Scorecard locked: The founder has not shared'));
  assert.ok(row(6).includes('Scorecard locked: not open to you'));
  const failed = html(h(DealsTableView, { rows, scope: 'mine', strips: { status: 'error', items: new Map(), error: { status: 503 }, retry() {} } }));
  assert.ok(failed.includes('The scorecards could not be read') && !failed.includes('height:'));
  assert.ok(html(h(DealStrip, { read: { status: 'ready', items: new Map([[4, { deal_id: 4, unreadable: true }]]) }, dealId: '4' })).includes('Could not be read'));
  const locked = html(h(ScopeStrip, { locked: true, scopes: OPEN.scopes.map(scopeOf) }));
  assert.ok(!locked.includes('height:') && !locked.includes('title="Team'), 'a locked strip draws and says nothing per scope');
});

test('SC6 mounted: Deal flow’s table reads its deals, then one batch for their ids', async () => {
  const v = await mount(h(DealFlow, { view: 'table', scope: 'mine' }), { path: '/deals?view=table', batch: (ids) => ({ items: [strip(ids[0])], not_readable: ids.length - 1 }) });
  try {
    const calls = v.calls.filter((c) => c.path === '/api/venture-scores/batch');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { deal_ids: [4, 5] });
    const four = v.by('dealflow-row-4'); const five = v.by('dealflow-row-5');
    assert.match(v.text(four), /Acme/);
    assert.ok(v.all().some((n) => v.props(n)['data-testid'] === 'scope-strip'), 'the readable deal draws its strip');
    assert.ok(v.all().some((n) => v.props(n)['data-testid'] === 'scope-strip-locked'), 'the deal the batch left out is locked');
    assert.ok(five);
  } finally { await v.close(); }
});

test('DL24a: the deal’s Overview reads its one strip through the batch, and opens the scorecard', async () => {
  const v = await mount(h(DealScoreStrip, { dealId: 4 }), { path: '/deals/4' });
  try {
    const call = v.calls.find((c) => c.path === '/api/venture-scores/batch');
    assert.deepEqual(call.body, { deal_ids: [4] });
    assert.ok(v.has('scope-strip'));
    assert.equal(v.props(v.by('deal-score-open')).href, '/deals/4/scorecard');
  } finally { await v.close(); }
  const closed = await mount(h(DealScoreStrip, { dealId: 4 }), { batch: () => ({ items: [], not_readable: 1 }) });
  try {
    assert.ok(closed.has('scope-strip-locked'));
    assert.match(closed.of('deal-score-slot'), /opens once you are invited to this deal/);
    assert.equal(closed.has('deal-score-open'), false);
  } finally { await closed.close(); }
  const founder = await mount(h(DealScoreStrip, { dealId: 4 }), { batch: () => new Response(JSON.stringify({ code: 'no_access', detail: 'x' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) });
  try { assert.match(founder.of('deal-score-strip-refused'), /for investors and studio staff/); } finally { await founder.close(); }
});

test('SC19: on a phone each row is a 44px target with four columns, and the drawer is a bottom sheet', async () => {
  const v = await mount(panel(), { phone: true });
  try {
    const row = v.by('scorecard-scope-team');
    assert.match(v.props(row).className, /min-h-\[44px\]/);
    assert.match(v.props(row).className, /grid-cols-\[minmax\(0,1fr\)_auto_36px_14px\] .*sm:grid-cols-/);
    await v.click('scorecard-scope-team');
    assert.equal(v.props(v.by('scorecard-drawer-team-layer'))['data-phone'], 'sheet');
  } finally { await v.close(); }
});

test('SC20: every surface of the panel and the strip carries its dark pair', () => {
  const src = readFileSync('frontend/src/components/scoring/scorecard/Scorecard.jsx', 'utf8');
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const cls = m[1] ?? m[2];
    if (/(?<![:\w-])bg-(white|violet-50|red-50|amber-50|emerald-50)\b/.test(cls)) assert.match(cls, /dark:bg-/, cls);
    if (/(?<![:\w-])text-axal-ink\b/.test(cls)) assert.match(cls, /dark:text-/, cls);
  }
  for (const k of ['CARD', 'BTN']) assert.match(src.match(new RegExp(`const ${k} = '([^']*)'`))[1], /dark:bg-gray-900/, k);
});
