/**
 * D752 §4 (#1988): "Spending from Mercury" on the founder's revenue page and
 * the "From Mercury" badge on saved rows there and on MetricsPage.
 *   · the model: months newest first, financing printed beside operating money
 *     in and never counted in burn, runway or "Not burning", Partial at the
 *     read cap with no runway, an unread balance Not recorded and never $0;
 *   · the save: cash off by default, the Worker's visibility sentence, nothing
 *     sent until it is confirmed, each refusal printed as the Worker wrote it;
 *   · the badge: a Mercury row is badged and offers delete only;
 *   · the words, the icon, and where the card is drawn.
 * Names and amounts are invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_spend_screens_d752.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument, mountContracts } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { mercuryPersonalApi } from '../src/lib/api/mercuryPersonal.js';
import MercurySpendCard, { MercurySourceBadge, MercurySpendSheet, MercurySpendView, SpendSaveView } from '../src/components/spinout/MercurySpend.jsx';
import {
  CONFIRM_LABEL, FINANCING_NOTE, INCLUDE_CASH_LABEL, LOCKED_BADGE, LOCKED_TITLE, NOT_BURNING, PARTIAL_NOTE, SAVE_START,
  cashTile, fmtSpendCents, isMercuryRow, runwayTile, saveRefusal, savedLine, skippedLine, snapshotRequest, spendMonthRows, unreadableLine,
} from '../src/lib/mercurySpend.js';
import { NEVER_ROWS, USE_WORDS, landsWords } from '../src/pages/account/mercuryModel.js';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const noop = new Proxy({}, { get: () => () => {} });

// The Worker's sentence (services/mercurySpend.ts SPEND_VISIBILITY), as it arrives.
const VISIBILITY = 'Saved figures are read wherever your metrics are read: by Axal\'s admins and partners, on your Grow and Raise pages, in the investor updates you send, and in the drafts you ask the assistant for.';
const month = (m, over = {}) => ({
  month: m, partial: false, reason: null,
  operating_in_cents: 400000, financing_in_cents: 5000000, out_cents: 1600000, net_burn_cents: 1200000,
  lines: { posted: 9, pending: 0, failed: 0, internal: 0 },
  top_counterparties: [{ name: 'Cloud Host Co', out_cents: 900000, lines: 2 }, { name: null, out_cents: 100000, lines: 1 }],
  categories: null, ...over,
});
const RES = (over = {}) => ({
  currency: 'USD',
  window: { from: '2026-06-01', to: '2026-10-19' },
  months: [
    month('2026-08', { reason: 'no_lines', operating_in_cents: null, financing_in_cents: null, out_cents: null, net_burn_cents: null, lines: { posted: 0, pending: 2, failed: 0, internal: 0 }, top_counterparties: [] }),
    month('2026-09', { lines: { posted: 9, pending: 2, failed: 1, internal: 3 } }),
    month('2026-10', { partial: true }),
  ],
  last_full_month: '2026-09',
  cash: { cents: 36000000, as_of: '2026-10-19', accounts_counted: 2, accounts_unreadable: 0 },
  runway: { months: 30, reason: null, from: ['2026-07', '2026-08', '2026-09'], average_net_burn_cents: 1200000 },
  partial: false, lines_read: 40, unreadable_lines: 0,
  save: { month: '2026-09', visibility: VISIBILITY },
  ...over,
});
const view = (res, extra = {}) => ssr(h(MercurySpendView, { state: { read: { status: 'ok', data: res }, months: 6, form: SAVE_START, busy: false, err: '', result: null, ...extra }, on: noop }));

// ─────────────────────────────────────────────────────────── the model

test('months: newest first, the current month marked so far, a month without posted lines has no figures (never $0)', () => {
  const rows = spendMonthRows(RES());
  assert.deepEqual(rows.map((r) => r.month), ['2026-10', '2026-09', '2026-08']);
  assert.equal(rows[0].label, 'Oct 2026 (so far)');
  assert.equal(rows[1].label, 'Sep 2026');
  assert.equal(rows[2].noLines, true);
  assert.deepEqual([rows[2].operatingIn, rows[2].financingIn, rows[2].out, rows[2].netBurn], [null, null, null, null]);
  assert.equal(rows[1].noLines, false);
  assert.equal(rows[1].skipped, 'Not counted: 2 pending, 1 failed, 3 internal transfers.');
  assert.equal(skippedLine({ posted: 4, pending: 0, failed: 0, internal: 0 }), null);
  assert.deepEqual(rows[1].payees, [{ name: 'Cloud Host Co', out: '$9,000', lines: 2 }, { name: null, out: '$1,000', lines: 1 }]);
  assert.deepEqual(spendMonthRows({}), []);
});

test('financing is its own figure and never counted in burn: net burn is the Worker\'s, not out less all money in', () => {
  const [, sep] = spendMonthRows(RES());
  assert.equal(sep.operatingIn, '$4,000');
  assert.equal(sep.financingIn, '$50,000');
  assert.equal(sep.out, '$16,000');
  assert.equal(sep.netBurn, '$12,000', 'out $16,000 less operating $4,000; the $50,000 of financing is not subtracted');
  const t = text(view(RES()));
  assert.ok(t.includes(`Financing in (${FINANCING_NOTE})`));
  assert.equal(FINANCING_NOTE, 'not counted in burn');
  assert.equal(fmtSpendCents(-50000), '−$500');
  assert.equal(fmtSpendCents(12345), '$123.45');
  assert.equal(fmtSpendCents(1.5), null);
});

test('runway: months, or "Not burning", or Not recorded with the reason; Partial at the cap shows none', () => {
  assert.deepEqual(runwayTile(RES()), { kind: 'months', value: '30 months', reason: null, sub: 'From Jul 2026, Aug 2026, Sep 2026.' });
  assert.equal(runwayTile(RES({ runway: { months: 1, reason: null, from: [] } })).value, '1 month');
  const nb = runwayTile(RES({ runway: { months: null, reason: 'not_burning', from: ['2026-09'] } }));
  assert.equal(nb.kind, 'not_burning');
  assert.equal(nb.value, NOT_BURNING);
  assert.equal(NOT_BURNING, 'Not burning');
  const short = runwayTile(RES({ runway: { months: null, reason: 'needs_three_months', from: [] } }));
  assert.equal(short.value, null);
  assert.match(short.reason, /three full months/);
  assert.match(runwayTile(RES({ runway: { months: null, reason: 'cash_not_read', from: [] } })).reason, /did not give an available balance/);
  const partial = runwayTile(RES({ partial: true }));
  assert.equal(partial.kind, 'partial');
  assert.equal(partial.value, null, 'a months figure from the Worker is never drawn on a partial read');
  assert.equal(runwayTile(RES({ runway: { months: null, reason: 'partial', from: [] } })).kind, 'partial');
  assert.match(PARTIAL_NOTE, /1,000/);
});

test('cash: the Worker\'s figure with its accounts, or Not recorded with the reason, never $0', () => {
  assert.deepEqual(cashTile(RES()), { value: '$360,000', reason: null, sub: 'On 2026-10-19, across 2 accounts.' });
  const none = cashTile(RES({ cash: { cents: null, as_of: '2026-10-19', accounts_counted: 0, accounts_unreadable: 1 } }));
  assert.equal(none.value, null);
  assert.match(none.reason, /did not give an available balance/);
  assert.equal(none.sub, '1 account gave no balance and is not counted.');
  assert.match(cashTile(RES({ cash: { cents: 100, as_of: 'x', accounts_counted: 1, accounts_unreadable: 2 } })).sub, /2 accounts gave no balance and are not counted\./);
  assert.equal(unreadableLine(RES({ unreadable_lines: 3 })), '3 lines could not be read and are not counted.');
  assert.equal(unreadableLine(RES()), null);
});

test('the sheet: months, cash, runway and payees; Partial says so and draws no runway figure', () => {
  const full = view(RES());
  const t = text(full);
  for (const s of ['Oct 2026 (so far)', 'Sep 2026', '$360,000', '30 months', 'Cloud Host Co', 'No counterparty given', 'Not counted: 2 pending, 1 failed, 3 internal transfers.', 'Shown only to you. Saved only when you choose.']) assert.ok(t.includes(s), s);
  assert.match(full, /data-testid="spend-month-2026-08"[\s\S]*?Not recorded/);
  assert.doesNotMatch(full, /data-testid="spend-partial"/);
  const part = view(RES({ partial: true, runway: { months: null, reason: 'partial', from: [] } }));
  assert.match(part, /data-testid="spend-partial"/);
  assert.ok(text(part).includes(PARTIAL_NOTE));
  assert.doesNotMatch(text(part), /30 months/);
  const nb = text(view(RES({ runway: { months: null, reason: 'not_burning', from: ['2026-09'] } })));
  assert.ok(nb.includes('Runway Not burning'));
});

test('the read\'s failures: no connection Not recorded with Connectors, a refusal said, anything else Unreadable', () => {
  const v = (outcome) => ssr(h(MercurySpendView, { state: { read: { status: 'failed', outcome }, months: 6, form: SAVE_START }, on: noop }));
  const none = v({ kind: 'not_recorded', reason: 'Connect your own Mercury account first, with a Read Only token.' });
  assert.match(none, /Not recorded/);
  assert.match(none, /href="\/account\/connectors\/mercury"/, 'D753 F8 (#1992): Mercury\'s own page');
  assert.match(v({ kind: 'refused', reason: 'Only the startup\'s founder can read its spending.' }), /data-testid="spend-refused">Only the startup&#x27;s founder/);
  const bad = text(v({ kind: 'unreadable' }));
  assert.ok(bad.includes('This is not a claim that you spent nothing.'));
  assert.doesNotMatch(bad, /\$0/);
});

// ─────────────────────────────────────────────────────────── the save

test('save: cash is off by default, nothing is asked without the confirmation, and cash only when ticked', () => {
  assert.deepEqual(SAVE_START, { includeCash: false, confirmed: false });
  assert.equal(snapshotRequest(SAVE_START), null);
  assert.equal(snapshotRequest({ includeCash: true, confirmed: false }), null);
  assert.equal(snapshotRequest({ includeCash: true, confirmed: 'yes' }), null, 'only true confirms');
  assert.deepEqual(snapshotRequest({ includeCash: false, confirmed: true }), { include_cash: false });
  assert.deepEqual(snapshotRequest({ includeCash: true, confirmed: true }), { include_cash: true });
  assert.deepEqual(snapshotRequest({ includeCash: 'on', confirmed: true }), { include_cash: false });
});

test('save: the Worker\'s visibility sentence as written, both boxes unticked, and the button waits for the confirmation', () => {
  const html = view(RES());
  assert.match(html, new RegExp(`data-testid="spend-visibility">${VISIBILITY.replace(/'/g, '&#x27;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  assert.ok(text(html).includes("Save Sep 2026's net burn to Grow"));
  assert.ok(text(html).includes(INCLUDE_CASH_LABEL) && text(html).includes(CONFIRM_LABEL));
  assert.doesNotMatch(html, /checked=""/, 'no box starts ticked');
  assert.match(html, /disabled=""[^>]*data-testid="spend-save-button"[^>]*>Confirm who will see it first</);
  const unset = ssr(h(SpendSaveView, { month: '2026-09', visibility: VISIBILITY, form: {}, on: noop }));
  assert.doesNotMatch(unset, /checked=""/, 'a form that never said cash does not tick it');
  const ready = ssr(h(SpendSaveView, { month: '2026-09', visibility: VISIBILITY, form: { includeCash: false, confirmed: true }, on: noop }));
  assert.doesNotMatch(ready, /disabled=""[^>]*data-testid="spend-save-button"/);
  assert.match(ready, />Save to Grow</);
});

test('save: each refusal is printed as the Worker wrote it; anything else says nothing was saved', () => {
  const vis = Object.assign(new Error('Confirm who will see the saved figures before saving them.'), { status: 400, code: 'visibility_confirm_required' });
  const lock = Object.assign(new Error('This snapshot was read from your Mercury, so its date and figures cannot be edited. Delete it and save a new one. Nothing was changed.'), { status: 409, code: 'mercury_figure_locked' });
  assert.equal(saveRefusal(vis), vis.message);
  assert.equal(saveRefusal(lock), lock.message);
  assert.equal(saveRefusal(Object.assign(new Error('boom'), { status: 500 })), 'The figures could not be saved. Nothing was saved. Try again.');
  assert.equal(saveRefusal(new TypeError('network')), 'The figures could not be saved. Nothing was saved. Try again.');
  assert.equal(savedLine({ month: '2026-09', net_burn: 12000, cash_balance: null }), "Saved Sep 2026's net burn of $12,000 to Grow, marked From Mercury.");
  assert.equal(savedLine({ month: '2026-09', net_burn: 12000, cash_balance: 360000.5 }), "Saved Sep 2026's net burn of $12,000 and cash on hand of $360,000.50 to Grow, marked From Mercury.");
});

async function sheet(save) {
  const calls = [];
  const api = {
    spend: async (...a) => { calls.push(['spend', ...a]); return RES(); },
    saveSpendSnapshot: async (...a) => { calls.push(['save', ...a]); return save(); },
  };
  const v = await mountContracts(h(MercurySpendSheet, { projectId: 7, api, onClose() {} }), '/spinout/revenue');
  await v.flush(); await v.flush();
  const byId = (id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
  const tick = async (id, checked) => { await act(async () => v.props(byId(id)).onChange({ target: { checked } })); };
  const press = async () => { await act(async () => v.props(byId('spend-save-button')).onClick({ stopPropagation() {} })); await v.flush(); };
  return { v, calls, tick, press };
}

test('mounted: the sheet reads 6 months; a press before the confirmation sends nothing; then it sends cash only when ticked', async () => {
  const s = await sheet(() => ({ ok: true, id: 1, snapshot_date: '2026-10-19', month: '2026-09', net_burn: 12000, cash_balance: null, source: 'mercury' }));
  try {
    assert.deepEqual(s.calls, [['spend', 7, 6]]);
    await s.press();
    assert.equal(s.calls.length, 1, 'nothing is sent without the confirmation');
    await s.tick('spend-include-cash', true);
    await s.press();
    assert.equal(s.calls.length, 1, 'ticking cash is not a confirmation');
    await s.tick('spend-include-cash', false);
    await s.tick('spend-confirm', true);
    await s.press();
    assert.deepEqual(s.calls[1], ['save', 7, { include_cash: false }]);
    assert.match(s.v.text(), /Saved Sep 2026's net burn of \$12,000 to Grow/);
    await s.press();
    assert.equal(s.calls.length, 2, 'the confirmation is asked again for the next save');
    await s.tick('spend-include-cash', true);
    await s.tick('spend-confirm', true);
    await s.press();
    assert.deepEqual(s.calls[2], ['save', 7, { include_cash: true }]);
  } finally { await s.v.unmount(); }
});

test('mounted: the Worker\'s refusals are printed, visibility_confirm_required and mercury_figure_locked alike', async () => {
  for (const [code, status, message] of [
    ['visibility_confirm_required', 400, 'Confirm who will see the saved figures before saving them.'],
    ['mercury_figure_locked', 409, 'This snapshot was read from your Mercury, so its date and figures cannot be edited. Delete it and save a new one. Nothing was changed.'],
  ]) {
    const s = await sheet(() => { throw Object.assign(new Error(message), { status, code }); });
    try {
      await s.tick('spend-confirm', true);
      await s.press();
      assert.ok(s.v.text().includes(message), code);
    } finally { await s.v.unmount(); }
  }
});

test('the API: spend reads the months asked; the save carries include_cash and confirm_visible: true', async () => {
  const restore = installDocument();
  const seen = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { seen.push([String(url), init.method || 'GET', init.body ?? null]); return new Response('{"months":[]}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await mercuryPersonalApi.spend(7, 12);
    await mercuryPersonalApi.spend(7);
    await mercuryPersonalApi.saveSpendSnapshot(7, { include_cash: true });
    await mercuryPersonalApi.saveSpendSnapshot(7);
  } finally { globalThis.fetch = was; restore(); }
  assert.match(seen[0][0], /\/api\/revenue\/projects\/7\/mercury-spend\?months=12$/);
  assert.match(seen[1][0], /\/api\/revenue\/projects\/7\/mercury-spend$/);
  assert.equal(seen[2][1], 'POST');
  assert.match(seen[2][0], /\/api\/revenue\/projects\/7\/mercury-spend\/snapshot$/);
  assert.deepEqual(JSON.parse(seen[2][2]), { include_cash: true, confirm_visible: true });
  assert.deepEqual(JSON.parse(seen[3][2]), { include_cash: false, confirm_visible: true });
});

// ─────────────────────────────────────────────────────────── the badge

test('the badge: "From Mercury" with the lock\'s reason, on Mercury rows only', () => {
  const html = renderToStaticMarkup(h(MercurySourceBadge));
  assert.ok(text(html).includes(LOCKED_BADGE));
  assert.equal(LOCKED_BADGE, 'From Mercury');
  assert.ok(html.includes(`title="${LOCKED_TITLE}"`));
  assert.equal(isMercuryRow({ source: 'mercury' }), true);
  assert.equal(isMercuryRow({ source: ' Mercury ' }), true);
  assert.equal(isMercuryRow({ source: 'stripe' }), false);
  assert.equal(isMercuryRow({ source: 'manual' }), false);
  assert.equal(isMercuryRow(null), false);
});

const page = (rel) => codeOnly(readFileSync(`frontend/src/${rel}`, 'utf8'));
/** The JSX of one snapshot row, from its `<tr key={s.id}` to its `</tr>`. */
const rowOf = (src) => { const a = src.indexOf('<tr key={s.id}'); return src.slice(a, src.indexOf('</tr>', a)); };

