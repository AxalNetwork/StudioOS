/**
 * D6862 (#6862, D6021 V19/V20, owner answers Q1 B, Q2 A, Q3 A) — a founder
 * shares one given Validate decision with named Operating Partners and
 * investors, and a recipient reads it, read-only.
 *
 *   GET  /api/cycles/validate/decision-shares?project=:pid&decision=:id
 *        → { shares: [...], shareable, can_share }  the venture's own (`canReadDecision`)
 *   GET  /api/cycles/validate/decision-shares/candidates?project=:pid&decision=:id
 *        → { candidates: [...] }                    the venture's founder only
 *   POST /api/cycles/validate/decision-shares?project=:pid&decision=:id
 *        { recipients: [userId…], include_reasoning?: boolean } → 201 { shares }
 *   POST /api/cycles/validate/decision-shares/:uid/revoke?project=:pid&decision=:id → { shares }
 *   GET  /api/shared-decisions/:id                   the recipient's read (V20 A)
 *
 * Every rule is `services/verdict.ts`'s; this file resolves the caller and the
 * venture and answers the refusals. Granting and revoking are the venture's
 * founder's, never an admin's on their behalf and never inside a support
 * session. A recipient's read answers one 403 for every reason it may not be
 * read (never shared, revoked, Withheld, not found), and carries no action.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canReadDecision, ownsVenture, type ProjectRef } from './_founder_validate_helpers';
import {
  decisionShareable, decisionShares, grantDecisionShares, revokeDecisionShare, shareCandidates, sharedDecisionFor, VerdictError,
} from '../services/verdict';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';

type Scoped = { user: User; projectId: number; project: ProjectRef; decision: number };

/** The caller, the venture in `?project=` and the decision in `?decision=`, or the refusal. */
async function scope(c: Context<{ Bindings: Env }>, gate: (p: ProjectRef, u: User) => boolean): Promise<Scoped | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in to continue.' }); }
  const rawProject = String(c.req.query('project') ?? '');
  const rawDecision = String(c.req.query('decision') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(rawProject)) return refuse(c, 400, { code: 'project_required', message: 'Choose a venture first.' });
  if (!/^[1-9][0-9]{0,9}$/.test(rawDecision)) return refuse(c, 400, { code: 'decision_required', message: 'Choose a decision first.' });
  const projectId = Number(rawProject);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<ProjectRef>();
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'Venture not found.' });
  if (!gate(project, user)) return refuse(c, 403, { code: 'forbidden', message: 'Decisions are the founder’s own.' });
  return { user, projectId, project, decision: Number(rawDecision) };
}

/** A grant or a revoke: the founder in person, never a support session. */
async function founderInPerson(c: Context<{ Bindings: Env }>): Promise<Scoped | Response> {
  const s = await scope(c, ownsVenture);
  if (s instanceof Response) return s;
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A decision is shared by the founder, not in a support session.' });
  }
  return s;
}

function answer(c: Context<{ Bindings: Env }>, e: unknown, what: string): Response {
  if (e instanceof VerdictError) return refuse(c, e.status, { code: e.code ?? 'refused', message: e.sentence });
  return refuse(c, 503, { code: 'unreadable', message: `${what} Try again.`, raw: e });
}

const shares = new Hono<{ Bindings: Env }>();

shares.get('/', async (c) => {
  const s = await scope(c, canReadDecision);
  if (s instanceof Response) return s;
  try {
    const [list, shareable] = await Promise.all([decisionShares(c.env, s.projectId, s.decision), decisionShareable(c.env, s.projectId, s.decision)]);
    // `can_share`: the founder in person; an admin reads the list and shares nothing.
    return c.json({ shares: list, shareable, can_share: ownsVenture(s.project, s.user) && !(await selectJwt(c))?.payload.impersonated_by });
  } catch (e) { return answer(c, e, 'Who this decision is shared with could not be read.'); }
});

shares.get('/candidates', async (c) => {
  const s = await scope(c, ownsVenture);
  if (s instanceof Response) return s;
  try { return c.json({ candidates: await shareCandidates(c.env, s.projectId, s.decision) }); }
  catch (e) { return answer(c, e, 'The people you can share with could not be read.'); }
});

shares.post('/', async (c) => {
  const s = await founderInPerson(c);
  if (s instanceof Response) return s;
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return refuse(c, 400, { code: 'body_invalid', message: 'The body must be a JSON object.' });
  try {
    const list = await grantDecisionShares(c.env, s.user, s.project, s.decision, b as Record<string, unknown>);
    return c.json({ shares: list }, 201);
  } catch (e) { return answer(c, e, 'Nobody was given access.'); }
});

shares.post('/:uid/revoke', async (c) => {
  const s = await founderInPerson(c);
  if (s instanceof Response) return s;
  try { return c.json({ shares: await revokeDecisionShare(c.env, s.user, s.project, s.decision, c.req.param('uid')) }); }
  catch (e) { return answer(c, e, 'The share could not be revoked; access is unchanged.'); }
});

const received = new Hono<{ Bindings: Env }>();

received.get('/:id', async (c) => {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in to read a shared decision.' }); }
  try { return c.json({ decision: await sharedDecisionFor(c.env, user, c.req.param('id')) }); }
  catch (e) { return answer(c, e, 'This decision could not be read.'); }
});

export { shares as decisionSharesRouter, received as sharedDecisionsRouter };

export const mount: RouteMount[] = [
  { path: '/api/cycles/validate/decision-shares', router: shares },
  { path: '/api/shared-decisions', router: received },
];
