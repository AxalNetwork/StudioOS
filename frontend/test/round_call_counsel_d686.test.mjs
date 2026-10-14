/**
 * D686 §5.6 (#1598), the items S19-A (#1594, merged as #1626) unblocked:
 *   · resume, never duplicate: a draft is read, never created again;
 *   · structured key terms, seeded from the context and sent as cents/bps;
 *   · the audience preview's sector, stage, cheque range and reason codes;
 *   · counsel review requested from Send, and HQ's Counsel review queue;
 *   · Capital relationships' Calls for Capital history, and Raise's live tab.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { roundCallsApi } from '../src/lib/api/roundCalls.js';
import RoundCallSheet, {
  CALL_FIELDS, RoundCallSheetView, termSeed, keyTermsText, callTermsText, termsBody, recordedRoundFields,
  matchLine, AUDIENCE_REASONS, counselRequested, ROUND_ROWS,
} from '../src/pages/founder/RoundCallSheet.jsx';
import { CounselQueueView } from '../src/pages/hq/CounselQueue.jsx';
import CallsHistory, { callLine, callHref, CALL_STATES } from '../src/pages/cycles/CallsHistory.jsx';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const CONTEXT = { project: { id: 7, name: 'Acme' }, round: null, scenario: null, decks: [], chosen: [], data_room: null,
  term_seeds: { safe: { valuation_cap_cents: 800000000, discount_bps: null, pre_money_cents: null, source: 'safe_issuance' },
    convertible_note: { valuation_cap_cents: 600000000, discount_bps: 2000, pre_money_cents: null, source: 'scenario' },
    equity: { valuation_cap_cents: null, discount_bps: null, pre_money_cents: 1200000000, source: 'raise_round' } } };
const DRAFT = { uid: 'd1', name: 'Seed', state: 'draft', instrument: 'safe', amount_cents: 150000000, minimum_cheque_cents: 2500000,
  terms: '', target_close: '2099-01-15', deck_id: null, data_room_project_uid: null, valuation_cap_cents: 800000000, discount_bps: null, pre_money_cents: null, revision: 3, terms_hash: 'h3' };

async function mountWith(list) {
  const calls = [];
  const saved = { ...roundCallsApi };
  const stub = (key, value) => { roundCallsApi[key] = async (...args) => { calls.push([key, ...args]); return typeof value === 'function' ? value(...args) : value; }; };
  for (const key of Object.keys(saved)) stub(key, {});
  stub('availability', { enabled: true });
  stub('context', CONTEXT);
  stub('list', { items: list });
  stub('page', (uid) => ({ call: { ...DRAFT, uid }, recipients: [], readiness: [], counsel_approved: false }));
  try {
    const view = await mountContracts(h(RoundCallSheet, { projectId: 7, onClose: () => {} }), '/raise/call');
    try { for (let i = 0; i < 4; i++) await view.flush(); return { calls, text: view.text() }; } finally { await view.unmount(); }
  } finally { Object.assign(roundCallsApi, saved); }
}

test('resume, never duplicate: a venture with a draft reads list() then page(draft) and never creates', async () => {
  const { calls, text } = await mountWith([{ uid: 'old', state: 'draft' }, { uid: 'sent1', state: 'closed', target_close: '2020-01-01' }]);
  const names = calls.map((c) => c[0]);
  assert.ok(names.includes('list'), names.join());
  assert.deepEqual(calls.find((c) => c[0] === 'page'), ['page', 'old']);
  assert.equal(names.includes('create'), false, 'no second draft');
  assert.equal(names.includes('save'), false, 'nothing is written on open');
  assert.match(text, /Materials/);
});

test('an open call shows its notice and reads no draft', async () => {
  const { calls, text } = await mountWith([{ uid: 'live', state: 'sent', name: 'Live round', target_close: '2099-12-31' }]);
  assert.match(text, /This venture has an open call · Live round/);
  assert.equal(calls.some((c) => c[0] === 'page' || c[0] === 'create'), false);
});

test('CALL_FIELDS: every S19-A field is on, now that #1626 stores them', () => {
  assert.deepEqual(CALL_FIELDS, { key_terms: true, counsel_request: true, counsel_queue: true, audience_reasons: true, committed_at: true });
  assert.ok(Object.isFrozen(CALL_FIELDS));
});

test('key terms: seeded per instrument, read as counsel reads them, sent as cents and basis points', () => {
  assert.deepEqual(termSeed(CONTEXT, 'safe'), { cap: '8000000', discount: '', pre_money: '' });
  assert.deepEqual(termSeed(CONTEXT, 'convertible_note'), { cap: '6000000', discount: '20', pre_money: '' });
  assert.deepEqual(termSeed(CONTEXT, 'equity'), { cap: '', discount: '', pre_money: '12000000' });
  assert.deepEqual(termSeed({}, 'safe'), { cap: '', discount: '', pre_money: '' });
  assert.equal(keyTermsText({ instrument: 'safe', cap: '8000000', discount: '20', pre_money: '1' }), 'Cap $8M', 'a SAFE shows its cap only');
  assert.equal(keyTermsText({ instrument: 'convertible_note', cap: '8000000', discount: '20' }), 'Cap $8M · discount 20%');
  assert.equal(keyTermsText({ instrument: 'equity', pre_money: '12000000', cap: '5' }), 'Pre-money $12M');
  assert.equal(keyTermsText({ instrument: '', cap: '8000000' }), '');
  assert.equal(callTermsText({ instrument: 'convertible_note', valuation_cap_cents: 800000000, discount_bps: 2000 }), 'Cap $8M · discount 20%');
  assert.deepEqual(termsBody({ instrument: 'safe', cap: '8000000', discount: '20', pre_money: '9' }), { valuation_cap_cents: 800000000, discount_bps: null, pre_money_cents: null });
  assert.deepEqual(termsBody({ instrument: 'convertible_note', cap: '6000000', discount: '20', pre_money: '' }), { valuation_cap_cents: 600000000, discount_bps: 2000, pre_money_cents: null });
  assert.deepEqual(termsBody({ instrument: 'equity', cap: '', discount: '', pre_money: '12000000' }), { valuation_cap_cents: null, discount_bps: null, pre_money_cents: 1200000000 });
  assert.equal(termsBody({ instrument: 'convertible_note', cap: '', discount: '95' }).discount_bps, null, 'over 90% is not sent');
  assert.equal(ROUND_ROWS.find((r) => r.key === 'terms').show({ instrument: 'safe', cap: '8000000', terms: '' }), 'Cap $8M');
  assert.equal(ROUND_ROWS.find((r) => r.key === 'terms').show({ instrument: 'safe', cap: '', terms: 'MFN' }), 'MFN');
});

test('a stored call keeps its own terms; a new one takes the seeds of its instrument', () => {
  const kept = recordedRoundFields(CONTEXT, { ...DRAFT, instrument: 'convertible_note', valuation_cap_cents: 500000000, discount_bps: 1500 });
  assert.deepEqual([kept.cap, kept.discount, kept.pre_money], ['5000000', '15', '']);
  const fresh = recordedRoundFields({ ...CONTEXT, scenario: { inputs_json: JSON.stringify({ safes: [{ instrument: 'safe', amount: 1 }] }) } });
  assert.equal(fresh.instrument, 'safe');
  assert.equal(fresh.cap, '8000000');
});

const VIEW = { step: 0, fields: { name: 'Seed', amount: '1500000', instrument: 'convertible_note', terms: '', minimum: '25000', target: '2099-01-15', deck_id: '', room: false, cap: '6000000', discount: '20', pre_money: '' },
  context: CONTEXT, chosen: [], includeMatches: false, matches: null, page: null, busy: false, error: '', outcome: null, uid: 'd1', editing: 'terms', choosing: false, note: null, projectId: 7 };
const on = new Proxy({}, { get: () => () => {} });
const view = (s) => ssr(h(RoundCallSheetView, { state: { ...VIEW, ...s }, on, onClose: () => {} }));

test('The round draws the instrument\'s own term inputs, enabled', () => {
  const html = view({});
  assert.match(html, /aria-label="Valuation cap · USD"(?![^>]*disabled)[^>]*value="6000000"/);
  assert.match(html, /aria-label="Discount · %"(?![^>]*disabled)[^>]*value="20"/);
  assert.doesNotMatch(html, /Pre-money valuation/);
  assert.match(html, /aria-label="Other terms"/);
  assert.doesNotMatch(html, /Cap, discount and pre-money as separate fields/);
});

test('the audience preview names sector, stage and the cheque range; a reason code is its sentence', () => {
  assert.equal(matchLine({ sector: 'Fintech', stage: 'Seed', cheque_min_usd: 25000, cheque_max_usd: 250000 }), ' · Thesis fits Fintech, stage Seed, cheque $25k–$250k');
  assert.equal(matchLine({ sector: 'Fintech', stage: null, cheque_min_usd: null, cheque_max_usd: 250000 }), ' · Thesis fits Fintech');
  assert.equal(matchLine({ match_reasons: ['sector'] }), ' · sector');
  const hit = renderedText(view({ step: 2, matches: { data: { matched: 3, sector: 'Fintech', stage: 'Seed', cheque_min_usd: 25000, cheque_max_usd: 250000 } } }));
  assert.match(hit, /3 verified investors match · Thesis fits Fintech, stage Seed, cheque \$25k–\$250k\. Names appear only once they respond\./);
  const none = renderedText(view({ step: 2, matches: { data: { matched: 0, reason: 'sector_not_recorded' } } }));
  assert.match(none, /Your venture has no recorded sector, so no match can be made\./);
  assert.equal(AUDIENCE_REASONS.stage_not_recorded, 'Your venture has no recorded stage, so no match can be made.');
  assert.match(renderedText(view({ step: 2, matches: { data: { matched: 0, reason: null } } })), /Widen the minimum cheque/);
});

const PAGE = (call) => ({ call: { ...DRAFT, ...call }, recipients: [{ origin: 'chosen' }], readiness: [{ key: 'round', label: 'Round', ready: true }], counsel_approved: false });
test('Send: Request counsel review is live; once requested it says when, and Send stays locked', () => {
  const ask = view({ step: 4, page: PAGE({}) });
  assert.match(ask, /<button type="button"[^>]*>Request counsel review<\/button>/);
  assert.doesNotMatch(ask, /disabled=""[^>]*>Request counsel review/);
  assert.doesNotMatch(ask, /the Worker has no route for this/);
  const sent = renderedText(view({ step: 4, page: PAGE({ counsel_requested_at: '2026-10-14 08:00:00', counsel_requested_hash: 'h3' }) }));
  assert.match(sent, /Sent to Axal HQ for counsel review on 14\/10\/2026/);
  assert.doesNotMatch(sent, /Request counsel review/);
  assert.match(sent, /Counsel has not approved the terms yet/);
  assert.equal(counselRequested({ counsel_requested_at: 'x', counsel_requested_hash: 'old', terms_hash: 'new' }), false, 'changed terms need a new request');
  assert.equal(counselRequested({ counsel_requested_at: 'x', counsel_requested_hash: 'h', terms_hash: 'h' }), true);
  assert.equal(counselRequested({}), false);
});

test('the api: requestCounsel posts the revision; counselQueue reads the static queue path', () => {
  const src = readFileSync('frontend/src/lib/api/roundCalls.js', 'utf8');
  assert.match(src, /requestCounsel: \(uid,revision\) => request\(`\/round-calls\/\$\{encodeURIComponent\(uid\)\}\/counsel-request`, \{method:'POST',body:JSON\.stringify\(\{revision\}\)\}\)/);
  assert.match(src, /counselQueue: \(\) => request\('\/round-calls\/counsel-queue'\)/);
  const sheet = readFileSync('frontend/src/pages/founder/RoundCallSheet.jsx', 'utf8');
  assert.match(sheet, /roundCallsApi\.requestCounsel\(uid,page\.call\.revision\)/);
});

test('HQ: the Counsel review tab lists the queue, each row to the call\'s counsel form', () => {
  const rows = ssr(h(CounselQueueView, { read: { status: 'ready', data: { items: [{ uid: 'c1', name: 'Seed', project_name: 'Acme', instrument: 'safe', state: 'draft', counsel_requested_at: '2026-10-14 08:00:00' }] } } }));
  assert.match(rows, /href="\/round-calls\/c1"[^>]*>Review the terms</);
  assert.match(renderedText(rows), /Seed.*Acme · SAFE · Draft · Requested 14 Oct 2026/);
  assert.match(ssr(h(CounselQueueView, { read: { status: 'ready', data: { items: [] } } })), /No call is waiting for counsel review\./);
  assert.match(ssr(h(CounselQueueView, { read: { status: 'off' } })), /Coming soon\. Round calls are not enabled\./);
  assert.match(ssr(h(CounselQueueView, { read: { status: 'unreadable' }, onRetry: () => {} })), /Unreadable/);
  const page = readFileSync('frontend/src/pages/hq/ReviewQueuePage.jsx', 'utf8');
  assert.match(page, /data-testid="review-tab-counsel"/);
  assert.match(page, />\s*Counsel review\s*</);
  assert.match(page, /'\/hq\/review\?tab=counsel'/);
  assert.match(page, /counsel \? <section className="mt-4" aria-live="polite"><CounselQueue \/><\/section>/);
});

const ITEM = { uid: 'k1', name: 'Seed round', state: 'sent', effective_state: 'open', sent_at: '2026-10-01 09:00:00', target_close: '2027-01-15', amount_cents: 150000000, committed_cents: 10000000, responded: 3 };
test('Capital relationships: Calls for Capital, on, off, unreadable and empty', () => {
  const html = ssr(h(CallsHistory, { calls: { enabled: true, items: [ITEM, { ...ITEM, uid: 'k2', name: 'Draft round', state: 'draft', effective_state: 'draft', sent_at: null, responded: 1, committed_cents: 0 }] } }));
  assert.match(html, /<section id="calls"/);
  assert.match(html, /<h2[^>]*>Calls for Capital<\/h2>/);
  assert.match(html, /href="\/raise\/calls\/k1"[^>]*>Seed round</);
  assert.match(html, /href="\/round-calls\/k2"[^>]*>Draft round</);
  const text = renderedText(html);
  assert.match(text, /Sent 01\/10\/2026 · closes 15\/01\/2027 · committed \$100,000 of \$1,500,000 · 3 responses/);
  assert.match(text, /Not sent · closes 15\/01\/2027 · committed \$0 of \$1,500,000 · 1 response/);
  assert.match(text, /Open/);
  assert.match(text, /Draft/);
  assert.deepEqual(Object.values(CALL_STATES), ['Draft', 'Awaiting counsel', 'Open', 'Expired', 'Closed']);
  assert.match(ssr(h(CallsHistory, { calls: { enabled: false } })), /Coming soon\. Round calls are not enabled\./);
  const bad = ssr(h(CallsHistory, { calls: { state: 'unreadable' } }));
  assert.match(bad, /Unreadable/);
  assert.doesNotMatch(bad, /No call for capital yet/);
  assert.match(ssr(h(CallsHistory, { calls: { enabled: true, items: [] } })), /No call for capital yet\./);
  assert.equal(ssr(h(CallsHistory, { calls: null })), '');
  assert.equal(callHref({ uid: 'a b', state: 'closed' }), '/raise/calls/a%20b');
  assert.match(callLine({ ...ITEM, responded: 0 }), /0 responses$/);
  assert.match(callLine({ ...ITEM, responded: 1 }), /· 1 response$/);
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(route, /'capital-relationships': \(data\) => <CallsHistory calls=\{data\?\.parts\?\.calls\} \/>/);
});

test('Preview reads the structured terms as an investor sees them, else the free text', () => {
  const structured = renderedText(view({ step: 3, page: PAGE({ instrument: 'convertible_note', valuation_cap_cents: 800000000, discount_bps: 2000, terms: 'MFN' }) }));
  assert.match(structured, /Convertible note · Cap \$8M · discount 20% · minimum \$25,000/);
  const free = renderedText(view({ step: 3, page: PAGE({ valuation_cap_cents: null, terms: 'MFN side letter' }) }));
  assert.match(free, /SAFE · MFN side letter · minimum/);
});
