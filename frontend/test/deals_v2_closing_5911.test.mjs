/**
 * D4815 part 8 (#5911, canvas DX8, board DE08 A) — `/deals/closing` as a
 * deal-first list with the KPI strip.
 *
 *   · the strip is five figures (Deals at closing, Paper executed, Signatures
 *     outstanding, Blocking conditions, Transfers recorded), each counted from
 *     a read; a figure whose read failed is Unreadable, never 0;
 *   · the list is one row per deal at closing: investment, closing progress,
 *     signatures outstanding, open conditions, transfer state, and Open;
 *   · the empty state reads "No deals are currently in closing.";
 *   · paper reads in the agreement lifecycle's words: completed is Executed;
 *   · the joins live in one model, so #6157's closing-overview read is a
 *     one-place swap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  LOADING, UNREADABLE, ready, closingRows, closingKpis, paperWord, figureWord,
  investmentOf, progressOf, outstandingOf, EMPTY_TITLE, EMPTY_BODY, WAITS_ON_OVERVIEW,
} from '../src/pages/investor/deals/closingListModel.js';
import { AGREEMENT_STATES } from '../src/lib/contractLifecycle.js';
import { KpiTile, ClosingDealRow } from '../src/pages/investor/deals/ClosingZone.jsx';

const read = (rel) => readFileSync(rel, 'utf8');
const ZONE = codeOnly(read('frontend/src/pages/investor/deals/ClosingZone.jsx'));
const MODEL = codeOnly(read('frontend/src/pages/investor/deals/closingListModel.js'));

const DEALS = [
  { id: 1, status: 'funded', project_name: 'Northwind Labs', capital_committed: 100000, currency: 'EUR' },
  { id: 2, status: 'funded', project_name: 'Quayside Pay', capital_committed: 0, currency: 'USD' },
  { id: 3, status: 'active', project_name: 'Acme Robotics', capital_committed: 5000, currency: 'USD' },
];
const ENVELOPES = [
  { deal_id: 1, status: 'completed', recipient_count: 2, signed_count: 2 },
  { deal_id: 1, status: 'completed', recipient_count: 2, signed_count: 2 },
  { deal_id: 1, status: 'sent', recipient_count: 3, signed_count: 1 },
  { deal_id: 2, status: 'draft', recipient_count: 2, signed_count: 0 },
  { deal_id: 2, status: 'sent', recipient_count: null, signed_count: 0 },
  // Another stage's paper: never counted here.
  { deal_id: 3, status: 'sent', recipient_count: 4, signed_count: 0 },
];
const CONDITIONS = [{ deal_id: 1, uid: 'a' }, { deal_id: 3, uid: 'b' }, { deal_id: null, uid: 'c' }];
const TRANSFERS = [{ deal_id: 2, uid: 't1' }, { deal_id: 3, uid: 't2' }];
const READS = { deals: ready(DEALS), envelopes: ready(ENVELOPES), conditions: ready(CONDITIONS), transfers: ready(TRANSFERS) };
const CHECKLIST = {
  items: [
    ...Array.from({ length: 6 }, (_, i) => ({ uid: `d${i}`, state: 'done' })),
    { uid: 'p', state: 'pending' }, { uid: 'b', state: 'blocked' }, { uid: 's', state: 'skipped' },
  ],
};

const byKey = (reads) => Object.fromEntries(closingKpis(reads).map((k) => [k.key, k]));

test('the strip is DE08’s five figures, each counted from the deals at closing', () => {
  const k = byKey(READS);
  assert.deepEqual(closingKpis(READS).map((x) => x.label),
    ['Deals at closing', 'Paper executed', 'Signatures outstanding', 'Blocking conditions', 'Transfers recorded']);
  // Mutation checked: counting every deal (not only closing) → 3, and this fails.
  assert.equal(k.deals.text, '2');
  // Mutation checked: counting `sent` as executed → "3 of 5".
  assert.equal(k.executed.text, '2 of 5');
  // Deal 1's sent envelope has 2 to come; deal 2's sent envelope records no
  // recipient and is reported apart; deal 3 is another stage. Drafts are not out.
  assert.equal(k.signatures.value, 2);
  assert.match(k.signatures.reason, /1 envelope records no recipient and is not counted/);
  assert.equal(k.blocking.value, 1);
  assert.equal(k.transfers.value, 1);
  for (const x of Object.values(k)) assert.equal(x.state, 'recorded', `${x.key} is not recorded`);
});

test('a figure whose read failed is Unreadable with its read named, never 0', () => {
  for (const [read, keys] of [
    ['envelopes', ['executed', 'signatures']],
    ['conditions', ['blocking']],
    ['transfers', ['transfers']],
  ]) {
    const k = byKey({ ...READS, [read]: UNREADABLE });
    for (const key of keys) {
      // Mutation checked: `blocked()` returning null for an unreadable read → value 0 and this fails.
      assert.equal(k[key].state, 'unreadable', `${key} with ${read} unread`);
      assert.equal(k[key].value, null);
      assert.match(k[key].reason, /could not be read$/);
    }
    assert.equal(k.deals.state, 'recorded', `the deal count does not need ${read}`);
  }
  const none = byKey({ ...READS, deals: UNREADABLE });
  assert.ok(Object.values(none).every((x) => x.state === 'unreadable' && x.value === null));
  assert.equal(byKey({ ...READS, conditions: LOADING }).blocking.state, 'loading');

  // And on screen: the word, not a number.
  const tile = renderToStaticMarkup(h(KpiTile, { kpi: none.transfers }));
  assert.match(tile, />Unreadable</);
  assert.match(tile, /the deal record could not be read/);
  assert.doesNotMatch(tile, />0</);
});

test('the list is by deal: investment, progress, signatures, conditions, transfer, Open', () => {
  const { state, rows } = closingRows(READS, { 1: CHECKLIST, 2: null });
  assert.equal(state, 'ready');
  // Only the deals the stage map calls closing, one row each, not one per document.
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
  const [a, b] = rows;
  assert.equal(a.name, 'Northwind Labs');
  assert.equal(a.href, '/deals/closing?deal=1'); // D6866: the closing workspace
  // Money goes through money.js in the deal's currency.
  assert.equal(a.investment.text, '€100,000');
  // A skipped item is not counted either way: 6 done of 8.
  assert.equal(a.progress.text, '6 of 8');
  assert.equal(a.signatures.value, 2);
  assert.equal(a.conditions.value, 1);
  assert.equal(a.transfer.text, 'Transfer not recorded');
  assert.equal(b.investment.state, 'unrecorded', 'no confirmed commitment is not $0');
  assert.equal(b.progress.state, 'unrecorded');
  assert.equal(b.progress.reason, 'no closing checklist is applied');
  assert.equal(b.transfer.text, 'Transfer recorded');

  const html = renderToStaticMarkup(h(ClosingDealRow, { row: a, onOpen: () => {} }));
  for (const words of ['Northwind Labs', '€100,000 investment', 'closing progress', '6 of 8', 'signatures outstanding', 'open condition', 'Transfer not recorded', '>Open<']) {
    assert.ok(html.includes(words), `the row lost "${words}"`);
  }
  assert.doesNotMatch(html, /open conditions/, 'one condition reads singular');
});

test('each part of a row keeps its own state', () => {
  const { rows } = closingRows({ ...READS, envelopes: UNREADABLE, transfers: LOADING }, { 1: UNREADABLE });
  const [a] = rows;
  assert.equal(a.signatures.state, 'unreadable');
  assert.equal(a.signatures.value, null);
  assert.equal(a.transfer.state, 'loading');
  assert.equal(a.conditions.value, 1, 'a failed paper read does not take the conditions with it');
  assert.equal(a.progress.state, 'unreadable');
  assert.equal(progressOf(undefined).state, 'loading');
  assert.equal(figureWord(a.signatures), 'Unreadable');
  const html = renderToStaticMarkup(h(ClosingDealRow, { row: a, onOpen: () => {} }));
  assert.match(html, />Unreadable</);
  assert.match(html, /Reading…/);
  // With the deal record unread there are no rows, and the page says so.
  assert.deepEqual(closingRows({ ...READS, deals: UNREADABLE }), { state: 'unreadable', rows: [] });
  assert.match(ZONE, /The deal record could not be read\. That is not a claim that no deal is in closing\./);
});

test('investment and signatures are never guessed', () => {
  assert.equal(investmentOf({ capital_committed: 5, currency: null }).state, 'unrecorded');
  assert.equal(investmentOf({ capital_committed: 1500000, currency: 'JPY' }).text, '¥1,500,000');
  assert.deepEqual(outstandingOf([{ status: 'completed', recipient_count: 3, signed_count: 1 }]), { outstanding: 0, unrecorded: 0 });
  assert.deepEqual(outstandingOf([{ status: 'sent', recipient_count: 2, signed_count: 5 }]), { outstanding: 0, unrecorded: 0 });
  // No bare factor of 100 in the model: money.js converts.
  assert.doesNotMatch(MODEL, /[*/]\s*100\b/);
});

