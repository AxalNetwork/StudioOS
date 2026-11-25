/**
 * D5586 (#5586 part 1): the swarm's capacity read model, its cost attribution and its throughput figures, plus the
 * bottleneck signals the platform records today. Preview-only and unmounted: no route, cron or screen reads it.
 *
 * Every figure is either measured or says it is not: `not_recorded` when the platform keeps no record of it (CI wait,
 * egress, transcoding), `unavailable` when a record exists but could not be read or priced. Neither is ever 0.
 */
import type { Env } from '../../types';
import { validateWorkGraph, type Scope, type ValidationContext } from '../workGraphContracts';
import { MODALITIES, MODALITY_CLASS, MODALITY_LANE, budgetCommitted, storageReserved, ventureKey, type Modality, type SwarmState, type SwarmTicket, type VenturePolicy } from './swarmAdmission';

export const NOT_RECORDED = 'not_recorded' as const;
export type NotRecorded = typeof NOT_RECORDED;
export type Figure = number | NotRecorded;

/** Nearest-rank percentile of recorded samples; `not_recorded` when there are none. */
export function percentile(values: readonly number[], p: number): Figure {
  const xs = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!xs.length) return NOT_RECORDED;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
}

// ---- cost attribution ---------------------------------------------------------------------------------------------
/** The cost sources #5586 names. Human approval delay is time, not money, and is reported beside them. */
export const SWARM_COST_CATEGORIES = ['ai_inference', 'compute', 'gpu', 'storage_gb_month', 'requests', 'egress', 'stream_output', 'ci_minutes'] as const;
export type SwarmCostCategory = typeof SWARM_COST_CATEGORIES[number];
/** Where a settled ticket's bill is attributed. A publication's own charge is its provider requests. */
export const MODALITY_COST_CATEGORY: Readonly<Record<Modality, SwarmCostCategory>> = Object.freeze({
  code: 'compute', document: 'ai_inference', brand_image: 'ai_inference', video_render: 'gpu', final_publication: 'requests',
});
export type CostEntry = { venture: string; modality: Modality | null; category: SwarmCostCategory; microusd: number | 'unavailable'; basis: 'measured' | 'reserve' | 'vendor_unpriced' };
export type CategoryCost = { known_microusd: number; estimated_microusd: number; unpriced_entries: number; total: number | 'unavailable' | NotRecorded };

/** A settled ticket's bill. `measured: false` was charged its reserve: an upper bound, never presented as measured. */
export function costEntriesFromTickets(tickets: readonly SwarmTicket[]): CostEntry[] {
  return tickets.filter(t => t.state === 'settled' && Number.isSafeInteger(t.charged_microusd)).map(t => ({
    venture: ventureKey(t), modality: t.modality, category: MODALITY_COST_CATEGORY[t.modality], microusd: t.charged_microusd as number,
    basis: t.measured ? 'measured' as const : 'reserve' as const,
  }));
}

/**
 * Sum entries per category. A category with no entry is `not_recorded`; one with an unpriced entry has a total of
 * `unavailable` (its known part is still shown), so an unknown vendor cost never reads as 0.
 */
export function attributeCosts(entries: readonly CostEntry[]): Record<SwarmCostCategory, CategoryCost> & { total: number | 'unavailable' | NotRecorded } {
  const out = {} as Record<SwarmCostCategory, CategoryCost>;
  for (const c of SWARM_COST_CATEGORIES) {
    const mine = entries.filter(e => e.category === c);
    const priced = mine.filter(e => Number.isSafeInteger(e.microusd) && (e.microusd as number) >= 0);
    const unpriced = mine.length - priced.length;
    const known = priced.filter(e => e.basis === 'measured').reduce((s, e) => s + (e.microusd as number), 0);
    const estimated = priced.filter(e => e.basis !== 'measured').reduce((s, e) => s + (e.microusd as number), 0);
    out[c] = { known_microusd: known, estimated_microusd: estimated, unpriced_entries: unpriced,
      total: !mine.length ? NOT_RECORDED : unpriced ? 'unavailable' : known + estimated };
  }
  const totals = SWARM_COST_CATEGORIES.map(c => out[c].total);
  const total = totals.every(t => t === NOT_RECORDED) ? NOT_RECORDED
    : totals.some(t => t === 'unavailable') ? 'unavailable' as const
      : totals.reduce<number>((s, t) => s + (typeof t === 'number' ? t : 0), 0);
  return { ...out, total };
}

