/**
 * D931 (#2715) — Admin › Community's one read.
 *
 *   GET /api/admin/community/overview?weeks=4|12|52
 *
 * requireAdmin, for every admin: no HQ gate. Counts only:
 * `services/communityOverview.ts` says what each block counts and how it
 * fails alone. A `weeks` this cannot read is a 400, never a quietly
 * different window. The default is 4.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { communityOverview, parseCommunityWeeks } from '../services/communityOverview';

const r = new Hono<{ Bindings: Env }>();

r.get('/overview', async (c) => {
  try {
    await requireAdmin(c);
    const weeks = parseCommunityWeeks(c.req.query('weeks'));
    if (!weeks) return c.json({ code: 'bad_weeks', detail: 'weeks must be 4, 12 or 52.' }, 400);
    return c.json(await communityOverview(c.env, weeks));
  } catch (e) {
    return mapError(c, e);
  }
});

export default r;
