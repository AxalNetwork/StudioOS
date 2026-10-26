/**
 * D1255 (#3278) — one collector per scope. Each reads the venture's own
 * stores with bound, static statements (`STATEMENTS`, scanned by the tests)
 * and returns `InputFacts` for the engine. Nothing here scores or writes.
 *
 * PERSONAL INPUTS ARE AGGREGATED HERE. Skills, platform actions, commitment,
 * experience, archetypes, runway and burn leave the collector as one count
 * or one figure for the venture, never as a row per person.
 *
 * NEVER AN INPUT (#2428 bias guard 1): no statement selects a name, email,
 * photo, gender, age or date of birth, nationality, residence, ethnicity,
 * religion, health, school or employer, and `kyc_data` is never read.
 * Experience is counted with `json_array_length` so its text never leaves the
 * database. `model.ts` `NEVER_READ` lists the words the test refuses.
 *
 * Callers gate the venture before calling a collector.
 */
import type { Env } from '../../types';
import { isIpAssignmentStep } from '../../integrations/providers/github/company';
import { DILIGENCE_CHECKLIST } from '../raiseCycle';
import { mercuryRunway } from '../raiseEvidence';
import { latestPivotOrStopDay } from '../verdict';
import { parseUseOfFundsValue } from '../../util/useOfFunds';
import { GRADES, type GradeLabel, type ScopeKey } from './model';
import { unsourced, type InputFacts } from './engine';

