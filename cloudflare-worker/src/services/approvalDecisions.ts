/**
 * D1044 (#2892, part 6 of #2390) — the decision log: every lane's decided
 * rows, read from that lane's own store, and the weekly arrived-and-decided
 * series with the "Decided this week" tile.
 *
 * NO LANE WRITES ITS DECISIONS TO ONE PLACE, and this part adds no table.
 * Each lane below reads the columns its own decide route writes (or its own
 * append-only event table, where the main row keeps no decision time). The
 * columns, the statuses and every trap are D1044 §2's table, read off the
 * decide routes, not off the canvas.
 *
 * A LANE THAT DOES NOT RECORD ITS DECISIONS SAYS SO. It answers
 * `{ recorded: false, since: null, reason }`, never an empty list and never a
 * zero: a store that keeps no decision time cannot say how many it decided.
 * A lane that started recording later carries `since`, the day its decision
 * column landed; the page draws "decisions were not recorded before [date]".
 *
 * EVERY QUERY IS LITERAL. Each lane's `sql` is one constant; the filter and
 * the count wrap it by concatenating other constants, so nothing a caller
 * sends reaches the query text (`check-sql-prepare`). Every lane's SELECT
 * gives the same columns, so one wrapper reads them all:
 *
 *   item_id, who, outcome ('approved' | 'declined' | 'other'), outcome_word,
 *   decided_at, decided_by_id, decided_by_label, arrived_at, note, note_shown
 *
 * `decided_at` and `arrived_at` pass through `datetime()`, so an ISO stamp
 * and a SQLite stamp compare and sort as one (D1041 §1).
 *
 * ONE FAILED LANE IS ITS OWN. Each lane is read in its own `try`; a failed
 * lane is named in `unreadable` and leaves the others standing, and the total
 * it would have changed is null rather than short.
 *
 * HQ'S LANES ARE A SUPER ADMIN'S (D1040's `scope: 'hq'`): `decisionLanesFor`
 * keeps them only when the caller holds the elevation.
 */
import type { Env } from '../types';
import { APPROVAL_SOURCES, approvalBoard, type ApprovalSource } from './approvalSources';
import { HQ_APPROVAL_SOURCES } from './hqApprovalSources';
import { medianOfHours, sqlStamp, utcMs } from './approvalAge';

export type Outcome = 'approved' | 'declined' | 'other';
export const OUTCOMES: readonly Outcome[] = ['approved', 'declined', 'other'];

type Recorded = {
  key: string;
  recorded: true;
  /** The day this lane's decision column landed, when the store is older than it; null when it records from the start. */
  since: string | null;
  /** What the log cannot show for this lane, in a sentence the page prints. */
  caveat?: string;
  /** False when the store keeps no arrival time once a row is decided, so the weekly arrivals leave the lane out. */
  arrivals?: false;
  /** For a lane outside the inbox's board: its waiting rows' arrival times, `?` the window's start. */
  waitingSql?: string;
  scope?: 'hq';
  sql: string;
};
type Unrecorded = { key: string; recorded: false; since: null; reason: string; scope?: 'hq' };
export type DecisionLane = (Recorded | Unrecorded) & { label?: string };

const WHO = (alias: string, idCol: string) =>
  "COALESCE(NULLIF(" + alias + ".name, ''), " + alias + ".email, 'account ' || " + idCol + ')';

/**
 * The verdict statuses of a referral, as `VERDICT_STATUSES` derives them
 * (`referralSubmissions.ts`); `approval_decisions_d1044.test.ts` holds the two
 * lists equal, so a status added there cannot be missed here.
 */
export const REFERRAL_VERDICTS_SQL =
  "('qualified', 'in_conversation', 'converted', 'reward_eligible', 'reward_issued', 'rejected', 'closed')";