// ---- throughput ---------------------------------------------------------------------------------------------------
/**
 * Queue wait, run time and time to an approved deliverable, from recorded timestamps only. `approvedAt` maps a
 * ticket uid (the agent run) to when its output was first accepted with an approval (see `readApprovals`). A ticket
 * never approved is counted, never given a time.
 */
export function throughput(tickets: readonly SwarmTicket[], approvedAt: ReadonlyMap<string, number>, window: { from: number; to: number }) {
  const inWindow = tickets.filter(t => t.enqueued_at >= window.from && t.enqueued_at < window.to);
  const wait = inWindow.filter(t => t.admitted_at !== null).map(t => (t.admitted_at as number) - t.enqueued_at);
  const run = inWindow.filter(t => t.settled_at !== null && t.admitted_at !== null).map(t => (t.settled_at as number) - (t.admitted_at as number));
  const settled = inWindow.filter(t => t.state === 'settled');
  const approved = settled.filter(t => approvedAt.has(t.ticket_uid));
  const tta = approved.map(t => (approvedAt.get(t.ticket_uid) as number) - t.enqueued_at);
  const approvalDelay = approved.filter(t => t.settled_at !== null).map(t => Math.max(0, (approvedAt.get(t.ticket_uid) as number) - (t.settled_at as number)));
  const hours = (window.to - window.from) / 3_600_000;
  return {
    requested: inWindow.length, settled: settled.length, approved: approved.length, settled_unapproved: settled.length - approved.length,
    approved_per_hour: approved.length && hours > 0 ? approved.length / hours : NOT_RECORDED,
    queue_wait_ms: { p50: percentile(wait, 50), p95: percentile(wait, 95) },
    run_ms: { p50: percentile(run, 50), p95: percentile(run, 95) },
    time_to_approved_ms: { p50: percentile(tta, 50), p95: percentile(tta, 95) },
    human_approval_delay_ms: { p50: percentile(approvalDelay, 50), p95: percentile(approvalDelay, 95) },
  };
}

// ---- bottlenecks from D1 ------------------------------------------------------------------------------------------
export type Signal<T> = T | NotRecorded | 'unavailable';
export type Bottlenecks = {
  d1_conflicts: Signal<{ head_moves: number; refused: number; stale: number; conflict_rate: Figure }>;
  agent_planning_overlap: Signal<{ lease_grants: number; busy: number; overlap_rate: Figure }>;
  outbox: Signal<{ pending: number; claimed: number; dead: number; oldest_pending_age_ms: Figure }>;
  r2_uploads: Signal<{ puts: number; refused: number; class_a_ops: number; cost_microusd: 'unavailable' }>;
  review_queue: Signal<{ awaiting: number; oldest_age_ms: Figure }>;
  image_model_capacity: NotRecorded; github_pr_ci_wait: NotRecorded; preview_transcoding: NotRecorded; egress: NotRecorded;
};
const outOfScope = (ctx: ValidationContext, scope: Scope) => validateWorkGraph({ assets: [{ id: 'x', scope, kind: 'composite', headVersionId: null, accessClass: 'internal', approvalPolicy: 'x' }] }, ctx)
  .some(v => v.code === 'wrong_tenant');