export const STATEMENTS = Object.freeze({
  venture: 'SELECT lifecycle_stage, status FROM projects WHERE id = ?',
  members: `SELECT u.id AS user_id, 0 AS advisor FROM projects p JOIN users u ON u.founder_id = p.founder_id
      WHERE p.id = ? AND p.founder_id IS NOT NULL AND u.is_active = 1
    UNION ALL
    SELECT pm.user_id, CASE WHEN pm.role = 'advisor' THEN 1 ELSE 0 END FROM project_members pm
      WHERE pm.project_id = ? AND pm.status = 'accepted' AND pm.removed_at IS NULL`,
  team: {
    axes: `SELECT user_id, axis, MAX(computed_at) AS at FROM skill_evidence
      WHERE user_id IN (SELECT value FROM json_each(?)) AND count_window > 0 GROUP BY user_id, axis`,
    actions: `SELECT COUNT(*) AS rows, COALESCE(SUM(count_window), 0) AS n, MAX(computed_at) AS at FROM skill_evidence
      WHERE user_id IN (SELECT value FROM json_each(?))`,
    commitment: `SELECT COUNT(*) AS rows, SUM(CASE WHEN commitment = 'full_time' THEN 1 ELSE 0 END) AS full_time, MAX(updated_at) AS at
      FROM cofounder_profiles WHERE user_id IN (SELECT value FROM json_each(?))`,
    experience: `SELECT COUNT(*) AS listed,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM user_skills s WHERE s.user_id = e.user_id) THEN 1 ELSE 0 END) AS corroborated,
        MAX(e.updated_at) AS at
      FROM user_profile_ext e
      WHERE e.user_id IN (SELECT value FROM json_each(?)) AND json_valid(e.experience) AND json_array_length(e.experience) > 0`,
    archetypes: `SELECT COUNT(*) AS rows, COUNT(DISTINCT a.archetype_slug) AS n, MAX(a.computed_at) AS at
      FROM profile_archetypes a JOIN profile_archetype_publish pub ON pub.user_id = a.user_id AND pub.published = 1
      WHERE a.user_id IN (SELECT value FROM json_each(?))`,
  },
  market: {
    sector: `SELECT p.sector, i.value, i.computed_at FROM projects p
      LEFT JOIN market_intel_indexes i ON lower(i.sector) = lower(p.sector) AND i.dimension = 'composite' AND i.geo = 'global'
      WHERE p.id = ? ORDER BY i.period_key DESC LIMIT 1`,
    competitors: `SELECT (SELECT COUNT(*) FROM competitor_tracking WHERE project_id = ? AND stopped_at IS NULL) AS tracked,
        (SELECT COUNT(*) FROM market_sources WHERE project_id = ?) AS sourced,
        (SELECT MAX(updated_at) FROM competitor_tracking WHERE project_id = ?) AS at`,
    size: `SELECT p.tam, p.sam, p.updated_at AS at,
        (SELECT COUNT(*) FROM project_market_assumptions a WHERE a.project_id = p.id AND length(trim(COALESCE(a.methodology, ''))) > 0) AS cited,
        (SELECT COUNT(*) FROM markets m WHERE m.project_id = p.id AND m.size_cents > 0 AND length(trim(COALESCE(m.size_source, ''))) > 0) AS sized,
        (SELECT COUNT(*) FROM fill_provenance f WHERE f.target_table = 'projects' AND f.target_row_id = p.id
           AND f.target_column IN ('tam', 'sam') AND f.citation_json IS NOT NULL) AS filled
      FROM projects p WHERE p.id = ?`,
  },
  technical: {
    must_haves: `SELECT COUNT(*) AS total,
        SUM(CASE WHEN done_at IS NOT NULL OR delivery_status = 'Done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN (done_at IS NOT NULL OR delivery_status = 'Done') AND merge_commit_sha IS NOT NULL THEN 1 ELSE 0 END) AS merged,
        MAX(updated_at) AS at
      FROM mvp_features WHERE project_id = ? AND is_must_have = 1 AND COALESCE(scope, 'core') <> 'out'`,
    cadence: `SELECT (SELECT COUNT(*) FROM roadmap_releases WHERE project_id = ? AND prerelease = 0 AND published_at >= date(?, '-90 days')) AS releases,
        (SELECT COUNT(*) FROM roadmap_okrs WHERE project_id = ? AND shipped_release_id IS NOT NULL AND updated_at >= date(?, '-90 days')) AS shipped,
        (SELECT COUNT(*) FROM roadmap_releases WHERE project_id = ?) AS ever,
        (SELECT MAX(published_at) FROM roadmap_releases WHERE project_id = ?) AS at`,
    commits: `SELECT COUNT(*) AS rows, COALESCE(SUM(commits_90d), 0) AS n, MAX(updated_at) AS at FROM github_contributors WHERE project_id = ?`,
    risks: `SELECT COUNT(*) AS total,
        SUM(CASE WHEN owner_user_id IS NOT NULL AND length(trim(COALESCE(mitigation, ''))) > 0 THEN 1 ELSE 0 END) AS owned,
        MAX(updated_at) AS at
      FROM venture_risks WHERE project_id = ? AND feature_id IS NOT NULL AND state <> 'closed'`,
    live: `SELECT COUNT(*) AS n FROM roadmap_releases WHERE project_id = ? AND prerelease = 0 AND published_at IS NOT NULL`,
    architecture: `SELECT (SELECT COUNT(*) FROM solution_design_notes WHERE project_id = ?) AS notes,
        (SELECT COUNT(*) FROM solution_design_notes WHERE project_id = ? AND (source_url IS NOT NULL OR source_path IS NOT NULL)) AS sourced,
        (SELECT COUNT(*) FROM solution_design_stack WHERE project_id = ?) AS stack,
        (SELECT MAX(created_at) FROM solution_design_notes WHERE project_id = ?) AS notes_at,
        (SELECT MAX(updated_at) FROM solution_design_stack WHERE project_id = ?) AS stack_at`,
  },
  metrics: `SELECT snapshot_date, mrr, monthly_churn_pct, nrr_pct, paying_accounts, net_burn, COALESCE(source, 'manual') AS source
      FROM project_metrics WHERE project_id = ? ORDER BY snapshot_date DESC, id DESC LIMIT 400`,
  financial: {
    venture: 'SELECT runway_months, use_of_funds, funding_needed, updated_at FROM projects WHERE id = ?',
    raise: `SELECT COUNT(*) AS deals, COALESCE(SUM(target_raise), 0) AS target, COALESCE(SUM(capital_committed), 0) AS committed, MAX(updated_at) AS at,
        (SELECT COUNT(*) FROM commitments c JOIN deals d2 ON d2.id = c.deal_id WHERE d2.project_id = ?) AS lines
      FROM deals WHERE project_id = ?`,
    narrative: `SELECT figure, stated_value, metric_value, checked_at FROM narrative_checks WHERE project_id = ? ORDER BY checked_at DESC, id DESC`,
  },
  risk: {
    register: `SELECT COUNT(*) AS total,
        SUM(CASE WHEN severity = 'high' AND state <> 'closed' THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN severity = 'high' AND state <> 'closed' AND owner_user_id IS NOT NULL AND length(trim(COALESCE(mitigation, ''))) > 0 THEN 1 ELSE 0 END) AS owned,
        MAX(updated_at) AS at
      FROM venture_risks WHERE project_id = ? AND feature_id IS NULL`,
    dd: `SELECT c.risk_band, COALESCE(c.decided_at, c.updated_at) AS at FROM dd_cases c
      WHERE c.subject_type = 'project' AND c.subject_id = ? AND c.status = 'completed' AND c.risk_band IS NOT NULL
        AND EXISTS (SELECT 1 FROM dd_findings f WHERE f.case_id = c.id)
      ORDER BY COALESCE(c.decided_at, c.updated_at) DESC, c.id DESC LIMIT 1`,
    layers: `SELECT COUNT(*) AS rows, AVG(analyst_score) AS n, MAX(updated_at) AS at FROM venture_risk_overrides
      WHERE project_id = ? AND analyst_score IS NOT NULL`,
    verdicts: `SELECT h.hypothesis_id, h.verdict, h.observed_at FROM hypothesis_verdict_history h
      WHERE h.project_id = ? AND h.id = (SELECT MAX(x.id) FROM hypothesis_verdict_history x WHERE x.project_id = h.project_id AND x.hypothesis_id = h.hypothesis_id)`,
  },
  markets: `SELECT demand_score, demand_source, partners_score, partners_source, cost_score, cost_source,
      regulation_score, regulation_source, updated_at FROM markets WHERE project_id = ? AND state IN ('served', 'entering', 'considering')`,
  political: {
    dd: `SELECT s.verdict, COALESCE(s.completed_at, s.updated_at) AS at FROM dd_sections s JOIN dd_cases c ON c.id = s.case_id
      WHERE c.subject_type = 'project' AND c.subject_id = ? AND c.status = 'completed'
        AND s.section_key = 'compliance_aml' AND s.status = 'completed' AND s.verdict IN ('pass', 'warn', 'fail')
      ORDER BY COALESCE(s.completed_at, s.updated_at) DESC, s.id DESC LIMIT 1`,
  },
  governance: {
    cap_table: `SELECT COUNT(*) AS n, SUM(CASE WHEN source = 'carta' OR carta_stakeholder_id IS NOT NULL THEN 1 ELSE 0 END) AS carta,
        MAX(updated_at) AS at FROM cap_table_holders WHERE project_id = ?`,
    vesting: `SELECT COUNT(*) AS founders,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM cap_table_vesting v WHERE v.holder_id = h.id) THEN 1 ELSE 0 END) AS vesting,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM cap_table_vesting v WHERE v.holder_id = h.id AND v.carta_vesting_id IS NOT NULL) THEN 1 ELSE 0 END) AS carta,
        (SELECT MAX(v.updated_at) FROM cap_table_vesting v WHERE v.holder_id IN (SELECT h2.id FROM cap_table_holders h2 WHERE h2.project_id = ?)) AS at
      FROM cap_table_holders h WHERE h.project_id = ? AND h.kind = 'founder'`,
    filings: `SELECT COUNT(*) AS due,
        SUM(CASE WHEN o.status = 'waived' OR (o.status = 'filed' AND (o.resolved_on IS NULL OR o.resolved_on <= o.due_date)) THEN 1 ELSE 0 END) AS on_time,
        SUM(CASE WHEN o.status = 'filed' AND o.proof_file_key IS NOT NULL THEN 1 ELSE 0 END) AS proof,
        MAX(o.updated_at) AS at
      FROM entity_obligations o JOIN projects p ON p.entity_id = o.entity_id WHERE p.id = ? AND o.due_date <= ?`,
    formation: `SELECT COUNT(*) AS steps, SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN state = 'done' AND proof_file_key IS NOT NULL THEN 1 ELSE 0 END) AS proof, MAX(updated_at) AS at
      FROM formation_steps WHERE project_id = ? AND kind = 'formation'`,
    data_room: `SELECT COUNT(*) AS files, MAX(updated_at) AS at FROM data_room_files WHERE project_id = ?`,
    checklist: `SELECT DISTINCT checklist_item FROM data_room_files WHERE project_id = ? AND checklist_item IS NOT NULL`,
    rhythm: `SELECT COUNT(*) AS due, SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done, MAX(run_date) AS at
      FROM ritual_runs WHERE project_id = ? AND run_date > date(?, '-84 days') AND run_date <= ?`,
  },
  legal_ip: {
    steps: `SELECT s.title, s.state, CASE WHEN s.proof_file_key IS NOT NULL THEN 1 ELSE 0 END AS proof, s.updated_at AS at,
        CASE WHEN EXISTS (SELECT 1 FROM formation_step_checks k WHERE k.step_id = s.id AND k.key LIKE 'github_org:%' AND k.done_at IS NOT NULL) THEN 1 ELSE 0 END AS github
      FROM formation_steps s WHERE s.project_id = ?`,
    repos: `SELECT COUNT(*) AS repos, SUM(CASE WHEN owner_kind = 'organisation' THEN 1 ELSE 0 END) AS org,
        SUM(CASE WHEN licence IS NOT NULL AND length(trim(licence)) > 0 THEN 1 ELSE 0 END) AS licensed, MAX(updated_at) AS at
      FROM github_repo_facts WHERE project_id = ?`,
    spinout: 'SELECT status, spinout_ip_meta, updated_at FROM projects WHERE id = ?',
  },
});

