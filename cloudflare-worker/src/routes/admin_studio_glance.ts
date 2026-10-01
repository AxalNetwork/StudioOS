/**
 * Studio's glance, on both tiers (D443).
 *
 *   GET /api/admin/studio/glance
 *
 * requireAdmin. The branch routes this replaces refuse on HQ, which is why an
 * HQ-held Studio had nothing to read. This one does not. The service decides
 * what this database can answer.
 *
 * NOT A PURE READ. On a branch, the first look at a missing licence copy asks
 * HQ and stores the answer (`applyLicenceCopy` in `branchLicencePayload`).
 * `listTemplates` can also create the master-library tables when they are
 * absent. Suspension does not gate this route: a frozen branch can still see
 * the copy. Dropping the four legacy reads on Admin Studio Home ends the
 * second pull of that copy. That file is Session 3's, held by the Session 15
 * slot: do not drop those reads until D447 is on main.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { studioGlance } from '../services/studioGlance';

const r = new Hono<{ Bindings: Env }>();

r.get('/glance', async (c) => {
  try {
    await requireAdmin(c);
    return c.json(await studioGlance(c.env));
  } catch (e) {
    return mapError(c, e);
  }
});

export default r;