const rate = (part: number, whole: number): Figure => (whole > 0 ? part / whole : NOT_RECORDED);
const age = (now: number, iso: string | null | undefined): Figure => {
  const t = iso ? Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`) : NaN;
  return Number.isFinite(t) ? Math.max(0, now - t) : NOT_RECORDED;
};
async function signal<T>(read: () => Promise<T>): Promise<Signal<T>> {
  try { return await read(); } catch { return 'unavailable'; }
}
const n = (v: unknown) => Number(v ?? 0);

/**
 * The bottleneck signals one venture's records hold since `sinceIso`. A caller outside the scope is refused
 * `wrong_tenant` before any read; every statement is bound to the scope's tenant and company. A statement that fails
 * makes only its own signal `unavailable`.
 */
export async function readBottlenecks(env: Pick<Env, 'DB'>, ctx: ValidationContext, scope: Scope, sinceIso: string, now: number)
  : Promise<{ ok: true; bottlenecks: Bottlenecks; statements: number } | { ok: false; code: 'wrong_tenant' | 'malformed' }> {
  if (!scope || !Number.isSafeInteger(scope.tenantId) || !Number.isSafeInteger(scope.companyId) || !Number.isFinite(Date.parse(sinceIso))) return { ok: false, code: 'malformed' };
  if (outOfScope(ctx, scope)) return { ok: false, code: 'wrong_tenant' };
  const t = scope.tenantId, c = scope.companyId;
  let statements = 0;
  const first = async <R>(sql: string, ...binds: unknown[]) => { statements++; return (await env.DB.prepare(sql).bind(...binds).first<R>()) ?? ({} as R); };
  const d1_conflicts = await signal(async () => {
    const r = await first<{ moves: number; refused: number; stale: number }>(
      `SELECT SUM(action = 'advance_head') AS moves, SUM(action = 'advance_refused') AS refused,
              SUM(action = 'advance_refused' AND refusal_code = 'stale_revision') AS stale
         FROM work_graph_events
        WHERE tenant_id = ? AND company_id = ? AND action IN ('advance_head', 'advance_refused') AND datetime(created_at) >= datetime(?)`, t, c, sinceIso);
    return { head_moves: n(r.moves), refused: n(r.refused), stale: n(r.stale), conflict_rate: rate(n(r.stale), n(r.moves) + n(r.refused)) };
  });
  const agent_planning_overlap = await signal(async () => {
    const r = await first<{ grants: number; busy: number }>(
      `SELECT SUM(action = 'acquire') AS grants, SUM(action = 'busy') AS busy FROM work_graph_lease_events
        WHERE tenant_id = ? AND company_id = ? AND action IN ('acquire', 'busy') AND datetime(created_at) >= datetime(?)`, t, c, sinceIso);
    return { lease_grants: n(r.grants), busy: n(r.busy), overlap_rate: rate(n(r.busy), n(r.grants) + n(r.busy)) };
  });
  const outbox = await signal(async () => {
    const r = await first<{ pending: number; claimed: number; dead: number; oldest: string | null }>(
      `SELECT SUM(state = 'pending') AS pending, SUM(state = 'claimed') AS claimed, SUM(state = 'dead') AS dead,
              MIN(CASE WHEN state IN ('pending', 'claimed') THEN created_at END) AS oldest
         FROM work_graph_effects WHERE tenant_id = ? AND company_id = ?`, t, c);
    return { pending: n(r.pending), claimed: n(r.claimed), dead: n(r.dead), oldest_pending_age_ms: age(now, r.oldest) };
  });
  const r2_uploads = await signal(async () => {
    const r = await first<{ puts: number; refused: number; a: number }>(
      `SELECT SUM(action = 'blob_put') AS puts, SUM(action = 'blob_refused') AS refused, SUM(r2_class_a) AS a
         FROM work_graph_integrity_events
        WHERE tenant_id = ? AND company_id = ? AND action IN ('blob_put', 'blob_refused') AND datetime(created_at) >= datetime(?)`, t, c, sinceIso);
    // The bucket's price per operation is not a record the platform holds, so the cost is unavailable, not 0.
    return { puts: n(r.puts), refused: n(r.refused), class_a_ops: n(r.a), cost_microusd: 'unavailable' as const };
  });
  const review_queue = await signal(async () => {
    // A manifest awaits review while it is newer than its line's published head; a superseded one does not.
    const r = await first<{ awaiting: number; oldest: string | null }>(
      `SELECT COUNT(*) AS awaiting, MIN(mf.created_at) AS oldest
         FROM work_graph_release_manifests mf
         JOIN work_graph_assets a ON a.asset_uid = mf.line_asset_uid
         JOIN work_graph_revisions r ON r.revision_uid = mf.manifest_uid
        WHERE mf.tenant_id = ? AND mf.company_id = ? AND a.tenant_id = ? AND a.company_id = ?
          AND r.seq > COALESCE((SELECT h.seq FROM work_graph_revisions h WHERE h.revision_uid = a.head_revision_uid), 0)`, t, c, t, c);
    return { awaiting: n(r.awaiting), oldest_age_ms: age(now, r.oldest) };
  });
  return { ok: true, statements, bottlenecks: {
    d1_conflicts, agent_planning_overlap, outbox, r2_uploads, review_queue,
    image_model_capacity: NOT_RECORDED, github_pr_ci_wait: NOT_RECORDED, preview_transcoding: NOT_RECORDED, egress: NOT_RECORDED,
  } };
}

/**
 * When each agent run's output was first accepted with an approval: the earliest applied `advance_head` event of
 * the scope that carries an approval and that run. Runs with none are absent from the map.
 */
export async function readApprovals(env: Pick<Env, 'DB'>, ctx: ValidationContext, scope: Scope, runIds: readonly string[])
  : Promise<{ ok: true; approvedAt: Map<string, number> } | { ok: false; code: 'wrong_tenant' }> {
  if (outOfScope(ctx, scope)) return { ok: false, code: 'wrong_tenant' };
  const approvedAt = new Map<string, number>();
  if (!runIds.length) return { ok: true, approvedAt };
  const rows = await env.DB.prepare(
    `SELECT agent_run_id, MIN(created_at) AS at FROM work_graph_events
      WHERE tenant_id = ? AND company_id = ? AND action = 'advance_head' AND outcome = 'applied' AND approval_ref IS NOT NULL
        AND agent_run_id IN (SELECT value FROM json_each(?))
      GROUP BY agent_run_id`,
  ).bind(scope.tenantId, scope.companyId, JSON.stringify(runIds.slice(0, 500))).all<{ agent_run_id: string; at: string }>();
  for (const r of rows.results ?? []) { const at = Date.parse(r.at); if (Number.isFinite(at)) approvedAt.set(r.agent_run_id, at); }
  return { ok: true, approvedAt };
}

// ---- the read model -----------------------------------------------------------------------------------------------
type Counts = { live: number; waiting: number; settled: number; withdrawn: number };
const counts = (ts: readonly SwarmTicket[]): Counts => ({
  live: ts.filter(t => t.state === 'admitted').length, waiting: ts.filter(t => t.state === 'waiting').length,
  settled: ts.filter(t => t.state === 'settled').length, withdrawn: ts.filter(t => t.state === 'withdrawn').length,
});
const group = <K extends string>(ts: readonly SwarmTicket[], key: (t: SwarmTicket) => K) => {
  const m = {} as Record<K, SwarmTicket[]>;
  for (const t of ts) (m[key(t)] ??= []).push(t);
  return m;
};
export type CapacityAlert = { code: 'kill_switch_on' | 'venture_halted' | 'budget_low' | 'budget_unverified' | 'storage_low' | 'storage_unverified' | 'queue_near_full' | 'audit_dropped'; venture?: string };

/**
 * The capacity read model: per modality, venture (tenant), team, provider, budget, storage and backlog, with the
 * bottleneck signals and the alerts. `scope` narrows it to one venture (a tenant's own view); null is HQ's whole
 * view. `registeredAgents` is held apart from executions: registered agents hold no capacity.
 */
export function capacityReadModel(input: {
  swarm: SwarmState; now: number; halted: boolean; scope: { tenant_id: number; company_id: number } | null;
  ventures: Readonly<Record<string, { policy: VenturePolicy; storage_used_bytes: number | null }>>;
  registeredAgents: number | null; bottlenecks: Bottlenecks | null;
}) {
  const only = input.scope ? ventureKey(input.scope) : null;
  const tickets = Object.values(input.swarm.tickets).filter(t => only === null || ventureKey(t) === only);
  const alerts: CapacityAlert[] = [];
  if (input.halted) alerts.push({ code: 'kill_switch_on' });
  if (input.swarm.audit_dropped > 0 && only === null) alerts.push({ code: 'audit_dropped' });
  const ventureKeys = [...new Set([...tickets.map(ventureKey), ...Object.keys(input.ventures).filter(k => only === null || k === only)])].sort();
  const byVenture = Object.fromEntries(ventureKeys.map(key => {
    const mine = tickets.filter(t => ventureKey(t) === key);
    const v = input.ventures[key];
    const committed = budgetCommitted(input.swarm, key);
    const budgetLimit = v && Number.isSafeInteger(v.policy.render_budget_microusd) ? v.policy.render_budget_microusd as number : null;
    const quota = v && Number.isSafeInteger(v.policy.storage_quota_bytes) ? v.policy.storage_quota_bytes as number : null;
    const used = v && Number.isSafeInteger(v.storage_used_bytes) ? v.storage_used_bytes as number : null;
    if (v?.policy.halted) alerts.push({ code: 'venture_halted', venture: key });
    if (budgetLimit === null) alerts.push({ code: 'budget_unverified', venture: key });
    else if (budgetLimit - committed < budgetLimit / 10) alerts.push({ code: 'budget_low', venture: key });
    if (quota === null || used === null) alerts.push({ code: 'storage_unverified', venture: key });
    else if (quota - used - storageReserved(input.swarm, key) < quota / 10) alerts.push({ code: 'storage_low', venture: key });
    const waiting = mine.filter(t => t.state === 'waiting').length;
    if (v && waiting >= Math.ceil(v.policy.max_waiting * 0.8)) alerts.push({ code: 'queue_near_full', venture: key });
    return [key, { ...counts(mine), max_concurrent: v ? v.policy.max_concurrent : NOT_RECORDED,
      budget: budgetLimit === null ? NOT_RECORDED : { limit_microusd: budgetLimit, committed_microusd: committed, remaining_microusd: budgetLimit - committed },
      storage: quota === null || used === null ? NOT_RECORDED : { quota_bytes: quota, used_bytes: used, reserved_bytes: storageReserved(input.swarm, key) },
      costs: attributeCosts(costEntriesFromTickets(mine)) }];
  }));
  const byModality = Object.fromEntries(MODALITIES.map(m => [m, { work_class: MODALITY_CLASS[m], lane: MODALITY_LANE[m], ...counts(tickets.filter(t => t.modality === m)) }]));
  const byTeam = Object.fromEntries(Object.entries(group(tickets, t => (t.team_id === null ? 'unassigned' : `team${t.team_id}`))).map(([k, v]) => [k, counts(v)]));
  const byProvider = Object.fromEntries(Object.entries(group(tickets, t => t.provider)).map(([k, v]) => [k, counts(v)]));
  const waiting = tickets.filter(t => t.state === 'waiting');
  const byReason = Object.fromEntries(Object.entries(group(waiting, t => t.wait_reason ?? 'unknown')).map(([k, v]) => [k, v.length]));
  return {
    preview: true as const,
    registered_agents: Number.isSafeInteger(input.registeredAgents) ? input.registeredAgents as number : NOT_RECORDED,
    executions: tickets.filter(t => t.state === 'admitted').length,
    by_modality: byModality, by_venture: byVenture, by_team: byTeam, by_provider: byProvider,
    backlog: { waiting: waiting.length, by_reason: byReason, render_backlog: waiting.filter(t => t.modality === 'video_render').length,
      oldest_wait_ms: waiting.length ? Math.max(...waiting.map(t => input.now - t.enqueued_at)) : NOT_RECORDED },
    costs: attributeCosts(costEntriesFromTickets(tickets)),
    bottlenecks: input.bottlenecks ?? NOT_RECORDED,
    alerts,
  };
}
