/**
 * D1098 (#2963, #2408 part 3) — what Vercel brings to Prototype / MVP and
 * Product roadmap, read from `vercel_projects` and `vercel_deployments`.
 * `routes/cycle_build.ts` calls each as `parts.vercel`, in its own try, so one
 * failed read leaves the module readable. No side effects: nothing here
 * registers the provider.
 *
 * EVIDENCE ONLY.
 *   - A Preview chip is matched to a GitHub-fed must-have by its pull request's
 *     repository AND number (its ledger key, `pull:<repo>#<n>`), never by a
 *     branch name or a time.
 *   - "In production since" is drawn only when a READY production deployment's
 *     commit SHA equals the must-have's `merge_commit_sha`; "Live on" only when
 *     one equals the release's `commit_sha`. Both SHAs are GitHub's (G1, #2414).
 *     Without GitHub's SHA nothing is marked, and the part says why.
 *   - Nothing is written here; Vercel never writes a must-have, a roadmap item,
 *     a release or a release check.
 *
 * WHO SEES WHAT (the Tools rule). The venture's owner and its company's members
 * see project names, domains and preview links; anyone else sees counts and
 * states, never a name, a domain or a link.
 *
 * A COUNT IS MEASURED OR IT IS NOT DRAWN. A week with no production deploy is a
 * measured zero only within what the connection has read (180 days kept); a
 * share or a median with nothing to measure is null with its reason.
 */
import type { Env } from '../../types';

/** Weeks the Deploys strip covers. */
export const DEPLOY_WEEKS = 12;
const DAY = 86_400_000;

const rows = <T>(r: { results?: T[] } | null | undefined): T[] => r?.results ?? [];
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : null);

/** The Monday (UTC) that starts the week holding `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/** The median of a list, or null when it is empty. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const PROJECTS = `SELECT vp.integration_id, vp.vercel_project_id, vp.name, vp.production_domain, vp.live_state, vp.live_since
  FROM vercel_projects vp JOIN integrations i ON i.id = vp.integration_id AND i.provider_key = 'vercel'
 WHERE vp.project_id = ? ORDER BY vp.name, vp.id`;
// The newest production deployment per Vercel project: what the Live strip's commit and build are.
const LATEST_PRODUCTION = `SELECT d.vercel_project_id, d.state, d.commit_sha, d.build_seconds, d.created_at, d.ready_at, d.error_code
  FROM vercel_deployments d
 WHERE d.project_id = ? AND d.target = 'production'
   AND d.id = (SELECT d2.id FROM vercel_deployments d2 WHERE d2.project_id = d.project_id AND d2.vercel_project_id = d.vercel_project_id
                 AND d2.target = 'production' ORDER BY d2.created_at DESC, d2.id DESC LIMIT 1)`;
// GitHub's fed must-haves: the ledger names the repository and number; `merge_commit_sha` is G1's.
const FED_MUST_HAVES = `SELECT f.id, f.title, f.merge_commit_sha, l.external_id
  FROM connector_fed_items l JOIN mvp_features f ON f.id = l.local_id AND f.project_id = ?
 WHERE l.local_table = 'mvp_features' AND l.kind = 'pull_request' AND l.external_id LIKE 'pull:%'
 ORDER BY f.sort_order, f.id`;
const PREVIEWS = `SELECT repository, pr_number, state, created_at, preview_url FROM vercel_deployments
 WHERE project_id = ? AND target = 'preview' AND pr_number IS NOT NULL AND repository IS NOT NULL
 ORDER BY created_at DESC, id DESC`;
const SHIPPED_SHAS = `SELECT commit_sha, MIN(COALESCE(ready_at, created_at)) AS since FROM vercel_deployments
 WHERE project_id = ? AND target = 'production' AND state = 'READY' AND commit_sha IN (SELECT value FROM json_each(?))
 GROUP BY commit_sha`;

/** `pull:acme/web#12` → `{ repository: 'acme/web', number: 12 }`. */
export function pullKey(externalId: string): { repository: string; number: number } | null {
  const m = /^pull:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]{0,9})$/.exec(externalId);
  return m ? { repository: m[1].toLowerCase(), number: Number(m[2]) } : null;
}

const LIVE_WORDS: Record<string, string> = { live: 'Live', failing: 'Failing', building: 'Building', not_deployed: 'Not deployed' };

