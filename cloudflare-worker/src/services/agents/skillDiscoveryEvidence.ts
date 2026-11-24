/**
 * D4538 part 8 (#5968, of #4538) — what discovery reads for ranking stages 3 to 5, for one agent, from D1 and the real
 * readers. `skillDiscovery.ts` stays pure; this module reads the facts it ranks on and adds them to the catalogue.
 *
 * Only for skills that already pass the cheap gate (`gateOf` with no evidence: readable, published, not retired or
 * suspended, the agent's role, granted tools, the asked-for output), so a blocked skill costs no read.
 *
 *  - INPUTS (#4667): for a skill of the first ten (`FIRST_TEN_SLUGS`, by slug, as the run path checks it), `preflight`
 *    through the real readers, as the agent's sponsor, with the rule book in force as the binding: the readiness
 *    route's own call (`team_agents.ts` GET /agents/:uid/skills/:slug/readiness), on the agent's own venture (a project
 *    agent's; none for a company agent) and no selected document or fund. Any other skill has no binding reported:
 *    `inputs` stays absent and discovery says "Not recorded". A preflight that throws is every input `unreadable`.
 *  - RUNNABLE (#4534): what the run path refuses for this agent before any skill text, beyond the gate's own codes
 *    (`skillForRun`'s pin, suspension and grants are the gate's `skill_suspended` and `tool_not_approved`): a paused
 *    agent (`agent_paused`) and an outside assistant's agent (`outside_assistant`), as `agentRun` answers them.
 *  - QUALITY (D4533, HQ skills only): the current version's release manifest (`agent_skill_versions.evidence_json`)
 *    and the latest result per case key and model on that version in `agent_skill_version_evals`, over the cases a
 *    run on it takes (`goldenCasesFrom`) and its required models (the manifest's, else the declared or default set),
 *    as the HQ library's published evaluation counts them (D4536-p2). Two reads for every skill asked. Counts,
 *    identities and dates only: no case text, output or detail leaves this module. A company skill has no golden
 *    cases or manifest, and says so.
 *  - OPERATIONS (#4536): the attributed outcomes (`run` and `refused` events marked `outcome_v = 1`, D4536-p4) and the
 *    model-call latency (nearest-rank p50 and p95 of `ai_usage_logs.latency_ms`) for the skill's CURRENT version, in
 *    #4536's default window (the last 30 UTC days), over THIS COMPANY'S AGENTS' runs only: a company agent of the
 *    company, or a project agent on one of its projects. An HQ skill's runs at another company never enter a figure,
 *    so member discovery is never shown another company's evidence, whatever HQ's aggregate read serves.
 *
 * An unreadable read is said (`{ available: false, reason }`), never served as zeros. Nothing is written.
 */
import type { Env } from '../../types';
import type { Rules } from './catalogue';
import type { AgentRow, Scope } from './teams';
import { FIRST_TEN, FIRST_TEN_SLUGS, preflight } from './skillInputs';
import { goldenCasesFrom, type LiveCaseRow } from './skillEval';
import { EVALUATOR, parseEvidence, requiredModels, suiteRevision } from './skillLifecycle';
import { FAILED_CODES, executionsWindow, isRetryable } from './skillExecutions';
import {
  gateOf, type DiscoveryAgent, type DiscoverySkill, type InputFacts, type OperationalFacts, type QualityFacts, type ResultCounts, type Unavailable,
} from './skillDiscovery';

/** What a catalogue skill carries for these reads, beyond its discovery facts. */
export type EvidenceRow = { id: number };

export type EvidenceContext = {
  agent: AgentRow; scope: Scope; rules: Pick<Rules, 'reads'>; companyId: number | null;
  output_kind: string | null; now: Date;
  /** The readers `preflight` reads; the real ones unless a test passes its own. */
  readers?: Parameters<typeof preflight>[3];
};

