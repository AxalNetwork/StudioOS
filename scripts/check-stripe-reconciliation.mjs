#!/usr/bin/env node
/**
 * D8512 (#8512) — the Stripe line of the post-deploy smoke. It prints the
 * webhook's reconciliation state (`GET /api/admin/stripe/reconciliation`,
 * `cloudflare-worker/src/services/stripeReconciliation.ts`) as one line, and
 * always exits 0: a state other than no_events_expected or reconciled is a
 * GitHub warning, not a failure, until the owner says the state is known-good.
 *
 * Its input, in order:
 *   - a file holding the route's JSON body (an operator saved it from HQ);
 *   - STRIPE_RECONCILIATION_HOST and STRIPE_RECONCILIATION_COOKIE, a Super
 *     Admin session the operator runs it with;
 *   - nothing: the smoke holds no read credential, and the line says so.
 * It never prints the cookie, an id, a payload or a key.
 *
 *   node scripts/check-stripe-reconciliation.mjs [body.json]
 */
import { readFileSync } from 'node:fs';
import { RECONCILIATION_PATH, judgeReconciliation, notRead } from './lib/stripeReconciliation.mjs';

const TIMEOUT_MS = 15_000;

async function read() {
  const file = process.argv[2];
  if (file) {
    try { return judgeReconciliation(JSON.parse(readFileSync(file, 'utf8'))); }
    catch { return notRead('the saved answer could not be read'); }
  }
  const host = String(process.env.STRIPE_RECONCILIATION_HOST || '').trim().replace(/\/+$/, '');
  const cookie = String(process.env.STRIPE_RECONCILIATION_COOKIE || '');
  if (!host || !cookie) return notRead('the smoke holds no read credential for the reconciliation; giving it one is the owner\'s decision, D8512');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(host)) return notRead('the host is not an https host');
  try {
    const res = await fetch(`${host}${RECONCILIATION_PATH}`, { headers: { accept: 'application/json', cookie }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status !== 200) return notRead(`the route answered ${res.status}`);
    return judgeReconciliation(await res.json());
  } catch (e) {
    return notRead(e?.name === 'TimeoutError' ? 'the route timed out' : 'the route could not be fetched');
  }
}

const { level, line } = await read();
if (level === 'ok') console.log(`✓ ${line}`);
else console.log(`::warning title=Stripe reconciliation::${line}`);
process.exit(0);
