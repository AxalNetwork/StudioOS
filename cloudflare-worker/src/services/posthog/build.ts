/**
 * D1606 (#3731, #2409 part 4) — PostHog into Build: Prototype / MVP, Product
 * roadmap and Operating systems. Registers the Build sync and its two
 * acceptors on import (`routes/posthog.ts` imports it).
 *
 * WHAT A SYNC LANDS, each a fact "From PostHog, as of":
 *   - every metric the founder tracked in Prototype / MVP (activation by
 *     week, say) or in Product roadmap, read from its saved insight; a
 *     roadmap item whose KPI is that metric's `posthog-<uid>` shows its value
 *     and source (`cycle_build.ts` reads `posthogKpiText`);
 *   - each feature flag's state and rollout (`flag_state`), one fact per
 *     flag per day, so a rollout's history is kept.
 *
 * WHAT WAITS FOR ACCEPT:
 *   - "Link flag new-onboarding to a must-have?" (`flag_link`). The must-have
 *     is the founder's, sent with Accept and never guessed from names. Once
 *     linked, the must-have shows the flag's state and rollout.
 *   - "Mark Onboarding v2 Done?" (`flag_shipped`), proposed when a linked
 *     flag has been active at 100% for `SHIPPED_DAYS` days of syncs. Accept
 *     moves the must-have to Done with the same statement and log line as
 *     `PATCH /api/cycles/build/features/:id` (its `done_at` trigger dates it).
 *
 * OPERATING SYSTEMS (#2409 decision D, a): PostHog appears as a Tools line
 * only: the linked project, its region and last sync, and each sync as a
 * line of counts. No core system is added.
 *
 * All SQL is bound; none is interpolated. Nothing here logs a value or a name.
 */
import type { Env } from '../../types';
import type { PosthogReads } from './reads';
import {
  AcceptRefused, DISCONNECTED, KPI_PREFIX, NOT_RECORDED, counted, emptyResult, landFact, landTracked, metricReadings, proposeOnce,
  registerAcceptor, registerSync, stopsSync, type SyncContext,
} from './metrics';
import { logCycleWriteStatement } from '../cycleActivity';

export const MAX_FLAGS = 10;
/** Days a linked flag must stay active at 100% before "Mark Done?" is proposed. */
export const SHIPPED_DAYS = 14;

