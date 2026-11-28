/**
 * D5585 part 9 (#5585): the public read of a published WorkGraph release's site record, mounted at
 * /api/public/release-sites. No sign-in. OFF BY DEFAULT: unless `WORK_GRAPH_RELEASE_SITES` is exactly `on`, it refuses
 * 404 `release_sites_off` before it reads D1 or R2. Decision: `documentation/architecture/decisions/D5585-p9.md`.
 *
 *   GET /api/public/release-sites/:tenant/:company/:site
 *     200 { state: 'ok', site, tenant_id, company_id, line, manifest_uid, digest, head_seq, record, cost }
 *         `record` is ids and digests only (manifest, digest, line, audience, each pinned piece's asset, revision, digest
 *         and role), checked against D1 (services/workGraphReleaseSites.ts)
 *     404 release_sites_off | not_found | not_delivered     400 malformed
 *     410 withdrawn (a takedown or a tombstone covers the manifest the pointer names)
 *     409 record_mismatch                                   503 unavailable
 *
 * It follows the line's publication pointer through part 2's `servedRelease`: never an older manifest on its own, never
 * anything a takedown covers. The tenant and company in the path bind every read, so another tenant's record is never
 * read, whatever the site is called.
 *
 * CROSS-ORIGIN (part 18, D5585-p18). A browser on another site may read a record only when the request's `Origin` is on
 * the record's own tenant and company's list (`workGraphReleaseSiteOrigins.ts`, set by a Super Admin). Then every
 * answer, a refusal included, carries `Access-Control-Allow-Origin: <that origin>`. Any other origin gets no CORS header
 * at all, so its page cannot read the answer. `Vary: Origin` goes on every answer to a request that names one.
 * Credentials are never allowed. `OPTIONS` answers a preflight the same way, with `GET` the only method. The list is
 * read after the flag, and only when the request names an origin.
 *
 *   OPTIONS /api/public/release-sites/:tenant/:company/:site   204, with the CORS headers only for a listed origin
 *
 * CACHING: `no-store`. A takedown must stop the record on the very next request, and the Worker holds no token that can
 * purge a shared cache (D5585-p3 §2), so no cache may keep a copy. Each read costs a few indexed D1 statements and one R2
 * get, bounded by the `release_site_read` bucket (middleware/rateLimit.ts: 60 a minute per IP, fail-open like the other
 * public reads).
 *
 * MOUNT ORDER: ahead of the legacy `/api/public` routers (`before: [eventsPublic]`). Three of them run a schema
 * bootstrap on every `/api/public/*` request (`use('*')`); mounted after them, a request here would touch D1 before the
 * flag is read.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import eventsPublic from './events_public';
import { readPublishedSite, releaseSitesEnabled, type SiteRefusal } from '../services/workGraphReleaseSites';
import { siteOriginAllowed } from '../services/workGraphReleaseSiteOrigins';
import { Meter } from '../services/workGraphReleases';

const r = new Hono<{ Bindings: Env }>();

const OFF_MESSAGE = 'Release sites are not served on this deployment.';

const REFUSALS: Record<SiteRefusal, { status: number; message: string }> = {
  malformed: { status: 400, message: 'The tenant and company must be positive whole numbers, and the site a DNS label.' },
  not_found: { status: 404, message: 'No published release is shown on this site.' },
  not_delivered: { status: 404, message: 'The release this site shows has not been delivered to it yet.' },
  withdrawn: { status: 410, message: 'The release this site showed has been taken down.' },
  record_mismatch: { status: 409, message: 'The site record does not match the published release, so it is not shown.' },
  unavailable: { status: 503, message: 'The site record could not be read just now. Try again in a moment.' },
};

const ID = /^[1-9][0-9]{0,15}$/;

/**
 * Part 18: the CORS headers of one answer. `Vary: Origin` whenever the request names an origin; the origin itself, and
 * no credentials, only when it is on the list of the tenant and company in the path. A list that cannot be read is
 * treated as empty: the answer then carries no CORS header, which a browser reads as "not allowed".
 */
async function cors(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const origin = c.req.header('Origin');
  if (!origin) return false;
  c.header('Vary', 'Origin');
  const tenant = c.req.param('tenant') ?? '', company = c.req.param('company') ?? '';
  if (!ID.test(tenant) || !ID.test(company)) return false;
  let allowed = false;
  try {
    allowed = await siteOriginAllowed(c.env, new Meter(c.env), { tenantId: Number(tenant), companyId: Number(company), projectId: null }, origin);
  } catch { allowed = false; }
  if (allowed) c.header('Access-Control-Allow-Origin', origin);
  return allowed;
}

r.options('/:tenant/:company/:site', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!releaseSitesEnabled(c.env)) return refuse(c, 404, { code: 'release_sites_off', message: OFF_MESSAGE });
  if (await cors(c)) {
    c.header('Access-Control-Allow-Methods', 'GET');
    c.header('Access-Control-Max-Age', '600');
  }
  return c.body(null, 204);
});

r.get('/:tenant/:company/:site', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
  // The flag is read before anything else: off, no D1 or R2 read.
  if (!releaseSitesEnabled(c.env)) return refuse(c, 404, { code: 'release_sites_off', message: OFF_MESSAGE });
  await cors(c);
  let result: Awaited<ReturnType<typeof readPublishedSite>>;
  try {
    result = await readPublishedSite(c.env, { tenant: c.req.param('tenant'), company: c.req.param('company'), site: c.req.param('site') });
  } catch (e) {
    return refuse(c, 503, { code: 'unavailable', message: REFUSALS.unavailable.message, raw: e });
  }
  if (!result.ok) {
    const x = REFUSALS[result.code];
    return refuse(c, x.status, { code: result.code, message: x.message, extra: { state: result.code, cost: result.cost } });
  }
  return c.json({
    state: 'ok', site: result.site, tenant_id: result.tenantId, company_id: result.companyId, line: result.lineAssetUid,
    manifest_uid: result.manifestUid, digest: result.digest, head_seq: result.headSeq, record: result.record, cost: result.cost,
  });
});

export const mount: RouteMount = { path: '/api/public/release-sites', router: r, before: [eventsPublic] };
export default r;
