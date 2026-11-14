import { holdsLicence, holdsOnlyLicence } from '../services/accountLicences';
import { claimStatusV2, distinctRecorded, type ClaimStatusV2 } from '../services/validateMethodology';
/**
 * The two decisions this bucket gets wrong quietly: who may read a row, and
 * what a missing fact is allowed to imply.
 *
 * Both live here as PURE functions rather than inline in the route, because
 * both are the kind of logic that is only ever checked at the moment it is
 * written. An access predicate compiled into a handler can be exercised only
 * through a request; a verdict computed inline can be exercised only through a
 * database. Neither gets the adversarial test it needs that way.
 */
import type { User } from '../types';
import { canAccessFounderResource } from '../auth';

export type ProjectRef = { id: number; founder_id: number | null };

/**
 * Is this person the venture's own?
 *
 * NOT a role test, and that is the whole subtlety. `ensureCanEdit` in
 * `routes/progress.ts` documents why: "Active Spin-Out Lab members log
 * interviews/OKRs as program deliverables regardless of account role (admitted
 * users keep e.g. 'exploring')." A Lab founder may hold role `exploring`, so
 * `user.role === 'founder'` alone locks the owner out of their own venture —
 * a failure that looks safe, reads as conservative, and is simply wrong.
 *
 * The role is narrowed BEFORE `canAccessFounderResource` is called, because
 * that predicate treats partners as privileged (`auth.ts:519-531`). Calling it
 * first would quietly readmit every partner through a function whose name
 * suggests it is checking ownership.
 */
export function ownsVenture(project: ProjectRef, user: User): boolean {
  if (holdsLicence(user, 'founder')) {
    return canAccessFounderResource(user, project.founder_id);
  }
  // Explicit ownership comparison, copied from `ensureCanEdit` rather than
  // re-derived: an admitted Lab member on THEIR OWN project, whatever role
  // their account carries.
  return (
    Number(user.spinout_lab_active ?? 0) === 1
    && project.founder_id != null
    && user.founder_id === project.founder_id
  );
}

/**
 * D757 §2.11: may this person hold a Validate source (Zoom, Meet transcripts,
 * WhatsApp, Telegram)? `ownsVenture`'s rule without a project: an admin, a
 * `founder`, or an active Lab member with a `founder_id` — the last whatever
 * their role says, for the reason above (a Lab founder may be `exploring`).
 */
export function canHoldValidateSource(user: Pick<User, 'role' | 'founder_id' | 'spinout_lab_active'>): boolean {
  const role = String(user.role ?? '').toLowerCase();
  if (role === 'admin' || holdsLicence(user, 'founder')) return true;
  return Number(user.spinout_lab_active ?? 0) === 1 && user.founder_id != null;
}

/**
 * The hypothesis board and the validation summary.
 *
 * Same audience as the interviews they are derived from — admin and partner
 * are studio-wide staff with broad access by design, investors are excluded by
 * the IDOR contract. Derived data read by a WIDER set than its source leaks the
 * source; read by a NARROWER set it is merely inconsistent, but inconsistency
 * here would mean a partner who can read every raw interview cannot read a
 * count of them, which is not a rule anyone could explain.
 */
export function canReadBoard(project: ProjectRef, user: User): boolean {
  if (user.role === 'admin' || holdsLicence(user, 'partner')) return true;
  return ownsVenture(project, user);
}

/**
 * The founder's own proceed / pivot / stop.
 *
 * DELIBERATELY NARROWER THAN THE BOARD, and the difference is the point. The
 * board is a reading of the interviews; this is the founder's statement about
 * their own venture. A founder writing "we are stopping" into a row that an
 * outside service firm they hired can read is a founder with a reason not to
 * write it honestly — and a record nobody writes honestly is worse than no
 * record, because it still looks like one.
 *
 * Partners are excluded HERE and only here.
 */
export function canReadDecision(project: ProjectRef, user: User): boolean {
  if (user.role === 'admin') return true;
  return ownsVenture(project, user);
}

/** Writing anything in this bucket is the venture's own, or an admin's. */
export function canWrite(project: ProjectRef, user: User): boolean {
  if (user.role === 'admin') return true;
  return ownsVenture(project, user);
}

