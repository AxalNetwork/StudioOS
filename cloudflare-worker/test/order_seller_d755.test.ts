/**
 * D755 (#1914) PR 1 — every cart order is sold by Axal VC Management LLC.
 *
 * Every cart order is money kind `marketplace`, paid to Management (D707), so:
 *  - the invoice PDF's header names Axal VC Management LLC, read from
 *    `AXAL_ENTITIES`, with its descriptor under it, and no longer "AXAL VC"
 *    alone;
 *  - the order email (`brandedInvoiceContent`, which `fulfilOrder` sends with
 *    `seller`) names the seller in its footer and its text part;
 *  - the receipt other senders send, without `seller`, is unchanged.
 *
 * PR 2 (§17): a token pack's invoice line reads "$25 of tokens — added to
 * your AI top-up balance" with the tokens note under the totals, and its email
 * says when the tokens land and links to Usage › Top-ups. An ordinary order's
 * invoice and email are unchanged. A mixed order cannot exist (CR1 refuses
 * it), so there is no case for one.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/order_seller_d755.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { pdfText } from './_pdf_text.ts';
import { ensureOrdersSchema, renderOrderInvoicePdf, tokenPackLineWords, TOKEN_PACK_INVOICE_NOTE } from '../src/services/orders.ts';
import { brandedInvoiceContent, TOKEN_PACK_EMAIL_NOTE } from '../src/services/email.ts';
import { AXAL_ENTITIES } from '../src/services/legalDocFormat.ts';

const SELLER = 'Axal VC Management LLC';

/** A token pack's price, through the environment fallback `isTokenPackPrice` reads (no Stripe). */
const PACK_PRICE = 'price_FixtureTokenPack';

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT); INSERT INTO users VALUES (7, 'buyer@example.test', 'Fixture Buyer');");
  const env = { DB: d1Over(db), STRIPE_PRICE_AI_TOPUP: PACK_PRICE } as any;
  await ensureOrdersSchema(env);
  const order = (ref: string, lines: unknown[], vat = 0) => db.prepare(`INSERT INTO orders (id, order_ref, user_id, status, currency, subtotal_cents, vat_cents, total_cents, items_json, paid_at)
    VALUES (?, ?, 7, 'paid', 'usd', 4900, ?, ?, ?, '2026-10-19 06:00:00')`).run(ref, ref, vat, 4900 + vat, JSON.stringify(lines));
  order('MRD-2026-TEST1', [{ price_id: 'price_FixtureTemplates', name: 'Fixture Template Pack', quantity: 1, line_total: 4900, unit_amount: 4900 }]);
  order('MRD-2026-PACK1', [{ price_id: PACK_PRICE, name: 'AI tokens', quantity: 1, line_total: 2500, unit_amount: 2500 }], 500);
  return env;
}

