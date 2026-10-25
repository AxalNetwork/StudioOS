/**
 * The local approval queues, declared once (D130; eleven since D215's S16).
 *
 * WHY THIS FILE EXISTS. `backlogOf` in `rpc/branchOps.ts` already named all
 * four stores with their real tables and their real status vocabularies, and
 * its own docblock said what would come next: *"The per-queue split is S3's
 * board, which PR 13 builds over a read model; duplicating a partial version
 * of it here would be a second answer to the same question."* This is that
 * read model, and the list moved here rather than being copied — a second copy
 * is how H1's backlog count and S3's board come to disagree about what "open"
 * means, which is a disagreement nobody would notice until an admin asked why
 * the number above the board does not match the rows in it.
 *
 * It is the third time this programme has consolidated rather than duplicated:
 * D127 made two readers of seats-used run one `GROUP BY role`, D128 gave four
 * callers one LIKE escaper, and this gives two readers one definition of open.
 *
 * THE VOCABULARIES ARE EACH STORE'S OWN, NOT GUESSED, and `backlogOf`'s
 * comment records what that cost to learn: *"Two of the four table names in
 * the first draft of this function were wrong, which would not have failed —
 * it would have reported the backlog as permanently unreadable, a
 * plausible-looking answer that is never right."* Two traps in particular:
 *
 *   · **Cohort applications live in `cohort_applicants`** (migration 157), the
 *     per-cycle decision row. `spinout_applications` (migration 155) is the
 *     submission form's own store and is a different thing — an admin deciding
 *     a cohort is deciding the applicant row.
 *   · **A moderation case awaiting a decision is `under_review`.** `'active'`
 *     is a RESOLVED case, so counting it would put closed work on the board.
 *
 * AND `'draft'` IS DELIBERATELY NOT REVIEWER BACKLOG. A draft referral belongs
 * to the member still writing it. Counting it would put the branch admin under
 * pressure for work nobody has handed them, which is the opposite of what a
 * board ordered by age is for.
 *
 * THE OUTBOUND LANE IS NOT HERE. `branch_escalations` (D112) is what this
 * branch asked HQ, not a queue it decides, and it already has its own route
 * and its own page. S3 draws it as a fifth lane; the board composes it beside
 * these four rather than pretending it is one of them.
 */
import type { Env } from '../types';
import { SLA_DUE_SOON_HOURS } from './slaWindow';
import { MODERATION_AWAITING_SQL } from './moderationOpen';
import { PRE_VERDICT_STATUSES } from './referralSubmissions';
import { IS_WAITING_SQL } from './partnerProfiles';
import type { HqLaneKey } from './hqApprovalSources';

/** A lane's stable key. The UI orders by this list, so the order is the canvas's. */
export type ApprovalLaneKey =
  | 'lp' | 'referrals' | 'cohort' | 'moderation'
  | 'kyc' | 'partner_profiles' | 'exploring' | 'jobs' | 'events' | 'best_fit' | 'due_diligence'
  // D1041 (#2889): the lanes D1038's canvas adds.
  | 'kyb' | 'comarketing' | 'wellbeing_experts' | 'perk_listings' | 'strategic_access'
  | 'lab_hosts' | 'score_flags' | 'articles'
  // D1041: HQ's own lanes (`hqApprovalSources.ts`, `scope: 'hq'`), so HQ's
  // inbox (D1040) reads, assigns and keeps history on them like any other.
  | HqLaneKey;

