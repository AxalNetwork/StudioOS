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
const at = src.indexOf("name: 'esign_send'");
// SLICED TO THIS BUCKET'S OWN OBJECT LITERAL, NOT A FIXED CHARACTER COUNT.
//
// This used `src.slice(at, at + 400)`. 400 characters exceeds every bucket
// literal in the file (they run 170–263), so the window ran past the closing
// `},` into whatever came next — and an assertion like `scope: 'user'` can then
// be satisfied by a NEIGHBOUR while this bucket says something else. It was not
// wrong today only because the overshoot happened to land in comment prose;
// reordering BUCKETS, shortening a comment or inserting a bucket would have
// given it the hole that `rateLimit_advisor_charge.test.ts` demonstrated with a
// mutation. Ending the slice at the literal's own `},` is correct whatever the
// neighbours are. This changes only how the region is located; every assertion
// below is unchanged.
const blockEnd = src.indexOf('\n  },', at);
const bucket = blockEnd > at ? src.slice(at, blockEnd) : '';

test('the origination bucket exists and is strict', () => {
  assert.ok(src.includes("name: 'esign_send'"), 'esign_send bucket must exist');
  assert.ok(blockEnd > at, 'the bucket declaration is unclosed, so nothing below was read');
  // The slice must hold ONE bucket. Two would mean the window ran into a
  // neighbour and every assertion below could be satisfied by the wrong one.
  assert.equal((bucket.match(/name: '/g) ?? []).length, 1,
    'the slice spans more than one bucket, so these assertions may be reading a neighbour');
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

test('forwarding a signed PDF joins the bucket (D410)', () => {
  // D410 opened POST /:id/forward to the envelope's sender. It mails an
  // attachment to up to ten arbitrary addresses, so it is metered with
  // origination rather than on the generic fail-open bucket. The pattern's
  // own matches are pinned in esign_send_hardening_d410.test.ts.
  assert.match(bucket, /ESIGN_FORWARD\.test\(p\)/, 'the forward route is not in the esign_send bucket');
  assert.match(bucket, /m === 'POST' && \(/, 'the POST-only guard must cover the forward arm too');
});


test('remind and void join the bucket (D411)', () => {
  // Remind mails the signing link again; void is a write on a legal record.
  // The pattern's own matches are pinned in esign_send_for_signature_d411.test.ts.
  assert.match(bucket, /ESIGN_SENDER_ACTION\.test\(p\)/, 'remind/void are not in the esign_send bucket');
});
