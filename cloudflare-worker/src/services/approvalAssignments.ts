/**
 * Assignment on the approvals board (D470).
 *
 * ONE CURRENT REVIEWER, AND A LOG OF THE CHANGES THIS FILE WRITES. The board
 * still does not decide: nothing here updates a queue's own status. A reply
 * thread is not this table. What a console did to the item is not copied here.
 *
 * THE TABLE IS NOT CREATED ON READ. Creating it would turn "could not be read"
 * into an empty record, and an empty record is what the page says when nobody
 * has been assigned. Those two answers stay different.
 */
import type { Env } from '../types';
import { APPROVAL_SOURCES, approvalBoard, type ApprovalLaneKey } from './approvalSources';

export const ASSIGNMENTS_UNREADABLE =
  'The assignment record could not be read on this database. That is not a claim that nobody is assigned.';

export const REVIEWERS_UNREADABLE =
  'The admin accounts on this territory could not be read, so there is nobody to offer. That is not a claim that this territory has no admins.';

export const ASSIGNMENT_CAP = 40;
const READ_CAP = 5000;
const HISTORY_CAP = 100;

const LANE_KEYS = new Set<string>(APPROVAL_SOURCES.map((s) => s.key));

export function isAssignmentLane(lane: string): lane is ApprovalLaneKey {
  return LANE_KEYS.has(lane);
}

export function personLabel(row: { id: number; name?: string | null; email?: string | null }): string {
  const name = String(row.name ?? '').trim();
  if (name) return name;
  const email = String(row.email ?? '').trim();
  if (email) return email;
  return `account ${row.id}`;
}

export type Assignee = { user_id: number; name: string };
export type Reviewer = { id: number; name: string };

export type AssignmentRead = {
  available: boolean;
  reason?: string;
  assignees: Map<string, Assignee>;
  reviewers: Reviewer[] | null;
  reviewers_reason?: string;
};

type AssigneeRow = {
  lane: string;
  item_id: number;
  assignee_user_id: number;
  name: string | null;
  email: string | null;
};

type ReviewerRow = { id: number; name: string | null; email: string | null };

async function tablesReadable(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT 1 AS n FROM approval_assignments LIMIT 1').all();
    await env.DB.prepare('SELECT 1 AS n FROM approval_events LIMIT 1').all();
    return true;
  } catch (e) {
    console.error('[approval-assignments] could not read the record', (e as Error).message);
    return false;
  }
}

