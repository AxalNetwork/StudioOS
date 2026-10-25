/**
 * D1041 (#2889, part 3 of #2390) — HQ decides: the queues only the Super Admin
 * decides (D1038's APR9), counted for the Approvals page.
 *
 * SEPARATE FROM `APPROVAL_SOURCES` ON PURPOSE. Those lanes are every studio's,
 * and a branch's board, its backlog total and its assignments read them. These
 * are HQ's own stores, decided only on HQ by `requireSuperAdmin` routes; a
 * branch has no such queue to count, and an Admin has none to decide. So they
 * are read only on HQ and only for a Super Admin (the glance, `studioGlance`'s
 * `superAdmin`), and never join a branch's sum.
 *
 * EACH PREDICATE IS ITS QUEUE'S OWN, cited at the lane. The shape, the literal
 * SQL and the per-lane isolation are `approvalSources.ts`'s.
 */
import type { Env } from '../types';
import { countLanes, type ApprovalSource } from './approvalSources';
import { pressureOf } from './branchHome';

export type HqLaneKey =
  | 'testing_programs' | 'learning' | 'tickets' | 'payouts' | 'ai_runs'
  | 'notices' | 'support' | 'proposals';

export type HqApprovalSource = Omit<ApprovalSource, 'key'> & { key: HqLaneKey };