/** Every lane, in the canvas's order: every studio's lanes, Product testers, then HQ's. */
export const DECISION_LANES: readonly DecisionLane[] = [
  {
    key: 'lp', recorded: true, since: null,
    caveat: 'An LP application keeps the time of its last review, so a note saved after the decision moves the time.',
    sql:
      'SELECT a.id AS item_id, ' + WHO('u', 'a.user_id') + ' AS who, '
      + "CASE a.status WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE a.status WHEN 'approved' THEN 'Approved' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(a.reviewed_at) AS decided_at, a.reviewed_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(a.created_at) AS arrived_at, NULLIF(a.review_note, '') AS note, 1 AS note_shown "
      + 'FROM lp_applications a LEFT JOIN users u ON u.id = a.user_id '
      + "WHERE a.status IN ('approved', 'declined')",
  },
  {
    // A referral's decision is its EARLIEST verdict event (D210's `verdictSpans`):
    // it can move on to converted and rewarded, and those are not new decisions.
    key: 'referrals', recorded: true, since: null,
    sql:
      'SELECT s.id AS item_id, ' + WHO('u', 's.referrer_user_id') + ' AS who, '
      + "CASE WHEN e.status IN ('rejected', 'closed') THEN 'declined' ELSE 'approved' END AS outcome, "
      + "CASE e.status WHEN 'rejected' THEN 'Declined' WHEN 'closed' THEN 'Closed' ELSE 'Approved' END AS outcome_word, "
      + 'datetime(e.created_at) AS decided_at, e.actor_user_id AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(s.created_at) AS arrived_at, NULLIF(e.note, '') AS note, 1 AS note_shown "
      + 'FROM referral_submission_events e JOIN referral_submissions s ON s.id = e.submission_id '
      + 'LEFT JOIN users u ON u.id = s.referrer_user_id '
      + 'WHERE e.id = (SELECT MIN(e2.id) FROM referral_submission_events e2 '
      + 'WHERE e2.submission_id = e.submission_id AND e2.status IN ' + REFERRAL_VERDICTS_SQL + ')',
  },
  {
    // `decided_by` is text: 'admin:<id>', or 'system' for the scheduler.
    key: 'cohort', recorded: true, since: null,
    caveat: 'A cohort decision made again replaces the earlier one, and an activated applicant keeps only its activation, so it is not listed.',
    sql:
      'SELECT ca.id AS item_id, ' + WHO('u', 'ca.user_id') + ' AS who, '
      + "CASE ca.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'declined' ELSE 'other' END AS outcome, "
      + "CASE ca.status WHEN 'approved' THEN 'Approved' WHEN 'rejected' THEN 'Declined' ELSE 'Waitlisted' END AS outcome_word, "
      + "datetime(ca.decided_at) AS decided_at, CASE WHEN ca.decided_by LIKE 'admin:%' THEN CAST(substr(ca.decided_by, 7) AS INTEGER) END AS decided_by_id, "
      + "CASE WHEN ca.decided_by = 'system' THEN 'The scheduler' END AS decided_by_label, "
      + "datetime(ca.created_at) AS arrived_at, NULLIF(ca.decision_reason, '') AS note, 0 AS note_shown "
      + 'FROM cohort_applicants ca LEFT JOIN users u ON u.id = ca.user_id '
      + "WHERE ca.status IN ('approved', 'rejected', 'waitlisted')",
  },
  {
    // A decided case keeps status 'under_review' with `resolved_at` set; what the
    // admin did is the case the same admin opened for the member straight after
    // (within a minute). None is a close.
    key: 'moderation', recorded: true, since: null,
    sql:
      'SELECT m.id AS item_id, ' + WHO('u', 'm.user_id') + ' AS who, '
      + "CASE n.status WHEN 'active' THEN 'approved' WHEN 'suspended' THEN 'declined' WHEN 'ejected' THEN 'declined' ELSE 'other' END AS outcome, "
      + "CASE n.status WHEN 'active' THEN 'Reinstated' WHEN 'suspended' THEN 'Suspended' WHEN 'ejected' THEN 'Ejected' "
      + "WHEN 'under_review' THEN 'Flagged again' ELSE 'Closed' END AS outcome_word, "
      + 'datetime(m.resolved_at) AS decided_at, m.resolved_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(m.created_at) AS arrived_at, NULLIF(n.summary, '') AS note, 0 AS note_shown "
      + 'FROM spinout_moderation_cases m LEFT JOIN users u ON u.id = m.user_id '
      + 'LEFT JOIN spinout_moderation_cases n ON n.id = (SELECT MIN(x.id) FROM spinout_moderation_cases x '
      + 'WHERE x.user_id = m.user_id AND x.id > m.id AND x.opened_by = m.resolved_by '
      + 'AND (julianday(x.opened_at) - julianday(m.resolved_at)) * 86400 BETWEEN 0 AND 60) '
      + "WHERE m.status = 'under_review' AND m.resolved_at IS NOT NULL",
  },
  {
    // One row per member: a resubmission leaves the last review's stamp, so a row
    // is decided only when its review is at or after its submission.
    key: 'kyc', recorded: true, since: null,
    sql:
      'SELECT u.id AS item_id, ' + WHO('u', 'u.id') + ' AS who, '
      + "CASE u.kyc_status WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE u.kyc_status WHEN 'approved' THEN 'Approved' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(u.kyc_reviewed_at) AS decided_at, u.kyc_reviewed_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(u.kyc_submitted_at) AS arrived_at, NULLIF(u.kyc_rejection_reason, '') AS note, 1 AS note_shown "
      + "FROM users u WHERE u.kyc_status IN ('approved', 'rejected') AND u.kyc_reviewed_at IS NOT NULL "
      + 'AND (u.kyc_submitted_at IS NULL OR julianday(u.kyc_reviewed_at) >= julianday(u.kyc_submitted_at))',
  },
  {
    key: 'partner_profiles', recorded: true, since: '2026-10-25',
    sql:
      "SELECT p.rowid AS item_id, COALESCE(NULLIF(u.name, ''), p.email) AS who, "
      + "CASE p.admin_status WHEN 'verified' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE p.admin_status WHEN 'verified' THEN 'Verified' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(p.reviewed_at) AS decided_at, p.reviewed_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(p.created_at) AS arrived_at, CASE WHEN p.admin_status = 'rejected' THEN NULLIF(p.reject_reason, '') END AS note, 1 AS note_shown "
      + 'FROM partner_profiles p LEFT JOIN users u ON u.email = p.email '
      + "WHERE p.admin_status IN ('verified', 'rejected') AND p.reviewed_at IS NOT NULL",
  },
  {
    // Giving the role is the only decision; nothing declines an Explorer.
    key: 'exploring', recorded: true, since: null,
    sql:
      'SELECT u.id AS item_id, ' + WHO('u', 'u.id') + ' AS who, '
      + "'approved' AS outcome, 'Role given · ' || COALESCE(rr.assigned_role, 'role not recorded') AS outcome_word, "
      + 'datetime(rr.assigned_at) AS decided_at, rr.assigned_by_user_id AS decided_by_id, NULL AS decided_by_label, '
      + 'datetime(COALESCE(rr.onboarded_at, u.created_at)) AS arrived_at, NULL AS note, 0 AS note_shown '
      + 'FROM user_role_review rr JOIN users u ON u.id = rr.user_id '
      + 'WHERE rr.role_confirmed = 1 AND rr.assigned_at IS NOT NULL',
  },
  {
    key: 'jobs', recorded: false, since: null,
    reason: 'A job posting keeps no decision time and no decider; an approval or rejection is only in the admin audit log.',
  },
  {
    // `approved_at` is migration 546's; a rejection writes no time.
    key: 'events', recorded: true, since: '2026-10-24',
    caveat: 'Events records when it approved, not who approved, and a sent-back event keeps no time, so only approvals are listed.',
    sql:
      'SELECT e.id AS item_id, ' + "COALESCE(NULLIF(u.name, ''), u.email, 'account ' || e.host_user_id, 'no host') AS who, "
      + "'approved' AS outcome, 'Approved' AS outcome_word, "
      + 'datetime(e.approved_at) AS decided_at, NULL AS decided_by_id, NULL AS decided_by_label, '
      + 'datetime(COALESCE(e.submitted_at, e.created_at)) AS arrived_at, NULL AS note, 1 AS note_shown '
      + 'FROM events e LEFT JOIN users u ON u.id = e.host_user_id WHERE e.approved_at IS NOT NULL',
  },
  {
    key: 'best_fit', recorded: false, since: null,
    reason: 'A Best-Fit booking keeps no time for its confirmation or cancellation, and nothing else records it.',
  },
  {
    key: 'due_diligence', recorded: false, since: null,
    reason: 'Nothing decides a due-diligence case yet: no route completes or archives one.',
  },
  {
    key: 'kyb', recorded: false, since: null,
    reason: 'No admin route decides a business verification yet, so no KYB decision is recorded.',
  },
  {
    // Publishing rewrites `reviewed_at`, so a published pitch has lost its approval time.
    key: 'comarketing', recorded: true, since: null,
    caveat: 'Publishing a pitch replaces its approval time, so published pitches are not listed.',
    sql:
      "SELECT c.id AS item_id, COALESCE(NULLIF(pt.name, ''), NULLIF(u.name, ''), u.email, 'account ' || c.submitter_user_id) AS who, "
      + "CASE c.status WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE c.status WHEN 'approved' THEN 'Approved' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(c.reviewed_at) AS decided_at, c.reviewed_by_user_id AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(c.created_at) AS arrived_at, NULLIF(c.review_notes, '') AS note, 1 AS note_shown "
      + 'FROM comarketing_pitches c LEFT JOIN partners pt ON pt.id = c.partner_id '
      + 'LEFT JOIN users u ON u.id = c.submitter_user_id '
      + "WHERE c.status IN ('approved', 'rejected') AND c.reviewed_at IS NOT NULL",
  },
  {
    key: 'wellbeing_experts', recorded: false, since: null,
    reason: 'Verifying an expert sets a flag with no time or decider; only the admin audit log records it.',
  },
  {
    // A perk's `updated_at` moves with its review, so its arrival is not kept once decided.
    key: 'perk_listings', recorded: true, since: null, arrivals: false,
    caveat: 'A perk listing keeps no submission time once it is reviewed, so its wait is not recorded.',
    sql:
      "SELECT pk.id AS item_id, COALESCE(NULLIF(pk.partner_name, ''), NULLIF(u.name, ''), u.email, 'account ' || pk.partner_user_id, 'no partner') AS who, "
      + "CASE pk.status WHEN 'live' THEN 'approved' WHEN 'rejected' THEN 'declined' ELSE 'other' END AS outcome, "
      + "CASE pk.status WHEN 'live' THEN 'Approved' WHEN 'rejected' THEN 'Declined' ELSE 'Paused' END AS outcome_word, "
      + 'datetime(pk.reviewed_at) AS decided_at, pk.reviewed_by_user_id AS decided_by_id, NULL AS decided_by_label, '
      + "NULL AS arrived_at, NULLIF(pk.review_note, '') AS note, 1 AS note_shown "
      + 'FROM perks pk LEFT JOIN users u ON u.id = pk.partner_user_id '
      + "WHERE pk.status IN ('live', 'rejected', 'paused') AND pk.reviewed_at IS NOT NULL",
  },
  {
    key: 'strategic_access', recorded: true, since: null,
    caveat: 'Strategic access records when it was decided, not who decided it.',
    sql:
      'SELECT r.id AS item_id, ' + WHO('u', 'r.user_id') + ' AS who, '
      + "CASE r.status WHEN 'granted' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE r.status WHEN 'granted' THEN 'Granted' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(r.decided_at) AS decided_at, NULL AS decided_by_id, NULL AS decided_by_label, '
      + 'datetime(r.created_at) AS arrived_at, NULL AS note, 0 AS note_shown '
      + 'FROM referral_strategic_access r LEFT JOIN users u ON u.id = r.user_id '
      + "WHERE r.status IN ('granted', 'declined') AND r.decided_at IS NOT NULL",
  },
  {
    key: 'lab_hosts', recorded: true, since: null,
    caveat: 'Revoking a host replaces its approval, so a revoked host shows only the revocation.',
    sql:
      'SELECT h.id AS item_id, ' + WHO('u', 'h.user_id') + ' AS who, '
      + "CASE h.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'declined' ELSE 'other' END AS outcome, "
      + "CASE h.status WHEN 'approved' THEN 'Approved' WHEN 'rejected' THEN 'Declined' ELSE 'Revoked' END AS outcome_word, "
      + 'datetime(h.reviewed_at) AS decided_at, h.reviewed_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(h.created_at) AS arrived_at, NULLIF(h.review_note, '') AS note, 1 AS note_shown "
      + 'FROM lab_host_applications h LEFT JOIN users u ON u.id = h.user_id '
      + "WHERE h.status IN ('approved', 'rejected', 'revoked') AND h.reviewed_at IS NOT NULL",
  },
  {
    key: 'score_flags', recorded: true, since: null,
    sql:
      "SELECT s.id AS item_id, COALESCE(NULLIF(p.name, ''), 'project ' || s.project_id) AS who, "
      + "CASE s.admin_review_status WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE s.admin_review_status WHEN 'approved' THEN 'Signed off' ELSE 'Rejected' END AS outcome_word, "
      + 'datetime(s.admin_reviewed_at) AS decided_at, s.admin_reviewed_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(s.created_at) AS arrived_at, NULLIF(s.admin_review_notes, '') AS note, 0 AS note_shown "
      + 'FROM score_snapshots s LEFT JOIN projects p ON p.id = s.project_id '
      + "WHERE s.admin_review_status IN ('approved', 'rejected') AND s.admin_reviewed_at IS NOT NULL "
      + 'AND COALESCE(s.is_sandbox, 0) = 0',
  },
  {
    // Approve and reject each keep their own time; a change request is the
    // revision the reviewer saved with reason 'request_changes'.
    key: 'articles', recorded: true, since: null,
    sql:
      'SELECT a.id AS item_id, ' + WHO('u', 'a.author_user_id') + " AS who, 'approved' AS outcome, 'Approved' AS outcome_word, "
      + 'datetime(a.approved_at) AS decided_at, a.reviewer_user_id AS decided_by_id, NULL AS decided_by_label, '
      + 'datetime(COALESCE(a.submitted_at, a.created_at)) AS arrived_at, NULL AS note, 1 AS note_shown '
      + 'FROM articles a LEFT JOIN users u ON u.id = a.author_user_id WHERE a.approved_at IS NOT NULL '
      + 'UNION ALL '
      + 'SELECT a.id, ' + WHO('u', 'a.author_user_id') + ", 'declined', 'Declined', "
      + 'datetime(a.rejected_at), a.reviewer_user_id, NULL, '
      + "datetime(COALESCE(a.submitted_at, a.created_at)), NULLIF(a.rejection_reason, ''), 1 "
      + 'FROM articles a LEFT JOIN users u ON u.id = a.author_user_id WHERE a.rejected_at IS NOT NULL '
      + 'UNION ALL '
      + 'SELECT a.id, ' + WHO('u', 'a.author_user_id') + ", 'declined', 'Sent back', "
      + 'datetime(r.created_at), r.saved_by, NULL, datetime(COALESCE(a.submitted_at, a.created_at)), NULL, 1 '
      + 'FROM article_revisions r JOIN articles a ON a.id = r.article_id '
      + "LEFT JOIN users u ON u.id = a.author_user_id WHERE r.reason = 'request_changes'",
  },
  {
    // Migration 576's own log; its approve and decline are the decisions.
    key: 'product_testers', recorded: true, since: null,
    waitingSql: "SELECT datetime(applied_at) AS arrived_at FROM product_testers WHERE status = 'applied' AND datetime(applied_at) >= ?",
    sql:
      'SELECT ev.tester_id AS item_id, ' + WHO('u', 'ev.user_id') + ' AS who, '
      + "CASE ev.action WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE ev.action WHEN 'approved' THEN 'Approved' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(ev.created_at) AS decided_at, ev.actor_user_id AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(pt.applied_at) AS arrived_at, NULLIF(ev.reason, '') AS note, 1 AS note_shown "
      + 'FROM product_tester_events ev JOIN product_testers pt ON pt.id = ev.tester_id '
      + "LEFT JOIN users u ON u.id = ev.user_id WHERE ev.action IN ('approved', 'declined')",
  },
  // HQ's lanes (D1041 §4).
  {
    // An edit returns a sent-back programme to draft, so the decision is its event.
    key: 'testing_programs', scope: 'hq', recorded: true, since: null,
    sql:
      "SELECT t.id AS item_id, COALESCE(NULLIF(pt.name, ''), NULLIF(u.name, ''), u.email, 'account ' || t.created_by) AS who, "
      + "CASE ev.action WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE ev.action WHEN 'approved' THEN 'Approved' ELSE 'Sent back' END AS outcome_word, "
      + 'datetime(ev.created_at) AS decided_at, ev.actor_user_id AS decided_by_id, NULL AS decided_by_label, '
      + '(SELECT datetime(MAX(s.created_at)) FROM testing_events s WHERE s.programme_id = ev.programme_id '
      + "AND s.application_id IS NULL AND s.action = 'submitted' AND s.id < ev.id) AS arrived_at, "
      + "json_extract(ev.detail, '$.note') AS note, 1 AS note_shown "
      + 'FROM testing_events ev JOIN testing_programmes t ON t.id = ev.programme_id '
      + 'LEFT JOIN partners pt ON pt.id = t.owner_partner_id LEFT JOIN users u ON u.id = t.created_by '
      + "WHERE ev.application_id IS NULL AND ev.action IN ('approved', 'rejected') AND t.owner_kind = 'partner'",
  },
  {
    key: 'learning', scope: 'hq', recorded: true, since: null,
    sql:
      'SELECT s.id AS item_id, ' + WHO('u', 's.user_id') + ' AS who, '
      + "CASE s.status WHEN 'accepted' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE s.status WHEN 'accepted' THEN 'Accepted' ELSE 'Needs work' END AS outcome_word, "
      + 'datetime(s.reviewed_at) AS decided_at, s.reviewer_id AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(s.submitted_at) AS arrived_at, NULLIF(s.feedback, '') AS note, 1 AS note_shown "
      + 'FROM learning_exercise_submissions s LEFT JOIN users u ON u.id = s.user_id '
      + "WHERE s.status IN ('accepted', 'needs_work') AND s.reviewed_at IS NOT NULL",
  },
  {
    // Item ids are the ticket's, as the inbox lane's are.
    key: 'tickets', scope: 'hq', recorded: true, since: null,
    sql:
      "SELECT t.id AS item_id, COALESCE(NULLIF(u.name, ''), u.email, NULLIF(t.submitted_by, ''), 'account ' || t.user_id) AS who, "
      + "CASE f.status WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE f.status WHEN 'approved' THEN 'Approved' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(f.decided_at) AS decided_at, f.decided_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(t.created_at) AS arrived_at, NULLIF(f.decline_reason, '') AS note, 1 AS note_shown "
      + 'FROM feature_request_reviews f JOIN tickets t ON t.id = f.ticket_id LEFT JOIN users u ON u.id = t.user_id '
      + 'UNION ALL '
      + "SELECT t.id, COALESCE(NULLIF(u.name, ''), u.email, NULLIF(t.submitted_by, ''), 'account ' || t.user_id), "
      + "CASE ct.status WHEN 'approved' THEN 'approved' ELSE 'declined' END, "
      + "CASE ct.status WHEN 'approved' THEN 'Approved' ELSE 'Declined' END, "
      + "datetime(ct.decided_at), ct.decided_by, NULL, datetime(ct.created_at), NULLIF(ct.decline_reason, ''), 1 "
      + 'FROM community_tasks ct JOIN tickets t ON t.id = ct.ticket_id LEFT JOIN users u ON u.id = t.user_id '
      + "WHERE ct.status IN ('approved', 'declined') AND ct.decided_at IS NOT NULL",
  },
  {
    key: 'payouts', scope: 'hq', recorded: true, since: null,
    sql:
      'SELECT p.id AS item_id, ' + WHO('u', 'p.user_id') + ' AS who, '
      + "CASE p.status WHEN 'completed' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE p.status WHEN 'completed' THEN 'Paid' ELSE 'Failed' END AS outcome_word, "
      + "datetime(CASE p.status WHEN 'completed' THEN p.completed_at ELSE p.failed_at END) AS decided_at, "
      + 'p.processed_by AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(p.created_at) AS arrived_at, CASE WHEN p.status = 'failed' THEN NULLIF(p.failure_reason, '') END AS note, 1 AS note_shown "
      + 'FROM payouts p LEFT JOIN users u ON u.id = p.user_id '
      + "WHERE (p.status = 'completed' AND p.completed_at IS NOT NULL) OR (p.status = 'failed' AND p.failed_at IS NOT NULL)",
  },
  {
    key: 'ai_runs', scope: 'hq', recorded: false, since: null,
    reason: 'A held AI run keeps no time or decider for its charge or refund; only the activity log records it.',
  },
  {
    // Ending a licence turns a rejected response into withdrawn and keeps the review.
    key: 'notices', scope: 'hq', recorded: true, since: null,
    sql:
      "SELECT n.id AS item_id, COALESCE(NULLIF(l.brand_name, ''), NULLIF(u.name, ''), u.email, 'account ' || n.user_id) AS who, "
      + "CASE n.status WHEN 'accepted' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE n.status WHEN 'accepted' THEN 'Accepted' ELSE 'Rejected' END AS outcome_word, "
      + 'datetime(n.reviewed_at) AS decided_at, n.reviewed_by_user_id AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(COALESCE(n.responded_at, n.created_at)) AS arrived_at, NULLIF(n.review_note, '') AS note, 1 AS note_shown "
      + 'FROM admin_notices n LEFT JOIN territory_licences l ON l.id = n.licence_id LEFT JOIN users u ON u.id = n.user_id '
      + "WHERE n.status IN ('accepted', 'rejected', 'withdrawn') AND n.reviewed_at IS NOT NULL",
  },
  {
    // Every kind, as the inbox's Support lane counts them, program-grant requests included.
    key: 'support', scope: 'hq', recorded: true, since: null,
    sql:
      "SELECT e.id AS item_id, COALESCE(NULLIF(e.raised_by_name, ''), 'studio ' || e.branch_code) AS who, "
      + "CASE e.status WHEN 'answered' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE e.status WHEN 'answered' THEN 'Answered' ELSE 'Declined' END AS outcome_word, "
      + "datetime(e.answered_at) AS decided_at, e.answered_by_user_id AS decided_by_id, NULLIF(e.answered_by_name, '') AS decided_by_label, "
      + "datetime(e.created_at) AS arrived_at, NULLIF(e.answer, '') AS note, 1 AS note_shown "
      + "FROM hq_escalations e WHERE e.status IN ('answered', 'declined') AND e.answered_at IS NOT NULL",
  },
  {
    key: 'proposals', scope: 'hq', recorded: true, since: null,
    sql:
      "SELECT pp.id AS item_id, COALESCE(NULLIF(l.brand_name, ''), CASE WHEN pp.licence_uid IS NULL THEN 'HQ-held' END, "
      + "NULLIF(u.name, ''), u.email, 'account ' || pp.created_by_user_id) AS who, "
      + "CASE pp.status WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome, "
      + "CASE pp.status WHEN 'approved' THEN CASE pp.decision WHEN 'catalogue' THEN 'Approved for the catalogue' ELSE 'Approved for the studio' END "
      + "WHEN 'sent_back' THEN 'Sent back' ELSE 'Declined' END AS outcome_word, "
      + 'datetime(pp.decided_at) AS decided_at, pp.decided_by_user_id AS decided_by_id, NULL AS decided_by_label, '
      + "datetime(COALESCE(pp.sent_at, pp.created_at)) AS arrived_at, NULLIF(pp.hq_note, '') AS note, 1 AS note_shown "
      + 'FROM program_proposals pp LEFT JOIN territory_licences l ON l.uid = pp.licence_uid '
      + 'LEFT JOIN users u ON u.id = pp.created_by_user_id '
      + "WHERE pp.status IN ('approved', 'declined', 'sent_back') AND pp.decided_at IS NOT NULL",
  },
];

