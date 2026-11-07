/**
 * Territory licences — the HQ ledger behind the subsidiary model.
 *
 * SUPER ADMIN ONLY, every route including the reads (migration 199). This is
 * the franchisor's console: it issues, re-terms, suspends, renews and
 * terminates other people's licences, and its lists are every licensee's
 * commercial terms side by side. An admin who can operate it is not a
 * subsidiary of anything.
 *
 * The licensee's own view is `routes/licence.ts` (`GET /licence/mine`), which
 * stays on plain auth — a subsidiary admin reads their licence there and
 * cannot reach anyone else's from here.
 *
 * Mounted at /api/admin/licences BEFORE the catch-all /api/admin in index.ts,
 * the same mount-precedence trick admin_billing and admin_promos use. Schema:
 * migration 187.
 *
 *   GET    /                       one page of licences, with territories and seats
 *                                  (?q=&kind=&status=&limit=&cursor=, #4700)
 *   GET    /territories            who holds what, for the picker
 *   GET    /summary                coverage, renewals and counts over every licence (#4700)
 *   GET    /:uid/requests          this licence's open requests, HQ- and branch-origin (#4700)
 *   POST   /                       step 1 — create a draft from an entity
 *   PUT    /:uid/territories       step 2 — set the countries (refuses overlap)
 *   PUT    /:uid/seats             step 3 — seats licensed, per persona
 *   PATCH  /:uid/terms             step 4 — term, fee, revenue share, splits
 *   GET    /:uid/activation        step 5 — what still blocks activation
 *   POST   /:uid/activate          step 5 — activate, if nothing blocks
 *   POST   /:uid/suspend           suspend (territory is NOT released)
 *   POST   /:uid/reinstate         back to active
 *   POST   /:uid/renew             push renews_on out by the term
 *   POST   /:uid/terminate         end it, releasing every country
 *
 * WHAT THIS IS NOT. This is the ledger, not the scope. No existing query
 * learns a territory from it and no row gains a licence_id — retrofitting
 * that across 151 route files is a programme, and the repo's rule is that
 * tenancy goes through ONE middleware. A half-applied scope reads as enforced
 * and is not, which is worse than none.
 *
 * The visible consequence is that every figure derived from account
 * attribution — seats used, accounts per licence, revenue per subsidiary,
 * token P&L — is UNAVAILABLE, and is reported as null rather than as a
 * plausible number. `seatsUsed` below is the whole of that story.
 *
 * TERRITORY EXCLUSIVITY is enforced by a unique index on
 * `licence_territories.country_code`, not by the check in this file. The check
 * exists to produce a good error message naming the conflicting holder; the
 * index is what makes a race impossible. `PUT /:uid/territories` therefore
 * writes inside a batch and lets the constraint be the final word.
 *
 * SUSPENSION DOES NOT RELEASE TERRITORY. Rows are deleted on terminate and
 * left alone on suspend. Nobody has to remember the rule because there is no
 * code path that could forget it.
 */
import { Hono } from 'hono';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { HOLDS_TERRITORY, byUid, hydrate, activationBlockers } from '../services/licenceLedgerCore';
import type { Env } from '../types';
import adminLicencesLedger from './admin_licences_ledger';
import adminLicencesTerms from './admin_licences_terms';
import adminLicencesLifecycle from './admin_licences_lifecycle';
import adminLicencesAdmins from './admin_licences_admins';
import adminLicencesNotices from './admin_licences_notices';
import adminLicencesDomain from './admin_licences_domain';
import adminLicencesBrand from './admin_licences_brand';
import adminLicencesContracts from './admin_licences_contracts';
import adminLicencesFees from './admin_licences_fees';
import adminLicencesHistory from './admin_licences_history';

// #4707 — what other modules import from here, re-exported from where it lives now.
export type { LicenceRow, LicenceBrandKitRow } from '../services/licenceLedgerCore';
export { brandKitPayload, hydrate } from '../services/licenceLedgerCore';
export { deprovisionLicenceAdmins, unbindBranchAdmins } from './admin_licences_lifecycle';
export { enrichContractFromEnvelope } from './admin_licences_contracts';
export { EVENTS_PAGE_MAX } from './admin_licences_history';

const r = new Hono<{ Bindings: Env }>();

// #4707 — the routes, split by domain, mounted in the order they were declared
// before the split. `GET /:uid` stays last, here: it would otherwise answer
// for every `GET /<word>` declared after it.
r.route('/', adminLicencesLedger);
r.route('/', adminLicencesTerms);
r.route('/', adminLicencesLifecycle);
r.route('/', adminLicencesAdmins);
r.route('/', adminLicencesNotices);
r.route('/', adminLicencesDomain);
r.route('/', adminLicencesBrand);
r.route('/', adminLicencesContracts);
r.route('/', adminLicencesFees);
r.route('/', adminLicencesHistory);

r.get('/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const [full] = await hydrate(c.env, [licence]);
    const events = await c.env.DB.prepare(
      `SELECT event, detail_json, note, created_at FROM licence_events
        WHERE licence_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`,
    ).bind(licence.id).all<any>();
    // D197 — THE PLATFORM HOST, on the payload the strip already fetches.
    // H31's strip puts it beside the custom host because the pair is the whole
    // point: members are on the platform host the deploy issued, and a custom
    // host that is merely `verified` has not taken over from it. Reading it
    // here rather than in the strip keeps `api.deployments()` to the one call
    // `DeployStep` already makes — two reads of one registry on one screen is
    // how two figures on one page come to disagree.
    //
    // Its own try/catch: a database without migration 258 has no registry, and
    // the strip renders that as unknown rather than as no deployment.
    let deployment: { hostname: string; status: string } | null = null;
    let deploymentReadable = true;
    try {
      deployment = await c.env.DB.prepare(
        'SELECT hostname, status FROM licence_deployments WHERE licence_uid = ?',
      ).bind(licence.uid).first<{ hostname: string; status: string }>();
    } catch (e) {
      console.warn('[licences] licence_deployments unreadable', (e as Error).message);
      deploymentReadable = false;
    }

    return c.json({
      ...full,
      events: events.results || [],
      blockers: await activationBlockers(c.env, licence),
      holds_territory: HOLDS_TERRITORY.includes(licence.status),
      deployment,
      deployment_available: deploymentReadable,
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
