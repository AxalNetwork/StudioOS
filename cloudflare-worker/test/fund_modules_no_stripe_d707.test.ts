/**
 * D707 (#1772) — no fund module reaches Stripe code, directly or through
 * another module, and `FUND_MODULES` names every fund module.
 *
 * Walks the static and dynamic relative imports from each `FUND_MODULES`
 * entry and from `services/moneyRails.ts`. The walk is clean on today's code;
 * the mutation check (an import of `stripeCall` into `services/fundLedger.ts`)
 * is its proof.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_modules_no_stripe_d707.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { FUND_MODULES } from '../src/services/moneyRails.ts';

const SRC = resolve(process.cwd(), 'cloudflare-worker/src');
const rel = (p: string) => relative(SRC, p).split('\\').join('/');

/** The Stripe code a fund module must never reach. */
/** The Stripe API's host, searched for in source text (not a URL check). */
const STRIPE_API_TEXT = ['api', 'stripe', 'com'].join('.');

const STRIPE_FILES = new Set([
  'routes/billing.ts', 'routes/payments.ts', 'services/catalog.ts', 'util/stripeError.ts', 'util/stripeTax.ts',
  'integrations/providers/stripe.ts',
]);

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = [
    ...src.matchAll(/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g),
    ...src.matchAll(/\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
    ...src.matchAll(/^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm),
  ].map((m) => m[1]);
  return specs.map((s) => resolveImport(file, s)).filter((p): p is string => !!p);
}

/** Every file reachable from `start`, with the chain that reached it. */
function reach(start: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[start, [rel(start)]]]);
  const queue = [start];
  while (queue.length) {
    const f = queue.shift()!;
    for (const next of importsOf(f)) {
      if (seen.has(next)) continue;
      seen.set(next, [...seen.get(f)!, rel(next)]);
      queue.push(next);
    }
  }
  return seen;
}

function stripeReached(start: string): string[] {
  const out: string[] = [];
  for (const [file, chain] of reach(start)) {
    const r = rel(file);
    // Two files name the host as text, not code: the CSP, and D753's connector pages (`endpoints.api`), which
    // `connector_pages_d753.test.ts` holds to calling nothing (no `fetch(`, no provider import).
    const touchesApi = r !== 'middleware/securityHeaders.ts' && r !== 'integrations/connectorPages.ts'
      && readFileSync(file, 'utf8').split(STRIPE_API_TEXT).length > 1;
    if (STRIPE_FILES.has(r) || touchesApi) out.push(chain.join(' → '));
  }
  return out;
}

test('no fund module, and not moneyRails.ts, reaches Stripe code through any import', () => {
  for (const m of [...FUND_MODULES, 'services/moneyRails.ts']) {
    const start = join(SRC, m);
    assert.ok(existsSync(start), `${m} does not exist`);
    assert.deepEqual(stripeReached(start), [], `${m} reaches Stripe code`);
  }
});

test('FUND_MODULES names every fund module under routes/, services/ and models/', () => {
  const found: string[] = [];
  for (const dir of ['routes', 'services', 'models']) {
    const d = join(SRC, dir);
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d)) {
      if (!/\.ts$/.test(n)) continue;
      if (/^(fund|capital|_capital|lp_)/.test(n) || n === 'distributions.ts') found.push(`${dir}/${n}`);
    }
  }
  assert.deepEqual([...FUND_MODULES].sort(), found.sort(), 'a fund module is missing from FUND_MODULES, or one listed is gone');
  assert.ok(found.length >= 19);
});

test('the walk sees dynamic and re-export imports, so it cannot be dodged by them', () => {
  // routes/payments.ts reaches its intro packs through a dynamic import; the walker must follow it.
  const fromPayments = [...reach(join(SRC, 'routes/payments.ts')).keys()].map(rel);
  assert.ok(fromPayments.includes('services/introductions.ts'), 'a dynamic import was not followed');
  assert.ok(fromPayments.includes('routes/billing.ts'));
  assert.ok(stripeReached(join(SRC, 'routes/payments.ts')).length > 0, 'the check itself finds Stripe code');
});