const LABELS = new Map<string, string>([
  ...APPROVAL_SOURCES.map((s) => [s.key, s.label] as [string, string]),
  ['product_testers', 'Product testers'],
  ...HQ_APPROVAL_SOURCES.map((s) => [s.key, s.label] as [string, string]),
]);
export const laneLabel = (key: string) => LABELS.get(key) ?? key;

/** The lanes a caller may read: HQ's only for a Super Admin. */
export function decisionLanesFor(superAdmin: boolean, lanes: readonly DecisionLane[] = DECISION_LANES): readonly DecisionLane[] {
  return superAdmin ? lanes : lanes.filter((l) => l.scope !== 'hq');
}

// The wrapper every lane is read through. Binds, in order: from (twice), to
// (twice), outcome (twice), decided-by (twice), then the limit.
const FILTER =
  ') b LEFT JOIN users du ON du.id = b.decided_by_id '
  + 'WHERE b.decided_at IS NOT NULL AND (? IS NULL OR b.decided_at >= ?) AND (? IS NULL OR b.decided_at < ?) '
  + 'AND (? IS NULL OR b.outcome = ?) AND (? IS NULL OR b.decided_by_id = ?)';
const LIST_HEAD =
  'SELECT b.item_id, b.who, b.outcome, b.outcome_word, b.decided_at, b.decided_by_id, '
  + "CASE WHEN b.decided_by_id IS NULL THEN b.decided_by_label ELSE COALESCE(NULLIF(du.name, ''), du.email, b.decided_by_label, 'account ' || b.decided_by_id) END AS decided_by_name, "
  + 'b.arrived_at, b.note, CASE WHEN b.note IS NULL THEN 0 ELSE b.note_shown END AS note_shown FROM (';
