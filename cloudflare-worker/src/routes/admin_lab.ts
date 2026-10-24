/** D944 (#2749): read-only Lab aggregates and the server-filtered application pool.
 * Mounted by admin_cohort.ts at /api/admin/cohort. No schema bootstrap or writes.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { wallClockToUtcMs, COHORT_TZ, sqliteUtcToMs } from '../services/cohortTiming';
import { monthLabel } from '../services/cohortApplications';
import { ORIGINS, TTO_STATUSES, parseStoredAnswers } from '../services/applicationLifecycle';

const r = new Hono<{ Bindings: Env }>();
type Row = Record<string, any>;
type Read = { available: true; rows: Row[] } | { available: false; reason: string };
const missing = (reason: string) => ({ recorded: false as const, reason });
const unreadable = (reason: string) => ({ available: false as const, reason });
const value = (n: number) => ({ available: true as const, value: n });
const INTERVIEW_REASON = 'Interview scheduling is recorded, but attendance or completion is not. A scheduled time does not prove an interview happened.';
async function read(db: D1Database, sql: string, reason: string, binds: any[] = []): Promise<Read> {
  try {
    const result: { success?: boolean; results?: Row[] } = await db.prepare(sql).bind(...binds).all<Row>();
    if (result.success === false || !Array.isArray(result.results)) return unreadable(reason);
    return { available: true, rows: result.results };
  }
  catch { return unreadable(reason); }
}
function key(c: Row) { return `${c.year}-${String(c.month).padStart(2, '0')}`; }
function validCohort(s: string | undefined) { return !s || /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }

/** Monday-based ET civil weeks, not fixed 168-hour UTC windows across DST. */
export function labWeeks(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: COHORT_TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const civil = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  civil.setUTCDate(civil.getUTCDate() - (civil.getUTCDay() + 6) % 7);
  const at = (days: number) => {
    const d = new Date(civil); d.setUTCDate(d.getUTCDate() + days);
    return new Date(wallClockToUtcMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())).toISOString();
  };
  return Array.from({ length: 12 }, (_, i) => ({ start: at((i - 11) * 7), end: at((i - 10) * 7), partial: i === 11 }));
}

