/**
 * D782 (#2112) — GitHub feeds Prototype / MVP: a must-have follows its pull
 * request, and each release records an MVP release check.
 *
 * A pull request is already a must-have (`github.ts`, D655). The sync's main
 * loop hands this file every pull request and release it read (`saw`), and
 * after the loop `finish` adds, per repository:
 *
 *   - THE STATE (`prState`), from GitHub's facts only:
 *       draft → planned; open → in_progress; review requested, or approved
 *       (`/pulls/{n}/reviews`, read for at most REVIEWS_READ open pull requests
 *       a sync) → in_review; merged → built; closed unmerged → dropped.
 *     It is kept in `pr_state`, and written into the must-have only when it
 *     changes: planned, in progress, in review and built set `delivery_status`
 *     (Backlog, In Progress, Review, Done; built also sets `done_at` once) and
 *     keep it a must-have; dropped takes it off the must-haves
 *     (`is_must_have = 0`). So a founder's own edit stands until GitHub's
 *     state moves again, and a Dropped is undone by marking it a must-have.
 *     Nothing else on the must-have is written.
 *   - RELEASE CHECKS (`mvp_release_checks`, through the ledger). For each
 *     published release, a fed must-have is:
 *       - IN the release if its pull request merged at or before the release
 *         was published, and after the repository's previous release: the
 *         check is the first release that carried it, done at the release;
 *       - NOT IN the release if its pull request was open when the release was
 *         published (opened before it, and neither merged nor closed by then):
 *         the check stays open.
 *     A pull request opened after a release, or closed unmerged before it, is
 *     neither. A re-sync updates a check; a check deleted here stays deleted.
 *
 * No new GitHub permission: pull requests and their reviews are Pull
 * requests: Read, releases are Contents: Read.
 */
import type { Env } from '../../../types';
import { packBatches, releaseExternalId } from './roadmap';

type GhFetch = (path: string) => Promise<Response>;
export type PrState = 'planned' | 'in_progress' | 'in_review' | 'built' | 'dropped';

/** Open pull requests whose reviews a sync reads, to find an approval. The rest read In progress until asked for review. */
export const REVIEWS_READ = 30;

interface Seen { pulls: any[]; releases: any[] }

const pullExternalId = (repo: string, n: number) => `pull:${repo}#${n}`;
export const releaseCheckExternalId = (repo: string, releaseId: unknown, n: number) => `release-check:${repo}@${releaseId}#${n}`;

/** A GitHub timestamp, or null: only an ISO date-time is kept. */
function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? v : null;
}

/** The pull request's page on GitHub, or null. */
export function pullUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d{1,9}$/.test(v) ? v : null;
}

/** Whether a pull request is waiting on a reviewer: one or a team asked. */
const reviewRequested = (pr: any) => (Array.isArray(pr?.requested_reviewers) && pr.requested_reviewers.length > 0)
  || (Array.isArray(pr?.requested_teams) && pr.requested_teams.length > 0);

/** GitHub's state for a pull request. `approved` is whether its latest reviews include an approval. */
export function prState(pr: any, approved = false): PrState {
  // Merged is a fact; only the release rules compare its date.
  if (pr?.merged_at) return 'built';
  if (pr?.state === 'closed') return 'dropped';
  if (pr?.draft === true) return 'planned';
  if (reviewRequested(pr) || approved) return 'in_review';
  return 'in_progress';
}

/** Whether a pull request's reviews approve it: each reviewer's latest decision, and at least one APPROVED. */
export function approvedBy(reviews: unknown): boolean {
  const latest = new Map<string, string>();
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const who = r?.user?.id ?? r?.user?.login;
    if (who == null || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r?.state)) continue;
    latest.set(String(who), r.state);
  }
  return [...latest.values()].includes('APPROVED');
}

export interface ReleaseCheck { release: any; pull: number; in: boolean }

/**
 * Each release's checks for one repository, by the two rules above. A pull
 * request appears IN at most one release, the first published at or after it
 * merged, and NOT IN each release published while it was open.
 */