const LIST_TAIL = ' ORDER BY b.decided_at DESC, b.item_id DESC LIMIT ?';
const COUNT_HEAD = 'SELECT COUNT(*) AS n FROM (';

/** A lane's list and count statements, each a constant built from constants. */
export const listSql = (l: Recorded) => LIST_HEAD + l.sql + FILTER + LIST_TAIL;
export const countSql = (l: Recorded) => COUNT_HEAD + l.sql + FILTER;

export type DecidedRow = {
  lane: string;
  lane_label: string;
  item_id: number;
  who: string;
  outcome: Outcome;
  outcome_word: string;
  decided_at: string;
  decided_by: { id: number | null; name: string } | null;
  /** Hours from arrival to decision, or null when either end is not recorded. */
  wait_hours: number | null;
  note: string | null;
  /** True when the person the item is about is shown this note. */
  note_shown: boolean;
};

export type Filters = { from: string | null; to: string | null; outcome: Outcome | null; decidedBy: number | null };
const NO_FILTERS: Filters = { from: null, to: null, outcome: null, decidedBy: null };
const binds = (f: Filters) => [f.from, f.from, f.to, f.to, f.outcome, f.outcome, f.decidedBy, f.decidedBy];

function waitHours(arrived: unknown, decided: unknown): number | null {
  const h = (utcMs(decided) - utcMs(arrived)) / 3_600_000;
  return Number.isFinite(h) && h >= 0 ? Math.round(h * 10) / 10 : null;
}

