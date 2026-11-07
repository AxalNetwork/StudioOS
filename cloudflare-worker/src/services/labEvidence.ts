/**
 * D4657 (#4657) — what proves each Spin-Out Lab milestone.
 *
 * WHY. Milestones were whatever the browser said: a page called
 * `POST /spinout-lab/milestone` after its own action, the server recorded the
 * key, and credits were paid on it. Nothing checked that the interview, OKR or
 * cap table existed. Each key now names the saved row that proves it, and the
 * one recorder (`services/labProgress.ts`) and the reconciler both ask this
 * module, so the producing modules, the Lab and the rewards share one
 * completion rule.
 *
 * OWNERSHIP. Project work counts only from a project the founder owns
 * (`projects.founder_id = users.founder_id`, not deleted). When the founder's
 * enrollment names its project (#4659), only that project counts; until then
 * any owned project may supply it, and the one that did is recorded with the
 * milestone (`evidence_project_id`). Person-level work (bookings, profiling,
 * co-founder requests, the paid incorporation order) is the user's own.
 *
 * TWO KEYS SAVE NOTHING. `market_research_shared` and
 * `revenue_summary_generated` copy text to the clipboard. They are recorded as
 * 'attested' only when the work they summarise is saved (market sizing, and a
 * revenue proof), so a click on an empty page proves nothing.
 *
 * A check that cannot run (a table missing on an unmigrated database, a read
 * error) throws; the caller answers "unavailable", never "done" and never "not
 * done". Each SQL string is a constant: nothing from a request is spliced in,
 * and every value is bound.
 */
import type { Env } from '../types';

export type Evidence = {
  kind: 'saved_work' | 'paid_order' | 'attested';
  /** `<table>:<id>` or a count met, e.g. `discovery_interviews:project:12:n=3`. */
  ref: string;
  project_id: number | null;
};

export type EvidenceContext = {
  env: Env;
  userId: number;
  /** The enrollment's project (#4659); null lets any owned project count. */
  enrollmentProjectId: number | null;
};

type Check = (ctx: EvidenceContext) => Promise<Evidence | null>;

/** Projects this user owns, narrowed to the enrollment's project when it names one. ?1 user, ?2 enrollment project. */
const OWNED =
  'SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id '
  + 'WHERE u.id = ?1 AND u.founder_id IS NOT NULL AND p.deleted_at IS NULL AND (?2 IS NULL OR p.id = ?2)';

const first = async (ctx: EvidenceContext, sql: string, extra: unknown[] = []) =>
  ctx.env.DB.prepare(sql).bind(ctx.userId, ctx.enrollmentProjectId, ...extra).first<Record<string, unknown>>();

/** A row in `table` for an owned project. `where` is a constant predicate on alias t. */
function projectRow(table: string, where: string): (ctx: EvidenceContext) => Promise<Evidence | null> {
  const sql = 'SELECT t.id AS id, t.project_id AS project_id FROM ' + table + ' t WHERE t.project_id IN (' + OWNED + ')'
    + (where ? ' AND ' + where : '') + ' ORDER BY t.id LIMIT 1';
  return async (ctx) => {
    const r = await first(ctx, sql);
    return r ? { kind: 'saved_work', ref: `${table}:${r.id}`, project_id: Number(r.project_id) } : null;
  };
}

/** At least ?3 rows in `table` for one owned project. */
function projectCount(table: string, where: string, n: number): (ctx: EvidenceContext) => Promise<Evidence | null> {
  const sql = 'SELECT t.project_id AS project_id, COUNT(*) AS n FROM ' + table + ' t WHERE t.project_id IN (' + OWNED + ')'
    + (where ? ' AND ' + where : '') + ' GROUP BY t.project_id HAVING COUNT(*) >= ?3 ORDER BY t.project_id LIMIT 1';
  return async (ctx) => {
    const r = await first(ctx, sql, [n]);
    return r ? { kind: 'saved_work', ref: `${table}:project:${r.project_id}:n=${r.n}`, project_id: Number(r.project_id) } : null;
  };
}

/** An owned project whose own columns satisfy `where` (alias p). */
function projectFields(label: string, where: string): (ctx: EvidenceContext) => Promise<Evidence | null> {
  const sql = 'SELECT p.id AS id FROM projects p WHERE p.id IN (' + OWNED + ') AND ' + where + ' ORDER BY p.id LIMIT 1';
  return async (ctx) => {
    const r = await first(ctx, sql);
    return r ? { kind: 'saved_work', ref: `projects:${r.id}:${label}`, project_id: Number(r.id) } : null;
  };
}