const COMPANY_SKILL: Unavailable = { available: false, reason: 'A company skill has no golden cases or release manifest: company versions publish without HQ\'s evidence gate (D4533).' };
const QUALITY_UNREADABLE: Unavailable = { available: false, reason: 'The quality evidence could not be read.' };
const OPERATIONS_UNREADABLE: Unavailable = { available: false, reason: 'The run history could not be read.' };
const LATENCY_UNREADABLE: Unavailable = { available: false, reason: 'The latency read failed.' };
const NO_LATENCY: Unavailable = { available: false, reason: 'No completed run of this version by this company\'s agents recorded a model-call latency in the window.' };

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };
/** `run_at` is `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`, UTC); null when it does not parse. */
const msOf = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const iso = at.replace(' ', 'T');
  const ms = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
};

const ids = (rows: readonly { id: number }[]) => JSON.stringify(rows.map((r) => r.id));
// This company's agents, in OUTCOMES_SQL and LATENCY_SQL: a company agent of the company, or a project agent on one of
// its projects. Binds the company twice.

const VERSIONS_SQL = `SELECT s.id, s.uid, s.slug, s.current_version, s.required_models_json, v.evidence_json,
    (SELECT json_group_array(json_object('uid', k.uid, 'name', k.name, 'input_json', k.input_json, 'expect_json', k.expect_json))
      FROM (SELECT uid, name, input_json, expect_json FROM agent_skill_cases WHERE skill_id = s.id AND removed_at IS NULL ORDER BY id) k) AS cases_json
  FROM agent_skills s JOIN agent_skill_versions v ON v.skill_id = s.id AND v.version = s.current_version
  WHERE s.id IN (SELECT value FROM json_each(?)) AND s.scope = 'hq' AND s.current_version >= 1`;
/** The latest row per case key and model on each skill's CURRENT version only; older rows and other versions stay in SQL. */
const EVALS_SQL = `WITH ranked AS (
    SELECT e.skill_id, e.case_key, e.model_id, e.result, e.run_at, e.evaluator_version, e.case_sha256,
      ROW_NUMBER() OVER (PARTITION BY e.skill_id, e.case_key, e.model_id ORDER BY e.run_at DESC, e.id DESC) AS rn
    FROM agent_skill_version_evals e JOIN agent_skills s ON s.id = e.skill_id
    WHERE e.skill_id IN (SELECT value FROM json_each(?)) AND s.scope = 'hq' AND e.version = s.current_version
  )
  SELECT skill_id, case_key, model_id, result, run_at, evaluator_version, case_sha256 FROM ranked WHERE rn = 1`;
/** D4536-p4's marked outcome events, for the skills asked, over this company's agents. Bound: ids, since, until, company, company. */
const OUTCOMES_SQL = `SELECT s.id AS skill_id, e.kind, json_extract(e.detail_json, '$.code') AS code, json_extract(e.detail_json, '$.status') AS http_status,
    json_extract(e.detail_json, '$.skill.version') AS version, COUNT(*) AS n, MIN(e.created_at) AS first_at
  FROM team_agent_events e
  JOIN agent_skills s ON s.uid = json_extract(e.detail_json, '$.skill.uid') AND s.id IN (SELECT value FROM json_each(?))
  JOIN team_agents a ON a.id = e.agent_id
  WHERE e.kind IN ('run', 'refused') AND json_extract(e.detail_json, '$.outcome_v') = 1
    AND datetime(e.created_at) >= datetime(?) AND datetime(e.created_at) < datetime(?)
    AND ((a.scope_kind = 'company' AND a.company_id = ?) OR (a.scope_kind = 'project' AND a.project_id IN (SELECT p.id FROM projects p WHERE p.company_id = ?)))
  GROUP BY s.id, e.kind, code, http_status, version`;