// ---------------------------------------------------------------------------

const num = (x: unknown): number => (x == null || x === '' ? 0 : Number.isFinite(Number(x)) ? Number(x) : 0);
const day = (x: unknown): string | null => {
  const d = String(x ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};
const newest = (...ds: unknown[]): string | null => ds.map(day).reduce<string | null>((a, d) => (d && (!a || d > a) ? d : a), null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The grade label nearest a mean factor, for the row's word. */
function labelOf(factor: number): GradeLabel {
  if (factor >= GRADES.measured) return 'measured';
  if (factor >= GRADES.reviewed) return 'reviewed';
  if (factor >= GRADES.sourced) return 'sourced';
  if (factor > 0) return 'stated';
  return 'not_recorded';
}

function recorded(key: string, n: number, of: number | null, grade: number, as_of: string | null, table: string, rows: number, words: string): InputFacts {
  return { key, applies: true, recorded: true, raw: { n, of }, grade, grade_label: labelOf(grade), as_of, source: { table, rows }, words, reason: null };
}
function missing(key: string, table: string, reason: string): InputFacts {
  return { key, applies: true, recorded: false, raw: {}, grade: 0, grade_label: 'not_recorded', as_of: null, source: { table, rows: 0 }, words: 'Not recorded', reason };
}
function notApplicable(key: string, reason: string): InputFacts {
  return { key, applies: false, recorded: false, raw: {}, grade: 0, grade_label: 'not_recorded', as_of: null, source: { table: '', rows: 0 }, words: 'Not expected yet', reason };
}

async function first<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql).bind(...binds).first<T>();
}
async function all<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...binds).all<T>()).results || [];
}

export interface Venture { stage: string | null; status: string | null }
export async function readVenture(env: Env, projectId: number): Promise<Venture | null> {
  const v = await first<{ lifecycle_stage: string | null; status: string | null }>(env, STATEMENTS.venture, projectId);
  return v ? { stage: v.lifecycle_stage ?? null, status: v.status ?? null } : null;
}

/** The venture's people as ids only: founders and accepted members, an advisor flagged. */
async function membersOf(env: Env, projectId: number): Promise<{ all: number[]; founders: number[]; advisors: Set<number> }> {
  const rows = await all<{ user_id: number; advisor: number }>(env, STATEMENTS.members, projectId, projectId);
  const advisor = new Map<number, boolean>();
  for (const r of rows) {
    const id = Number(r.user_id);
    if (!Number.isSafeInteger(id)) continue;
    // A person who is both a founder and an advisor row counts as a founder.
    advisor.set(id, (advisor.get(id) ?? true) && Number(r.advisor) === 1);
  }
  const all_ = [...advisor.keys()].sort((a, b) => a - b);
  return { all: all_, founders: all_.filter((id) => !advisor.get(id)), advisors: new Set(all_.filter((id) => advisor.get(id))) };
}

// ── Team ─────────────────────────────────────────────────────────────────────

