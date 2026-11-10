/**
 * D5060 (#5060, user licences 4/4 under #5047) — HQ's Licences registry across every licence family: operator
 * (territory, white label, master franchise) and user (Founder, Investor, Operating Partner, Advisor). Mounted
 * at `/api/admin/licence-registry`; the reads are `services/licenceRegistry.ts`.
 *
 *   GET /             one page of every licence family (?family=all|operator|founder|investor|operating_partner|
 *                     advisor&holder=user:<id>|entity:<id>&status=&q=&limit=&cursor=), with counts per family
 *   GET /templates    the four user licence agreement templates and whether HQ authored each in Contracts
 *   GET /:uid         one licence, its detail shaped by its family (`layout: 'operator' | 'user'`)
 *
 * WHO. Every read is `requireSuperAdmin`, as the licence ledger, its agreements and the program grants are read
 * (migration 199, D5048): the registry lists every licensee's and every member's licence side by side. Nothing
 * here writes. The user licence lifecycle is #5058's routes; entitlements are #5059's.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { RegistryRefusal, registryDetail, registryPage, registryQuery } from '../services/licenceRegistry';
import { USER_LICENCE_AGREEMENT_TEMPLATES } from '../services/contractAgreementSources';
import { ensureLegalTemplatesSchema, getTemplate } from '../services/legalTemplateStore';
import { templateUseRefusal } from '../services/templateSafety';
import { COUNSEL_REVIEW_SLUGS } from '../services/templateFormat';

const r = new Hono<{ Bindings: Env }>();

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    let q;
    try { q = registryQuery(c.req.query()); }
    catch (e) {
      if (e instanceof RegistryRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence });
      throw e;
    }
    return c.json(await registryPage(c.env, q));
  } catch (e) { return mapError(c, e); }
});

// Contracts owns the text (`legal_templates`); this says which slug each user licence agreement is drafted from,
// and whether HQ has authored it. A slug HQ has not authored reads so, and nothing is invented in its place.
r.get('/templates', async (c) => {
  try {
    await requireSuperAdmin(c);
    await ensureLegalTemplatesSchema(c.env);
    const items = await Promise.all(USER_LICENCE_AGREEMENT_TEMPLATES.map(async (t) => {
      const row = await getTemplate(c.env, t.slug);
      const blocked = row ? templateUseRefusal(row) : null;
      return {
        ...t,
        authored: !!row && !blocked,
        version: row?.version ?? null,
        library_title: row?.title ?? null,
        refusal: row ? (blocked?.message ?? null) : 'HQ has not authored this template in the Contracts library yet.',
        counsel_review: COUNSEL_REVIEW_SLUGS.has(t.slug),
        governed_by: 'contracts',
      };
    }));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const detail = await registryDetail(c.env, c.req.param('uid'));
    if (!detail) return refuse(c, 404, { code: 'not_found', message: 'There is no such licence.' });
    return c.json(detail);
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount = { path: '/api/admin/licence-registry', router: r };
export default r;