/** Nearest-rank p50 and p95 of the model call on the current version, over this company's agents. Same binds. */
const LATENCY_SQL = `WITH r AS (
    SELECT u.skill_id, u.latency_ms FROM ai_usage_logs u
    JOIN agent_skills s ON s.id = u.skill_id JOIN team_agents a ON a.id = u.agent_id
    WHERE u.skill_id IN (SELECT value FROM json_each(?)) AND u.skill_version = s.current_version AND u.guard_for IS NULL AND u.latency_ms > 0
      AND datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)
      AND ((a.scope_kind = 'company' AND a.company_id = ?) OR (a.scope_kind = 'project' AND a.project_id IN (SELECT p.id FROM projects p WHERE p.company_id = ?)))
  ), per AS (
    SELECT skill_id, latency_ms, ROW_NUMBER() OVER (PARTITION BY skill_id ORDER BY latency_ms) AS rn, COUNT(*) OVER (PARTITION BY skill_id) AS n FROM r
  )
  SELECT skill_id, latency_ms, rn, n FROM per WHERE rn = (n * 50 + 99) / 100 OR rn = (n * 95 + 99) / 100`;

type VersionRead = { id: number; uid: string; slug: string | null; current_version: number; required_models_json: string | null; evidence_json: string | null; cases_json: string | null };
type EvalRead = { skill_id: number; case_key: string; model_id: string; result: 'pass' | 'fail' | 'not_run'; run_at: string | null; evaluator_version: number | null; case_sha256: string | null };
type OutcomeRead = { skill_id: number; kind: 'run' | 'refused'; code: string | null; http_status: number | null; version: number | null; n: number; first_at: string | null };
type LatencyRead = { skill_id: number; latency_ms: number; rn: number; n: number };

/** Stage 4's facts per HQ skill id. Throws on a failed read; the caller says so. */
async function qualityFacts(env: Env, rows: readonly { id: number }[], now: Date): Promise<Map<number, QualityFacts>> {
  const out = new Map<number, QualityFacts>();
  if (!rows.length) return out;
  const [versions, evals] = await Promise.all([
    env.DB.prepare(VERSIONS_SQL).bind(ids(rows)).all<VersionRead>(),
    env.DB.prepare(EVALS_SQL).bind(ids(rows)).all<EvalRead>(),
  ]);
  const bySkill = new Map<number, EvalRead[]>();
  for (const r of evals.results ?? []) {
    const list = bySkill.get(Number(r.skill_id));
    if (list) list.push(r); else bySkill.set(Number(r.skill_id), [r]);
  }
  for (const v of versions.results ?? []) {
    const live = parse<LiveCaseRow[]>(v.cases_json, []);
    const keys = (await goldenCasesFrom(v.slug, live)).map((k) => k.key);
    const manifest = parseEvidence(v.evidence_json) as (ReturnType<typeof parseEvidence> & {
      bar?: { pass?: number; total?: number }; review?: { decided_at?: string | null } | null;
    }) | null;
    const declared = requiredModels(env, v.required_models_json);
    const fromManifest = manifest?.models?.required?.length ? { required: [...new Set(manifest.models.required)].sort(), source: 'version_evidence' as const } : null;
    const models = fromManifest ?? declared;
    const wanted = new Set(keys.flatMap((k) => models.required.map((m) => `${k}\u0000${m}`)));
    const counted = (bySkill.get(Number(v.id)) ?? []).filter((r) => wanted.has(`${r.case_key}\u0000${r.model_id}`));
    const counts: ResultCounts = { pass: 0, fail: 0, not_run: 0 };
    const byModel: Record<string, ResultCounts> = {};
    const evaluators = new Set<number>();
    let onCurrent = 0, caseText = 0;
    for (const r of counted) {
      counts[r.result]++;
      (byModel[r.model_id] ??= { pass: 0, fail: 0, not_run: 0 })[r.result]++;
      if (r.evaluator_version != null) { evaluators.add(Number(r.evaluator_version)); if (Number(r.evaluator_version) === EVALUATOR.version) onCurrent++; }
      if (r.case_sha256 == null) caseText++;
    }
    // A result whose run time does not parse leaves the oldest unknown: freshness cannot be judged.
    const times = counted.map((r) => ({ at: r.run_at, ms: msOf(r.run_at) }));
    const known = times.filter((x): x is { at: string; ms: number } => x.ms != null).sort((a, b) => a.ms - b.ms);
    const unknownTime = known.length < times.length;
    const newest = known.length ? known[known.length - 1].at : null;
    const oldest = unknownTime || !known.length ? null : known[0];
    out.set(Number(v.id), {
      version: Number(v.current_version),
      release: manifest ? {
        evidence_hash: manifest.evidence_hash, suite_revision: manifest.suite?.revision ?? '', cases: manifest.suite?.cases?.length ?? 0,
        evaluator_version: Number(manifest.evaluator_version), models: [...(manifest.models?.required ?? [])], models_source: manifest.models?.source ?? 'default',
        pass: Number(manifest.bar?.pass ?? 0), total: Number(manifest.bar?.total ?? 0), approved_at: manifest.review?.decided_at ?? null,
      } : null,
      now: { suite_revision: await suiteRevision(live.map((k) => k.uid)), evaluator_version: EVALUATOR.version, models: declared.required },
      suite: { cases: keys.length, models: models.required, models_source: models.source },
      results: {
        units: keys.length * models.required.length, recorded: counted.length, counts, by_model: byModel,
        evaluator_versions: [...evaluators].sort((a, b) => a - b), on_current_evaluator: onCurrent, case_text_not_recorded: caseText,
        newest_run_at: newest, oldest_run_at: oldest?.at ?? null,
        hours_since_oldest: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.ms) / 3_600_000)) : null,
      },
    });
  }
  return out;
}