r.get('/overview', async (c) => {
  await requireAdmin(c);
  const selected = c.req.query('cohort');
  if (!validCohort(selected)) return c.json({ error: 'cohort must be YYYY-MM' }, 400);
  const now = new Date().toISOString();
  const weeks = labWeeks(Date.parse(now));
  // Independent reads: the absent/failing source affects only its metrics.
  const [cycles, pools, starts, interviews, outcomes, windows, incorporations, certificates, weekly] = await Promise.all([
    read(c.env.DB, `SELECT id, year, month, status, app_status, start_at, end_at, applications_open_at, applications_close_at
      FROM cohort_cycles ORDER BY year DESC, month DESC`, 'Cohorts could not be read.'),
    read(c.env.DB, `SELECT cohort_cycle_id, COUNT(*) AS applied,
      SUM(CASE WHEN status IN ('approved','activated') THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'waitlisted' THEN 1 ELSE 0 END) AS waitlisted,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS declined,
      SUM(CASE WHEN status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn,
      SUM(CASE WHEN status = 'rolled_forward' THEN 1 ELSE 0 END) AS carried_forward,
      SUM(CASE WHEN rolled_from_cycle_id IS NOT NULL THEN 1 ELSE 0 END) AS carried_in
      FROM cohort_applicants GROUP BY cohort_cycle_id`, 'The cohort application pool could not be read.'),
    read(c.env.DB, `WITH candidates (cohort_cycle_id, user_id) AS (
      SELECT cohort_cycle_id, user_id FROM cohort_applicants WHERE status = 'activated'
      UNION SELECT cy.id, u.id FROM cohort_cycles cy JOIN users u
        ON datetime(u.spinout_lab_started_at) >= datetime(cy.start_at)
        AND datetime(u.spinout_lab_started_at) < datetime(cy.end_at)
      ) SELECT cohort_cycle_id, COUNT(DISTINCT user_id) AS started FROM candidates GROUP BY cohort_cycle_id`,
      'Recorded cohort starts could not be read.'),
    read(c.env.DB, `SELECT ca.cohort_cycle_id,
      SUM(CASE WHEN i.status = 'scheduled' THEN 1 ELSE 0 END) AS interview_set,
      SUM(CASE WHEN COALESCE(i.status, '') != 'scheduled' THEN 1 ELSE 0 END) AS waiting
      FROM cohort_applicants ca LEFT JOIN spinout_application_interviews i ON i.application_id = ca.application_id
        AND i.id = (SELECT MAX(latest.id) FROM spinout_application_interviews latest WHERE latest.application_id = ca.application_id)
      WHERE ca.status = 'pending' GROUP BY ca.cohort_cycle_id`, 'Interview scheduling could not be read.'),
    read(c.env.DB, `SELECT s.cohort_cycle_id, s.week_number, s.status, COUNT(DISTINCT s.user_id) AS n,
      (SELECT COUNT(DISTINCT g.user_id) FROM company_week_status g WHERE g.cohort_cycle_id = s.cohort_cycle_id AND g.status = 'grace') AS in_grace
      FROM company_week_status s GROUP BY s.cohort_cycle_id, s.week_number, s.status`, 'Weekly outcomes could not be read.'),
    read(c.env.DB, `SELECT cohort_cycle_id, week_number, unlock_at, deadline_at FROM week_windows ORDER BY week_number`, 'Week windows could not be read.'),
    read(c.env.DB, `WITH candidates (cohort_cycle_id, user_id) AS (
      SELECT cohort_cycle_id, user_id FROM cohort_applicants WHERE status = 'activated'
      UNION SELECT cy.id, u.id FROM cohort_cycles cy JOIN users u
        ON datetime(u.spinout_lab_started_at) >= datetime(cy.start_at)
        AND datetime(u.spinout_lab_started_at) < datetime(cy.end_at)
      ) SELECT candidate.cohort_cycle_id, COUNT(DISTINCT m.user_id) AS incorporated,
      COUNT(DISTINCT CASE WHEN (SELECT COUNT(DISTINCT other.cohort_cycle_id) FROM candidates other
        WHERE other.user_id = candidate.user_id) > 1 THEN m.user_id END) AS ambiguous
      FROM candidates candidate JOIN cohort_cycles cy ON cy.id = candidate.cohort_cycle_id
      LEFT JOIN users u ON u.id = candidate.user_id
      JOIN spinout_lab_milestones m ON m.user_id = candidate.user_id
      WHERE m.milestone_key = 'incorporation_completed' AND datetime(m.completed_at) >=
        CASE WHEN datetime(u.spinout_lab_started_at) >= datetime(cy.start_at)
          AND datetime(u.spinout_lab_started_at) < datetime(cy.end_at)
          THEN datetime(u.spinout_lab_started_at) ELSE datetime(cy.start_at) END
      GROUP BY candidate.cohort_cycle_id`, 'Incorporation milestones could not be read.'),
    read(c.env.DB, `SELECT public_cohort, COUNT(DISTINCT user_id) AS n FROM spinout_certificates
      WHERE status = 'issued' GROUP BY public_cohort`, 'The certificate registry could not be read.'),
    read(c.env.DB, `WITH weeks (idx, starts_at, ends_at) AS (VALUES
      (0,?,?),(1,?,?),(2,?,?),(3,?,?),(4,?,?),(5,?,?),(6,?,?),(7,?,?),(8,?,?),(9,?,?),(10,?,?),(11,?,?))
      SELECT w.idx, COUNT(a.id) AS applied FROM weeks w LEFT JOIN spinout_applications a
        ON datetime(a.created_at) >= datetime(w.starts_at) AND datetime(a.created_at) < datetime(w.ends_at)
        AND datetime(a.created_at) <= datetime(?) GROUP BY w.idx ORDER BY w.idx`,
      'Weekly application submissions could not be read.', [...weeks.flatMap(w => [w.start, w.end]), now]),
  ]);
  let rows: Row[] = [];
  if (cycles.available) rows = cycles.rows.map(cycle => {
    const pool = pools.available ? pools.rows.find(p => p.cohort_cycle_id === cycle.id) : null;
    const iv = interviews.available ? interviews.rows.find(p => p.cohort_cycle_id === cycle.id) : null;
    const ws = outcomes.available ? outcomes.rows.filter(p => p.cohort_cycle_id === cycle.id) : [];
    const inc = incorporations.available ? incorporations.rows.find(p => p.cohort_cycle_id === cycle.id) : null;
    const cs = certificates.available ? certificates.rows.filter(p => p.public_cohort === `${monthLabel(cycle.year, cycle.month)} Cohort` || p.public_cohort === key(cycle)) : [];
    const metric = (name: string) => pools.available ? value(Number(pool?.[name] || 0)) : pools;
    return {
      ...cycle, cohort: key(cycle),
      applied: metric('applied'), undecided: metric('pending'), approved: metric('approved'), waitlisted: metric('waitlisted'),
      declined: metric('declined'), withdrawn: metric('withdrawn'), carried_forward: metric('carried_forward'),
      carried_in: metric('carried_in'), started: starts.available ? value(Number(starts.rows.find(p => p.cohort_cycle_id === cycle.id)?.started || 0)) : starts,
      interview_set: interviews.available ? value(Number(iv?.interview_set || 0)) : interviews,
      interviewed: missing(INTERVIEW_REASON),
      waiting: interviews.available ? value(Number(iv?.waiting || 0)) : interviews,
      in_grace: outcomes.available ? value(Number(ws[0]?.in_grace || 0)) : outcomes,
      weeks: !outcomes.available ? outcomes : !windows.available ? windows : {
        available: true, items: windows.rows.filter(w => w.cohort_cycle_id === cycle.id).map(w => ({
          ...w, state: sqliteUtcToMs(w.unlock_at) === null ? 'unreadable' : (sqliteUtcToMs(w.unlock_at) as number) > Date.parse(now) ? 'not_started' : 'opened',
          passed: Number(ws.find(s => s.week_number === w.week_number && s.status === 'passed')?.n || 0),
          failed: Number(ws.find(s => s.week_number === w.week_number && s.status === 'failed')?.n || 0),
          in_grace: Number(ws.find(s => s.week_number === w.week_number && s.status === 'grace')?.n || 0),
          pending: Number(ws.find(s => s.week_number === w.week_number && s.status === 'pending')?.n || 0),
          reached: missing('Week unlock does not persist a per-founder reached-week ledger. Outcome rows are not a reached-week denominator.'),
        })),
      },
      incorporated: !incorporations.available ? incorporations : Number(inc?.ambiguous || 0) > 0
        ? missing('A graduate has recorded starts or activations in multiple cohorts; the incorporation milestone has no cohort key, so attribution is ambiguous.')
        : value(Number(inc?.incorporated || 0)),
      certificates_issued: certificates.available ? value(cs.reduce((n, s) => n + Number(s.n), 0)) : certificates,
    };
  });
  const chosen = selected ? rows.find(row => row.cohort === selected) : rows.find(row => (sqliteUtcToMs(row.start_at) ?? Infinity) <= Date.parse(now)) || rows.at(-1);
  const funnel = !cycles.available ? cycles : !chosen ? unreadable('The selected cohort was not found.') : {
    available: true, cohort: chosen.cohort,
    steps: { applied: chosen.applied, interviewed: chosen.interviewed, approved: chosen.approved,
      started_week_1: chosen.started, passed_week_4: !outcomes.available ? outcomes : value(Number(outcomes.rows.find(s => s.cohort_cycle_id === chosen.id && s.week_number === 4 && s.status === 'passed')?.n || 0)),
      incorporated: chosen.incorporated, certificate_issued: chosen.certificates_issued },
    interview_is_optional: true,
  };
  return c.json({ as_of: now, timezone: COHORT_TZ, blocks: {
    cohorts: cycles.available ? { available: true, items: rows } : cycles,
    applications_per_week: weekly.available ? { available: true, items: weeks.map((w, i) => ({ ...w, applied: Number(weekly.rows.find(x => x.idx === i)?.applied || 0) })) } : weekly,
    funnel,
  }, definitions: {
    applied: 'Application assignments in each cohort pool, including carried-in applications. Weekly submissions count application records once, not assignments or drafts.',
    approved: 'Approved and activated pool assignments; historical approvals subsequently rolled forward are not retained as approvals.',
    started: 'Distinct members with a recorded activated pool assignment or a recorded start timestamp in the cohort window. Includes graduates, legacy admits without applications and retained historical activation records; overlap is counted once.',
    incorporated: 'incorporation_completed milestones after the recorded start (or cohort start for a historical activation), associated through the recorded start/activation candidates. Multiple candidate cohorts make attribution ambiguous. Not application declarations or the global incorporated flag.',
    certificates_issued: 'Currently issued certificates whose frozen public_cohort matches YYYY-MM or the canonical Month Year Cohort label; revoked or unattributed certificates are not counted.',
    waiting: 'Pending pool assignments without a latest scheduled interview; scheduled does not mean interviewed.',
    in_grace: 'Distinct members with a recorded grace outcome; expired grace remains grace until the scheduler decides it.',
  } });
});

