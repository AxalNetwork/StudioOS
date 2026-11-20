/**
 * D4815 part 41 (#5904) — the deal's Overview body redrawn to board DE04
 * (canvas section DX4): Scorecard (the strip, Strongest, Needs attention,
 * Changed, Open scorecard; no overall score) beside What's new (material
 * changes, dated); Investment case (summary, thesis fit and reasons, main
 * evidence; the firm's questions and risks; what the scorecard is missing)
 * beside Your position (commitment, firm, route). Each block fails on its own
 * with Try again.
 *
 * Model tests, then the real DealRoomPage mounted with a fetch the test controls.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_deal_overview_5904.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { forgetVisits } from '../src/pages/deal/dealVisit.js';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { stripOf } from '../src/components/scoring/scorecard/scorecardModel.js';
import {
  SCORE_CHANGE_NOT_RECORDED, caseNotes, missingEvidence, scoreSummary, thesisFitOf, whatsNewList, whatsNewOf,
} from '../src/pages/deal/dealFrameModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, instrument: 'Post-money SAFE', closing_deadline: '2026-12-01', description: 'Ledger software for port operators.' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const OWN = { uid: 'c-own', deal_id: 4, investor_user_id: 21, company_id: 501, company_name: 'Alder Ventures', firm_context: 501, in_context: true, amount: 50000, status: 'pending' };

const sc = (scope, state, band, conf) => ({ scope, state, ...(band ? { band, confidence_word: conf } : {}) });
const SCOPES = [
  sc('team', 'scored', 'Strong', 'Medium'), sc('market', 'scored', 'Strong', 'High'), sc('pmf', 'scored', 'Fair', 'High'),
  sc('technical', 'scored', 'Fair', 'Low'), sc('traction', 'scored', 'Weak', 'Low'), sc('financial', 'scored', 'Weak', 'High'),
  sc('risk', 'scored', 'Fair', 'Medium'), sc('geographic', 'not_enough'), sc('political', 'not_expected'),
  sc('governance', 'scored', 'Fair', 'Medium'), sc('legal_ip', 'not_enough'),
];
const open = (scopes) => stripOf({ deal_id: 4, scopes });

// ------------------------------------------------------------------ the model

test('scoreSummary: Strongest and Needs attention from bands and confidence, Changed Not recorded, never a number', () => {
  const s = scoreSummary(open(SCOPES));
  assert.equal(s.state, 'open');
  assert.deepEqual([s.strongest.label, s.strongest.band, s.strongest.confidence], ['Market', 'Strong', 'High confidence'], 'Strong, then the higher confidence');
  assert.deepEqual([s.attention.label, s.attention.band, s.attention.confidence], ['Financial', 'Weak', 'High confidence'], 'Weak, then the surer weakness');
  assert.equal(s.changed.state, 'not_recorded');
  assert.equal(s.changed.line, SCORE_CHANGE_NOT_RECORDED);
  assert.doesNotMatch(JSON.stringify(s), /\b\d{2}\b/, 'no score figure anywhere');
  // Same band and confidence: scope order decides.
  const tie = scoreSummary(open([sc('team', 'scored', 'Fair', 'High'), sc('market', 'scored', 'Fair', 'High'), sc('pmf', 'scored', 'Weak', 'Low'), sc('technical', 'scored', 'Weak', 'Low')]));
  assert.equal(tie.strongest.label, 'Team');
  assert.equal(tie.attention.label, 'Product-market fit');
  // Risk reads in risk words.
  const risk = scoreSummary(open([sc('risk', 'scored', 'Strong', 'High'), sc('team', 'scored', 'Weak', 'High')]));
  assert.equal(risk.strongest.band, 'Low risk');
  // Every scored scope in one band: none stands apart.
  const flat = scoreSummary(open([sc('team', 'scored', 'Fair', 'High'), sc('market', 'scored', 'Fair', 'Low')]));
  assert.equal(flat.attention, null);
  assert.match(flat.line, /every scored scope is Fair/);
  const none = scoreSummary(open([sc('team', 'not_enough'), sc('market', 'not_expected')]));
  assert.equal(none.strongest, null);
  assert.match(none.line, /No scope is scored yet/);
  for (const state of ['closed', 'locked', 'unreadable']) assert.equal(scoreSummary({ state }).state, state);
  assert.equal(scoreSummary(null).state, 'loading');
});

test('missingEvidence: the scopes with not enough recorded, and a closed or unread scorecard says so', () => {
  const m = missingEvidence(open(SCOPES));
  assert.deepEqual(m.labels, ['Geographic', 'Legal and IP']);
  assert.equal(m.line, 'Missing: Geographic, Legal and IP (not enough recorded).');
  assert.equal(missingEvidence(open([sc('team', 'scored', 'Fair', 'High'), sc('political', 'not_expected')])).state, 'none', 'not expected yet is not missing');
  assert.equal(missingEvidence({ state: 'closed' }).state, 'closed');
  assert.equal(missingEvidence({ state: 'locked' }).state, 'closed');
  assert.equal(missingEvidence({ state: 'unreadable' }).state, 'unreadable');
});

test('thesisFitOf: the fit and its reasons, or why there is none', () => {
  const ready = (items) => ({ status: 'ready', data: { items } });
  const fit = thesisFitOf(ready([{ deal_id: 9, score: 10 }, { deal_id: 4, state: 'recorded', score: 67, confidence_label: 'Medium', criteria: [
    { key: 'sector', state: 'match' }, { key: 'stage', state: 'outside' }, { key: 'region', state: 'not_recorded' }, { key: 'ticket', state: 'not_set' }] }]), 4);
  assert.equal(fit.line, 'Fit to my thesis 67 (Medium)');
  assert.deepEqual(fit.reasons, ['Sector matches your thesis', 'Stage is outside your thesis'], 'not set and not recorded are not reasons');
  assert.equal(thesisFitOf(ready([{ deal_id: 4, state: 'not_set', score: null }]), 4).state, 'not_set');
  assert.equal(thesisFitOf(ready([{ deal_id: 4, state: 'not_enough_recorded', score: null }]), 4).state, 'not_enough');
  assert.equal(thesisFitOf(ready([{ deal_id: 4, state: 'unavailable' }]), 4).state, 'unavailable');
  assert.equal(thesisFitOf(ready([]), 4).state, 'unavailable', 'a fit for another deal is never this one\'s');
  assert.equal(thesisFitOf(ready([{ deal_id: 4, state: 'unreadable', reason: 'The fit inputs could not be read.' }]), 4).state, 'unreadable');
  assert.equal(thesisFitOf({ status: 'unreadable' }, 4).state, 'unreadable');
  assert.equal(thesisFitOf({ status: 'loading' }, 4).state, 'loading');
});

test('caseNotes: the firm\'s Question and Risk notes, newest first, first line only, with how many more', () => {
  const r = (items, total = items.length) => ({ status: 'ready', data: { items, total } });
  const n = caseNotes({
    Question: r([{ uid: 'q1', body: 'Unit economics at 50 units?\nMore detail here.', updated_at: '2026-11-10T09:00:00Z' }], 4),
    Risk: r([{ uid: 'r1', body: 'Key-person risk on the CTO', updated_at: '2026-11-12T09:00:00Z' }, { uid: 'r2', body: '   ', updated_at: '2026-11-13T09:00:00Z' }]),
  });
  assert.equal(n.state, 'some');
  assert.deepEqual(n.rows.map((x) => [x.tag, x.text]), [['Risk', 'Key-person risk on the CTO'], ['Question', 'Unit economics at 50 units?']]);
  assert.equal(n.more, 4, 'six tagged notes, two shown');
  assert.equal(caseNotes({ Question: r([]), Risk: r([]) }).state, 'none');
  assert.equal(caseNotes({ Question: r([]), Risk: { status: 'unreadable' } }).state, 'unreadable', 'one failed read is not "none"');
  assert.equal(caseNotes({ Question: { status: 'loading' }, Risk: r([]) }).state, 'loading');
  const long = caseNotes({ Question: r([{ uid: 'q', body: 'x'.repeat(200) }]), Risk: r([]) });
  assert.equal(long.rows[0].text.length, 140);
});

test('whatsNewList: every change the read returns, newest first', () => {
  const w = whatsNewOf({ status: 'ready', data: { since: '2026-11-01T00:00:00Z', changes: [{ type: 'document', at: '2026-11-03T10:00:00Z' }, { type: 'deal', at: '2026-11-05T10:00:00Z' }, { type: 'firm_note', at: '2026-11-04T10:00:00Z' }] } });
  assert.deepEqual(whatsNewList(w).map((r) => r.at), ['2026-11-05', '2026-11-04', '2026-11-03']);
  assert.deepEqual(whatsNewList({ state: 'first' }), []);
  assert.deepEqual(whatsNewList(null), []);
});

// ------------------------------------------------------------------ mounted

async function mounted(url, handler, { user = INVESTOR } = {}) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push(`${(init?.method || 'GET').toUpperCase()} ${String(u)}`); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const Firm = ({ children }) => {
    const [company, setCompany] = React.useState({ id: 501 });
    return h(ActiveCompanyContext.Provider, { value: { company, setCompany, companies: [], setCompanies() {} } }, children);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Firm, null,
    h(Routes, null, h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }), h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) })))))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  return {
    requests, settle, has: (id) => byId(id).length > 0, textOf: (id) => text(byId(id)[0]), propOf: (id, key) => props(byId(id)[0])[key],
    ids: () => walk(container).map((n) => props(n)['data-testid']).filter(Boolean),
    async click(id) { await act(async () => props(byId(id)[0]).onClick?.({ preventDefault() {} })); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

const FIT = { items: [{ deal_id: 4, state: 'recorded', score: 75, confidence_label: 'High', criteria: [{ key: 'sector', state: 'match' }, { key: 'ticket', state: 'outside' }] }] };
function base(over = {}) {
  return (url, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url, m, init); if (r) return r; }
    if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/due-diligence/dd1', kind: 'navigate' }, ic: { state: 'used' } });
    if (/\/api\/deals\/4\/whats-new/.test(url)) return response({ since: '2026-11-01T00:00:00Z', first_visit: false, changes: [{ type: 'document', at: '2026-11-03T10:00:00Z' }, { type: 'diligence_answer', at: '2026-11-09T10:00:00Z' }], unavailable: [] });
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([OWN]);
    if (/\/api\/deals\/4\/notes\?.*tag=Question/.test(url)) return response({ items: [{ uid: 'q1', body: 'Unit economics at 50 units?', updated_at: '2026-11-10T09:00:00Z' }], total: 1 });
    if (/\/api\/deals\/4\/notes\?.*tag=Risk/.test(url)) return response({ items: [{ uid: 'r1', body: 'Key-person risk on the CTO', updated_at: '2026-11-12T09:00:00Z' }], total: 3 });
    if (/\/api\/deals\/4\/notes/.test(url)) return response({ items: [], total: 0 });
    if (/\/api\/deals\/fit\?ids=4$/.test(url)) return response(FIT);
    if (/\/venture-scores\/batch/.test(url)) return response({ items: [{ deal_id: 4, scopes: SCOPES }] });
    if (/\/networkfx\/syndicates/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}

test('mounted, an investor at /deals/4: DE04\'s four blocks in order, each from its read', async () => {
  const v = await mounted('/deals/4', base());
  try {
    const order = v.ids().filter((id) => ['deal-score-slot', 'deal-whats-new', 'deal-case', 'deal-position'].includes(id));
    assert.deepEqual(order, ['deal-score-slot', 'deal-whats-new', 'deal-case', 'deal-position'], 'Scorecard, What\'s new, Investment case, Your position');
    // Scorecard.
    assert.equal(v.textOf('deal-score-strongest'), 'StrongestMarket · StrongHigh confidence');
    assert.equal(v.textOf('deal-score-attention'), 'Needs attentionFinancial · WeakHigh confidence');
    assert.match(v.textOf('deal-score-changed'), /Not recorded.*no change since your last visit/);
    assert.equal(v.propOf('deal-score-open', 'href'), '/deals/4/scorecard');
    assert.match(v.textOf('deal-score-open'), /^Open scorecard$/);
    assert.doesNotMatch(v.textOf('deal-score-slot'), /overall/i, 'no overall score');
    // What's new: dated, newest first.
    assert.match(v.textOf('deal-whats-new-list'), /^2026-11-09The founder answered a diligence request2026-11-03A document was added$/);
    assert.equal(v.textOf('deal-whats-new-since'), 'Since 2026-11-01');
    // Investment case.
    assert.equal(v.textOf('deal-case-summary'), 'Ledger software for port operators.');
    assert.equal(v.textOf('deal-overview').split('Ledger software for port operators.').length - 1, 1, 'the summary is drawn once, in the case');
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75 \(High\)Sector matches your thesisTicket is outside your thesis$/);
    assert.equal(v.propOf('deal-case-evidence', 'children')[1].props.to, '/deals/4/evidence');
    assert.match(v.textOf('deal-case-notes'), /^Risk: Key-person risk on the CTOQuestion: Unit economics at 50 units\?$/);
    assert.equal(v.textOf('deal-case-notes-more'), '2 more in Firm notes', 'D6164 part 3: the notes are Activity\'s Firm notes');
    assert.equal(v.textOf('deal-case-missing'), 'Missing: Geographic, Legal and IP (not enough recorded).');
    // Your position, with the route the read does not carry.
    assert.match(v.textOf('deal-position-amount'), /\$50,000 · Pending/);
    assert.equal(v.textOf('deal-position-route'), 'Not recorded');
    assert.ok(v.requests.some((r) => /GET .*\/api\/deals\/fit\?ids=4$/.test(r)));
    assert.ok(!v.requests.some((r) => /\/api\/deals\/4\/evidence/.test(r)), 'the Overview never reads the evidence: that read logs an open');
  } finally { await v.close(); }
});

test('mounted, each block fails on its own with Try again, and Try again reads only that block again', async () => {
  let fitCalls = 0; let riskCalls = 0;
  const v = await mounted('/deals/4', base({
    'deals/fit': () => { fitCalls += 1; return fitCalls === 1 ? response({ error: 'x' }, 503) : response(FIT); },
    'notes\\?.*tag=Risk': () => { riskCalls += 1; return riskCalls === 1 ? response({ error: 'x' }, 503) : response({ items: [], total: 0 }); },
    'whats-new': () => response({ error: 'x' }, 503),
  }));
  try {
    assert.match(v.textOf('deal-case-fit'), /could not be read\. That is not a claim that it does not fit\./);
    assert.match(v.textOf('deal-case-open'), /could not be read\. That is not a claim that there are none\./);
    assert.ok(!v.has('deal-case-notes-none'), 'a failed read is never "none"');
    assert.match(v.textOf('deal-whats-new'), /could not be read/);
    // The rest stands.
    assert.equal(v.textOf('deal-score-strongest'), 'StrongestMarket · StrongHigh confidence');
    assert.equal(v.textOf('deal-case-summary'), 'Ledger software for port operators.');
    assert.match(v.textOf('deal-position-amount'), /\$50,000/);
    const questions = v.requests.filter((r) => /tag=Question/.test(r)).length;
    await v.click('deal-case-fit-retry');
    assert.equal(fitCalls, 2);
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75/);
    await v.click('deal-case-notes-retry');
    assert.equal(riskCalls, 2);
    assert.equal(v.requests.filter((r) => /tag=Question/.test(r)).length, questions, 'the Question read that landed is not read again');
    assert.match(v.textOf('deal-case-notes'), /Question: Unit economics/);
  } finally { await v.close(); }
});

test('mounted, a failed scorecard read: the summary and Missing say so and Try again reads it again', async () => {
  let calls = 0;
  const v = await mounted('/deals/4', base({ 'venture-scores/batch': () => { calls += 1; return calls === 1 ? response({ error: 'x' }, 503) : response({ items: [{ deal_id: 4, scopes: SCOPES }] }); } }));
  try {
    assert.match(v.textOf('deal-score-slot'), /could not be read/);
    assert.ok(!v.has('deal-score-summary'));
    assert.equal(v.textOf('deal-case-missing'), 'What the scorecard is missing could not be read.Try again');
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75/, 'the fit stands');
    await v.click('deal-case-missing-retry');
    assert.equal(calls, 2);
    assert.equal(v.textOf('deal-case-missing'), 'Missing: Geographic, Legal and IP (not enough recorded).');
    assert.ok(v.has('deal-score-summary'));
  } finally { await v.close(); }
});

test('mounted, nothing to show: no notes, no fit thesis, a closed scorecard, a first visit; no commitment is "none", not unreadable', async () => {
  const v = await mounted('/deals/4', base({
    'notes\\?': () => response({ items: [], total: 0 }),
    'deals/fit': () => response({ items: [{ deal_id: 4, state: 'not_set', score: null }] }),
    'venture-scores/batch': () => response({ items: [], not_readable: 1 }),
    'whats-new': () => response({ first_visit: true, changes: [] }),
    'deals/4/commitments': () => response([]),
    '/api/deals/4(\\?|$)': () => response({ ...DEAL, description: '' }),
  }));
  try {
    assert.match(v.textOf('deal-case-notes-none'), /No note at your firm is tagged Question or Risk/);
    assert.equal(v.textOf('deal-case-fit'), 'Set your thesis to see how this deal fits it.');
    assert.equal(v.textOf('deal-case-summary'), 'No summary is recorded on this deal.');
    assert.equal(v.textOf('deal-case-missing'), 'The scorecard is not open to you, so what is missing is not read here.');
    assert.match(v.textOf('deal-score-slot'), /opens once you are invited/);
    assert.ok(!v.has('deal-score-summary') && !v.has('deal-score-open'));
    assert.match(v.textOf('deal-whats-new'), /first look/);
    assert.ok(v.has('deal-position-none'));
  } finally { await v.close(); }
});

test('mounted, an Admin: the scorecard and the deal\'s details, and none of the investor\'s blocks or reads', async () => {
  const v = await mounted('/deals/4', base(), { user: { id: 1, role: 'admin', name: 'Ops', email: 'ops@example.com' } });
  try {
    assert.ok(v.has('deal-score-slot') && v.has('deal-details'));
    for (const id of ['deal-whats-new', 'deal-case', 'deal-position']) assert.ok(!v.has(id), id);
    assert.ok(!v.requests.some((r) => /deals\/fit|\/notes|whats-new/.test(r)), 'no investor read is made for staff');
  } finally { await v.close(); }
});

// ------------------------------------------------------------------ the record

test('the part file names each block\'s read and the gaps it leaves, and the old layout is gone', () => {
  const f = 'documentation/architecture/decisions/D4815-p41.md';
  assert.ok(existsSync(f));
  const d = readFileSync(f, 'utf8');
  assert.match(d, /^## D4815 part 41 — /m);
  for (const s of ['#6173', 'deal_seen', 'open_evidence', 'Question', 'Risk', 'Route', 'Not recorded', 'Try again']) assert.ok(d.includes(s), s);
  const src = readFileSync('frontend/src/pages/deal/DealOverview.jsx', 'utf8');
  assert.doesNotMatch(src, /DealScoreStrip/, 'the Overview draws its own summary on the shared strip read');
});