test('the invoice header names Axal VC Management LLC and its descriptor, never "AXAL VC" alone', async () => {
  assert.equal(AXAL_ENTITIES.management.name, SELLER);
  const text = await pdfText(await renderOrderInvoicePdf(await fixture(), 'MRD-2026-TEST1'));
  assert.ok(text.startsWith(`${SELLER} INVOICE ${AXAL_ENTITIES.management.descriptor}`), text.slice(0, 120));
  assert.doesNotMatch(text, /AXAL VC(?! Management)/i, 'no bare "AXAL VC" header');
  assert.ok(text.includes('Fixture Template Pack'), 'the line items still draw');
  // The name is read from AXAL_ENTITIES, never typed in the renderer.
  const src = readFileSync('cloudflare-worker/src/services/orders.ts', 'utf8');
  assert.doesNotMatch(src, /drawText\('AXAL VC'/);
  assert.doesNotMatch(src, /'Axal VC Management LLC'/);
});

const base = {
  to: 'buyer@example.test', name: 'Fixture Buyer', amountCents: 4900, currency: 'usd',
  description: 'Fixture Template Pack ×1', invoiceNumber: 'MRD-2026-TEST1', paidAt: new Date('2026-10-19T06:00:00Z'),
};

test('the order email names the seller in its footer and its text part', () => {
  const { html, text } = brandedInvoiceContent({ ...base, seller: SELLER });
  assert.ok(html.includes(`Sold by ${SELLER}. This receipt was sent by Axal StudioOS.`));
  assert.ok(text.split('\n').includes(`Sold by ${SELLER}.`));
  // fulfilOrder passes the seller from AXAL_ENTITIES.
  const src = readFileSync('cloudflare-worker/src/services/orders.ts', 'utf8');
  assert.match(src, /seller: AXAL_ENTITIES\.management\.name/);
});

test('a receipt sent without a seller (the subscription senders) is unchanged', () => {
  const { html, text, subject } = brandedInvoiceContent(base);
  assert.ok(!html.includes('Sold by') && !text.includes('Sold by'));
  assert.ok(html.includes('\n    This receipt was sent by Axal StudioOS. If you have any questions'));
  assert.equal(subject, 'Your Axal receipt — MRD-2026-TEST1');
  assert.equal(brandedInvoiceContent({ ...base, seller: '  ' }).html, html, 'a blank seller is no seller');
});

// ── PR 2 (§17): what a token pack adds ───────────────────────────────────────

test('a pack order\'s invoice line says what the pack adds, and the note says tokens never expire and VAT is not tokens', async () => {
  assert.equal(tokenPackLineWords(2500), '$25 of tokens — added to your AI top-up balance');
  assert.equal(tokenPackLineWords(2550), '$25.50 of tokens — added to your AI top-up balance');
  const env = await fixture();
  // pdf-lib writes the em dash as WinAnsi 0x97, which `pdfText` reads as Latin-1.
  const text = (await pdfText(await renderOrderInvoicePdf(env, 'MRD-2026-PACK1'))).replace(/\x97/g, '—');
  assert.ok(text.includes('$25 of tokens — added to your AI top-up balance'), text);
  assert.ok(text.includes(TOKEN_PACK_INVOICE_NOTE));
  assert.equal(TOKEN_PACK_INVOICE_NOTE, 'Tokens never expire. VAT, where it applies, is not part of the tokens.');
  assert.ok(!text.includes('AI tokens 1'), 'the catalogue name is replaced');
});

test('an ordinary order\'s invoice has no pack words and no tokens note', async () => {
  const text = await pdfText(await renderOrderInvoicePdf(await fixture(), 'MRD-2026-TEST1'));
  assert.ok(!text.includes('of tokens') && !text.includes('Tokens never expire'), text);
  assert.ok(text.includes('Fixture Template Pack 1'));
});

test('a pack order\'s email says when the tokens land and links to Usage › Top-ups; an ordinary one is byte for byte unchanged', () => {
  const usageUrl = 'https://axal.example/account/usage#top-ups';
  const pack = brandedInvoiceContent({ ...base, seller: SELLER, topUp: { usageUrl } });
  assert.equal(TOKEN_PACK_EMAIL_NOTE, 'The tokens are added to your top-up balance once Stripe confirms the payment. You will see them in Usage › Top-ups.');
  assert.ok(pack.html.includes(`${TOKEN_PACK_EMAIL_NOTE} <a href="${usageUrl}"`), 'the note and its link');
  assert.ok(pack.text.split('\n').includes(`${TOKEN_PACK_EMAIL_NOTE} ${usageUrl}`));
  const ordinary = brandedInvoiceContent({ ...base, seller: SELLER });
  assert.deepEqual(brandedInvoiceContent({ ...base, seller: SELLER, topUp: null }), ordinary, 'no pack, no change');
  assert.ok(!ordinary.html.includes('top-up') && !ordinary.text.includes('top-up'));
  // fulfilOrder sends the link only for a pack line, on PUBLIC_BASE_URL.
  const src = readFileSync('cloudflare-worker/src/services/orders.ts', 'utf8');
  assert.match(src, /if \(await isTokenPackPrice\(env, line\.price_id\)\) \{\n\s+const base = String\(env\.PUBLIC_BASE_URL/);
  assert.match(src, /usageUrl: `\$\{base\}\/account\/usage#top-ups`/);
});
