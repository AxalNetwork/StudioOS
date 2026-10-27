// D1193 (#3127) — Capital relationships part 5: Match (CRL7), Outreach (CRL8),
// Commitments with Round settings and New close (CRL9, CRL10), Eadwyn's
// proposals (CRL11) and Activity (CRL12). The model's rules, then each tab
// mounted in CycleRoute with a stubbed fetch: what it reads, what it writes,
// and that a missing value is never a zero.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_tabs_d1193.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  ACCEPT_ALL_MAX, PROPOSABLE, activityCsv, activityQuery, commitmentBar, commitmentRows, followUpGroups, followUpMeta, fundSize, mailtoHref,
  matchQuery, pageLine, proposalGroups, proposalLine, roundBody, snoozedDue, sourceGaps, verifiedLine, whenText,
} from '../src/pages/raise/caprel/capRelTabsModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const iso = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const TODAY = iso(0);

/* ------------------------------------------------------------------ *
 * Fixtures, in the Worker's shapes
 * ------------------------------------------------------------------ */

const P = (id, name, stage, o = {}) => ({ id, name, firm: name, stage, updated_at: `2026-10-${String(10 + id % 10).padStart(2, '0')}`, ...o });
const PROSPECTS = [
  P(41, 'Bluefern Capital', 'meeting', { next_step: 'Send the deck', next_step_due: iso(-2), email: 'bluefern@example.test', warm_path: 'Ana at Other Co' }),
  P(42, 'Lumen Ventures', 'diligence', { next_step: 'Data room', next_step_due: TODAY, email: 'lumen@example.test' }),
  P(43, 'Harbor Seed Fund', 'contacted', { next_step: 'Call', next_step_due: iso(3) }),
  P(44, 'Fund Q', 'meeting'),
  P(45, 'Fund T', 'passed', { next_step: 'Old step', next_step_due: iso(-9) }),
];
const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Fixture Robotics' }];
const MODULE = {
  module: { slug: 'capital-relationships', name: 'Capital relationships', records_title: 'Investors' },
  card: { state: 'empty', reason: 'No investors yet.' },
  records: { linkable: true, total: 0, page: 1, page_size: 25, cols: [{ key: 'investor', label: 'Investor' }], rows: [] },
  parts: { calls: { state: 'ok', items: [] } },
};
const WORDS = {
  status: { received: 'Received', signed: 'Signed', wired: 'Wired', confirmed: 'Confirmed', pending: 'Pending', indicated: 'Indicated through a call', soft: 'Soft', not_recorded: 'Status not recorded' },
  source: { typed: 'Typed', recorded: 'Recorded', connector: 'Connector · Mercury' },
};
const line = (key, source, status, cents, counted, o = {}) => ({ key, source, source_label: WORDS.source[source], status, status_label: WORDS.status[status], counted, cents, currency: 'USD', on: '2026-10-17', via: null, why_not_counted: counted ? null : 'Indicative, not signed.', ...o });
const COMMITMENTS = {
  currency: 'USD', round: { name: 'Seed', target_cents: 150000000, currency: 'USD' }, round_reason: null,
  totals: {
    counted_cents: 60000000, not_counted_cents: 27500000, percent_of_target: 40, partial: false,
    by_status: { received: { cents: 15000000, investors: 1 }, signed: { cents: 25000000, investors: 1 }, wired: { cents: 0, investors: 0 }, confirmed: { cents: 0, investors: 0 },
      pending: { cents: 20000000, investors: 1 }, indicated: { cents: 20000000, investors: 1 }, soft: { cents: 7500000, investors: 1 }, not_recorded: { cents: 10000000, investors: 1 } },
  },
  investors: [
    { key: 'p:5', prospect_id: 5, name: 'Fixture M', chosen: line('mercury:1', 'connector', 'received', 15000000, true), lines: [line('mercury:1', 'connector', 'received', 15000000, true), line('prospect:5', 'typed', 'wired', 15000000, true)] },
    { key: 'p:1', prospect_id: 1, name: 'Fund K', chosen: line('prospect:1', 'typed', 'signed', 25000000, true), lines: [line('prospect:1', 'typed', 'signed', 25000000, true)] },
    { key: 'p:2', prospect_id: 2, name: 'Northwind Angels', chosen: line('prospect:2', 'typed', 'not_recorded', null, false, { why_not_counted: 'No status is recorded, so it is not counted.' }), lines: [line('prospect:2', 'typed', 'not_recorded', null, false, { why_not_counted: 'No status is recorded, so it is not counted.' })] },
  ],
  sources: { prospects: { state: 'ok' }, round_calls: { state: 'ok' }, deals: { state: 'unreadable', reason: 'Deal-room commitments could not be read.' }, mercury: { state: 'ok' }, closings: { state: 'not_recorded', reason: 'Closings are not recorded yet.' } },
  words: WORDS,
  basis: 'Received, Signed, Wired, Confirmed and Pending count.',
};
const MATCH = {
  items: [
    { uid: 'f-1', name: 'Fund V', hq: 'Germany', sector_focus: 'Robotics, Industrial', fund_size_cents: 12000000000, size_currency: 'EUR', fit: { code: 'fits', label: 'Fits', their_focus: 'Robotics, Industrial', your_sector: 'Robotics' }, warm_paths: [{ name: 'Rae Contact', title: 'Partner', sentence: 'Rae Contact works there' }], in_pipeline: null },
    { uid: 'f-2', name: 'Fund W', hq: 'France', sector_focus: 'Fintech', fund_size_cents: null, size_currency: null, size_reason: 'Not recorded', fit: { code: 'outside', label: 'Outside its focus', their_focus: 'Fintech', your_sector: 'Robotics' }, warm_paths: [{ name: 'Sol Contact', title: null, sentence: 'Sol Contact works there' }], in_pipeline: { prospect_id: 44 } },
  ],
  total: 312, limit: 25, offset: 0,
  facets: { focus: [{ value: 'robotics', label: 'Robotics', count: 40 }, { value: 'none', label: 'Focus not recorded', count: 3 }], hq_country: [{ value: 'DE', label: 'Germany', count: 20 }], size_band: [{ value: 'lt25', label: 'Under €25M', count: 9 }] },
  sector: 'Robotics', sector_reason: null, fit_basis: 'Fit reads each fund’s stated focus.', warm_basis: 'A warm path is someone in your own network.',
  verified_investors: { count: 18 },
};
const MATERIALS = { items: [
  { prospect_id: 41, name: 'Bluefern Capital', deck: { state: 'sent', text: 'Viewed 3× · last 2026-10-10' }, data_room: { state: 'sent', text: 'Opened 4× · last 2026-10-11' }, call: { state: 'sent', text: 'Opened Seed extension' } },
  { prospect_id: 43, name: 'Harbor Seed Fund', deck: { state: 'not_sent', text: 'Not sent' }, data_room: { state: 'not_read', text: 'Not on Axal' }, call: { state: 'not_read', text: 'Not on Axal' } },
], basis: 'Deck links come from the Pitch deck.' };
const NOTE = 'Good partner meeting. They asked for the data room and the Q3 metrics pack by Friday.';
const proposal = (uid, payload) => ({ uid, kind: 'proposal', created_at: '2026-10-16 17:00:00', investor: 'Bluefern Capital', payload: { prospect_id: 41, event_id: 7, note_kind: 'meeting', note_on: '2026-10-16', note: NOTE, ...payload } });
const PROPOSALS = {
  proposals: [
    proposal('00000000-0000-4000-8000-000000000001', { type: 'next_step', text: 'Send the Q3 metrics pack', due: '2026-10-23', quote: 'the Q3 metrics pack by Friday' }),
    proposal('00000000-0000-4000-8000-000000000002', { type: 'stage_move', to: 'diligence', to_label: 'Diligence', why: 'They asked for the data room', quote: 'They asked for the data room' }),
  ],
  drafts: [{ uid: '00000000-0000-4000-8000-0000000000d1', kind: 'draft', investor: 'Bluefern Capital', payload: { purpose: 'follow_up', eyebrow: 'Follow-up', to: 'Bluefern Capital', prospect_id: 41, subject: 'Thank you for Friday', body: 'Thank you for Friday’s meeting.' } }],
};
const ACTIVITY = {
  items: [
    { id: 9, at: '2026-10-21 09:12:00', who: 'Fixture Founder', who_role: 'Founder', what: 'Investor edited: stage Meeting → Diligence', investor: { prospect_id: 41, name: 'Bluefern Capital' }, action: 'prospect_updated', source: 'typed', source_label: 'Typed' },
    { id: 8, at: '2026-10-21 08:40:00', who: 'Eadwyn', who_role: 'Proposes only', what: 'Drafted 2 proposals from your note on Bluefern Capital', investor: { prospect_id: 41, name: 'Bluefern Capital' }, action: 'eadwyn_proposed', source: 'eadwyn', source_label: 'Proposed by Eadwyn' },
    { id: 7, at: '2026-10-14 10:00:00', who: 'Fixture Founder', who_role: 'Founder', what: 'Investor imported at Identified', investor: { prospect_id: 46, name: 'Fund X, "the" fund' }, action: 'prospect_created', source: 'document', source_label: 'Document · CSV' },
  ],
  total: 30, page: 1, page_size: 25,
  kinds: [{ value: 'steps', label: 'Steps and next steps' }, { value: 'eadwyn', label: 'Eadwyn' }],
  not_here: 'An answer through a call, a deal-room commitment and a Mercury match are recorded by their own stores.',
};
const CLOSES = { round: { id: 1, name: 'Seed' }, closes: [{ id: 5, name: 'First close', state: 'open', target_date: '2026-11-14', closed_date: null, wired: 150000, signed: 250000, soft: 0 }], progress: null };

