/**
 * LP applications — validation + presentation contract for
 * /api/spinout-lab/lp-application.
 *
 * WHAT MAKES THIS SAFE, AND WHY THE TESTS LOOK LIKE THIS.
 * An applicant authors their own row, so the whole design rests on the row
 * granting nothing: it moves the workspace's access ladder from 'visitor' to
 * 'pending', and 'pending' unlocks no reporting, no data room and no
 * allocation (asserted on the frontend side in lp_access_state.test.mjs).
 * What is left for this module to guarantee is that a submission cannot
 * misrepresent the applicant — an unrecognised investor type, an
 * out-of-bounds ticket, or an unticked accreditation box must be REJECTED,
 * not coerced into something plausible.
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lp_applications.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INVESTOR_TYPES, MIN_TICKET, MAX_TICKET,
  validateLpApplication, presentLpApplication,
} from '../src/services/lpApplications.ts';

const good = (over: Record<string, unknown> = {}) => ({
  investor_type: 'family_office',
  target_commitment: 250_000,
  preference_areas: ['fintech', 'climate'],
  accredited: true,
  note: 'Introduced by a portfolio founder.',
  ...over,
});

/* --------------------------------------------------------------- accepts */

test('a complete application validates and normalises', () => {
  const r = validateLpApplication(good());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.investor_type, 'family_office');
  assert.equal(r.value.target_commitment, 250_000);
  assert.deepEqual(r.value.preference_areas, ['fintech', 'climate']);
  assert.equal(r.value.accredited, true);
});

test('every offered investor type is accepted', () => {
  for (const t of INVESTOR_TYPES) {
    assert.equal(validateLpApplication(good({ investor_type: t })).ok, true, t);
  }
});

test('the ticket bounds themselves are valid', () => {
  assert.equal(validateLpApplication(good({ target_commitment: MIN_TICKET })).ok, true);
  assert.equal(validateLpApplication(good({ target_commitment: MAX_TICKET })).ok, true);
});

test('a numeric string ticket is accepted and rounded — form inputs are strings', () => {
  const r = validateLpApplication(good({ target_commitment: '150000.4' }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.target_commitment, 150_000);
});

/* --------------------------------------------------------------- rejects */

test('accreditation must be explicitly true, never merely truthy', () => {
  // Rule 501 is a legal precondition. 'yes', 1 and 'on' are what a sloppy
  // client sends; none of them is a certification.
  for (const v of [undefined, null, false, 0, 1, 'true', 'yes', 'on', {}]) {
    const r = validateLpApplication(good({ accredited: v }));
    assert.equal(r.ok, false, `accredited: ${JSON.stringify(v)} must be rejected`);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('accredited')));
  }
});

test('an unrecognised investor type is rejected, not coerced to "other"', () => {
  for (const v of ['sovereign_wealth', '', null, 42]) {
    assert.equal(validateLpApplication(good({ investor_type: v })).ok, false, String(v));
  }
});

test('a ticket outside the stated bounds is rejected', () => {
  for (const v of [MIN_TICKET - 1, MAX_TICKET + 1, -100, 0]) {
    assert.equal(validateLpApplication(good({ target_commitment: v })).ok, false, String(v));
  }
});

test('a missing or non-numeric ticket cannot pass as zero', () => {
  // Number(null) is 0 and Number('') is 0 — a bounds check written against the
  // coerced value would let both through as "below minimum" errors only by
  // luck, and would accept them outright if the minimum were 0.
  for (const v of [undefined, null, '', 'lots', NaN, {}, []]) {
    assert.equal(validateLpApplication(good({ target_commitment: v })).ok, false, JSON.stringify(v));
  }
});

test('an empty body is rejected with one error per failed field', () => {
  const r = validateLpApplication({});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.length, 3, r.errors.join(' | '));
});

test('a non-object body does not throw', () => {
  for (const v of [null, undefined, 'x', 42, []]) {
    assert.equal(validateLpApplication(v).ok, false);
  }
});

/* -------------------------------------------------- informational fields */

test('unknown preference areas are dropped, not fatal', () => {
  // They are informational and never restrict fund strategy, so a stale option
  // from an older client is not worth failing a submission over.
  const r = validateLpApplication(good({ preference_areas: ['fintech', 'crypto_casinos', 'FINTECH', 7] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.preference_areas, ['fintech']);
});

test('the note is trimmed and length-capped', () => {
  const r = validateLpApplication(good({ note: `  ${'x'.repeat(5000)}  ` }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.note.length, 2000);
});

/* ------------------------------------------------------------ presenting */

test('a stored row presents with parsed preferences and no reviewer identity', () => {
  const p = presentLpApplication({
    id: 3, user_id: 9, fund_slug: 'spinout-fund-i', investor_type: 'individual',
    target_commitment: 100_000, preference_areas: '["fintech"]', accredited: 1,
    note: 'hi', status: 'declined', review_note: 'Capacity closed for this vintage.',
    reviewed_at: '2026-08-01', created_at: '2026-07-01', updated_at: '2026-08-01',
  });
  assert.deepEqual(p?.preference_areas, ['fintech']);
  assert.equal(p?.accredited, true);
  // The applicant is entitled to the recorded reason…
  assert.equal(p?.review_note, 'Capacity closed for this vintage.');
  // …but not to who wrote it.
  assert.equal((p as Record<string, unknown>).reviewed_by, undefined);
});

test('an unrecognised stored status reads as pending, never as approved', () => {
  const p = presentLpApplication({
    id: 1, user_id: 1, fund_slug: 'f', investor_type: 'individual',
    target_commitment: null, preference_areas: null, accredited: 0, note: null,
    status: 'ACCEPTED!!', review_note: null, reviewed_at: null,
    created_at: 'x', updated_at: 'x',
  });
  assert.equal(p?.status, 'pending');
});

test('malformed stored preferences degrade to an empty list, not a throw', () => {
  const p = presentLpApplication({
    id: 1, user_id: 1, fund_slug: 'f', investor_type: 'individual',
    target_commitment: null, preference_areas: 'not json', accredited: 0, note: null,
    status: 'pending', review_note: null, reviewed_at: null,
    created_at: 'x', updated_at: 'x',
  });
  assert.deepEqual(p?.preference_areas, []);
});

test('no row presents as null', () => {
  assert.equal(presentLpApplication(null), null);
  assert.equal(presentLpApplication(undefined), null);
});
