/**
 * Assignment on the approvals board (D470).
 *
 *   GET  /api/branch/approvals/history?lane=&item_id=   the events this file wrote
 *   POST /api/branch/approvals/assignments              one current reviewer
 *
 * NOT A DECISION. `branch_approvals.ts` stays a read, and `decides` stays
 * false. This file writes `approval_assignments` and `approval_events` only.
 * It does not update a queue's status, and it does not open a reply thread.
 *
 * THE WRITE IS SUSPENSION-GATED. Naming a reviewer is not the appeal path.
 * The read is not: a frozen branch can still see who is assigned.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireBranchNotSuspended } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { APPROVAL_SOURCES } from '../services/approvalSources';
import { assignFromBody, assignmentHistory, readHistoryQuery } from '../services/approvalAssignments';

const r = new Hono<{ Bindings: Env }>();

// The checks and the write are `services/approvalAssignments.ts`', shared with
// HQ's inbox (D1040, `routes/admin_approvals.ts`). This board reads every lane.
r.get('/approvals/history', async (c) => {
  try {
    await requireAdmin(c);
    requireBranchTier(c.env);
    const q = readHistoryQuery(String(c.req.query('lane') || ''), c.req.query('item_id'), APPROVAL_SOURCES);
    if (!q.ok) return refuse(c, q.status, { code: q.code, message: q.message, audience: 'member' });
    return c.json(await assignmentHistory(c.env, q.lane, q.itemId));
  } catch (e) { return mapError(c, e); }
});

r.post('/approvals/assignments', async (c) => {
  try {
    const admin = await requireAdmin(c);
    requireBranchTier(c.env);
    await requireBranchNotSuspended(c);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const result = await assignFromBody(c.env, admin, body, { sources: APPROVAL_SOURCES, boardLimit: 100 });
    if (!result.ok) return refuse(c, result.status, { code: result.code, message: result.message, audience: 'member' });
    return c.json({ assigned: result.assigned });
  } catch (e) { return mapError(c, e); }
});

export default r;