export const HQ_APPROVAL_SOURCES: readonly HqApprovalSource[] = [
  {
    key: 'testing_programs',
    label: 'Testing programs sent to HQ',
    // A partner's programme sent for review: the console's "waiting" rule
    // (`status === 'submitted' && owner_kind === 'partner'`), which
    // services/testing.ts enforces on approve. `updated_at` is stamped by the
    // submit step; the table has no `submitted_at`.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(COALESCE(updated_at, created_at))) AS oldest FROM testing_programmes '
      + "WHERE status = 'submitted' AND owner_kind = 'partner'",
    rowsSql:
      "SELECT t.id AS id, COALESCE(NULLIF(pt.name, ''), NULLIF(u.name, ''), u.email, 'account ' || t.created_by) AS who, "
      + "'Testing program · ' || t.product_name AS what, COALESCE(t.updated_at, t.created_at) AS created_at "
      + 'FROM testing_programmes t LEFT JOIN partners pt ON pt.id = t.owner_partner_id '
      + 'LEFT JOIN users u ON u.id = t.created_by '
      + "WHERE t.status = 'submitted' AND t.owner_kind = 'partner' "
      + 'ORDER BY julianday(COALESCE(t.updated_at, t.created_at)) ASC LIMIT ?',
    notifies: 'The partner',
    decidedOn: 'Platform › Product testing',
  },
  {
    key: 'learning',
    label: 'Learning exercises to review',
    // `submitted` is the one undecided state (accepted and needs_work are the
    // review's two answers); the reviewer's Review button shows on it.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(submitted_at)) AS oldest FROM learning_exercise_submissions '
      + "WHERE status = 'submitted'",
    rowsSql:
      "SELECT s.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || s.user_id) AS who, "
      + "'Exercise · ' || COALESCE(NULLIF(x.title, ''), 'exercise ' || s.exercise_id) AS what, s.submitted_at AS created_at "
      + 'FROM learning_exercise_submissions s LEFT JOIN learning_exercises x ON x.id = s.exercise_id '
      + 'LEFT JOIN users u ON u.id = s.user_id '
      + "WHERE s.status = 'submitted' ORDER BY julianday(s.submitted_at) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Learning studio',
  },
  {
    key: 'tickets',
    label: 'Features and tasks',
    // TWO STORES, ONE LANE, each on HQ review's own predicate
    // (routes/admin_ticket_reviews.ts): a feature ticket with no review row,
    // and a pending community task whose ticket is a task. The route reads the
    // second through a JOIN; EXISTS is the same set without the count depending
    // on a joined row. A ticket is one type, so its id is unique across both.
    countSql:
      'SELECT SUM(n) AS n, MIN(oldest) AS oldest FROM ('
      + "SELECT COUNT(*) AS n, MIN(datetime(t.created_at)) AS oldest FROM tickets t WHERE t.type = 'feature' "
      + 'AND NOT EXISTS (SELECT 1 FROM feature_request_reviews f WHERE f.ticket_id = t.id) '
      + 'UNION ALL '
      + "SELECT COUNT(*) AS n, MIN(datetime(ct.created_at)) AS oldest FROM community_tasks ct WHERE ct.status = 'pending' "
      + "AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = ct.ticket_id AND t.type = 'task'))",
    rowsSql:
      'SELECT id, who, what, created_at FROM ('
      + "SELECT t.id AS id, COALESCE(NULLIF(u.name, ''), u.email, NULLIF(t.submitted_by, ''), 'account ' || t.user_id) AS who, "
      + "'Feature · ' || t.title AS what, t.created_at AS created_at "
      + 'FROM tickets t LEFT JOIN users u ON u.id = t.user_id '
      + "WHERE t.type = 'feature' AND NOT EXISTS (SELECT 1 FROM feature_request_reviews f WHERE f.ticket_id = t.id) "
      + 'UNION ALL '
      + "SELECT t.id AS id, COALESCE(NULLIF(u.name, ''), u.email, NULLIF(t.submitted_by, ''), 'account ' || t.user_id) AS who, "
      + "'Task · ' || ct.title AS what, ct.created_at AS created_at "
      + 'FROM community_tasks ct JOIN tickets t ON t.id = ct.ticket_id LEFT JOIN users u ON u.id = t.user_id '
      + "WHERE ct.status = 'pending' AND t.type = 'task'"
      + ') ORDER BY julianday(created_at) ASC LIMIT ?',
    notifies: 'The member',
    decidedOn: 'HQ review',
  },
  {
    key: 'payouts',
    label: 'Payout requests',
    // The Commissions page's Open tab (`requested`, `processing`), which is
    // also the process route's own guard. A payout writes an activity row for
    // the member, which is not a notice.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM payouts '
      + "WHERE status IN ('requested', 'processing')",
    rowsSql:
      "SELECT p.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || p.user_id) AS who, "
      + "'Payout · ' || COALESCE(NULLIF(p.payout_method, ''), 'method not recorded') || ' · ' || p.status AS what, "
      + 'p.created_at AS created_at '
      + 'FROM payouts p LEFT JOIN users u ON u.id = p.user_id '
      + "WHERE p.status IN ('requested', 'processing') ORDER BY julianday(p.created_at) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Commissions',
  },
  {
    key: 'ai_runs',
    label: 'Held AI runs',
    // `review` is a reservation held for HQ (`listAiBudgetReviews`). The table
    // keys on `uid`, so a row's number is SQLite's `rowid`.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM ai_budget_reservations '
      + "WHERE status = 'review'",
    rowsSql:
      "SELECT r.rowid AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || r.user_id) AS who, "
      + "'Held AI run · ' || r.month_key AS what, r.created_at AS created_at "
      + 'FROM ai_budget_reservations r LEFT JOIN users u ON u.id = r.user_id '
      + "WHERE r.status = 'review' ORDER BY julianday(r.created_at) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Platform › AI allowances',
  },
  {
    key: 'notices',
    label: 'Notice responses',
    // A licensee answered and HQ owes the review: `responded` is the review
    // route's guard and the ladder's `awaiting_review` rung.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(COALESCE(responded_at, created_at))) AS oldest FROM admin_notices '
      + "WHERE status = 'responded'",
    rowsSql:
      "SELECT n.id AS id, COALESCE(NULLIF(l.brand_name, ''), NULLIF(u.name, ''), u.email, 'account ' || n.user_id) AS who, "
      + "'Notice response · ' || n.subject AS what, COALESCE(n.responded_at, n.created_at) AS created_at "
      + 'FROM admin_notices n LEFT JOIN territory_licences l ON l.id = n.licence_id '
      + 'LEFT JOIN users u ON u.id = n.user_id '
      + "WHERE n.status = 'responded' ORDER BY julianday(COALESCE(n.responded_at, n.created_at)) ASC LIMIT ?",
    notifies: 'The studio',
    decidedOn: 'Licences',
  },
  {
    key: 'support',
    label: 'Requests from studios',
    // `hq_escalations` with `status = 'open'`, Support's own summary
    // (`openEscalationSummary`). `raised_by_branch_user_id` is a branch's id,
    // never joined to HQ's users; the name and the branch code are the copy.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest FROM hq_escalations WHERE status = \'open\'',
    rowsSql:
      "SELECT e.id AS id, COALESCE(NULLIF(e.raised_by_name, ''), 'studio ' || e.branch_code) AS who, "
      + "e.kind || ' · ' || e.subject AS what, e.created_at AS created_at "
      + "FROM hq_escalations e WHERE e.status = 'open' ORDER BY julianday(e.created_at) ASC LIMIT ?",
    notifies: 'The studio',
    decidedOn: 'Support',
  },
  {
    key: 'proposals',
    label: 'Program proposals',
    // `sent` is the decide route's guard; HQ's queue also shows decided ones.
    countSql:
      'SELECT COUNT(*) AS n, MIN(datetime(COALESCE(sent_at, created_at))) AS oldest FROM program_proposals '
      + "WHERE status = 'sent'",
    rowsSql:
      "SELECT pp.id AS id, COALESCE(NULLIF(l.brand_name, ''), CASE WHEN pp.licence_uid IS NULL THEN 'HQ-held' END, "
      + "NULLIF(u.name, ''), u.email, 'account ' || pp.created_by_user_id) AS who, "
      + "'Program proposal · ' || pp.name AS what, COALESCE(pp.sent_at, pp.created_at) AS created_at "
      + 'FROM program_proposals pp LEFT JOIN territory_licences l ON l.uid = pp.licence_uid '
      + 'LEFT JOIN users u ON u.id = pp.created_by_user_id '
      + "WHERE pp.status = 'sent' ORDER BY julianday(COALESCE(pp.sent_at, pp.created_at)) ASC LIMIT ?",
    notifies: 'Nobody yet',
    decidedOn: 'Programs › Proposals',
  },
];

/** HQ's lanes with no store to count yet, said rather than laned. */
export const HQ_NOT_COUNTED_YET: ReadonlyArray<{ key: string; label: string; reason: string }> = [
  {
    key: 'grants',
    label: 'Program-grant requests',
    reason: 'No program-grant request is stored yet; part 2 of Program grants (#2774) adds them.',
  },
];

/**
 * HQ's lanes as pressure, worst first, with a total that is null when any lane
 * could not be read (a sum missing a term is not the total).
 */
export async function hqLanes(env: Env, now = Date.now()) {
  const lanes = pressureOf(await countLanes(env, HQ_APPROVAL_SOURCES), now);
  const unreadable = lanes.filter((l) => l.count === null).map((l) => l.label);
  return {
    lanes,
    pending_total: unreadable.length ? null : lanes.reduce((t, l) => t + (l.count ?? 0), 0),
    unreadable,
    not_counted: HQ_NOT_COUNTED_YET,
  };
}