async function team(env: Env, projectId: number): Promise<InputFacts[]> {
  const m = await membersOf(env, projectId);
  if (!m.all.length) {
    const why = 'No founder or member is recorded on the venture';
    return ['function_coverage', 'build_evidence', 'commitment', 'experience', 'archetype_mix']
      .map((k) => missing(k, 'project_members', why)).concat(notApplicable('values_alignment', why));
  }
  const ids = JSON.stringify(m.all);
  const founders = JSON.stringify(m.founders);
  const [axes, actions, commitment, experience, archetypes] = await Promise.all([
    all<{ user_id: number; axis: string; at: string | null }>(env, STATEMENTS.team.axes, ids),
    first<{ rows: number; n: number; at: string | null }>(env, STATEMENTS.team.actions, ids),
    first<{ rows: number; full_time: number; at: string | null }>(env, STATEMENTS.team.commitment, founders),
    first<{ listed: number; corroborated: number; at: string | null }>(env, STATEMENTS.team.experience, ids),
    first<{ rows: number; n: number; at: string | null }>(env, STATEMENTS.team.archetypes, ids),
  ]);
  const out: InputFacts[] = [];
  // Function coverage: an axis counts 1 when a non-advisor holds it, ½ when only an advisor does.
  const byAxis = new Map<string, number>();
  for (const r of axes) byAxis.set(r.axis, Math.max(byAxis.get(r.axis) ?? 0, m.advisors.has(Number(r.user_id)) ? 0.5 : 1));
  const covered = [...byAxis.values()].reduce((a, b) => a + b, 0);
  out.push(axes.length
    ? recorded('function_coverage', covered, 8, GRADES.measured, newest(...axes.map((r) => r.at)), 'skill_evidence', axes.length, `${covered} of 8 axes with evidence`)
    : missing('function_coverage', 'skill_evidence', 'No platform evidence is computed for the team yet'));
  out.push(num(actions?.rows) > 0
    ? recorded('build_evidence', num(actions?.n), null, GRADES.measured, newest(actions?.at), 'skill_evidence', num(actions?.rows), plural(num(actions?.n), 'platform action', 'platform actions'))
    : missing('build_evidence', 'skill_evidence', 'No platform evidence is computed for the team yet'));
  out.push(num(commitment?.rows) > 0
    ? recorded('commitment', num(commitment?.full_time), num(commitment?.rows), GRADES.stated, newest(commitment?.at), 'cofounder_profiles', num(commitment?.rows),
      `${num(commitment?.full_time)} of ${plural(num(commitment?.rows), 'founder', 'founders')} full time`)
    : missing('commitment', 'cofounder_profiles', 'No founder has said how committed they are'));
  out.push(num(experience?.listed) > 0
    ? recorded('experience', num(experience?.corroborated), m.all.length, GRADES.stated, newest(experience?.at), 'user_profile_ext', num(experience?.listed),
      `${num(experience?.corroborated)} of ${plural(m.all.length, 'member', 'members')} with experience beside a skill`)
    : missing('experience', 'user_profile_ext', 'No member lists experience'));
  out.push(num(archetypes?.rows) > 0
    ? recorded('archetype_mix', num(archetypes?.n), null, GRADES.measured, newest(archetypes?.at), 'profile_archetypes', num(archetypes?.rows),
      plural(num(archetypes?.n), 'distinct published archetype', 'distinct published archetypes'))
    : missing('archetype_mix', 'profile_archetypes', 'No member has published an archetype'));
  out.push(m.founders.length < 2
    ? notApplicable('values_alignment', 'A solo founder: values alignment does not apply')
    : unsourced('values_alignment', 'No consent to share values is stored yet (part 3)'));
  return out;
}

// ── Market ───────────────────────────────────────────────────────────────────

async function market(env: Env, projectId: number): Promise<InputFacts[]> {
  const [sector, comp, size] = await Promise.all([
    first<{ sector: string | null; value: number | null; computed_at: string | null }>(env, STATEMENTS.market.sector, projectId),
    first<{ tracked: number; sourced: number; at: string | null }>(env, STATEMENTS.market.competitors, projectId, projectId, projectId),
    first<{ tam: number | null; sam: number | null; at: string | null; cited: number; sized: number; filled: number }>(env, STATEMENTS.market.size, projectId),
  ]);
  const out: InputFacts[] = [];
  if (!sector?.sector) out.push(missing('sector_momentum', 'projects', 'No sector is recorded for the venture'));
  else if (sector.value == null) out.push(missing('sector_momentum', 'market_intel_indexes', 'No live index for this sector yet'));
  else out.push(recorded('sector_momentum', num(sector.value), null, GRADES.measured, day(sector.computed_at), 'market_intel_indexes', 1, `Index ${Math.round(num(sector.value))}`));
  const tracked = num(comp?.tracked);
  out.push(tracked > 0
    ? recorded('competitors', tracked, null, num(comp?.sourced) > 0 ? GRADES.sourced : GRADES.stated, day(comp?.at), 'competitor_tracking', tracked, plural(tracked, 'competitor tracked', 'competitors tracked'))
    : missing('competitors', 'competitor_tracking', 'No competitor is tracked'));
  const parts = (num(size?.tam) > 0 ? 1 : 0) + (num(size?.sam) > 0 ? 1 : 0);
  const cited = num(size?.cited) + num(size?.sized) + num(size?.filled) > 0;
  out.push(parts > 0
    ? recorded('market_size', parts, 2, cited ? GRADES.sourced : GRADES.stated, day(size?.at), 'projects', 1,
      `${parts === 2 ? 'TAM and SAM' : num(size?.tam) > 0 ? 'TAM' : 'SAM'} recorded${cited ? ', with a cited sizing' : ''}`)
    : missing('market_size', 'projects', 'No TAM or SAM is recorded'));
  return out;
}

// ── Technical ────────────────────────────────────────────────────────────────

