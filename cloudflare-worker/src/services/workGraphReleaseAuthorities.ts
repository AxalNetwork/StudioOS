/**
 * D5585 part 8 (#5585, WorkGraph P1 under the #5577 epic) — the per-company release-authority store, the owner's answer
 * A of 2026-11-21 to D5585-p7 §3. A Super Admin grants and revokes release authorities (`maintainer`, `brand_owner`,
 * `counsel`, `security_officer`…) to the people of one company in one tenant; the release routes resolve each person's
 * authorities from here instead of resolving none. Decision: `documentation/architecture/decisions/D5585-p8.md`.
 *
 * THE STORE is one append-only table, `work_graph_release_authority_events` (migration
 * `202611212328_5585_work_graph_release_authorities.sql`). Who holds an authority now is the latest row of its key
 * (tenant, company, user, authority): an odd `seq` is a grant, an even one a revocation. Every write names the `seq` it
 * saw (`expectedSeq`, 0 for a key never written), so a stale view is refused `stale_revision` with the current `seq`.
 *
 * RULES.
 *   - The names are the release services' own vocabulary (`RELEASE_AUTHORITIES`); any other is `unknown_authority`.
 *   - A grant needs the person to be linked to the company (`user_company_links`); otherwise `not_member`. A
 *     revocation does not (so a departed person's grant can still be withdrawn).
 *   - A grant counts only while the person is still linked to the company: the resolvers join the link, so removing
 *     the link withdraws every authority the person holds there at once, without a row here.
 *   - Grants never cross tenants: every read and write names its exact (tenant, company), and a write naming a company
 *     whose release lines or grants live under another tenant is `wrong_tenant`.
 *   - A grant of an authority already held is `already_held`; a revocation of one not held is `not_held`.
 *   - Every write carries an idempotency key (unique per tenant and company): the same request again is a replay of
 *     the first answer, another request under the same key is `idempotency_conflict`.
 *
 * COST. Every answer carries `cost: { d1Statements, d1Batches }`.
 */
import type { Env } from '../types';
import type { Cost } from './workGraphRevisions';
import { WORK_GRAPH_DEPS } from './workGraphRevisions';
import { Meter, POLICY_PROFILES, REQUIREMENT_AUTHORITY, hashOf, keyOk } from './workGraphReleases';
import { TAKEDOWN_AUTHORITIES } from './workGraphReleaseTakedowns';

/** Every release authority the release services name: profile approvers, attesters and the takedown authorities. */
export const RELEASE_AUTHORITIES: readonly string[] = Object.freeze([...new Set([
  ...Object.values(POLICY_PROFILES).flatMap((p) => p.authorities),
  ...Object.values(REQUIREMENT_AUTHORITY).flatMap((a) => a ?? []),
  ...TAKEDOWN_AUTHORITIES,
])].sort());
export const isReleaseAuthority = (a: unknown): a is string => typeof a === 'string' && RELEASE_AUTHORITIES.includes(a);

export const RELEASE_AUTHORITY_LIMITS = Object.freeze({
  /** Holders one scope resolves at most (a company with more is refused nothing: the oldest grants win the cap). */
  holdersMax: 1000,
  /** Rows a list answers at most. */
  listMax: 200,
  reasonMax: 500,
});

export interface AuthorityScope { tenantId: number; companyId: number }
export type AuthorityRefusalCode =
  | 'malformed' | 'unknown_authority' | 'not_member' | 'wrong_tenant' | 'stale_revision' | 'already_held' | 'not_held'
  | 'idempotency_conflict';
export interface AuthorityRefusal {
  ok: false; code: AuthorityRefusalCode; ids: string[]; cost: Cost;
  /** On `stale_revision`, `already_held` and `not_held`: the key as it is now. */
  current?: { seq: number; held: boolean };
}
export interface AuthorityChangeInput {
  scope: AuthorityScope;
  userId: number;
  authority: string;
  /** The Super Admin's own sentence: why. */
  reason: string;
  /** The `seq` of the key the writer saw: 0 when it was never written. */
  expectedSeq: number;
  actorUserId: number;
  idempotencyKey: string;
}
export type AuthorityChangeResult =
  | { ok: true; eventId: number; op: 'grant' | 'revoke'; seq: number; held: boolean; replayed: boolean; cost: Cost }
  | AuthorityRefusal;

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const scopeOk = (s: AuthorityScope | undefined): s is AuthorityScope => !!s && posInt(s.tenantId) && posInt(s.companyId);

