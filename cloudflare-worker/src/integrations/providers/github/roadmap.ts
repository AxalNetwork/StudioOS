/**
 * D782 (#2111) — GitHub feeds Product roadmap: milestones and releases.
 *
 * An issue is already a roadmap item (`github.ts`, D655). The sync's main loop
 * hands this file every issue, pull request and release it read (`saw`), and
 * after the loop `finish` adds, per repository:
 *
 *   - MILESTONES (`/milestones`, under the Issues read permission). An item
 *     whose issue sits in a milestone takes the milestone's title as its group
 *     (`milestone_title`) and its due date as its target (`milestone_due`, and
 *     `target_date`). A milestone with no due date sets the group only, and an
 *     issue taken out of its milestone loses the group. A target is never
 *     cleared: once written it may be the founder's.
 *   - RELEASES. Each published release becomes one `roadmap_releases` row,
 *     through the ledger (`connector_fed_items`): a re-sync updates the row and
 *     a row deleted here stays deleted (#1906). A draft is not a release.
 *   - SHIPPED, ON EVIDENCE ONLY. A roadmap item is marked shipped by a release
 *     when its issue is closed and either:
 *       1. the release's notes name the issue (`#12`, `acme/app#12` or the
 *          issue's URL), and then by the first such release; or
 *       2. a merged pull request in the same repository closes it with a
 *          closing keyword ("Closes #12", "Fixes", "Resolves" and their
 *          forms, in its title or body), and the release is the first one
 *          published at or after that pull request merged.
 *     Nothing else marks an item. A closed issue with no such evidence stays
 *     unshipped, and a mark already written is never moved by a later release.
 *
 * Every figure the sync reports is what it read: `milestones` read,
 * `milestone_items` grouped, `release_rows_created`, `items_shipped`.
 *
 * No new GitHub permission: milestones are Issues, releases are Contents.
 */
import type { Env } from '../../../types';

type GhFetch = (path: string) => Promise<Response>;

const MAX_PAGES = 5;
const PER_PAGE = 100;
/**
 * Statements per D1 batch, so one repository's work never builds an unbounded
 * batch. A release's INSERT and its ledger row stay in one batch: the ledger
 * row reads `last_insert_rowid()`.
 */
const BATCH = 200;

/** Groups of statements, packed into batches of at most BATCH without splitting a group. */
export function packBatches<T>(groups: T[][], size = BATCH): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const g of groups) {
    if (cur.length && cur.length + g.length > size) { out.push(cur); cur = []; }
    cur.push(...g);
  }
  if (cur.length) out.push(cur);
  return out;
}

interface Seen { issues: any[]; pulls: any[]; releases: any[] }

/** The release ledger id, the same one D655 counted releases under. */
export const releaseExternalId = (repo: string, id: unknown) => `release:${repo}@${id}`;
const issueExternalId = (repo: string, n: number) => `issue:${repo}#${n}`;

/** A GitHub timestamp, or null: only an ISO date-time is kept. */
function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? v : null;
}

/** The release's page on GitHub, or null: only a github.com https URL is kept. */
function releaseUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/[^\s"'<>]+$/.test(v) && v.length <= 500 ? v : null;
}

const sameRepo = (named: string | undefined, repo: string) => !named || named.toLowerCase() === repo.toLowerCase();

/**
 * The issue numbers a text names in this repository: `#12`, `acme/app#12` and
 * `https://github.com/acme/app/issues/12`. A pull request URL is not an issue.
 */