r.get('/applications/list', async (c) => {
  await requireAdmin(c);
  const q = c.req.query();
  const cohort = q.cohort || null;
  if (!validCohort(q.cohort)) return c.json({ error: 'cohort must be YYYY-MM' }, 400);
  const allowed = (name: string, choices: readonly string[]) => !q[name] || choices.includes(q[name]);
  if (!allowed('status', ['waiting','interview_set','approved','waitlisted','declined','withdrawn','carried_forward','started']) ||
      !allowed('origin', [...ORIGINS, 'unknown']) || !allowed('tech_transfer', [...TTO_STATUSES, 'unknown']) ||
      !allowed('incorporated', ['yes','no','unknown']) || !allowed('interview', ['scheduled','cancelled','none']) ||
      !allowed('carried_forward', ['yes','no']) || !allowed('sort', ['waiting_longest','newest','company','team_size']) ||
      (q.stage?.length || 0) > 80 || (q.q?.length || 0) > 200) {
    return c.json({ error: 'Invalid application filter or sort' }, 400);
  }
  if ((q.limit && !/^\d+$/.test(q.limit)) || (q.offset && !/^\d+$/.test(q.offset))) return c.json({ error: 'Invalid pagination' }, 400);
  const limit = Math.max(1, Math.min(100, Number(q.limit || 25)));
  const offset = Number(q.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) return c.json({ error: 'Invalid offset' }, 400);
  const sort = q.sort || 'waiting_longest';
  const filter = (name: string) => q[name] || null;
  // instr treats %, _ and quote characters as literal search text. Every
  // request value, including the sort selector, is bound rather than SQL.
  const result = await read(c.env.DB, `WITH facts AS (
    SELECT ca.id, ca.application_id, ca.user_id, ca.cohort_cycle_id, ca.status, ca.rolled_from_cycle_id,
      ca.created_at AS pool_created_at, ca.decided_at, ca.decision_reason,
      a.created_at AS applied_at, a.company_name, a.idea, a.stage, a.incorporated, a.jurisdiction, a.answers_json,
      u.name, u.email, u.role, printf('%04d-%02d', cy.year, cy.month) AS cohort,
      i.id AS interview_id, i.status AS interview_status, i.scheduled_at AS interview_at,
      i.duration_min AS interview_duration_min, i.location AS interview_location,
      CASE WHEN json_valid(a.answers_json) THEN a.answers_json ELSE '{}' END AS safe_answers
    FROM cohort_applicants ca
    JOIN cohort_cycles cy ON cy.id = ca.cohort_cycle_id
    LEFT JOIN users u ON u.id = ca.user_id
    LEFT JOIN spinout_applications a ON a.id = ca.application_id
    LEFT JOIN spinout_application_interviews i ON i.application_id = ca.application_id
      AND i.id = (SELECT MAX(latest.id) FROM spinout_application_interviews latest WHERE latest.application_id = ca.application_id)
  ), normalized AS (
    SELECT facts.*,
      CASE WHEN json_extract(safe_answers, '$.origin') IN ('university','corporate','independent')
        THEN json_extract(safe_answers, '$.origin') END AS origin,
      CASE WHEN json_extract(safe_answers, '$.tto_status') IN ('not_disclosed','disclosed','negotiating','signed','not_applicable')
        THEN json_extract(safe_answers, '$.tto_status') END AS tech_transfer,
      CASE WHEN json_type(safe_answers, '$.institution') = 'text' THEN NULLIF(trim(json_extract(safe_answers, '$.institution')), '') END AS institution,
      CASE WHEN json_type(safe_answers, '$.team_size') = 'integer' AND json_extract(safe_answers, '$.team_size') BETWEEN 1 AND 50
        THEN json_extract(safe_answers, '$.team_size') END AS team_size,
      CASE WHEN status IN ('pending','waitlisted') THEN COALESCE(decided_at, pool_created_at) END AS waiting_since,
      CASE WHEN status = 'pending' AND interview_status = 'scheduled' THEN 'interview_set'
        WHEN status = 'pending' THEN 'waiting' WHEN status = 'rejected' THEN 'declined'
        WHEN status = 'rolled_forward' THEN 'carried_forward' WHEN status = 'activated' THEN 'started'
        ELSE status END AS display_status
    FROM facts
  ), filtered AS (
    SELECT * FROM normalized WHERE (? IS NULL OR cohort = ?)
      AND (? IS NULL OR display_status = ?)
      AND (? IS NULL OR origin = ? OR (? = 'unknown' AND origin IS NULL))
      AND (? IS NULL OR tech_transfer = ? OR (? = 'unknown' AND tech_transfer IS NULL))
      AND (? IS NULL OR stage = ?)
      AND (? IS NULL OR incorporated = ? OR (? = 'unknown' AND (incorporated IS NULL OR incorporated NOT IN ('yes','no'))))
      AND (? IS NULL OR interview_status = ? OR (? = 'none' AND interview_id IS NULL))
      AND (? IS NULL OR (? = 'yes' AND rolled_from_cycle_id IS NOT NULL) OR (? = 'no' AND rolled_from_cycle_id IS NULL))
      AND (? IS NULL OR instr(lower(COALESCE(company_name,'') || ' ' || COALESCE(name,'') || ' ' || COALESCE(email,'') || ' ' || COALESCE(institution,'') || ' ' || COALESCE(idea,'')), lower(?)) > 0)
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN ? = 'waiting_longest' THEN CASE WHEN waiting_since IS NULL THEN 1 ELSE 0 END END,
      CASE WHEN ? = 'waiting_longest' THEN datetime(waiting_since) END ASC,
      CASE WHEN ? = 'newest' THEN datetime(applied_at) END DESC,
      CASE WHEN ? = 'company' THEN CASE WHEN company_name IS NULL THEN 1 ELSE 0 END END,
      CASE WHEN ? = 'company' THEN lower(company_name) END ASC,
      CASE WHEN ? = 'team_size' THEN team_size END DESC, id DESC LIMIT ? OFFSET ?
  ) SELECT (SELECT COUNT(*) FROM filtered) AS total,
    json_object('id',id,'application_id',application_id,'user_id',user_id,
      'cohort_cycle_id',cohort_cycle_id,'cohort',cohort,'status',status,'display_status',display_status,
      'rolled_from_cycle_id',rolled_from_cycle_id,'pool_created_at',pool_created_at,'decided_at',decided_at,
      'decision_reason',decision_reason,'applied_at',applied_at,'company_name',company_name,'idea',idea,
      'stage',stage,'incorporated',incorporated,'jurisdiction',jurisdiction,'name',name,'email',email,'role',role,
      'answers_json',answers_json,'origin',origin,'tech_transfer',tech_transfer,'institution',institution,
      'team_size',team_size,'waiting_since',waiting_since,'interview_id',interview_id,'interview_status',interview_status,
      'interview_at',interview_at,'interview_duration_min',interview_duration_min,'interview_location',interview_location) AS item_json FROM page
    UNION ALL SELECT (SELECT COUNT(*) FROM filtered) AS total, NULL AS item_json`,
    'Applications could not be read. The total and filtered page are unknown.', [
      cohort, cohort, filter('status'), filter('status'),
      filter('origin'), filter('origin'), filter('origin'),
      filter('tech_transfer'), filter('tech_transfer'), filter('tech_transfer'),
      filter('stage'), filter('stage'), filter('incorporated'), filter('incorporated'), filter('incorporated'),
      filter('interview'), filter('interview'), filter('interview'),
      filter('carried_forward'), filter('carried_forward'), filter('carried_forward'), filter('q'), filter('q'),
      sort, sort, sort, sort, sort, sort, limit, offset,
    ]);
  if (!result.available) return c.json({ ...result, items: null, total: null, limit, offset });
  const row = result.rows[0];
  const items = result.rows.filter(r => r.item_json !== null).map(r => {
    const { answers_json, ...item } = JSON.parse(r.item_json) as Row;
    const answers = parseStoredAnswers(answers_json);
    return { ...item, answers, answers_recorded: answers !== null,
      answers_status: !answers_json ? 'not_recorded' : answers === null ? 'unreadable' : 'ready' };
  });
  return c.json({ available: true, as_of: new Date().toISOString(), timezone: COHORT_TZ, items, total: Number(row.total), limit, offset, sort,
    filters: { cohort, status: filter('status'), origin: filter('origin'), tech_transfer: filter('tech_transfer'),
      stage: filter('stage'), incorporated: filter('incorporated'), interview: filter('interview'),
      carried_forward: filter('carried_forward'), q: filter('q') },
    definitions: { waiting_since: 'Last recorded pool decision, or assignment creation (resets on carry-in).',
      incorporated: 'The application self-declaration, not a verified company formation.',
      interview: 'Latest scheduling record. There is no interview-completion store.',
      team_size: 'Recorded integer team sizes, descending; unknown sizes follow known sizes.' },
  });
});

export default r;