export type ApprovalSource = {
  key: ApprovalLaneKey;
  /** The lane's name on the board, and the name in a "could not be read" reason. */
  label: string;
  /**
   * The COUNT query, complete and literal.
   *
   * NO INTERPOLATION ANYWHERE IN EITHER STRING, and that is `check-sql-prepare`'s
   * rule rather than a style choice: nothing reaches the query TEXT, and a rule
   * with a "provably safe" exemption is one somebody widens later. D127 hit the
   * same guard with a `?, ?, ?, ?` placeholder list that could only ever be
   * safe, and took the same answer — restructure so there is nothing to exempt.
   *
   * NO JOIN IN THE COUNT, and the first draft had one. A `JOIN users` would
   * have made the BACKLOG COUNT depend on the join: an application whose user
   * row was deleted would silently drop out of the total, and the total would
   * still look like a total. `branch_rpc_fanout.test.ts` caught it because its
   * fixture seeds the queue tables without a `user_id` column at all.
   */
  countSql: string;
  /**
   * The rows query, complete and literal, ending `LIMIT ?` — **bound**, not
   * interpolated, so the cap is a parameter like any other value.
   *
   * Its join is LEFT for the same reason the count has none: an orphaned row is
   * still work somebody is waiting on, and an inner join would delete it from
   * the board while leaving it in the count — the two disagreeing again, one
   * level down. `who` then falls back twice, never to a blank: an empty name to
   * the email, a missing user row to the account id.
   */
  rowsSql: string;
  /**
   * D1041 — who a decision in this lane tells today, read off the decide
   * route, in the canvas's words ("The member", "The partner", "The author",
   * "Nobody yet"). An audit or activity row is not a notice, so a lane whose
   * route writes only that says "Nobody yet".
   */
  notifies: string;
  /**
   * D1041 — the page that decides this lane, by its name on the canvas (APR2's
   * "Decided on"), or null when nothing decides it yet; `undecidedReason` then
   * says why.
   */
  decidedOn: string | null;
  undecidedReason?: string;
  /**
   * D1041 — a second count inside the lane (APR2's line under it), literal like
   * the others. It is read alone: a failed sub-count is null and leaves the
   * lane's own count standing.
   */
  sub?: { label: string; countSql: string };
  /**
   * D1040 (#2888): `'hq'` marks a lane that is HQ's own work (part 3's HQ
   * lanes, #2390). HQ's inbox shows it to a Super Admin only (`sourcesFor`).
   * No lane in this file sets it: they are every studio's. D1041's HQ lanes
   * (`hqApprovalSources.ts`) all do.
   */
  scope?: 'hq';
};

/**
 * Referrals reuse the route's own set minus `'draft'` rather than restating it,
 * so adding a status there reaches the board without anybody remembering to.
 */
const REFERRAL_OPEN = [...PRE_VERDICT_STATUSES].filter((s) => s !== 'draft');

/*
 * THERE IS NO ASSEMBLED `IN (…)` STRING HERE, AND THE ABSENCE IS THE POINT.
 * An earlier draft built one from `REFERRAL_OPEN` and spliced it into the
 * query; `check-sql-prepare` refuses any `${}` inside a `DB.prepare()`
 * template, so the statuses are spelled out in the literals below instead and
 * `branch_approvals_d130.test.ts` parses both sides to hold them to each
 * other. The builder outlived that change as dead code until
 * CodeQL named it — a scrap of a mechanism that was replaced, still carrying a
 * comment describing how the SQL was built, which it no longer is.
 */