function refuse(m: Meter, code: AuthorityRefusalCode, ids: string[], current?: { seq: number; held: boolean }): AuthorityRefusal {
  return { ok: false, code, ids, cost: { ...m.cost }, ...(current ? { current } : {}) };
}

/**
 * One company, one tenant: its release lines and its grants name the tenant it lives under. True when any of them names
 * a tenant other than the scope's, so a request naming that company under this tenant is `wrong_tenant`. Part 10's
 * reviewer routes ask the same question before they read anything else of the scope.
 */
export async function companyUnderOtherTenant(env: Pick<Env, 'DB'>, m: Meter, scope: AuthorityScope): Promise<boolean> {
  const foreign = await m.first<{ tenant_id: number }>(env.DB.prepare(
    `SELECT tenant_id FROM work_graph_release_authority_events WHERE company_id = ? AND tenant_id <> ?
     UNION ALL
     SELECT tenant_id FROM work_graph_release_lines WHERE company_id = ? AND tenant_id <> ?
     LIMIT 1`,
  ).bind(scope.companyId, scope.tenantId, scope.companyId, scope.tenantId));
  return !!foreign;
}

async function change(env: Pick<Env, 'DB'>, op: 'grant' | 'revoke', input: AuthorityChangeInput): Promise<AuthorityChangeResult> {
  const m = new Meter(env);
  if (!input || !scopeOk(input.scope) || !posInt(input.userId) || !posInt(input.actorUserId) || !keyOk(input.idempotencyKey)
    || typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > RELEASE_AUTHORITY_LIMITS.reasonMax
    || !Number.isSafeInteger(input.expectedSeq) || input.expectedSeq < 0 || typeof input.authority !== 'string') {
    return refuse(m, 'malformed', []);
  }
  if (!isReleaseAuthority(input.authority)) return refuse(m, 'unknown_authority', [String(input.authority).slice(0, 40)]);
  const { tenantId, companyId } = input.scope;
  const ids = [String(input.userId), input.authority];
  const requestHash = await hashOf({ op, userId: input.userId, authority: input.authority, reason: input.reason, expectedSeq: input.expectedSeq });

  const replay = async () => {
    const prior = await m.first<{ id: number; op: 'grant' | 'revoke'; seq: number; request_hash: string }>(env.DB.prepare(
      `SELECT id, op, seq, request_hash FROM work_graph_release_authority_events
        WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`,
    ).bind(tenantId, companyId, input.idempotencyKey));
    if (!prior) return null;
    if (prior.request_hash !== requestHash) return refuse(m, 'idempotency_conflict', ids);
    return { ok: true as const, eventId: prior.id, op: prior.op, seq: prior.seq, held: prior.seq % 2 === 1, replayed: true, cost: { ...m.cost } };
  };
  const first = await replay();
  if (first) return first;

  if (await companyUnderOtherTenant(env, m, input.scope)) return refuse(m, 'wrong_tenant', [String(companyId)]);

  if (op === 'grant') {
    const linked = await m.first<{ one: number }>(env.DB.prepare(
      'SELECT 1 AS one FROM user_company_links WHERE company_id = ? AND user_id = ?',
    ).bind(companyId, input.userId));
    if (!linked) return refuse(m, 'not_member', ids);
  }

  const cur = await m.first<{ seq: number | null }>(env.DB.prepare(
    `SELECT MAX(seq) AS seq FROM work_graph_release_authority_events
      WHERE tenant_id = ? AND company_id = ? AND user_id = ? AND authority = ?`,
  ).bind(tenantId, companyId, input.userId, input.authority));
  const seq = Number(cur?.seq ?? 0);
  const current = { seq, held: seq % 2 === 1 };
  if (seq !== input.expectedSeq) return refuse(m, 'stale_revision', ids, current);
  if (op === 'grant' && current.held) return refuse(m, 'already_held', ids, current);
  if (op === 'revoke' && !current.held) return refuse(m, 'not_held', ids, current);

  const next = seq + 1;
  try {
    // Conditional on the key still being at `seq`: a writer that landed in between makes this insert nothing.
    const res = await m.run(env.DB.prepare(
      `INSERT INTO work_graph_release_authority_events
         (tenant_id, company_id, user_id, authority, seq, op, reason, actor_user_id, idempotency_key, request_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT MAX(x.seq) FROM work_graph_release_authority_events x
                         WHERE x.tenant_id = ? AND x.company_id = ? AND x.user_id = ? AND x.authority = ?), 0) = ?`,
    ).bind(tenantId, companyId, input.userId, input.authority, next, op, input.reason, input.actorUserId, input.idempotencyKey,
      requestHash, WORK_GRAPH_DEPS.now().toISOString(), tenantId, companyId, input.userId, input.authority, seq));
    if (!res.meta?.changes) {
      const now = await m.first<{ seq: number | null }>(env.DB.prepare(
        `SELECT MAX(seq) AS seq FROM work_graph_release_authority_events
          WHERE tenant_id = ? AND company_id = ? AND user_id = ? AND authority = ?`,
      ).bind(tenantId, companyId, input.userId, input.authority));
      const s = Number(now?.seq ?? 0);
      return refuse(m, 'stale_revision', ids, { seq: s, held: s % 2 === 1 });
    }
    return { ok: true, eventId: Number(res.meta.last_row_id), op, seq: next, held: op === 'grant', replayed: false, cost: { ...m.cost } };
  } catch (e) {
    // A concurrent request under the same key (UNIQUE on the idempotency key) answers as its replay.
    const again = await replay();
    if (again) return again;
    throw e;
  }
}

