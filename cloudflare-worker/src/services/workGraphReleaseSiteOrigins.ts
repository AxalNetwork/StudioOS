/**
 * D5585 part 18 (#5585, WorkGraph P1 under the #5577 epic): the origins a company's published release site records may
 * be read from in a browser. A Super Admin allows or removes one origin at a time, from the list `seq` they saw; the
 * store (`work_graph_release_site_origins`) keeps every change. The public site-record route (D5585-p9) sends
 * `Access-Control-Allow-Origin` only for a listed origin of the record's own tenant and company. Decision:
 * `documentation/architecture/decisions/D5585-p18.md`.
 *
 * WHAT AN ORIGIN IS. `https://` and a DNS host name of at least two labels, optionally `:port`, nothing else: no path,
 * query, fragment, user information, wildcard or IP literal. Upper case is folded to lower case, and a trailing `/` is
 * dropped. `http://` is never listed: a record read over plain HTTP could be changed on the way.
 */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';
import { WORK_GRAPH_DEPS, type Cost } from './workGraphRevisions';
import { Meter, hashOf, keyOk } from './workGraphReleases';
import { companyUnderOtherTenant } from './workGraphReleaseAuthorities';

export const SITE_ORIGIN_LIMITS = Object.freeze({ perCompany: 20, historyMax: 100 });

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const ORIGIN = new RegExp(`^https://(${LABEL}(?:\\.${LABEL})+)(?::([0-9]{1,5}))?$`);

/** The origin as stored, or null when it is not one this list keeps. */
export function normaliseSiteOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 270) return null;
  const s = raw.trim().toLowerCase().replace(/\/$/, '');
  const m = ORIGIN.exec(s);
  if (!m) return null;
  const host = m[1];
  if (host.length > 253 || /^[0-9.]+$/.test(host)) return null;
  if (m[2] !== undefined) {
    const port = Number(m[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 443 || m[2].startsWith('0')) return null;
  }
  return s;
}

export interface SiteOrigin { origin: string; seq: number; allowedByUserId: number; allowedAt: string }
export interface SiteOriginEvent { seq: number; op: 'allow' | 'remove'; origin: string; actorUserId: number; at: string }

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const scopeOk = (s: Scope | undefined): s is Scope => !!s && posInt(s.tenantId) && posInt(s.companyId);

/** The company's list now: each origin whose latest row is an allow, oldest allowed first; and the list's `seq`. */
export async function siteOriginsOf(env: Pick<Env, 'DB'>, m: Meter, scope: Scope): Promise<{ origins: SiteOrigin[]; seq: number }> {
  const rows = await m.all<{ origin: string; seq: number; actor_user_id: number; created_at: string; top: number | null }>(env.DB.prepare(
    `SELECT o.origin, o.seq, o.actor_user_id, o.created_at,
            (SELECT MAX(x.seq) FROM work_graph_release_site_origins x WHERE x.tenant_id = o.tenant_id AND x.company_id = o.company_id) AS top
       FROM work_graph_release_site_origins o
      WHERE o.tenant_id = ? AND o.company_id = ? AND o.op = 'allow'
        AND o.seq = (SELECT MAX(y.seq) FROM work_graph_release_site_origins y
                      WHERE y.tenant_id = o.tenant_id AND y.company_id = o.company_id AND y.origin = o.origin)
      ORDER BY o.seq`,
  ).bind(scope.tenantId, scope.companyId));
  const seq = rows.length ? Number(rows[0].top ?? 0) : Number((await m.first<{ s: number | null }>(env.DB.prepare(
    'SELECT MAX(seq) AS s FROM work_graph_release_site_origins WHERE tenant_id = ? AND company_id = ?',
  ).bind(scope.tenantId, scope.companyId)))?.s ?? 0);
  return {
    origins: rows.map((r) => ({ origin: r.origin, seq: Number(r.seq), allowedByUserId: Number(r.actor_user_id), allowedAt: r.created_at })),
    seq,
  };
}