async function technical(env: Env, projectId: number, today: string): Promise<InputFacts[]> {
  const [mh, cad, commits, risks, live, arch] = await Promise.all([
    first<{ total: number; done: number; merged: number; at: string | null }>(env, STATEMENTS.technical.must_haves, projectId),
    first<{ releases: number; shipped: number; ever: number; at: string | null }>(env, STATEMENTS.technical.cadence, projectId, today, projectId, today, projectId, projectId),
    first<{ rows: number; n: number; at: string | null }>(env, STATEMENTS.technical.commits, projectId),
    first<{ total: number; owned: number; at: string | null }>(env, STATEMENTS.technical.risks, projectId),
    first<{ n: number }>(env, STATEMENTS.technical.live, projectId),
    first<{ notes: number; sourced: number; stack: number; notes_at: string | null; stack_at: string | null }>(env, STATEMENTS.technical.architecture, projectId, projectId, projectId, projectId, projectId),
  ]);
  const out: InputFacts[] = [];
  const total = num(mh?.total), done = num(mh?.done), merged = num(mh?.merged);
  out.push(total > 0
    ? recorded('must_haves', done, total, done > 0 ? (merged * GRADES.measured + (done - merged) * GRADES.stated) / done : GRADES.stated,
      day(mh?.at), 'mvp_features', total, `${done} of ${plural(total, 'must-have', 'must-haves')} done`)
    : missing('must_haves', 'mvp_features', 'No must-have feature is recorded'));
  const shippedN = num(cad?.releases) + num(cad?.shipped);
  out.push(num(cad?.ever) + num(cad?.shipped) > 0
    ? recorded('shipping_cadence', shippedN, null, GRADES.measured, day(cad?.at), 'roadmap_releases', shippedN, `${shippedN} shipped in 90 days`)
    : missing('shipping_cadence', 'roadmap_releases', 'No release or shipped roadmap item is recorded'));
  out.push(num(commits?.rows) > 0
    ? recorded('build_activity', num(commits?.n), null, GRADES.measured, day(commits?.at), 'github_contributors', num(commits?.rows), plural(num(commits?.n), 'commit in 90 days', 'commits in 90 days'))
    : missing('build_activity', 'github_contributors', 'GitHub is not connected'));
  out.push(num(risks?.total) > 0
    ? recorded('technical_risks', num(risks?.owned), num(risks?.total), GRADES.stated, day(risks?.at), 'venture_risks', num(risks?.total),
      `${num(risks?.owned)} of ${plural(num(risks?.total), 'technical risk', 'technical risks')} owned and mitigated`)
    : missing('technical_risks', 'venture_risks', 'No open risk is tied to a feature'));
  out.push(num(live?.n) > 0
    ? unsourced('production_health', 'Production health waits for Vercel (#2408)')
    : notApplicable('production_health', 'No product is live yet'));
  const notes = num(arch?.notes), stack = num(arch?.stack);
  const archParts: number[] = [];
  if (notes > 0) archParts.push(num(arch?.sourced) > 0 ? GRADES.sourced : GRADES.stated);
  if (stack > 0) archParts.push(GRADES.measured);
  out.push(archParts.length
    ? recorded('architecture', archParts.length, 2, mean(archParts), newest(arch?.notes_at, arch?.stack_at), 'solution_design_notes', notes + stack,
      [notes > 0 ? plural(notes, 'design note', 'design notes') : null, stack > 0 ? 'stack recorded' : null].filter(Boolean).join(', '))
    : missing('architecture', 'solution_design_notes', 'No design note or stack is recorded'));
  return out;
}

// ── Traction and Financial: the metric snapshots ─────────────────────────────

type Metric = { snapshot_date: string; mrr: number | null; monthly_churn_pct: number | null; nrr_pct: number | null;
  paying_accounts: number | null; net_burn: number | null; source: string };
const SOURCE_RANK: Record<string, number> = { stripe: 0, mercury: 1 };
const measuredSource = (s: string) => s in SOURCE_RANK;
const gradeOfSource = (s: string) => (measuredSource(s) ? GRADES.measured : GRADES.stated);

/** The latest snapshot carrying `field`, from the best source that has one. */
function latestOf(rows: Metric[], field: keyof Metric): Metric | null {
  const withField = rows.filter((r) => r[field] != null && Number.isFinite(Number(r[field])));
  if (!withField.length) return null;
  const best = Math.min(...withField.map((r) => SOURCE_RANK[r.source] ?? 2));
  return withField.filter((r) => (SOURCE_RANK[r.source] ?? 2) === best)[0];
}
/** The same field from the same source about three months earlier. */
function earlierOf(rows: Metric[], field: keyof Metric, latest: Metric): Metric | null {
  const cut = new Date(`${latest.snapshot_date.slice(0, 10)}T00:00:00Z`).getTime() - 80 * 86_400_000;
  return rows.find((r) => r.source === latest.source && r[field] != null && new Date(`${String(r.snapshot_date).slice(0, 10)}T00:00:00Z`).getTime() <= cut) ?? null;
}

async function traction(env: Env, projectId: number): Promise<InputFacts[]> {
  const rows = await all<Metric>(env, STATEMENTS.metrics, projectId);
  const out: InputFacts[] = [];
  const mrr = latestOf(rows, 'mrr');
  out.push(mrr
    ? recorded('revenue', num(mrr.mrr), null, gradeOfSource(mrr.source), day(mrr.snapshot_date), 'project_metrics', 1, `MRR from ${mrr.source}`)
    : missing('revenue', 'project_metrics', 'No MRR is recorded'));
  const before = mrr ? earlierOf(rows, 'mrr', mrr) : null;
  out.push(mrr && before && num(before.mrr) > 0
    ? recorded('growth', ((num(mrr.mrr) - num(before.mrr)) / num(before.mrr)) * 100, null, gradeOfSource(mrr.source), day(mrr.snapshot_date), 'project_metrics', 2, `Growth over about three months, from ${mrr.source}`)
    : missing('growth', 'project_metrics', 'Growth needs about three months of MRR from one source'));
  const nrr = latestOf(rows, 'nrr_pct');
  const churn = latestOf(rows, 'monthly_churn_pct');
  if (nrr) out.push(recorded('retention', num(nrr.nrr_pct), null, gradeOfSource(nrr.source), day(nrr.snapshot_date), 'project_metrics', 1, `Net revenue retention from ${nrr.source}`));
  else if (churn) out.push(recorded('retention', 100 - 12 * num(churn.monthly_churn_pct), null, gradeOfSource(churn.source), day(churn.snapshot_date), 'project_metrics', 1, `Monthly churn from ${churn.source}`));
  else out.push(missing('retention', 'project_metrics', 'No retention or churn is recorded'));
  const paying = latestOf(rows, 'paying_accounts');
  out.push(paying
    ? recorded('paying_customers', num(paying.paying_accounts), null, gradeOfSource(paying.source), day(paying.snapshot_date), 'project_metrics', 1, plural(num(paying.paying_accounts), 'paying account', 'paying accounts'))
    : missing('paying_customers', 'project_metrics', 'No paying accounts are recorded'));
  return out;
}