function shape(lane: Recorded, r: any): DecidedRow {
  return {
    lane: lane.key,
    lane_label: laneLabel(lane.key),
    item_id: Number(r.item_id),
    who: String(r.who ?? 'Not recorded'),
    outcome: r.outcome,
    outcome_word: String(r.outcome_word),
    decided_at: String(r.decided_at),
    decided_by: r.decided_by_name == null ? null : { id: r.decided_by_id == null ? null : Number(r.decided_by_id), name: String(r.decided_by_name) },
    wait_hours: waitHours(r.arrived_at, r.decided_at),
    note: r.note == null ? null : String(r.note),
    note_shown: Number(r.note_shown) === 1,
  };
}

/** The lane's line in a read: recorded with its since and caveat, or not, with why. */
function laneMeta(l: DecisionLane) {
  return l.recorded
    ? { key: l.key, label: laneLabel(l.key), recorded: true as const, since: l.since, ...(l.caveat ? { caveat: l.caveat } : {}), ...(l.scope ? { scope: l.scope } : {}) }
    : { key: l.key, label: laneLabel(l.key), recorded: false as const, since: null, reason: l.reason, ...(l.scope ? { scope: l.scope } : {}) };
}

export const DECIDED_PAGE_SIZE = 25;
/** The deepest page: each lane is read to `page × 25` rows to merge them, so the depth is bounded. */
export const DECIDED_MAX_PAGE = 40;