export const APPROVAL_SOURCES: readonly ApprovalSource[] = [
  {
    key: 'lp',
    label: 'LP applications',
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM lp_applications WHERE status = \'pending\'',
    rowsSql:
      "SELECT a.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || a.user_id) AS who, "
      + "'LP application · ' || a.fund_slug AS what, a.created_at AS created_at "
      + 'FROM lp_applications a LEFT JOIN users u ON u.id = a.user_id '
      + "WHERE a.status = 'pending' ORDER BY a.created_at ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'LP applications',
  },
  {
    key: 'referrals',
    label: 'Referrals',
    // THE STATUS LIST IS WRITTEN OUT, AND A TEST HOLDS IT TO
    // `PRE_VERDICT_STATUSES` MINUS `'draft'`. Building it with `${}` is what
    // `check-sql-prepare` refuses; letting it drift from the route's own set is
    // what the test refuses. That pairing is the D127 pattern — its
    // `branch_seats_from_role.test.ts` parses migration 187's CHECK and asserts
    // `SEAT_ROLES` equals it, for exactly this reason.
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM referral_submissions '
      + "WHERE status IN ('submitted', 'under_review', 'more_info_needed')",
    rowsSql:
      "SELECT s.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || s.referrer_user_id) AS who, "
      + "'Referral · ' || s.referred_name AS what, s.created_at AS created_at "
      + 'FROM referral_submissions s LEFT JOIN users u ON u.id = s.referrer_user_id '
      + "WHERE s.status IN ('submitted', 'under_review', 'more_info_needed') "
      + 'ORDER BY s.created_at ASC LIMIT ?',
    notifies: 'Nobody yet',
    decidedOn: 'Refer & Earn › Queue',
  },
  {
    key: 'cohort',
    label: 'Cohort applications',
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM cohort_applicants WHERE status = \'pending\'',
    rowsSql:
      "SELECT ca.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || ca.user_id) AS who, "
      + "'Cohort application' AS what, ca.created_at AS created_at "
      + 'FROM cohort_applicants ca LEFT JOIN users u ON u.id = ca.user_id '
      + "WHERE ca.status = 'pending' ORDER BY ca.created_at ASC LIMIT ?",
    notifies: 'The member',
    decidedOn: 'Spin-Out Lab',
  },
  {
    key: 'moderation',
    label: 'Spinout moderation',
    // Awaiting a decision, the same predicate the moderation console counts
    // as open_count (D448). A sanction in force is not this lane.
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM spinout_moderation_cases WHERE '
      + MODERATION_AWAITING_SQL,
    rowsSql:
      "SELECT m.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || m.user_id) AS who, "
      + "'Moderation · ' || m.reason_code AS what, m.created_at AS created_at "
      + 'FROM spinout_moderation_cases m LEFT JOIN users u ON u.id = m.user_id WHERE '
      + MODERATION_AWAITING_SQL
      + ' ORDER BY m.created_at ASC LIMIT ?',
    notifies: 'Nobody yet',
    decidedOn: 'Spin-Out moderation',
  },
  // ── S16 (D215): the queues the live console kept on their own pages. ──
  //
  // SEVEN OF THE CANVAS'S ELEVEN, because only seven have a state that means
  // "waiting on an admin". The other four are named in `NOT_LANED` below with
  // the reason, rather than laned over a predicate invented to fill a column.
  {
    key: 'kyc',
    label: 'KYC',
    // The store IS `users`: kyc.ts:195 stamps `kyc_submitted_at` and sets
    // `'pending'` whenever the provider did not decide on its own.
    countSql:
      'SELECT COUNT(*) AS n, MIN(kyc_submitted_at) AS oldest FROM users WHERE kyc_status = \'pending\'',
    rowsSql:
      "SELECT u.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || u.id) AS who, "
      + "'KYC · ' || COALESCE(u.role, 'account') AS what, u.kyc_submitted_at AS created_at "
      + "FROM users u WHERE u.kyc_status = 'pending' ORDER BY u.kyc_submitted_at ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'KYC & KYB',
  },
  {
    key: 'partner_profiles',
    label: 'Partner profiles',
    // PK is `email` and `user_id` may be null (migration 275's header), so the
    // row id is SQLite's `rowid` and the join is on email, as profiling.ts does.
    // D990 — a Draft (no chat, no answers: Eadwyn's name-only rows) is not
    // waiting, so the lane counts and lists `IS_WAITING_SQL`, the same rule
    // as the Partner profiles queue (services/partnerProfiles.ts).
    countSql:
      'SELECT COUNT(*) AS n, MIN(p.created_at) AS oldest FROM partner_profiles p WHERE ' + IS_WAITING_SQL,
    rowsSql:
      "SELECT p.rowid AS id, COALESCE(NULLIF(u.name, ''), p.email) AS who, "
      + "'Partner profile · ' || COALESCE(NULLIF(p.legal_entity_name, ''), p.persona, 'unnamed') AS what, "
      + 'p.created_at AS created_at '
      + 'FROM partner_profiles p LEFT JOIN users u ON u.email = p.email '
      + 'WHERE ' + IS_WAITING_SQL + ' ORDER BY p.created_at ASC LIMIT ?',
    notifies: 'The partner, when an agreement is sent',
    decidedOn: 'Partner profiles',
  },
  {
    key: 'exploring',
    label: 'Exploring',
    // NO STATUS COLUMN: the queue is `role = 'exploring'` (admin_exploring.ts),
    // left when an admin assigns the final role. Its age is the route's own,
    // `COALESCE(onboarded_at, users.created_at)` — a subquery in the count so
    // the count still has no join.
    countSql:
      'SELECT COUNT(*) AS n, MIN(COALESCE((SELECT rr.onboarded_at FROM user_role_review rr '
      + "WHERE rr.user_id = u.id), u.created_at)) AS oldest FROM users u WHERE u.role = 'exploring'",
    rowsSql:
      "SELECT u.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || u.id) AS who, "
      + "'Exploring · ' || COALESCE(rr.suggested_role, 'no role suggested') AS what, "
      + 'COALESCE(rr.onboarded_at, u.created_at) AS created_at '
      + 'FROM users u LEFT JOIN user_role_review rr ON rr.user_id = u.id '
      + "WHERE u.role = 'exploring' ORDER BY COALESCE(rr.onboarded_at, u.created_at) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Exploring board',
  },
  {
    key: 'jobs',
    label: 'Jobs',
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM job_postings WHERE status = \'pending_review\'',
    rowsSql:
      "SELECT j.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || j.host_user_id, 'no host') AS who, "
      + "'Job · ' || j.title AS what, j.created_at AS created_at "
      + 'FROM job_postings j LEFT JOIN users u ON u.id = j.host_user_id '
      + "WHERE j.status = 'pending_review' ORDER BY j.created_at ASC LIMIT ?",
    notifies: 'The host',
    decidedOn: 'Jobs',
  },
  {
    key: 'events',
    label: 'Events',
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(COALESCE(submitted_at, created_at))) AS oldest FROM events WHERE status = \'pending_review\'',
    rowsSql:
      "SELECT e.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || e.host_user_id, 'no host') AS who, "
      + "'Event · ' || e.title AS what, COALESCE(e.submitted_at, e.created_at) AS created_at "
      + 'FROM events e LEFT JOIN users u ON u.id = e.host_user_id '
      + "WHERE e.status = 'pending_review' ORDER BY julianday(COALESCE(e.submitted_at, e.created_at)) ASC LIMIT ?",
    notifies: 'The host',
    decidedOn: 'Events › Review',
  },
  {
    key: 'best_fit',
    label: 'Best-Fit consultations',
    // The canvas says "Best-Fit"; the queue is the booking table the
    // consultations route decides (`admin_bestfit.ts` only fetches reports).
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM admin_consultation_bookings '
      + "WHERE status = 'requested'",
    rowsSql:
      "SELECT b.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || b.user_id) AS who, "
      + "'Best-Fit consultation · ' || COALESCE(NULLIF(b.topic, ''), 'no topic') AS what, "
      + 'b.created_at AS created_at '
      + 'FROM admin_consultation_bookings b LEFT JOIN users u ON u.id = b.user_id '
      + "WHERE b.status = 'requested' ORDER BY b.created_at ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Best-Fit',
  },
  {
    key: 'due_diligence',
    label: 'Due diligence',
    // `open` and `in_review` are both undecided (the CHECK's other two are
    // `completed` and `archived`). Nothing here is territory-specific: the
    // table has no territory column, and the branch's D1 is the territory.
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM dd_cases '
      + "WHERE status IN ('open', 'in_review')",
    rowsSql:
      "SELECT d.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || d.owner_user_id) AS who, "
      + "'Due diligence · ' || d.subject_label AS what, d.created_at AS created_at "
      + 'FROM dd_cases d LEFT JOIN users u ON u.id = d.owner_user_id '
      + "WHERE d.status IN ('open', 'in_review') ORDER BY d.created_at ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Due diligence',
  },
  // ── D1041 (#2889): the lanes D1038's canvas adds, each in its store's own words. ──
  {
    key: 'kyb',
    label: 'KYB',
    // A BUSINESS, NOT A PERSON (the KYC split). `company_kyb_records`
    // (migration 220) has no CHECK; its comment gives `users.kyc_status`'s
    // vocabulary, and the one writer (`POST /api/trust/companies/kyb`) stores
    // `in_review`. Both of the waiting words are counted, so neither writer's
    // choice drops a submission off the board.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(COALESCE(submitted_at, created_at))) AS oldest FROM company_kyb_records '
      + "WHERE status IN ('pending', 'in_review')",
    rowsSql:
      "SELECT k.id AS id, COALESCE(NULLIF(cp.company_name, ''), NULLIF(k.entity_name, ''), 'company ' || k.company_id) AS who, "
      + "'KYB · ' || COALESCE(NULLIF(k.entity_name, ''), 'entity not named') AS what, "
      + 'COALESCE(k.submitted_at, k.created_at) AS created_at '
      + 'FROM company_kyb_records k LEFT JOIN company_profiles cp ON cp.id = k.company_id '
      + "WHERE k.status IN ('pending', 'in_review') "
      + 'ORDER BY julianday(COALESCE(k.submitted_at, k.created_at)) ASC LIMIT ?',
    notifies: 'Nobody yet',
    decidedOn: null,
    undecidedReason: 'No admin route decides a business verification yet; the KYB record is written by the company and read by Trust.',
  },
  {
    key: 'comarketing',
    label: 'Co-marketing pitches',
    // `comarketing_pitches` (baseline): proposed → approved | rejected |
    // withdrawn; approved → published | withdrawn (`LEGAL_TRANSITIONS`).
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM comarketing_pitches WHERE status = \'proposed\'',
    rowsSql:
      "SELECT c.id AS id, COALESCE(NULLIF(pt.name, ''), NULLIF(u.name, ''), u.email, 'account ' || c.submitter_user_id) AS who, "
      + "'Co-marketing pitch · ' || c.title AS what, c.created_at AS created_at "
      + 'FROM comarketing_pitches c LEFT JOIN partners pt ON pt.id = c.partner_id '
      + 'LEFT JOIN users u ON u.id = c.submitter_user_id '
      + "WHERE c.status = 'proposed' ORDER BY julianday(c.created_at) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Co-marketing',
    // Only the publish transition stamps `published_at`, so this is every
    // approved pitch still waiting to go out.
    sub: {
      label: 'approved, not published yet',
      countSql: "SELECT COUNT(*) AS n FROM comarketing_pitches WHERE status = 'approved' AND published_at IS NULL",
    },
  },
  {
    key: 'wellbeing_experts',
    label: 'Wellbeing experts',
    // NO STATUS COLUMN: the directory's own bar (D1038 §2), which is "To
    // verify": active, unverified, not hidden, at least 70% complete
    // (`profile_completion_pct`, recomputed on every edit), and not a sample
    // (`seed_` uids, services/wellbeing/seedExperts.ts). There is no declined
    // state yet (part 5), so none is left out for it.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM experts '
      + 'WHERE is_active = 1 AND verified = 0 AND COALESCE(hidden_by_admin, 0) = 0 '
      + "AND COALESCE(profile_completion_pct, 0) >= 70 AND substr(uid, 1, 5) <> 'seed_'",
    rowsSql:
      "SELECT e.id AS id, COALESCE(NULLIF(e.name, ''), NULLIF(u.name, ''), u.email, 'expert ' || e.id) AS who, "
      + "'Wellbeing expert · ' || COALESCE(NULLIF(e.headline, ''), 'no headline') AS what, e.created_at AS created_at "
      + 'FROM experts e LEFT JOIN users u ON u.id = e.user_id '
      + 'WHERE e.is_active = 1 AND e.verified = 0 AND COALESCE(e.hidden_by_admin, 0) = 0 '
      + "AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_' "
      + 'ORDER BY julianday(e.created_at) ASC LIMIT ?',
    notifies: 'Nobody yet',
    decidedOn: 'Wellbeing',
  },
  {
    key: 'perk_listings',
    label: 'Perk listings',
    // `in_review` ONLY. A draft is the partner's own, still being written; the
    // Perks queue's own read counts it too, which part 1 (#2887) corrects. The
    // wait is from `updated_at`, which a submit stamps (the queue sorts by it).
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(COALESCE(updated_at, created_at))) AS oldest FROM perks '
      + "WHERE status = 'in_review'",
    rowsSql:
      "SELECT pk.id AS id, COALESCE(NULLIF(pk.partner_name, ''), NULLIF(u.name, ''), u.email, 'account ' || pk.partner_user_id, 'no partner') AS who, "
      + "'Perk · ' || pk.offer AS what, COALESCE(pk.updated_at, pk.created_at) AS created_at "
      + 'FROM perks pk LEFT JOIN users u ON u.id = pk.partner_user_id '
      + "WHERE pk.status = 'in_review' ORDER BY julianday(COALESCE(pk.updated_at, pk.created_at)) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Perks',
  },
  {
    key: 'strategic_access',
    label: 'Strategic referral access',
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM referral_strategic_access WHERE status = \'requested\'',
    rowsSql:
      "SELECT r.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || r.user_id) AS who, "
      + "'Strategic referral access' AS what, r.created_at AS created_at "
      + 'FROM referral_strategic_access r LEFT JOIN users u ON u.id = r.user_id '
      + "WHERE r.status = 'requested' ORDER BY julianday(r.created_at) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Refer & Earn',
  },
  {
    key: 'lab_hosts',
    label: 'Office-hours hosts',
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM lab_host_applications WHERE status = \'pending\'',
    rowsSql:
      "SELECT h.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || h.user_id) AS who, "
      + "'Office-hours host · ' || h.host_kind AS what, h.created_at AS created_at "
      + 'FROM lab_host_applications h LEFT JOIN users u ON u.id = h.user_id '
      + "WHERE h.status = 'pending' ORDER BY julianday(h.created_at) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Spin-Out Lab › Hosts',
  },
  {
    key: 'score_flags',
    label: 'Score sign-off',
    // A flagged official score stays hidden from LPs until an admin signs it
    // off. Sandbox runs are a founder's own practice and never reach an LP.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM score_snapshots '
      + "WHERE admin_review_status = 'flagged' AND COALESCE(is_sandbox, 0) = 0",
    rowsSql:
      "SELECT s.id AS id, COALESCE(NULLIF(p.name, ''), 'project ' || s.project_id) AS who, "
      + "'Score sign-off · ' || COALESCE(s.tier, 'no tier') AS what, s.created_at AS created_at "
      + 'FROM score_snapshots s LEFT JOIN projects p ON p.id = s.project_id '
      + "WHERE s.admin_review_status = 'flagged' AND COALESCE(s.is_sandbox, 0) = 0 "
      + 'ORDER BY julianday(s.created_at) ASC LIMIT ?',
    notifies: 'Nobody yet',
    decidedOn: 'Monitoring',
  },
  {
    key: 'articles',
    label: 'Articles',
    // Waiting on a reviewer: submitted, or picked up and in review. Changes
    // requested is back with the author; approved waits only on a publish.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(COALESCE(submitted_at, created_at))) AS oldest FROM articles '
      + "WHERE status IN ('submitted', 'in_review')",
    rowsSql:
      "SELECT a.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || a.author_user_id) AS who, "
      + "'Article · ' || a.title AS what, COALESCE(a.submitted_at, a.created_at) AS created_at "
      + 'FROM articles a LEFT JOIN users u ON u.id = a.author_user_id '
      + "WHERE a.status IN ('submitted', 'in_review') "
      + 'ORDER BY julianday(COALESCE(a.submitted_at, a.created_at)) ASC LIMIT ?',
    notifies: 'The author',
    decidedOn: 'Content queue',
  },
] as const;

