/**
 * D1604 (#3731, #2409 part 2) — PostHog's metrics foundation: what a founder
 * tracks, what a sync lands, what waits for Accept, and how each module reads
 * it. Parts 3–6 sync into these stores; nothing here calls PostHog.
 *
 * TRACKED METRICS. A saved insight the founder picks and gives a role (what
 * it measures) and a module (where it shows). The role is the founder's:
 * never guessed from event names. Its `uid` names the venture's KPI
 * `posthog-<uid>`, which reads only PostHog facts; a hand entry for it is
 * refused (`growKpis.ts`).
 *
 * FACTS. `landFact` writes one aggregate and its `connector_fed_items` row
 * (migration 445). A re-sync updates it in place. A fact the founder deleted
 * keeps its ledger row with no `local_id` and is never written again.
 *
 * PROPOSALS. `proposeOnce` keeps one row per kind and source: a decided one
 * is never proposed again. Accept runs the kind's acceptor (`registerAcceptor`,
 * parts 3–6), which writes through the module's own writer; until a part
 * registers one, Accept answers `not_ready` and writes nothing.
 *
 * NEVER A ZERO. A tracked metric with no fact reads "Not recorded"; with its
 * connection gone or broken, "Not recorded: PostHog is disconnected".
 *
 * All SQL is bound; none is interpolated. Nothing here logs a value, a name or
 * a survey answer.
 */
import type { Env } from '../../types';

export type Section = 'validate' | 'build' | 'raise' | 'grow';

/** The modules PostHog feeds, by `MODULE_LABELS` key, with their section and words (#2409 § Module map). */
export const POSTHOG_MODULES: Readonly<Record<string, { section: Section; label: string }>> = Object.freeze({
  experiments: { section: 'validate', label: 'Experiments and evidence' },
  demand_signals: { section: 'validate', label: 'Demand and urgency signals' },
  prototype_mvp: { section: 'build', label: 'Prototype / MVP' },
  product_roadmap: { section: 'build', label: 'Product roadmap' },
  operating_systems: { section: 'build', label: 'Operating systems' },
  fundraising_readiness: { section: 'raise', label: 'Fundraising readiness' },
  investor_narrative: { section: 'raise', label: 'Investor narrative' },
  pitch_deck: { section: 'raise', label: 'Pitch deck' },
  revenue_and_traction: { section: 'grow', label: 'Revenue and traction' },
  product_improvement: { section: 'grow', label: 'Product improvement' },
});
export const SECTIONS: readonly Section[] = Object.freeze(['validate', 'build', 'raise', 'grow']);
export const modulesOf = (s: Section) => Object.keys(POSTHOG_MODULES).filter((k) => POSTHOG_MODULES[k].section === s);

/** What a tracked insight measures, as the founder says. */
export const ROLES = Object.freeze(['active_users', 'new_users', 'activation', 'retention', 'conversion', 'sessions', 'other'] as const);
export type Role = (typeof ROLES)[number];
export const ROLE_WORDS: Readonly<Record<Role, string>> = Object.freeze({
  active_users: 'Active users', new_users: 'New users', activation: 'Activation', retention: 'Retention',
  conversion: 'Conversion', sessions: 'Sessions', other: 'Other',
});
/** A rate is a percentage; anything else a count. */
export const unitOf = (role: Role): 'count' | 'pct' => (role === 'activation' || role === 'retention' || role === 'conversion' ? 'pct' : 'count');

export const FACT_KINDS = Object.freeze(['metric', 'web_overview', 'experiment_result', 'flag_state', 'survey_stats'] as const);
export type FactKind = (typeof FACT_KINDS)[number];
export const PROPOSAL_KINDS = Object.freeze(['experiment_evidence', 'survey_signal', 'survey_feedback', 'flag_link', 'flag_shipped'] as const);
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const KPI_PREFIX = 'posthog-';
export const HAND_ENTRY_REFUSED = 'This figure comes from PostHog.';
export const NOT_RECORDED = 'Not recorded';
export const DISCONNECTED = 'Not recorded: PostHog is disconnected';

