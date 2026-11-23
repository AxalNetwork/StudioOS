/** D7810 (#7810): Companies-gated publisher and licence inventory over all stored company rows. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import {
  admitsCompanies,
  refuseCompanies,
} from '../services/researchCompaniesAccess';
import { readCompanyPublishers } from '../services/researchCompanyPublishers';
import type { RouteMount } from '../util/routeRegistry';
const router = new Hono<{ Bindings: Env }>();
router.get('/company-publishers', async (c) => {
  if (!admitsCompanies(await requireAuth(c))) return refuseCompanies(c);
  return c.json(await readCompanyPublishers(c.env));
});
export const mount: RouteMount = { path: '/api/research', router: router };
export default router;