/** Grant one release authority to one person of one company, from the `seq` the Super Admin saw. */
export const grantReleaseAuthority = (env: Pick<Env, 'DB'>, input: AuthorityChangeInput) => change(env, 'grant', input);
/** Revoke one release authority from one person of one company, from the `seq` the Super Admin saw. Takes effect at once. */
export const revokeReleaseAuthority = (env: Pick<Env, 'DB'>, input: AuthorityChangeInput) => change(env, 'revoke', input);

export interface AuthorityHolder { userId: number; authority: string; seq: number; grantedAt: string; grantedByUserId: number; reason: string }
export interface AuthorityEvent {
  id: number; userId: number; authority: string; seq: number; op: 'grant' | 'revoke'; reason: string; actorUserId: number; createdAt: string;
}

/** The current holders of one scope: each key whose latest row is a grant, and whose person is still linked to the company. */
async function holders(env: Pick<Env, 'DB'>, m: Meter, scope: AuthorityScope, userId: number | null, limit: number): Promise<AuthorityHolder[]> {
  const rows = await m.all<{ user_id: number; authority: string; seq: number; created_at: string; actor_user_id: number; reason: string }>(env.DB.prepare(
    `SELECT e.user_id, e.authority, e.seq, e.created_at, e.actor_user_id, e.reason
       FROM work_graph_release_authority_events e
       JOIN user_company_links l ON l.company_id = e.company_id AND l.user_id = e.user_id
      WHERE e.tenant_id = ? AND e.company_id = ? AND (? IS NULL OR e.user_id = ?)
        AND e.op = 'grant'
        AND e.seq = (SELECT MAX(x.seq) FROM work_graph_release_authority_events x
                      WHERE x.tenant_id = e.tenant_id AND x.company_id = e.company_id AND x.user_id = e.user_id
                        AND x.authority = e.authority)
      ORDER BY e.id
      LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, userId, userId, limit));
  return rows.map((r) => ({
    userId: Number(r.user_id), authority: r.authority, seq: Number(r.seq), grantedAt: r.created_at, grantedByUserId: Number(r.actor_user_id), reason: r.reason,
  }));
}

/** The release authorities one person holds now in one tenant and company, sorted. None outside a valid scope. */
export async function resolveReleaseAuthorities(env: Pick<Env, 'DB'>, q: { tenantId: number; companyId: number; userId: number }): Promise<string[]> {
  if (!scopeOk(q) || !posInt(q.userId)) return [];
  const m = new Meter(env);
  return (await holders(env, m, q, q.userId, RELEASE_AUTHORITIES.length)).map((h) => h.authority).sort();
}

/**
 * Every person's release authorities in one scope, as the release services read them (`ReleaseContext.authorities`):
 * the acting Super Admin's for a takedown, each reviewer's when an approval is counted at publication.
 */
export async function releaseAuthoritiesForScope(env: Pick<Env, 'DB'>, scope: AuthorityScope): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!scopeOk(scope)) return out;
  const m = new Meter(env);
  for (const h of await holders(env, m, scope, null, RELEASE_AUTHORITY_LIMITS.holdersMax)) {
    out.set(h.userId, [...(out.get(h.userId) ?? []), h.authority].sort());
  }
  return out;
}

/**
 * D5585 part 9 — the people of one scope whose account is revoked, for `ReleaseContext.revokedUserIds`. Revoked is the
 * platform's own account revocation, `users.is_active = 0`: the flag a session is refused on (`auth.ts`), which an
 * HQ licence revocation and an admin deactivation set. The platform never deletes a `users` row (`dsrRequests.ts`), so
 * there is no other account state to read. A removed company link is not a revocation of the person: it already
 * withdraws their grants here (both resolvers join the link), so their approvals stop counting through `authorities`.
 *
 * Who is checked: the company's linked people (every grant holder was linked when granted), and everyone the scope's
 * release records name as acting — reviewers of decisions, attesters (an agent's sponsor too), manifest authors, and the
 * approvers of component heads (whom publication re-checks; a revoked one refuses it `revoked_author`). The answer
 * is not capped: a cap would drop a revocation, and dropping one would let that person's decisions count. Its size is
 * bounded by those people, not by the platform's users. Reactivating the account (`is_active = 1`) restores them on the
 * next request.
 */
export async function revokedReleaseUsers(env: Pick<Env, 'DB'>, scope: AuthorityScope): Promise<Set<number>> {
  if (!scopeOk(scope)) return new Set();
  const m = new Meter(env);
  const t = scope.tenantId, co = scope.companyId;
  const rows = await m.all<{ id: number }>(env.DB.prepare(
    `SELECT u.id FROM users u
      WHERE u.is_active = 0 AND u.id IN (
        SELECT user_id FROM user_company_links WHERE company_id = ?
        UNION SELECT reviewer_user_id FROM work_graph_release_decisions WHERE tenant_id = ? AND company_id = ?
        UNION SELECT actor_user_id FROM work_graph_release_attestations WHERE tenant_id = ? AND company_id = ?
        UNION SELECT actor_user_id FROM work_graph_release_manifests WHERE tenant_id = ? AND company_id = ?
        UNION SELECT approver_user_id FROM work_graph_events
         WHERE tenant_id = ? AND company_id = ? AND approver_user_id IS NOT NULL)`,
  ).bind(co, t, co, t, co, t, co, t, co));
  return new Set(rows.map((r) => Number(r.id)));
}

/** The grants of one scope: who holds what now, and (with `history`) every grant and revocation, newest first. */
export async function listReleaseAuthorityGrants(
  env: Pick<Env, 'DB'>, scope: AuthorityScope, opts: { userId?: number | null; history?: boolean; limit: number },
): Promise<{ holders: AuthorityHolder[]; events: AuthorityEvent[] | null; cost: Cost }> {
  const m = new Meter(env);
  const userId = opts.userId ?? null;
  const limit = Math.min(Math.max(1, opts.limit), RELEASE_AUTHORITY_LIMITS.listMax);
  const current = await holders(env, m, scope, userId, limit);
  let events: AuthorityEvent[] | null = null;
  if (opts.history) {
    const rows = await m.all<{ id: number; user_id: number; authority: string; seq: number; op: 'grant' | 'revoke'; reason: string;
      actor_user_id: number; created_at: string }>(env.DB.prepare(
      `SELECT id, user_id, authority, seq, op, reason, actor_user_id, created_at FROM work_graph_release_authority_events
        WHERE tenant_id = ? AND company_id = ? AND (? IS NULL OR user_id = ?)
        ORDER BY id DESC
        LIMIT ?`,
    ).bind(scope.tenantId, scope.companyId, userId, userId, limit));
    events = rows.map((r) => ({
      id: Number(r.id), userId: Number(r.user_id), authority: r.authority, seq: Number(r.seq), op: r.op, reason: r.reason,
      actorUserId: Number(r.actor_user_id), createdAt: r.created_at,
    }));
  }
  return { holders: current, events, cost: { ...m.cost } };
}
