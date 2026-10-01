/**
 * The company-invitation origination bucket — Task #121.
 *
 * `POST /api/company/:uid/invitations` and its `/resend` sibling mail an
 * Axal-branded link to an address somebody typed into a form. That is the
 * same surface `esign_send` exists for, and the same reasoning applies: on
 * the generic 60/min/user bucket these routes are an outbound-mail relay at
 * 3,600 messages an hour, fail-OPEN, drivable by any Owner/Admin/Founder of
 * any company. The invitation feature shipped with that gap and this closes
 * it in the same commit.
 *
 * The path test is EXECUTED here rather than substring-matched. A regex is
 * exactly the kind of thing that reads correct and matches the wrong set,
 * and the sibling `esign_send` guard — which only checks that two string
 * literals appear — could not have caught a widened one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { COMPANY_INVITE_SEND } from '../src/middleware/rateLimit.ts';

const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/middleware/rateLimit.ts'), 'utf8');
const at = src.indexOf("name: 'company_invite_send'");

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

test('the bucket exists, is strict, fails closed and is scoped per user', () => {
  assert.ok(at >= 0, 'the company_invite_send bucket is gone');
  assert.ok(blockEnd > at, 'the bucket declaration is unclosed, so nothing below was read');
  // The slice must hold ONE bucket. Two would mean the window ran into a
  // neighbour and every assertion below could be satisfied by the wrong one.
  assert.equal((bucket.match(/name: '/g) ?? []).length, 1,
    'the slice spans more than one bucket, so these assertions may be reading a neighbour');
  const limit = Number(/limit:\s*(\d+)/.exec(bucket)?.[1]);
  const windowSec = Number(/windowSec:\s*(\d+)/.exec(bucket)?.[1]);
  assert.ok(limit > 0 && limit <= 20, `limit ${limit} must be a real cap, not a formality`);
  assert.ok(windowSec >= 600, `window ${windowSec}s must be long enough that the cap bites`);
  // A limiter a KV outage removes is not a limiter on an outbound-mail route.
  assert.match(bucket, /failClosed:\s*true/, 'the bucket fails open');
  // Per-IP would let one user behind a NAT spend everyone's quota, and let
  // one abuser multiply their own by rotating addresses.
  assert.match(bucket, /scope:\s*'user'/, 'the bucket is not scoped per user');
  assert.match(bucket, /m === 'POST'/, 'reads do not send mail and must not be capped at 10/hour');
});

test('the pattern matches the two routes that send, and nothing else', () => {
  for (const p of [
    '/api/company/co-uid-1/invitations',
    '/api/company/co-uid-1/invitations/inv-uid-9/resend',
    '/api/company/9/invitations',
  ]) assert.ok(COMPANY_INVITE_SEND.test(p), `${p} sends an email and is not capped`);

  for (const p of [
    // Revoke sends nothing, and being unable to revoke because a colleague
    // sent ten invitations would be worse than the thing being prevented.
    '/api/company/co-uid-1/invitations/inv-uid-9',
    // The invitee's own accept. Capping this at 10/hour would strand someone
    // for an hour over a route that sends no mail at all.
    '/api/company/invitations/accept',
    // Not this feature.
    '/api/company/co-uid-1/members',
    '/api/company/co-uid-1',
    // Must not widen past the segment, or spill outside /api/company.
    '/api/company/a/b/invitations',
    '/api/company/co-uid-1/invitations/inv/resend/extra',
    '/api/companies/co-uid-1/invitations',
    '/api/company/co-uid-1/invitationsX',
    '/x/api/company/co-uid-1/invitations',
  ]) assert.ok(!COMPANY_INVITE_SEND.test(p), `${p} is capped at 10/hour and should not be`);
});

test('the pattern is stateless between calls', () => {
  // A /g or /y flag makes `.test()` advance lastIndex, so the SECOND
  // invitation in an hour would miss the bucket and fall through to the
  // 60/min one — an intermittent hole that no single-call test would find.
  assert.equal(COMPANY_INVITE_SEND.flags, '', 'the pattern carries a flag that makes test() stateful');
  const p = '/api/company/co-uid-1/invitations';
  for (let i = 0; i < 3; i++) assert.ok(COMPANY_INVITE_SEND.test(p), `match ${i + 1} failed`);
});
