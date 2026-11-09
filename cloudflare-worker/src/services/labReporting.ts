/**
 * D4663 (#4663) — the Spin-Out Lab's public outcome reads, bounded in SQL:
 * `/graduates` (graduate companies), `/stats` (companies built, total raised)
 * and `/cohort` (the live tracker). Company-level facts only, as before:
 * never a founder's name, email, id, track or milestones.
 *
 * ONE COMPANY PER FOUNDER: THE ENROLLED VENTURE. Each read names a founder's
 * company through D4659's enrollment (`spinout_lab_enrollments.project_id`,
 * latest enrollment), never by joining every project the founder owns. The
 * active half of `/cohort` still joined by founder, so a founder with three
 * projects came back as three rows and showed whichever had the lowest id;
 * it now shows the venture, like the graduate half, `/graduates` and the
 * certificate. With no venture bound, or none live, the company's name falls
 * back to the founder's latest application, as before.
 *
 * BOUNDED BEFORE THE WORKER. These reads used to fetch every graduate (and
 * every project of every active founder), fold them in memory, and then read
 * each missing name with its own query. Now the name fallback is a correlated
 * subquery, a founder with no name anywhere is filtered out in SQL, and
 * ordering, the page size and the totals are SQL's:
 *
 *   graduateCards      one statement, at most GRADUATES_SHOWN rows.
 *   programmeFigures   one statement, one row (COUNT and SUM).
 *   cohortBoard        two statements, at most COHORT_ACTIVE_SHOWN and
 *                      COHORT_GRADUATES_SHOWN + COHORT_ACTIVE_SHOWN rows.
 *
 * The measurements, before and after, are in D4663.
 *
 * UNREADABLE IS NOT EMPTY (D4661). A statement that fails answers
 * `{ ok: false }` with what could not be read and the raw error; the route
 * turns it into a 503 `lab_outcomes_unreadable`. `[]` and a zero are only
 * ever a read that worked.
 */
import type { Env } from '../types';
import { SPRINT_DAYS } from './spinoutLabCatalog';
import { daysSince } from './labLifecycle';

export const GRADUATES_SHOWN = 12;
export const COHORT_ACTIVE_SHOWN = 24;
export const COHORT_GRADUATES_SHOWN = 8;

export type ReportRead<T> = { ok: true; value: T } | { ok: false; what: string; raw: unknown };

export type GraduateCard = {
  name: string | null;
  sector: string | null;
  stage: string | null;
  cohort: string | null;
  uid: string | null;
  graduated_at: string | null;
  raised: number | null;
  last_round: string | null;
};

export type CohortMember = {
  name: string;
  sector: string | null;
  cohort: string | null;
  status: 'active' | 'graduated';
  week: number;
  day: number | null;
  started_at: string | null;
};

type GraduateRow = {
  user_id: number;
  completed_at: string | null;
  cohort: string | null;
  uid: string | null;
  name: string | null;
  sector: string | null;
  stage: string | null;
  status: string | null;
  total_funding: number | null;
  last_funding_round: string | null;
};

type CohortActiveRow = {
  user_id: number;
  week: number | null;
  started_at: string | null;
  cohort: string | null;
  name: string;
  sector: string | null;
};

type CohortGradRow = {
  user_id: number;
  completed_at: string | null;
  started_at: string | null;
  cohort: string | null;
  name: string;
  sector: string | null;
};

/** A public profile resolves only for these (public.ts GET /startup/:handle 404s the rest). */
const UNLINKABLE_STATUSES = ['archived', 'rejected', 'intake'];

// The company name: the venture's, or else the founder's latest application's. An empty
// string is no name, in either place, exactly as the in-memory fallback treated it.
// The graduates, newest first; a graduate with no name anywhere is not a card.
const GRADUATES_SQL = `
  SELECT user_id, completed_at, cohort, uid, name, sector, stage, status, total_funding, last_funding_round
    FROM (
      SELECT g.user_id, g.graduated_at AS completed_at, usf.spinout_lab_cohort AS cohort,
             p.uid, p.sector, p.stage, p.status, p.total_funding, p.last_funding_round,
             COALESCE(NULLIF(p.name, ''),
                      NULLIF((SELECT a.company_name FROM spinout_applications a
                               WHERE a.user_id = g.user_id ORDER BY a.id DESC LIMIT 1), '')) AS name
        FROM spinout_lab_graduates g
        JOIN users u ON u.id = g.user_id
        LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
        LEFT JOIN spinout_lab_enrollments le ON le.id = (SELECT MAX(x.id) FROM spinout_lab_enrollments x WHERE x.user_id = g.user_id)
        LEFT JOIN projects p ON p.id = le.project_id AND p.deleted_at IS NULL
    )
   WHERE name IS NOT NULL
   ORDER BY completed_at DESC, user_id ASC
   LIMIT ?`;

export async function graduateCards(env: Env): Promise<ReportRead<GraduateCard[]>> {
  let rows: GraduateRow[];
  try {
    rows = (await env.DB.prepare(GRADUATES_SQL).bind(GRADUATES_SHOWN).all<GraduateRow>()).results ?? [];
  } catch (e) {
    return { ok: false, what: 'The Lab’s graduates', raw: e };
  }
  return {
    ok: true,
    value: rows.map((r) => ({
      name: r.name ?? null,
      sector: r.sector ?? null,
      stage: r.stage ?? null,
      cohort: r.cohort ?? null,
      uid: !!r.uid && !UNLINKABLE_STATUSES.includes(String(r.status || '').toLowerCase()) ? r.uid : null,
      graduated_at: r.completed_at ?? null,
      raised: r.total_funding ?? null,
      last_round: r.last_funding_round ?? null,
    })),
  };
}

