/**
 * Engagement invoicing — a production state that said "billed" when nothing was.
 *
 * ROUTE_MAP graded Get Paid & Invoicing a RESKIN and described invoicing as
 * "one button opening a hosted stripe_invoice_url". That describes the FastAPI
 * in backend/, which is Replit-dev-only and is never deployed. On the
 * production worker the same button did this and only this:
 *
 *     nextStatus = 'invoiced';
 *     sets.push('invoice_id = ?'); params.push(`stub-${e.uid.slice(0, 8)}`);
 *
 * D1's `engagements` has no `stripe_invoice_url` and no `stripe_invoice_id`
 * column, and `engagementDto` is a bare row passthrough — so all three UI
 * references were dead: two `{…stripe_invoice_url && <a>}` links that could
 * never render, and a `!eng.stripe_invoice_id` guard that never hid the
 * button, letting a second click 409.
 *
 * The engagement was therefore marked `invoiced` forever with no invoice in
 * existence and nothing for either side to send or pay. That is worse than a
 * missing feature: the record asserted something untrue about money.
 *
 * These tests pin the fix and, more importantly, pin that the dead fields do
 * not come back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { apiMethodNames, apiCallsIn } from './_apiMethods.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const SQL = 'cloudflare-worker/sql/migrations/188_engagement_invoices.sql';
const SVC = 'cloudflare-worker/src/services/engagementInvoices.ts';
const ROUTE = 'cloudflare-worker/src/routes/needs.ts';
const PAGE = 'frontend/src/pages/NeedsBoardPage.jsx';

/**
 * Source with comments removed — block (at any indent), JSX `{/* … *\/}` and
 * whole-line `//`.
 *
 * codeOnly() is deliberately more conservative than this: it strips only the
 * shapes a string literal cannot produce, because for most assertions an
 * over-strip is the dangerous direction. Here the direction is reversed — the
 * assertions below BAN a token, so under-stripping produces a false failure
 * (which happened four times while writing this file, every one of them
 * against a comment explaining why the token was removed) and over-stripping
 * would produce a false PASS.
 *
 * So the canary makes over-stripping loud: a marker that must survive is
 * asserted before the ban runs. If the stripper ever eats real code, the
 * canary goes with it and the test fails instead of quietly passing.
 */
function withoutComments(src, canary) {
  const out = String(src)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')   // JSX {/* … */}
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, ' ')          // block comment
    .replace(/^\s*\*[^\n]*$/gm, ' ')                  // block continuation
    .replace(/^\s*\/\/[^\n]*$/gm, ' ');               // whole-line //
  assert.ok(out.includes(canary), `the comment stripper ate real code (canary "${canary}" gone)`);
  return out;
}

/* ---------------------------------------------------------------- *
 * The defect                                                        *
 * ---------------------------------------------------------------- */

