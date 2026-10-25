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
import {
  APPROVAL_SOURCES, NOT_LANED, SLA_DUE_SOON_HOURS, SLA_PAST_HOURS, approvalBoard, laneCounts,
  type ApprovalItem, type ApprovalLaneKey, type ApprovalSource,
} from './approvalSources';
import { logAdminAction } from './adminAudit';
import { HQ_APPROVAL_SOURCES } from './hqApprovalSources';

export const ASSIGNMENTS_UNREADABLE =
  'The assignment record could not be read on this database. That is not a claim that nobody is assigned.';

export const REVIEWERS_UNREADABLE =
  'The admin accounts on this territory could not be read, so there is nobody to offer. That is not a claim that this territory has no admins.';

export const ASSIGNMENT_CAP = 40;
const READ_CAP = 5000;
const HISTORY_CAP = 100;

/**
 * A lane `APPROVAL_SOURCES` or HQ's lanes declare (D1041), read from the lists
 * each time. Naming an HQ lane is not enough to assign on it: the item must be
 * open on the board read with the caller's own sources, which on a branch or
 * for a plain admin never include an HQ lane.
 */
export function isAssignmentLane(lane: string): lane is ApprovalLaneKey {
  return APPROVAL_SOURCES.some((s) => s.key === lane) || HQ_APPROVAL_SOURCES.some((s) => s.key === lane);
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
  opts: { sources?: readonly ApprovalSource[]; boardLimit?: number } = {},
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
    open = await approvalBoard(env, opts.boardLimit ?? 100, Date.now(), opts.sources ?? APPROVAL_SOURCES);
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

// ───────────────────────────────────────────────────────────── the routes' shared steps

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

export type Refusal = { ok: false; status: number; code: string; message: string };
const BAD_ITEM: Refusal = { ok: false, status: 400, code: 'bad_item', message: 'That is not an item on this board.' };

/** A lane this reader may name: one of `sources`, by key. */
export function isVisibleLane(lane: string, sources: readonly ApprovalSource[]): lane is ApprovalLaneKey {
  return isAssignmentLane(lane) && sources.some((s) => s.key === lane);
}

/** The history read's query, checked: `?lane=&item_id=` naming an item on a lane this reader sees. */
export function readHistoryQuery(lane: string, rawItemId: unknown, sources: readonly ApprovalSource[]): Refusal | { ok: true; lane: ApprovalLaneKey; itemId: number } {
  const itemId = Number(rawItemId);
  if (!isVisibleLane(lane, sources) || !Number.isInteger(itemId) || itemId <= 0) return BAD_ITEM;
  return { ok: true, lane, itemId };
}

/**
 * The assignment write both boards take (D470 on a branch, D1040 on HQ):
 * `{ assignee_user_id, items: [{ lane, item_id }] }`, each item on a lane the
 * caller sees and among the open rows `boardLimit` reads, then one admin-audit
 * row per item assigned.
 */
export async function assignFromBody(
  env: Env,
  admin: { id: number; email?: string | null },
  body: Record<string, unknown> | null,
  opts: { sources: readonly ApprovalSource[]; boardLimit: number },
): Promise<AssignResult> {
  const assignee = positiveInt(body?.assignee_user_id);
  const raw = Array.isArray(body?.items) ? body.items : [];
  const items: AssignItem[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const lane = String((row as { lane?: unknown })?.lane || '');
    const itemId = positiveInt((row as { item_id?: unknown })?.item_id);
    if (!isVisibleLane(lane, opts.sources) || itemId === null) return BAD_ITEM;
    const key = `${lane}:${itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ lane, item_id: itemId });
  }
  if (assignee === null) {
    return { ok: false, status: 400, code: 'not_a_reviewer', message: 'A reviewer is an active admin on this territory.' };
  }
  const result = await assignReviewers(env, admin.id, assignee, items, opts);
  if (!result.ok) return result;
  for (const row of result.assigned) {
    await logAdminAction(env, admin.id, admin.email || '', 'approval_assignment', {
      target_user_id: row.assignee_user_id,
      lane: row.lane,
      item_id: row.item_id,
    });
  }
  return result;
}

// ───────────────────────────────────────────────────────────── HQ's inbox (D1040)

export const INBOX_PAGE_SIZE = 25;
/**
 * The most rows read per lane. Each lane's rows come oldest first, so a lane
 * read to the cap holds its oldest open items; when one is cut there, the
 * total comes from its count and the tiles say they cannot be counted.
 */
export const INBOX_LANE_CAP = 1000;

const TILES_UNREADABLE = (labels: string[]) =>
  `${labels.join(', ')} could not be read, so these counts would be missing whatever is in them. They are not shown rather than shown short.`;
const TILES_CAPPED = (labels: string[]) =>
  `${labels.join(', ')} has more open items than this read takes, so these counts are not shown rather than shown short.`;
const TOTAL_UNREADABLE = 'The count of open items could not be read, so the total is not shown.';

export type InboxItem = ApprovalItem & { assignee?: Assignee | null };

/**
 * GET /api/admin/approvals — every waiting item, oldest first, with its
 * assignee, paged, with an exact total of the lanes that answered and the
 * three tiles (over 72 hours, assigned to the caller, per admin).
 *
 * A LANE THAT FAILED IS NAMED, NEVER EMPTY: it stays in `unreadable`, the rows
 * that could be read stay, and the tiles, which would be short by that lane,
 * answer null with the reason. An unknown age sorts last (`approvalBoard`).
 */
export async function hqInbox(env: Env, a: { page: number; callerId: number; sources: readonly ApprovalSource[]; now?: number }) {
  const board = await approvalBoard(env, INBOX_LANE_CAP, a.now ?? Date.now(), a.sources);
  const capped = board.lanes.filter((l) => l.count != null && l.count >= INBOX_LANE_CAP);
  let total: number | null = board.items.length;
  if (capped.length) {
    const counts = await laneCounts(env, a.sources.filter((s) => capped.some((c) => c.key === s.key)));
    const extra = counts.reduce<number | null>((sum, c) => (sum == null || c.count == null ? null : sum + c.count - INBOX_LANE_CAP), 0);
    total = extra == null ? null : board.items.length + extra;
  }

  const assignments = await readAssignmentState(env);
  const items: InboxItem[] = assignments.available
    ? board.items.map((it) => ({ ...it, assignee: assignments.assignees.get(`${it.lane}:${it.id}`) ?? null }))
    : board.items;

  const short = board.unreadable.length ? TILES_UNREADABLE(board.unreadable) : capped.length ? TILES_CAPPED(capped.map((c) => c.label)) : null;
  const assigneeOf = (it: ApprovalItem) => assignments.assignees.get(`${it.lane}:${it.id}`);
  const tiles = {
    over_72h: short ? null : board.items.filter((it) => it.sla === 'past').length,
    assigned_to_me: short || !assignments.available ? null : board.items.filter((it) => assigneeOf(it)?.user_id === a.callerId).length,
    per_admin: short || !assignments.available || !assignments.reviewers ? null : assignments.reviewers.map((r) => ({
      id: r.id, name: r.name, count: board.items.filter((it) => assigneeOf(it)?.user_id === r.id).length,
    })),
    ...(short ? { reason: short }
      : !assignments.available ? { reason: assignments.reason }
        : !assignments.reviewers ? { reason: assignments.reviewers_reason } : {}),
  };

  const start = (a.page - 1) * INBOX_PAGE_SIZE;
  return {
    items: items.slice(start, start + INBOX_PAGE_SIZE),
    total,
    ...(total == null ? { total_reason: TOTAL_UNREADABLE } : {}),
    page: a.page,
    page_size: INBOX_PAGE_SIZE,
    lanes: board.lanes,
    unreadable: board.unreadable,
    ...(board.unreadable.length ? {
      reason: `${board.unreadable.join(', ')} could not be read, so the inbox is missing whatever is in them. `
        + 'The lanes that answered are complete; the ones that did not show no count rather than a zero.',
    } : {}),
    ...(capped.length ? { capped: capped.map((c) => c.label) } : {}),
    tiles,
    assignments: assignments.available ? { available: true } : { available: false, reason: assignments.reason },
    reviewers: assignments.reviewers,
    ...(assignments.reviewers_reason ? { reviewers_reason: assignments.reviewers_reason } : {}),
    sla_bands: { due_soon_hours: SLA_DUE_SOON_HOURS, past_hours: SLA_PAST_HOURS },
    not_laned: NOT_LANED,
    decides: false,
    decide_note:
      'This inbox reads. Each decision is made in the queue\'s own console, which owns that '
      + 'store\'s statuses and its side effects.',
  };
}
