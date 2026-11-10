/**
 * #4645 (D4645) — Portfolio health reads its four sources, keeps what happened
 * to each, and scores only what it could actually measure. The scoring itself
 * moved here out of `routes/portfolio.ts` so it can be tested without a
 * request.
 *
 * WHAT WAS WRONG, measured on the old `computeScore`:
 *
 *   1. Every read ended in `.catch(() => null)`, so a FAILED read and an empty
 *      store were the same answer.
 *   2. A missing or unreadable scoring snapshot was scored **50** —
 *      `drivers.scoring != null ? … : 50`. A figure the platform does not
 *      record, presented as this company's measurement.
 *   3. `Number(t?.open || 0)` and `Number(a?.c || 0)` turned unreadable ticket
 *      and activity stores into "no open tickets" and "no activity in 30
 *      days". The second one LOWERS the score, so a store that could not be
 *      read made a company look dormant and could set its intervention flag.
 *   4. The activity read matched its project with
 *      `details LIKE ('%project=' || ? || '%')`. That is a substring: project
 *      1 collected the activity of projects 12, 19, 100 and every other id
 *      beginning with a 1. `activity_logs.project_id` is a column, and it was
 *      a stringified copy of that column being matched loosely.
 *
 * THE RULES NOW, and each is a defect above turned into a policy:
 *
 *   · An UNREADABLE input means no score. `score` is null, there is no badge,
 *     the intervention flag stays off, and no snapshot is written. An
 *     intervention is a claim about a company, and it is never made from a
 *     store nobody could read.
 *   · A NOT-RECORDED input is a fact, so the score is computed over the
 *     signals that did answer and their weights are renormalised. The missing
 *     signal is neither invented at 50 nor counted as zero, and the response
 *     names it. With all signals present the arithmetic is identical to the
 *     old one.
 *   · With no positive signal recorded at all there is nothing to measure, so
 *     there is no score.
 *   · Every figure states its own window and population.
 */
import type { Env } from '../types';
import { type Source, absent, readSource, recorded, sourceDto, unreadableLabels } from './sourceState';

/** The window the activity signal is read over, in days. Stated in the response, not implied by a key's name. */
export const ACTIVITY_WINDOW_DAYS = 30;

/** Full weight of each positive signal. Their sum is the share of the score that is measured rather than penalised. */
export const WEIGHTS = { scoring: 0.6, activity: 0.3 } as const;
/** The ticket-pressure penalty's share. `WEIGHTS` plus this is 1. */
export const PRESSURE_WEIGHT = 0.1;

const R = {
  scoringNone: 'Not recorded — this company has no scoring snapshot yet',
  scoringUnreadable: 'Unreadable — the scoring snapshots could not be read',
  ticketsUnreadable: 'Unreadable — the tickets could not be read',
  activityUnreadable: 'Unreadable — the activity log could not be read',
};

/**
 * The two GLOB patterns that catch the legacy activity rows — the ones that
 * recorded their project only inside `details`, as `project=<id>`, before
 * `activity_logs.project_id` was being filled.
 *
 * DELIMITED, which is the whole point: the id must be followed by a non-digit
 * or end the string, so `project=1` cannot take `project=12`. The old read was
 * `details LIKE ('%project=' || ? || '%')` and gave project 1 the activity of
 * every project whose id starts with a 1.
 *
 * The WHOLE pattern is bound, never built inside the SQL. A GLOB whose pattern
 * is concatenated from a bound parameter (`'*project=' || ? || '[^0-9]*'`)
 * silently matches NOTHING in SQLite, while the identical pattern bound in one
 * piece matches — measured, and the reason this helper exists rather than two
 * expressions in the statement. (In SQLite GLOB, `[^0-9]` is the negated
 * class; `[!0-9]` is not a negation — it matches a literal `!` or a digit.)
 *
 * `id` reaches a pattern rather than a value, so it is checked: a
 * non-integer would be a pattern fragment. The callers pass a row id, and this
 * keeps that true at the boundary (`CLAUDE.md`: anything that reaches a regex
 * is first checked against an allowed character set).
 */
export function legacyActivityGlobs(id: number): [string, string] {
  if (!Number.isInteger(id) || id <= 0) throw new Error('project id must be a positive integer');
  return [`*project=${id}[^0-9]*`, `*project=${id}`];
}

export type Tickets = { open: number; total: number };
export type HealthSources = {
  scoring: Source<number>;
  tickets: Source<Tickets>;
  activity: Source<number>;
};

/**
 * The four reads, each keeping its own outcome.
 *
 * `score_snapshots.total_score` is the column (`score` is not one, and the old
 * catch turned that into a null driver on every row rather than an error). A
 * row whose `total_score` is NULL is not a score, so it reads as not recorded
 * rather than as zero.
 */
