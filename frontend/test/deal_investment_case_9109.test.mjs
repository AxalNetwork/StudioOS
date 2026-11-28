/**
 * D9109 (#9109) — the deal Overview's Investment case (DE04, DX4) on the one case read,
 * `GET /api/deals/:id/case` (D6173): thesis fit with its reasons, the main evidence as counts,
 * the firm's Question and Risk notes, and the Missing line. Each block shows its own reason word
 * for word, an unreadable block has its own Try again while the others draw, a failed whole read
 * is Unreadable in both halves, and a 409 asks for the firm.
 *
 * Model tests on `caseView`, then the real DealRoomPage mounted with a fetch the test controls.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_investment_case_9109.test.mjs
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
import { notesHref } from '../src/pages/dealPageModel.js';
import {
  CASE_FIRM_REQUIRED, CASE_NO_THIN_SCOPE, CASE_OPEN_UNREADABLE, CASE_PARTIAL, CASE_WHY_UNREADABLE, caseView,
} from '../src/pages/deal/dealFrameModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// The Worker's reasons (`CASE_REASONS`, cloudflare-worker/src/routes/deal_case.ts), word for word.
const REASONS = {
  thesisNotSet: 'No thesis is recorded for you, so fit is not worked out.',
  thesisThin: 'Too little is recorded about this venture to work out fit against your thesis.',
  noEvidenceAudience: 'The founder has not shared evidence with you on this deal.',
  noEvidence: 'No evidence is shared with you on this deal yet.',
  noQuestions: 'Your firm has no note tagged Question or Risk on this deal.',
  scoresLocked: 'The founder has not shared the scorecard with investors.',
  beforeNda: 'Sign the NDA with this venture to see which scopes are thinly evidenced.',
};

const DEAL = { id: 4, project_id: 7, project_name: 'Harbour Robotics', project_sector: 'Robotics', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, instrument: 'Post-money SAFE', closing_deadline: '2026-12-01', description: 'Picking robots for small warehouses.' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const OWN = { uid: 'c-own', deal_id: 4, investor_user_id: 21, company_id: 501, company_name: 'Alder Ventures', firm_context: 501, in_context: true, amount: 50000, status: 'pending' };

const FIT = { state: 'recorded', fit: { state: 'recorded', score: 75, confidence_label: 'High', criteria: [
  { key: 'sector', state: 'match' }, { key: 'stage', state: 'not_set' }, { key: 'region', state: 'not_recorded' }, { key: 'ticket', state: 'outside' }] } };
const EVIDENCE = { state: 'recorded', partial: false, groups: [
  { area: 'Capital model', kind: 'revenue-receipt', source_label: 'connector', count: 3, newest: '2026-11-03T10:00:00Z' },
  { area: 'Use of funds', kind: 'bank-statement', source_label: 'document', count: 1, newest: null },
] };
const note = (uid, tag, body, at) => ({ uid, tag, body, created_at: at, author_name: 'Ada' });
const NOTES = { state: 'recorded', items: [
  note('r1', 'risk', 'Key-person risk on the CTO', '2026-11-12T09:00:00Z'),
  note('q1', 'Question', 'Unit economics at 50 units?\nMore detail here.', '2026-11-10T09:00:00Z'),
] };
const MISSING = { state: 'recorded', threshold: 0.5, scopes: [
  { scope: 'legal_ip', label: 'Legal and IP', state: 'not_enough', coverage: null },
  { scope: 'financial', label: 'Financial', state: 'scored', coverage: 0.38 },
  { scope: 'traction', label: 'Traction', state: 'scored', coverage: null },
] };
const CASE = { deal_id: 4, thesis_fit: FIT, main_evidence: EVIDENCE, open_questions: NOTES, missing: MISSING };
const ready = (data, extra = {}) => ({ status: 'ready', data, ...extra });
const nr = (reason) => ({ state: 'not_recorded', reason });

// ------------------------------------------------------------------ the model

test('caseView: all four blocks recorded, as DE04 draws them', () => {
  const v = caseView(ready(CASE));
  assert.equal(v.state, 'ready');
  assert.equal(v.fit.state, 'recorded');
  assert.equal(v.fit.line, 'Fit to my thesis 75 (High)');
  assert.deepEqual(v.fit.reasons, ['Sector matches your thesis', 'Ticket is outside your thesis'], 'not set and not recorded are not reasons');
  assert.deepEqual(v.evidence.rows.map((r) => [r.text, r.newest]), [['Capital model · Revenue receipt · 3', '3 Nov 2026'], ['Use of funds · Bank statement · 1', null]]);
  assert.equal(v.evidence.partial, null, 'a complete list says nothing about being incomplete');
  assert.deepEqual(v.notes.rows.map((n) => [n.tag, n.text]), [['Risk', 'Key-person risk on the CTO'], ['Question', 'Unit economics at 50 units?']],
    'newest first as the read sends them, the first line only, the tag in one case');
  assert.equal(v.notes.more, null);
  assert.equal(v.missing.line, 'Missing: Legal and IP (not enough recorded), Financial (38% of its evidence), Traction (coverage not recorded).');
  assert.equal(v.missing.thin, true);
});

test('caseView: a scored scope with coverage null says "coverage not recorded", never null% or 0%', () => {
  const v = caseView(ready({ ...CASE, missing: { state: 'recorded', scopes: [{ scope: 'traction', label: 'Traction', state: 'scored', coverage: null }] } }));
  assert.equal(v.missing.line, 'Missing: Traction (coverage not recorded).');
  assert.doesNotMatch(v.missing.line, /null|0%/);
  const zero = caseView(ready({ ...CASE, missing: { state: 'recorded', scopes: [{ scope: 'traction', label: 'Traction', state: 'scored', coverage: 0 }] } }));
  assert.equal(zero.missing.line, 'Missing: Traction (0% of its evidence).', 'a recorded zero is a figure');
  const none = caseView(ready({ ...CASE, missing: { state: 'recorded', scopes: [], threshold: 0.5 } }));
  assert.equal(none.missing.line, CASE_NO_THIN_SCOPE);
  assert.equal(none.missing.thin, false);
});

test('caseView: each not_recorded block gives the read\'s reason word for word', () => {
  for (const [key, block] of [['thesisNotSet', 'thesis_fit'], ['thesisThin', 'thesis_fit'], ['noEvidenceAudience', 'main_evidence'], ['noEvidence', 'main_evidence'],
    ['noQuestions', 'open_questions'], ['scoresLocked', 'missing'], ['beforeNda', 'missing']]) {
    const v = caseView(ready({ ...CASE, [block]: { ...nr(REASONS[key]), ...(block === 'thesis_fit' ? { fit: { state: 'not_set', score: null } } : {}) } }));
    const part = { thesis_fit: v.fit, main_evidence: v.evidence, open_questions: v.notes, missing: v.missing }[block];
    assert.deepEqual(part, { state: 'not_recorded', line: REASONS[key] }, key);
  }
});

test('the reasons this test pins are the Worker\'s', () => {
  const src = readFileSync('cloudflare-worker/src/routes/deal_case.ts', 'utf8');
  for (const [key, line] of Object.entries(REASONS)) assert.ok(src.includes(`${key}: '${line}'`), key);
});

test('caseView: an unreadable block keeps its reason, the others draw; Try again marks only it as reading', () => {
  const failed = { ...CASE, missing: { state: 'unreadable', reason: 'The scorecard could not be read. Try again.' } };
  const v = caseView(ready(failed));
  assert.deepEqual(v.missing, { state: 'unreadable', line: 'The scorecard could not be read. Try again.' });
  assert.equal(v.fit.state, 'recorded');
  assert.equal(v.notes.state, 'recorded');
  const again = caseView(ready(failed, { reloading: true }));
  assert.equal(again.missing.state, 'loading', 'the failed block reads again');
  assert.equal(again.fit.line, 'Fit to my thesis 75 (High)', 'a block that drew keeps drawing');
  // A block missing from the answer, or recorded in a shape the card cannot draw, is unreadable, never empty.
  const gone = caseView(ready({ deal_id: 4 }));
  assert.equal(gone.fit.line, 'Thesis fit could not be read. Try again.');
  assert.equal(gone.evidence.line, 'The shared evidence could not be read. Try again.');
  assert.equal(gone.notes.line, 'Your firm’s notes could not be read. Try again.');
  assert.equal(gone.missing.line, 'The scorecard could not be read. Try again.');
  assert.equal(caseView(ready({ ...CASE, thesis_fit: { state: 'recorded', fit: { score: null } } })).fit.state, 'unreadable', 'a recorded fit with no score is never drawn as one');
});

test('caseView: the whole read — loading, unreadable, 409 firm required, and 403 or 404 not drawn', () => {
  assert.equal(caseView({ status: 'loading' }).state, 'loading');
  assert.equal(caseView(null).state, 'loading');
  for (const error of [{ status: 503 }, { status: 500 }, new TypeError('Failed to fetch'), undefined]) {
    assert.deepEqual(caseView({ status: 'unreadable', error }), { state: 'unreadable', why: CASE_WHY_UNREADABLE, open: CASE_OPEN_UNREADABLE });
  }
  assert.match(CASE_WHY_UNREADABLE, /That is not a claim that there are none\.$/);
  assert.match(CASE_OPEN_UNREADABLE, /That is not a claim that there are none\.$/);
  assert.deepEqual(caseView({ status: 'unreadable', error: { status: 409, code: 'firm_required' } }), { state: 'firm_required', line: CASE_FIRM_REQUIRED });
  assert.equal(caseView({ status: 'unreadable', error: { status: 403 } }).state, 'hidden');
  assert.equal(caseView({ status: 'unreadable', error: { status: 404 } }).state, 'hidden');
});

test('caseView: at most three notes, then how many more; a full page of twenty says "or more"; 140 characters', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => note(`n${i}`, i % 2 ? 'Risk' : 'QUESTION', `Note ${i}`, '2026-11-10T09:00:00Z'));
  const five = caseView(ready({ ...CASE, open_questions: { state: 'recorded', items: items(5) } })).notes;
  assert.deepEqual(five.rows.map((r) => r.text), ['Note 0', 'Note 1', 'Note 2']);
  assert.deepEqual(five.rows.map((r) => r.tag), ['Question', 'Risk', 'Question']);
  assert.equal(five.more, '2 more in Firm notes');
  assert.equal(caseView(ready({ ...CASE, open_questions: { state: 'recorded', items: items(20) } })).notes.more, '17 or more in Firm notes');
  assert.equal(caseView(ready({ ...CASE, open_questions: { state: 'recorded', items: items(3) } })).notes.more, null);
  const long = caseView(ready({ ...CASE, open_questions: { state: 'recorded', items: [note('x', 'Risk', 'y'.repeat(200)), note('blank', 'Risk', '   ')] } })).notes;
  assert.equal(long.rows.length, 1, 'a blank note is not listed');
  assert.equal(long.rows[0].text.length, 140);
  assert.ok(long.rows[0].text.endsWith('…'));
});

test('caseView: partial evidence says the list may be incomplete, and at most five groups', () => {
  const groups = Array.from({ length: 7 }, (_, i) => ({ area: 'Data room', kind: 'signed-document', source_label: 'document', count: 7 - i, newest: null }));
  const v = caseView(ready({ ...CASE, main_evidence: { state: 'recorded', partial: true, groups } })).evidence;
  assert.equal(v.rows.length, 5);
  assert.equal(v.partial, CASE_PARTIAL);
});

// ------------------------------------------------------------------ mounted

async function mounted(url, handler) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push(`${(init?.method || 'GET').toUpperCase()} ${String(u)}`); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(INVESTOR));
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
    async click(id) { await act(async () => props(byId(id)[0]).onClick?.({ preventDefault() {} })); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

function base(caseFn) {
  return (url) => {
    if (/\/api\/deals\/4\/case/.test(url)) return caseFn(url);
    if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/due-diligence/dd1', kind: 'navigate' }, ic: { state: 'used' } });
    if (/\/api\/deals\/4\/whats-new/.test(url)) return response({ since: '2026-11-01T00:00:00Z', first_visit: false, changes: [], unavailable: [] });
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([OWN]);
    if (/\/api\/deals\/4\/notes/.test(url)) return response({ items: [], total: 0 });
    if (/\/venture-scores\/batch/.test(url)) return response({ items: [{ deal_id: 4, scopes: [{ scope: 'team', state: 'scored', band: 'Strong', confidence_word: 'High' }] }] });
    if (/\/networkfx\/syndicates/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}
const caseReads = (requests) => requests.filter((r) => /^GET .*\/api\/deals\/4\/case$/.test(r)).length;

test('mounted: the four blocks recorded, from one case read and no other read for the card', async () => {
  const v = await mounted('/deals/4', base(() => response(CASE)));
  try {
    assert.equal(v.propOf('deal-case', 'className').includes('lg:col-span-7'), true, 'beside Your position');
    assert.equal(v.textOf('deal-case-summary'), 'Picking robots for small warehouses.');
    assert.equal(v.textOf('deal-case-fit'), 'Fit to my thesis 75 (High)Sector matches your thesisTicket is outside your thesis');
    assert.equal(v.textOf('deal-case-evidence-list'), 'Capital model · Revenue receipt · 3 · newest 3 Nov 2026Use of funds · Bank statement · 1');
    assert.equal(v.propOf('deal-case-evidence', 'children').at(-1).props.to, '/deals/4/evidence', 'Open the shared evidence is still the way in');
    assert.ok(!v.has('deal-case-evidence-partial'));
    assert.equal(v.textOf('deal-case-notes'), 'Risk: Key-person risk on the CTOQuestion: Unit economics at 50 units?');
    assert.ok(!v.has('deal-case-notes-more'));
    assert.equal(v.textOf('deal-case-missing'), 'Missing: Legal and IP (not enough recorded), Financial (38% of its evidence), Traction (coverage not recorded).');
    assert.equal(caseReads(v.requests), 1, 'one case read per visit');
    assert.ok(!v.requests.some((r) => /\/api\/deals\/fit/.test(r)), 'no thesis-fit read for the card');
    assert.ok(!v.requests.some((r) => /\/notes\?.*tag=/.test(r)), 'no tagged notes read for the card');
    assert.ok(!v.requests.some((r) => /\/api\/deals\/4\/evidence/.test(r)), 'the Overview never reads the evidence: that read logs an open');
  } finally { await v.close(); }
});

test('mounted: every not_recorded reason is drawn word for word, with Add one in Firm notes', async () => {
  for (const [fitR, evR, missR] of [['thesisNotSet', 'noEvidenceAudience', 'scoresLocked'], ['thesisThin', 'noEvidence', 'beforeNda']]) {
    const body = { deal_id: 4, thesis_fit: { ...nr(REASONS[fitR]), fit: { state: 'not_set', score: null } }, main_evidence: nr(REASONS[evR]),
      open_questions: nr(REASONS.noQuestions), missing: nr(REASONS[missR]) };
    const v = await mounted('/deals/4', base(() => response(body)));
    try {
      assert.equal(v.textOf('deal-case-fit-none'), REASONS[fitR]);
      assert.equal(v.textOf('deal-case-evidence-none'), REASONS[evR]);
      assert.equal(v.textOf('deal-case-notes-none'), REASONS.noQuestions);
      assert.equal(v.propOf('deal-case-notes-add', 'href'), notesHref(4));
      assert.equal(v.textOf('deal-case-missing-none'), REASONS[missR]);
      assert.ok(!v.has('deal-case-notes') && !v.has('deal-case-evidence-list'));
    } finally { await v.close(); }
  }
});

test('mounted: one block unreadable while the others draw; its Try again re-reads the case and the rest keep showing', async () => {
  let calls = 0; let release;
  const v = await mounted('/deals/4', base(() => {
    calls += 1;
    if (calls === 1) return response({ ...CASE, missing: { state: 'unreadable', reason: 'The scorecard could not be read. Try again.' } });
    return new Promise((resolve) => { release = () => resolve(response(CASE)); });
  }));
  try {
    assert.equal(v.textOf('deal-case-missing'), 'The scorecard could not be read. Try again.Try again');
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75/);
    assert.match(v.textOf('deal-case-notes'), /^Risk: Key-person risk/);
    await v.click('deal-case-missing-unreadable-retry');
    assert.equal(calls, 2);
    assert.equal(v.textOf('deal-case-missing'), 'Reading…', 'the failed block reads again');
    assert.equal(v.propOf('deal-case-missing-reading', 'aria-live'), 'polite');
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75/, 'the others keep what they show until the answer arrives');
    release(); await v.settle();
    assert.match(v.textOf('deal-case-missing'), /^Missing: Legal and IP/);
    assert.equal(caseReads(v.requests), 2, 'one read per visit and one per Try again');
  } finally { await v.close(); }
});

test('mounted: the whole read failing reads Unreadable in both halves, then Try again succeeds', async () => {
  let calls = 0;
  const v = await mounted('/deals/4', base(() => { calls += 1; if (calls === 1) throw new TypeError('Failed to fetch'); if (calls === 2) return response({ error: 'x' }, 503); return response(CASE); }));
  try {
    assert.equal(v.textOf('deal-case-why-unreadable'), CASE_WHY_UNREADABLE);
    assert.equal(v.textOf('deal-case-open-unreadable'), CASE_OPEN_UNREADABLE);
    assert.equal(v.textOf('deal-case-summary'), 'Picking robots for small warehouses.', 'the summary is the deal\'s, not the case read\'s');
    assert.match(v.textOf('deal-position-amount'), /\$50,000/, 'the rest of the page stands');
    assert.ok(v.propOf('deal-case-open-unreadable-retry', 'className').includes('max-sm:min-h-[44px]'));
    await v.click('deal-case-why-unreadable-retry');
    assert.equal(v.textOf('deal-case-open-unreadable'), CASE_OPEN_UNREADABLE, 'a 5xx is unreadable too');
    await v.click('deal-case-open-unreadable-retry');
    assert.match(v.textOf('deal-case-fit'), /^Fit to my thesis 75/);
    assert.ok(!v.has('deal-case-why-unreadable'));
    assert.equal(caseReads(v.requests), 3);
  } finally { await v.close(); }
});

test('mounted: a 409 asks for the firm; a 403 or 404 draws no card and leaves the page', async () => {
  const firm = await mounted('/deals/4', base(() => response({ error: 'firm_required', message: 'Choose the firm this deal is for.' }, 409)));
  try {
    assert.match(firm.textOf('deal-case-firm'), /^Choose the firm this deal is for\./);
    assert.ok(!firm.has('deal-case-why-unreadable'), 'a missing firm is not a failed read');
  } finally { await firm.close(); }
  for (const status of [403, 404]) {
    const v = await mounted('/deals/4', base(() => response({ error: status === 403 ? 'investor_only' : 'deal_not_found' }, status)));
    try {
      assert.ok(!v.has('deal-case'), String(status));
      assert.ok(v.has('deal-score-slot') && v.has('deal-position'), 'the page around it stands');
    } finally { await v.close(); }
  }
});

// ------------------------------------------------------------------ the record

test('D9109 records the build and the old three reads are gone from the card', () => {
  const f = 'documentation/architecture/decisions/D9109.md';
  assert.ok(existsSync(f));
  assert.match(readFileSync(f, 'utf8'), /^## D9109 — .+ \(#9109\)$/m);
  const src = readFileSync('frontend/src/pages/deal/DealOverview.jsx', 'utf8');
  assert.match(src, /dealContextApi\.investmentCase\(id\)/);
  assert.doesNotMatch(src, /dealViewsApi|tag: 'Question'|tag: 'Risk'|missingEvidence/);
  assert.doesNotMatch(src, /Eadwyn/, 'the case serves no draft, so the card offers none');
});