export async function readAssignmentState(env: Env): Promise<AssignmentRead> {
  const readable = await tablesReadable(env);
  if (!readable) {
    return { available: false, reason: ASSIGNMENTS_UNREADABLE, assignees: new Map(), reviewers: null };
  }
  try {
    const got = await env.DB.prepare(
      'SELECT a.lane AS lane, a.item_id AS item_id, a.assignee_user_id AS assignee_user_id, '
      + 'u.name AS name, u.email AS email '
      + 'FROM approval_assignments a LEFT JOIN users u ON u.id = a.assignee_user_id '
      + 'LIMIT ?',
    ).bind(READ_CAP).all<AssigneeRow>();
    const rows = got.results || [];
    if (rows.length >= READ_CAP) {
      return {
        available: false,
        reason: 'The assignment record is larger than this read, so it is not shown. That is not a claim that nobody is assigned.',
        assignees: new Map(),
        reviewers: null,
      };
    }
    const assignees = new Map<string, Assignee>();
    for (const row of rows) {
      const id = Number(row.assignee_user_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      assignees.set(`${row.lane}:${Number(row.item_id)}`, {
        user_id: id,
        name: personLabel({ id, name: row.name, email: row.email }),
      });
    }
    let reviewers: Reviewer[] | null = null;
    let reviewers_reason: string | undefined;
    try {
      const admins = await env.DB.prepare(
        "SELECT id, name, email FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id",
      ).all<ReviewerRow>();
      reviewers = (admins.results || []).map((row) => ({
        id: Number(row.id),
        name: personLabel({ id: Number(row.id), name: row.name, email: row.email }),
      })).filter((row) => Number.isInteger(row.id) && row.id > 0);
    } catch (e) {
      console.error('[approval-assignments] could not read reviewers', (e as Error).message);
      reviewers = null;
      reviewers_reason = REVIEWERS_UNREADABLE;
    }
    return {
      available: true,
      assignees,
      reviewers,
      ...(reviewers_reason ? { reviewers_reason } : {}),
    };
  } catch (e) {
    console.error('[approval-assignments] could not read assignees', (e as Error).message);
    return { available: false, reason: ASSIGNMENTS_UNREADABLE, assignees: new Map(), reviewers: null };
  }
}

export type AssignItem = { lane: string; item_id: number };

export type AssignResult =
  | { ok: true; assigned: Array<{ lane: string; item_id: number; assignee_user_id: number; assignee_name: string }> }
  | { ok: false; status: number; code: string; message: string };

const UPSERT =
  'INSERT INTO approval_assignments (lane, item_id, assignee_user_id, assigned_by_user_id) '
  + 'VALUES (?, ?, ?, ?) '
  + 'ON CONFLICT(lane, item_id) DO UPDATE SET '
  + 'assignee_user_id = excluded.assignee_user_id, '
  + 'assigned_by_user_id = excluded.assigned_by_user_id, '
  + "assigned_at = datetime('now')";

const EVENT =
  "INSERT INTO approval_events (lane, item_id, kind, actor_user_id, assignee_user_id) "
  + "VALUES (?, ?, 'assigned', ?, ?)";

/**
 * Assign every item, or none of the checks. A write that throws after an
 * earlier item in the same call has landed is reported as unreadable; the
 * caller does not hear a partial success.
 */
export async function assignReviewers(
  env: Env,
  actorUserId: number,
  assigneeUserId: number,
  items: AssignItem[],
): Promise<AssignResult> {
  if (!Number.isInteger(assigneeUserId) || assigneeUserId <= 0) {
    return { ok: false, status: 400, code: 'not_a_reviewer', message: 'A reviewer is an active admin on this territory.' };
  }
  if (items.length === 0) {
    return { ok: false, status: 400, code: 'nothing_to_assign', message: 'Nothing was selected to assign.' };
  }
  if (items.length > ASSIGNMENT_CAP) {
    return {
      ok: false,
      status: 400,
      code: 'too_many',
      message: `At most ${ASSIGNMENT_CAP} items can be assigned at once.`,
    };
  }
  for (const it of items) {
    if (!isAssignmentLane(it.lane) || !Number.isInteger(it.item_id) || it.item_id <= 0) {
      return { ok: false, status: 400, code: 'bad_item', message: 'That is not an item on this board.' };
    }
  }
  if (!(await tablesReadable(env))) {
    return { ok: false, status: 503, code: 'assignments_unreadable', message: ASSIGNMENTS_UNREADABLE };
  }
  let reviewer: ReviewerRow | null = null;
  try {
    reviewer = await env.DB.prepare(
      "SELECT id, name, email FROM users WHERE id = ? AND role = 'admin' AND is_active = 1",
    ).bind(assigneeUserId).first<ReviewerRow>();
  } catch (e) {
    console.error('[approval-assignments] could not read the reviewer', (e as Error).message);
    return { ok: false, status: 503, code: 'assignments_unreadable', message: ASSIGNMENTS_UNREADABLE };
  }
  if (!reviewer) {
    return {
      ok: false,
      status: 400,
      code: 'not_a_reviewer',
      message: 'A reviewer is an active admin on this territory. That account is not one.',
    };
  }
  let open: Awaited<ReturnType<typeof approvalBoard>>;
  try {
    open = await approvalBoard(env, 100);
  } catch (e) {
    console.error('[approval-assignments] could not read the board', (e as Error).message);
    return { ok: false, status: 503, code: 'assignments_unreadable', message: ASSIGNMENTS_UNREADABLE };
  }
  const openKeys = new Set(open.items.map((it) => `${it.lane}:${it.id}`));
  for (const it of items) {
    if (!openKeys.has(`${it.lane}:${it.item_id}`)) {
      return {
        ok: false,
        status: 400,
        code: 'not_on_board',
        message: 'That item is not among the open rows this board is showing, so it was not assigned.',
      };
    }
  }
  const name = personLabel({ id: Number(reviewer.id), name: reviewer.name, email: reviewer.email });
  const assigned: Array<{ lane: string; item_id: number; assignee_user_id: number; assignee_name: string }> = [];
  try {
    for (const it of items) {
      const current = await env.DB.prepare(
        'SELECT assignee_user_id FROM approval_assignments WHERE lane = ? AND item_id = ?',
      ).bind(it.lane, it.item_id).first<{ assignee_user_id: number }>();
      const same = current && Number(current.assignee_user_id) === assigneeUserId;
      if (!same) {
        await env.DB.prepare(UPSERT).bind(it.lane, it.item_id, assigneeUserId, actorUserId).run();
        await env.DB.prepare(EVENT).bind(it.lane, it.item_id, actorUserId, assigneeUserId).run();
      }
      assigned.push({
        lane: it.lane,
        item_id: it.item_id,
        assignee_user_id: assigneeUserId,
        assignee_name: name,
      });
    }
  } catch (e) {
    console.error('[approval-assignments] could not write', (e as Error).message);
    return { ok: false, status: 503, code: 'assignments_unreadable', message: ASSIGNMENTS_UNREADABLE };
  }
  return { ok: true, assigned };
}

export type HistoryItem = {
  kind: 'assigned';
  created_at: string;
  actor_user_id: number;
  actor_name: string;
  assignee_user_id: number;
  assignee_name: string;
};

type HistoryRow = {
  id: number;
  created_at: string;
  actor_user_id: number;
  assignee_user_id: number;
  actor_name: string | null;
  actor_email: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
};

export async function assignmentHistory(
  env: Env,
  lane: string,
  itemId: number,
): Promise<{ available: true; items: HistoryItem[]; capped?: true } | { available: false; reason: string }> {
  if (!(await tablesReadable(env))) return { available: false, reason: ASSIGNMENTS_UNREADABLE };
  try {
    const got = await env.DB.prepare(
      'SELECT e.id AS id, e.created_at AS created_at, e.actor_user_id AS actor_user_id, '
      + 'e.assignee_user_id AS assignee_user_id, '
      + 'cu.name AS actor_name, cu.email AS actor_email, '
      + 'au.name AS assignee_name, au.email AS assignee_email '
      + 'FROM approval_events e '
      + 'LEFT JOIN users cu ON cu.id = e.actor_user_id '
      + 'LEFT JOIN users au ON au.id = e.assignee_user_id '
      + 'WHERE e.lane = ? AND e.item_id = ? '
      + 'ORDER BY e.id DESC LIMIT ?',
    ).bind(lane, itemId, HISTORY_CAP).all<HistoryRow>();
    const rows = got.results || [];
    const items = [...rows].reverse().map((row) => {
      const actorId = Number(row.actor_user_id);
      const assigneeId = Number(row.assignee_user_id);
      return {
        kind: 'assigned' as const,
        created_at: String(row.created_at ?? ''),
        actor_user_id: actorId,
        actor_name: personLabel({ id: actorId, name: row.actor_name, email: row.actor_email }),
        assignee_user_id: assigneeId,
        assignee_name: personLabel({ id: assigneeId, name: row.assignee_name, email: row.assignee_email }),
      };
    });
    return rows.length >= HISTORY_CAP ? { available: true, items, capped: true } : { available: true, items };
  } catch (e) {
    console.error('[approval-assignments] could not read history', (e as Error).message);
    return { available: false, reason: ASSIGNMENTS_UNREADABLE };
  }
}