/**
 * D1041 — the canvas's lanes with no store to count yet, said rather than
 * laned. A source over a table that does not exist would read "could not be
 * read" on every database, and make every branch's backlog total null.
 */
export const NOT_COUNTED_YET: ReadonlyArray<{ key: string; label: string; reason: string }> = [
  { key: 'product_testers', label: 'Product testers', reason: 'No product tester application is stored yet; part 4 (#2890) adds the store.' },
];

/**
 * D1041 — sub-counts the issue names that no store can answer yet.
 * `due_diligence`'s "ready for sign-off" has no state on `dd_cases`, and a rule
 * derived here (every section completed, say) would be one #2385 has not made.
 */
export const SUB_COUNTS_NOT_YET: ReadonlyArray<{ lane: ApprovalLaneKey; label: string; reason: string }> = [
  { lane: 'due_diligence', label: 'ready for sign-off', reason: 'No case records being ready for sign-off yet; #2385 defines it.' },
];

/**
 * The canvas's four other S16 lanes, which are NOT laned, and why (D215).
 *
 * Each has a D1 table, but none has a state meaning "an admin owes a
 * decision". Laning one would need a predicate invented here, which would put
 * work on the board that nobody handed the admin — the `'draft'` referral
 * argument above, four times over. The route sends this list so the page can
 * say what it leaves out instead of implying the board is everything.
 */
