/**
 * The e-sign origination bucket.
 *
 * POST /api/legal/esign/send emails an Axal-branded signing link to an
 * arbitrary recipient address. While the route was requireAdmin-only it fell
 * through to the generic 60/min/user bucket, fail-OPEN. De-admining it without
 * a dedicated limit would have turned it into an unmetered outbound-mail relay
 * that an attacker could uncap by making KV unavailable.
 *
 * These tests pin the bucket's existence and its two properties that are easy
 * to lose in a refactor: it must be strict, and it must fail CLOSED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/middleware/rateLimit.ts'), 'utf8');
const bucket = src.slice(src.indexOf("name: 'esign_send'"), src.indexOf("name: 'esign_send'") + 400);

test('the origination bucket exists and is strict', () => {
  assert.ok(src.includes("name: 'esign_send'"), 'esign_send bucket must exist');
  const limit = Number(/limit:\s*(\d+)/.exec(bucket)?.[1]);
  const windowSec = Number(/windowSec:\s*(\d+)/.exec(bucket)?.[1]);
  assert.ok(limit > 0 && limit <= 20, `limit ${limit} must be a real cap, not a formality`);
  assert.ok(windowSec >= 600, `window ${windowSec}s must be long enough that the cap bites`);
});

test('the origination bucket fails CLOSED', () => {
  // A limiter that fails open on a KV outage is a limiter an attacker can
  // remove. This one guards outbound email, so it must reject instead.
  assert.match(bucket, /failClosed:\s*true/);
});

test('it is scoped per user, not per IP', () => {
  // Per-IP would let one user behind a shared NAT exhaust everyone else's
  // quota, and would let one abuser rotate IPs to multiply their own.
  assert.match(bucket, /scope:\s*'user'/);
});

test('it matches the mounted path, and the path a remount would use', () => {
  assert.match(bucket, /'\/api\/legal\/esign\/send'/, 'the path actually mounted today');
  assert.match(bucket, /'\/api\/esign\/send'/, 'and the one index.ts warns against, defensively');
  assert.match(bucket, /m === 'POST'/, 'origination is a POST; reads are covered elsewhere');
});
