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
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/order_seller_d755.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { pdfText } from './_pdf_text.ts';
import { ensureOrdersSchema, renderOrderInvoicePdf } from '../src/services/orders.ts';
import { brandedInvoiceContent } from '../src/services/email.ts';
import { AXAL_ENTITIES } from '../src/services/legalDocFormat.ts';

const SELLER = 'Axal VC Management LLC';

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT); INSERT INTO users VALUES (7, 'buyer@example.test', 'Fixture Buyer');");
  const env = { DB: d1Over(db) } as any;
  await ensureOrdersSchema(env);
  db.prepare(`INSERT INTO orders (id, order_ref, user_id, status, currency, subtotal_cents, total_cents, items_json, paid_at)
    VALUES ('o-1', 'MRD-2026-TEST1', 7, 'paid', 'usd', 4900, 4900, ?, '2026-10-19 06:00:00')`)
    .run(JSON.stringify([{ name: 'Fixture Template Pack', quantity: 1, line_total: 4900, unit_amount: 4900 }]));
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
