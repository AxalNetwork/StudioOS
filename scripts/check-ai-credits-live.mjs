#!/usr/bin/env node
/**
 * D755 CR10 (#1987) — the read-only AI credits check after a deploy.
 *
 * It fetches, on each host:
 *   - `GET /api/public/plans-and-packs`, the public plans and token packs read
 *     (CR2, #1919), and judges its shape: every plan family with its
 *     allowance, packs credited at face value with a bonus of at most 10%, and
 *     no person named anywhere in it;
 *   - `GET /plans-and-pricing`, which must be the SPA shell.
 *
 * It never signs in, never buys and never calls Stripe: two anonymous GETs per
 * host. The rules live in `lib/aiCreditsLive.mjs`. A surface not deployed yet
 * is a warning (exit 0); a deployed surface answering wrong is an error (exit 1).
 * The post-deploy smoke runs it as a warning step, beside `check-spa-live.mjs`.
 *
 *   node scripts/check-ai-credits-live.mjs                 # https://axal.vc
 *   SMOKE_HOSTS=https://app.axal.vc node scripts/check-ai-credits-live.mjs
 */
import { PLANS_PATH, PRICING_PATH, judgePlansResponse, judgePricingShell } from './lib/aiCreditsLive.mjs';

const TIMEOUT_MS = 15_000;
const hosts = (process.argv.slice(2).length ? process.argv.slice(2) : String(process.env.SMOKE_HOSTS || 'https://axal.vc').split(/[\s,]+/))
  .map((h) => h.trim().replace(/\/+$/, '')).filter(Boolean);

async function get(url) {
  const res = await fetch(url, { headers: { accept: url.endsWith(PLANS_PATH) ? 'application/json' : 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, contentType: res.headers.get('content-type') || '', cacheControl: res.headers.get('cache-control') || '', text: await res.text() };
}

let failed = false;
for (const host of hosts) {
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(host)) { console.error(`✖ ${host}: not an https host`); failed = true; continue; }
  const results = [];
  for (const [path, judge] of [[PLANS_PATH, judgePlansResponse], [PRICING_PATH, judgePricingShell]]) {
    try { results.push(judge(await get(`${host}${path}`))); }
    catch (e) { results.push({ errors: [`${path} could not be fetched: ${e?.name === 'TimeoutError' ? 'timed out' : e?.message || e}`], warnings: [] }); }
  }
  const errors = results.flatMap((r) => r.errors), warnings = results.flatMap((r) => r.warnings);
  for (const w of warnings) console.warn(`⚠ ${host}: ${w}`);
  for (const e of errors) console.error(`✖ ${host}: ${e}`);
  if (errors.length) failed = true;
  else console.log(`✓ ${host}: ${PLANS_PATH} and ${PRICING_PATH}${warnings.length ? ' (with warnings)' : ''}`);
}
process.exit(failed ? 1 : 0);
