/**
 * D932 (#2716) — Admin · Community's reads.
 *
 *   GET /api/admin/community/activity?kind=&from=&to=&q=&limit=&offset=
 *
 * requireAdmin. The newest community items, merged across five sources and
 * paged (`services/communityActivity.ts` says what each row is and where it
 * comes from). Members are never named, and a source that fails is listed in
 * `unreadable` while the others answer. Part 1 (#2715) adds the overview read
 * to this router.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { communityActivity, parseActivityQuery } from '../services/communityActivity';

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

export default r;
