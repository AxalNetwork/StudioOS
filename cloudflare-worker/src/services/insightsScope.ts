/**
 * D893 (#2662) — Admin › Insights for one deployed subsidiary, read from that
 * subsidiary's own database.
 *
 * WHERE THE FIGURES COME FROM. A branch is its own Worker over its own D1
 * (D.2), so HQ never counts a branch's accounts. It asks the branch through
 * the fan-out (`services/branches.ts`), and the branch answers `insights()`
 * (`rpc/branchOps.ts`) with the same read HQ's `GET /api/admin/insights`
 * makes over HQ's own database (#2660). That is the pattern
 * `activationAcrossBranches` uses for H15.
 *
 * A BRANCH THAT DOES NOT ANSWER IS NOT A BRANCH WITH NOTHING. Every KPI and
 * block then reads `{ available: false, unreadable: true, reason }`, never a
 * zero. An unbound code is `not_deployed` and says so in the same shape.
 *
 * COUNTS ONLY, CHECKED ON BOTH SIDES. The branch strips the read before it
 * answers, and HQ strips the answer again, because a branch on an older
 * deploy is not this code. `countsOnly` drops every key that names a person
 * or a record (an email, a name, an id) and any string shaped like an email.
 */
import type { Env } from '../types';
import { branchByCode, branchRead } from './branches';
import { BRANCH_CODE_RE } from '../util/branch';

/** The scope code for this deployment's own accounts. */
export const HQ_SCOPE = 'hq';
export const HQ_SCOPE_LABEL = 'HQ-held accounts';

/** The chip's words for a subsidiary picked in the Scope select (INS2). */
export const BRANCH_SCOPE_SOURCE = 'counts read from its own database';

/** INS10, for a plain Admin who opens a `?scope=` link meant for HQ. */
export const HQ_ONLY_MESSAGE = 'This view is for HQ. You see the accounts you manage.';

/** The deployment states at which a branch has a Worker and a database to ask (migration 258). */
// A fixed-length tuple, because `check-sql-prepare` refuses a generated
// placeholder list: the query below writes its three `?` by hand.
export const DEPLOYED_STATUSES: readonly ['worker_live', 'hostname_active', 'linked'] = ['worker_live', 'hostname_active', 'linked'];

/** #2660's response: the KPI tiles and the blocks. A branch's unreadable answer fills every one. */
export const INSIGHTS_KPI_KEYS = ['accounts', 'new_this_week', 'active_last_week', 'activated'] as const;
export const INSIGHTS_BLOCK_KEYS = [
  'who', 'plan', 'growth', 'activity', 'activation', 'retention',
  'countries', 'identity', 'completeness', 'dormant', 'tickets', 'spend',
] as const;

/** The query parameters that cross to the branch. Nothing else does. */
export const INSIGHTS_PARAM_KEYS = ['range', 'profile', 'country', 'compare', 'group'] as const;
export type InsightsParams = Partial<Record<typeof INSIGHTS_PARAM_KEYS[number], string>>;

/** The read a branch runs over its own D1: #2660's loader, as the RPC is handed it. */
export type InsightsLoader = (env: Env, params: InsightsParams) => Promise<Record<string, unknown>>;

/**
 * What the branch's `insights()` RPC runs until #2660's loader is on the same
 * deploy: a refusal HQ shows as the unreadable blocks, with this reason.
 */
export const INSIGHTS_READ_PENDING = 'This deploy does not carry the Insights read yet (#2660).';
export const pendingInsightsLoader: InsightsLoader = async () => { throw new Error(INSIGHTS_READ_PENDING); };

export type InsightsScope = { code: string; label: string; kind: 'hq' | 'branch' };

/**
 * A key that names a person or a record. `uid`, `user_id`, `account_id`,
 * `first_name`, `email` and the bare `id` and `name` all match; `country`,
 * `profile`, `tier`, `week`, `band` and `label` do not.
 */
const PERSONAL_KEY = /^(?:id|uid|name|email|phone|[a-z_]*_(?:id|uid|name|email|phone))$/i;
const EMAIL_SHAPED = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MAX_DEPTH = 8;

/** The read with every personal key and email-shaped string removed. Numbers, nulls and booleans pass. */
export function countsOnly(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && EMAIL_SHAPED.test(value) ? null : value;
  }
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((v) => countsOnly(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PERSONAL_KEY.test(k)) continue;
    out[k] = countsOnly(v, depth + 1);
  }
  return out;
}

/** Only the contract's parameters, as bounded strings. The loader validates their values. */
export function insightsParams(query: Record<string, string | undefined>): InsightsParams {
  const out: InsightsParams = {};
  for (const k of INSIGHTS_PARAM_KEYS) {
    const v = query[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 64);
  }
  return out;
}