test('agreements read Executed, as the agreement lifecycle says (#5796)', () => {
  assert.equal(paperWord('completed'), 'Executed');
  assert.equal(paperWord('completed'), AGREEMENT_STATES.executed.label);
  assert.equal(paperWord('sent'), AGREEMENT_STATES.sent.label);
  assert.equal(paperWord('voided'), 'Voided');
  assert.equal(paperWord('mystery'), 'Not recorded');
  assert.match(ZONE, /pill: paperWord\(e\.status\)/, 'the paper table prints the raw status');
  assert.doesNotMatch(ZONE, /pill: e\.status/);
});

test('the empty state is the canvas’s sentence', () => {
  assert.equal(EMPTY_TITLE, 'No deals are currently in closing.');
  assert.equal(EMPTY_BODY, 'Closing tracks documents, conditions and recorded transfer status.');
  // D9072: a partner's body says they lead no round at closing; everyone else reads the canvas's sentence.
  assert.match(ZONE, /empty=\{<NothingYet title=\{EMPTY_TITLE\} body=\{seatRole === 'partner' \? NO_LED_ROUND : EMPTY_BODY\} \/>\}/);
});

test('the joins live in the model only, so #6157 is a one-place swap', () => {
  assert.match(ZONE, /const kpis = useMemo\(\(\) => closingKpis\(reads\), \[reads\]\);/);
  assert.match(ZONE, /const dealList = useMemo\(\(\) => closingRows\(reads, checklistReads\)/);
  // The page draws the model's figures; it does not count them itself.
  assert.doesNotMatch(ZONE, /outstandingOf\(|recipient_count\) -/, 'the page counts signatures itself');
  assert.ok(WAITS_ON_OVERVIEW.length >= 1);
  assert.match(ZONE, /WAITS_ON_OVERVIEW\.join/, 'the page stopped saying what waits on the closing read');
  // The per-deal read stays bounded to the deals at closing.
  assert.match(ZONE, /deals\.filter\(\(d\) => dealStage\(d\) === 'closing'\)\.map\(async \(d\) => \{/);
});