export function releaseChecks(pulls: any[], releases: any[]): ReleaseCheck[] {
  const published = releases
    .filter((r) => r && !r.draft && r.id != null && isoOrNull(r.published_at) && String(r.tag_name ?? '').trim())
    .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)) || Number(a.id) - Number(b.id));
  const out: ReleaseCheck[] = [];
  for (const pr of pulls) {
    if (!pr || !Number.isSafeInteger(pr.number)) continue;
    const merged = isoOrNull(pr.merged_at);
    const opened = isoOrNull(pr.created_at);
    const closed = isoOrNull(pr.closed_at);
    let carried = false;
    for (const rel of published) {
      const at = String(rel.published_at);
      if (merged && merged <= at) {
        if (!carried) out.push({ release: rel, pull: pr.number, in: true });
        carried = true;
        continue;
      }
      const openThen = opened !== null && opened <= at && (!closed || closed > at);
      if (openThen) out.push({ release: rel, pull: pr.number, in: false });
    }
  }
  return out;
}

const DELIVERY: Record<Exclude<PrState, 'dropped'>, string> = {
  planned: 'Backlog', in_progress: 'In Progress', in_review: 'Review', built: 'Done',
};

const LEDGER_OF = `SELECT external_id, local_table, local_id FROM connector_fed_items
     WHERE integration_id = ? AND external_id IN (SELECT value FROM json_each(?))`;