/** Prototype / MVP's `parts.vercel`: the Live strip and, per GitHub-fed must-have, its Preview and production marks. */
export async function mvpVercel(env: Env, projectId: number, member: boolean) {
  const projects = rows(await env.DB.prepare(PROJECTS).bind(projectId).all<any>());
  if (!projects.length) {
    return { state: 'empty', live: [], must_haves: [], reason: 'Vercel has not brought anything to this venture yet. Choose projects on Vercel\'s connector page.' };
  }
  const latest = new Map(rows(await env.DB.prepare(LATEST_PRODUCTION).bind(projectId).all<any>()).map((d) => [d.vercel_project_id, d]));
  const live = projects.map((p) => {
    const d = latest.get(p.vercel_project_id);
    return {
      state: p.live_state, label: LIVE_WORDS[p.live_state] ?? 'Not recorded', since: p.live_since ?? null,
      name: member ? p.name : null, domain: member ? p.production_domain ?? null : null,
      commit: d ? short(d.commit_sha) : null, build_seconds: d?.build_seconds ?? null, error_code: d?.state === 'ERROR' ? d.error_code ?? null : null,
    };
  });

  const fed = rows(await env.DB.prepare(FED_MUST_HAVES).bind(projectId).all<any>());
  const previews = rows(await env.DB.prepare(PREVIEWS).bind(projectId).all<any>());
  const newest = new Map<string, any>();
  for (const d of previews) {
    const k = `${String(d.repository).toLowerCase()}#${d.pr_number}`;
    if (!newest.has(k)) newest.set(k, d);
  }
  const shas = [...new Set(fed.map((f) => f.merge_commit_sha).filter((s): s is string => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s)))];
  const shipped = new Map(shas.length
    ? rows(await env.DB.prepare(SHIPPED_SHAS).bind(projectId, JSON.stringify(shas)).all<any>()).map((r) => [r.commit_sha, r.since])
    : []);
  const mustHaves = fed.flatMap((f) => {
    const key = pullKey(String(f.external_id));
    if (!key) return [];
    const pr = newest.get(`${key.repository}#${key.number}`);
    const sha = typeof f.merge_commit_sha === 'string' ? f.merge_commit_sha : null;
    return [{
      feature_id: f.id,
      preview: pr ? { state: pr.state, at: pr.created_at, url: member ? pr.preview_url ?? null : null } : null,
      preview_reason: pr ? null : 'Not recorded: no preview deploy for this pull request yet.',
      in_production_since: sha ? shipped.get(sha) ?? null : null,
      production_reason: !sha ? 'Needs the GitHub connection\'s commit links: no merge commit is recorded for this pull request.'
        : shipped.has(sha) ? null : 'No production deploy carries this pull request\'s merge commit yet.',
    }];
  });
  return { state: 'ok', live, must_haves: mustHaves, projects: projects.length, reason: null };
}

const WINDOW = `SELECT state, created_at, build_seconds, is_rollback, promoted_at FROM vercel_deployments
 WHERE project_id = ? AND target = 'production' AND created_at >= ? ORDER BY created_at, id`;
const EARLIEST = 'SELECT MIN(created_at) AS first FROM vercel_deployments WHERE project_id = ?';
const RELEASES = `SELECT id, tag, commit_sha FROM roadmap_releases WHERE project_id = ?
 ORDER BY published_at IS NULL, published_at DESC, id DESC LIMIT ?`;

/** Product roadmap's `parts.vercel`: 12 weekly production-deploy counts, the failed share, the median build, rollbacks and promotions, and each release's "Live on". */
export async function roadmapVercel(env: Env, projectId: number, releasesShown: number, now = Date.now()) {
  const projects = rows(await env.DB.prepare(PROJECTS).bind(projectId).all<any>());
  if (!projects.length) {
    return { state: 'empty', weeks: [], releases: [], reason: 'Vercel has not brought anything to this venture yet. Choose projects on Vercel\'s connector page.' };
  }
  const thisWeek = weekStart(now);
  const from = thisWeek - (DEPLOY_WEEKS - 1) * 7 * DAY;
  const deploys = rows(await env.DB.prepare(WINDOW).bind(projectId, new Date(from).toISOString()).all<any>());
  const first = (await env.DB.prepare(EARLIEST).bind(projectId).first<{ first: string | null }>())?.first ?? null;
  const firstWeek = first ? weekStart(Date.parse(first)) : null;
  const weeks = Array.from({ length: DEPLOY_WEEKS }, (_, i) => {
    const start = from + i * 7 * DAY;
    const n = deploys.filter((d) => weekStart(Date.parse(d.created_at)) === start).length;
    // Before the first deploy the connection read, a week is not measured: null, never 0.
    return { week_of: new Date(start).toISOString().slice(0, 10), count: firstWeek != null && start >= firstWeek ? n : null };
  });
  const finished = deploys.filter((d) => d.state === 'READY' || d.state === 'ERROR');
  const failed = finished.filter((d) => d.state === 'ERROR').length;
  const builds = deploys.filter((d) => d.state === 'READY' && Number.isFinite(d.build_seconds)).map((d) => Number(d.build_seconds));
  const events = deploys.filter((d) => d.is_rollback === 1 || d.promoted_at)
    .map((d) => ({ kind: d.is_rollback === 1 ? 'rollback' : 'promotion', at: d.is_rollback === 1 ? d.created_at : d.promoted_at }));

  const releases = rows(await env.DB.prepare(RELEASES).bind(projectId, releasesShown).all<any>());
  const shas = [...new Set(releases.map((r) => r.commit_sha).filter((s): s is string => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s)))];
  const shipped = new Map(shas.length
    ? rows(await env.DB.prepare(SHIPPED_SHAS).bind(projectId, JSON.stringify(shas)).all<any>()).map((r) => [r.commit_sha, r.since])
    : []);
  return {
    state: 'ok',
    weeks,
    failed_share: finished.length ? Math.round((failed / finished.length) * 100) : null,
    failed_reason: finished.length ? null : 'No production deploy finished in these 12 weeks.',
    median_build_seconds: median(builds),
    events,
    releases: releases.map((r) => {
      const sha = typeof r.commit_sha === 'string' ? r.commit_sha : null;
      const on = sha ? shipped.get(sha) ?? null : null;
      return { release_id: r.id, live_on: on, state: !sha ? 'needs_github' : on ? 'live' : 'no_match' };
    }),
    reason: null,
  };
}
