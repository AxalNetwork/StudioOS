/**
 * The advisory-session charge bucket — D81.
 *
 * `POST /api/advisors/bookings/:id/pay` asks Stripe to create a PaymentIntent
 * against a connected account. That is the most money-adjacent write in this
 * worker, and it shipped on the generic 60/min/user bucket: 600 intent
 * creations in ten minutes, fail-OPEN, so knocking out KV removed even that.
 * `promo_validate` and `admin_catalog_writes` are both tighter than the default
 * for strictly less. This closes it in the same commit that adds the route.
 *
 * THE PATTERN IS EXECUTED HERE, NOT SUBSTRING-MATCHED, for the reason
 * `rateLimit_company_invite.test.ts` gives: a regex is exactly the kind of
 * thing that reads correct and matches the wrong set, and a guard that only
 * checks two string literals appear could not catch a widened one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ADVISOR_SESSION_CHARGE } from '../src/middleware/rateLimit.ts';

const SRC = resolve(process.cwd(), 'cloudflare-worker/src/middleware/rateLimit.ts');
const src = readFileSync(SRC, 'utf8');
const at = src.indexOf("name: 'advisor_session_charge'");

// SLICED TO THIS BUCKET'S OWN OBJECT LITERAL, NOT A FIXED CHARACTER COUNT.
//
// The sibling guards use `src.slice(at, at + 400)`, and that idiom escaped a
// mutation here: this bucket is declared immediately above the generic `user`
// one, so 400 characters run past its closing brace and into a neighbour that
// also carries `scope: 'user'` — flipping THIS bucket to `scope: 'ip'` left the
// assertion satisfied by the next bucket's line. The siblings are not currently
// wrong, but only because their 400-character windows happen to land in comment
// prose; reordering the list would give them the same hole. Ending the slice at
// the literal's own `},` is correct whatever the neighbours are.
const blockEnd = src.indexOf('\n  },', at);
const bucket = blockEnd > at ? src.slice(at, blockEnd) : '';

test('the bucket exists, is strict, fails closed and is scoped per user', () => {
  assert.ok(at >= 0, 'the advisor_session_charge bucket is gone');
  assert.ok(blockEnd > at, 'the bucket declaration is unclosed, so nothing below was read');
  // The slice must hold ONE bucket. Two would mean the window ran into a
  // neighbour and every assertion below could be satisfied by the wrong one.
  assert.equal((bucket.match(/name: '/g) ?? []).length, 1,
    'the slice spans more than one bucket, so these assertions may be reading a neighbour');
  const limit = Number(/limit:\s*(\d+)/.exec(bucket)?.[1]);
  const windowSec = Number(/windowSec:\s*(\d+)/.exec(bucket)?.[1]);
  // Tighter than the generic 60/min it would otherwise fall through to. The
  // upper bound is the point: a "limit" at or above the default caps nothing.
  assert.ok(limit > 0 && limit <= 20, `limit ${limit} must be a real cap, not a formality`);
  assert.ok(windowSec >= 60, `window ${windowSec}s is shorter than a minute, so the cap barely bites`);
  assert.ok(limit / windowSec < 60 / 60, `${limit}/${windowSec}s is not stricter than the generic bucket`);
  // A limiter a KV outage removes is not a limiter on a route that moves money.
  assert.match(bucket, /failClosed:\s*true/, 'the bucket fails open');
  // Per-IP would let one founder behind a NAT spend everyone's quota, and let
  // one abuser multiply their own by rotating addresses.
  assert.match(bucket, /scope:\s*'user'/, 'the bucket is not scoped per user');
  assert.match(bucket, /m === 'POST'/, 'the bucket is not restricted to the method that charges');
});

test('the bucket is declared BEFORE the generic user bucket', () => {
  // Not cosmetic. `rateLimitMiddleware` collects every matching bucket, so the
  // order does not change which ones apply — but a reader deciding whether a
  // route is capped scans downward and stops at `user`, whose test is a bare
  // `p.startsWith('/api/')`. Every other strict bucket sits above it for that
  // reason, and a new one below would read as unreachable.
  const generic = src.indexOf("name: 'user'");
  assert.ok(generic >= 0, "the generic 'user' bucket is gone");
  assert.ok(at < generic, 'the charge bucket sits below the catch-all and reads as dead');
});

test('the pattern matches the charge route under BOTH live mounts', () => {
  // `index.ts` routes the advisors router at `/api/advisors` AND `/api/mentors`.
  // A pattern naming only the first leaves the second on the generic bucket —
  // the limiter present, and bypassable by spelling the prefix the other way.
  for (const p of [
    '/api/advisors/bookings/1/pay',
    '/api/advisors/bookings/99417/pay',
    '/api/mentors/bookings/1/pay',
    '/api/mentors/bookings/99417/pay',
  ]) assert.ok(ADVISOR_SESSION_CHARGE.test(p), `${p} creates a PaymentIntent and is not capped`);
});

test('the pattern matches nothing else in the booking family', () => {
  for (const p of [
    // The siblings a founder acts on. Capping `cancel` at 10/min because
    // someone retried a declined card would be worse than the thing prevented.
    '/api/advisors/bookings/1/confirm',
    '/api/advisors/bookings/1/cancel',
    '/api/advisors/bookings/1/complete',
    '/api/advisors/bookings/1/review',
    '/api/advisors/bookings/1',
    '/api/advisors/bookings',
    // The advisor's own side, which charges nobody.
    '/api/advisors/me/bookings/1/billing',
    '/api/advisors/me/payout-account/connect',
    // Must not widen past the segment, or spill outside the two mounts.
    '/api/advisors/bookings/1/2/pay',
    '/api/advisors/bookings/1/pay/extra',
    '/api/advisors/bookings/1/payment',
    '/api/advisors/bookings/1/prepay',
    '/api/advisor/bookings/1/pay',
    '/api/advisorsX/bookings/1/pay',
    '/api/payments/bookings/1/pay',
    '/x/api/advisors/bookings/1/pay',
  ]) assert.ok(!ADVISOR_SESSION_CHARGE.test(p), `${p} is capped at 10/min and should not be`);
});

test('the pattern is stateless between calls', () => {
  // A /g or /y flag makes `.test()` advance lastIndex, so the SECOND charge in
  // a window would miss the bucket and fall through to the 60/min one — an
  // intermittent hole no single-call test would find. Copied deliberately from
  // `rateLimit_company_invite.test.ts`: the trap is in the shape, not the route.
  assert.equal(ADVISOR_SESSION_CHARGE.flags, '', 'the pattern carries a flag that makes test() stateful');
  const p = '/api/advisors/bookings/1/pay';
  for (let i = 0; i < 3; i++) assert.ok(ADVISOR_SESSION_CHARGE.test(p), `match ${i + 1} failed`);
});

test('the route the bucket names is the route that exists', () => {
  // The pattern and the handler are written in different files, so a rename of
  // either leaves a bucket that matches nothing — a limiter that is present,
  // green, and protecting a path no request takes.
  const routes = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/advisors.ts'), 'utf8');
  assert.match(routes, /advisors\.post\('\/bookings\/:id\/pay'/,
    'the charge route was renamed or removed and this bucket now caps nothing');
  const index = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  for (const mount of ['/api/advisors', '/api/mentors']) {
    assert.ok(
      index.includes(`app.route('${mount}', advisorsRoutes)`),
      `${mount} no longer mounts the advisors router; the pattern covers a prefix that is gone`,
    );
  }
});