// A check the ledger links. A check deleted here keeps `local_table` with no
// `local_id`, is never re-created, and only its ledger row is touched.
const CHECK_LEDGER_NEW = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, 'prototype_mvp', 'release_check', ?, 'mvp_release_checks', last_insert_rowid())
     ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`;
const CHECK_LEDGER_TOUCH = `UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?`;
const UNLINK_DELETED_CHECK = `UPDATE connector_fed_items SET local_id = NULL
     WHERE integration_id = ? AND external_id = ? AND local_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mvp_release_checks WHERE id = ? AND feature_id = ?)`;
// A deleted must-have takes its checks with it (ON DELETE CASCADE); their ledger rows are unlinked too.
const UNLINK_GONE_CHECK = `UPDATE connector_fed_items SET local_id = NULL
     WHERE integration_id = ? AND external_id = ? AND local_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mvp_release_checks WHERE id = connector_fed_items.local_id)`;

/** One sync's Prototype / MVP work: `saw` during the loop, `finish` once after it. */
export function mvpRun(env: Env, integrationId: number, projectId: number) {
  const seen = new Map<string, Seen>();
  const of = (repo: string) => {
    if (!seen.has(repo)) seen.set(repo, { pulls: [], releases: [] });
    return seen.get(repo)!;
  };
  return {
    saw(repo: string, kind: 'issues' | 'pulls' | 'releases', items: any[]): void {
      if ((kind === 'pulls' || kind === 'releases') && Array.isArray(items)) of(repo)[kind].push(...items);
    },

    /** States and release checks, per repository, within `budget` subrequests. */
    async finish(ghFetch: GhFetch, repos: string[], budget: number): Promise<Record<string, number | boolean>> {
      const counts = { must_haves_moved: 0, release_checks: 0, release_checks_created: 0, reviews_read: 0 } as Record<string, number | boolean>;
      let used = 0;
      const spend = (n = 1) => { used += n; return used <= budget; };
      let reviewsLeft = REVIEWS_READ;
      for (const repo of repos) {
        const s = of(repo);
        const pulls = s.pulls.filter((p) => p && Number.isSafeInteger(p.number));
        if (!pulls.length) continue;
        const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;

        // The fed must-haves, and the checks already made, from the ledger.
        const checks = releaseChecks(pulls, s.releases);
        const ids = [...pulls.map((p) => pullExternalId(repo, p.number)), ...checks.map((c) => releaseCheckExternalId(repo, c.release.id, c.pull))];
        if (!spend()) { counts.mvp_partial = true; return counts; }
        const ledger = new Map<string, { local_table: string | null; local_id: number | null }>();
        for (let at = 0; at < ids.length; at += 500) {
          const rows = await env.DB.prepare(LEDGER_OF).bind(integrationId, JSON.stringify(ids.slice(at, at + 500)))
            .all<{ external_id: string; local_table: string | null; local_id: number | null }>();
          for (const r of rows.results || []) ledger.set(r.external_id, r);
          if (at > 0 && !spend()) { counts.mvp_partial = true; return counts; }
        }
        // A deleted must-have's ledger row was unlinked by the main loop (#1906), so it has no id here.
        const featureOf = (n: number) => ledger.get(pullExternalId(repo, n))?.local_id ?? null;

        const stmts: D1PreparedStatement[][] = [];
        // 1. Each fed must-have follows its pull request, written only when GitHub's state moves.
        for (const pr of pulls) {
          const feature = featureOf(pr.number);
          if (feature == null) continue;
          let approved = false;
          if (pr.state === 'open' && pr.draft !== true && !reviewRequested(pr) && reviewsLeft > 0) {
            if (!spend()) { counts.mvp_partial = true; return counts; }
            reviewsLeft -= 1;
            counts.reviews_read = Number(counts.reviews_read) + 1;
            const res = await ghFetch(`${path}/pulls/${pr.number}/reviews?per_page=100`);
            if (!res.ok) throw new Error(`github_api_failed: ${res.status} ${path}/pulls/reviews`);
            approved = approvedBy(await res.json());
          }
          const state = prState(pr, approved);
          const url = pullUrl(pr.html_url);
          stmts.push([state === 'dropped'
            ? env.DB.prepare(
              `UPDATE mvp_features SET is_must_have = CASE WHEN pr_state IS NOT ? THEN 0 ELSE is_must_have END,
                      updated_at = CASE WHEN pr_state IS NOT ? THEN CURRENT_TIMESTAMP ELSE updated_at END, pr_state = ?, pr_url = ?
                WHERE id = ? AND project_id = ?`,
            ).bind(state, state, state, url, feature, projectId)
            : env.DB.prepare(
              `UPDATE mvp_features SET delivery_status = CASE WHEN pr_state IS NOT ? THEN ? ELSE delivery_status END,
                      is_must_have = CASE WHEN pr_state IS NOT ? THEN 1 ELSE is_must_have END,
                      done_at = CASE WHEN pr_state IS NOT ? AND ? IS NOT NULL THEN COALESCE(done_at, ?) ELSE done_at END,
                      updated_at = CASE WHEN pr_state IS NOT ? THEN CURRENT_TIMESTAMP ELSE updated_at END, pr_state = ?, pr_url = ?
                WHERE id = ? AND project_id = ?`,
            ).bind(state, DELIVERY[state], state, state, state === 'built' ? isoOrNull(pr.merged_at) : null,
              state === 'built' ? isoOrNull(pr.merged_at) : null, state, state, url, feature, projectId)]);
          counts.must_haves_moved = Number(counts.must_haves_moved) + 1;
        }

        // 2. The release checks, through the ledger, for must-haves that still exist.
        for (const c of checks) {
          const feature = featureOf(c.pull);
          if (feature == null) {
            const gone = ledger.get(releaseCheckExternalId(repo, c.release.id, c.pull));
            if (gone?.local_id != null) stmts.push([env.DB.prepare(UNLINK_GONE_CHECK).bind(integrationId, releaseCheckExternalId(repo, c.release.id, c.pull))]);
            continue;
          }
          counts.release_checks = Number(counts.release_checks) + 1;
          const externalId = releaseCheckExternalId(repo, c.release.id, c.pull);
          const label = `${c.in ? 'In' : 'Not in'} ${String(c.release.tag_name).trim().slice(0, 200)}`;
          const doneAt = c.in ? String(c.release.published_at) : null;
          const known = ledger.get(externalId);
          if (known?.local_table === 'mvp_release_checks' && known.local_id == null) {
            stmts.push([env.DB.prepare(CHECK_LEDGER_TOUCH).bind(integrationId, externalId)]);
          } else if (known?.local_id != null) {
            stmts.push([
              env.DB.prepare(
                `UPDATE mvp_release_checks SET label = ?, done_at = ?, in_release = ?, updated_at = datetime('now'),
                        release_id = (SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ? AND local_table = 'roadmap_releases')
                  WHERE id = ? AND feature_id = ?`,
              ).bind(label, doneAt, c.in ? 1 : 0, integrationId, releaseExternalId(repo, c.release.id), known.local_id, feature),
              env.DB.prepare(CHECK_LEDGER_TOUCH).bind(integrationId, externalId),
              env.DB.prepare(UNLINK_DELETED_CHECK).bind(integrationId, externalId, known.local_id, feature),
            ]);
          } else {
            stmts.push([
              env.DB.prepare(
                `INSERT INTO mvp_release_checks (feature_id, label, done_at, in_release, release_id)
                 VALUES (?, ?, ?, ?, (SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ? AND local_table = 'roadmap_releases'))`,
              ).bind(feature, label, doneAt, c.in ? 1 : 0, integrationId, releaseExternalId(repo, c.release.id)),
              env.DB.prepare(CHECK_LEDGER_NEW).bind(integrationId, projectId, externalId),
            ]);
            counts.release_checks_created = Number(counts.release_checks_created) + 1;
          }
        }

        for (const batch of packBatches(stmts)) {
          if (!spend()) { counts.mvp_partial = true; return counts; }
          await env.DB.batch(batch);
        }
      }
      return counts;
    },
  };
}