/** D895: the founder's deck links never inherit the bucket's admin write grant. */
export function canWritePitchDeck(project: ProjectRef, user: User): boolean {
  return String(user.role).toLowerCase() !== 'admin' && !holdsOnlyLicence(user, 'advisor') && canWrite(project, user);
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * Supporting ICP interviews required before a claim counts as validated.
 *
 * A CONSTANT, NOT A SETTING. The canvas hardcodes five. A constant the code
 * actually applies is a true fact about the product; a per-project settings row
 * nobody can write to is a table pretending to be a feature. The pages say the
 * bar is five and say it is not configurable yet.
 */
export const VALIDATION_BAR = 5;

export type Evidence = {
  /** Interviews recorded as ICP that support the claim. */
  supporting: number;
  /** ALL interviews that contradict it, ICP or not. */
  contradicting: number;
  /**
   * Interviews touching this claim whose `icp_fit` was never recorded.
   *
   * The asymmetry above is deliberate and is the canvas's own: a claim is
   * proved by the people it is FOR, and disproved by anyone at all. This third
   * number is what stops that asymmetry lying when the fit is unknown.
   */
  fitUnrecorded: number;
  /**
   * D4586 coverage, never part of the status. `both`: interviews touching both
   * directions (already inside `supporting` when ICP, and `contradicting`).
   * `interviews`: distinct interviews touching the claim at all, any fit.
   * `interviewees` / `organizations`: distinct people and companies behind
   * them, null when not recorded on every one of those interviews.
   */
  both?: number;
  interviews?: number;
  interviewees?: number | null;
  organizations?: number | null;
};

/** `contested` is D4586 v2's: the bar is met and the contradiction is material. */
export type Verdict = 'validated' | 'contested' | 'invalidated' | 'unproven';

/**
 * ICP means strong or partial. NULL is a fourth state, counted separately.
 *
 * An explicit `none` is a RECORDED non-ICP: it counts toward nothing and is not
 * unknown either. Collapsing it with NULL would lose the difference between
 * "we checked, they were not our customer" and "we never looked".
 */
export const isIcp = (fit: string | null | undefined) => fit === 'strong' || fit === 'partial';

/**
 * Fold interviews into one hypothesis's three counts.
 *
 * Pure and exported so the NULL-fit rule can be exercised against rows rather
 * than only through a request. The two asymmetries here are the canvas's own
 * and both are deliberate:
 *
 *   · A claim is proved by the people it is FOR (ICP only) and disproved by
 *     anyone at all (every interview counts against).
 *   · An interview counts ONCE per hypothesis however many of its pains match,
 *     otherwise one talkative interviewee outvotes a room.
 */
export function evidenceFor(
  links: Array<{ pain_group_id: number; direction: string }>,
  interviews: Array<{ icp_fit: string | null; groups: Set<number>; name?: string | null; company?: string | null }>,
): Evidence {
  const supports = new Set(links.filter((l) => l.direction === 'supports').map((l) => l.pain_group_id));
  const against = new Set(links.filter((l) => l.direction === 'contradicts').map((l) => l.pain_group_id));
  let supporting = 0; let contradicting = 0; let fitUnrecorded = 0; let both = 0;
  const touching: Array<{ name?: string | null; company?: string | null }> = [];
  for (const iv of interviews) {
    let touchesSupport = false; let touchesAgainst = false;
    for (const g of iv.groups) {
      if (supports.has(g)) touchesSupport = true;
      if (against.has(g)) touchesAgainst = true;
    }
    if (touchesAgainst) contradicting += 1;
    if (touchesSupport) {
      if (isIcp(iv.icp_fit)) supporting += 1;
      else if (iv.icp_fit == null) fitUnrecorded += 1;
    }
    if (touchesSupport && touchesAgainst) both += 1;
    if (touchesSupport || touchesAgainst) touching.push(iv);
  }
  // D4586 § 2: breadth is display only. A name or company missing on any one interview makes it "not recorded".
  return {
    supporting, contradicting, fitUnrecorded, both, interviews: touching.length,
    interviewees: distinctRecorded(touching.map((iv) => iv.name)),
    organizations: distinctRecorded(touching.map((iv) => iv.company)),
  };
}

/** D4586 v2's statuses in the verdict's stored vocabulary (the history and every reader keep these words). */
const V2_VERDICT: Record<ClaimStatusV2, Verdict | null> = {
  supported: 'validated', contested: 'contested', contradicted: 'invalidated', insufficient: 'unproven', unknown: null,
};

/**
 * The verdict, or `null` when the rows cannot support one. Methodology v2
 * (D4586 § 3, `claimStatusV2`):
 *
 *   1. CONTRADICTION IS READ BEFORE THE BAR. `invalidated` when at least two
 *      interviews contradict and they outnumber the supporters, so 5 / 50 is
 *      no longer "validated" as it was under v1.
 *   2. `contested` once the bar is met and the contradiction is material
 *      (at least two, and one for every two supporters).
 *   3. `validated` once the bar is met otherwise; `unproven` below it.
 *
 * `null` IS STILL THE IMPORTANT RETURN VALUE. `icp_fit` is new in migration
 * 211, so many interviews carry NULL. Counting those as "not ICP" would answer
 * with confidence on no evidence. v2 answers `null` exactly when counting the
 * unrecorded fits as ICP would change the status; when they cannot change it,
 * the status stands and the page still says how many fits are missing.
 */
export function verdictFor(e: Evidence, bar: number = VALIDATION_BAR): Verdict | null {
  return V2_VERDICT[claimStatusV2(e, bar)];
}

/**
 * The v1 rule, kept only so the verdict history can tell a status that moved
 * because the METHOD changed from one that moved because the evidence did
 * (D4586 § 6). Never shown as a claim's status.
 */
export function verdictForV1(e: Evidence, bar: number = VALIDATION_BAR): Exclude<Verdict, 'contested'> | null {
  if (e.supporting >= bar) return 'validated';
  if (e.fitUnrecorded > 0) return null;
  if (e.contradicting > e.supporting && e.contradicting >= 2) return 'invalidated';
  return 'unproven';
}

/** Which lane a card sits in. Derived from the verdict, never set by hand. A contested claim stays in Testing (D4586 § 3). */
export function laneFor(v: Verdict | null, e: Evidence): 'none' | 'testing' | 'validated' | 'invalidated' | 'unknown' {
  if (v === 'validated') return 'validated';
  if (v === 'contested') return 'testing';
  if (v === 'invalidated') return 'invalidated';
  if (v === null) return 'unknown';
  // D4586 v2: an interview of unrecorded fit is evidence still to be read, so a claim it touches is being tested.
  if (e.supporting === 0 && e.contradicting === 0 && !(e.fitUnrecorded > 0)) return 'none';
  return 'testing';
}

/** A claim's state under v1, for the verdict history's "method changed" test only (D4586 § 6). */
export function v1StateFor(e: Evidence): { verdict: string | null; lane: string } {
  const verdict = verdictForV1(e);
  return { verdict, lane: laneFor(verdict, e) };
}

/**
 * How far this claim is from its bar, in words, or `null` when unknowable.
 *
 * Returns `null` rather than a cheerful "4 more needed" when the missing fits
 * could change the status: the distance depends on a count we do not have, so
 * any number here would be invented. Support and contradiction are named
 * together whenever both are present (D4586 § 1).
 */
export function barNoteFor(e: Evidence, bar: number = VALIDATION_BAR): string | null {
  const status = claimStatusV2(e, bar);
  if (status === 'unknown') return null;
  if (status === 'contradicted') return `${e.contradicting} contradict, ${e.supporting} support · contradiction outweighs support`;
  if (status === 'contested') return `${e.supporting} of ${bar} · bar met · ${e.contradicting} contradict · contested`;
  if (status === 'supported') return `${e.supporting} of ${bar} · bar met${e.contradicting > 0 ? ` · ${e.contradicting} contradict` : ''}`;
  const missing = e.fitUnrecorded > 0 ? ` · ${e.fitUnrecorded} with no fit recorded` : '';
  return `${bar - e.supporting} more ICP interviews needed${missing}`;
}
