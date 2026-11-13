/**
 * GP application review — transitions, shaping, and the downstream contract.
 *
 * The load-bearing test in this file is the LAST group. The GP Application
 * Review design states on its decision panel that "Approvals grant reporting
 * access immediately". That contradicts `lpAccessState()`, which documents
 * that an application raises the ladder to 'pending' and NO FURTHER, even when
 * approved, because the reporting archive is keyed to a `limited_partners`
 * holding the applicant does not have. Implementing the design's sentence
 * literally would disclose portfolio reporting to someone who has signed
 * nothing. These tests pin the boundary.
 *
 * Run with:  node --experimental-strip-types --test cloudflare-worker/test/lpApplicationReview.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTransition, downstreamEffects, presentQueueRow, summarize,
  ageInDays, isReviewStatus, STATUS_LABELS, GP_SETTABLE, OPEN_STATUSES,
} from '../src/services/lpApplicationReview';

/* ─────────────────────────────── vocabulary ───────────────────────────── */

test('the stored statuses from migration 165 all remain valid', () => {
  // The migration shipped these four; adding queue states must not orphan them.
  for (const s of ['pending', 'approved', 'declined', 'withdrawn']) {
    assert.equal(isReviewStatus(s), true, s);
  }
});

test('pending renders as "New", not "Pending"', () => {
  // POST /lp-application writes 'pending', so it means untouched — a GP
  // reading "Pending" would think someone had already picked it up.
  assert.equal(STATUS_LABELS.pending, 'New');
});

test('a GP cannot withdraw on the applicant\'s behalf', () => {
  const r = validateTransition('pending', 'withdrawn', 'no longer interested');
  assert.equal(r.ok, false);
  assert.match((r as any).error, /Only the applicant can withdraw/);
  assert.equal(GP_SETTABLE.includes('withdrawn' as any), false);
});

test('unknown statuses are rejected, not coerced', () => {
  for (const bad of ['APPROVED', 'rejected', '', null, 42, {}]) {
    assert.equal(validateTransition('pending', bad, 'x').ok, false, String(bad));
  }
});

/* ─────────────────────────────── transitions ──────────────────────────── */

test('a decline requires a reason', () => {
  // The applicant is shown review_note on their own row, so a bare "Declined"
  // leaves someone turned away with no explanation.
  const bare = validateTransition('in_review', 'declined', '');
  assert.equal(bare.ok, false);
  assert.match((bare as any).error, /needs a reason/);

  assert.equal(validateTransition('in_review', 'declined', '  ').ok, false, 'whitespace is not a reason');
  assert.equal(validateTransition('in_review', 'declined', 'Horizon mismatch.').ok, true);
});

test('approving does not require a note', () => {
  assert.equal(validateTransition('in_review', 'approved', '').ok, true);
});

test('a no-op with no new note is refused rather than written', () => {
  // Writing it would stamp reviewed_at and make an untouched record look
  // freshly handled.
  const r = validateTransition('approved', 'approved', '');
  assert.equal(r.ok, false);
  assert.match((r as any).error, /Already Approved/);
});

test('re-stating the same status WITH a note is allowed', () => {
  // Recording new reasoning against an unchanged decision is legitimate.
  assert.equal(validateTransition('approved', 'approved', 'Counsel cleared the side letter.').ok, true);
});

test('a GP may reverse a decided application', () => {
  // The applicant cannot re-open it (POST 409s), but the GP can — on the record.
  assert.equal(validateTransition('declined', 'in_review', '').ok, true);
  assert.equal(validateTransition('approved', 'declined', 'Failed KYC after approval.').ok, true);
});

/* ─────────────── the boundary: approval is not an entitlement ─────────── */

test('approval WITHOUT a holding does not grant reporting access', () => {
  const eff = downstreamEffects('approved', /* hasHolding */ false);
  const access = eff.find((e) => e.key === 'access')!;
  assert.equal(access.done, false, 'access must NOT read as granted');
  assert.match(access.note, /NOT granted by approval/);
  assert.match(access.note, /limited_partners/);
});

test('the LPA line is honest that approval only unblocks issuance', () => {
  const lpa = downstreamEffects('approved', false).find((e) => e.key === 'lpa')!;
  assert.equal(lpa.done, false);
  assert.match(lpa.note, /Access follows the countersigned LPA, not this decision/);
});