async function financial(env: Env, projectId: number): Promise<InputFacts[]> {
  const [v, raise, checks, rows, bank] = await Promise.all([
    first<{ runway_months: number | null; use_of_funds: string | null; funding_needed: number | null; updated_at: string | null }>(env, STATEMENTS.financial.venture, projectId),
    first<{ deals: number; target: number; committed: number; at: string | null; lines: number }>(env, STATEMENTS.financial.raise, projectId, projectId),
    all<{ figure: string; stated_value: number | null; metric_value: number | null; checked_at: string | null }>(env, STATEMENTS.financial.narrative, projectId),
    all<Metric>(env, STATEMENTS.metrics, projectId),
    // Mercury's read failing makes runway alone unreadable: the scope is drawn, never stored.
    mercuryRunway(env, projectId).catch(() => 'unreadable' as const),
  ]);
  const out: InputFacts[] = [];
  if (bank === 'unreadable') {
    out.push({ ...missing('runway', 'mercury_raise_facts', 'Mercury could not be read'), unreadable: true, words: 'Could not be read' });
  } else if (bank && bank.value != null && Number.isFinite(Number(bank.value))) {
    out.push(recorded('runway', num(bank.value), null, GRADES.measured, day(bank.as_of), 'mercury_raise_facts', 1, 'Runway from Mercury'));
  } else if (num(v?.runway_months) > 0) {
    out.push(recorded('runway', num(v?.runway_months), null, GRADES.stated, day(v?.updated_at), 'projects', 1, 'Runway, typed'));
  } else out.push(missing('runway', 'mercury_raise_facts', 'No runway is recorded'));
  const alloc = parseUseOfFundsValue(v?.use_of_funds ?? null).length > 0;
  const target = num(v?.funding_needed) > 0;
  out.push(alloc || target
    ? recorded('use_of_funds', (alloc ? 1 : 0) + (target ? 1 : 0), 2, GRADES.stated, day(v?.updated_at), 'projects', 1,
      [target ? 'raise target set' : 'no raise target', alloc ? 'allocation recorded' : 'no allocation'].join(', '))
    : missing('use_of_funds', 'projects', 'No raise target or allocation is recorded'));
  out.push(num(raise?.target) > 0
    ? recorded('raise_progress', num(raise?.committed), num(raise?.target), num(raise?.lines) > 0 ? GRADES.measured : GRADES.stated, day(raise?.at), 'deals', num(raise?.deals),
      `Committed against target across ${plural(num(raise?.deals), 'deal', 'deals')}`)
    : missing('raise_progress', 'deals', 'No deal carries a raise target'));
  const seen = new Set<string>();
  let checked = 0, matched = 0, at: string | null = null;
  for (const c of checks) {
    if (seen.has(c.figure)) continue;
    seen.add(c.figure);
    if (c.stated_value == null || c.metric_value == null) continue;
    checked++;
    at = newest(at, c.checked_at);
    const s = Number(c.stated_value), m = Number(c.metric_value);
    if (Math.abs(s - m) <= Math.max(Math.abs(m) * 0.05, 1e-9)) matched++;
  }
  out.push(checked > 0
    ? recorded('narrative_match', matched, checked, GRADES.measured, at, 'narrative_checks', checked, `${matched} of ${plural(checked, 'figure', 'figures')} match`)
    : missing('narrative_match', 'narrative_checks', 'No narrative figure has been checked against a metric'));
  const burn = latestOf(rows, 'net_burn');
  const burnBefore = burn ? earlierOf(rows, 'net_burn', burn) : null;
  out.push(burn && burnBefore && num(burnBefore.net_burn) > 0
    ? recorded('burn_trend', ((num(burnBefore.net_burn) - num(burn.net_burn)) / num(burnBefore.net_burn)) * 100, null, gradeOfSource(burn.source), day(burn.snapshot_date), 'project_metrics', 2,
      `Burn trend over about three months, from ${burn.source}`)
    : missing('burn_trend', 'project_metrics', 'Burn trend needs about three months of net burn from one source'));
  const mrr = latestOf(rows, 'mrr');
  out.push(mrr && burn && measuredSource(mrr.source) && measuredSource(burn.source)
    ? recorded('capital_efficiency', num(burn.net_burn) <= 0 ? 100 : (num(mrr.mrr) / num(burn.net_burn)) * 100, null, GRADES.measured,
      newest(mrr.snapshot_date, burn.snapshot_date), 'project_metrics', 2, 'MRR against net burn, both measured')
    : missing('capital_efficiency', 'project_metrics', 'Needs MRR and net burn both from a connector'));
  return out;
}

// ── Risk ─────────────────────────────────────────────────────────────────────

const DD_BAND: Record<string, number> = { green: 100, yellow: 70, amber: 40, red: 10 };