/** Stage 5's facts per skill id, over this company's agents. Throws when the outcomes cannot be read. */
async function operationalFacts(env: Env, rows: readonly { id: number; version: number }[], companyId: number, now: Date): Promise<Map<number, OperationalFacts>> {
  const out = new Map<number, OperationalFacts>();
  if (!rows.length) return out;
  const w = executionsWindow(null, now);
  const binds = [ids(rows), w.since, w.until, companyId, companyId];
  const outcomes = (await env.DB.prepare(OUTCOMES_SQL).bind(...binds).all<OutcomeRead>()).results ?? [];
  let latency: LatencyRead[] | null;
  try { latency = (await env.DB.prepare(LATENCY_SQL).bind(...binds).all<LatencyRead>()).results ?? []; } catch { latency = null; }
  for (const s of rows) {
    const t = { completed: 0, refused: 0, failed: 0, retryable: 0, version_not_recorded: 0, attributed_since: null as string | null };
    for (const r of outcomes.filter((o) => Number(o.skill_id) === s.id)) {
      const n = Number(r.n);
      if (r.version == null) { t.version_not_recorded += n; continue; }
      if (Number(r.version) !== s.version) continue;
      if (r.first_at && (t.attributed_since == null || (msOf(r.first_at) ?? Infinity) < (msOf(t.attributed_since) ?? Infinity))) t.attributed_since = r.first_at;
      if (r.kind === 'run') t.completed += n;
      else if (FAILED_CODES.has(String(r.code))) t.failed += n;
      else if (isRetryable(String(r.code), r.http_status == null ? null : Number(r.http_status))) t.retryable += n;
      else t.refused += n;
    }
    const ranks = latency?.filter((l) => Number(l.skill_id) === s.id) ?? [];
    const n = ranks.length ? Number(ranks[0].n) : 0;
    const at = (p: number) => ranks.find((r) => Number(r.rn) === Math.floor((n * p + 99) / 100))?.latency_ms;
    const p50 = at(50), p95 = at(95);
    out.set(s.id, {
      version: s.version, window: { since: w.since, until: w.until, days: w.days }, outcomes: t,
      model_latency_ms: latency == null ? LATENCY_UNREADABLE : p50 == null || p95 == null ? NO_LATENCY : { p50: Number(p50), p95: Number(p95), runs_measured: n },
    });
  }
  return out;
}