/** The company's changes, newest first, at most `SITE_ORIGIN_LIMITS.historyMax`. */
export async function siteOriginHistory(env: Pick<Env, 'DB'>, m: Meter, scope: Scope): Promise<SiteOriginEvent[]> {
  const rows = await m.all<{ seq: number; op: 'allow' | 'remove'; origin: string; actor_user_id: number; created_at: string }>(env.DB.prepare(
    `SELECT seq, op, origin, actor_user_id, created_at FROM work_graph_release_site_origins
      WHERE tenant_id = ? AND company_id = ? ORDER BY seq DESC LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, SITE_ORIGIN_LIMITS.historyMax));
  return rows.map((r) => ({ seq: Number(r.seq), op: r.op, origin: r.origin, actorUserId: Number(r.actor_user_id), at: r.created_at }));
}

/**
 * The public route's one question: is this request's `Origin` on the list of this tenant and company? One indexed
 * statement, and none when there is no `Origin` or it is not an origin this list could hold.
 */
export async function siteOriginAllowed(env: Pick<Env, 'DB'>, m: Meter, scope: Scope, origin: string | null | undefined): Promise<boolean> {
  if (!origin || !scopeOk(scope)) return false;
  const o = normaliseSiteOrigin(origin);
  if (!o || o !== origin) return false; // a browser sends the serialised origin; anything else is not one to echo
  const row = await m.first<{ op: string }>(env.DB.prepare(
    `SELECT op FROM work_graph_release_site_origins WHERE tenant_id = ? AND company_id = ? AND origin = ? ORDER BY seq DESC LIMIT 1`,
  ).bind(scope.tenantId, scope.companyId, o));
  return row?.op === 'allow';
}

export interface SiteOriginChangeInput {
  scope: Scope; op: 'allow' | 'remove'; origin: string;
  /** The list `seq` the Super Admin saw: 0 when the company never had one. */
  expectedSeq: number; actorUserId: number; idempotencyKey: string;
}
export type SiteOriginRefusalCode =
  | 'malformed' | 'site_origin_invalid' | 'wrong_tenant' | 'stale_site_origins' | 'already_allowed' | 'not_allowed'
  | 'site_origin_limit' | 'idempotency_conflict';
export type SiteOriginChangeResult =
  | { ok: true; op: 'allow' | 'remove'; origin: string; seq: number; replayed: boolean; cost: Cost }
  | { ok: false; code: SiteOriginRefusalCode; ids: string[]; current?: { seq: number; origins: string[] }; cost: Cost };

/** Allow or remove one origin of one company, from the list `seq` the Super Admin saw. A replay answers the first. */
export async function changeSiteOrigin(env: Pick<Env, 'DB'>, input: SiteOriginChangeInput): Promise<SiteOriginChangeResult> {
  const m = new Meter(env);
  const no = (code: SiteOriginRefusalCode, ids: string[], current?: { seq: number; origins: string[] }): SiteOriginChangeResult =>
    ({ ok: false, code, ids, cost: { ...m.cost }, ...(current ? { current } : {}) });
  if (!input || !scopeOk(input.scope) || (input.op !== 'allow' && input.op !== 'remove') || !posInt(input.actorUserId)
    || !keyOk(input.idempotencyKey) || !Number.isSafeInteger(input.expectedSeq) || input.expectedSeq < 0) {
    return no('malformed', []);
  }
  const origin = normaliseSiteOrigin(input.origin);
  if (origin === null) return no('site_origin_invalid', []);
  const { tenantId, companyId } = input.scope;
  const requestHash = await hashOf({ op: `site_origin_${input.op}`, origin, expectedSeq: input.expectedSeq });
  const replay = async (): Promise<SiteOriginChangeResult | null> => {
    const prior = await m.first<{ op: 'allow' | 'remove'; origin: string; seq: number; request_hash: string }>(env.DB.prepare(
      'SELECT op, origin, seq, request_hash FROM work_graph_release_site_origins WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
    ).bind(tenantId, companyId, input.idempotencyKey));
    if (!prior) return null;
    return prior.request_hash === requestHash
      ? { ok: true, op: prior.op, origin: prior.origin, seq: Number(prior.seq), replayed: true, cost: { ...m.cost } }
      : no('idempotency_conflict', [origin]);
  };
  const first = await replay();
  if (first) return first;
  if (await companyUnderOtherTenant(env, m, input.scope)) return no('wrong_tenant', [String(companyId)]);

  const now = await siteOriginsOf(env, m, input.scope);
  const current = { seq: now.seq, origins: now.origins.map((o) => o.origin) };
  if (now.seq !== input.expectedSeq) return no('stale_site_origins', [origin], current);
  const listed = current.origins.includes(origin);
  if (input.op === 'allow' && listed) return no('already_allowed', [origin], current);
  if (input.op === 'remove' && !listed) return no('not_allowed', [origin], current);
  if (input.op === 'allow' && current.origins.length >= SITE_ORIGIN_LIMITS.perCompany) return no('site_origin_limit', [origin], current);

  const next = now.seq + 1;
  try {
    // Conditional on the company's list still being at `seq`: a change that landed in between makes this insert nothing.
    const res = await m.run(env.DB.prepare(
      `INSERT INTO work_graph_release_site_origins (tenant_id, company_id, seq, op, origin, actor_user_id, idempotency_key, request_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT MAX(x.seq) FROM work_graph_release_site_origins x WHERE x.tenant_id = ? AND x.company_id = ?), 0) = ?`,
    ).bind(tenantId, companyId, next, input.op, origin, input.actorUserId, input.idempotencyKey, requestHash,
      WORK_GRAPH_DEPS.now().toISOString(), tenantId, companyId, now.seq));
    if (!res.meta?.changes) {
      const later = await siteOriginsOf(env, m, input.scope);
      return no('stale_site_origins', [origin], { seq: later.seq, origins: later.origins.map((o) => o.origin) });
    }
    return { ok: true, op: input.op, origin, seq: next, replayed: false, cost: { ...m.cost } };
  } catch (e) {
    // A concurrent request under the same key (UNIQUE on the idempotency key) answers as its replay.
    const again = await replay();
    if (again) return again;
    throw e;
  }
}