async function risk(env: Env, projectId: number): Promise<InputFacts[]> {
  const [reg, dd, layers, verdicts, decision] = await Promise.all([
    first<{ total: number; high: number; owned: number; at: string | null }>(env, STATEMENTS.risk.register, projectId),
    first<{ risk_band: string; at: string | null }>(env, STATEMENTS.risk.dd, projectId),
    first<{ rows: number; n: number | null; at: string | null }>(env, STATEMENTS.risk.layers, projectId),
    all<{ hypothesis_id: number; verdict: string | null; observed_at: string | null }>(env, STATEMENTS.risk.verdicts, projectId),
    // Decisions are verdict.ts's to read (D693): it answers with a day only.
    latestPivotOrStopDay(env, projectId),
  ]);
  const out: InputFacts[] = [];
  const total = num(reg?.total), high = num(reg?.high);
  // Recording a risk never lowers the score: a register with no open high risk is full.
  out.push(total > 0
    ? recorded('risk_register', high > 0 ? num(reg?.owned) : 1, high > 0 ? high : 1, GRADES.stated, day(reg?.at), 'venture_risks', total,
      high > 0 ? `${num(reg?.owned)} of ${plural(high, 'high risk', 'high risks')} owned and mitigated` : `${plural(total, 'risk', 'risks')} recorded, none open and high`)
    : missing('risk_register', 'venture_risks', 'No risk is recorded'));
  out.push(dd && dd.risk_band in DD_BAND
    ? recorded('dd_band', DD_BAND[dd.risk_band], null, GRADES.reviewed, day(dd.at), 'dd_cases', 1, `DD band ${dd.risk_band}`)
    : missing('dd_band', 'dd_cases', 'No completed DD case with findings'));
  out.push(num(layers?.rows) > 0 && layers?.n != null
    ? recorded('analyst_layers', num(layers.n), null, GRADES.reviewed, day(layers.at), 'venture_risk_overrides', num(layers.rows), plural(num(layers.rows), 'layer reviewed', 'layers reviewed'))
    : missing('analyst_layers', 'venture_risk_overrides', 'No analyst has scored a risk layer'));
  const invalid = verdicts.filter((v) => v.verdict === 'invalidated');
  const decidedAt = decision;
  const answered = invalid.filter((v) => decidedAt && day(v.observed_at) && day(v.observed_at)! <= decidedAt).length;
  out.push(verdicts.length > 0
    ? recorded('invalidated_claims', invalid.length ? answered : 1, invalid.length || 1, GRADES.sourced, newest(...verdicts.map((v) => v.observed_at), decision), 'hypothesis_verdict_history', verdicts.length,
      invalid.length ? `${answered} of ${plural(invalid.length, 'invalidated claim', 'invalidated claims')} answered by a pivot or stop` : 'No claim is invalidated')
    : missing('invalidated_claims', 'hypothesis_verdict_history', 'No claim verdict is recorded'));
  return out;
}

// ── Geographic, Political and regulatory ─────────────────────────────────────

type MarketRow = { demand_score: number | null; demand_source: string | null; partners_score: number | null; partners_source: string | null;
  cost_score: number | null; cost_source: string | null; regulation_score: number | null; regulation_source: string | null; updated_at: string | null };
const sourced = (score: number | null, src: string | null) => score != null && Number.isFinite(Number(score)) && !!src && String(src).trim().length > 0;

async function geographic(env: Env, projectId: number): Promise<InputFacts[]> {
  const rows = await all<MarketRow>(env, STATEMENTS.markets, projectId);
  const perMarket = rows.map((r) => {
    const parts = ([['demand_score', 'demand_source'], ['partners_score', 'partners_source'], ['cost_score', 'cost_source']] as const)
      .filter(([s, src]) => sourced(r[s], r[src])).map(([s]) => num(r[s]) * 10);
    return parts.length ? mean(parts) : null;
  }).filter((x): x is number => x != null);
  return [
    perMarket.length
      ? recorded('market_readiness', mean(perMarket), null, GRADES.sourced, newest(...rows.map((r) => r.updated_at)), 'markets', perMarket.length, plural(perMarket.length, 'market with sourced readiness', 'markets with sourced readiness'))
      : missing('market_readiness', 'markets', 'No market has a sourced demand, partners or cost score'),
    unsourced('country_environment', 'Facts only: no country index is chosen (owner question 4)'),
  ];
}

async function political(env: Env, projectId: number): Promise<InputFacts[]> {
  const [rows, dd] = await Promise.all([
    all<MarketRow>(env, STATEMENTS.markets, projectId),
    first<{ verdict: string; at: string | null }>(env, STATEMENTS.political.dd, projectId),
  ]);
  const reg = rows.filter((r) => sourced(r.regulation_score, r.regulation_source));
  const VERDICT: Record<string, number> = { pass: 100, warn: 50, fail: 0 };
  return [
    reg.length
      ? recorded('regulation_readiness', mean(reg.map((r) => num(r.regulation_score) * 10)), null, GRADES.sourced, newest(...reg.map((r) => r.updated_at)), 'markets', reg.length,
        plural(reg.length, 'market with sourced regulation readiness', 'markets with sourced regulation readiness'))
      : missing('regulation_readiness', 'markets', 'No market has a sourced regulation score'),
    dd && dd.verdict in VERDICT
      ? recorded('dd_compliance', VERDICT[dd.verdict], null, GRADES.reviewed, day(dd.at), 'dd_sections', 1, `Compliance section: ${dd.verdict}`)
      : missing('dd_compliance', 'dd_sections', 'No completed compliance section in a completed DD case'),
    unsourced('high_risk_lists', 'The FATF and EU lists are not imported (owner question 4)'),
    unsourced('stability', 'No governance index is imported (owner question 4)'),
  ];
}

// ── Governance ───────────────────────────────────────────────────────────────

