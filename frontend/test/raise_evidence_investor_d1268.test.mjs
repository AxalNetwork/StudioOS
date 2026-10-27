/**
 * D1268 (#3291) — Raise evidence part 7: the investor's block live (VR8, VR9),
 * one item's drawer (VR10) and the phone (VR18), on D1265's read, placed on the
 * deal page, an investor's round call and the diligence room.
 *
 * Mounted against `investorEvidence`'s own shapes (`services/raiseEvidence.ts`).
 * Every venture, figure and date is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_evidence_investor_d1268.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { EvidenceSummary, InvestorEvidence, SharedEvidence } from '../src/pages/cycles/evidence/InvestorEvidence.jsx';
import { coverageTile, figureOf, investorView, kindWord, recordDay, refusalOf, sourceLine } from '../src/pages/cycles/evidence/evidenceModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

const COVERAGE = { state: 'recorded', groups: [
  { area: 'Fundraising readiness', kind: 'bank-runway', source_label: 'connector', count: 1, newest: '2026-10-01' },
  { area: 'Investor narrative and Pitch deck', kind: 'pain-theme', source_label: 'recorded', count: 4, newest: '2026-10-03' },
  { area: 'Data room', kind: 'loi-file', source_label: 'document', count: 3, newest: null },
] };
const BEFORE = (extra = {}) => ({ nda_signed: false, before_nda: 'Figures, files and quotes open once the NDA is signed.', coverage: COVERAGE, items: null, claims: null, partial: false, ...extra });
const ITEM = (extra = {}) => ({ uid: 'i-runway', area: 'Fundraising readiness', kind: 'bank-runway', source_label: 'connector', provider: 'mercury', strength: 'measured', observed_on: '2026-10-01', summary: 'Runway derived from the company bank is recorded.', stale: false, sharing: 'after_nda', value_num: 14.2, value_unit: 'months', currency: null, value_reason: null, ...extra });
const ITEMS = () => [
  ITEM(),
  ITEM({ uid: 'i-mrr', area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_label: 'connector', provider: 'stripe', observed_on: '2026-10-05', value_num: 8400, value_unit: 'money', currency: 'USD' }),
  ITEM({ uid: 'i-theme', area: 'Investor narrative and Pitch deck', kind: 'pain-theme', source_label: 'recorded', provider: null, observed_on: '2026-10-03', sharing: 'summary', value_num: null, value_unit: null, value_reason: 'Shared as a summary only.' }),
  ITEM({ uid: 'i-safe', area: 'Cap table', kind: 'accepted-safe', source_label: 'connector', provider: 'mercury', observed_on: '2026-09-20', value_num: null, value_unit: null, value_reason: 'One investor’s money is not shown to another investor.' }),
];
const CLAIMS = { state: 'recorded', rows: [
  { uid: 'c-runway', surface: 'readiness', claim_kind: 'runway', state: 'backed', checked_at: '2026-10-06 10:00:00', items: ['i-runway'] },
  { uid: 'c-mrr', surface: 'deck', claim_kind: 'mrr', state: 'mismatch', checked_at: '2026-10-06 10:00:00', items: ['i-mrr'] },
] };
const AFTER = (extra = {}) => ({ nda_signed: true, before_nda: null, coverage: COVERAGE, items: { state: 'recorded', rows: ITEMS() }, claims: CLAIMS, partial: false, ...extra });
const err = (status, code) => Object.assign(new Error('refused'), { status, code });

async function mounted(element) {
  const restore = installDocument();
  const previous = { open: globalThis.open, alert: globalThis.alert, confirm: globalThis.confirm };
  const popups = [];
  globalThis.open = (...a) => { popups.push(a); return null; };
  globalThis.alert = (...a) => popups.push(a);
  globalThis.confirm = (...a) => { popups.push(a); return true; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(document.body).find((n) => props_(n)['data-testid'] === id);
  return {
    popups, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), attr: (id, k) => props_(byId(id))[k], all: () => text(document.body),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ---------------------------------------------------------------- model

test('before the NDA the view carries coverage only: no item, no claim, no value, whatever the read holds', () => {
  const v = investorView(BEFORE());
  assert.equal(v.stage, 'before');
  assert.deepEqual(Object.keys(v).sort(), ['coverage', 'line', 'partial', 'stage']);
  // A read that wrongly carried items before the NDA still draws none.
  const leaky = investorView(BEFORE({ items: { state: 'recorded', rows: ITEMS() }, claims: CLAIMS }));
  assert.equal(leaky.items, undefined);
  assert.equal(leaky.claims, undefined);
  assert.ok(!JSON.stringify(leaky).includes('14.2'));
  assert.deepEqual(coverageTile(COVERAGE.groups[0]), { area: 'Fundraising readiness', kind: 'Runway from the bank', source: 'Connector', count: 1, newest: 'newest 1 Oct 2026' });
  assert.equal(coverageTile(COVERAGE.groups[2]).newest, 'date not recorded');
  assert.equal(coverageTile({ ...COVERAGE.groups[0], count: null }).count, null, 'a missing count is not zero');
});

test('after the NDA: each shared item by area, its claims, and a tally; nothing the read left out is invented', () => {
  const v = investorView(AFTER());
  assert.equal(v.stage, 'after');
  assert.deepEqual(v.items.areas.map(([a, rs]) => [a, rs.map((r) => r.uid)]), [
    ['Fundraising readiness', ['i-runway']], ['Investor narrative and Pitch deck', ['i-mrr', 'i-theme']], ['Cap table', ['i-safe']],
  ]);
  assert.deepEqual(v.items.rows.find((r) => r.uid === 'i-mrr').claims.map((c) => c.state), ['mismatch']);
  assert.equal(v.tally, '4 shared items: 2 with their figures, 2 without.');
  assert.equal(investorView(null).stage, 'none');
  assert.equal(investorView({ state: 'unreadable', reason: 'The evidence could not be read. Try again.' }).stage, 'unreadable');
  const bad = investorView(AFTER({ items: { state: 'unreadable', reason: 'The shared evidence could not be read. Try again.' } }));
  assert.equal(bad.items.ok, false);
  assert.equal(bad.coverage.ok, true, 'one failed block never blanks the others');
});

test('figures, dates and the source line: the record\'s own date, the bank named for a bank-derived figure, never a zero', () => {
  assert.equal(figureOf(ITEM()), '14.2 months');
  assert.equal(figureOf({ value_num: 142000, value_unit: 'cents', currency: 'USD' }), 'USD 1,420');
  assert.equal(figureOf({ value_num: 8400, value_unit: 'money', currency: 'EUR' }), 'EUR 8,400');
  assert.equal(figureOf({ value_num: 12.5, value_unit: 'percent' }), '12.5%');
  assert.equal(figureOf({ value_num: null, value_unit: 'money' }), null);
  assert.equal(figureOf({ value_num: 0, value_unit: 'people' }), '0 people', 'a recorded zero is a zero');
  assert.equal(sourceLine(ITEM()), 'From the company’s bank, as of 1 Oct 2026');
  assert.equal(sourceLine(ITEM({ provider: 'stripe' })), 'Connector, as of 1 Oct 2026');
  assert.equal(sourceLine(ITEM({ source_label: 'typed', provider: null, observed_on: null })), 'Typed, date not recorded');
  assert.equal(recordDay('2026-13-01'), null);
  assert.equal(kindWord('nope'), 'Evidence');
});

test('a refused read in words: the founder pointed to their own view, an outsider told it is not open, a failure is not none', () => {
  assert.equal(refusalOf(err(403, 'investor_only')).kind, 'founder');
  assert.equal(refusalOf(err(403)).kind, 'closed');
  assert.equal(refusalOf(err(404)).kind, 'closed');
  assert.equal(refusalOf(err(503, 'unreadable')).kind, 'unreadable');
  assert.match(refusalOf(err(500)).line, /not the same as none/);
});

// ---------------------------------------------------------------- the block

test('VR8: before the NDA the block draws coverage tiles and the lock line, and no value at all', () => {
  const out = html(h(InvestorEvidence, { read: BEFORE({ items: { state: 'recorded', rows: ITEMS() } }), company: 'Example Labs' }));
  assert.match(out, /data-stage="before"/);
  assert.match(out, /Example Labs shares what backs its claims\. Figures, files and quotes open once the NDA is signed\./);
  assert.equal((out.match(/data-testid="evidence-tile"/g) || []).length, 3);
  assert.match(out, /Runway from the bank/);
  for (const v of ['14.2', '8,400', 'months', 'evidence-row-', 'evidence-claim-state', 'NDA signed']) assert.ok(!out.includes(v), v);
});

test('VR9: after the NDA each shared item with its value or its reason, claim states; a held-back item is simply absent', () => {
  const out = html(h(InvestorEvidence, { read: AFTER(), company: 'Example Labs' }));
  assert.match(out, /data-stage="after"/);
  assert.match(out, /You see what Example Labs chose to share\./);
  for (const s of ['14.2 months', 'USD 8,400', 'Shared as a summary only.', 'One investor’s money is not shown to another investor.', 'From the company’s bank, as of 1 Oct 2026', 'Backed', 'Mismatch']) assert.ok(out.includes(s), s);
  // The read returned four items: four rows, and no trace of anything it held back.
  assert.equal((out.match(/data-testid="evidence-row-/g) || []).length, 4);
  for (const s of ['Private', 'private', 'hidden', 'held back', 'Not shared']) assert.ok(!out.includes(s), s);
  const fewer = html(h(InvestorEvidence, { read: AFTER({ items: { state: 'recorded', rows: ITEMS().filter((i) => i.uid !== 'i-mrr') } }) }));
  assert.ok(!fewer.includes('8,400') && !fewer.includes('evidence-row-i-mrr') && !fewer.includes('Mismatch'));
  assert.match(fewer, /3 shared items/);
});

test('states: unreadable with Try again, nothing shared yet, partial, and a round call that does not admit the reader draws nothing', () => {
  assert.match(html(h(InvestorEvidence, { read: { state: 'unreadable', reason: 'The evidence could not be read. Try again.' }, onRetry: () => {} })), /evidence-unreadable-retry/);
  assert.match(html(h(InvestorEvidence, { read: AFTER({ items: { state: 'recorded', rows: [] } }) })), /The founder has shared no evidence yet\./);
  assert.match(html(h(InvestorEvidence, { read: BEFORE({ coverage: { state: 'recorded', groups: [] } }) })), /evidence-coverage-empty/);
  assert.match(html(h(InvestorEvidence, { read: AFTER({ partial: true }) })), /data-testid="evidence-partial"/);
  const half = html(h(InvestorEvidence, { read: AFTER({ coverage: { state: 'unreadable', reason: 'x' }, claims: { state: 'unreadable', reason: 'y' } }) }));
  assert.match(half, /14\.2 months/, 'items still draw when claims fail');
  assert.match(half, /evidence-claims-unreadable/);
  assert.equal(html(h(InvestorEvidence, { read: null })), '');
});

test('VR10: an item opens in a drawer with its source, figure or reason, strength and what it backs; no pop-up', async () => {
  const m = await mounted(h(InvestorEvidence, { read: AFTER() }));
  try {
    await m.click('evidence-open-i-runway');
    assert.ok(m.has('evidence-item'));
    assert.equal(m.textOf('evidence-item-figure'), '14.2 months');
    assert.match(m.textOf('evidence-item-source'), /Connector · From the company’s bank, as of 1 Oct 2026/);
    assert.match(m.textOf('evidence-item'), /Strength: measured.*Backs.*Backed/s);
    await m.click('evidence-item-close');
    assert.equal(m.has('evidence-item'), false);
    await m.click('evidence-open-i-theme');
    assert.equal(m.textOf('evidence-item-reason'), 'Shared as a summary only.');
    assert.equal(m.has('evidence-item-figure'), false);
    assert.match(m.textOf('evidence-item'), /shared this as a summary only/);
    assert.deepEqual(m.popups, []);
  } finally { await m.close(); }
});

// ---------------------------------------------------------------- the three places

test('the deal page: the investor reads by the deal; the founder is pointed to Raise › Evidence; a failure retries', async () => {
  const calls = [];
  const api = (answers) => ({ forDeal: async (id) => { calls.push(id); const a = answers.shift(); if (a instanceof Error) throw a; return a; }, shared: async () => { throw new Error('unused'); } });
  const m = await mounted(h(EvidenceSummary, { dealId: 42, company: 'Example Labs', api: api([AFTER()]) }));
  try {
    assert.deepEqual(calls, [42]);
    assert.equal(m.attr('evidence-summary', 'data-stage'), 'after');
  } finally { await m.close(); }
  const f = await mounted(h(EvidenceSummary, { dealId: 42, api: api([err(403, 'investor_only')]) }));
  try {
    assert.equal(f.textOf('evidence-refused'), 'This is the investor’s view. You read your evidence in Raise › Evidence.');
    assert.match(f.all(), /Open Raise › Evidence/);
  } finally { await f.close(); }
  calls.length = 0;
  const u = await mounted(h(EvidenceSummary, { dealId: 42, api: api([err(503, 'unreadable'), BEFORE()]) }));
  try {
    assert.match(u.textOf('evidence-refused'), /not the same as none/);
    await u.click('evidence-unreadable-retry');
    assert.deepEqual(calls, [42, 42]);
    assert.equal(u.attr('evidence-summary', 'data-stage'), 'before');
  } finally { await u.close(); }
});

test('the diligence room: the shared read by the venture; a refusal draws nothing, since the room already says what is open', async () => {
  const seen = [];
  const m = await mounted(h(SharedEvidence, { projectUid: 'p-uid-1', company: 'Example Labs', api: { shared: async (uid) => { seen.push(uid); return BEFORE(); } } }));
  try {
    assert.deepEqual(seen, ['p-uid-1']);
    assert.equal(m.attr('evidence-summary', 'data-stage'), 'before');
  } finally { await m.close(); }
  const n = await mounted(h(SharedEvidence, { projectUid: 'p-uid-1', api: { shared: async () => { throw err(404); } } }));
  try { assert.equal(n.has('evidence-summary'), false); assert.equal(n.has('evidence-loading'), false); } finally { await n.close(); }
});

test('the wiring: deal tab, round call, diligence room; no ui index; no pop-up, no hex, dark pairs; the Worker serves all three reads', () => {
  const deal = read('frontend/src/pages/DealRoomPage.jsx');
  assert.ok(deal.includes("import { EvidenceSummary } from './cycles/evidence/InvestorEvidence';"));
  assert.ok(deal.includes("{tab === 'evidence' && <EvidenceSummary dealId={deal.id} company={deal.project_name || null} />}"));
  const call = read('frontend/src/pages/founder/RoundCallPage.jsx');
  assert.ok(call.includes('<InvestorEvidence read={d.evidence??null} company={company} onRetry={on.retry}/>'));
  assert.ok(call.indexOf('<InvestorEvidence') > call.indexOf('export function InvestorCallView'), 'only on the investor’s view of a call');
  const room = read('frontend/src/pages/research/DiligenceRoom.jsx');
  assert.ok(room.includes('<SharedEvidence projectUid={room.project.uid} company={room.project.name} />'));
  const src = read('frontend/src/pages/cycles/evidence/InvestorEvidence.jsx');
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/\.\.\/ui'/, 'no ui index');
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(|window\.open/);
  assert.doesNotMatch(src, /(bg|text|border)-\[#/);
  assert.doesNotMatch(src, /localStorage|console\.|reportError/);
  for (const m of src.matchAll(/hover:bg-gray-50/g)) assert.match(src.slice(m.index, m.index + 120), /dark:hover:bg-/);
  assert.ok(read('frontend/src/lib/api/raiseEvidence.js').includes("forDeal: (dealId) => request(`/deals/${encodeURIComponent(dealId)}/evidence`)"));
  assert.ok(read('cloudflare-worker/src/routes/deals.ts').includes("deals.get('/:id/evidence'"));
  assert.ok(read('cloudflare-worker/src/routes/data_room.ts').includes("r.get('/shared/:projectUid/evidence'"));
  assert.match(read('cloudflare-worker/src/services/roundCalls.ts'), /investorEvidence\(env,call\.project_id,investor\.id\)/);
  assert.match(read('documentation/architecture/decisions/D1268.md'), /## D1268/);
});
