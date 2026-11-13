/**
 * D4860 (#4860, finding 15) — the version context HQ · Platform's header
 * shows: which commit this Worker runs and which environment it is. Mounts
 * itself at `/api/admin/platform-build`. Super Admin only, as the Platform
 * summary is.
 *
 *   GET /  → { commit, commit_basis, environment, deployed_at, deployed_at_reason }
 *
 * Only what the Worker itself carries. `commit` is `WORKER_DEPLOY_VERSION`,
 * which `cloudflare-worker-deploy.yml` stamps with the commit it deploys; a
 * Worker deployed by hand carries none, and says so rather than guessing.
 * `environment` is the `ENVIRONMENT` var wrangler.toml sets per env table.
 * When the deploy happened is not bound on this Worker (no version-metadata
 * binding), so `deployed_at` is always null with its reason, never a time.
 * The release tag is the SPA's own (`lib/release.js`), not this route's.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';

/** A commit as the deploy writes it: hex only, so nothing else is echoed. */
const COMMIT = /^[0-9a-f]{7,40}$/i;
/** An environment name as wrangler.toml writes one. */
const ENV_NAME = /^[a-z][a-z0-9_-]{0,31}$/i;

export const DEPLOYED_AT_REASON =
  'When this Worker was deployed is not recorded: no version-metadata binding is declared, '
  + 'so the Worker cannot read its own deploy time. The deploy log has it.';

export function platformBuild(env: Pick<Env, 'WORKER_DEPLOY_VERSION' | 'ENVIRONMENT'>) {
  const raw = String(env.WORKER_DEPLOY_VERSION || '').trim();
  const commit = COMMIT.test(raw) ? raw.toLowerCase() : null;
  const envName = String(env.ENVIRONMENT || '').trim();
  return {
    commit,
    commit_basis: commit
      ? 'Stamped by the deploy workflow as WORKER_DEPLOY_VERSION.'
      : 'No commit is stamped on this Worker: it was deployed without the deploy workflow\'s '
        + 'WORKER_DEPLOY_VERSION, so which commit it runs is not recorded.',
    environment: ENV_NAME.test(envName) ? envName : null,
    deployed_at: null,
    deployed_at_reason: DEPLOYED_AT_REASON,
  };
}

const r = new Hono<{ Bindings: Env }>();

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  return c.json(platformBuild(c.env));
});

export const mount: RouteMount = { path: '/api/admin/platform-build', router: r };
export default r;
