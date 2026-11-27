/**
 * The referral status vocabulary, on both sides.
 *
 * Reconciling the Refer & Earn canvas against the shipped surface found no
 * gap worth closing, which is itself the finding: the rewrite in tasks
 * #136–#140 implements the canvas faithfully, its eleven statuses match the
 * canvas's STATUS_STYLE keys one for one, and the canvas contains no mention
 * of Stripe, payouts or withdrawals — so it does not reintroduce the payouts
 * backend that was deliberately deleted. `cloudflare-worker/test/
 * referral_submissions.test.ts` already guards that deletion.
 *
 * One thing was unguarded. ReferralsPage.jsx's STATUS_TONE map carries the
 * comment "Mirrors the server's status vocabulary", and nothing made that
 * true. A status the server can emit but the client cannot style renders
 * neutral — degraded rather than broken, which is exactly the kind of drift
 * that survives review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const page = read('frontend/src/pages/ReferralsPage.jsx');
const service = read('cloudflare-worker/src/services/referralSubmissions.ts');

const serverStatuses = () => {
  const block = service.slice(
    service.indexOf('export const STATUS_LABELS'),
    service.indexOf('};', service.indexOf('export const STATUS_LABELS')),
  );
  return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
};

const clientStatuses = () => {
  const block = page.slice(
    page.indexOf('const STATUS_TONE = {'),
    page.indexOf('};', page.indexOf('const STATUS_TONE = {')),
  );
  return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
};

test('the parse is live on both sides', () => {
  assert.ok(serverStatuses().length >= 10, `parsed ${serverStatuses().length} server statuses`);
  assert.ok(clientStatuses().length >= 10, `parsed ${clientStatuses().length} client statuses`);
});

test('the client can style every status the server can emit', () => {
  const client = new Set(clientStatuses());
  const unstyled = serverStatuses().filter((s) => !client.has(s));
  assert.deepEqual(unstyled, [], 'these render as neutral chips instead of their own tone');
});

test('the client styles nothing the server cannot emit', () => {
  // The other direction is dead configuration rather than a visible bug, but
  // it means someone deleted a status server-side and left the tone behind.
  const server = new Set(serverStatuses());
  const orphans = clientStatuses().filter((s) => !server.has(s));
  assert.deepEqual(orphans, [], 'the server no longer emits these');
});

test('the terminal statuses agree about what a referrer can still act on', () => {
  // ReferralsPage disables the response box on these; the service calls them
  // the statuses "the pipeline is done with". Two lists, one meaning.
  assert.match(page, /\['reward_issued', 'rejected', 'closed'\]\.includes\(detail\.status\)/);
  assert.match(service, /Statuses a referrer can no longer act on/);
  for (const s of ['reward_issued', 'rejected', 'closed']) {
    assert.ok(serverStatuses().includes(s), `${s} is not a real status`);
  }
});

test('the canvas did not bring Stripe Connect back', () => {
  // The payouts backend was removed in task #138 across five call sites. The
  // canvas names no payout mechanism at all, and neither does the page.
  //
  // Read the CODE, not the file: ReferralsPage's own docblock explains the
  // removal — "the old page was organised around a Stripe Connect balance" —
  // and a guard that fires on the history of a deletion is a guard nobody can
  // keep. This is the same trap that once made a coupling test pass on a
  // comment saying the scoping did NOT exist.
  const code = codeOnly(page);
  for (const word of [/stripe/i, /\bpayout/i, /connect account/i]) {
    assert.doesNotMatch(code, word, 'Refer & Earn must not regrow a payouts surface');
  }
  // And the docblock explaining why must survive, so the next reader knows.
  assert.match(page, /Stripe Connect balance/);
});
