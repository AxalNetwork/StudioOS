/**
 * D782 (#2115) — GitHub feeds Build › Founding team: who builds what.
 *
 * Per chosen repository, under the App's Metadata and Contents reads (no new
 * permission):
 *   - `GET /repos/{o}/{r}/contributors` (Metadata): who has committed;
 *   - `GET /repos/{o}/{r}/commits?since=…` (Contents): their commits in the
 *     last 90 days, at most MAX_COMMIT_PAGES pages per repository.
 * A bot (GitHub's `type: "Bot"`, or a login ending `[bot]`) is not a person
 * and is left out.
 *
 * A LOGIN IS NEVER MATCHED TO A PERSON BY THE CODE. Each login lands in
 * `github_contributors` with its commit count; the founder maps it to a
 * founder on the cap table once (`github_login_map`), and only then does it
 * show on that founder's row: "Builds: N commits in the last 90 days". No
 * name, no email, no guess. A mapped login is the ledger row
 * (`'founding_team', 'contributor'`), so the fed count counts mapped
 * contributors.
 *
 * A LOGIN AND A COMMIT COUNT ARE PERSONAL DATA. Only the project's members
 * read them (the read takes `member`); they are never logged, never in an
 * error, and they go with the connection: its rows cascade, and the
 * provider's disconnect deletes them first (`deleteContributorsOf`). The
 * founder's mapping is the project's own and stays.
 *
 * NO SIDE EFFECTS, AND NO IMPORT OF `../github`: the sync hands in its own
 * authenticated GET, as `solutionDesign.ts` does.
 */
import type { Env } from '../../../types';
import type { GithubGet } from './solutionDesign';

/** The window a commit counts in. */
export const COMMIT_WINDOW_DAYS = 90;
/** At most this many 100-commit pages are read per repository. */
export const MAX_COMMIT_PAGES = 5;
/** At most this many logins are kept per repository, the most active first. */
export const MAX_LOGINS = 100;
const PER_PAGE = 100;
// A repository's fixed cost: its contributors, the mapped logins' read and the batch.
const REPO_SETUP_COST = 3;
const LOGIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;

/** A login as it is stored and compared: lower-cased, since GitHub's logins ignore case. Null when it is not one. */
export function loginKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  return LOGIN_RE.test(k) ? k : null;
}

const isBot = (u: any) => u?.type === 'Bot' || (typeof u?.login === 'string' && /\[bot\]$/i.test(u.login));

