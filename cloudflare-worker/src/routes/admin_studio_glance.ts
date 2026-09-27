/**
 * Studio's glance, on both tiers (D443).
 *
 *   GET /api/admin/studio/glance
 *
 * requireAdmin. The branch routes this replaces refuse on HQ, which is why an
 * HQ-held Studio had nothing to read. This one does not. The
 * service decides what this database can answer. A read changes nothing, so
 * suspension does not gate it.
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