export async function readHealthSources(env: Env, projectId: number, now = Date.now()): Promise<HealthSources> {
  const windowFrom = new Date(now - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString();
  const scoring = await readSource('score_snapshots', async () => {
    const row = await env.DB.prepare(
      'SELECT total_score FROM score_snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1',
    ).bind(projectId).first<{ total_score: number | null }>();
    return row == null || row.total_score == null ? null : Number(row.total_score);
  }, { notRecorded: R.scoringNone, unreadable: R.scoringUnreadable });

  const tickets = await readSource('tickets', async () => {
    const row = await env.DB.prepare(
      `SELECT SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open, COUNT(*) AS total
         FROM tickets WHERE project_id = ?`,
    ).bind(projectId).first<{ open: number | null; total: number | null }>();
    // COUNT always answers, so a row is always returned: zero tickets is a
    // recorded zero, not an absence.
    return { open: Number(row?.open ?? 0), total: Number(row?.total ?? 0) };
  }, { notRecorded: 'Not recorded', unreadable: R.ticketsUnreadable });

  const activity = await readSource('activity_logs', async () => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM activity_logs
        WHERE datetime(created_at) >= datetime(?)
          AND (project_id = ? OR details GLOB ? OR details GLOB ?)`,
    ).bind(windowFrom, projectId, ...legacyActivityGlobs(projectId)).first<{ c: number | null }>();
    return Number(row?.c ?? 0);
  }, { notRecorded: 'Not recorded', unreadable: R.activityUnreadable });

  return { scoring, tickets, activity };
}

export type Scored = {
  /** 0..100, or null when nothing could be stated. */
  score: number | null;
  badge: 'green' | 'yellow' | 'red' | null;
  intervention: boolean;
  /** Why there is no score, when there is none. */
  reason: string | null;
  drivers: Record<string, unknown>;
};

/** The badge for a score. Only ever called with a score. */
export function badgeFor(score: number): { badge: 'green' | 'yellow' | 'red'; intervention: boolean } {
  if (score >= 70) return { badge: 'green', intervention: false };
  if (score >= 40) return { badge: 'yellow', intervention: false };
  return { badge: 'red', intervention: true };
}

/**
 * Score what answered.
 *
 * The positive signals carry `WEIGHTS`; the weights of the ones that answered
 * are renormalised to their full sum (0.9), so a company missing one signal is
 * scored out of what it has instead of being docked for the gap. Ticket
 * pressure is a penalty and applies only when the tickets were read.
 */
export function scoreHealth(sources: HealthSources): Scored {
  const drivers: Record<string, unknown> = {
    scoring: sources.scoring.state === 'recorded' ? sources.scoring.value : null,
    tickets_open: sources.tickets.state === 'recorded' ? sources.tickets.value.open : null,
    tickets_total: sources.tickets.state === 'recorded' ? sources.tickets.value.total : null,
    activity_30d: sources.activity.state === 'recorded' ? sources.activity.value : null,
    window_days: ACTIVITY_WINDOW_DAYS,
    sources: {
      scoring: sourceDto(sources.scoring),
      tickets: sourceDto(sources.tickets),
      activity: sourceDto(sources.activity),
    },
  };

  // One reading of "which sources failed", from the module that owns the
  // states, rather than a second filter here that could drift from it.
  const unreadable = unreadableLabels(sources as unknown as Record<string, Source<unknown>>);
  if (unreadable.length) {
    return {
      score: null, badge: null, intervention: false, drivers,
      reason: `Unreadable — ${unreadable.join(', ')} could not be read, so no health score is stated`,
    };
  }

  // Present positive signals, each as a 0..100 part with its full weight.
  const parts: Array<{ weight: number; part: number }> = [];
  if (sources.scoring.state === 'recorded') {
    parts.push({ weight: WEIGHTS.scoring, part: Math.max(0, Math.min(100, sources.scoring.value)) });
  }
  if (sources.activity.state === 'recorded') {
    parts.push({ weight: WEIGHTS.activity, part: Math.min(100, sources.activity.value * 100 / ACTIVITY_WINDOW_DAYS) });
  }
  if (!parts.length) {
    return {
      score: null, badge: null, intervention: false, drivers,
      reason: 'Not recorded — no scoring snapshot and no activity, so there is nothing to score',
    };
  }

  const full = WEIGHTS.scoring + WEIGHTS.activity;
  const given = parts.reduce((t, p) => t + p.weight, 0);
  const positive = parts.reduce((t, p) => t + p.part * p.weight, 0) * (full / given);
  const pressure = sources.tickets.state === 'recorded' && sources.tickets.value.total > 0
    ? (sources.tickets.value.open / sources.tickets.value.total) * 100
    : 0;
  const score = Math.max(0, Math.min(100, Math.round(positive - pressure * PRESSURE_WEIGHT)));
  const { badge, intervention } = badgeFor(score);
  return {
    score, badge, intervention, reason: null,
    drivers: { ...drivers, measured_weight: Number((given / full).toFixed(4)) },
  };
}

/** The whole read and score for one project. */
export async function healthOf(env: Env, projectId: number, now = Date.now()): Promise<Scored & { sources: HealthSources }> {
  const sources = await readHealthSources(env, projectId, now);
  return { ...scoreHealth(sources), sources };
}

/** A snapshot is written only for a score that was actually measured. */
export const scorable = (s: Scored): boolean => s.score != null && s.badge != null;

export { absent, recorded };
