/**
 * D6164 (#6164) — the deal page's Evidence tab to the Deals v2 Evidence
 * addendum (D6163): DE19 before the NDA, DE20 after it, DE21 one item, DE22
 * its states, DE30a on a phone and DE31a in dark.
 *
 * Mounted against `investorEvidence`'s own shapes (`services/raiseEvidence.ts`).
 * Every venture, figure and date is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_evidence_6164.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { DealEvidence } from '../src/pages/cycles/evidence/DealEvidence.jsx';
import { EvidenceSummary } from '../src/pages/cycles/evidence/InvestorEvidence.jsx';
import {
  areaGroups, claimSummary, coverageTotals, dealClaim, filterCount, itemFacts, noteDraft, partialLine, positionIn, sharedClaims, sortItems,
} from '../src/pages/cycles/evidence/dealEvidenceModel.js';
import { investorView } from '../src/pages/cycles/evidence/evidenceModel.js';

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
  ITEM({ uid: 'i-theme', area: 'Investor narrative and Pitch deck', kind: 'pain-theme', source_label: 'recorded', provider: null, strength: 'pattern', observed_on: '2026-10-03', sharing: 'summary', value_num: null, value_unit: null, value_reason: 'Shared as a summary only.', stale: true }),
  ITEM({ uid: 'i-safe', area: 'Cap table', kind: 'accepted-safe', source_label: 'connector', provider: 'mercury', observed_on: '2026-09-20', value_num: null, value_unit: null, value_reason: 'One investor’s money is not shown to another investor.' }),
];
const CLAIMS = { state: 'recorded', rows: [
  { uid: 'c-runway', surface: 'readiness', claim_kind: 'runway', state: 'backed', checked_at: '2026-10-06 10:00:00', items: ['i-runway'] },
  { uid: 'c-mrr', surface: 'deck', claim_kind: 'mrr', state: 'mismatch', checked_at: '2026-10-08 10:00:00', items: ['i-mrr'] },
  { uid: 'c-pain', surface: 'narrative', claim_kind: 'customer_evidence', state: 'founders_figure', checked_at: null, items: ['i-theme'] },
  // Backs only an item this reader never received: never counted, never a filter.
  { uid: 'c-private', surface: 'deck', claim_kind: 'arr', state: 'not_backed', checked_at: '2026-10-09 10:00:00', items: ['private-item'] },
] };
const AFTER = (extra = {}) => ({ nda_signed: true, before_nda: null, coverage: COVERAGE, items: { state: 'recorded', rows: ITEMS() }, claims: CLAIMS, partial: false, ...extra });
const ACTIONS = { dataRoomHref: '/deals/42/data-room', diligenceHref: '/deals/42/diligence', notesHref: '/deals/42/notes', scorecardHref: '/deals/42/scorecard' };
const err = (status, code) => Object.assign(new Error('refused'), { status, code });

async function mounted(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(document.body).find((n) => props_(n)['data-testid'] === id);
  const all = (pred) => walk(document.body).filter((n) => pred(props_(n), n));
  return {
    has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), attr: (id, k) => props_(byId(id))[k], all: () => text(document.body),
    ids: (prefix) => all((p) => String(p['data-testid'] || '').startsWith(prefix)).map((n) => props_(n)['data-testid']),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value } }); }); await flush(); },
    retry: async (id) => {
      const box = byId(id); assert.ok(box, `no ${id}`);
      const b = walk(box).find((n) => props_(n)['data-state-retry'] === '');
      assert.ok(b, `no Try again in ${id}`);
      assert.equal(text(b).trim(), 'Try again');
      await act(async () => { props_(b).onClick({ preventDefault() {} }); }); await flush();
    },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

// ---------------------------------------------------------------- model

test('claims: only claims behind an item this reader received; the line counts backed of shared; a failed block is no line at all', () => {
  const v = investorView(AFTER());
  const rows = sharedClaims(v.items, v.claims);
  assert.deepEqual(rows.map((c) => c.uid), ['c-runway', 'c-mrr', 'c-pain']);
  assert.deepEqual(rows.map((c) => c.title), ['Runway', 'MRR', 'Product-market fit']);
  assert.equal(rows[1].where, 'Pitch deck');
  assert.equal(rows[1].checked, '8 Oct 2026');
  assert.equal(rows[2].checked, null);
  const s = claimSummary(rows);
  assert.equal(s.line, '1 of 3 shared claims are backed');
  assert.deepEqual(s.counts, [['backed', 1], ['founders_figure', 1], ['mismatch', 1], ['not_backed', 0]]);
  assert.equal(claimSummary([{ uid: 'x', state: 'backed' }]).line, '1 of 1 shared claim is backed');
  assert.equal(claimSummary([]).line, 'None of the shared items backs a claim yet.');
  assert.deepEqual(claimSummary([{ uid: 'q', state: 'pending' }]).counts.at(-1), ['unchecked', 1]);
  const twice = investorView(AFTER({ claims: { state: 'recorded', rows: [{ ...CLAIMS.rows[0], items: ['i-runway', 'i-mrr'] }] } }));
  assert.deepEqual(sharedClaims(twice.items, twice.claims).map((c) => c.uid), ['c-runway'], 'a claim behind two items counts once');
  assert.equal(sharedClaims(v.items, { ok: false }), null);
  assert.equal(sharedClaims({ ok: false }, v.claims), null);
  assert.equal(claimSummary(null), null);
  assert.deepEqual(dealClaim('mismatch'), { glyph: '≠', word: 'Does not match' });
  assert.deepEqual(dealClaim('founders_figure'), { glyph: '✎', word: 'The founder’s own figure' });
  assert.equal(dealClaim('weird').word, 'Not checked yet');
});

test('sort, groups and totals: checked newest first, undated last; areas in the canvas order, an unknown area kept; counts only when all were read', () => {
  const rows = investorView(AFTER()).items.rows;
  assert.deepEqual(sortItems(rows, 'checked').map((i) => i.uid), ['i-mrr', 'i-runway', 'i-theme', 'i-safe']);
  assert.deepEqual(sortItems(rows, 'observed').map((i) => i.uid), ['i-mrr', 'i-theme', 'i-runway', 'i-safe']);
  assert.deepEqual(sortItems([ITEM({ uid: 'a', observed_on: null, claims: [] }), ITEM({ uid: 'b', claims: [] })], 'observed').map((i) => i.uid), ['b', 'a']);
  const groups = areaGroups([...rows, { ...ITEM({ uid: 'i-odd', area: 'Something new' }), claims: [] }]);
  assert.deepEqual(groups.map(([a]) => a), ['Fundraising readiness', 'Investor narrative and Pitch deck', 'Cap table', 'Something new']);
  assert.deepEqual(positionIn(groups, 'i-theme'), { area: 'Investor narrative and Pitch deck', index: 2, of: 2 });
  assert.equal(positionIn(groups, 'nope'), null);
  assert.deepEqual(coverageTotals(COVERAGE.groups), { groups: 3, items: 8 });
  assert.deepEqual(coverageTotals([...COVERAGE.groups, { count: null }]), { groups: 4, items: null });
  assert.equal(partialLine(26), '26 items shown. This is a partial read, not the full count.');
  assert.equal(partialLine(1), '1 item shown. This is a partial read, not the full count.');
  assert.equal(partialLine(null), 'This is a partial read, not the full count.');
  assert.equal(filterCount({ area: 'Cap table', source: '', claim: 'backed' }), 2);
});

test('the item sheet’s facts: each in the canvas order, and a fact the read did not carry says why, never a blank', () => {
  const facts = Object.fromEntries(itemFacts(ITEM({ stale: true })).map(([k, v, why]) => [k, v ?? `NR:${why}`]));
  assert.deepEqual(Object.keys(facts), ['Area', 'Kind', 'Source', 'Provider', 'Strength', 'Observed', 'Shared', 'Summary']);
  assert.equal(facts.Provider, 'The company’s bank');
  assert.equal(facts.Observed, '1 Oct 2026 · stale');
  assert.equal(facts.Shared, 'After the NDA');
  const bare = Object.fromEntries(itemFacts(ITEM({ provider: null, strength: null, observed_on: null, summary: null, sharing: 'summary' })).map(([k, v, why]) => [k, v ?? `NR:${why}`]));
  assert.equal(bare.Provider, 'NR:No provider recorded for this item');
  assert.equal(bare.Strength, 'NR:No strength recorded');
  assert.equal(bare.Observed, 'NR:No date recorded for this item');
  assert.equal(bare.Summary, 'NR:No summary recorded');
  assert.equal(bare.Shared, 'Summary only');
  assert.equal(noteDraft(ITEM()), 'Re: Runway from the bank · Fundraising readiness\n\n');
});

// ---------------------------------------------------------------- DE19 · before the NDA

test('DE19: before the NDA, counts only — the coverage table with its totals, the lock line, Sign the NDA; no value, item or claim', () => {
  const out = html(h(DealEvidence, { read: BEFORE({ items: { state: 'recorded', rows: ITEMS() }, claims: CLAIMS }), ndaHref: '/deals/42/documents' }));
  assert.match(out, /data-stage="before"/);
  assert.match(out, /Before the NDA · counts only/);
  assert.match(out, /Evidence the founder has shared/);
  assert.match(out, /Figures, files and quotes open once the NDA is signed\./);
  assert.equal((out.match(/data-testid="evidence-tile"/g) || []).length, 3);
  assert.match(out, /data-testid="evidence-coverage-total">8</);
  assert.match(out, /3 groups/);
  assert.match(out, /href="\/deals\/42\/documents"[^>]*>Sign the NDA</);
  for (const v of ['14.2', '8,400', 'evidence-row-', 'evidence-card-', 'evidence-claim', 'evidence-filter']) assert.ok(!out.includes(v), v);
  assert.doesNotMatch(html(h(DealEvidence, { read: BEFORE() })), /evidence-sign-nda/, 'staff and others are not offered the NDA');
  const unknown = html(h(DealEvidence, { read: BEFORE({ coverage: { state: 'recorded', groups: [...COVERAGE.groups, { area: 'Legal', kind: 'signed-document', source_label: 'signed', count: null, newest: null }] } }) }));
  assert.doesNotMatch(unknown, /data-testid="evidence-coverage-total">\d/, 'a total is never drawn over an unread count');
  assert.match(html(h(DealEvidence, { read: BEFORE({ coverage: { state: 'recorded', groups: [] } }) })), /evidence-coverage-empty/);
  const failed = html(h(DealEvidence, { read: BEFORE({ coverage: { state: 'unreadable', reason: 'x' } }), onRetry: () => {} }));
  assert.match(failed, /data-testid="evidence-coverage-unreadable"/);
  assert.match(failed, /The coverage counts could not be read\./);
  assert.doesNotMatch(failed, /evidence-coverage-empty/);
});

// ---------------------------------------------------------------- DE20 · after the NDA

test('DE20: the claims line with a count per state, area groups (the first open), items as a table and as phone cards', () => {
  const out = html(h(DealEvidence, { read: AFTER() }));
  assert.match(out, /data-stage="after"/);
  assert.match(out, /data-testid="evidence-claim-tally">1 of 3 shared claims are backed</);
  assert.match(out, /data-testid="evidence-claim-count-mismatch"[^]*?≠<\/span>Does not match<\/span><b[^>]*>1</);
  assert.match(out, /See the 3 claims ›/);
  assert.equal((out.match(/data-testid="evidence-area"/g) || []).length, 3);
  // Sorted by checked date: the area of the newest-checked item comes first in its group order; the first area is open.
  assert.match(out, /data-testid="evidence-row-i-runway"/);
  assert.match(out, /data-testid="evidence-card-i-runway"/);
  assert.doesNotMatch(out, /evidence-row-i-mrr/, 'a closed area draws no rows');
  assert.match(out, /14\.2 months/);
  assert.match(out, /Figures appear only for items shared after the NDA\./);
  assert.ok(!out.includes('c-private') && !out.includes('ARR'), 'a claim behind a private item is never drawn');
});

test('DE20 live: filters by area, source and claim state from returned items only; sort; open an area; Show more; clear', async () => {
  const many = [...ITEMS(), ...[1, 2, 3, 4].map((n) => ITEM({ uid: `i-r${n}`, observed_on: `2026-08-0${n}` }))];
  const m = await mounted(h(DealEvidence, { read: AFTER({ items: { state: 'recorded', rows: many } }) }));
  try {
    assert.deepEqual(m.ids('evidence-filter-claim-'), ['evidence-filter-claim-backed', 'evidence-filter-claim-mismatch', 'evidence-filter-claim-founders_figure']);
    assert.equal(m.has('evidence-filter-claim-not_backed'), false, 'no chip for a state only a private item carries');
    // The first area (Fundraising readiness, 5 items) shows three, then Show 2 more.
    assert.equal(m.ids('evidence-row-').length, 3);
    await m.click('evidence-area-more-Fundraising readiness');
    assert.equal(m.ids('evidence-row-').length, 5);
    await m.click('evidence-area-toggle-Investor narrative and Pitch deck');
    assert.ok(m.has('evidence-row-i-mrr'));
    await m.click('evidence-claims-toggle');
    assert.match(m.textOf('evidence-claims-list'), /MRR.*Pitch deck · checked 8 Oct 2026.*Does not match/);
    assert.match(m.textOf('evidence-claims-list'), /Product-market fit.*Not checked yet/);
    await m.change('evidence-filter-area', 'Investor narrative and Pitch deck');
    assert.deepEqual(m.ids('evidence-area-toggle-'), ['evidence-area-toggle-Investor narrative and Pitch deck']);
    assert.equal(m.attr('evidence-area-toggle-Investor narrative and Pitch deck', 'aria-expanded'), true);
    await m.change('evidence-filter-source', 'recorded');
    assert.deepEqual(m.ids('evidence-row-'), ['evidence-row-i-theme']);
    assert.equal(m.textOf('evidence-filters-toggle'), 'Filters · 2');
    await m.click('evidence-filter-claim-backed');
    assert.ok(m.has('evidence-no-match'));
    await m.click('evidence-clear-filters');
    assert.equal(m.has('evidence-no-match'), false);
    await m.change('evidence-sort', 'observed');
    assert.equal(m.attr('evidence-sort', 'value'), 'observed');
  } finally { await m.close(); }
});

// ---------------------------------------------------------------- DE21 · one item

test('DE21: an item opens in a side sheet with its place, figure, facts, File not recorded, its claims and four hand-offs', async () => {
  const m = await mounted(h(DealEvidence, { read: AFTER(), actions: ACTIONS }));
  try {
    await m.click('evidence-open-i-runway');
    assert.ok(m.has('evidence-item'));
    assert.match(m.all(), /Fundraising readiness · item 1 of 1/);
    assert.equal(m.textOf('evidence-item-figure'), '14.2 months');
    assert.match(m.textOf('evidence-item-facts'), /ProviderThe company’s bank/);
    assert.match(m.textOf('evidence-item-file'), /Not recorded.*No link from an item to its data-room file is recorded/);
    assert.match(m.textOf('evidence-item-claims'), /Runway.*Fundraising readiness · checked 6 Oct 2026.*Backed/);
    assert.equal(m.attr('evidence-item-dataroom', 'href'), '/deals/42/data-room');
    assert.equal(m.attr('evidence-item-diligence', 'href'), '/deals/42/diligence');
    assert.equal(m.attr('evidence-item-notes', 'href'), '/deals/42/notes');
    assert.match(read('frontend/src/pages/cycles/evidence/DealEvidence.jsx'), /state=\{key === 'notes' \? \{ evidenceNote: noteDraft\(item\) \} : undefined\}/);
    assert.equal(m.attr('evidence-item-scorecard', 'href'), '/deals/42/scorecard');
    await m.click('evidence-item-close');
    assert.equal(m.has('evidence-item'), false);
    await m.click('evidence-area-toggle-Cap table');
    await m.click('evidence-card-open-i-safe');
    assert.equal(m.textOf('evidence-item-reason'), 'One investor’s money is not shown to another investor.');
    assert.equal(m.has('evidence-item-figure'), false);
    assert.ok(m.has('evidence-item-no-claims'));
  } finally { await m.close(); }
  const staff = await mounted(h(DealEvidence, { read: AFTER() }));
  try {
    await staff.click('evidence-open-i-runway');
    assert.equal(staff.has('evidence-item-diligence'), false, 'no hand-offs without an investor’s actions');
  } finally { await staff.close(); }
});

// ---------------------------------------------------------------- DE22 · states

test('DE22: empty asks the founder from Diligence; partial above the claims line; a failed block is never none or zero', () => {
  const empty = html(h(DealEvidence, { read: AFTER({ items: { state: 'recorded', rows: [] } }), actions: ACTIONS }));
  assert.match(empty, /The founder has not shared any evidence yet\./);
  assert.match(empty, /href="\/deals\/42\/diligence"[^>]*>Send a request to the founder</);
  assert.doesNotMatch(empty, /evidence-filters/);
  assert.doesNotMatch(html(h(DealEvidence, { read: AFTER({ items: { state: 'recorded', rows: [] } }) })), /Send a request/);
  const partial = html(h(DealEvidence, { read: AFTER({ partial: true }), onRetry: () => {} }));
  assert.match(partial, /Some items could not be read\. The rest are shown\./);
  assert.match(partial, /4 items shown\. This is a partial read, not the full count\./);
  assert.ok(partial.indexOf('evidence-partial') < partial.indexOf('evidence-claim-tally'), 'the banner sits above the claims line');
  const noItems = html(h(DealEvidence, { read: AFTER({ items: { state: 'unreadable', reason: 'x' } }), onRetry: () => {} }));
  assert.match(noItems, /The shared items could not be read\.<\/b><span[^>]*>That is not the same as none being shared\./);
  assert.doesNotMatch(noItems, /evidence-claim-tally|evidence-items-empty|0 of/);
  const noClaims = html(h(DealEvidence, { read: AFTER({ claims: { state: 'unreadable', reason: 'y' } }), onRetry: () => {} }));
  assert.match(noClaims, /The claims these items back could not be read\./);
  assert.match(noClaims, /14\.2 months/, 'items still draw when claims fail');
  assert.doesNotMatch(noClaims, /evidence-claim-tally|evidence-filter-claim-/);
  const whole = html(h(DealEvidence, { read: { state: 'unreadable', reason: 'z' }, onRetry: () => {} }));
  assert.match(whole, /data-stage="unreadable"/);
  assert.match(whole, /The shared evidence could not be read\.<\/b><span[^>]*>That is not the same as none being shared\./);
  assert.equal(html(h(DealEvidence, { read: null })), '');
});

test('the tab: a skeleton while reading; a failed read retries; staff read the investor’s projection with no hand-offs', async () => {
  const calls = [];
  const api = (answers) => ({ forDeal: async (id) => { calls.push(id); const a = answers.shift(); if (a instanceof Error) throw a; return a; } });
  assert.match(html(h(EvidenceSummary, { dealId: 42, api: { forDeal: () => new Promise(() => {}) } })), /aria-busy="true"[^>]*data-testid="evidence-loading"[^]*Reading the shared evidence…/);
  const u = await mounted(h(EvidenceSummary, { dealId: 42, role: 'investor', api: api([err(503, 'unreadable'), BEFORE()]) }));
  try {
    assert.equal(u.attr('evidence-summary', 'data-stage'), 'unreadable');
    await u.retry('evidence-unreadable');
    assert.deepEqual(calls, [42, 42]);
    assert.equal(u.attr('evidence-summary', 'data-stage'), 'before');
  } finally { await u.close(); }
  const i = await mounted(h(EvidenceSummary, { dealId: 42, role: 'investor', ndaHref: '/deals/42/documents', api: api([AFTER()]) }));
  try {
    await i.click('evidence-open-i-runway');
    assert.equal(i.attr('evidence-item-dataroom', 'href'), '/deals/42/data-room');
  } finally { await i.close(); }
  const s = await mounted(h(EvidenceSummary, { dealId: 42, role: 'admin', api: api([AFTER({ reader: 'staff' })]) }));
  try {
    assert.ok(s.has('evidence-staff-read'));
    await s.click('evidence-open-i-runway');
    assert.equal(s.has('evidence-item-dataroom'), false);
  } finally { await s.close(); }
});

// ---------------------------------------------------------------- DE30a, DE31a and the wiring

test('phone and dark: cards below 1024px with 44px targets, the table only from 1024px; every light surface has its dark pair; no pop-up', () => {
  const src = read('frontend/src/pages/cycles/evidence/DealEvidence.jsx');
  assert.match(src, /<table className="hidden w-full border-collapse lg:table"/);
  assert.match(src, /className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden"/);
  assert.match(src, /min-h-\[44px\] w-full flex-col/, 'a phone card is one 44px target');
  assert.match(src, /max-lg:min-h-\[44px\]/);
  for (const m of src.matchAll(/\bbg-white\b/g)) assert.match(src.slice(m.index, m.index + 260), /dark:bg-/);
  for (const m of src.matchAll(/hover:bg-gray-50/g)) assert.match(src.slice(m.index, m.index + 120), /dark:hover:bg-/);
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(|window\.open|localStorage|console\./);
  assert.doesNotMatch(src, /(bg|text|border)-\[#/);
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/\.\.\/ui'/, 'no ui index');
  const tab = read('frontend/src/pages/cycles/evidence/InvestorEvidence.jsx');
  assert.match(tab, /<DealEvidence key=\{dealId\} read=\{r\.data\}/);
  assert.match(tab, /role === 'investor' \? \{/);
  assert.match(read('documentation/architecture/decisions/D6164.md'), /^## D6164 — /m);
});