export function issuesNamed(text: unknown, repo: string): Set<number> {
  const out = new Set<number>();
  const s = typeof text === 'string' ? text.slice(0, 50_000) : '';
  for (const m of s.matchAll(/(?:^|[^\w/&#-])(?:([\w.-]+\/[\w.-]+))?#(\d{1,9})\b/g)) {
    if (sameRepo(m[1], repo)) out.add(Number(m[2]));
  }
  for (const m of s.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d{1,9})\b/g)) {
    if (sameRepo(m[1], repo)) out.add(Number(m[2]));
  }
  return out;
}

/** The issue numbers a pull request closes with a closing keyword, in this repository. */
export function issuesClosedBy(text: unknown, repo: string): Set<number> {
  const out = new Set<number>();
  const s = typeof text === 'string' ? text.slice(0, 50_000) : '';
  const keyword = '\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b:?\\s+';
  for (const m of s.matchAll(new RegExp(`${keyword}(?:([\\w.-]+\\/[\\w.-]+))?#(\\d{1,9})\\b`, 'gi'))) {
    if (sameRepo(m[1], repo)) out.add(Number(m[2]));
  }
  for (const m of s.matchAll(new RegExp(`${keyword}https:\\/\\/github\\.com\\/([\\w.-]+\\/[\\w.-]+)\\/issues\\/(\\d{1,9})\\b`, 'gi'))) {
    if (sameRepo(m[1], repo)) out.add(Number(m[2]));
  }
  return out;
}

export interface ShippedBy { issue: number; release: string; rule: 'listed' | 'closed_by_pull_request' }

/**
 * Which release shipped each closed issue, by the two rules above, or no entry
 * at all. `releases` and `pulls` are what the sync read for one repository.
 */
export function shippedBy(repo: string, issues: any[], pulls: any[], releases: any[]): ShippedBy[] {
  const published = releases
    .filter((r) => r && !r.draft && r.id != null && isoOrNull(r.published_at))
    .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)) || Number(a.id) - Number(b.id));
  const mergedClosing = new Map<number, string>();
  for (const pr of pulls) {
    const merged = isoOrNull(pr?.merged_at);
    if (!merged) continue;
    for (const n of issuesClosedBy(`${pr.title ?? ''}\n${pr.body ?? ''}`, repo)) {
      const was = mergedClosing.get(n);
      if (!was || merged < was) mergedClosing.set(n, merged);
    }
  }
  const out: ShippedBy[] = [];
  for (const issue of issues) {
    if (!issue || issue.pull_request || issue.state !== 'closed' || !Number.isSafeInteger(issue.number)) continue;
    const listed = published.find((r) => issuesNamed(r.body, repo).has(issue.number));
    if (listed) { out.push({ issue: issue.number, release: releaseExternalId(repo, listed.id), rule: 'listed' }); continue; }
    const merged = mergedClosing.get(issue.number);
    const after = merged ? published.find((r) => String(r.published_at) >= merged) : undefined;
    if (after) out.push({ issue: issue.number, release: releaseExternalId(repo, after.id), rule: 'closed_by_pull_request' });
  }
  return out;
}

/** A milestone's group and target, from the milestones read, else from the issue's own copy. */
function milestoneOf(issue: any, byNumber: Map<number, any>): { title: string; due: string | null } | null {
  const own = issue?.milestone;
  if (!own || !Number.isSafeInteger(own.number)) return null;
  const m = byNumber.get(own.number) ?? own;
  const title = String(m.title ?? '').trim().slice(0, 200);
  if (!title) return null;
  const due = isoOrNull(m.due_on);
  return { title, due: due ? due.slice(0, 10) : null };
}

// A release row the ledger links. ON CONFLICT covers a release an earlier sync
// only counted (D655: no local row), which now lands; a row deleted here keeps
// `local_table` with no `local_id`, is never re-created, and only its ledger
// row is touched.
const RELEASE_LEDGER_NEW = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, 'product_roadmap', 'release', ?, 'roadmap_releases', last_insert_rowid())
     ON CONFLICT(integration_id, external_id) DO UPDATE SET local_table = excluded.local_table, local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;
const RELEASE_LEDGER_TOUCH = `UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?`;
const UNLINK_DELETED_RELEASE = `UPDATE connector_fed_items SET local_id = NULL
     WHERE integration_id = ? AND external_id = ? AND local_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM roadmap_releases WHERE id = ? AND project_id = ?)`;
const LEDGER_OF = `SELECT external_id, local_table, local_id FROM connector_fed_items
     WHERE integration_id = ? AND external_id IN (SELECT value FROM json_each(?))`;
// The item and the release rows are found through the ledger, written out in
// each statement so the SQL guards read it whole (no interpolation).