/** A row in `table` the user owns personally. ?1 user (?2 unused, kept so every check binds alike). */
function userRow(table: string, userCol: string, where: string): (ctx: EvidenceContext) => Promise<Evidence | null> {
  const sql = 'SELECT t.id AS id FROM ' + table + ' t WHERE t.' + userCol + ' = ?1 AND (?2 IS NULL OR ?2 IS NOT NULL)'
    + (where ? ' AND ' + where : '') + ' ORDER BY t.id LIMIT 1';
  return async (ctx) => {
    const r = await first(ctx, sql);
    return r ? { kind: 'saved_work', ref: `${table}:${r.id}`, project_id: null } : null;
  };
}

const anyOf = (...checks: Check[]): Check => async (ctx) => {
  for (const c of checks) { const e = await c(ctx); if (e) return e; }
  return null;
};

/** All must hold; the ref lists each part. Used by the data room. */
const allOf = (label: string, ...checks: Check[]): Check => async (ctx) => {
  const refs: string[] = [];
  let project: number | null = null;
  for (const c of checks) {
    const e = await c(ctx);
    if (!e) return null;
    refs.push(e.ref);
    if (project === null && e.project_id !== null) project = e.project_id;
  }
  return { kind: 'saved_work', ref: `${label}[${refs.length}]`, project_id: project };
};

/** Recorded as attested: the share/summary step itself saves nothing, its source must. */
const attestedOver = (check: Check): Check => async (ctx) => {
  const e = await check(ctx);
  return e ? { kind: 'attested', ref: `attested_over:${e.ref}`, project_id: e.project_id } : null;
};

const interviews = (n: number) => projectCount('discovery_interviews', '', n);
const okrs = (n: number) => projectCount('roadmap_okrs', '', n);
const marketSizing = projectFields('market_sizing', 'p.tam IS NOT NULL AND p.sam IS NOT NULL');
const revenueProof = anyOf(
  projectFields('revenue_proof',
    "(p.revenue IS NOT NULL OR p.mrr IS NOT NULL OR p.paying_customers IS NOT NULL OR p.paid_pilot_status IS NOT NULL OR TRIM(COALESCE(p.growth_signals, '')) <> '')"),
  projectRow('project_metrics', "t.source = 'stripe'"),
);
const revenueAboveZero = projectFields('revenue_positive',
  '(COALESCE(p.revenue, 0) > 0 OR COALESCE(p.mrr, 0) > 0 OR COALESCE(p.paying_customers, 0) > 0)');
const useOfFunds = projectFields('use_of_funds', "TRIM(COALESCE(p.use_of_funds, '')) LIKE '[%' AND COALESCE(p.funding_needed, 0) > 0");
const capTableBase = projectRow('cap_table_scenarios', 'COALESCE(t.is_variant, 0) = 0');
const scoringRun = projectRow('score_snapshots', 't.total_score IS NOT NULL');
const pitchDeck = projectRow('pitch_decks', 'COALESCE(t.is_current, 0) = 1');
const paidIncorporation = userRow('incorporations', 'user_id',
  "t.status IN ('paid', 'packet_processing', 'packet_ready', 'filed')");

/** The latest scored snapshot has at least five of its six areas at 70% of their maximum. */
const CONFIDENCE_SQL =
  'SELECT s.id AS id, s.project_id AS project_id FROM score_snapshots s WHERE s.id = ('
  + 'SELECT t.id FROM score_snapshots t WHERE t.project_id IN (' + OWNED + ') AND t.total_score IS NOT NULL ORDER BY t.id DESC LIMIT 1) AND ('
  + '(COALESCE(s.market_total, 0) >= 17.5) + (COALESCE(s.team_total, 0) >= 14) + (COALESCE(s.product_total, 0) >= 10.5)'
  + ' + (COALESCE(s.capital_total, 0) >= 10.5) + (COALESCE(s.fit_total, 0) >= 10.5) + (COALESCE(s.distribution_total, 0) >= 7)) >= 5';

/** Every assessed skill, values and a played assessment (the profiling page's own rule, 75% of skills). */
const PROFILING_SQL =
  'SELECT a.id AS id FROM assessment_results a WHERE a.user_id = ?1 AND (?2 IS NULL OR ?2 IS NOT NULL)'
  + ' AND EXISTS (SELECT 1 FROM user_values v WHERE v.user_id = ?1)'
  + ' AND (SELECT COUNT(*) FROM user_skills us WHERE us.user_id = ?1) * 4'
  + '     >= (SELECT COUNT(*) FROM skills sk WHERE COALESCE(sk.is_active, 1) = 1) * 3'
  + ' ORDER BY a.id LIMIT 1';

const sqlCheck = (sql: string, table: string, projectCol: boolean): Check => async (ctx) => {
  const r = await first(ctx, sql);
  return r ? { kind: 'saved_work', ref: `${table}:${r.id}`, project_id: projectCol ? Number(r.project_id) : null } : null;
};

