/**
 * The four local approval queues, declared once (D130).
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
import { PRE_VERDICT_STATUSES } from './referralSubmissions';

/** A lane's stable key. The UI orders by this list, so the order is the canvas's. */
export type ApprovalLaneKey = 'lp' | 'referrals' | 'cohort' | 'moderation';

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
  },
  {
    key: 'moderation',
    label: 'Spinout moderation',
    countSql:
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM spinout_moderation_cases '
      + "WHERE status = 'under_review'",
    rowsSql:
      "SELECT m.id AS id, COALESCE(NULLIF(u.name, ''), u.email, 'account ' || m.user_id) AS who, "
      + "'Moderation · ' || m.reason_code AS what, m.created_at AS created_at "
      + 'FROM spinout_moderation_cases m LEFT JOIN users u ON u.id = m.user_id '
      + "WHERE m.status = 'under_review' ORDER BY m.created_at ASC LIMIT ?",
  },
] as const;

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
export const SLA_DUE_SOON_HOURS = 24;
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
 * Every open item across the four local queues, newest-waiting last.
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
 * other three off a screen whose whole purpose is "what is oldest anywhere".
 */
export async function approvalBoard(env: Env, limit = 100, now = Date.now()): Promise<ApprovalBoard> {
  const items: ApprovalItem[] = [];
  const lanes: ApprovalBoard['lanes'] = [];
  const unreadable: string[] = [];

  for (const src of APPROVAL_SOURCES) {
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
};

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
export async function laneCounts(env: Env): Promise<LaneCount[]> {
  const out: LaneCount[] = [];
  for (const s of APPROVAL_SOURCES) {
    try {
      const row = await env.DB.prepare(s.countSql).first<{ n: number; oldest: string | null }>();
      out.push({
        key: s.key,
        label: s.label,
        count: Number(row?.n) || 0,
        oldest_at: row?.oldest ?? null,
      });
    } catch {
      out.push({ key: s.key, label: s.label, count: null, oldest_at: null });
    }
  }
  return out;
}