export class MetricsRefused extends Error {
  status: number; code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

// ── The link ─────────────────────────────────────────────────────────────

export interface PosthogLink { integration_id: number; integration_uid: string; posthog_project_id: string; owner_id: number; active: boolean }

/** The venture's linked PostHog project and whose connection serves it; null with no link. */
export async function linkOf(env: Env, projectId: number): Promise<PosthogLink | null> {
  const r = await env.DB.prepare(
    'SELECT l.integration_id, i.uid AS integration_uid, l.posthog_project_id, i.user_id AS owner_id, i.status FROM posthog_project_links l ' +
    'JOIN integrations i ON i.id = l.integration_id WHERE l.project_id = ?',
  ).bind(projectId).first<{ integration_id: number; integration_uid: string; posthog_project_id: string; owner_id: number; status: string }>();
  return r ? {
    integration_id: Number(r.integration_id), integration_uid: String(r.integration_uid), posthog_project_id: String(r.posthog_project_id),
    owner_id: Number(r.owner_id), active: r.status === 'active',
  } : null;
}

// ── Tracked metrics ──────────────────────────────────────────────────────

export interface TrackedMetric {
  id: number; uid: string; integration_id: number; project_id: number; insight_short_id: string; insight_name: string | null;
  role: Role; module: string; unit: 'count' | 'pct'; created_at: string;
}

export async function trackedOf(env: Env, projectId: number, module?: string): Promise<TrackedMetric[]> {
  const r = await env.DB.prepare(
    'SELECT * FROM posthog_tracked_metrics WHERE project_id = ? AND (? IS NULL OR module = ?) ORDER BY lower(COALESCE(insight_name, insight_short_id)), id',
  ).bind(projectId, module ?? null, module ?? null).all<TrackedMetric>();
  return r.results || [];
}

/** One tracked metric of this venture by its uid; another venture's is not found. */
export async function trackedByUid(env: Env, projectId: number, uid: string): Promise<TrackedMetric | null> {
  if (!/^[0-9a-f]{32}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM posthog_tracked_metrics WHERE uid = ? AND project_id = ?').bind(uid, projectId).first<TrackedMetric>();
}

export interface TrackInput { integrationId: number; projectId: number; userId: number; insight: { short_id: string; name: string | null }; role: unknown; module: unknown }

/** Track one saved insight for one module. The same insight in the same module twice is the one row. */
export async function track(env: Env, t: TrackInput): Promise<TrackedMetric> {
  const role = typeof t.role === 'string' && (ROLES as readonly string[]).includes(t.role) ? t.role as Role : null;
  if (!role) throw new MetricsRefused(400, 'invalid_role');
  const module = typeof t.module === 'string' && POSTHOG_MODULES[t.module] ? t.module : null;
  if (!module) throw new MetricsRefused(400, 'invalid_module');
  const uid = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    'INSERT INTO posthog_tracked_metrics (uid, integration_id, project_id, insight_short_id, insight_name, role, module, unit, created_by) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, insight_short_id, module) DO UPDATE SET role = excluded.role, unit = excluded.unit, ' +
    'insight_name = excluded.insight_name, integration_id = excluded.integration_id',
  ).bind(uid, t.integrationId, t.projectId, t.insight.short_id, t.insight.name ? t.insight.name.slice(0, 200) : null, role, module, unitOf(role), t.userId).run();
  return (await env.DB.prepare('SELECT * FROM posthog_tracked_metrics WHERE project_id = ? AND insight_short_id = ? AND module = ?')
    .bind(t.projectId, t.insight.short_id, module).first<TrackedMetric>())!;
}

/** Stop tracking: the metric and its facts go; a KPI or roadmap item naming it then reads Not recorded. */
export async function untrack(env: Env, projectId: number, uid: string): Promise<boolean> {
  const m = await trackedByUid(env, projectId, uid);
  if (!m) return false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM posthog_metric_facts WHERE project_id = ? AND kind = 'metric' AND fact_key = ?").bind(projectId, `metric:${uid}`),
    env.DB.prepare('DELETE FROM posthog_tracked_metrics WHERE id = ?').bind(m.id),
  ]);
  return true;
}