const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const daysBefore = (today: string, n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Which must-have each flag is linked to: the accepted `flag_link` proposals. */
export async function flagLinks(env: Env, projectId: number): Promise<Map<string, number>> {
  const r = await env.DB.prepare(
    "SELECT source_key, target_ref FROM posthog_proposals WHERE project_id = ? AND kind = 'flag_link' AND status = 'accepted' AND target_ref LIKE 'mvp_features:%'",
  ).bind(projectId).all<{ source_key: string; target_ref: string }>();
  const out = new Map<string, number>();
  for (const x of r.results || []) out.set(x.source_key.replace(/^flag:/, ''), Number(x.target_ref.slice('mvp_features:'.length)));
  return out;
}

/**
 * The day a flag's current unbroken run at 100% and active began, from its
 * daily facts; null when its latest fact is not at 100% and active.
 */
export function fullSince(history: Array<{ period: string; value: number | null; active: boolean | null }>): string | null {
  const sorted = [...history].sort((a, b) => a.period.localeCompare(b.period));
  let since: string | null = null;
  for (const h of sorted) {
    if (h.value === 100 && h.active === true) since = since ?? h.period;
    else since = null;
  }
  return since;
}

export async function syncBuild(env: Env, reads: PosthogReads, ctx: SyncContext) {
  const r = emptyResult();
  await landTracked(env, reads, ctx, ['prototype_mvp', 'product_roadmap'], r);
  if (r.partial) return r;
  let flags: Awaited<ReturnType<PosthogReads['flags']>> = [];
  try { flags = await reads.flags(); } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push('flags'); }
  const links = await flagLinks(env, ctx.projectId);
  for (const f of flags.slice(0, MAX_FLAGS)) {
    const featureId = links.get(f.id) ?? null;
    counted(r, await landFact(env, ctx, {
      module: 'prototype_mvp', kind: 'flag_state', fact_key: `flag:${f.id}`, period: ctx.today, value: f.rollout_percentage,
      value_json: { key: f.key, active: f.active, rollout: f.rollout_percentage, feature_id: featureId }, label: f.key ?? f.name, source_ref: f.id, as_of: ctx.today,
    }));
    if (featureId == null) {
      if ((await proposeOnce(env, ctx, { module: 'prototype_mvp', kind: 'flag_link', source_key: `flag:${f.id}`, payload: { title: f.key ?? f.name ?? 'Feature flag', flag_id: f.id, key: f.key, rollout: f.rollout_percentage, active: f.active } })) === 'proposed') r.proposals += 1;
      continue;
    }
    const hist = await env.DB.prepare("SELECT period, value, value_json FROM posthog_metric_facts WHERE project_id = ? AND kind = 'flag_state' AND fact_key = ?")
      .bind(ctx.projectId, `flag:${f.id}`).all<{ period: string; value: number | null; value_json: string | null }>();
    const since = fullSince((hist.results || []).map((h) => {
      let active: boolean | null = null;
      try { const j = JSON.parse(h.value_json || '{}'); active = typeof j.active === 'boolean' ? j.active : null; } catch { /* kept null */ }
      return { period: h.period, value: h.value, active };
    }));
    if (since && since <= daysBefore(ctx.today, SHIPPED_DAYS)) {
      const fe = await env.DB.prepare('SELECT title, delivery_status FROM mvp_features WHERE id = ? AND project_id = ?').bind(featureId, ctx.projectId).first<{ title: string; delivery_status: string | null }>();
      if (fe && fe.delivery_status !== 'Done') {
        if ((await proposeOnce(env, ctx, { module: 'prototype_mvp', kind: 'flag_shipped', source_key: `flag:${f.id}:feature:${featureId}`, payload: { title: fe.title, feature_id: featureId, key: f.key, since } })) === 'proposed') r.proposals += 1;
      }
    }
  }
  return r;
}

registerSync('build', syncBuild);

const payloadOf = (raw: string) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {}; } catch { return {}; } };

registerAcceptor({
  kind: 'flag_link',
  async accept(env, ctx, row, body) {
    const featureId = Number(body.feature_id);
    if (!Number.isSafeInteger(featureId) || featureId <= 0) throw new AcceptRefused(400, 'feature_required', 'Choose the must-have this flag belongs to.');
    const fe = await env.DB.prepare('SELECT id, title FROM mvp_features WHERE id = ? AND project_id = ? AND is_must_have = 1').bind(featureId, ctx.projectId).first<{ id: number; title: string }>();
    if (!fe) throw new AcceptRefused(404, 'feature_not_found', 'That must-have is not on this venture.');
    await env.DB.batch([logCycleWriteStatement(env, { projectId: ctx.projectId, userId: ctx.userId, cycle: 'build', module: 'prototype-mvp', entityId: fe.id, action: 'build_flag_linked', summary: 'PostHog flag linked' })]);
    return { target_ref: `mvp_features:${fe.id}` };
  },
});

registerAcceptor({
  kind: 'flag_shipped',
  async accept(env, ctx, row) {
    const featureId = Number(payloadOf(row.payload_json).feature_id);
    const fe = Number.isSafeInteger(featureId)
      ? await env.DB.prepare('SELECT id, delivery_status FROM mvp_features WHERE id = ? AND project_id = ?').bind(featureId, ctx.projectId).first<{ id: number; delivery_status: string | null }>()
      : null;
    if (!fe) throw new AcceptRefused(404, 'feature_not_found', 'That must-have is no longer on this venture.');
    // The same statement and log line `PATCH /features/:id` writes for a move to Done; migration 441's trigger dates it.
    await env.DB.batch([
      env.DB.prepare("UPDATE mvp_features SET delivery_status = 'Done', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?").bind(fe.id, ctx.projectId),
      logCycleWriteStatement(env, { projectId: ctx.projectId, userId: ctx.userId, cycle: 'build', module: 'solution-design', entityId: fe.id, action: 'build_feature_details_changed', summary: 'Feature details changed' }),
    ]);
    return { target_ref: `mvp_features:${fe.id}` };
  },
});

