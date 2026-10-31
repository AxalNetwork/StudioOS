/**
 * #3841 (part 4 of #3727) — who a member can find and invite by name.
 *
 * A person is reachable from the caller when they share a company with them
 * (a `user_company_links` row on the same company) or an accepted connection
 * (an `active` `cofounder_connections` row between the two: both signed the
 * NDA). Nobody else is, so a search can never be used to enumerate accounts,
 * and an invitation by account can only reach someone the caller already
 * works with.
 *
 * NEVER AN EMAIL, NEVER A NUMERIC ID IN WHAT LEAVES HERE. A person is
 * `{ uid, name, avatar_url, shared }`; `avatar_url` is null because the
 * `users` table records none ("Not recorded"). The numeric id stays inside
 * the Worker, for the caller's own writes.
 *
 * Bound SQL only. The name match is `LIKE ? ESCAPE '\'`, with the query's own
 * `%`, `_` and `\` escaped, so a member types a name, not a pattern.
 */
import type { Env } from '../types';

export type Shared = { kind: 'company' | 'connection'; name: string };
export type Person = { uid: string; name: string; avatar_url: string | null; shared: Shared[] };
type Row = { id: number; uid: string; name: string; kind: 'company' | 'connection'; via: string | null };

export const SEARCH_MIN = 2;
export const SEARCH_MAX_LEN = 80;
export const SEARCH_LIMIT = 10;
export const CONNECTION_LABEL = 'Co-founder match';

/** The query, made safe for `LIKE ? ESCAPE '\'`. */
export const likeContains = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/**
 * Everyone reachable from `callerId`, optionally only those whose name holds
 * `q`, each with what they share with the caller. Active accounts only; the
 * caller is never in the list. `exclude` drops ids (a scope's members).
 */
async function reachableRows(env: Env, callerId: number, q: string | null, targetUid: string | null): Promise<Row[]> {
  const like = q == null ? null : likeContains(q);
  // One fixed statement: each filter is a bound value that is NULL when unused.
  const filter = [like, like, targetUid, targetUid];
  const r = await env.DB.prepare(
    `SELECT u.id, u.uid, u.name, 'company' AS kind, cp.company_name AS via
       FROM user_company_links mine
       JOIN user_company_links theirs ON theirs.company_id = mine.company_id AND theirs.user_id <> mine.user_id
       JOIN users u ON u.id = theirs.user_id AND u.is_active = 1
       JOIN company_profiles cp ON cp.id = mine.company_id
      WHERE mine.user_id = ?
        AND (? IS NULL OR u.name LIKE ? ESCAPE '\\') AND (? IS NULL OR u.uid = ?)
     UNION ALL
     SELECT u.id, u.uid, u.name, 'connection' AS kind, NULL AS via
       FROM cofounder_connections cc
       JOIN users u ON u.id = CASE WHEN cc.user_a_id = ? THEN cc.user_b_id ELSE cc.user_a_id END AND u.is_active = 1
      WHERE cc.status = 'active' AND (cc.user_a_id = ? OR cc.user_b_id = ?)
        AND (? IS NULL OR u.name LIKE ? ESCAPE '\\') AND (? IS NULL OR u.uid = ?)`,
  ).bind(callerId, ...filter, callerId, callerId, callerId, ...filter).all<Row>();
  return (r.results ?? []).filter((row) => Number(row.id) !== Number(callerId));
}

function group(rows: Row[]): Map<number, Person> {
  const people = new Map<number, Person>();
  for (const row of rows) {
    const p = people.get(row.id) ?? { uid: row.uid, name: row.name, avatar_url: null, shared: [] };
    const s: Shared = row.kind === 'company' ? { kind: 'company', name: row.via ?? '' } : { kind: 'connection', name: CONNECTION_LABEL };
    if (!p.shared.some((x) => x.kind === s.kind && x.name === s.name)) p.shared.push(s);
    people.set(row.id, p);
  }
  return people;
}

/** The search: at most ten people whose name holds `q`, reachable from the caller, minus `exclude`. */
export async function searchPeople(env: Env, callerId: number, q: string, exclude: ReadonlySet<number> = new Set()): Promise<Person[]> {
  const people = group(await reachableRows(env, callerId, q, null));
  return [...people.entries()]
    .filter(([id]) => !exclude.has(id))
    .map(([, p]) => p)
    .sort((a, b) => a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid))
    .slice(0, SEARCH_LIMIT);
}

/** One account by uid, if it is reachable from the caller: its numeric id (for the caller's write) and its public shape. */
export async function reachableAccount(env: Env, callerId: number, uid: string): Promise<{ id: number; person: Person } | null> {
  const people = group(await reachableRows(env, callerId, null, uid));
  const [entry] = people.entries();
  return entry ? { id: entry[0], person: entry[1] } : null;
}