/** Every required input `unreadable`: what a preflight that threw leaves the gate to say. */
function unreadableInputs(slug: string, venture: boolean): InputFacts {
  const skill = FIRST_TEN.find((s) => s.slug === slug)!;
  return {
    state: 'not_ready', venture, limits: ['The inputs could not be read.'], paths: null,
    inputs: skill.needs.map((n) => ({ field: n.field, read: n.read, required: n.required, status: n.required ? 'unreadable' : 'absent_optional' })),
  };
}

/**
 * The catalogue with stages 3 to 5's facts added to each skill that passes the cheap gate for `agent`. `rows` is
 * keyed by uid; a skill with no row gets nothing. Never throws for a read: an unreadable one is said on the skill.
 */
export async function withDiscoveryEvidence(env: Env, skills: readonly DiscoverySkill[], rows: ReadonlyMap<string, EvidenceRow>, agent: DiscoveryAgent, ctx: EvidenceContext): Promise<DiscoverySkill[]> {
  const open = skills.filter((s) => rows.has(s.uid) && gateOf(s, agent, ctx.output_kind) === null);
  const venture = ctx.scope.kind === 'project';
  const projectId = ctx.scope.kind === 'project' ? ctx.scope.id : null;
  const runRefusal = ctx.agent.source === 'mcp_client' ? 'outside_assistant' as const : ctx.agent.status !== 'active' ? 'agent_paused' as const : null;

  const hq = open.filter((s) => s.scope === 'hq').map((s) => ({ id: rows.get(s.uid)!.id }));
  let quality: Map<number, QualityFacts> | null;
  try { quality = await qualityFacts(env, hq, ctx.now); } catch { quality = null; }
  let operations: Map<number, OperationalFacts> | null = new Map();
  if (ctx.companyId != null) {
    try { operations = await operationalFacts(env, open.map((s) => ({ id: rows.get(s.uid)!.id, version: Number(s.version) })), ctx.companyId, ctx.now); } catch { operations = null; }
  }

  const facts = new Map<string, Partial<DiscoverySkill>>();
  for (const s of open) {
    const row = rows.get(s.uid)!;
    const f: Partial<DiscoverySkill> = { runnable: runRefusal ? { ok: false, code: runRefusal } : { ok: true } };
    if (s.slug && FIRST_TEN_SLUGS.includes(s.slug)) {
      try {
        const p = await preflight(env, s.slug, { scope: ctx.scope, agent: ctx.agent, projectId, document: null, fund: null }, ctx.readers, ctx.now.getTime(),
          undefined, {}, { granted: ctx.rules.reads });
        f.inputs = p ? { state: p.state, venture, limits: p.limits, paths: p.paths, inputs: p.inputs.map((i) => ({
          field: i.field, read: i.read, required: i.required, status: i.status, ...(i.reason ? { reason: i.reason } : {}), ...(i.source ? { source: i.source } : {}),
        })) } : null;
      } catch { f.inputs = unreadableInputs(s.slug, venture); }
    }
    f.quality = s.scope === 'company' ? COMPANY_SKILL : quality == null ? QUALITY_UNREADABLE : quality.get(row.id) ?? QUALITY_UNREADABLE;
    f.operations = ctx.companyId == null
      ? { available: false, reason: 'The agent has no company, so no company\'s runs are read.' }
      : operations == null ? OPERATIONS_UNREADABLE : operations.get(row.id) ?? OPERATIONS_UNREADABLE;
    facts.set(s.uid, f);
  }
  return skills.map((s) => (facts.has(s.uid) ? { ...s, ...facts.get(s.uid) } : s));
}