// ── Facts ────────────────────────────────────────────────────────────────

export interface FactInput {
  module: string; kind: FactKind; fact_key: string; period: string;
  value: number | null; value_json?: Record<string, unknown> | null; source_ref?: string | null; label?: string | null; as_of: string;
}
export interface LandContext { integrationId: number; projectId: number }

const externalIdOf = (ctx: LandContext, f: Pick<FactInput, 'fact_key' | 'period'>) => `posthog:fact:${ctx.projectId}:${f.fact_key}:${f.period}`;

/**
 * Land one fact: a new row, an update of the same fact and period, or nothing
 * when the founder deleted it ("deleted stays deleted").
 */
export async function landFact(env: Env, ctx: LandContext, f: FactInput): Promise<'written' | 'updated' | 'kept_deleted'> {
  if (!POSTHOG_MODULES[f.module]) throw new MetricsRefused(400, 'invalid_module');
  if (!(FACT_KINDS as readonly string[]).includes(f.kind)) throw new MetricsRefused(400, 'invalid_kind');
  const ext = externalIdOf(ctx, f);
  const ledger = await env.DB.prepare('SELECT id, local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?')
    .bind(ctx.integrationId, ext).first<{ id: number; local_id: number | null }>();
  if (ledger && ledger.local_id == null) return 'kept_deleted';
  const json = f.value_json ? JSON.stringify(f.value_json).slice(0, 8000) : null;
  const value = f.value != null && Number.isFinite(f.value) ? f.value : null;
  await env.DB.prepare(
    'INSERT INTO posthog_metric_facts (integration_id, project_id, module, kind, fact_key, period, value, value_json, source_ref, label, as_of) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(integration_id, project_id, fact_key, period) DO UPDATE SET ' +
    "value = excluded.value, value_json = excluded.value_json, source_ref = excluded.source_ref, label = excluded.label, as_of = excluded.as_of, updated_at = datetime('now')",
  ).bind(ctx.integrationId, ctx.projectId, f.module, f.kind, f.fact_key, f.period, value, json, f.source_ref ?? null, f.label ? f.label.slice(0, 200) : null, f.as_of).run();
  const row = await env.DB.prepare('SELECT id FROM posthog_metric_facts WHERE integration_id = ? AND project_id = ? AND fact_key = ? AND period = ?')
    .bind(ctx.integrationId, ctx.projectId, f.fact_key, f.period).first<{ id: number }>();
  await env.DB.prepare(
    'INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP',
  ).bind(ctx.integrationId, ctx.projectId, f.module, `posthog_${f.kind}`, ext, 'posthog_metric_facts', row!.id).run();
  return ledger ? 'updated' : 'written';
}

/** Delete a fact; its ledger row stays with no `local_id`, so no sync brings it back. */
export async function deleteFact(env: Env, projectId: number, id: number): Promise<boolean> {
  const f = await env.DB.prepare('SELECT id, integration_id, fact_key, period FROM posthog_metric_facts WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<{ id: number; integration_id: number; fact_key: string; period: string }>();
  if (!f) return false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM posthog_metric_facts WHERE id = ?').bind(f.id),
    env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL, last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?')
      .bind(f.integration_id, externalIdOf({ integrationId: f.integration_id, projectId }, f)),
  ]);
  return true;
}

export interface FactRow { id: number; module: string; kind: FactKind; fact_key: string; period: string; value: number | null; value_json: string | null; source_ref: string | null; label: string | null; as_of: string }

export async function factsOf(env: Env, projectId: number, module?: string): Promise<FactRow[]> {
  const r = await env.DB.prepare(
    'SELECT id, module, kind, fact_key, period, value, value_json, source_ref, label, as_of FROM posthog_metric_facts ' +
    'WHERE project_id = ? AND (? IS NULL OR module = ?) ORDER BY kind, fact_key, period',
  ).bind(projectId, module ?? null, module ?? null).all<FactRow>();
  return r.results || [];
}

