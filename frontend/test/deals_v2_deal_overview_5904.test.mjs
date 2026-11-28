/**
 * D4815 part 41 (#5904) — the deal's Overview body redrawn to board DE04
 * (canvas section DX4): Scorecard (the strip, Strongest, Needs attention,
 * Changed, Open scorecard; no overall score) beside What's new (material
 * changes, dated); Investment case (summary, thesis fit and reasons, main
 * evidence; the firm's questions and risks; what the scorecard is missing;
 * one case read since D9109) beside Your position (commitment, firm, route). Each block fails on its own
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
  SCORE_CHANGE_NOT_RECORDED, scoreSummary, whatsNewList, whatsNewOf,
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

// The Investment case's model (`caseView`, D9109) is held by deal_investment_case_9109.test.mjs.

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
    async clickButton(id, label) { const b = walk(byId(id)[0]).find((n) => n.tagName === 'BUTTON' && text(n).trim() === label); await act(async () => props(b).onClick?.({ preventDefault() {} })); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

// D9109: the Investment case is one read, `GET /api/deals/4/case` (D6173).
const CASE = {
  deal_id: 4,
  thesis_fit: { state: 'recorded', fit: { state: 'recorded', score: 75, confidence_label: 'High', criteria: [{ key: 'sector', state: 'match' }, { key: 'ticket', state: 'outside' }] } },
  main_evidence: { state: 'recorded', partial: false, groups: [{ area: 'Capital model', kind: 'revenue-receipt', source_label: 'connector', count: 3, newest: '2026-11-03T10:00:00Z' }] },
  open_questions: { state: 'recorded', items: [
    { uid: 'r1', tag: 'risk', body: 'Key-person risk on the CTO', created_at: '2026-11-12T09:00:00Z' },
    { uid: 'q1', tag: 'question', body: 'Unit economics at 50 units?', created_at: '2026-11-10T09:00:00Z' },
    { uid: 'r2', tag: 'risk', body: 'Supplier concentration', created_at: '2026-11-09T09:00:00Z' },
    { uid: 'r3', tag: 'risk', body: 'Long sales cycle', created_at: '2026-11-08T09:00:00Z' },
    { uid: 'q2', tag: 'question', body: 'Who owns the firmware?', created_at: '2026-11-07T09:00:00Z' },
  ] },
  missing: { state: 'recorded', threshold: 0.5, scopes: [{ scope: 'geographic', label: 'Geographic', state: 'not_enough', coverage: null }, { scope: 'legal_ip', label: 'Legal and IP', state: 'not_enough', coverage: null }] },
};
function base(over = {}) {
  return (url, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url, m, init); if (r) return r; }
    if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/due-diligence/dd1', kind: 'navigate' }, ic: { state: 'used' } });
    if (/\/api\/deals\/4\/whats-new/.test(url)) return response({ since: '2026-11-01T00:00:00Z', first_visit: false, changes: [{ type: 'document', at: '2026-11-03T10:00:00Z' }, { type: 'diligence_answer', at: '2026-11-09T10:00:00Z' }], unavailable: [] });
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([OWN]);
    if (/\/api\/deals\/4\/case$/.test(url)) return response(CASE);
    if (/\/api\/deals\/4\/notes/.test(url)) return response({ items: [], total: 0 });
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
    assert.equal(v.textOf('deal-case-evidence-list'), 'Capital model · Revenue receipt · 3 · newest 3 Nov 2026', 'D9109: the main evidence as counts');
    assert.equal(v.propOf('deal-case-evidence', 'children').at(-1).props.to, '/deals/4/evidence');
    assert.match(v.textOf('deal-case-notes'), /^Risk: Key-person risk on the CTOQuestion: Unit economics at 50 units\?Risk: Supplier concentration$/);
    assert.equal(v.textOf('deal-case-notes-more'), '2 more in Firm notes', 'D6164 part 3: the notes are Activity\'s Firm notes');
    assert.equal(v.textOf('deal-case-missing'), 'Missing: Geographic (not enough recorded), Legal and IP (not enough recorded).');
    // Your position, with the route the read does not carry.
    assert.match(v.textOf('deal-position-amount'), /\$50,000 · Pending/);
    assert.equal(v.textOf('deal-position-route'), 'Not recorded');
    assert.equal(v.requests.filter((r) => /GET .*\/api\/deals\/4\/case$/.test(r)).length, 1, 'D9109: one case read');
    assert.ok(!v.requests.some((r) => /\/api\/deals\/fit|\/notes\?.*tag=/.test(r)), 'no fit or tagged notes read for the card');
    assert.ok(!v.requests.some((r) => /\/api\/deals\/4\/evidence/.test(r)), 'the Overview never reads the evidence: that read logs an open');
  } finally { await v.close(); }
});

test('mounted, each block fails on its own with Try again, and Try again reads only that block again', async () => {
  let caseCalls = 0; let newsCalls = 0;
  const v = await mounted('/deals/4', base({
    'deals/4/case': () => { caseCalls += 1; return caseCalls === 1 ? response({ error: 'x' }, 503) : response(CASE); },
    'whats-new': () => { newsCalls += 1; return response({ error: 'x' }, 503); },
  }));
  try {
    assert.match(v.textOf('deal-case-why'), /could not be read\. That is not a claim that there are none\./);
    assert.match(v.textOf('deal-case-open'), /could not be read\. That is not a claim that there are none\./);
    assert.ok(!v.has('deal-case-notes-none'), 'a failed read is never "none"');
    assert.match(v.textOf('deal-whats-new'), /could not be read/);
    // The rest stands.
    assert.equal(v.textOf('deal-score-strongest'), 'StrongestMarket · StrongHigh confidence');
    assert.equal(v.textOf('deal-case-summary'), 'Ledger software for port operators.');
    assert.match(v.textOf('deal-position-amount'), /\$50,000/);
    const news = newsCalls;
    await v.click('deal-case-why-unreadable-retry');
    assert.equal(caseCalls, 2);
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75/);
    assert.match(v.textOf('deal-case-notes'), /Question: Unit economics/);
    assert.equal(newsCalls, news, 'the case\'s Try again reads only the case');
  } finally { await v.close(); }
});

test('mounted, a failed scorecard read: the summary says so and Try again reads it again; Missing is the case read\'s', async () => {
  let calls = 0;
  const v = await mounted('/deals/4', base({ 'venture-scores/batch': () => { calls += 1; return calls === 1 ? response({ error: 'x' }, 503) : response({ items: [{ deal_id: 4, scopes: SCOPES }] }); } }));
  try {
    assert.match(v.textOf('deal-score-slot'), /could not be read/);
    assert.ok(!v.has('deal-score-summary'));
    assert.equal(v.textOf('deal-case-missing'), 'Missing: Geographic (not enough recorded), Legal and IP (not enough recorded).', 'D9109: Missing comes from the case read');
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75/, 'the fit stands');
    await v.clickButton('deal-score-slot', 'Retry');
    assert.equal(calls, 2, 'the scorecard\'s own Unreadable reads the strip again');
    assert.ok(v.has('deal-score-summary'));
  } finally { await v.close(); }
});

test('mounted, nothing to show: no notes, no fit thesis, a closed scorecard, a first visit; no commitment is "none", not unreadable', async () => {
  const v = await mounted('/deals/4', base({
    'deals/4/case': () => response({ deal_id: 4, thesis_fit: { state: 'not_recorded', reason: 'No thesis is recorded for you, so fit is not worked out.', fit: { state: 'not_set', score: null } },
      main_evidence: { state: 'not_recorded', reason: 'No evidence is shared with you on this deal yet.' },
      open_questions: { state: 'not_recorded', reason: 'Your firm has no note tagged Question or Risk on this deal.' },
      missing: { state: 'not_recorded', reason: 'The founder has not shared the scorecard with investors.' } }),
    'venture-scores/batch': () => response({ items: [], not_readable: 1 }),
    'whats-new': () => response({ first_visit: true, changes: [] }),
    'deals/4/commitments': () => response([]),
    '/api/deals/4(\\?|$)': () => response({ ...DEAL, description: '' }),
  }));
  try {
    assert.equal(v.textOf('deal-case-notes-none'), 'Your firm has no note tagged Question or Risk on this deal.');
    assert.equal(v.textOf('deal-case-fit'), 'No thesis is recorded for you, so fit is not worked out.');
    assert.equal(v.textOf('deal-case-summary'), 'No summary is recorded on this deal.');
    assert.equal(v.textOf('deal-case-missing'), 'The founder has not shared the scorecard with investors.');
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
    assert.ok(!v.requests.some((r) => /deals\/fit|\/notes|whats-new|\/case/.test(r)), 'no investor read is made for staff');
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
