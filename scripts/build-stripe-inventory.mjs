#!/usr/bin/env node
/**
 * #8523 — the Stripe idempotency inventory of the production Worker.
 *
 *   node scripts/build-stripe-inventory.mjs           writes documentation/architecture/STRIPE_IDEMPOTENCY_INVENTORY.json:
 *                                                     every `stripeCall()` (and every raw Stripe fetch) with its
 *                                                     method, Stripe path, whether it moves money, and whether it
 *                                                     sends an idempotency key and from what
 *   node scripts/build-stripe-inventory.mjs --check   the guard (in `npm run test:guards`): a money-moving POST
 *                                                     must send a key derived from a stable id, or be on the
 *                                                     allowlist below with its reason
 *
 * The reading rules and the check are scripts/lib/stripeInventory.mjs; the keys are util/stripeKey.ts. The JSON
 * is build output, never committed (.gitignore), like AUTH_INVENTORY.json (D5612). No Stripe call is made.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInventory, readCalls, readFiles, readRawClients } from './lib/stripeInventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'cloudflare-worker', 'src');
const OUT = join(ROOT, 'documentation', 'architecture', 'STRIPE_IDEMPOTENCY_INVENTORY.json');

/**
 * Money-moving POSTs kept without a stable key, each with its reason. An entry that no longer matches an unkeyed
 * call, or counts it wrong, fails the check: the list only records what is still true.
 */
export const ALLOWLIST = [
  { file: 'routes/billing.ts', path: '/checkout/sessions', count: 3, reason: 'Creates an unpaid Checkout Session; money moves only when the customer completes one, and a second press makes a second link to the same price, not a second charge.' },
  { file: 'routes/legal.ts', path: '/checkout/sessions', count: 1, reason: 'Creates an unpaid Checkout Session before the pending order exists; nothing is charged until the customer pays it, and the order is created from the session the call returns.' },
  { file: 'routes/billing.ts', path: '/subscriptions/:x', count: 2, reason: 'Cancel or resume sets cancel_at_period_end to a given value, and the default-card change sets one payment method; repeating either leaves the same state and moves no money.' },
  { file: 'routes/payments.ts', path: '/payment_intents', count: 1, reason: 'createIntent takes its key from every caller, each of which sends pi:<user>:<price or pack>:<promo>:<nonce> (payments.ts), the same on a retry of one press.' },
];

export function build() {
  const files = readFiles(SRC);
  return { calls: readCalls(files), rawClients: readRawClients(files) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const inv = build();
  if (process.argv.includes('--check')) {
    const errors = checkInventory(inv, ALLOWLIST);
    if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join('\n')); process.exit(1); }
    const money = inv.calls.filter((c) => c.moneyMoving);
    console.log(`✓ stripe-idempotency: ${inv.calls.length} stripeCall sites, ${money.length} money-moving, ${money.filter((c) => c.source === 'stable').length} keyed from a stable id, ${ALLOWLIST.reduce((n, a) => n + a.count, 0)} allowlisted with a reason.`);
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify({ generatedBy: 'scripts/build-stripe-inventory.mjs', ...inv }, null, 2)}\n`);
    console.log(`wrote ${OUT.replace(`${ROOT}/`, '')}: ${inv.calls.length} calls`);
  }
}