export const NOT_LANED: ReadonlyArray<{ label: string; reason: string }> = [
  { label: 'Directory', reason: 'A partner is listed or not (`directory_listed`); nothing is submitted for a listing decision.' },
  { label: 'Circles', reason: 'Admins create circles and publish them; nobody submits one for review.' },
  { label: 'Partner invitations', reason: 'An open invitation waits on the invitee, not an admin.' },
  { label: 'Advisor cohort access', reason: 'Access is assigned by an admin; an advisor has no way to request it, so there is no request to wait on.' },
];

/**
 * The referral statuses the literals above spell out, exported so the test can
 * hold them to `PRE_VERDICT_STATUSES` rather than restating the pairing twice.
 */
export const REFERRAL_OPEN_STATUSES = REFERRAL_OPEN;

/** One row on the board, whichever lane it came from. */
export type ApprovalItem = {
  lane: ApprovalLaneKey;
  lane_label: string;
  id: number;
  who: string;
  what: string;
  created_at: string;
  /** Hours since `created_at`, or null when the stamp will not parse. */
  age_hours: number | null;
  /** The canvas's three bands, derived from `age_hours` — never stored. */
  sla: 'ok' | 'due_soon' | 'past' | 'unknown';
};

/**
 * The canvas's bands: under 24h, under 72h, at or past 72h.
 *
 * DERIVED ON READ, LIKE `slaBand` IN `rpc/hqOps.ts` (D108). A stored band is a
 * band that is wrong the moment the clock moves past it, and this is the second
 * place in the programme to make that call the same way.
 */