// ── Reads for Build's modules ────────────────────────────────────────────

/** A roadmap item's KPI in words: "Weekly active users 1,240 · From PostHog, as of 2026-10-30", or why not. */
export async function posthogKpiTexts(env: Env, projectId: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const { metric, reading } of await metricReadings(env, projectId)) {
    const name = metric.insight_name || 'PostHog metric';
    const value = reading.value == null ? null : metric.unit === 'pct' ? `${Math.round(reading.value * 10) / 10}%` : Math.round(reading.value).toLocaleString('en-US');
    out.set(`${KPI_PREFIX}${metric.uid}`, value ? `${name} ${value} · From PostHog, as of ${reading.as_of}` : `${name} · ${reading.reason ?? NOT_RECORDED}`);
  }
  return out;
}

/** The linked must-haves' flag chips: "Flag 25% · active", from each flag's latest fact. */
export async function flagChips(env: Env, projectId: number): Promise<Array<{ feature_id: number; key: string | null; rollout: number | null; active: boolean | null; as_of: string }>> {
  const links = await flagLinks(env, projectId);
  if (!links.size) return [];
  const r = await env.DB.prepare(
    "SELECT fact_key, value, value_json, as_of FROM posthog_metric_facts WHERE project_id = ? AND kind = 'flag_state' ORDER BY period DESC, id DESC",
  ).bind(projectId).all<{ fact_key: string; value: number | null; value_json: string | null; as_of: string }>();
  const seen = new Set<string>();
  const out = [];
  for (const f of r.results || []) {
    const id = f.fact_key.replace(/^flag:/, '');
    if (seen.has(id) || !links.has(id)) continue;
    seen.add(id);
    const j = payloadOf(f.value_json || '{}');
    out.push({ feature_id: links.get(id)!, key: typeof j.key === 'string' ? j.key : null, rollout: f.value, active: typeof j.active === 'boolean' ? j.active : null, as_of: day(f.as_of)! });
  }
  return out;
}

/** The venture's must-haves, for "Link flag to a must-have". */
export async function mustHaves(env: Env, projectId: number) {
  const r = await env.DB.prepare("SELECT id, title, delivery_status FROM mvp_features WHERE project_id = ? AND is_must_have = 1 AND COALESCE(scope, 'core') <> 'out' ORDER BY id")
    .bind(projectId).all<{ id: number; title: string; delivery_status: string | null }>();
  return (r.results || []).map((m) => ({ id: Number(m.id), title: m.title, status: m.delivery_status }));
}

/** Operating systems' Tools line: the linked project, its region and last sync, and each sync's counts, newest first. */
export async function toolsLine(env: Env, projectId: number) {
  const link = await env.DB.prepare(
    'SELECT l.posthog_project_name AS name, l.region, i.last_synced_at, i.status FROM posthog_project_links l JOIN integrations i ON i.id = l.integration_id WHERE l.project_id = ?',
  ).bind(projectId).first<{ name: string | null; region: string | null; last_synced_at: string | null; status: string }>();
  if (!link) return null;
  const syncs = await env.DB.prepare(
    "SELECT action, details, created_at FROM activity_logs WHERE action LIKE 'posthog_%_synced' AND json_extract(details, '$.project_id') = ? ORDER BY id DESC LIMIT 10",
  ).bind(projectId).all<{ action: string; details: string; created_at: string }>();
  return {
    project: link.name, region: link.region, last_synced: day(link.last_synced_at), active: link.status === 'active',
    reason: link.status === 'active' ? null : DISCONNECTED,
    syncs: (syncs.results || []).map((s) => {
      const d = payloadOf(s.details);
      return { section: s.action.replace(/^posthog_|_synced$/g, ''), at: day(s.created_at), facts: Number(d.facts) || 0, proposals: Number(d.proposals) || 0, partial: Number(d.partial) === 1 };
    }),
  };
}