test('the stub invoice id is gone', () => {
  const w = codeOnly(read(ROUTE));
  assert.ok(!/stub-\$\{/.test(w), 'the worker must not write a placeholder invoice id');
  assert.match(read(ROUTE), /issueInvoice\(/, 'it must issue a real invoice');
});

test('no UI code reads a field D1 does not have', () => {
  // Ban the READ, not the mention. codeOnly() deliberately leaves JSX
  // `{/* … */}` comments alone (it only strips column-0 block comments and
  // whole-line `//`), and the comments explaining why these fields were
  // removed are exactly the ones worth keeping. So match the property-access
  // forms a live read would take.
  // The comments that explain why these fields were removed are the ones
  // worth keeping, so strip comments (canary-guarded) and ban the token in
  // what is left.
  const src = withoutComments(read(PAGE), 'function InvoiceDocument');
  for (const dead of ['stripe_invoice_url', 'stripe_invoice_id', 'invoice_simulated']) {
    assert.ok(!src.includes(dead), `${dead} is not a column on D1's engagements`);
  }
});

test('those columns really are absent from D1, which is why the reads were dead', () => {
  const schema = read('cloudflare-worker/sql/t13_t14_t15.sql');
  const i = schema.indexOf('CREATE TABLE IF NOT EXISTS engagements');
  const body = schema.slice(i, schema.indexOf(');', i));
  assert.ok(body.includes('invoice_id'), 'invoice_id IS a real column');
  assert.ok(!body.includes('stripe_invoice_url'), 'stripe_invoice_url is not');
  assert.ok(!body.includes('stripe_invoice_id'), 'stripe_invoice_id is not');
});

test('the button no longer says Stripe, because no Stripe is involved', () => {
  const s = read(PAGE);
  assert.ok(!/Issue Stripe invoice/.test(s), 'the label described a flow that does not exist');
  assert.match(s, /Issue invoice/, 'and is now accurate');
  assert.match(s, /!eng\.invoice_id &&/, 'the guard must read a column that exists');
});

/* ---------------------------------------------------------------- *
 * Money                                                             *
 * ---------------------------------------------------------------- */

test('every amount on the invoice is an integer of minor units', () => {
  const s = read(SQL);
  for (const col of ['subtotal_cents', 'tax_cents', 'total_cents']) {
    assert.match(s, new RegExp(`${col}\\s+INTEGER`), `${col} must be INTEGER`);
  }
  assert.match(s, /tax_rate_bps\s+INTEGER/, 'a rate is basis points, like every other rate here');
  // Strip `--` comments first: the header explains that quotes.price is a
  // legacy REAL column, which is the reason this table is all integers.
  const sqlOnly = s.replace(/^\s*--[^\n]*$/gm, '');
  assert.ok(!/\b(REAL|FLOAT|DOUBLE)\b/.test(sqlOnly), 'no float anywhere in an invoice');
});

test('the float→cents conversion happens once and rounds the scaled value', () => {
  // `Math.round(n) * 100` throws the cents away; `(n * 100) | 0` truncates
  // 12.99 to 1298 when the float lands low. Both are real bugs people ship.
  const s = read(SVC);
  assert.match(s, /export function toCents/, 'the conversion must be one named place');
  assert.match(s, /Math\.round\(n \* 100\)/, 'round the scaled value, not the input');
});

test('toCents and taxCents are arithmetically right', async () => {
  const { toCents, taxCents } = await import('../../cloudflare-worker/src/services/engagementInvoices.ts');
  assert.equal(toCents(12.99), 1299, '12.99 is 1299 cents, not 1298');
  assert.equal(toCents(0.1 + 0.2), 30, 'the classic float, still 30 cents');
  assert.equal(toCents(1000), 100000);
  assert.equal(toCents(null), 0, 'a missing price is zero, not NaN');
  assert.equal(toCents(-5), 0, 'a negative price is refused, not negated');
  assert.equal(taxCents(10000, 2000), 2000, '20% of $100.00 is $20.00');
  assert.equal(taxCents(1299, 2000), 260, 'rounds to the nearest cent');
  assert.equal(taxCents(10000, 0), 0);
  assert.equal(taxCents(10000, 99999), 10000, 'a rate over 100% is clamped');
});

/* ---------------------------------------------------------------- *
 * Issuing                                                           *
 * ---------------------------------------------------------------- */

test('one invoice per engagement, enforced by an index', () => {
  assert.match(
    read(SQL),
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_invoice_once\s+ON engagement_invoices\(engagement_id\)/,
    'a retried request must not mint a second number for the same work',
  );
  assert.match(read(SVC), /if \(existing\) return \{ invoice: existing, created: false \}/,
    'and the service must return the first one rather than erroring');
});

test('the number comes from a counter, not from parsing the last number back', () => {
  const s = read(SVC);
  assert.match(s, /invoice_number_seq/, 'a dedicated sequence');
  assert.match(s, /ON CONFLICT\(year\) DO UPDATE SET last_value = last_value \+ 1/, 'atomic increment');
  // Against code only — the doc comment names the approach it rejected.
  assert.ok(!/MAX\(invoice_number\)/.test(codeOnly(s)), 'parsing a formatted string to increment it duplicates numbers');
  assert.match(read(SQL), /never reuses it/, 'a void invoice must keep its number');
});

test('line items are not invented', () => {
  // `quotes.deliverables` is free text and the quote names ONE price. A table
  // of fabricated sub-amounts that happens to sum correctly would look more
  // convincing and be less true.
  const s = read(SVC);
  assert.match(s, /export function lineItemsFromQuote/);
  assert.match(s, /one line at the/i, 'the reasoning must survive in the file');
  const body = s.slice(s.indexOf('export function lineItemsFromQuote'));
  assert.match(body, /quantity: 1/, 'one line, at the agreed price');
});

/* ---------------------------------------------------------------- *
 * Access, and what the platform does not claim                      *
 * ---------------------------------------------------------------- */

test('either party may read the invoice and nobody else, with a 404', () => {
  const s = read(ROUTE);
  const i = s.indexOf("engagementsRouter.get('/:id/invoice'");
  assert.ok(i > 0, 'the read route must exist');
  const body = s.slice(i, s.indexOf("engagementsRouter.post('/:id/invoice/paid'"));
  assert.match(body, /isPartner\(user\) && user\.partner_id === e\.partner_id/);
  assert.match(body, /isFounder\(user\) && user\.founder_id === e\.founder_id/);
  assert.match(body, /'Not found' \}, 404/, 'a non-party gets 404, not 403');
  assert.ok(!/403/.test(codeOnly(body)), 'a 403 would confirm the engagement exists');
});

test('the platform does not claim it collects the money', () => {
  const svc = read(SVC);
  const route = read(ROUTE);
  const page = read(PAGE);
  // Collapse comment markers and line wrapping FIRST. A phrase split across
  // two comment lines is still the phrase — four assertions in this file
  // failed against correct prose before this was normalised, every one of
  // them because a sentence wrapped at the eightieth column.
  const flat = (x) => String(x).replace(/^\s*(\/\/|\*|--)\s?/gm, ' ').replace(/\s+/g, ' ');
  assert.match(flat(route), /out of band/i, 'the route must say what "paid" means');
  assert.match(flat(page), /does not collect the payment/i, 'and the document must say it to both sides');
  assert.match(flat(read(SQL)), /does not collect money/i, 'the migration records the commitment in full');
  assert.match(flat(svc), /no payment rail invented behind it/i, 'and the issuing module repeats it');
});

test('marking paid is partner-only and refuses a void invoice', () => {
  const s = read(ROUTE);
  const body = s.slice(s.indexOf("engagementsRouter.post('/:id/invoice/paid'"));
  assert.match(body, /Partner-side action/, 'the founder does not declare themselves paid');
  assert.match(body, /That invoice is void/, 'a void invoice cannot be paid');
});

/* ---------------------------------------------------------------- *
 * Wiring                                                            *
 * ---------------------------------------------------------------- */

test('the page renders the document from integer cents, dividing once', () => {
  const s = read(PAGE);
  assert.match(s, /function InvoiceDocument/, 'the document must be rendered in-platform');
  assert.match(s, /n \/ 100/, 'minor units → display happens in one place');
  assert.ok(!/parseFloat\(/.test(s), 'no float parsing of money');
  for (const f of ['invoice_number', 'subtotal_cents', 'total_cents', 'line_items']) {
    assert.ok(s.includes(f), `the document must surface ${f}`);
  }
});

test('both new api methods exist and are served', () => {
  const defined = apiMethodNames(read('frontend/src/lib/api.js'));
  for (const m of ['engagementInvoice', 'markInvoicePaid']) {
    assert.ok(defined.has(m), `api.js must expose ${m}`);
  }
  const calls = apiCallsIn(read(PAGE));
  assert.ok(calls.has('engagementInvoice') && calls.has('markInvoicePaid'), 'the page must use them');
  const w = read(ROUTE);
  assert.match(w, /engagementsRouter\.get\('\/:id\/invoice'/);
  assert.match(w, /engagementsRouter\.post\('\/:id\/invoice\/paid'/);
});