/** GitHub commit/object IDs are full SHA-1s; abbreviated or malformed values are not evidence. */
export function commitSha(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}

/** Resolve a lightweight or annotated tag to a commit, never the tag object's SHA. */
export async function releaseCommitSha(
  ghFetch: GhFetch, repoPath: string, tag: string, spend: () => boolean,
): Promise<{ sha: string | null; partial: boolean }> {
  // Tag names come from GitHub, but still must not become URL path segments unchecked.
  if (!/^[\p{L}\p{N}._/@+%-]+$/u.test(tag) || tag.split('/').some((part) => !part || part === '.' || part === '..')) {
    return { sha: null, partial: false };
  }
  let path = `${repoPath}/git/ref/tags/${encodeURIComponent(tag)}`;
  const visited = new Set<string>();
  for (let depth = 0; depth < 6; depth += 1) {
    if (!spend()) return { sha: null, partial: true };
    const res = await ghFetch(path);
    if (res.status === 404 || res.status === 409) return { sha: null, partial: false };
    if (!res.ok) throw new Error(`github_api_failed: ${res.status} ${repoPath}/git/tag-commit`);
    const payload: any = await res.json();
    const object = payload?.object;
    const sha = commitSha(object?.sha);
    if (!sha) return { sha: null, partial: false };
    if (object.type === 'commit') return { sha, partial: false };
    if (object.type !== 'tag' || visited.has(sha)) return { sha: null, partial: false };
    visited.add(sha);
    path = `${repoPath}/git/tags/${sha}`;
  }
  return { sha: null, partial: false };
}