/** GET /api/admin/approvals/decided: the log, newest first, 25 a page, with an exact total or null. */
export async function decidedLog(env: Env, a: { lanes: readonly DecisionLane[]; filters?: Filters; page: number }) {
  const filters = a.filters ?? NO_FILTERS;
  const want = a.page * DECIDED_PAGE_SIZE;
  const rows: DecidedRow[] = [];
  const lanes: any[] = [];
  const unreadable: string[] = [];
  let total: number | null = 0;
  for (const l of a.lanes) {
    if (!l.recorded) { lanes.push(laneMeta(l)); continue; }
    try {
      const [list, count] = await Promise.all([
        env.DB.prepare(listSql(l)).bind(...binds(filters), want).all<any>(),
        env.DB.prepare(countSql(l)).bind(...binds(filters)).first<{ n: number }>(),
      ]);
      const n = Number(count?.n ?? 0);
      for (const r of list.results || []) rows.push(shape(l, r));
      lanes.push({ ...laneMeta(l), count: n });
      if (total != null) total += n;
    } catch (e) {
      console.error('[approvals] decided lane', l.key, (e as Error)?.message);
      unreadable.push(laneLabel(l.key));
      lanes.push({ ...laneMeta(l), count: null, reason: `${laneLabel(l.key)} could not be read.` });
      total = null;
    }
  }
  rows.sort((x, y) => (x.decided_at < y.decided_at ? 1 : x.decided_at > y.decided_at ? -1
    : x.lane === y.lane ? y.item_id - x.item_id : x.lane < y.lane ? -1 : 1));
  const start = (a.page - 1) * DECIDED_PAGE_SIZE;
  const notRecorded = lanes.filter((l) => !l.recorded).map((l) => l.label);
  // Only lanes that keep no decisions: there is no total to give, and an empty list would read as none decided.
  const noneRecorded = a.lanes.length > 0 && a.lanes.every((l) => !l.recorded);
  if (noneRecorded) total = null;
  return {
    items: rows.slice(start, start + DECIDED_PAGE_SIZE),
    total,
    ...(total == null ? {
      total_reason: noneRecorded
        ? `${notRecorded.join(', ')} does not record its decisions, so nothing can be listed or counted.`
        : `${unreadable.join(', ')} could not be read, so the total is not known.`,
    } : {}),
    page: a.page,
    page_size: DECIDED_PAGE_SIZE,
    lanes,
    unreadable,
    ...(notRecorded.length ? { not_recorded: notRecorded } : {}),
  };
}

