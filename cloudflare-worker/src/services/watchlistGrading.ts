/**
 * Task #14 — Pure grading + due-date helpers for the watchlist anti-portfolio
 * roll-up and the `next_check_at` follow-up reminder sweep.
 *
 * Deliberately import-free (no runtime imports) so the `--experimental-strip-
 * types` test loader can unit-test these without dragging in hono / notify /
 * the wider Worker graph (see .agents/memory: the strip-types loader breaks on
 * heavy transitive import graphs).
 */

export interface ProjectSignal {
  exists: boolean;
  uid?: string;
  name?: string;
  status?: string;
  is_alive?: boolean;
  latest_score?: number | null;
  latest_tier?: string | null;
  latest_health_badge?: string | null;
  latest_health_score?: number | null;
}

/**
 * Grade a past `pass` decision for the anti-portfolio (mirrors backend
 * watchlist.py::_grade_pass):
 *   - project doesn't exist / no link  -> 'open'
 *   - project dead (rejected)          -> 'vindicated'
 *   - project alive + health green + score >= 70 -> 'regret'
 *   - else                             -> 'open'
 */
export function gradePass(signal: ProjectSignal): 'vindicated' | 'regret' | 'open' {
  if (!signal.exists) return 'open';
  if (signal.is_alive === false) return 'vindicated';
  const score = signal.latest_score || 0;
  if (signal.latest_health_badge === 'green' && score >= 70) return 'regret';
  return 'open';
}

/** Parse a stored timestamp (ISO, `YYYY-MM-DD HH:MM:SS`, or date-only) to ms. */
function parseTs(value: string): number | null {
  const raw = String(value).trim();
  if (!raw) return null;
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // Date-only → treat as UTC midnight.
    iso = raw + 'T00:00:00Z';
  } else {
    iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) iso += 'Z';
  }
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Is a follow-up reminder due for a watchlist item?
 *
 * True when `next_check_at` is set, at/before `now`, and no reminder has fired
 * for that checkpoint yet (`reminded_at` is null or predates `next_check_at`).
 * Because the sweep stamps `reminded_at = now (>= next_check_at)` after firing,
 * the same checkpoint never fires twice; bumping `next_check_at` to a later
 * date re-arms it (old `reminded_at` < new `next_check_at`). Unparseable dates
 * return false so the sweep never fires on garbage.
 */
export function reminderDue(
  nextCheckAt: string | null | undefined,
  remindedAt: string | null | undefined,
  now: Date,
): boolean {
  if (!nextCheckAt) return false;
  const due = parseTs(nextCheckAt);
  if (due == null) return false;
  if (due > now.getTime()) return false;
  if (!remindedAt) return true;
  const last = parseTs(remindedAt);
  if (last == null) return true;
  return last < due;
}
