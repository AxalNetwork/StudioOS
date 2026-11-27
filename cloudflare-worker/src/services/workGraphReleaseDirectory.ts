/**
 * D5585 part 11 (#5585, WorkGraph P1 under the #5577 epic) — the read-only lookups the release page's canvas brief
 * (#8608) marks "backend required": people's names beside the user ids the release reads return, the scopes that have
 * release lines (for the admin scope bar), the company's linked people to grant an authority to, and which release
 * switches are on. Nothing here writes. Decision: `documentation/architecture/decisions/D5585-p11.md`.
 *
 * NAMES. A person's name is the one other members see (`effectiveDisplayName`, D4616: the profile's display name, else
 * the account name). Never an email. The Super-Admin reads name everyone they return; the reviewer read names only
 * people linked to the reviewer's company (`linkedTo`), as the company page shows its members' names to its members
 * (#3841), and answers null for anyone else.
 *
 * COST. Every helper takes the caller's `Meter`, so its statements are in the answer's `cost`.
 */
import type { Env } from '../types';
import { Meter } from './workGraphReleases';
import { effectiveDisplayName } from './profileExpansion';
import { RELEASE_AUTHORITY_LIMITS, type AuthorityScope } from './workGraphReleaseAuthorities';
import { releaseAdminEnabled } from './workGraphReleaseAdmin';
import { releaseDeliveryEnabled } from './workGraphReleaseAdapters';
import { releaseSitesEnabled } from './workGraphReleaseSites';

export const RELEASE_DIRECTORY_LIMITS = Object.freeze({
  /** Scopes the scope list answers at most. */
  scopesMax: 200,
  /** Linked people the candidate list answers at most. */
  candidatesMax: RELEASE_AUTHORITY_LIMITS.listMax,
});

/** A person named by a release read: the name other members see, or null (no account, no name, or not shown). */
export interface ReleasePerson { name: string | null }

/**
 * The names of the people `ids` names, keyed by user id. Every valid id gets a key. With `linkedTo`, only people linked
 * to that company are named; anyone else is null. One statement, none when there is no id.
 */
export async function releasePeople(
  env: Pick<Env, 'DB'>, m: Meter, ids: Iterable<number | null | undefined>, opts: { linkedTo?: number } = {},
): Promise<Record<string, ReleasePerson>> {
  const want = [...new Set([...ids].filter((x): x is number => Number.isSafeInteger(x) && (x as number) > 0))].sort((a, b) => a - b);
  const out: Record<string, ReleasePerson> = {};
  for (const id of want) out[String(id)] = { name: null };
  if (!want.length) return out;
  const linkedTo = opts.linkedTo ?? null;
  const rows = await m.all<{ id: number; display_name: string | null; name: string | null }>(env.DB.prepare(
    `SELECT u.id, u.display_name, u.name FROM users u
      WHERE u.id IN (SELECT value FROM json_each(?))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM user_company_links l WHERE l.user_id = u.id AND l.company_id = ?))`,
  ).bind(JSON.stringify(want), linkedTo, linkedTo));
  for (const r of rows) out[String(r.id)] = { name: effectiveDisplayName(r) };
  return out;
}

export interface ReleaseScopeItem {
  tenantId: number; companyId: number;
  /** `company_profiles.company_name`; null when the company has no profile row. */
  companyName: string | null;
  companyArchived: boolean;
  lines: number;
}

/**
 * Every (tenant, company) that has a release line, with the company's name and how many lines it has, by tenant then
 * company. Tenants have no name anywhere on the platform: a tenant is its id.
 */
export async function listReleaseScopes(env: Pick<Env, 'DB'>, m: Meter, limit: number): Promise<{ scopes: ReleaseScopeItem[]; truncated: boolean }> {
  const rows = await m.all<{ tenant_id: number; company_id: number; lines: number; company_name: string | null; archived_at: string | null }>(env.DB.prepare(
    `SELECT l.tenant_id, l.company_id, COUNT(*) AS lines, cp.company_name, cp.archived_at
       FROM work_graph_release_lines l LEFT JOIN company_profiles cp ON cp.id = l.company_id
      GROUP BY l.tenant_id, l.company_id
      ORDER BY l.tenant_id, l.company_id
      LIMIT ?`,
  ).bind(limit + 1));
  return {
    scopes: rows.slice(0, limit).map((r) => ({
      tenantId: Number(r.tenant_id), companyId: Number(r.company_id), companyName: r.company_name ?? null,
      companyArchived: r.archived_at != null, lines: Number(r.lines),
    })),
    truncated: rows.length > limit,
  };
}

export interface GrantCandidate {
  userId: number;
  name: string | null;
  /** False while the account is revoked (`users.is_active = 0`): a grant would count for nothing until it is restored. */
  active: boolean;
  /** The release authorities the person holds now in this tenant and company, sorted. */
  held: string[];
  /** The current `seq` of each authority key ever written for the person here: what a grant or revocation sends as `expected_seq`. Absent is 0. */
  seqs: Record<string, number>;
}

/**
 * The people linked to the company (`user_company_links`), the only people a grant accepts, each with what they hold in
 * the scope now and each key's `seq`. Nobody who is not linked is listed. Two statements.
 */
export async function listGrantCandidates(
  env: Pick<Env, 'DB'>, m: Meter, scope: AuthorityScope, limit: number,
): Promise<{ candidates: GrantCandidate[]; truncated: boolean }> {
  const people = await m.all<{ user_id: number; display_name: string | null; name: string | null; is_active: number | null }>(env.DB.prepare(
    `SELECT l.user_id, u.display_name, u.name, u.is_active
       FROM user_company_links l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.company_id = ?
      GROUP BY l.user_id
      ORDER BY l.user_id
      LIMIT ?`,
  ).bind(scope.companyId, limit + 1));
  const keys = await m.all<{ user_id: number; authority: string; seq: number }>(env.DB.prepare(
    `SELECT user_id, authority, MAX(seq) AS seq FROM work_graph_release_authority_events
      WHERE tenant_id = ? AND company_id = ?
      GROUP BY user_id, authority`,
  ).bind(scope.tenantId, scope.companyId));
  const byUser = new Map<number, { authority: string; seq: number }[]>();
  for (const k of keys) byUser.set(Number(k.user_id), [...(byUser.get(Number(k.user_id)) ?? []), { authority: k.authority, seq: Number(k.seq) }]);
  return {
    candidates: people.slice(0, limit).map((p) => {
      const mine = byUser.get(Number(p.user_id)) ?? [];
      return {
        userId: Number(p.user_id), name: effectiveDisplayName(p), active: p.is_active === 1,
        held: mine.filter((k) => k.seq % 2 === 1).map((k) => k.authority).sort(),
        seqs: Object.fromEntries([...mine].sort((a, b) => (a.authority < b.authority ? -1 : 1)).map((k) => [k.authority, k.seq])),
      };
    }),
    truncated: people.length > limit,
  };
}

/** Which release switches are on, as booleans. Never any other value of the environment. */
export function releaseSwitches(env: Pick<Env, 'WORK_GRAPH_RELEASE_ADMIN' | 'WORK_GRAPH_RELEASE_DELIVERY' | 'WORK_GRAPH_RELEASE_SITES'>) {
  return { admin: releaseAdminEnabled(env), delivery: releaseDeliveryEnabled(env), sites: releaseSitesEnabled(env) };
}
