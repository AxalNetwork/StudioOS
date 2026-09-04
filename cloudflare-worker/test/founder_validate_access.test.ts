/**
 * TWO RULES THAT FAIL SILENTLY, AND THE ONLY PLACE THEY GET CHECKED.
 *
 * The Validate bucket has one access rule that is deliberately narrower than
 * its neighbours, and one number that is deliberately refused. Both fail in the
 * direction that looks finished:
 *
 *   · A too-wide read does not error. It returns 200 with somebody else's
 *     venture in it.
 *   · A verdict computed from an unrecorded fact does not error either. It
 *     prints "Unproven" in the right font, and nothing on screen distinguishes
 *     that from a verdict somebody earned.
 *
 * Neither is observable from the outside afterwards, so this file is the moment
 * they are checked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ownsVenture, canReadBoard, canReadDecision, canWrite,
  verdictFor, laneFor, barNoteFor, VALIDATION_BAR,
  type ProjectRef,
} from '../src/routes/_founder_validate_helpers.ts';
import type { User } from '../src/types.ts';

const PROJECT: ProjectRef = { id: 7, founder_id: 42 };

/** Only the fields these predicates read; the rest of `User` is irrelevant. */
const who = (o: Partial<User>): User => ({ id: 1, email: 'x@example.com', role: 'founder', ...o } as User);

const OWNER = who({ role: 'founder', founder_id: 42 });
const OTHER_FOUNDER = who({ role: 'founder', founder_id: 99 });
const ADMIN = who({ role: 'admin' });
const PARTNER = who({ role: 'partner' });
const INVESTOR = who({ role: 'investor' });
// The case the whole helper exists for: admitted to the Lab, owns this venture,
// and carries role 'exploring' rather than 'founder'.
const LAB_MEMBER = who({ role: 'exploring', founder_id: 42, spinout_lab_active: 1 });
const LAB_MEMBER_ELSEWHERE = who({ role: 'exploring', founder_id: 99, spinout_lab_active: 1 });
const LAPSED_LAB_MEMBER = who({ role: 'exploring', founder_id: 42, spinout_lab_active: 0 });

test('the venture is its founder\'s, whatever role their account carries', () => {
  assert.equal(ownsVenture(PROJECT, OWNER), true);
  // THE CASE A ROLE TEST GETS WRONG. `user.role === 'founder'` would return
  // false here and lock an admitted Lab founder out of their own venture —
  // a failure that reads as conservative and is simply incorrect.
  assert.equal(ownsVenture(PROJECT, LAB_MEMBER), true,
    'an admitted Lab member owns their own venture even with role "exploring"');
  assert.equal(ownsVenture(PROJECT, LAB_MEMBER_ELSEWHERE), false,
    'Lab membership is not a key to every venture');
  assert.equal(ownsVenture(PROJECT, LAPSED_LAB_MEMBER), false,
    'membership must be active — spinout_lab_active is the gate');
  assert.equal(ownsVenture(PROJECT, OTHER_FOUNDER), false);
  // Staff are not owners. They reach the board through canReadBoard's own
  // branch, never through this one — which is what keeps canReadDecision
  // narrow, since it calls ownsVenture and nothing else.
  assert.equal(ownsVenture(PROJECT, ADMIN), false);
  assert.equal(ownsVenture(PROJECT, PARTNER), false,
    'if a partner "owns" a venture here, canReadDecision leaks by construction');
});

test('the board is read by exactly whoever may read the interviews', () => {
  for (const u of [OWNER, LAB_MEMBER, ADMIN, PARTNER]) {
    assert.equal(canReadBoard(PROJECT, u), true, `${u.role} should read the board`);
  }
  assert.equal(canReadBoard(PROJECT, OTHER_FOUNDER), false);
  assert.equal(canReadBoard(PROJECT, INVESTOR), false,
    'investors are excluded from un-masked founder data by the IDOR contract');
});

test('the decision is NOT — a partner is refused where the board admits them', () => {
  assert.equal(canReadDecision(PROJECT, OWNER), true);
  assert.equal(canReadDecision(PROJECT, LAB_MEMBER), true,
    'the owner must be able to read their own decision');
  assert.equal(canReadDecision(PROJECT, ADMIN), true);
  assert.equal(canReadDecision(PROJECT, PARTNER), false,
    'a service firm reading "we are stopping" is why this rule is narrower');
  assert.equal(canReadDecision(PROJECT, OTHER_FOUNDER), false);
  assert.equal(canReadDecision(PROJECT, INVESTOR), false);
});

test('the two rules actually differ — asserted, not assumed', () => {
  // The whole design is that these are NOT the same predicate. If a refactor
  // collapses one into the other, every assertion above still passes for every
  // principal except this one.
  assert.notEqual(
    canReadBoard(PROJECT, PARTNER), canReadDecision(PROJECT, PARTNER),
    'board and decision must disagree for a partner, or the narrowing is gone',
  );
});