function handlerOf(o = {}) {
  return (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
    if (/\/contacts\/raise-prospects\?/.test(url)) return response({ items: o.prospects ?? PROSPECTS });
    if (/capital-relationships\/commitments/.test(url)) return o.commitments === null ? response({ detail: 'down' }, 503) : response(o.commitments ?? COMMITMENTS);
    if (/capital-relationships\/match/.test(url)) return response(o.match ?? MATCH);
    if (/capital-relationships\/materials/.test(url)) return o.materials === null ? response({ detail: 'down' }, 503) : response(MATERIALS);
    if (/capital-relationships\/activity/.test(url)) return response(o.activity ?? ACTIVITY);
    if (/capital-relationships\/proposals\/[^/]+\/accept/.test(url)) return response({ ok: true });
    if (/capital-relationships\/proposals/.test(url) && method === 'POST') return response({ proposals: PROPOSALS.proposals });
    if (/capital-relationships\/proposals/.test(url)) return response(o.proposals ?? PROPOSALS);
    if (/capital-relationships\/drafts/.test(url)) return response({ draft: PROPOSALS.drafts[0] }, 201);
    if (/\/ai\/rail\/proposals\/[^/]+\/decide/.test(url)) return response({ proposal: { status: 'discarded' } });
    if (/\/contacts\/raise-round/.test(url) && method === 'GET') return response({ round: { name: 'Seed', target_amount: 1500000, currency: 'USD', close_date: '2026-12-14', notes: null } });
    if (/\/contacts\/raise-round/.test(url)) return response({ id: 1 });
    if (/\/contacts\/raise-closes/.test(url) && method === 'GET') return response(o.closes ?? CLOSES);
    if (/\/contacts\/raise-closes/.test(url)) return response({ id: 6 }, 201);
    if (/\/contacts\/raise-pro-rata/.test(url)) return response({ items: [] });
    if (/\/contacts\/raise-updates/.test(url)) return response({ items: [{ uid: 'u1', subject: 'Pipeline update · August' }], shared_updates: [{ uid: 's1', title: 'September update', sent_at: '2026-10-02 09:00:00', investors: 9 }] });
    if (/\/records\/\d+\?/.test(url) && method === 'GET') return response({ facts: [], main: [], side: [] });
    if (/\/cycles\/raise\/prospects/.test(url)) return response({ ok: true, id: 99 }, method === 'POST' ? 201 : 200);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

async function mounted(url, { phone = false, ...o } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const handle = handlerOf(o);
  globalThis.fetch = async (u, options = {}) => { calls.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  return {
    calls, flush, by, all, props,
    has: (id) => Boolean(by(id)),
    text: (id) => text(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    textOf: (n) => text(n).replace(/\s+/g, ' ').trim(),
    reads: () => calls.filter((c) => c.method === 'GET').map((c) => c.url),
    writes: () => calls.filter((c) => c.method !== 'GET'),
    async click(id, n = by(id)) { assert.ok(n, `no ${id}`); await act(async () => props(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); await flush(); },
    async change(id, value, n = by(id)) { assert.ok(n, `no ${id}`); await act(async () => props(n).onChange?.({ target: { value, checked: value, files: null } })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('Match: the query takes only what is set, a fund with no size reads Not recorded, and verified investors are a count only', () => {
  assert.deepEqual(matchQuery({ q: '  robo ', fit: 'fits', warm: true, focus: '', offset: 25 }), { q: 'robo', fit: 'fits', warm: 1, limit: 25, offset: 25 });
  assert.deepEqual(matchQuery({}), { limit: 25, offset: 0 });
  assert.equal(fundSize(MATCH.items[1]), 'Not recorded', 'never €0');
  assert.match(fundSize(MATCH.items[0]), /€120,000,000/);
  assert.match(verifiedLine({ count: 18 }), /^18 verified investors on Axal have a published focus/);
  assert.match(verifiedLine({ count: 1 }), /^1 verified investor on Axal has/);
  assert.equal(verifiedLine({ count: null, reason: 'Your venture’s sector is not recorded.' }), 'Your venture’s sector is not recorded.');
  assert.equal(pageLine(25, 25, 312), '26–50 of 312');
  assert.equal(pageLine(0, 0, 0), 'None found');
});

test('Outreach: follow-ups fall into overdue, today, this week and no next step; a passed investor never does; snooze is a week out', () => {
  const g = followUpGroups(PROSPECTS, TODAY);
  assert.deepEqual(g.map((x) => [x.key, x.items.map((p) => p.id)]), [['overdue', [41]], ['today', [42]], ['week', [43]], ['none', [44]]]);
  assert.equal(followUpMeta(g), '1 overdue · 2 due in 7 days');
  assert.deepEqual(followUpGroups([P(1, 'x', 'meeting', { next_step: 'Far', next_step_due: iso(30) })], TODAY).map((x) => x.items.length), [0, 0, 0, 0], 'a step a month out is in no group');
  assert.equal(snoozedDue(iso(-2), TODAY), iso(7), 'an overdue step moves a week from today');
  assert.equal(snoozedDue(iso(3), TODAY), iso(10), 'a later step moves a week from its own date');
  assert.equal(mailtoHref('a.b+c@example.test', 'Hi there', 'Line one & two'), 'mailto:a.b%2Bc@example.test?subject=Hi%20there&body=Line%20one%20%26%20two');
  assert.equal(mailtoHref('', 'S', ''), 'mailto:?subject=S');
});

test('Commitments: counted statuses are drawn, listed ones are marked not counted, no status is never counted, and a missing total is Not recorded', () => {
  const b = commitmentBar(COMMITMENTS);
  assert.deepEqual(b.counted.map((s) => s.status), ['received', 'signed', 'pending'], 'a status with no money is not drawn');
  assert.deepEqual(b.listed.map((s) => [s.status, s.counted]), [['indicated', false], ['soft', false]]);
  assert.ok(!b.counted.some((s) => s.status === 'not_recorded') && !b.listed.some((s) => s.status === 'not_recorded'), 'Status not recorded is never in the bar');
  assert.deepEqual([b.total, b.target, b.percent, b.noStatus], ['$600,000', '$1,500,000', 40, 1]);
  assert.equal(commitmentBar({ ...COMMITMENTS, totals: { by_status: {} } }).total, 'Not recorded', 'never $0');
  assert.equal(commitmentBar({ ...COMMITMENTS, round: null }).target, null);

  const rows = commitmentRows(COMMITMENTS);
  assert.deepEqual(rows.map((r) => [r.investor, r.status_label, r.counted]), [
    ['Fixture M', 'Received', true], ['Fixture M', 'Wired', false], ['Fund K', 'Signed', true], ['Northwind Angels', 'Status not recorded', false],
  ]);
  assert.equal(rows[1].why, 'Counted once, by this investor’s strongest line.', 'the same money is never counted twice');
  assert.equal(rows[3].amount, 'Not recorded');
  assert.deepEqual(commitmentRows(COMMITMENTS, { q: 'fund' }).map((r) => r.investor), ['Fund K']);
  assert.deepEqual(commitmentRows(COMMITMENTS, { status: 'not_recorded' }).map((r) => r.investor), ['Northwind Angels']);
  assert.deepEqual(sourceGaps(COMMITMENTS).map((g) => g.key), ['deals', 'closings']);
  assert.deepEqual(roundBody(3, { name: ' Seed ', target: '$1,500,000', currency: 'USD', close_date: '', notes: '' }).body,
    { project_id: 3, name: 'Seed', target_amount: 1500000, currency: 'USD', close_date: null, notes: null });
  assert.equal(roundBody(3, { target: '' }).body.target_amount, null, 'an empty target is not recorded, never 0');
  assert.ok(roundBody(3, { target: 'lots' }).error);
  assert.ok(roundBody(3, { target: '1', currency: 'usd' }).error);
});

test('Eadwyn: proposals group under their note, say what they do, and a move is never to Committed or Passed', () => {
  const g = proposalGroups(PROPOSALS.proposals);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].investor, g[0].on, g[0].note, g[0].items.length], ['Bluefern Capital', '2026-10-16', NOTE, 2]);
  assert.equal(proposalLine(PROPOSALS.proposals[0]), 'Next step: Send the Q3 metrics pack by 2026-10-23');
  assert.equal(proposalLine(PROPOSALS.proposals[1]), 'Move to Diligence: They asked for the data room');
  assert.deepEqual(PROPOSABLE.map((s) => s.value), ['contacted', 'meeting', 'diligence']);
  assert.equal(ACCEPT_ALL_MAX, 50);
});

test('Activity: the query, the time as written in UTC, and a CSV that quotes what needs it', () => {
  assert.deepEqual(activityQuery({ q: ' x ', kind: 'steps', investor: '', page: 1 }), { q: 'x', kind: 'steps' });
  assert.deepEqual(activityQuery({ page: 3 }), { page: 3 });
  assert.equal(whenText('2026-10-21 09:12:00'), '21 Oct 2026 09:12');
  assert.equal(whenText(null), 'Not recorded');
  const csv = activityCsv(ACTIVITY.items).split('\n');
  assert.equal(csv[0], 'When (UTC),Who,What,Investor,Source');
  assert.equal(csv[3], '2026-10-14 10:00:00,Fixture Founder,Investor imported at Identified,"Fund X, ""the"" fund",Document · CSV');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('Match draws each fund with its Fit and why, Not recorded for a missing size, the count of verified investors, and Add to pipeline with the fund filled in', async () => {
  const v = await mounted('/raise/capital-relationships/match?project_id=3');
  try {
    assert.ok(v.reads().some((u) => /\/capital-relationships\/match\?project=3&sort=name&limit=25&offset=0$/.test(u)), v.reads().join('\n'));
    assert.equal(v.all('caprel-match-row').length, 2);
    assert.deepEqual(v.all('caprel-match-fit').map(v.textOf), ['Fits', 'Outside its focus']);
    assert.deepEqual(v.all('caprel-match-size').map(v.textOf).map((t) => t.includes('Not recorded')), [false, true]);
    assert.ok(!/€0\b|\$0\b/.test(v.text('caprel-match')), 'never a zero');
    assert.match(v.text('caprel-match-verified'), /18 verified investors on Axal/);
    assert.ok(!v.text('caprel-match-verified').includes('@'), 'a count, never names');
    assert.equal(v.text('caprel-match-tracked'), 'In your pipeline');
    await v.change('caprel-match-filter-fit', 'fits');
    assert.ok(v.reads().some((u) => /[?&]fit=fits/.test(u)));
    await v.change('caprel-match-warm', true);
    assert.ok(v.reads().some((u) => /[?&]warm=1/.test(u)));
    await v.click('caprel-match-add');
    assert.ok(v.has('caprel-add-dialog'));
    await v.click('caprel-add-go');
    const add = v.writes().at(-1);
    assert.match(add.url, /\/cycles\/raise\/prospects\?project=3$/);
    assert.deepEqual(add.body, { research_fund_uid: 'f-1', stage: 'to_contact' }, 'tracked by its directory id');
  } finally { await v.close(); }
});

test('Match: Ask for an intro drafts on the fund in your pipeline; a fund not in it is added first', async () => {
  const v = await mounted('/raise/capital-relationships/match?project_id=3');
  try {
    assert.ok(v.has('caprel-match-intro-add'), 'Fund V is not tracked: add it first');
    await v.click('caprel-match-intro');
    assert.ok(v.has('caprel-draft-dialog'));
    await v.click('caprel-draft-go');
    const draft = v.writes().at(-1);
    assert.match(draft.url, /\/capital-relationships\/drafts\?project=3$/);
    assert.deepEqual(draft.body, { prospect_id: 44, purpose: 'intro', via: 'Sol Contact' });
  } finally { await v.close(); }
});

test('Outreach: follow-ups in their groups; Done, Snooze and Draft each open a dialog and write through the one writer, keeping the warm path', async () => {
  const v = await mounted('/raise/capital-relationships/outreach?project_id=3');
  try {
    assert.match(v.text('caprel-outreach-followups'), /1 overdue · 2 due in 7 days/);
    assert.ok(!v.text('caprel-outreach-followups').includes('Fund T'), 'a passed investor is never due');
    assert.ok(v.has('caprel-followups-overdue') && v.has('caprel-followups-none'));
    await v.click('caprel-followup-done');
    assert.ok(v.has('caprel-done-dialog'));
    assert.match(v.text('caprel-done-dialog'), /The next step with Bluefern Capital is cleared/);
    await v.click('caprel-done-go');
    let w = v.writes().at(-1);
    assert.match(w.url, /\/cycles\/raise\/prospects\/41\/next-step\?project=3$/);
    assert.deepEqual(w.body, { next_step: null, next_step_due: null, warm_path: 'Ana at Other Co' });
    await v.click('caprel-followup-snooze');
    await v.click('caprel-snooze-go');
    w = v.writes().at(-1);
    assert.deepEqual(w.body, { next_step: 'Send the deck', next_step_due: iso(7), warm_path: 'Ana at Other Co' });
    await v.click('caprel-followup-draft');
    await v.click('caprel-draft-go');
    w = v.writes().at(-1);
    assert.match(w.url, /\/capital-relationships\/drafts\?project=3$/);
    assert.deepEqual(w.body, { prospect_id: 41, purpose: 'follow_up' });
  } finally { await v.close(); }
});

test('Outreach: Eadwyn’s drafts to send from your own email, each dismissed only through a dialog; materials sent; updates through Grow', async () => {
  const v = await mounted('/raise/capital-relationships/outreach?project_id=3');
  try {
    assert.match(v.text('caprel-draft'), /Follow-up · to Bluefern Capital[\s\S]*Thank you for Friday/);
    assert.equal(v.props(v.by('caprel-draft-mail')).href, 'mailto:bluefern@example.test?subject=Thank%20you%20for%20Friday&body=Thank%20you%20for%20Friday%E2%80%99s%20meeting.');
    await v.click('caprel-draft-dismiss-open');
    assert.ok(v.has('caprel-draft-dismiss'), 'a dialog says what is thrown away');
    assert.equal(v.writes().length, 0, 'nothing before the press');
    await v.click('caprel-draft-dismiss-go');
    const w = v.writes().at(-1);
    assert.match(w.url, /\/ai\/rail\/proposals\/00000000-0000-4000-8000-0000000000d1\/decide$/);
    assert.deepEqual(w.body, { decision: 'discard' });
    assert.deepEqual(v.all('caprel-material').map(v.textOf), [
      'Bluefern Capital Viewed 3× · last 2026-10-10 Opened 4× · last 2026-10-11 Opened Seed extension',
      'Harbor Seed Fund Not sent Not on Axal Not on Axal',
    ]);
    assert.match(v.text('caprel-outreach-updates'), /September update · shared 2026-10-02 with 9 investors[\s\S]*Recorded on the timeline, never emailed/);
    assert.equal(v.props(v.by('caprel-outreach-share')).href, '/grow/update?project_id=3');
  } finally { await v.close(); }
  const down = await mounted('/raise/capital-relationships/outreach?project_id=3', { materials: null });
  try {
    assert.match(down.text('caprel-outreach-materials'), /Materials sent could not be read\. This is not a claim that nothing was sent\./);
    assert.ok(down.has('caprel-outreach-followups'), 'one failed block never blanks the page');
  } finally { await down.close(); }
});

test('Commitments: the bar against the target, what is not counted, every commitment, the closes, Round settings and New close', async () => {
  const v = await mounted('/raise/capital-relationships/commitments?project_id=3');
  try {
    assert.equal(v.text('caprel-commit-total'), '$600,000 of $1,500,000 · 40%');
    assert.match(v.text('caprel-commit-legend'), /Indicated through a call \$200,000 · not counted[\s\S]*Soft \$75,000 · not counted/);
    assert.match(v.text('caprel-commit-no-status'), /Status not recorded: 1 investor is not counted/);
    assert.equal(v.all('caprel-commit-row').length, 4);
    assert.match(v.textOf(v.all('caprel-commit-row')[3]), /Northwind Angels Not recorded Status not recorded/);
    assert.deepEqual(v.all('caprel-commit-gap').map(v.textOf), ['Deal-room commitments could not be read.', 'Closings are not recorded yet.']);
    assert.match(v.text('caprel-close'), /First close[\s\S]*Target 2026-11-14 · Wired \$150,000 · Signed \$250,000 · Soft \$0 ?, not counted/);
    await v.click('caprel-round-open');
    assert.ok(v.has('caprel-round-dialog'));
    await v.change('caprel-round-target', '1,750,000');
    await v.click('caprel-round-go');
    let w = v.writes().at(-1);
    assert.deepEqual([w.method, w.url.replace(/^.*\/api/, ''), w.body], ['PUT', '/contacts/raise-round', { project_id: 3, name: 'Seed', target_amount: 1750000, currency: 'USD', close_date: '2026-12-14', notes: null }]);
    await v.click('caprel-close-new');
    await v.change('caprel-close-name', 'Second close');
    await v.click('caprel-close-go');
    w = v.writes().at(-1);
    assert.deepEqual([w.method, w.body], ['POST', { project_id: 3, name: 'Second close', state: 'planned' }]);
  } finally { await v.close(); }
  const down = await mounted('/raise/capital-relationships/commitments?project_id=3', { commitments: null });
  try {
    assert.match(down.text('caprel-commitments'), /The commitments could not be read\. This is not a claim that nobody committed\./);
    assert.ok(down.has('caprel-commit-closes'), 'the closes still answer');
  } finally { await down.close(); }
});

test('Activity: every change with who, when and its source; a filter is a new read; Export saves what is on screen', async () => {
  const v = await mounted('/raise/capital-relationships/activity?project_id=3');
  try {
    assert.deepEqual(v.all('caprel-activity-row').map(v.textOf), [
      '21 Oct 2026 09:12 Fixture Founder Founder Investor edited: stage Meeting → Diligence · Bluefern Capital Typed',
      '21 Oct 2026 08:40 Eadwyn Proposes only Drafted 2 proposals from your note on Bluefern Capital · Bluefern Capital Proposed by Eadwyn',
      '14 Oct 2026 10:00 Fixture Founder Founder Investor imported at Identified · Fund X, "the" fund Document · CSV',
    ]);
    assert.equal(v.text('caprel-activity-count'), '1–3 of 30');
    await v.change('caprel-activity-kind', 'steps');
    assert.ok(v.reads().some((u) => /activity\?project=3&kind=steps$/.test(u)));
    await v.click('caprel-activity-next');
    assert.ok(v.reads().some((u) => /activity\?project=3&kind=steps&page=2$/.test(u)));
  } finally { await v.close(); }
});

test('Eadwyn’s proposals: each beside its words, accepted, edited or dismissed only after saying what changes; Ask Eadwyn reads the investor’s note', async () => {
  const v = await mounted('/raise/capital-relationships/pipeline?project_id=3');
  try {
    await v.click('caprel-proposals-open');
    assert.ok(v.has('caprel-proposals'));
    const sheet = v.props(v.by('caprel-proposals'));
    assert.equal(sheet.role, 'dialog', 'D1317: the proposals open as the shared Sheet');
    assert.ok(sheet['aria-labelledby']);
    assert.equal(sheet['data-width'], 640, 'its own 620, on the Sheet’s list');
    assert.match(v.text('caprel-proposal-group'), /From your note on Bluefern Capital · 2026-10-16[\s\S]*‘ ?Good partner meeting\./);
    assert.match(v.textOf(v.all('caprel-proposal')[0]), /Next step: Send the Q3 metrics pack by 2026-10-23 From: “ ?the Q3 metrics pack by Friday ?”/);
    assert.match(v.text('caprel-proposals-pattern'), /Not read here yet/);
    await v.click('caprel-proposal-accept');
    assert.match(v.text('caprel-proposal-confirm'), /The next step with Bluefern Capital becomes “Send the Q3 metrics pack”, due 2026-10-23\./);
    assert.equal(v.writes().length, 0, 'nothing before the second press');
    await v.click('caprel-proposal-go');
    let w = v.writes().at(-1);
    assert.match(w.url, /\/capital-relationships\/proposals\/00000000-0000-4000-8000-000000000001\/accept\?project=3$/);
    assert.deepEqual(w.body, {});
    const move = v.all('caprel-proposal')[1];
    await v.click('caprel-proposal-edit', v.all('caprel-proposal-edit')[1]);
    await v.change('caprel-proposal-edit-to', 'meeting');
    assert.match(v.textOf(move), /Bluefern Capital moves to Meeting\./);
    await v.click('caprel-proposal-go');
    w = v.writes().at(-1);
    assert.deepEqual(w.body, { edited: { to: 'meeting' } });
  } finally { await v.close(); }
  // From the investor's lightbox: Ask Eadwyn reads that investor's newest note, once, on the press.
  const l = await mounted('/raise/capital-relationships/pipeline?project_id=3');
  try {
    const card = l.by('caprel-card-41');
    const open = card.childNodes.find((n) => String(n.tagName).toUpperCase() === 'BUTTON');
    await act(async () => l.props(open).onClick());
    await l.flush();
    await l.click('caprel-investor-eadwyn');
    assert.match(l.text('caprel-proposals-ask'), /Ask Eadwyn about Bluefern Capital/);
    assert.ok(!l.writes().some((c) => /capital-relationships\/proposals/.test(c.url)), 'opening runs nothing');
    await l.click('caprel-proposals-ask');
    const run = l.writes().at(-1);
    assert.match(run.url, /\/capital-relationships\/proposals\?project=3$/);
    assert.deepEqual(run.body, { prospect_id: 41 });
  } finally { await l.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

const FILES = ['CapRelMatch.jsx', 'CapRelOutreach.jsx', 'CapRelCommitments.jsx', 'CapRelActivity.jsx', 'CapRelProposals.jsx'].map((f) => `frontend/src/pages/raise/caprel/${f}`);

test('no browser pop-up, no old write, and every new colour has its dark pair', () => {
  for (const f of FILES) {
    const src = read(f);
    assert.ok(!/\b(window\.)?(confirm|alert|prompt)\s*\(/.test(src), `${f}: a browser pop-up`);
    assert.ok(!/raiseProspectUpdate|raiseProspectCreate/.test(src), `${f}: the old contacts.ts prospect writes`);
    for (const cls of src.match(/\b(?:bg|border|text)-(?:emerald|amber|sky|violet|red|gray|indigo)-\d{2,3}\b(?!\/)/g) || []) {
      const shade = cls.split('-')[1];
      assert.ok(src.includes(`dark:${cls.split('-')[0]}-${shade}`) || src.includes(`dark:${cls.split('-')[0]}-`), `${f}: ${cls} has no dark pair`);
    }
  }
  assert.match(read('frontend/src/pages/raise/caprel/README.md'), /CapRelMatch\.jsx[\s\S]*capRelTabsModel\.js/);
});