/**
 * The completion rule per milestone key. A key absent here cannot be recorded
 * at all (`VALID_MILESTONE_KEYS` and this map are pinned equal by the tests).
 */
export const MILESTONE_EVIDENCE: Record<string, Check> = {
  project_created: projectFields('created', "TRIM(COALESCE(p.name, '')) <> '' AND p.name <> '(unnamed project)'"),
  customer_interview_logged_1: interviews(1),
  customer_interview_logged_2: interviews(2),
  customer_interview_logged_3: interviews(3),
  customer_interview_logged_4: interviews(4),
  customer_interview_logged_5: interviews(5),
  okrs_created: okrs(3),
  brand_basics_filled: projectRow('landing_pages',
    "t.archived_at IS NULL AND TRIM(COALESCE(t.name, '')) <> '' AND TRIM(COALESCE(t.tagline, '')) <> ''"),
  pitch_deck_drafted: pitchDeck,
  scoring_run_completed: scoringRun,
  scoring_confidence_70: sqlCheck(CONFIDENCE_SQL, 'score_snapshots', true),
  advisor_meeting_booked: userRow('advisor_bookings', 'founder_user_id', "COALESCE(t.status, '') <> 'cancelled'"),
  cofounder_request_sent: userRow('cofounder_interests', 'from_user_id', "COALESCE(t.status, '') <> 'withdrawn'"),
  incorporation_completed: async (ctx) => {
    const e = await paidIncorporation(ctx);
    return e ? { ...e, kind: 'paid_order' } : null;
  },
  market_sizing_completed: marketSizing,
  profiling_completed: sqlCheck(PROFILING_SQL, 'assessment_results', false),
  icp_defined: allOf('icp_defined',
    projectFields('icp_confirmed', "json_extract(p.icp_definition_meta, '$.status') = 'confirmed'"), interviews(3)),
  market_research_shared: attestedOver(marketSizing),
  mvp_scoped: projectFields('mvp_scoped',
    "(SELECT COUNT(*) FROM mvp_features f WHERE f.project_id = p.id) >= 3"
    + " AND EXISTS (SELECT 1 FROM mvp_features f WHERE f.project_id = p.id AND f.added_value = 'High')"
    + " AND EXISTS (SELECT 1 FROM mvp_features f WHERE f.project_id = p.id AND f.added_value = 'Low')"),
  landing_page_created: projectRow('landing_pages', 't.archived_at IS NULL'),
  discovery_followups_mapped: projectCount('waitlist_signups', 't.followed_up_at IS NOT NULL', 3),
  office_hours_booked: anyOf(
    userRow('partner_bookings', 'founder_user_id', "COALESCE(t.status, '') <> 'cancelled'"),
    userRow('advisor_bookings', 'founder_user_id', "COALESCE(t.status, '') <> 'cancelled'"),
  ),
  revenue_proof_added: revenueProof,
  revenue_summary_generated: attestedOver(revenueProof),
  ein_received: projectRow('company_eins', ''),
  founder_stock_issued: projectRow('cap_table_scenarios',
    "COALESCE(t.is_variant, 0) = 0 AND EXISTS (SELECT 1 FROM json_each(t.inputs_json, '$.founders') f"
    + " WHERE CAST(json_extract(f.value, '$.shares') AS REAL) > 0)"),
  captable_locked: projectRow('cap_table_scenarios',
    "COALESCE(t.is_variant, 0) = 0 AND COALESCE(json_array_length(t.inputs_json, '$.rounds'), 0) > 0"),
  section83b_filed: projectRow('section_83b_trackers',
    't.user_id = ?1 AND t.mailed_at IS NOT NULL AND t.filing_method IS NOT NULL'),
  cofounder_agreement_signed: projectRow('documents', "t.template_name = 'cofounder_agreement' AND t.status = 'signed'"),
  fundraise_ask_locked: projectRow('raise_rounds', "t.status = 'active' AND COALESCE(t.target_amount, 0) > 0"),
  use_of_funds_filled: useOfFunds,
  investor_intros_secured: projectCount('raise_prospects', "t.stage IN ('intro', 'meeting', 'diligence', 'committed')", 3),
  data_room_built: allOf('data_room',
    pitchDeck, useOfFunds, capTableBase, projectRow('score_snapshots', ''), interviews(3), okrs(1), revenueAboveZero,
    paidIncorporation),
};

/** The evidence for `key`, or null when the saved work is not there. Throws when the check cannot run. */
export async function evidenceFor(ctx: EvidenceContext, key: string): Promise<Evidence | null> {
  const check = MILESTONE_EVIDENCE[key];
  if (!check) return null;
  return check(ctx);
}