/** Each login's commits in a page of `/commits`, by its GitHub author; a commit with no GitHub author is not counted. */
export function commitsByLogin(pages: unknown[][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const page of pages) {
    for (const c of Array.isArray(page) ? page : []) {
      const author = (c as any)?.author;
      if (!author || isBot(author)) continue;
      const k = loginKey(author.login);
      if (k) out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

/** The logins to keep for a repository: its contributors and its recent authors, people only, the most active first. */
export function teamLogins(contributors: unknown, recent: Map<string, number>): { login: string; commits: number }[] {
  const all = new Map<string, number>(recent);
  for (const u of Array.isArray(contributors) ? contributors : []) {
    if (isBot(u)) continue;
    const k = loginKey((u as any)?.login);
    if (k && !all.has(k)) all.set(k, 0);
  }
  return [...all].map(([login, commits]) => ({ login, commits }))
    .sort((a, b) => b.commits - a.commits || a.login.localeCompare(b.login)).slice(0, MAX_LOGINS);
}

// ───────────────────────────────────────────────────────────── the sync

const UPSERT = `INSERT INTO github_contributors (integration_id, project_id, repository, login, commits_90d)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, repository, login) DO UPDATE SET
       commits_90d = excluded.commits_90d, updated_at = CURRENT_TIMESTAMP`;
const DROP_GONE = `DELETE FROM github_contributors
     WHERE integration_id = ? AND project_id = ? AND repository = ? AND login NOT IN (SELECT value FROM json_each(?))`;
/** A mapped login's ledger row for one connection: it links the login to its founder. */
const LEDGER_MAPPED = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     SELECT ?, m.project_id, 'founding_team', 'contributor', 'contributor:' || m.project_id || ':' || m.login, 'cap_table_holders', m.holder_id
       FROM github_login_map m WHERE m.project_id = ? AND m.login IN (SELECT value FROM json_each(?))
     ON CONFLICT(integration_id, external_id) DO UPDATE SET
       last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`;

/**
 * Reads each chosen repository's contributors and their last 90 days of
 * commits, within `budget` subrequests. Returns `contributors` (logins kept,
 * across repositories) and `partial` when the budget stopped it.
 */
export async function syncTeam(
  env: Env, integrationId: number, projectId: number, get: GithubGet, repos: string[], budget: number, now = new Date(),
): Promise<Record<string, number | boolean>> {
  const counts: Record<string, number | boolean> = { contributors: 0 };
  let left = budget;
  const spend = (n: number) => { if (left < n) return false; left -= n; return true; };
  const since = new Date(now.getTime() - COMMIT_WINDOW_DAYS * 86_400_000).toISOString();
  const GONE = Symbol('gone');
  const json = async (path: string): Promise<any> => {
    const res = await get(path);
    // 404: a repository GitHub no longer serves, which feeds nothing here. 409 and 204: an empty one, with no contributors.
    if (res.status === 404) return GONE;
    if (res.status === 409 || res.status === 204) return null;
    if (!res.ok) throw new Error(`github_api_failed: ${res.status} ${path.split('?')[0]}`);
    return res.json();
  };
  for (const repo of repos) {
    if (!spend(REPO_SETUP_COST)) { counts.partial = true; break; }
    const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
    const contributors = await json(`${path}/contributors?per_page=${PER_PAGE}`);
    if (contributors === GONE) continue;
    const pages: unknown[][] = [];
    let complete = true;
    for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
      if (!spend(1)) { complete = false; break; }
      const list = await json(`${path}/commits?since=${encodeURIComponent(since)}&per_page=${PER_PAGE}&page=${page}`);
      if (!Array.isArray(list)) break;
      pages.push(list);
      if (list.length < PER_PAGE) break;
    }
    const logins = teamLogins(contributors, commitsByLogin(pages));
    const keys = JSON.stringify(logins.map((l) => l.login));
    await env.DB.batch([
      // Only a complete read may drop a login it no longer sees.
      ...(complete ? [env.DB.prepare(DROP_GONE).bind(integrationId, projectId, repo, keys)] : []),
      ...logins.map((l) => env.DB.prepare(UPSERT).bind(integrationId, projectId, repo, l.login, l.commits)),
      env.DB.prepare(LEDGER_MAPPED).bind(integrationId, projectId, keys),
    ]);
    counts.contributors = Number(counts.contributors) + logins.length;
    if (!complete) { counts.partial = true; break; }
  }
  return counts;
}

/** The disconnect: a connection's logins and commit counts go with it. The founder's mapping stays. */
export async function deleteContributorsOf(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM github_contributors WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare(`DELETE FROM connector_fed_items WHERE integration_id = ? AND module = 'founding_team' AND kind = 'contributor'`).bind(integrationId),
  ]);
}

// ───────────────────────────────────────────────────────────── the module

export interface TeamFounder { id: number; name: string | null }

/**
 * What Founding team shows from code. A member reads each mapped founder's
 * builds per repository, the logins not yet matched, and the founders a login
 * may be mapped to; anyone else reads only how many logins arrived, never one.
 */
export async function foundingTeamFromCode(env: Env, projectId: number, member: boolean, founders: TeamFounder[]) {
  const rows = (await env.DB.prepare(
    `SELECT c.repository, c.login, MAX(c.commits_90d) AS commits, m.holder_id
       FROM github_contributors c
       JOIN integrations i ON i.id = c.integration_id
       LEFT JOIN github_login_map m ON m.project_id = c.project_id AND m.login = c.login
      WHERE c.project_id = ?
      GROUP BY c.repository, c.login, m.holder_id
      ORDER BY c.repository, commits DESC, c.login`,
  ).bind(projectId).all<{ repository: string; login: string; commits: number; holder_id: number | null }>()).results || [];
  const logins = new Set(rows.map((r) => r.login));
  if (!member) return { members_only: true, logins: logins.size, builds: [], unmatched: [], founders: [] };
  const known = new Set(founders.map((f) => f.id));
  const builds = new Map<number, { repository: string; commits_90d: number; login: string }[]>();
  const unmatched = new Map<string, { repository: string; commits_90d: number }[]>();
  for (const r of rows) {
    const one = { repository: r.repository, commits_90d: Number(r.commits) || 0 };
    if (r.holder_id != null && known.has(Number(r.holder_id))) {
      const list = builds.get(Number(r.holder_id)) ?? [];
      list.push({ ...one, login: r.login });
      builds.set(Number(r.holder_id), list);
    } else {
      const list = unmatched.get(r.login) ?? [];
      list.push(one);
      unmatched.set(r.login, list);
    }
  }
  return {
    members_only: false,
    logins: logins.size,
    builds: [...builds].map(([holderId, repositories]) => ({ record_id: `h-${holderId}`, repositories })),
    unmatched: [...unmatched].map(([login, repositories]) => ({ login, repositories })),
    founders: founders.map((f) => ({ record_id: `h-${f.id}`, holder_id: f.id, name: f.name ?? null })),
  };
}

export type MapOutcome = 'ok' | 'unknown_login' | 'unknown_founder' | 'not_mapped';

/**
 * The founder maps a login to a founder on the cap table. Only a login a sync
 * brought to this project may be mapped, and only to one of its founders; the
 * map row and its ledger rows (one per connection that read the login) are
 * written in one batch with `extra` (the activity line, which never names the
 * login).
 */
export async function mapLogin(env: Env, projectId: number, rawLogin: unknown, holderId: number, userId: number, extra: D1PreparedStatement[] = []): Promise<MapOutcome> {
  const login = loginKey(rawLogin);
  if (!login) return 'unknown_login';
  const seen = await env.DB.prepare('SELECT 1 FROM github_contributors WHERE project_id = ? AND login = ? LIMIT 1').bind(projectId, login).first();
  if (!seen) return 'unknown_login';
  const founder = await env.DB.prepare('SELECT 1 FROM cap_table_holders WHERE id = ? AND project_id = ? AND founder_role IS NOT NULL').bind(holderId, projectId).first();
  if (!founder) return 'unknown_founder';
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO github_login_map (project_id, login, holder_id, mapped_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, login) DO UPDATE SET holder_id = excluded.holder_id, mapped_by = excluded.mapped_by, mapped_at = CURRENT_TIMESTAMP`)
      .bind(projectId, login, holderId, userId),
    env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
        SELECT DISTINCT c.integration_id, c.project_id, 'founding_team', 'contributor', 'contributor:' || c.project_id || ':' || c.login, 'cap_table_holders', ?
          FROM (SELECT integration_id, project_id, login FROM github_contributors WHERE project_id = ? AND login = ?) c WHERE 1
        ON CONFLICT(integration_id, external_id) DO UPDATE SET
          last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`)
      .bind(holderId, projectId, login),
    ...extra,
  ]);
  return 'ok';
}

/** The founder undoes a mapping: the login is not yet matched again, and no longer counts as fed. */
export async function unmapLogin(env: Env, projectId: number, rawLogin: unknown, extra: D1PreparedStatement[] = []): Promise<MapOutcome> {
  const login = loginKey(rawLogin);
  if (!login) return 'not_mapped';
  const r = await env.DB.prepare('DELETE FROM github_login_map WHERE project_id = ? AND login = ?').bind(projectId, login).run();
  if (!r.meta?.changes) return 'not_mapped';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM connector_fed_items WHERE project_id = ? AND module = 'founding_team' AND kind = 'contributor' AND external_id = ?`)
      .bind(projectId, `contributor:${projectId}:${login}`),
    ...extra,
  ]);
  return 'ok';
}