// The window is `slaWindow.ts`'s, the one HQ's tickets and escalations use (D459).
export { SLA_DUE_SOON_HOURS };
export const SLA_PAST_HOURS = 72;

export function slaFor(ageHours: number | null): ApprovalItem['sla'] {
  if (ageHours === null) return 'unknown';
  if (ageHours >= SLA_PAST_HOURS) return 'past';
  if (ageHours >= SLA_DUE_SOON_HOURS) return 'due_soon';
  return 'ok';
}

/**
 * Hours between a SQLite stamp and now.
 *
 * `created_at` IS SQL FORMAT ON EVERY ONE OF THE FOUR — `datetime('now')`,
 * which is `YYYY-MM-DD HH:MM:SS` with no zone. `Date.parse` reads that as
 * LOCAL time, which on a Worker is UTC and on a developer's laptop is not, so
 * the `Z` is appended rather than assumed. That is the same ISO-vs-SQL trap
 * D122 and D125 each spent a PR on; here it would show every row as hours
 * younger or older than it is, which a board ordered by age cannot survive.
 *
 * `referral_submissions.created_at` is declared `TIMESTAMP DEFAULT
 * CURRENT_TIMESTAMP`, which SQLite also renders in that same format — checked
 * rather than assumed, because a second format here would sort one lane wrong.
 */
