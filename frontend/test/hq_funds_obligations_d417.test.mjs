/**
 * D417 — HQ · Funds raises a fund's next filing deadline from F2's store.
 *
 * The Worker half is cloudflare-worker/test/entity_obligations_d417.test.ts.
 * This pins the page: an overdue deadline is a bad flag, one due within
 * OBLIGATION_SOON_DAYS a warning, anything later or none raises nothing; and
 * the feed's line counts deadlines on record apart from funds with none
 * recorded and funds that do not report it, and names a source whose store
 * was unreadable rather than counting it as clear.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_funds_obligations_d417.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  OBLIGATION_SOON_DAYS, ObligationsNote, fundFlags, flagFeed, obligationFlag, obligationsSummary,
} from '../src/pages/hq/HqFundsPage.jsx';

const ENTITY = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const text = (h) => h.replace(/<[^>]+>/g, ' ')
  .replace(/&(?:#x27|quot|amp|lt|gt);/g, (e) => ENTITY[e]).replace(/\s+/g, ' ').trim();

const REASON = 'NR-OBL: link an entity.';
const READS = { complete: true, periods_available: true, calls_available: true, distributions_available: true, entities_available: true, obligations_available: true };
const ob = (days_left, kind = 'franchise_tax') => ({ kind, due_date: '2027-06-01', days_left });
const fund = (over) => ({
  id: 1, name: 'Harbor Fund I', status: 'investing', gp_entity: 'Harbor GP LLC', vintage_year: 2024,
  committed_minor: 100_00, committed_source: 'fund_size_cents', last_issued: null,
  called_minor: 0, called_ratio: 0, distributed_minor: 0, dpi: null, jurisdiction: null, gp_entity_jurisdiction: null,
  next_obligation: null,
  flags: { no_gp_of_record: false, custodian_recorded: true, gp_fields_unset: [], lpa_on_file: true, draft_not_issued: null },
  ...over,
});
const payload = (hqFunds, hqExtra = {}, branches = []) => ({
  hq: { code: 'hq', status: 'ok', data: { ...READS, funds: hqFunds, ...hqExtra } },
  branches, branches_coverage: { total: branches.length, answered: branches.length },
  not_recorded: { obligations: REASON },
});
const branch = (code, data) => ({ code, label: `Branch ${code.toUpperCase()}`, status: 'ok', data: { ...READS, ...data } });

test('D417: overdue is bad, due within the window a warning, later or none raises nothing', () => {
  assert.equal(OBLIGATION_SOON_DAYS, 30);
  assert.deepEqual(obligationFlag(fund({ next_obligation: ob(-3) })),
    { key: 'obligation', what: 'Franchise tax overdue', detail: 'due 2027-06-01, 3 days ago', tone: 'bad' });
  assert.equal(obligationFlag(fund({ next_obligation: ob(-1) })).detail, 'due 2027-06-01, 1 day ago');
  assert.deepEqual(obligationFlag(fund({ next_obligation: ob(12, 'regulatory_filing') })),
    { key: 'obligation', what: 'Regulatory filing due in 12 days', detail: 'due 2027-06-01', tone: 'warn' });
  assert.equal(obligationFlag(fund({ next_obligation: ob(0) })).what, 'Franchise tax due today');
  assert.equal(obligationFlag(fund({ next_obligation: ob(1) })).what, 'Franchise tax due in 1 day');
  assert.equal(obligationFlag(fund({ next_obligation: ob(30) })).tone, 'warn', 'the window includes its last day');
  assert.equal(obligationFlag(fund({ next_obligation: ob(31) })), null);
  assert.equal(obligationFlag(fund({ next_obligation: null })), null);
  assert.equal(obligationFlag(fund({ next_obligation: undefined })), null);
  assert.equal(obligationFlag(fund({ next_obligation: ob(5, 'something_new') })).what, 'Filing due in 5 days');
});

test('D417: the flag sits in the fund\'s flags after No GP of record, and the feed puts overdue first', () => {
  const f = fund({ next_obligation: ob(-2), flags: { ...fund().flags, no_gp_of_record: true } });
  assert.deepEqual(fundFlags(f).map((x) => x.key).slice(0, 2), ['no_gp', 'obligation']);
  const feed = flagFeed(payload([
    fund({ id: 1, name: 'Soon Fund', next_obligation: ob(10) }),
    fund({ id: 2, name: 'Late Fund', next_obligation: ob(-4) }),
  ]));
  assert.deepEqual(feed.map((x) => `${x.tone}:${x.what}`), ['bad:Franchise tax overdue', 'warn:Franchise tax due in 10 days']);
});

test('D417: the line counts on record, none recorded and not reported apart, and prints the reason', () => {
  const p = payload([
    fund({ id: 1, next_obligation: ob(10) }),
    fund({ id: 2, next_obligation: null }),
    fund({ id: 3, next_obligation: null }),
  ], {}, [branch('uk', { funds: [fund({ id: 4, next_obligation: undefined })] })]);
  assert.deepEqual(obligationsSummary(p), { unreadable: [], recorded: 1, none: 2, not_reported: 1 });
  const html = renderToStaticMarkup(createElement(ObligationsNote, { payload: p }));
  assert.equal(text(html), 'Filing deadlines: 1 fund with an open deadline on record; 2 Not recorded ; 1 Not reported . NR-OBL: link an entity.');
  assert.ok(!html.includes('hq-funds-obligations-unreadable'));
});

test('D417: a source whose store was unreadable is named, and its funds are not counted as none', () => {
  const p = payload([fund({ id: 1, next_obligation: null })], {}, [
    branch('fr', { obligations_available: false, obligations_reason: 'gone', funds: [fund({ id: 5, next_obligation: undefined })] }),
  ]);
  assert.deepEqual(obligationsSummary(p), { unreadable: ['Branch FR'], recorded: 0, none: 1, not_reported: 0 });
  const html = renderToStaticMarkup(createElement(ObligationsNote, { payload: p }));
  assert.match(text(html), /^Filing deadlines could not be read for Branch FR\. That is not a claim that none are due\. Filing deadlines: 0 funds with/);
});
