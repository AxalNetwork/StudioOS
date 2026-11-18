/**
 * D6907 (#6907, Worker part): the clauses of an investor's own signed
 * documents for one company, by right type, for Eadwyn's proposal on
 * Ownership & rights (PRM18 rail). Mounted at /api/portfolio-clauses.
 *
 *   GET /:projectUid[?type=pro_rata,observer_seat,…]
 *        an investor (the licence, not an admin) for a company they hold
 *        through a confirmed commitment (`investorHeldProjectIds`). Not held
 *        and unknown answer alike (403 `not_held`). `type` narrows the right
 *        types; an unknown type is 400.
 *
 * The read (`services/signedClauses.ts`) returns, per signed document, the
 * clause text and its location only, and says when a document cannot be read.
 * `summary.unreadable` counts those, so the rail can say "N documents could not
 * be read" instead of "none found".
 *
 * NOTHING IS RECORDED. Accepting a proposal is the investor's request to record
 * a right (D6868's `POST /api/portfolio-rights/requests`), not this route.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, canViewLpData } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { investorHeldProjectIds, investorActiveCompany } from './_investorProjectScope';
import { RIGHT_TYPES, investorSignedClauses, type RightType } from '../services/signedClauses';

const r = new Hono<{ Bindings: Env }>();
const isAdminUser = (u: User) => u.role === 'admin';

// GET /api/portfolio-clauses/:projectUid
r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (isAdminUser(user) || !canViewLpData(user)) return c.json({ detail: 'Only an investor reads the clauses of their own signed documents.', code: 'investor_only' }, 403);
    let types: RightType[] = [...RIGHT_TYPES];
    const q = c.req.query('type');
    if (q) {
      const asked = q.split(',').map((t) => t.trim()).filter(Boolean);
      const bad = asked.filter((t) => !(RIGHT_TYPES as readonly string[]).includes(t));
      if (bad.length || !asked.length) return c.json({ detail: `type is one or more of: ${RIGHT_TYPES.join(', ')}`, code: 'bad_type' }, 400);
      types = [...new Set(asked)] as RightType[];
    }
    const proj = await c.env.DB.prepare('SELECT id, uid FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number; uid: string }>();
    const held = proj ? await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user)) : [];
    if (!proj || !held || !held.includes(Number(proj.id))) {
      return c.json({ detail: 'You can read clauses only for a company you hold.', code: 'not_held' }, 403);
    }
    const documents = await investorSignedClauses(c.env, Number(proj.id), Number(user.id), types);
    const byType: Record<string, number> = Object.fromEntries(types.map((t) => [t, 0]));
    for (const d of documents) for (const m of d.clauses) byType[m.right_type] += 1;
    return c.json({
      project_uid: proj.uid,
      types,
      documents,
      summary: {
        documents: documents.length,
        unreadable: documents.filter((d) => !d.readable).length,
        clauses_by_type: byType,
      },
    });
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount = { path: '/api/portfolio-clauses', router: r };
export default r;