// ---------------------------------------------------------------- the weekly series and the tile

export const SERIES_WEEKS = 8;
/** The most decided rows one lane reads for the series; past it the lane says so rather than undercount. */
export const SERIES_LANE_CAP = 5000;

/** Monday 00:00 UTC of the week holding `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

type LaneSeries = {
  key: string; label: string; available: boolean; reason?: string;
  arrived: number[] | null; decided: number[] | null; scope?: 'hq';
};

/**
 * GET /api/admin/approvals/decided/weekly: arrived and decided per lane for
 * eight weeks, the current week last and marked `to_date`, and the "Decided
 * this week" tile with its median wait.
 *
 * ARRIVED counts items, by the week they arrived, that are now waiting or
 * decided; DECIDED counts decisions by the week they were made. A lane that
 * does not record its decisions has neither (`available: false`, with why):
 * without its decided rows its arrivals would be only the ones still waiting.
 */
export async function decidedWeekly(env: Env, a: { lanes: readonly DecisionLane[]; sources: readonly ApprovalSource[]; now: number }) {
  const thisWeek = weekStart(a.now);
  const startMs = thisWeek - (SERIES_WEEKS - 1) * 7 * 86_400_000;
  const weeks = Array.from({ length: SERIES_WEEKS }, (_, i) => {
    const ms = startMs + i * 7 * 86_400_000;
    return { week_start: new Date(ms).toISOString().slice(0, 10), to_date: i === SERIES_WEEKS - 1 };
  });
  const index = (stamp: unknown) => {
    const ms = utcMs(stamp);
    if (!Number.isFinite(ms) || ms < startMs || ms >= thisWeek + 7 * 86_400_000) return -1;
    return Math.floor((ms - startMs) / (7 * 86_400_000));
  };
  const from = sqlStamp(startMs);

  // The waiting items' arrival times, from the inbox's own board (D1040), read once.
  let board: Awaited<ReturnType<typeof approvalBoard>> | null = null;
  let boardFailed = false;
  try { board = await approvalBoard(env, 1000, a.now, a.sources); } catch { boardFailed = true; }

  const series: LaneSeries[] = [];
  const unreadable: string[] = [];
  const thisWeekWaits: number[] = [];
  let thisWeekDecided: number | null = 0;
  for (const l of a.lanes) {
    const base = { key: l.key, label: laneLabel(l.key), ...(l.scope ? { scope: l.scope } : {}) };
    if (!l.recorded) {
      series.push({ ...base, available: false, reason: l.reason, arrived: null, decided: null });
      continue;
    }
    try {
      const q = await env.DB.prepare(listSql(l)).bind(...binds({ ...NO_FILTERS, from }), SERIES_LANE_CAP + 1).all<any>();
      const rows = q.results || [];
      if (rows.length > SERIES_LANE_CAP) {
        unreadable.push(base.label);
        series.push({ ...base, available: false, reason: `${base.label} decided more than ${SERIES_LANE_CAP} items in eight weeks; the series reads no further.`, arrived: null, decided: null });
        if (thisWeekDecided != null) thisWeekDecided = null;
        continue;
      }
      const decided = new Array(SERIES_WEEKS).fill(0);
      const firstArrival = new Map<number, unknown>();
      for (const r of rows) {
        const w = index(r.decided_at);
        if (w >= 0) decided[w] += 1;
        if (w === SERIES_WEEKS - 1) {
          if (thisWeekDecided != null) thisWeekDecided += 1;
          const h = waitHours(r.arrived_at, r.decided_at);
          if (h != null) thisWeekWaits.push(h);
        }
        const prev = firstArrival.get(Number(r.item_id));
        if (prev == null || utcMs(r.arrived_at) < utcMs(prev)) firstArrival.set(Number(r.item_id), r.arrived_at);
      }

      let arrived: number[] | null = null;
      let reason: string | undefined;
      if (l.arrivals === false) {
        reason = `${base.label} keeps no arrival time once an item is decided, so its arrivals are not counted.`;
      } else {
        let waiting: unknown[] | null = null;
        if (l.waitingSql) {
          const w = await env.DB.prepare(l.waitingSql).bind(from).all<any>();
          waiting = (w.results || []).map((r: any) => r.arrived_at);
        } else if (board && !boardFailed) {
          const laneCount = board.lanes.find((x) => x.key === l.key);
          if (laneCount && laneCount.count != null && laneCount.count <= 1000) {
            waiting = board.items.filter((it) => it.lane === l.key).map((it) => it.created_at);
          }
        }
        if (waiting == null) {
          reason = `${base.label}'s waiting items could not be read, so its arrivals are not counted.`;
        } else {
          arrived = new Array(SERIES_WEEKS).fill(0);
          for (const at of [...firstArrival.values(), ...waiting]) {
            const w = index(at);
            if (w >= 0) arrived[w] += 1;
          }
        }
      }
      series.push({ ...base, available: true, ...(reason ? { reason } : {}), arrived, decided });
    } catch (e) {
      console.error('[approvals] weekly lane', l.key, (e as Error)?.message);
      unreadable.push(base.label);
      series.push({ ...base, available: false, reason: `${base.label} could not be read.`, arrived: null, decided: null });
      thisWeekDecided = null;
    }
  }

  const sum = (pick: (s: LaneSeries) => number[] | null) => {
    const counted = series.filter((s) => s.available && pick(s));
    return counted.length ? weeks.map((_, i) => counted.reduce((t, s) => t + (pick(s) as number[])[i], 0)) : null;
  };
  const notRecorded = series.filter((s) => !s.available && !unreadable.includes(s.label)).map((s) => s.label);
  return {
    weeks,
    lanes: series,
    totals: {
      arrived: sum((s) => s.arrived),
      decided: sum((s) => s.decided),
      // The lanes each total leaves out, so the chart's foot can name them.
      arrived_leaves_out: series.filter((s) => !s.arrived).map((s) => s.label),
      decided_leaves_out: series.filter((s) => !s.decided).map((s) => s.label),
    },
    tile: thisWeekDecided == null
      ? { decided_this_week: null, median_wait_hours: null, reason: `${unreadable.join(', ')} could not be read, so this week's decisions are not known.` }
      : {
        decided_this_week: thisWeekDecided,
        median_wait_hours: medianOfHours(thisWeekWaits),
        ...(notRecorded.length ? { leaves_out: notRecorded } : {}),
      },
    unreadable,
  };
}