// Companies built: every graduate, once. Total raised: the sum of each graduate's venture's
// positive funding. Neither reads `users`, as before.
const FIGURES_SQL = `
  SELECT COUNT(*) AS companies,
         SUM(CASE WHEN p.total_funding > 0 THEN p.total_funding ELSE 0 END) AS total_raised
    FROM spinout_lab_graduates g
    LEFT JOIN spinout_lab_enrollments le ON le.id = (SELECT MAX(x.id) FROM spinout_lab_enrollments x WHERE x.user_id = g.user_id)
    LEFT JOIN projects p ON p.id = le.project_id AND p.deleted_at IS NULL`;

export async function programmeFigures(env: Env): Promise<ReportRead<{ companies: number; total_raised: number | null }>> {
  try {
    const row = await env.DB.prepare(FIGURES_SQL).first<{ companies: number | null; total_raised: number | null }>();
    const raised = Number(row?.total_raised ?? 0);
    return {
      ok: true,
      value: { companies: Number(row?.companies ?? 0), total_raised: Number.isFinite(raised) && raised > 0 ? raised : null },
    };
  } catch (e) {
    return { ok: false, what: 'The Lab’s programme figures', raw: e };
  }
}

// Founders in the sprint, earliest start first, with a company name.
const COHORT_ACTIVE_SQL = `
  SELECT user_id, week, started_at, cohort, name, sector
    FROM (
      SELECT u.id AS user_id, u.spinout_lab_week AS week, u.spinout_lab_started_at AS started_at,
             usf.spinout_lab_cohort AS cohort, p.sector,
             COALESCE(NULLIF(p.name, ''),
                      NULLIF((SELECT a.company_name FROM spinout_applications a
                               WHERE a.user_id = u.id ORDER BY a.id DESC LIMIT 1), '')) AS name
        FROM users u
        LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
        LEFT JOIN spinout_lab_enrollments le ON le.id = (SELECT MAX(x.id) FROM spinout_lab_enrollments x WHERE x.user_id = u.id)
        LEFT JOIN projects p ON p.id = le.project_id AND p.deleted_at IS NULL
       WHERE u.spinout_lab_active = 1
    )
   WHERE name IS NOT NULL
   ORDER BY started_at ASC, user_id ASC
   LIMIT ?`;

// Graduates of the last 45 days with a company name, newest first.
const COHORT_GRADUATES_SQL = `
  SELECT user_id, completed_at, started_at, cohort, name, sector
    FROM (
      SELECT g.user_id, g.graduated_at AS completed_at, u.spinout_lab_started_at AS started_at,
             usf.spinout_lab_cohort AS cohort, p.sector,
             COALESCE(NULLIF(p.name, ''),
                      NULLIF((SELECT a.company_name FROM spinout_applications a
                               WHERE a.user_id = g.user_id ORDER BY a.id DESC LIMIT 1), '')) AS name
        FROM spinout_lab_graduates g
        JOIN users u ON u.id = g.user_id
        LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
        LEFT JOIN spinout_lab_enrollments le ON le.id = (SELECT MAX(x.id) FROM spinout_lab_enrollments x WHERE x.user_id = g.user_id)
        LEFT JOIN projects p ON p.id = le.project_id AND p.deleted_at IS NULL
       WHERE datetime(g.graduated_at) >= datetime('now', '-45 days')
    )
   WHERE name IS NOT NULL
   ORDER BY completed_at DESC, user_id ASC
   LIMIT ?`;

const parseTs = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const ms = Date.parse(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : null;
};

export async function cohortBoard(env: Env, nowMs = Date.now()): Promise<ReportRead<CohortMember[]>> {
  let activeRows: CohortActiveRow[];
  let gradRows: CohortGradRow[];
  try {
    activeRows = (await env.DB.prepare(COHORT_ACTIVE_SQL).bind(COHORT_ACTIVE_SHOWN).all<CohortActiveRow>()).results ?? [];
    // At most COHORT_ACTIVE_SHOWN of these can be skipped as already shown above.
    gradRows = (await env.DB.prepare(COHORT_GRADUATES_SQL).bind(COHORT_GRADUATES_SHOWN + COHORT_ACTIVE_SHOWN)
      .all<CohortGradRow>()).results ?? [];
  } catch (e) {
    return { ok: false, what: 'The Lab’s cohort', raw: e };
  }
  const members: CohortMember[] = [];
  const shown = new Set<number>();
  for (const r of activeRows) {
    shown.add(r.user_id);
    members.push({
      name: r.name,
      sector: r.sector ?? null,
      cohort: r.cohort ?? null,
      status: 'active',
      week: Math.max(1, Math.min(4, Number(r.week ?? 1) || 1)),
      day: Math.min(SPRINT_DAYS, daysSince(r.started_at, nowMs) + 1),
      started_at: r.started_at ?? null,
    });
  }
  // Recent graduates fill the final ("Incorporated") column, skipping anyone shown above.
  let graduates = 0;
  for (const r of gradRows) {
    if (shown.has(r.user_id)) continue;
    const startMs = parseTs(r.started_at);
    const doneMs = parseTs(r.completed_at);
    members.push({
      name: r.name,
      sector: r.sector ?? null,
      cohort: r.cohort ?? null,
      status: 'graduated',
      week: 5,
      day: startMs !== null && doneMs !== null && doneMs >= startMs
        ? Math.max(1, Math.floor((doneMs - startMs) / 86_400_000) + 1)
        : null,
      started_at: r.started_at ?? null,
    });
    if (++graduates >= COHORT_GRADUATES_SHOWN) break;
  }
  return { ok: true, value: members };
}