export function ageHours(createdAt: unknown, nowMs: number): number | null {
  const raw = String(createdAt ?? '').trim();
  if (!raw) return null;
  const iso = /[TZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (nowMs - ms) / 3_600_000);
}

export type ApprovalBoard = {
  items: ApprovalItem[];
  /** Per lane, so a lane that answered 0 is distinguishable from one that failed. */
  lanes: Array<{ key: ApprovalLaneKey; label: string; count: number | null }>;
  unreadable: string[];
  /** Present only when at least one lane could not be read. */
  reason?: string;
};

/**
 * Every open item across the local queues, newest-waiting last.
 *
 * ONE LANE FAILING DOES NOT POISON THE OTHERS, and it does not silently
 * shrink the board either. `backlogOf` returns `null` for the whole count
 * because a sum missing a term is a smaller number presented as the total; a
 * BOARD is different — the rows that could be read are real work somebody
 * should see — so the lane keeps a `null` count, the reason names it, and the
 * page says which lane it cannot vouch for. That is the `services/branches.ts`
 * fan-out rule applied one level down: per-source isolation with the gap
 * stated rather than averaged away.
 *
 * `limit` bounds each lane, not the board, so a flooded queue cannot crowd the
 * others off a screen whose whole purpose is "what is oldest anywhere".
 */
export async function approvalBoard(
  env: Env,
  limit = 100,
  now = Date.now(),
  sources: readonly ApprovalSource[] = APPROVAL_SOURCES,
): Promise<ApprovalBoard> {
  const items: ApprovalItem[] = [];
  const lanes: ApprovalBoard['lanes'] = [];
  const unreadable: string[] = [];

  for (const src of sources) {
    try {
      const rows = await env.DB.prepare(src.rowsSql)
        .bind(Math.max(1, Math.trunc(Number(limit) || 100)))
        .all<{ id: number; who: string; what: string; created_at: string }>();
      const got = rows.results || [];
      for (const r of got) {
        const age = ageHours(r.created_at, now);
        items.push({
          lane: src.key,
          lane_label: src.label,
          id: Number(r.id),
          who: String(r.who ?? ''),
          what: String(r.what ?? ''),
          created_at: String(r.created_at ?? ''),
          age_hours: age === null ? null : Math.round(age * 10) / 10,
          sla: slaFor(age),
        });
      }
      lanes.push({ key: src.key, label: src.label, count: got.length });
    } catch {
      lanes.push({ key: src.key, label: src.label, count: null });
      unreadable.push(src.label);
    }
  }

  // OLDEST FIRST, WHICH IS THE BOARD'S ONE CLAIM. S3's own words: an admin's
  // question "is never 'what is in the LP queue' — it is 'what is oldest and
  // who is waiting'". A row whose stamp would not parse sorts last rather than
  // first, because an unknown age must not be presented as the most urgent
  // thing on the screen.
  items.sort((a, b) => {
    if (a.age_hours === null) return b.age_hours === null ? 0 : 1;
    if (b.age_hours === null) return -1;
    return b.age_hours - a.age_hours;
  });

  return {
    items,
    lanes,
    unreadable,
    ...(unreadable.length
      ? {
        reason:
          `${unreadable.join(', ')} could not be read on this branch, so the board is missing whatever `
          + 'is in them. The lanes that answered are complete; the ones that did not show no count '
          + 'rather than a zero.',
      }
      : {}),
  };
}

