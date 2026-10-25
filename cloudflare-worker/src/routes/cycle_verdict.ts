/**
 * D693 — `/api/cycles/validate/decisions`: Verdict's writer.
 *
 *   POST /?project=:pid
 *     { decision: 'proceed'|'pivot'|'stop', for: 'venture'|'h-<id>',
 *       reasoning?, evidence?: string[], pivot_claim? }
 *     → 201 { id, state, supersedes_id, pivot_hypothesis_id }
 *
 * The one writer is `services/verdict.ts`'s `recordDecision`. A decision is
 * never edited or deleted (D693 decision 4), so there is no PATCH and no
 * DELETE; commitments are added and closed through the record's action route
 * (#1703), so there is no commitments route here and no `GET /`.
 *
 * WHO. Writing is the venture's own or an admin's (`canWrite`). Partners,
 * advisors, investors and another venture's founder are refused before the
 * body is read.
 *
 * Refusals, in order: 401; 400 for a bad `project`; 404 "Project not found";
 * 403; 400 for the decision; 400 for a malformed `for`, evidence, reasoning or
 * a `pivot_claim` without Pivot; 404 "Hypothesis not found."; 404 "Evidence
 * not found.".
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canWrite, type ProjectRef } from './_founder_validate_helpers';
import { recordDecision, isDecisionKind, VerdictError, type Scope } from '../services/verdict';

const cycleVerdict = new Hono<{ Bindings: Env }>();

/** The project in `?project=`, and the caller, or the Response that refuses them. */
async function scope(c: any, gate: (p: ProjectRef, u: User) => boolean): Promise<{ user: User; projectId: number; project: ProjectRef } | Response> {
  let user: User;
  try {
    user = (await requireAuth(c)) as User;
  } catch {
    return c.json({ detail: 'Unauthorized' }, 401);
  }
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return c.json({ detail: 'project is required' }, 400);
  const projectId = Number(raw);
  const project = (await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first()) as ProjectRef | null;
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  if (!gate(project, user)) return c.json({ detail: 'Forbidden' }, 403);
  return { user, projectId, project };
}

/** `'venture'`, or a hypothesis id from `h-<id>`; null when it is neither. */
function scopeOf(v: unknown): Scope | null {
  if (v === 'venture') return 'venture';
  const m = /^h-([1-9][0-9]{0,9})$/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

cycleVerdict.post('/', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return c.json({ detail: 'The body must be a JSON object' }, 400);
  if (!isDecisionKind(b.decision)) return c.json({ detail: 'decision must be proceed, pivot or stop' }, 400);
  const forScope = scopeOf(b.for);
  if (forScope === null) return c.json({ detail: "for must be 'venture' or 'h-<id>'" }, 400);
  try {
    const out = await recordDecision(c.env, s.user, { id: s.projectId }, {
      decision: b.decision, for: forScope, reasoning: b.reasoning, evidence: b.evidence, pivot_claim: b.pivot_claim,
    });
    return c.json(out, 201);
  } catch (e) {
    if (e instanceof VerdictError) return c.json({ detail: e.sentence }, e.status as any);
    console.error('[cycle_verdict] write failed:', (e as Error)?.message);
    return c.json({ detail: 'The decision could not be recorded' }, 500);
  }
});

export default cycleVerdict;