test('writing is the venture\'s own or an admin\'s', () => {
  assert.equal(canWrite(PROJECT, OWNER), true);
  assert.equal(canWrite(PROJECT, LAB_MEMBER), true);
  assert.equal(canWrite(PROJECT, ADMIN), true);
  assert.equal(canWrite(PROJECT, PARTNER), false, 'a partner reads the board, never writes it');
  assert.equal(canWrite(PROJECT, OTHER_FOUNDER), false);
});

test('a project with no founder belongs to nobody', () => {
  // `projects.founder_id` is nullable. A null owner must not match a null
  // `user.founder_id` and hand the venture to whoever happens to have neither.
  const orphan: ProjectRef = { id: 8, founder_id: null };
  assert.equal(ownsVenture(orphan, who({ role: 'founder', founder_id: null })), false);
  assert.equal(ownsVenture(orphan, who({ role: 'exploring', founder_id: null, spinout_lab_active: 1 })), false);
});

// ---------------------------------------------------------------------------

test('a verdict that is met stands, whatever else is unrecorded', () => {
  // The bar is already cleared; more supporters cannot un-clear it, so an
  // unknown fit elsewhere does not make this one unknowable.
  assert.equal(verdictFor({ supporting: 5, contradicting: 0, fitUnrecorded: 0 }), 'validated');
  assert.equal(verdictFor({ supporting: 5, contradicting: 9, fitUnrecorded: 4 }), 'validated');
  assert.equal(verdictFor({ supporting: VALIDATION_BAR, contradicting: 0, fitUnrecorded: 0 }), 'validated');
});

test('AN UNRECORDED ICP FIT IS NOT A NO — the assertion this file exists for', () => {
  // `icp_fit` arrives in migration 211, so every interview logged before it
  // carries NULL, as does every one logged after by someone who skipped the
  // field. If those counted as "not ICP", `supporting` would read 0 and this
  // function would answer "unproven" for every claim in the product — with
  // total confidence, on no evidence — and the page would render that in the
  // same font as a verdict somebody earned.
  assert.equal(verdictFor({ supporting: 0, contradicting: 0, fitUnrecorded: 3 }), null,
    'three interviews of unknown fit is not "unproven", it is "we do not know"');
  assert.equal(verdictFor({ supporting: 1, contradicting: 4, fitUnrecorded: 2 }), null,
    'an unrecorded fit could outweigh the contradictions; refuse the verdict');
  assert.equal(barNoteFor({ supporting: 0, contradicting: 0, fitUnrecorded: 3 }), null,
    'the distance to the bar depends on a count we do not have');
  assert.equal(laneFor(null, { supporting: 0, contradicting: 0, fitUnrecorded: 3 }), 'unknown');
});

test('with every fit recorded, the canvas formula applies exactly', () => {
  const e = (supporting: number, contradicting: number) => ({ supporting, contradicting, fitUnrecorded: 0 });
  assert.equal(verdictFor(e(0, 0)), 'unproven', 'no evidence either way is a real "unproven"');
  assert.equal(verdictFor(e(4, 0)), 'unproven', 'one short of the bar');
  assert.equal(verdictFor(e(2, 4)), 'invalidated');
  // Both halves of the invalidation rule are load-bearing.
  assert.equal(verdictFor(e(0, 1)), 'unproven', 'one dissenter is not a refutation');
  assert.equal(verdictFor(e(3, 3)), 'unproven', 'contradictions must EXCEED support, not tie it');
});

test('lanes are derived, never set — and an empty claim is not "testing"', () => {
  const none = { supporting: 0, contradicting: 0, fitUnrecorded: 0 };
  assert.equal(laneFor('unproven', none), 'none', 'nothing recorded yet is its own lane');
  assert.equal(laneFor('unproven', { supporting: 2, contradicting: 0, fitUnrecorded: 0 }), 'testing');
  assert.equal(laneFor('validated', { supporting: 5, contradicting: 0, fitUnrecorded: 0 }), 'validated');
  assert.equal(laneFor('invalidated', { supporting: 0, contradicting: 2, fitUnrecorded: 0 }), 'invalidated');
});

test('the bar note never invents a number', () => {
  assert.equal(barNoteFor({ supporting: 5, contradicting: 0, fitUnrecorded: 0 }), '5 of 5 · bar met');
  assert.equal(barNoteFor({ supporting: 1, contradicting: 0, fitUnrecorded: 0 }), '4 more ICP interviews needed');
  assert.equal(
    barNoteFor({ supporting: 0, contradicting: 2, fitUnrecorded: 0 }),
    '2 contradict, 0 support · bar cannot be met',
  );
});