/**
 * D1040 (#2888): the lanes a reader on HQ's inbox sees. A lane marked
 * `scope: 'hq'` is a Super Admin's; every other lane is every admin's. The
 * branch board does not filter: it reads `APPROVAL_SOURCES` whole, as before.
 */
export function sourcesFor(superAdmin: boolean, sources: readonly ApprovalSource[] = APPROVAL_SOURCES): readonly ApprovalSource[] {
  return superAdmin ? sources : sources.filter((s) => s.scope !== 'hq');
}

/** One lane's true open count and the age of its oldest item. */
export type LaneCount = {
  key: ApprovalLaneKey;
  label: string;
  /**
   * `null` means the lane could not be READ. It never means zero — a measured
   * zero is `0`, and collapsing the two is how "nothing is waiting" comes to be
   * printed over a queue nobody could open.
   */
  count: number | null;
  /** The SQL stamp of the oldest open item, or null when the lane is empty. */
  oldest_at: string | null;
  /** D1041 — who a decision tells, and the page that decides it (null when none does). */
  notifies: string;
  decided_on: string | null;
  undecided_reason?: string;
  /** D1041 — the lane's sub-count; `count: null` when it alone could not be read. */
  sub?: { label: string; count: number | null };
};

/** D1041 — the fields every lane reports beside its count. */
function laneMeta(s: ApprovalSource) {
  return {
    notifies: s.notifies,
    decided_on: s.decidedOn,
    ...(s.undecidedReason ? { undecided_reason: s.undecidedReason } : {}),
  };
}

/** A lane's sub-count, read alone: a failure is its own null, never the lane's. */
async function subCount(env: Env, s: ApprovalSource): Promise<LaneCount['sub']> {
  if (!s.sub) return undefined;
  try {
    const row = await env.DB.prepare(s.sub.countSql).first<{ n: number }>();
    return { label: s.sub.label, count: Number(row?.n) || 0 };
  } catch {
    return { label: s.sub.label, count: null };
  }
}

/**
 * Each lane's count and oldest item, from `countSql` — the SAME query
 * `backlogOf` sums and the query the board's `limit` does NOT bound.
 *
 * WHY THIS IS NOT `approvalBoard().lanes`, WHICH LOOKS LIKE IT WOULD DO. That
 * field counts the rows a lane RETURNED, so it is `min(open, limit)` — correct
 * for "how many of these did you get", wrong for "how much is waiting". S1's
 * queue-pressure block asks the second question, and reading the first would
 * have shown a flooded lane as exactly the cap, every time, looking like a
 * measurement.
 *
 * AND IT IS WHY `backlogOf` NOW SUMS THIS rather than running the queries
 * again. The total is the sum of the parts BY CONSTRUCTION, so the tile on S1
 * and the number on H1 cannot disagree the way D129's seat tiles could not
 * disagree with their total: one read, two shapes. A second reader that asked
 * the same question its own way is the exact drift D130 consolidated.
 *
 * PER-LANE ISOLATION, as everywhere in this file: one lane throwing leaves the
 * others measured and marks itself unread. The CALLER decides what that means
 * — the board keeps its rows, the backlog count refuses to be a total.
 */
export async function laneCounts(env: Env, sources: readonly ApprovalSource[] = APPROVAL_SOURCES): Promise<LaneCount[]> {
  return countLanes(env, sources);
}

/**
 * The count read over any list of sources: this file's lanes, or HQ's
 * (`hqApprovalSources.ts`, D1041). Per-lane isolation as above.
 */
export async function countLanes<K extends string>(
  env: Env, sources: readonly (Omit<ApprovalSource, 'key'> & { key: K })[],
): Promise<(Omit<LaneCount, 'key'> & { key: K })[]> {
  const out: (Omit<LaneCount, 'key'> & { key: K })[] = [];
  for (const s of sources) {
    const meta = laneMeta(s as ApprovalSource);
    try {
      const row = await env.DB.prepare(s.countSql).first<{ n: number; oldest: string | null }>();
      const sub = await subCount(env, s as ApprovalSource);
      out.push({
        key: s.key,
        label: s.label,
        count: Number(row?.n) || 0,
        oldest_at: row?.oldest ?? null,
        ...meta,
        ...(sub ? { sub } : {}),
      });
    } catch {
      out.push({ key: s.key, label: s.label, count: null, oldest_at: null, ...meta });
    }
  }
  return out;
}
