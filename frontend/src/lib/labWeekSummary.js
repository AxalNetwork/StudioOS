/**
 * The Workspace's completed-Week-1 summary and header — the pure half (D381).
 *
 * WHAT THE CANVAS DRAWS AND WHERE EACH ONE LIVES. `Spin-Out Lab Workspace
 * .dc.html` gives the Week 1 summary four blocks; three have a store:
 *
 *   · Startup record — `projects.name` and `projects.created_at`, the project
 *     `pickLabProject` chooses (the same one every Lab tool writes into).
 *   · TAM / SAM — `projects.tam` / `projects.sam`, written by Market Intel's
 *     Recalculate. The canvas cites two analyst reports under them; nothing
 *     stores a citation against the figure. What IS stored is what the figure
 *     was derived from (`GET /projects/:id/market-assumptions`, migration 247),
 *     so the summary says that, and says the citation is not recorded.
 *   · Interviews — `discovery_interviews` through `GET /progress/discovery/:id`.
 *     "Key insight" is the interview's first logged pain, the same field the
 *     Discovery page leads with; an interview with no pain says so.
 *
 * The fourth — "Personal advisor: Week 1 question bank complete" — is Eadwyn.
 * Eadwyn's ledger (`/advisor/progress`) counts answers against the questions
 * visible NOW; it keeps no record of which week's bank a founder finished, so
 * the row is rendered Not recorded with that reason rather than drawn.
 */

/** The reason the summary gives for the Eadwyn row. One sentence, one place. */
export const EADWYN_WEEK_REASON =
  'Eadwyn counts answers against the questions open now; nothing records which week’s questions you finished.';

/** "$2.4B" / "$340M" / "$85K" from a whole-dollar figure; null when there is none. */
export function fmtMarket(n) {
  const v = Number(n);
  if (n == null || n === '' || !Number.isFinite(v) || v <= 0) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v % 1e9 === 0 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

/** A SQLite `YYYY-MM-DD HH:MM:SS` (UTC) or ISO string as a Date, or null. */
export function parseUtc(ts) {
  if (!ts) return null;
  const s = String(ts);
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which programme day the record was created on, counted from the founder's
 * Lab start. Null — never a guess — when either date is missing or the record
 * predates the Lab (a company that existed before its founder applied).
 */
export function recordDay(createdAt, startedAt) {
  const c = parseUtc(createdAt);
  const s = parseUtc(startedAt);
  if (!c || !s || c < s) return null;
  return Math.floor((c - s) / 86_400_000) + 1;
}

/** The interview's key insight: its first logged pain, or null. */
export function keyInsight(iv) {
  const pains = Array.isArray(iv?.pains) ? iv.pains : [];
  const first = pains.map((p) => String(p ?? '').trim()).find(Boolean);
  return first || null;
}

/** Table rows for the summary's interview list, newest first as the route sends them. */
export function interviewRows(interviews) {
  return (Array.isArray(interviews) ? interviews : []).map((iv) => {
    const d = parseUtc(iv?.interview_date);
    return {
      id: iv?.id,
      name: String(iv?.interviewee_name || '').trim() || null,
      date: d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null,
      insight: keyInsight(iv),
    };
  });
}

/**
 * The derivation line under TAM / SAM, from the saved assumptions. Returns the
 * named parts that are present, or null when none are — the caller then says
 * the assumptions are not recorded instead of printing an empty "Derived from".
 */
export function derivationParts(assumptions) {
  const a = assumptions && typeof assumptions === 'object'
    ? (assumptions.assumptions && typeof assumptions.assumptions === 'object' ? assumptions.assumptions : assumptions)
    : null;
  if (!a) return null;
  const parts = [a.methodology, a.category, a.geography]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

/**
 * Where the founder stands in or after the programme, from `/state`.
 *
 * `users.is_incorporated` is set by TWO paths: finishing week 4 (recordMilestone,
 * whose only week-4 requirement is `incorporation_completed`) and the `/exit`
 * escape hatch, which records no milestone. The Workspace used to read the flag
 * alone and call both "Graduated". The milestone is the difference — the same
 * signal `/graduates` and `/stats` already use on the worker.
 */
export function labStanding(state, doneKeys) {
  if (!state?.is_incorporated) return 'active';
  return doneKeys.has('incorporation_completed') ? 'graduated' : 'exited';
}

/** The header ring: the share of counted deliverables done, as a whole percent. */
export function deliverablePct(done, total) {
  if (!(total > 0)) return 0;
  return Math.round((done / total) * 100);
}
