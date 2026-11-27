/**
 * D4644 (#4644, Portfolio audit 3/5) — the one authoritative as-of valuation
 * mark, for every Portfolio consumer.
 *
 * Two stores hold marks, for two different grains, and they are not merged
 * here (D4644 §2 says why):
 *
 *   portfolio_marks           per project, `fmv` in dollars, with a basis and an
 *                             optional `fund_id` (NULL = firm level). What the
 *                             investor Portfolio reads.
 *   fund_position_valuations  per `portfolio_positions` row, `value_cents`, always
 *                             inside one fund. What the fund's own board reads.
 *
 * One RULE governs both, so a correction can never be read two ways:
 *
 *   1. **The reporting date is a ceiling.** Only marks effective on or before the
 *      requested date are eligible, so a quarter-end read never prices the book
 *      with a mark that did not exist yet. No date means no ceiling.
 *   2. **The latest effective mark wins** (`as_of_date` / `valuation_date` DESC).
 *   3. **A correction beats what it corrects.** Among marks sharing an effective
 *      date, the one recorded later wins: `created_at` DESC, then `id` DESC.
 *      `id` is an autoincrement, so (date, created_at, id) is a total order and
 *      the answer is the same on every read and every replica.
 *
 * Rule 3 is the fix for the defect this package names. The previous project-level
 * read grouped `MAX(as_of_date)` and then selected bare columns, so when a mark
 * was corrected for the same effective date SQLite returned the value from an
 * arbitrary row of the group: the same request could price a position at either
 * figure. Nothing recorded was wrong; which record answered was undefined.
 *
 * **Scope** (D4644 §3). `portfolio_marks.fund_id` is nullable, so one project can
 * carry a firm-level mark and a mark from each fund that holds it. A reader asks
 * for the scope it means, and nothing mixes:
 *
 *   { kind: 'fund', fundId }  that fund's marks, and firm-level marks as a
 *                             fallback. A sibling fund's mark is never read.
 *                             On one effective date the fund's own mark wins,
 *                             because it is the more specific record for it.
 *   { kind: 'firm' }          the project-level aggregate. On one effective
 *                             date a firm-level mark wins outright: it is the
 *                             record that speaks for the whole book, and no
 *                             single fund's view displaces it. Otherwise a
 *                             single fund's mark is used, and when two funds
 *                             disagree on the same effective date the value is
 *                             UNAVAILABLE with `conflict: 'fund_marks_conflict'`
 *                             — an aggregate cannot choose between two funds'
 *                             carrying values, and picking one silently is what
 *                             this package exists to stop.
 *
 * So the scope contributes one key to the order, ahead of the correction keys:
 * whether the row is the one its scope prefers. Rule 3's `created_at`/`id` then
 * resolve corrections within that preference, and the order stays total.
 */
import type { Env } from '../types';

/**
 * Rule 3: the correction keys that decide which record answers, newest first.
 * `latestProjectMarks` inserts its scope's preference between the effective
 * date and these, so the whole order is
 * `as_of_date DESC, <scope preference>, created_at DESC, id DESC`.
 */
export const MARK_PRECEDENCE = 'as_of_date DESC, created_at DESC, id DESC';
/** The same order over `fund_position_valuations`, whose effective date is `valuation_date`. */
export const POSITION_MARK_PRECEDENCE = 'valuation_date DESC, created_at DESC, id DESC';

/**
 * The correlated subquery that names the one authoritative
 * `fund_position_valuations` row for `<positionColumn>` as of a bound date.
 * Shared so the fund board and the fund's performance read cannot drift.
 * Binds one parameter: the as-of date.
 */
export function positionMarkIdSql(positionColumn: string): string {
  return `(SELECT m.id FROM fund_position_valuations m
            WHERE m.position_id = ${positionColumn} AND m.valuation_date <= ?
            ORDER BY ${POSITION_MARK_PRECEDENCE} LIMIT 1)`;
}

export type MarkScope = { kind: 'fund'; fundId: number } | { kind: 'firm' };

export interface ProjectMark {
  fmv: number;
  as_of_date: string;
  basis: string;
  /** Which store row answered: the fund that recorded it, or null for firm level. */
  fund_id: number | null;
  /**
   * Set when the scope cannot choose a value. `fmv` is then not a carrying
   * value and the caller must treat the position as unmarked.
   */
  conflict: 'fund_marks_conflict' | null;
}

const NEGATIVE_FMV = 'negative_fmv';

/** A mark row as the store holds it, before the scope rule is applied. */
interface MarkRow {
  project_id: number;
  fmv: number;
  as_of_date: string;
  basis: string;
  fund_id: number | null;
}