test('the badge: delete only — each page badges a Mercury row and offers it no edit', () => {
  for (const rel of ['pages/SpinoutLabRevenuePage.jsx', 'pages/MetricsPage.jsx']) {
    const src = page(rel);
    const row = rowOf(src);
    assert.match(row, /\{isMercuryRow\(s\) \? <MercurySourceBadge \/> : \(/, rel);
    assert.match(row, /deleteSnapshot\(s\.id\)|handleDelete\(s\.id\)/, `${rel}: delete is offered`);
    assert.doesNotMatch(row, /\b[Ee]dit\b|Pencil|PATCH|updateMetricsSnapshot/, `${rel}: no edit on a row`);
    assert.doesNotMatch(src, /updateMetricsSnapshot|method: 'PATCH'/, `${rel}: no snapshot edit anywhere on the page`);
  }
  const rev = page('pages/SpinoutLabRevenuePage.jsx');
  assert.match(rev, /filter === 'mercury' \? isMercuryRow\(s\) : s\.source !== 'stripe' && !isMercuryRow\(s\)/, 'a Mercury row is not filed under Manual');
});

// ─────────────────────────────────────────────────────────── the words, the icon, the card

test('the words: the spending use, and the founder\'s never row and landing say shown only to you, saved only when you choose', () => {
  assert.match(USE_WORDS.venture_spend, /spending, burn, cash and runway/);
  assert.ok(NEVER_ROWS.founder[2].includes('shown only to you; saved only when you choose'));
  assert.doesNotMatch(NEVER_ROWS.founder.join(' '), /never your balance/);
  assert.match(NEVER_ROWS.partner[2], /never your balance/, 'the partner keeps theirs');
  assert.ok(landsWords('founder').includes('shown only to you; saved only when you choose'));
  const words = [CONFIRM_LABEL, INCLUDE_CASH_LABEL, PARTIAL_NOTE, LOCKED_TITLE, NOT_BURNING].join(' ');
  assert.doesNotMatch(words, /advis|advice|recommend|fiduciar/i);
});

test('the icon and the card: the Mercury monogram, beside Stripe\'s, drawn for the founder only', () => {
  const card = ssr(h(MercurySpendCard, { projectId: 7 }));
  assert.match(card, /data-brand="monogram" data-provider="mercury"/);
  assert.ok(text(card).includes('Spending from Mercury'));
  const sheetSrc = readFileSync('frontend/src/components/spinout/MercurySpend.jsx', 'utf8');
  assert.equal((sheetSrc.match(/<BrandIcon provider="mercury" name="Mercury"/g) || []).length, 2);
  const rev = page('pages/SpinoutLabRevenuePage.jsx');
  const stripe = rev.indexOf('data-testid="source-stripe"');
  const mercury = rev.indexOf('<MercurySpendCard');
  const manual = rev.indexOf('data-testid="source-manual"');
  assert.ok(stripe > 0 && mercury > stripe && manual > mercury, 'the Mercury card sits right after Stripe\'s');
  assert.match(rev, /\{canEdit && <MercurySpendCard projectId=\{project\.id\} onSaved=\{\(\) => loadSnapshots\(project\.id\)\} \/>\}/);
});
