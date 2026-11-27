/**
 * D9017 (#9017) — a capital-call line's "bank reversed" state, in the GP's
 * call page and the investor's My commitment card.
 *
 * The Worker half (detection in the sync, the resolve act, its gate, the
 * support-session refusal and the kept history, on real SQLite) is in
 * `cloudflare-worker/test/fund_reconciliation_journey_d8534.test.ts`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bank_reversals_9017.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import BankReversals, { BankReversalPill } from '../src/pages/investor/BankReversals.jsx';
import { LineTable } from '../src/pages/investor/InvestorFundCalls.jsx';
import { commitmentsByFund } from '../src/lib/lpCommitmentModel.js';
import { MyCommitment } from '../src/pages/SpinoutLabLpCommitment.jsx';
import { fundCallsApi } from '../src/lib/api/fundCalls.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;|’/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const FUND = { id: 1, name: 'Fixture Fund' };
const OPEN = {
  uid: 'aa11', capital_call_id: 7, receipt_id: 3, cause: 'failed', bank_status: 'failed', bank_amount_cents: 600_000,
  receipt_cents: 600_000, detected_at: '2026-11-27 10:00:00', resolved_at: null, resolved_by_name: null, resolution_note: null,
};
const RESOLVED = {
  ...OPEN, uid: 'bb22', capital_call_id: 8, cause: 'restated', bank_amount_cents: 400_000, resolved_at: '2026-11-27 12:30:00',
  resolved_by_name: 'Fixture GP', resolution_note: 'LP B re-sent the balance.',
};
const LINES = [
  { id: 7, limited_partner_id: 70, lp_name: 'LP Seven', state: 'paid', owed_cents: 600_000, received_cents: 600_000, outstanding_cents: 0,
    bank_reversed: { detected_at: OPEN.detected_at, resolved_at: null } },
  { id: 8, limited_partner_id: 80, lp_name: 'LP Eight', state: 'paid', owed_cents: 400_000, received_cents: 400_000, outstanding_cents: 0,
    bank_reversed: { detected_at: RESOLVED.detected_at, resolved_at: RESOLVED.resolved_at } },
  { id: 9, limited_partner_id: 90, lp_name: 'LP Nine', state: 'pending', owed_cents: 100_000, received_cents: 0, outstanding_cents: 100_000, bank_reversed: null },
];
const section = (reversals, acts = null) => h(BankReversals, {
  fund: FUND, reversals, lines: LINES, acts, onRetry: () => {}, onResolved: async () => {},
});

test('a line reads Bank reversed only while its reversal is open', () => {
  assert.match(html(h(BankReversalPill, { line: LINES[0] })), /data-testid="pill-bank-reversed-7"[^>]*>Bank reversed</);
  assert.equal(html(h(BankReversalPill, { line: LINES[1] })), '', 'a resolved reversal keeps no pill');
  assert.equal(html(h(BankReversalPill, { line: LINES[2] })), '', 'a line the bank never reversed has no pill');
  // The ledger table carries it beside the paid state, and only on line 7.
  const table = html(h(LineTable, { lines: LINES, showCall: false, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {} }));
  assert.deepEqual([...table.matchAll(/pill-bank-reversed-(\d+)/g)].map((m) => m[1]), ['7']);
});

test('the call page lists each reversal: the open one with Resolve, the resolved one with who, when and the note', () => {
  const out = text(section({ status: 'ready', rows: [OPEN, RESOLVED] }));
  assert.match(out, /Bank reversed · 1 open/);
  assert.match(out, /LP Seven · The bank reports the wire failed/);
  assert.match(out, /Receipt \$6,000\.00 · bank now shows \$6,000\.00, failed · seen 2026-11-27 10:00 UTC/);
  assert.match(out, /Nothing has been reversed: the receipt, the line, the LP's paid-in and the fund's deployed capital stand/);
  assert.match(out, /LP Eight · The bank restated the wire/);
  assert.match(out, /Resolved 2026-11-27 12:30 UTC by Fixture GP · LP B re-sent the balance\./);
  const markup = html(section({ status: 'ready', rows: [OPEN, RESOLVED] }));
  assert.match(markup, /data-testid="button-resolve-bank-reversal-aa11"/);
  assert.doesNotMatch(markup, /button-resolve-bank-reversal-bb22/, 'a resolved reversal is resolved once');
  assert.match(markup, /class="if2-row-action if2-tap"/, 'Resolve is a 44px target at phone width');
});

test('an Admin the act table refuses reads its sentence in place of Resolve', () => {
  const acts = { acts: [{ act: 'capital_call.bank_reversal', allowed: false, sentence: null }] };
  const markup = html(section({ status: 'ready', rows: [OPEN] }, acts));
  assert.doesNotMatch(markup, /button-resolve-bank-reversal-aa11/);
  assert.match(markup, /data-testid="text-resolve-reversal-refused"/);
});

test('an unread list says so, and no reversal draws nothing', () => {
  assert.match(text(section({ status: 'unreadable', rows: null })), /not a claim that the bank reversed nothing/);
  assert.equal(html(section({ status: 'ready', rows: [] })), '');
  assert.equal(html(section(undefined)), '', 'a call read from before the field draws nothing');
});

test('the resolve method posts the note to the mounted route', () => {
  const src = read('frontend/src/lib/api/fundCalls.js');
  assert.match(src, /resolveBankReversal: \(fundId, uid, data\) =>\s*request\(`\/funds\/\$\{fundId\}\/capital-calls\/bank-reversals\/\$\{encodeURIComponent\(uid\)\}\/resolve`, \{ method: 'POST'/);
  assert.equal(typeof fundCallsApi.resolveBankReversal, 'function');
  const worker = read('cloudflare-worker/src/routes/funds.ts');
  assert.match(worker, /funds\.post\('\/:id\/capital-calls\/bank-reversals\/:uid\/resolve'/);
});

// ── The investor's own line ─────────────────────────────────────────────

const PORTAL = (bank) => ({
  lp_holdings: [{ id: 100, fund_id: 1, fund_name: 'Fund I', commitment_amount: 6000, invested_amount: 6000, status: 'committed' }],
  performance: [{ lp_id: 100, invested_amount: 6000, dpi: 0, tvpi: 1 }],
  capital_calls: [{ id: 7, fund_id: 1, limited_partner_id: 100, call_number: 1, owed_cents: 600_000, received_cents: 600_000,
    status: 'paid', paid_date: '2026-11-20', created_at: '2026-11-01', ...(bank === undefined ? {} : { bank_reversed: bank }) }],
  capital_calls_recorded: true,
  distributions: [],
});

test('the model carries the reversal as dates, null when none, and no key when the portal did not read it', () => {
  const line = (bank) => commitmentsByFund(PORTAL(bank), '2026-11-27')[0].calls[0];
  assert.deepEqual(line({ detected_at: '2026-11-27 10:00:00', resolved_at: null }).bank_reversed,
    { detected_on: '2026-11-27', resolved_on: null, open: true });
  assert.deepEqual(line({ detected_at: '2026-11-27 10:00:00', resolved_at: '2026-11-28 09:00:00' }).bank_reversed,
    { detected_on: '2026-11-27', resolved_on: '2026-11-28', open: false });
  assert.equal(line(null).bank_reversed, null);
  assert.equal('bank_reversed' in line(undefined), false);
  // The money is the register's either way: a reversal moves nothing on the card.
  const open = commitmentsByFund(PORTAL({ detected_at: '2026-11-27 10:00:00', resolved_at: null }), '2026-11-27')[0];
  const none = commitmentsByFund(PORTAL(null), '2026-11-27')[0];
  assert.deepEqual([open.settled_cents, open.due_cents, open.calls[0].state], [none.settled_cents, none.due_cents, none.calls[0].state]);
});

const card = (bank) => renderToStaticMarkup(h(MemoryRouter, null, h(MyCommitment, { portal: PORTAL(bank), failed: false, onReload: () => {} })));

test('the investor reads Bank reversed on their own line while it is open, and when it was resolved after', () => {
  const open = card({ detected_at: '2026-11-27 10:00:00', resolved_at: null });
  assert.match(open, /data-testid="commitment-call-bank-reversed-7"/);
  assert.match(open, /<b>Bank reversed\.<\/b>/);
  assert.match(open, /dark:text-rose-200/, 'the notice has a dark-theme colour');
  const done = card({ detected_at: '2026-11-27 10:00:00', resolved_at: '2026-11-28 09:00:00' });
  assert.doesNotMatch(done, /Bank reversed\./);
  assert.match(done.replace(/<!-- -->/g, ''), /was resolved by the general partner on 2026-11-28/);
  assert.doesNotMatch(card(null), /commitment-call-bank-reversed/);
  assert.doesNotMatch(card(undefined), /commitment-call-bank-reversed/);
});

test('light, dark and 390px: the pill and the list have both themes, and phone targets are 44px', () => {
  const css = read('frontend/src/pages/investor/investorFundCalls.css');
  assert.match(css, /\.if2-pill\.bank-reversed\{color:#9f1239;background:#fff1f2;border-color:#fecdd3\}/);
  assert.match(css, /\.dark \.if2-pill\.bank-reversed\{color:#fda4af;background:#2f0a14;border-color:#881337\}/);
  assert.match(css, /@media\(max-width:640px\)\{\.if2-reversal-list li\{overflow-wrap:anywhere\}[^}]*\}\.if2-reversal-list button\{min-height:44px;min-width:44px\}\}/);
});