// ── Proposals ────────────────────────────────────────────────────────────

export interface ProposalRow { id: number; integration_id: number; project_id: number; module: string; kind: ProposalKind; source_key: string; payload_json: string; status: string; target_ref: string | null }

/** Propose once: a pending one is refreshed, a decided one is left as it is and never proposed again. */
export async function proposeOnce(env: Env, ctx: LandContext, p: { module: string; kind: ProposalKind; source_key: string; payload: Record<string, unknown> }): Promise<'proposed' | 'refreshed' | 'decided'> {
  if (!POSTHOG_MODULES[p.module]) throw new MetricsRefused(400, 'invalid_module');
  if (!(PROPOSAL_KINDS as readonly string[]).includes(p.kind)) throw new MetricsRefused(400, 'invalid_kind');
  const old = await env.DB.prepare('SELECT status FROM posthog_proposals WHERE integration_id = ? AND project_id = ? AND kind = ? AND source_key = ?')
    .bind(ctx.integrationId, ctx.projectId, p.kind, p.source_key).first<{ status: string }>();
  if (old && old.status !== 'pending') return 'decided';
  const payload = JSON.stringify(p.payload).slice(0, 16000);
  await env.DB.prepare(
    'INSERT INTO posthog_proposals (integration_id, project_id, module, kind, source_key, payload_json) VALUES (?, ?, ?, ?, ?, ?) ' +
    "ON CONFLICT(integration_id, project_id, kind, source_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = datetime('now') WHERE posthog_proposals.status = 'pending'",
  ).bind(ctx.integrationId, ctx.projectId, p.module, p.kind, p.source_key, payload).run();
  return old ? 'refreshed' : 'proposed';
}

/** An acceptor's refusal: a status, a code and the sentence the page prints. Nothing is written. */
export class AcceptRefused extends Error {
  status: number; code: string; detail: string;
  constructor(status: number, code: string, detail: string) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

export interface AcceptContext { integrationId: number; projectId: number; userId: number }
/** A proposal kind's Accept: writes through the module's own writer and names the row it became. */
export interface Acceptor { kind: ProposalKind; accept(env: Env, ctx: AcceptContext, row: ProposalRow, body: Record<string, unknown>): Promise<{ target_ref: string }> }

const ACCEPTORS = new Map<ProposalKind, Acceptor>();
export const registerAcceptor = (a: Acceptor) => { ACCEPTORS.set(a.kind, a); };
export const acceptorFor = (k: ProposalKind) => ACCEPTORS.get(k) ?? null;

const pendingRow = async (env: Env, ctx: AcceptContext, id: number) => {
  const row = await env.DB.prepare('SELECT * FROM posthog_proposals WHERE id = ? AND project_id = ? AND integration_id = ?')
    .bind(id, ctx.projectId, ctx.integrationId).first<ProposalRow>();
  return !row ? 'not_found' as const : row.status !== 'pending' ? 'decided' as const : row;
};

export async function acceptProposal(env: Env, ctx: AcceptContext, id: number, body: Record<string, unknown>): Promise<'not_found' | 'decided' | 'not_ready' | { target_ref: string }> {
  const row = await pendingRow(env, ctx, id);
  if (typeof row === 'string') return row;
  const acceptor = acceptorFor(row.kind);
  if (!acceptor) return 'not_ready';
  const landed = await acceptor.accept(env, ctx, row, body);
  await env.DB.prepare(
    "UPDATE posthog_proposals SET status = 'accepted', target_ref = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
  ).bind(landed.target_ref, ctx.userId, id).run();
  return landed;
}

export async function dismissProposal(env: Env, ctx: AcceptContext, id: number): Promise<'ok' | 'not_found' | 'decided'> {
  const row = await pendingRow(env, ctx, id);
  if (typeof row === 'string') return row;
  await env.DB.prepare("UPDATE posthog_proposals SET status = 'dismissed', decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .bind(ctx.userId, id).run();
  return 'ok';
}

export async function proposalsOf(env: Env, projectId: number, module: string): Promise<ProposalRow[]> {
  const r = await env.DB.prepare("SELECT * FROM posthog_proposals WHERE project_id = ? AND module = ? AND status = 'pending' ORDER BY id")
    .bind(projectId, module).all<ProposalRow>();
  return r.results || [];
}

// ── Reading a tracked metric ─────────────────────────────────────────────

const DAY = 86_400_000;

export interface MetricReading { value: number | null; change_30d: number | null; as_of: string | null; period: string | null; reason: string | null }

/** A tracked metric's latest fact and its change against ~30 days before; never a 0 for a missing value. */
export function readingOf(m: TrackedMetric, facts: readonly FactRow[], link: PosthogLink | null): MetricReading {
  const mine = facts.filter((f) => f.kind === 'metric' && f.fact_key === `metric:${m.uid}` && f.value != null)
    .sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : a.period.localeCompare(b.period)));
  const gone = !link || !link.active || link.integration_id !== Number(m.integration_id);
  const last = mine[mine.length - 1];
  if (!last) return { value: null, change_30d: null, as_of: null, period: null, reason: gone ? DISCONNECTED : NOT_RECORDED };
  if (gone) return { value: null, change_30d: null, as_of: null, period: null, reason: DISCONNECTED };
  const cutoff = new Date(Date.parse(`${last.as_of.slice(0, 10)}T00:00:00Z`) - 30 * DAY).toISOString().slice(0, 10);
  const before = [...mine].reverse().find((f) => f.as_of.slice(0, 10) <= cutoff);
  return { value: last.value, change_30d: before ? (last.value as number) - (before.value as number) : null, as_of: last.as_of.slice(0, 10), period: last.period, reason: null };
}