async function governance(env: Env, projectId: number, today: string): Promise<InputFacts[]> {
  const [cap, vest, filings, formation, room, checklist, rhythm] = await Promise.all([
    first<{ n: number; carta: number; at: string | null }>(env, STATEMENTS.governance.cap_table, projectId),
    first<{ founders: number; vesting: number; carta: number; at: string | null }>(env, STATEMENTS.governance.vesting, projectId, projectId),
    first<{ due: number; on_time: number; proof: number; at: string | null }>(env, STATEMENTS.governance.filings, projectId, today),
    first<{ steps: number; done: number; proof: number; at: string | null }>(env, STATEMENTS.governance.formation, projectId),
    first<{ files: number; at: string | null }>(env, STATEMENTS.governance.data_room, projectId),
    all<{ checklist_item: string }>(env, STATEMENTS.governance.checklist, projectId),
    first<{ due: number; done: number; at: string | null }>(env, STATEMENTS.governance.rhythm, projectId, today, today),
  ]);
  const out: InputFacts[] = [];
  out.push(num(cap?.n) > 0
    ? recorded('cap_table', 100, null, num(cap?.carta) > 0 ? GRADES.measured : GRADES.stated, day(cap?.at), 'cap_table_holders', num(cap?.n),
      `${plural(num(cap?.n), 'holder', 'holders')} recorded${num(cap?.carta) > 0 ? ' from Carta' : ''}`)
    : missing('cap_table', 'cap_table_holders', 'No holder is on the cap table'));
  const founders = num(vest?.founders), vesting = num(vest?.vesting);
  out.push(founders > 0
    ? recorded('founder_vesting', vesting, founders, vesting > 0 ? (num(vest?.carta) * GRADES.measured + (vesting - num(vest?.carta)) * GRADES.stated) / vesting : GRADES.stated,
      day(vest?.at), 'cap_table_vesting', founders, `${vesting} of ${plural(founders, 'founder', 'founders')} vesting`)
    : missing('founder_vesting', 'cap_table_holders', 'No founder holder is on the cap table'));
  const due = num(filings?.due), onTime = num(filings?.on_time);
  out.push(due > 0
    ? recorded('filings', onTime, due, onTime > 0 ? (num(filings?.proof) * GRADES.measured + (onTime - num(filings?.proof)) * GRADES.stated) / onTime : GRADES.stated,
      day(filings?.at), 'entity_obligations', due, `${onTime} of ${plural(due, 'filing', 'filings')} on time`)
    : missing('filings', 'entity_obligations', 'No filing has fallen due'));
  const steps = num(formation?.steps), fDone = num(formation?.done);
  out.push(steps > 0
    ? recorded('formation', fDone, steps, fDone > 0 ? (num(formation?.proof) * GRADES.measured + (fDone - num(formation?.proof)) * GRADES.stated) / fDone : GRADES.stated,
      day(formation?.at), 'formation_steps', steps, `${fDone} of ${plural(steps, 'formation step', 'formation steps')} done`)
    : missing('formation', 'formation_steps', 'No formation step is recorded'));
  const keys = new Set(DILIGENCE_CHECKLIST.map((i) => i.key));
  const covered = new Set(checklist.map((c) => c.checklist_item).filter((k) => keys.has(k as any))).size;
  out.push(num(room?.files) > 0
    ? recorded('data_room', covered, DILIGENCE_CHECKLIST.length, GRADES.measured, day(room?.at), 'data_room_files', num(room?.files), `${covered} of ${DILIGENCE_CHECKLIST.length} checklist items`)
    : missing('data_room', 'data_room_files', 'The data room holds no file'));
  out.push(num(rhythm?.due) > 0
    ? recorded('operating_rhythm', num(rhythm?.done), num(rhythm?.due), GRADES.measured, day(rhythm?.at), 'ritual_runs', num(rhythm?.due), `${num(rhythm?.done)} of ${plural(num(rhythm?.due), 'ritual', 'rituals')} held in 12 weeks`)
    : missing('operating_rhythm', 'ritual_runs', 'No ritual was due in the last 12 weeks'));
  return out;
}

// ── Legal and IP ─────────────────────────────────────────────────────────────

async function legalIp(env: Env, projectId: number, venture: Venture): Promise<InputFacts[]> {
  const [steps, repos, spin] = await Promise.all([
    all<{ title: string; state: string; proof: number; at: string | null; github: number }>(env, STATEMENTS.legal_ip.steps, projectId),
    first<{ repos: number; org: number; licensed: number; at: string | null }>(env, STATEMENTS.legal_ip.repos, projectId),
    first<{ status: string | null; spinout_ip_meta: string | null; updated_at: string | null }>(env, STATEMENTS.legal_ip.spinout, projectId),
  ]);
  const out: InputFacts[] = [];
  const ip = steps.filter((s) => isIpAssignmentStep(s.title));
  const ipDone = ip.filter((s) => s.state === 'done');
  const evidenced = ipDone.filter((s) => num(s.proof) > 0 || num(s.github) > 0).length;
  out.push(ip.length
    ? recorded('ip_assignment', ipDone.length, ip.length, ipDone.length ? (evidenced * GRADES.measured + (ipDone.length - evidenced) * GRADES.stated) / ipDone.length : GRADES.stated,
      newest(...ip.map((s) => s.at)), 'formation_steps', ip.length, `${ipDone.length} of ${plural(ip.length, 'IP assignment step', 'IP assignment steps')} done`)
    : missing('ip_assignment', 'formation_steps', 'No IP assignment step is recorded'));
  const n = num(repos?.repos);
  out.push(n > 0
    ? recorded('code_held', num(repos?.org), n, GRADES.measured, day(repos?.at), 'github_repo_facts', n, `${num(repos?.org)} of ${plural(n, 'repository', 'repositories')} held by an organisation`)
    : missing('code_held', 'github_repo_facts', 'GitHub is not connected'));
  out.push(unsourced('founder_agreements', 'No platform store links signed founder agreements to a venture yet'));
  const spinout = (spin?.status ?? venture.status) === 'spinout';
  const meta = String(spin?.spinout_ip_meta ?? '').trim();
  out.push(!spinout
    ? notApplicable('spinout_ip', 'Spin-Out ventures only')
    : meta && meta !== '{}' && meta !== 'null'
      ? recorded('spinout_ip', 100, null, GRADES.stated, day(spin?.updated_at), 'projects', 1, 'Spin-out IP terms recorded')
      : missing('spinout_ip', 'projects', 'The spin-out’s IP terms are not recorded'));
  out.push(n > 0
    ? recorded('licences', num(repos?.licensed), n, GRADES.measured, day(repos?.at), 'github_repo_facts', n, `${num(repos?.licensed)} of ${plural(n, 'repository', 'repositories')} with a licence`)
    : missing('licences', 'github_repo_facts', 'GitHub is not connected'));
  return out;
}

/** The collector for one scope. A throw means the scope's stores could not be read. */
export async function collectScope(env: Env, scope: ScopeKey, projectId: number, venture: Venture, today: string): Promise<InputFacts[]> {
  switch (scope) {
    case 'team': return team(env, projectId);
    case 'market': return market(env, projectId);
    case 'technical': return technical(env, projectId, today);
    case 'traction': return traction(env, projectId);
    case 'financial': return financial(env, projectId);
    case 'risk': return risk(env, projectId);
    case 'geographic': return geographic(env, projectId);
    case 'political': return political(env, projectId);
    case 'governance': return governance(env, projectId, today);
    case 'legal_ip': return legalIp(env, projectId, venture);
  }
}
