/**
 * D932 (#2716) — Admin · Community's reads.
 *
 *   GET /api/admin/community/activity?kind=&from=&to=&q=&limit=&offset=
 *
 * requireAdmin. The newest community items, merged across five sources and
 * paged (`services/communityActivity.ts` says what each row is and where it
 * comes from). Members are never named, and a source that fails is listed in
 * `unreadable` while the others answer.
 *
 *   GET /api/admin/community/overview?weeks=4|12|52
 *
 * D931 (#2715). The overview's period figures and charts as counts, each
 * block answering alone (`services/communityOverview.ts`). No HQ gate. A
 * `weeks` this cannot read is a 400, never a quietly different window; the
 * default is 4.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { communityActivity, parseActivityQuery } from '../services/communityActivity';
import { communityOverview, parseCommunityWeeks } from '../services/communityOverview';

const r = new Hono<{ Bindings: Env }>();

r.get('/activity', async (c) => {
  try {
    await requireAdmin(c);
    const p = parseActivityQuery((k) => c.req.query(k));
    if (!p.ok) return c.json({ code: p.code, detail: p.detail }, 400);
    return c.json(await communityActivity(c.env, p.query));
  } catch (e) {
    return mapError(c, e);
  }
});

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