/** A scope code as the Scope select sends it: `hq`, or a branch code. Anything else is `null`. */
export function normaliseScope(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === HQ_SCOPE) return HQ_SCOPE;
  return BRANCH_CODE_RE.test(s) ? s : null;
}

/**
 * The Scope select's lines: HQ-held first, then each deployed subsidiary, by
 * code. `licence_deployments` joined to `territory_licences`, as
 * `registryForAnalytics` reads them. An unreadable registry still answers the
 * HQ-held line, and says why no subsidiary is listed.
 */
export async function insightsScopes(env: Env): Promise<
  { scopes: InsightsScope[]; registry: { readable: true } | { readable: false; reason: string } }
> {
  const hq: InsightsScope = { code: HQ_SCOPE, label: HQ_SCOPE_LABEL, kind: 'hq' };
  try {
    const q = await env.DB.prepare(
      `SELECT d.code, l.brand_name
         FROM licence_deployments d
         LEFT JOIN territory_licences l ON l.uid = d.licence_uid
        WHERE d.status IN (?, ?, ?)
        ORDER BY d.code`,
    ).bind(...DEPLOYED_STATUSES).all<{ code: string; brand_name: string | null }>();
    const branches = (q.results || [])
      .map((r) => ({ code: String(r.code || '').toLowerCase(), brand: r.brand_name }))
      .filter((r) => BRANCH_CODE_RE.test(r.code))
      .map((r): InsightsScope => ({ code: r.code, label: r.brand || r.code, kind: 'branch' }));
    return { scopes: [hq, ...branches], registry: { readable: true } };
  } catch (e) {
    return {
      scopes: [hq],
      registry: {
        readable: false,
        reason: 'The deployment registry could not be read (migration 258), so no subsidiary is listed: '
          + `${(e as Error)?.message || 'unknown'}.`,
      },
    };
  }
}

/** One subsidiary's label from the registry, or its code when the registry has none. */
async function labelOf(env: Env, code: string): Promise<string> {
  try {
    const row = await env.DB.prepare(
      `SELECT l.brand_name FROM licence_deployments d
         LEFT JOIN territory_licences l ON l.uid = d.licence_uid
        WHERE d.code = ? LIMIT 1`,
    ).bind(code).first<{ brand_name: string | null }>();
    return row?.brand_name || code;
  } catch {
    return code;
  }
}

/** Every KPI and block unreadable with one reason: what a branch that did not answer shows. */
export function unreadableInsights(scope: Record<string, unknown>, reason: string, extra: Record<string, unknown> = {}) {
  const off = () => ({ available: false, unreadable: true, reason });
  return {
    scope,
    as_of: null,
    kpis: Object.fromEntries(INSIGHTS_KPI_KEYS.map((k) => [k, off()])),
    blocks: Object.fromEntries(INSIGHTS_BLOCK_KEYS.map((k) => [k, off()])),
    ...extra,
  };
}

/**
 * HQ's read of one subsidiary: the branch's own answer, counts only, with
 * HQ's label on its scope. Never throws: a branch that does not answer, or
 * answers without a read, gives the unreadable shape.
 */
export async function branchScopedInsights(env: Env, code: string, params: InsightsParams) {
  const label = await labelOf(env, code);
  const scope = { code, label, kind: 'branch' as const, source: BRANCH_SCOPE_SOURCE };
  const r = await branchRead<{ insights?: Record<string, unknown>; as_of?: string }>(env, code, 'insights', [params]);
  const read = r.status === 'ok' && r.data?.insights && typeof r.data.insights === 'object' ? r.data.insights : null;
  if (!read) {
    const reason = r.status === 'ok'
      ? 'The branch answered without an Insights read.'
      : r.status === 'not_deployed'
        ? `${label} is not bound to this Worker yet, so its database cannot be asked. ${r.reason || ''}`.trim()
        : `${label} did not answer, so its counts are not shown: ${r.reason || 'unknown'}.`;
    return unreadableInsights(scope, reason, {
      branch: { status: r.status, ...(r.timed_out ? { timed_out: true } : {}) },
    });
  }
  const clean = countsOnly(read) as Record<string, unknown>;
  return { ...clean, scope, as_of: r.as_of ?? clean.as_of ?? null, branch: { status: 'ok' } };
}

/** Whether a branch code is bound here. The scopes route uses it to say which lines can answer. */
export function scopeIsBound(env: Env, code: string): boolean {
  return code === HQ_SCOPE || !!branchByCode(env, code);
}