/** One sync's roadmap work: `saw` during the loop, `finish` once after it. */
export function roadmapRun(env: Env, integrationId: number, projectId: number) {
  const seen = new Map<string, Seen>();
  const of = (repo: string) => {
    if (!seen.has(repo)) seen.set(repo, { issues: [], pulls: [], releases: [] });
    return seen.get(repo)!;
  };
  return {
    saw(repo: string, kind: 'issues' | 'pulls' | 'releases', items: any[]): void {
      if (Array.isArray(items)) of(repo)[kind].push(...items);
    },

    /** Milestones, release rows and Shipped, per repository, within `budget` subrequests. */
    async finish(ghFetch: GhFetch, repos: string[], budget: number): Promise<Record<string, number | boolean>> {
      const counts = { milestones: 0, milestone_items: 0, release_rows_created: 0, items_shipped: 0 } as Record<string, number | boolean>;
      let used = 0;
      const spend = (n = 1) => { used += n; return used <= budget; };
      for (const repo of repos) {
        const s = of(repo);
        const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
        // Milestones: one paged read. A failed read stops the sync, as the main loop's reads do.
        const byNumber = new Map<number, any>();
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          if (!spend()) { counts.roadmap_partial = true; return counts; }
          const res = await ghFetch(`${path}/milestones?state=all&per_page=${PER_PAGE}&page=${page}`);
          if (!res.ok) throw new Error(`github_api_failed: ${res.status} ${path}/milestones`);
          const items = (await res.json()) as any[];
          for (const m of Array.isArray(items) ? items : []) {
            if (Number.isSafeInteger(m?.number)) { byNumber.set(m.number, m); counts.milestones = Number(counts.milestones) + 1; }
          }
          if (!Array.isArray(items) || items.length < PER_PAGE) break;
        }

        const stmts: D1PreparedStatement[][] = [];
        // 1. Each item's group and target, from its issue's milestone: one statement per item in a
        //    milestone, and one for the rest, which clears a group their issue no longer has.
        const outside: string[] = [];
        for (const issue of s.issues) {
          if (!issue || issue.pull_request || !Number.isSafeInteger(issue.number)) continue;
          const m = milestoneOf(issue, byNumber);
          if (!m) { outside.push(issueExternalId(repo, issue.number)); continue; }
          counts.milestone_items = Number(counts.milestone_items) + 1;
          stmts.push([env.DB.prepare(
            `UPDATE roadmap_okrs SET milestone_title = ?, milestone_due = ?, target_date = COALESCE(?, target_date)
              WHERE project_id = ? AND id = (SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ? AND local_table = 'roadmap_okrs')`,
          ).bind(m.title, m.due, m.due, projectId, integrationId, issueExternalId(repo, issue.number))]);
        }
        if (outside.length) {
          stmts.push([env.DB.prepare(
            `UPDATE roadmap_okrs SET milestone_title = NULL, milestone_due = NULL
              WHERE project_id = ? AND milestone_title IS NOT NULL AND id IN (SELECT local_id FROM connector_fed_items
                WHERE integration_id = ? AND local_table = 'roadmap_okrs' AND external_id IN (SELECT value FROM json_each(?)))`,
          ).bind(projectId, integrationId, JSON.stringify(outside))]);
        }

        // 2. Each published release is a row, through the ledger.
        const releases = s.releases.filter((r) => r && !r.draft && r.id != null && String(r.tag_name ?? '').trim());
        const ids = releases.map((r) => releaseExternalId(repo, r.id));
        const ledger = new Map<string, { local_table: string | null; local_id: number | null }>();
        if (ids.length) {
          if (!spend()) { counts.roadmap_partial = true; return counts; }
          const rows = await env.DB.prepare(LEDGER_OF).bind(integrationId, JSON.stringify(ids))
            .all<{ external_id: string; local_table: string | null; local_id: number | null }>();
          for (const r of rows.results || []) ledger.set(r.external_id, r);
        }
        for (const rel of releases) {
          const externalId = releaseExternalId(repo, rel.id);
          const known = ledger.get(externalId);
          if (known?.local_table === 'roadmap_releases' && known.local_id == null) {
            stmts.push([env.DB.prepare(RELEASE_LEDGER_TOUCH).bind(integrationId, externalId)]);
            continue;
          }
          const resolved = await releaseCommitSha(ghFetch, path, String(rel.tag_name).trim(), spend);
          if (resolved.partial) { counts.roadmap_partial = true; return counts; }
          const fields = [
            String(rel.tag_name).trim().slice(0, 200),
            typeof rel.name === 'string' && rel.name.trim() ? rel.name.trim().slice(0, 300) : null,
            isoOrNull(rel.published_at),
            releaseUrl(rel.html_url),
            rel.prerelease === true ? 1 : 0,
            resolved.sha,
          ];
          if (known?.local_id != null) {
            stmts.push([
              env.DB.prepare(`UPDATE roadmap_releases SET tag = ?, name = ?, published_at = ?, url = ?, prerelease = ?, commit_sha = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?`).bind(...fields, known.local_id, projectId),
              env.DB.prepare(RELEASE_LEDGER_TOUCH).bind(integrationId, externalId),
              env.DB.prepare(UNLINK_DELETED_RELEASE).bind(integrationId, externalId, known.local_id, projectId),
            ]);
          } else {
            stmts.push([
              env.DB.prepare(`INSERT INTO roadmap_releases (project_id, repository, tag, name, published_at, url, prerelease, commit_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(projectId, repo, ...fields),
              env.DB.prepare(RELEASE_LEDGER_NEW).bind(integrationId, projectId, externalId),
            ]);
            counts.release_rows_created = Number(counts.release_rows_created) + 1;
          }
        }

        // 3. Shipped, on evidence only. A mark already written stays; a deleted release row gives none.
        for (const mark of shippedBy(repo, s.issues, s.pulls, releases)) {
          counts.items_shipped = Number(counts.items_shipped) + 1;
          stmts.push([env.DB.prepare(
            `UPDATE roadmap_okrs SET shipped_release_id = (SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ? AND local_table = 'roadmap_releases')
              WHERE project_id = ? AND id = (SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ? AND local_table = 'roadmap_okrs')
                AND shipped_release_id IS NULL AND (SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ? AND local_table = 'roadmap_releases') IS NOT NULL`,
          ).bind(integrationId, mark.release, projectId, integrationId, issueExternalId(repo, mark.issue), integrationId, mark.release)]);
        }

        for (const batch of packBatches(stmts)) {
          if (!spend()) { counts.roadmap_partial = true; return counts; }
          await env.DB.batch(batch);
        }
      }
      return counts;
    },
  };
}