test('with a real holding, access reads as active and sourced from the position', () => {
  const eff = downstreamEffects('approved', true);
  assert.equal(eff.find((e) => e.key === 'access')!.done, true);
  assert.match(eff.find((e) => e.key === 'access')!.note, /limited_partners position/);
});

test('the applicant always sees the decision — that IS immediate', () => {
  const seen = downstreamEffects('approved', false).find((e) => e.key === 'applicant_view')!;
  assert.equal(seen.done, true);
});

test('no downstream panel for anything except approval', () => {
  for (const s of ['pending', 'in_review', 'needs_follow_up', 'declined', 'withdrawn', null]) {
    assert.deepEqual(downstreamEffects(s, false), [], String(s));
  }
});

/* ──────────────────────────────── shaping ─────────────────────────────── */

const ROW = {
  id: 3, user_id: 91, applicant_name: 'Sofia Marchetti', email: 'sofia@example.com',
  firm: 'Marchetti Family Office', investor_type: 'family_office',
  target_commitment: 500000, preference_areas: '["fintech","deeptech"]',
  note: 'Warm intro.', status: 'pending', reviewed_by: null, reviewer_name: null,
  reviewed_at: null, review_note: null,
  created_at: '2026-08-01 10:00:00', updated_at: '2026-08-01 10:00:00',
};

test('a queue row carries identity, commitment and reviewer attribution', () => {
  const r = presentQueueRow(ROW, Date.parse('2026-08-06T10:00:00Z'))!;
  assert.equal(r.name, 'Sofia Marchetti');
  assert.equal(r.target_commitment, 500000);
  assert.deepEqual(r.preference_areas, ['fintech', 'deeptech']);
  assert.equal(r.status_label, 'New');
  assert.equal(r.age_days, 5);
});

test('an unreviewed row shows no reviewer rather than inventing one', () => {
  const r = presentQueueRow(ROW, Date.now())!;
  assert.equal(r.reviewed_by, null);
  assert.equal(r.reviewer_name, null);
  assert.equal(r.reviewed_at, null);
});

test('malformed preference_areas degrade to empty, never throw', () => {
  for (const bad of ['{not json', '', null, '"a string"', '42']) {
    const r = presentQueueRow({ ...ROW, preference_areas: bad }, Date.now())!;
    assert.deepEqual(r.preference_areas, [], String(bad));
  }
});

test('an unrecognised stored status falls back to pending, not blank', () => {
  const r = presentQueueRow({ ...ROW, status: 'garbage' }, Date.now())!;
  assert.equal(r.status, 'pending');
  assert.equal(r.status_label, 'New');
});

test('a row with no id is dropped rather than rendered empty', () => {
  assert.equal(presentQueueRow({ ...ROW, id: null }, Date.now()), null);
  assert.equal(presentQueueRow(null, Date.now()), null);
});

test('an applicant with no name falls back to their email', () => {
  const r = presentQueueRow({ ...ROW, applicant_name: null }, Date.now())!;
  assert.equal(r.name, 'sofia@example.com');
});

test('age never renders as NaN days', () => {
  assert.equal(ageInDays(null, Date.now()), 0);
  assert.equal(ageInDays('not a date', Date.now()), 0);
  assert.equal(ageInDays('2026-08-01 10:00:00', Date.parse('2026-07-01T00:00:00Z')), 0, 'future rows clamp to 0');
});

/* ──────────────────────────────── counts ──────────────────────────────── */

test('counts cover every status even when a bucket is empty', () => {
  const c = summarize([]);
  for (const s of ['pending', 'in_review', 'needs_follow_up', 'approved', 'declined', 'withdrawn']) {
    assert.equal(c[s], 0, s);
  }
  assert.equal(c.open, 0);
});

test('"open" rolls up exactly the states still needing a human', () => {
  const mk = (status: string) => presentQueueRow({ ...ROW, status }, Date.now())!;
  const c = summarize([
    mk('pending'), mk('in_review'), mk('needs_follow_up'),
    mk('approved'), mk('declined'), mk('withdrawn'),
  ]);
  assert.equal(c.open, 3, 'approved/declined/withdrawn are decided, not open');
  assert.deepEqual(OPEN_STATUSES, ['pending', 'in_review', 'needs_follow_up']);
});