/**
 * The authoritative project mark as of `asOf`, per project, under `scope`.
 *
 * One query, ordered by the precedence rule, and the first row seen per project
 * (per fund-ness, for the firm scope) is the winner — so the selection is done
 * by the rule above, never by SQLite's choice of a bare column.
 *
 * `projectIds` null means every project the caller may already have scoped by
 * other means; an empty array means no project, and no query runs.
 */
export async function latestProjectMarks(
  env: Env,
  opts: { projectIds: number[] | null; asOf: string | null; scope: MarkScope },
): Promise<Map<number, ProjectMark>> {
  const { projectIds, asOf, scope } = opts;
  const out = new Map<number, ProjectMark>();
  if (projectIds != null && projectIds.length === 0) return out;
  const scopeCsv = projectIds == null ? null : projectIds.join(',');

  // The fund scope reads its own marks and firm-level ones; the firm scope reads
  // every mark and resolves across funds below. Either way the ceiling applies.
  const fundPredicate = scope.kind === 'fund' ? 'AND (m.fund_id = ? OR m.fund_id IS NULL)' : '';
  // The scope's preference, on one effective date: the firm's own record for the
  // aggregate, the fund's own record for a fund. `IS NULL` is 1 or 0 in SQLite,
  // so DESC puts the preferred row first.
  const scopePreference = scope.kind === 'fund' ? '(m.fund_id IS NOT NULL) DESC' : '(m.fund_id IS NULL) DESC';
  const binds: Array<string | number | null> = [asOf, asOf];
  if (scope.kind === 'fund') binds.push(scope.fundId);
  binds.push(scopeCsv, scopeCsv);

  const result = await env.DB.prepare(
    `SELECT m.project_id, m.fmv, m.as_of_date, m.basis, m.fund_id
       FROM portfolio_marks m
      WHERE (? IS NULL OR m.as_of_date <= ?)
        ${fundPredicate}
        AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(m.project_id AS TEXT) || ',') > 0)
      ORDER BY m.project_id, m.as_of_date DESC, ${scopePreference}, m.created_at DESC, m.id DESC`,
  ).bind(...binds).all<MarkRow>().catch(() => ({ results: [] as MarkRow[] }));

  // Rows arrive newest-first within each project, so the first row for a project
  // is its winner. For the firm scope the runners-up are still inspected, to see
  // whether a second fund marked the same effective date.
  for (const row of (result.results || [])) {
    const pid = Number(row.project_id);
    const fundId = row.fund_id == null ? null : Number(row.fund_id);
    const held = out.get(pid);
    if (!held) {
      out.set(pid, {
        fmv: Number(row.fmv),
        as_of_date: String(row.as_of_date),
        basis: String(row.basis || 'gp_estimate'),
        fund_id: fundId,
        conflict: null,
      });
      continue;
    }
    if (scope.kind !== 'firm' || held.conflict) continue;
    // A firm-level mark already won outright: no fund's mark displaces or
    // disputes it (rule: the firm speaks for the whole book).
    if (held.fund_id == null) continue;
    // Only a mark on the SAME effective date from a DIFFERENT fund is a conflict.
    // An older mark, or another row from the same fund, is simply superseded.
    if (row.as_of_date === held.as_of_date && fundId != null && fundId !== held.fund_id) {
      out.set(pid, { ...held, conflict: 'fund_marks_conflict' });
    }
  }
  return out;
}

/**
 * The carrying value a consumer should use for one position, and why not when
 * there is none. Keeps "no mark", "the funds disagree" and "the recorded mark is
 * not a value" apart, so no caller has to guess from a bare null.
 */
export function carryingValue(mark: ProjectMark | null | undefined): {
  fmv: number | null;
  unavailable_reason: 'no_mark' | 'fund_marks_conflict' | 'negative_fmv' | null;
} {
  if (!mark) return { fmv: null, unavailable_reason: 'no_mark' };
  if (mark.conflict) return { fmv: null, unavailable_reason: mark.conflict };
  if (!Number.isFinite(mark.fmv) || mark.fmv < 0) return { fmv: null, unavailable_reason: NEGATIVE_FMV };
  return { fmv: mark.fmv, unavailable_reason: null };
}

/** The sentences the API puts beside an unavailable carrying value. */
export const MARK_UNAVAILABLE_REASONS: Record<'no_mark' | 'fund_marks_conflict' | 'negative_fmv', string> = {
  no_mark: 'No valuation is recorded for this position as of this date; invested cost is not its value.',
  fund_marks_conflict: 'Two funds recorded different values for this company on the same date. Record a firm-level mark, or read the fund on its own page.',
  negative_fmv: 'The recorded valuation is negative, which is not a carrying value.',
};