/** Every tracked metric of the venture, read, for its KPI rows (`growKpis.ts`). */
export async function metricReadings(env: Env, projectId: number): Promise<Array<{ metric: TrackedMetric; reading: MetricReading }>> {
  const tracked = await trackedOf(env, projectId);
  if (!tracked.length) return [];
  const [facts, link] = await Promise.all([factsOf(env, projectId), linkOf(env, projectId)]);
  return tracked.map((metric) => ({ metric, reading: readingOf(metric, facts, link) }));
}

// ── A module's "From PostHog" ────────────────────────────────────────────

/** A module's part: the link, its tracked metrics read, its other facts and its pending proposals. Never a survey respondent. */
export async function fromPosthog(env: Env, projectId: number, module: string, viewerId: number) {
  if (!POSTHOG_MODULES[module]) throw new MetricsRefused(400, 'invalid_module');
  const link = await linkOf(env, projectId);
  const [tracked, facts, proposals] = await Promise.all([trackedOf(env, projectId, module), factsOf(env, projectId, module), proposalsOf(env, projectId, module)]);
  return {
    module, label: POSTHOG_MODULES[module].label,
    // The connection's uid only for its own member: it is what "Track a metric" lists insights through.
    link: link ? { linked: true, active: link.active, mine: link.owner_id === viewerId, ...(link.owner_id === viewerId ? { uid: link.integration_uid } : {}) }
      : { linked: false, active: false, mine: false },
    tracked: tracked.map((m) => ({ uid: m.uid, kpi: `${KPI_PREFIX}${m.uid}`, name: m.insight_name, role: m.role, role_words: ROLE_WORDS[m.role], unit: m.unit, ...readingOf(m, facts, link) })),
    facts: facts.filter((f) => f.kind !== 'metric').map((f) => ({ id: f.id, kind: f.kind, fact_key: f.fact_key, period: f.period, value: f.value, label: f.label, as_of: f.as_of, data: safeJson(f.value_json) })),
    proposals: proposals.map((p) => ({ id: p.id, kind: p.kind, source_key: p.source_key, payload: safeJson(p.payload_json) })),
  };
}

function safeJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
