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
import { logAdminAction } from '../services/adminAudit';
import {
  assignReviewers,
  assignmentHistory,
  isAssignmentLane,
  type AssignItem,
} from '../services/approvalAssignments';

const r = new Hono<{ Bindings: Env }>();

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

r.get('/approvals/history', async (c) => {
  try {
    await requireAdmin(c);
    requireBranchTier(c.env);
    const lane = String(c.req.query('lane') || '');
    const itemId = Number(c.req.query('item_id'));
    if (!isAssignmentLane(lane) || !Number.isInteger(itemId) || itemId <= 0) {
      return refuse(c, 400, {
        code: 'bad_item',
        message: 'That is not an item on this board.',
        audience: 'member',
      });
    }
    return c.json(await assignmentHistory(c.env, lane, itemId));
  } catch (e) { return mapError(c, e); }
});

r.post('/approvals/assignments', async (c) => {
  try {
    const admin = await requireAdmin(c);
    requireBranchTier(c.env);
    await requireBranchNotSuspended(c);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const assignee = positiveInt(body?.assignee_user_id);
    const raw = Array.isArray(body?.items) ? body.items : [];
    const items: AssignItem[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      const lane = String((row as { lane?: unknown })?.lane || '');
      const itemId = positiveInt((row as { item_id?: unknown })?.item_id);
      if (!isAssignmentLane(lane) || itemId === null) {
        return refuse(c, 400, {
          code: 'bad_item',
          message: 'That is not an item on this board.',
          audience: 'member',
        });
      }
      const key = `${lane}:${itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ lane, item_id: itemId });
    }
    if (assignee === null) {
      return refuse(c, 400, {
        code: 'not_a_reviewer',
        message: 'A reviewer is an active admin on this territory.',
        audience: 'member',
      });
    }
    const result = await assignReviewers(c.env, admin.id, assignee, items);
    if (!result.ok) {
      return refuse(c, result.status, {
        code: result.code,
        message: result.message,
        audience: 'member',
      });
    }
    for (const row of result.assigned) {
      await logAdminAction(c.env, admin.id, admin.email || '', 'approval_assignment', {
        target_user_id: row.assignee_user_id,
        lane: row.lane,
        item_id: row.item_id,
      });
    }
    return c.json({ assigned: result.assigned });
  } catch (e) { return mapError(c, e); }
});

export default r;
