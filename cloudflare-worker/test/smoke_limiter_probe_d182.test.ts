/**
 * The post-deploy smoke's second `/api/*` probe must actually reach the rate
 * limiter, and its first must actually skip it.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `scripts/check-spa-live.mjs` probed one
 * path, `/api/health`, which is the first entry of `RATE_LIMIT_EXEMPT` — so
 * `rateLimitMiddleware` returns `next()` before doing any work and the probe
 * proved nothing about it. That is why the smoke stayed green through the
 * 2026-09-12 sign-in outage (D78). The second probe only closes that hole while
 * it stays OUTSIDE the exempt list, and the exempt list is edited in a different
 * file from the probe — so nothing but an assertion keeps the two in step.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/smoke_limiter_probe_d182.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { codeOnly } from '../../frontend/test/_codeOnly.mjs';

const root = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SMOKE = root('scripts/check-spa-live.mjs');
const RATE_LIMIT = codeOnly(root('cloudflare-worker/src/middleware/rateLimit.ts'));
const INDEX = codeOnly(root('cloudflare-worker/src/index.ts'));

/** The exempt list as source text, bounded to its own array literal. */
function exemptEntries(): string[] {
  const at = RATE_LIMIT.indexOf('RATE_LIMIT_EXEMPT');
  assert.ok(at >= 0, 'RATE_LIMIT_EXEMPT is gone, so this guard is aimed at nothing');
  const open = RATE_LIMIT.indexOf('[', at);
  const close = RATE_LIMIT.indexOf(']', open);
  assert.ok(close > open, 'the RATE_LIMIT_EXEMPT array is unclosed');
  return [...RATE_LIMIT.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The default of a probe const in the smoke script. */
function probeDefault(name: string): string {
  const re = new RegExp(`${name}\\s*=[\\s\\S]{0,120}?\\|\\|\\s*'([^']+)'`);
  const m = re.exec(SMOKE);
  assert.ok(m, `${name} is gone from check-spa-live.mjs, or no longer has a literal default`);
  return m![1];
}

// The same rule the middleware applies: exact match, or a prefix ending at a
// slash boundary. Restating it here rather than importing it is deliberate —
// this test must fail if the middleware's rule and the probe stop agreeing,
// and a shared helper would make them agree by construction.
const isExempt = (path: string, entries: string[]) =>
  entries.some((p) => path === p || path.startsWith(`${p}/`));

test('the limited probe is NOT exempt, and the unlimited one is', () => {
  const entries = exemptEntries();
  assert.ok(entries.length >= 5, `read only ${entries.length} exempt entries — the slice is wrong`);

  const unlimited = probeDefault('API_PROBE_PATH');
  const limited = probeDefault('API_PROBE_LIMITED_PATH');

  assert.ok(isExempt(unlimited, entries),
    `the smoke's first probe ${unlimited} is no longer exempt, so both probes now ask the `
    + 'same question and the exempt-answers-fast half of the diagnosis is gone');
  assert.ok(!isExempt(limited, entries),
    `the smoke's second probe ${limited} is now matched by RATE_LIMIT_EXEMPT `
    + `(${entries.join(', ')}), so it returns before rateLimitMiddleware does any work — `
    + 'which is the exact blindness it was added to remove');
});

test('the limited probe still reaches the middleware chain and answers JSON', () => {
  const limited = probeDefault('API_PROBE_LIMITED_PATH');
  assert.ok(limited.startsWith('/api/'),
    `${limited} is outside /api/, so neither the middleware mount nor the buckets see it`);
  assert.match(INDEX, /app\.use\('\/api\/\*', rateLimitMiddleware\(\)\)/,
    'the limiter is no longer mounted across /api/*, so the probe traverses nothing');
  // The probe deliberately names no route, so the 404 handler is what answers
  // it — and `checkApiRouting` counts a JSON body as proof the Worker replied.
  assert.match(INDEX, /app\.notFound\(\(c\) => c\.json\(/,
    'the 404 handler stopped answering JSON, so an unmounted probe path would read as an '
    + 'HTML response — which this smoke reports as "the Worker was never reached"');
});

test('the two probes are reported as separate lines, and the pair is a named diagnosis', () => {
  assert.match(SMOKE, /limiter EXEMPT/,
    'the exempt probe no longer says so in its PASS line, so the two results read alike');
  assert.match(SMOKE, /rate-limit middleware answers/,
    'the non-exempt probe has no distinct PASS line');
  assert.match(SMOKE, /THE 2026-09-12 SIGNATURE/,
    'the combination — exempt answers, non-exempt does not — is no longer named, so the '
    + 'operator is left to infer it from two unrelated-looking failures');
  assert.match(SMOKE, /RATE_LIMITS/,
    'the diagnosis no longer names the KV binding to look at');
  assert.match(SMOKE, /rateLimitMiddleware/,
    'the diagnosis no longer names the middleware');
});
