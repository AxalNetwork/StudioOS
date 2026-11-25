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
  APPROVAL_SOURCES, NOT_LANED, SLA_DUE_SOON_HOURS, SLA_PAST_HOURS, approvalBoard, approvalItem, laneCounts,
  type ApprovalItem, type ApprovalLaneKey, type ApprovalSource,
} from './approvalSources';
import { logAdminAction } from './adminAudit';
import { HQ_APPROVAL_SOURCES } from './hqApprovalSources';
import { LANE_GROUP, NO_FILTER, filterInbox, isFiltered, laneBands, type InboxQuery } from './approvalInbox';

export const ASSIGNMENTS_UNREADABLE =
  'The assignment record could not be read on this database. That is not a claim that nobody is assigned.';

/** D5874: a target's lane could not be read, so nothing was assigned. */
export const LANE_UNREADABLE = (label: string) =>
  `${label} could not be read, so it cannot be checked that the item is still waiting. Nothing was assigned.`;

export const REVIEWERS_UNREADABLE =
  'The admin accounts on this territory could not be read, so there is nobody to offer. That is not a claim that this territory has no admins.';

/**
 * D5875: a reviewer workload count failed while the item rows were read, so the
 * counts are not shown. That is not a claim that anybody holds nothing.
 */
export const WORKLOAD_UNREADABLE =
  'The reviewer workload could not be counted on this database, so these counts are not shown. That is not a claim that anybody holds nothing.';

export const ASSIGNMENT_CAP = 40;
const HISTORY_CAP = 100;

/**
 * A lane `APPROVAL_SOURCES` or HQ's lanes declare (D1041), read from the lists
 * each time. Naming an HQ lane is not enough to assign on it: the item must be
 * waiting on a lane among the caller's own sources (D5874: read by lane and
 * id), which on a branch or for a plain admin never include an HQ lane.
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

/** An item on a board, by lane and id: what an assignment read is scoped to (D5875). */
export type BoardKey = { lane: string; id: number };

/**
 * D5875: the items a read is about, as one JSON parameter, so any number of them
 * is one bound value (D1 allows 100) and the statement text never grows. Each
 * row is `[lane, id, past]`; `past` is 1 for an item over the SLA's past band.
 */
const OPEN_ITEMS =
  "WITH open_items(lane, item_id, past) AS (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), "
  + "json_extract(value, '$[2]') FROM json_each(?)) ";

function itemsParam(items: ReadonlyArray<BoardKey & { sla?: string }>): string {
  return JSON.stringify(items.map((it) => [it.lane, Number(it.id), it.sla === 'past' ? 1 : 0]));
}

/**
 * The current assignee of each item named, and only those (D5875). The read is
 * joined to the items by the table's `UNIQUE (lane, item_id)` key, so its size
 * follows the items asked about, never the table's: a record of any length is
 * read the same way. It throws when the read fails.
 */
async function readAssignees(env: Env, items: readonly BoardKey[]): Promise<Map<string, Assignee>> {
  const assignees = new Map<string, Assignee>();
  if (!items.length) return assignees;
  const got = await env.DB.prepare(
    OPEN_ITEMS
    + 'SELECT a.lane AS lane, a.item_id AS item_id, a.assignee_user_id AS assignee_user_id, '
    + 'u.name AS name, u.email AS email '
    + 'FROM open_items o JOIN approval_assignments a ON a.lane = o.lane AND a.item_id = o.item_id '
    + 'LEFT JOIN users u ON u.id = a.assignee_user_id',
  ).bind(itemsParam(items)).all<AssigneeRow>();
  for (const row of got.results || []) {
    const id = Number(row.assignee_user_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    assignees.set(`${row.lane}:${Number(row.item_id)}`, {
      user_id: id,
      name: personLabel({ id, name: row.name, email: row.email }),
    });
  }
  return assignees;
}

async function readReviewers(env: Env): Promise<{ reviewers: Reviewer[] | null; reviewers_reason?: string }> {
  try {
    const admins = await env.DB.prepare(
      "SELECT id, name, email FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id",
    ).all<ReviewerRow>();
    return {
      reviewers: (admins.results || []).map((row) => ({
        id: Number(row.id),
        name: personLabel({ id: Number(row.id), name: row.name, email: row.email }),
      })).filter((row) => Number.isInteger(row.id) && row.id > 0),
    };
  } catch (e) {
    console.error('[approval-assignments] could not read reviewers', (e as Error).message);
    return { reviewers: null, reviewers_reason: REVIEWERS_UNREADABLE };
  }
}

/**
 * The assignees of `items` (the rows a page shows, or one item), and the
 * reviewers who may be offered. D5875: scoped to those items. Until then this
 * read the whole table to 5,000 rows and, past that, answered "unreadable" for
 * every row on every page; a long record is no longer a failure. A real read
 * failure still answers `ASSIGNMENTS_UNREADABLE`.
 */
export async function readAssignmentState(env: Env, items: readonly BoardKey[]): Promise<AssignmentRead> {
  const readable = await tablesReadable(env);
  if (!readable) {
    return { available: false, reason: ASSIGNMENTS_UNREADABLE, assignees: new Map(), reviewers: null };
  }
  let assignees: Map<string, Assignee>;
  try {
    assignees = await readAssignees(env, items);
  } catch (e) {
    console.error('[approval-assignments] could not read assignees', (e as Error).message);
    return { available: false, reason: ASSIGNMENTS_UNREADABLE, assignees: new Map(), reviewers: null };
  }
  const { reviewers, reviewers_reason } = await readReviewers(env);
  return { available: true, assignees, reviewers, ...(reviewers_reason ? { reviewers_reason } : {}) };
}

export type Workload =
  | { ok: true; byReviewer: Map<number, number>; assigned: number; pastAssigned: number }
  | { ok: false; reason: string };

/**
 * D5875: how many of `items` each reviewer holds, counted in SQL, apart from the
 * page's rows. Only items still waiting count (the ones passed in): a row left
 * behind by an item since decided is not workload. `pastAssigned` is how many of
 * the held items are past the SLA. A failed count answers `ok: false` with its
 * reason, never zero.
 */
export async function readWorkload(env: Env, items: ReadonlyArray<BoardKey & { sla?: string }>): Promise<Workload> {
  const byReviewer = new Map<number, number>();
  if (!items.length) return { ok: true, byReviewer, assigned: 0, pastAssigned: 0 };
  try {
    const got = await env.DB.prepare(
      OPEN_ITEMS
      + 'SELECT a.assignee_user_id AS assignee_user_id, COUNT(*) AS n, SUM(o.past) AS past '
      + 'FROM open_items o JOIN approval_assignments a ON a.lane = o.lane AND a.item_id = o.item_id '
      + 'WHERE a.assignee_user_id > 0 GROUP BY a.assignee_user_id',
    ).bind(itemsParam(items)).all<{ assignee_user_id: number; n: number; past: number | null }>();
    let assigned = 0;
    let pastAssigned = 0;
    for (const row of got.results || []) {
      const n = Number(row.n);
      byReviewer.set(Number(row.assignee_user_id), n);
      assigned += n;
      pastAssigned += Number(row.past ?? 0);
    }
    return { ok: true, byReviewer, assigned, pastAssigned };
  } catch (e) {
    console.error('[approval-assignments] could not count workload', (e as Error).message);
    return { ok: false, reason: WORKLOAD_UNREADABLE };
  }
}

export type AssignItem = { lane: string; item_id: number };

export type AssignResult =
  | { ok: true; assigned: Array<{ lane: string; item_id: number; assignee_user_id: number; assignee_name: string }> }
  | { ok: false; status: number; code: string; message: string };

const UPSERT =
  'INSERT INTO approval_assignments (lane, item_id, assignee_user_id, assigned_by_user_id) '
  + 'SELECT ?, ?, ?, ? WHERE NOT EXISTS ('
  + 'SELECT 1 FROM approval_assignments WHERE lane = ? AND item_id = ? AND assignee_user_id = ?) '
  + 'ON CONFLICT(lane, item_id) DO UPDATE SET '
  + 'assignee_user_id = excluded.assignee_user_id, '
  + 'assigned_by_user_id = excluded.assigned_by_user_id, '
  + "assigned_at = datetime('now')";

const EVENT =
  "INSERT INTO approval_events (lane, item_id, kind, actor_user_id, assignee_user_id) "
  + "SELECT ?, ?, 'assigned', ?, ? WHERE changes() > 0";

/** Assignment mirror used by the Formation desk and by the shared inbox. */
export function assignmentStatements(env: Env, lane: string, id: number, owner: number, admin: number) {
  return [
    env.DB.prepare(UPSERT).bind(lane, id, owner, admin, lane, id, owner),
    env.DB.prepare(EVENT).bind(lane, id, admin, owner),
  ];
}

/** Keep Formation's HQ ownership and its access boundary in the same transaction as the inbox. */
export function formationOwnerStatements(env: Env, id: number, owner: number, admin: number) {
  return [
    env.DB.prepare("UPDATE formation_cases SET hq_owner_user_id = ?, updated_at = datetime('now') WHERE id = ? AND hq_owner_user_id IS NOT ?").bind(owner, id, owner),
    env.DB.prepare(`INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json)
      SELECT id, ?, 'hq', 'hq_owner_assigned', 'hq_only', json_object('owner_user_id', ?, 'partner_id', partner_id)
      FROM formation_cases WHERE id = ? AND changes() > 0`).bind(admin, owner, id),
  ];
}

/**
 * Assign every item and append its event in one D1 transaction, or write none
 * of them. Each event immediately follows its conditional upsert and uses
 * `changes()`, so assigning the same reviewer again stays idempotent.
 */
export async function assignReviewers(
  env: Env,
  actorUserId: number,
  assigneeUserId: number,
  items: AssignItem[],
  opts: { sources?: readonly ApprovalSource[] } = {},
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
  // D5874: each target is read by its lane and id (`approvalItem`), not looked
  // for in a board read to a cap, so an item past the cap can be assigned like
  // any other. A lane this caller does not see is not a target; a lane whose
  // read fails refuses the whole write as unreadable, never as "not waiting".
  const sources = opts.sources ?? APPROVAL_SOURCES;
  for (const it of items) {
    const source = sources.find((s) => s.key === it.lane);
    let open: ApprovalItem | null = null;
    if (source) {
      try {
        open = await approvalItem(env, source, it.item_id);
      } catch (e) {
        console.error('[approval-assignments] could not read the item', it.lane, (e as Error).message);
        return { ok: false, status: 503, code: 'lane_unreadable', message: LANE_UNREADABLE(source.label) };
      }
    }
    if (!open) {
      return {
        ok: false,
        status: 400,
        code: 'not_on_board',
        message: 'That item is not among the open rows this board is showing, so it was not assigned.',
      };
    }
  }
  const name = personLabel({ id: Number(reviewer.id), name: reviewer.name, email: reviewer.email });
  const assigned = items.map((it) => ({
    lane: it.lane,
    item_id: it.item_id,
    assignee_user_id: assigneeUserId,
    assignee_name: name,
  }));
  try {
    const statements = [];
    for (const it of items) {
      if (it.lane === 'formation_cases') {
        statements.push(env.DB.prepare(`SELECT CASE WHEN EXISTS (
          SELECT 1 FROM formation_cases WHERE id = ? AND closed_at IS NULL AND waiting_on = 'hq'
        ) AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND is_active = 1)
        THEN 1 ELSE abs(-9223372036854775808) END`).bind(it.item_id, assigneeUserId));
        statements.push(...formationOwnerStatements(env, it.item_id, assigneeUserId, actorUserId));
      }
      statements.push(...assignmentStatements(env, it.lane, it.item_id, assigneeUserId, actorUserId));
    }
    const results = await env.DB.batch(statements);
    if (results.some((row) => 'success' in row && !row.success)) throw new Error('Assignment batch failed');
  } catch (e) {
    if (/integer overflow/i.test(String(e))) return { ok: false, status: 409, code: 'case_moved', message: 'The formation case changed. Reload the board.' };
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
 * caller sees and still waiting there (read by lane and id, D5874), then one
 * admin-audit row per item assigned.
 */
export async function assignFromBody(
  env: Env,
  admin: { id: number; email?: string | null },
  body: Record<string, unknown> | null,
  opts: { sources: readonly ApprovalSource[] },
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
const TOTAL_CAPPED_FILTERED = (labels: string[]) =>
  `${labels.join(', ')} has more open items than this read takes, so how many match is not shown rather than shown short.`;

/**
 * D1132 (#3012) — one waiting item, for `/admin/approvals/[id]`: the row as
 * the inbox shows it, its assignee, its lane (group, who a decision tells,
 * the page that decides it) and its assignment history. D5874: read by lane
 * and id (`approvalItem`), so an item past the inbox's 1,000-row cap is found
 * like any other; one no longer waiting answers `null`, a lane whose read
 * failed `'unreadable'`.
 */
export async function inboxItem(env: Env, a: { lane: ApprovalLaneKey; itemId: number; sources: readonly ApprovalSource[]; now?: number }) {
  const source = a.sources.find((s) => s.key === a.lane);
  if (!source) return null;
  let item: ApprovalItem | null;
  try {
    item = await approvalItem(env, source, a.itemId, a.now ?? Date.now());
  } catch (e) {
    console.error('[approval-assignments] could not read the item', a.lane, (e as Error).message);
    return 'unreadable' as const;
  }
  if (!item) return null;
  // D5875: the one item's assignee, read by its key.
  const assignments = await readAssignmentState(env, [item]);
  return {
    item: { ...item, assignee: assignments.available ? assignments.assignees.get(`${item.lane}:${item.id}`) ?? null : undefined },
    ...(assignments.available ? {} : { assignee_reason: assignments.reason }),
    lane: {
      key: source.key, label: source.label, group: LANE_GROUP[source.key],
      notifies: source.notifies, decided_on: source.decidedOn,
      ...(source.undecidedReason ? { undecided_reason: source.undecidedReason } : {}),
      hq: source.scope === 'hq',
    },
    history: await assignmentHistory(env, item.lane, item.id),
    decides: false,
  };
}

export type InboxItem = ApprovalItem & { assignee?: Assignee | null };

/**
 * D4814: the oldest item with a known age, and its lane, or null when nothing
 * read has one. An item with no arrival time is never the oldest.
 */
function oldestOf(items: ApprovalItem[], lanes: Array<{ key: string; label: string }>) {
  let top: ApprovalItem | null = null;
  for (const it of items) {
    if (it.age_hours == null) continue;
    if (!top || (it.age_hours as number) > (top.age_hours as number)) top = it;
  }
  if (!top) return null;
  return { age_hours: top.age_hours, lane: top.lane, label: lanes.find((l) => l.key === top!.lane)?.label ?? top.lane_label };
}

/**
 * GET /api/admin/approvals — every waiting item, oldest first, with its
 * assignee, paged, with an exact total of the lanes that answered and the
 * three tiles (over 72 hours, assigned to the caller, per admin).
 *
 * A LANE THAT FAILED IS NAMED, NEVER EMPTY: it stays in `unreadable`, the rows
 * that could be read stay, and the tiles, which would be short by that lane,
 * answer null with the reason. An unknown age sorts last (`approvalBoard`).
 */
export async function hqInbox(env: Env, a: {
  page: number; callerId: number; sources: readonly ApprovalSource[]; now?: number;
  /** D1132: search, filters and sort, applied to the rows read (`approvalInbox.ts`). */
  query?: InboxQuery;
}) {
  const query = a.query ?? NO_FILTER;
  const board = await approvalBoard(env, INBOX_LANE_CAP, a.now ?? Date.now(), a.sources);
  const capped = board.lanes.filter((l) => l.count != null && l.count >= INBOX_LANE_CAP);
  let total: number | null = board.items.length;
  if (capped.length) {
    const counts = await laneCounts(env, a.sources.filter((s) => capped.some((c) => c.key === s.key)));
    const extra = counts.reduce<number | null>((sum, c) => (sum == null || c.count == null ? null : sum + c.count - INBOX_LANE_CAP), 0);
    total = extra == null ? null : board.items.length + extra;
  }

  // D5875: an assigned filter needs every row's assignee, so it reads the
  // assignees of the rows the board read (still scoped to them, never the whole
  // table). Without one, only the page's rows are read, below.
  const byAssignee = query.assigned !== null;
  const assignments = await readAssignmentState(env, byAssignee ? board.items : []);
  // D1132: an assigned filter on an unreadable assignment record would answer
  // "nobody" for every row, so it is refused rather than answered
  // (`assigned_unreadable`).
  if (byAssignee && !assignments.available) {
    return { refused: { status: 503, code: 'assigned_unreadable', message: assignments.reason ?? ASSIGNMENTS_UNREADABLE } } as const;
  }
  const withAssignee = (rows: ApprovalItem[], map: Map<string, Assignee>): InboxItem[] =>
    rows.map((it) => ({ ...it, assignee: map.get(`${it.lane}:${it.id}`) ?? null }));

  // D5875: the workload tiles are counted in SQL over the rows read, apart from
  // the page. A count that fails is null with its reason, never 0.
  const workload: Workload = assignments.available ? await readWorkload(env, board.items) : { ok: false, reason: assignments.reason ?? ASSIGNMENTS_UNREADABLE };
  const counted = workload.ok ? workload : null;
  const pastAll = board.items.filter((it) => it.sla === 'past').length;
  const short = board.unreadable.length ? TILES_UNREADABLE(board.unreadable) : capped.length ? TILES_CAPPED(capped.map((c) => c.label)) : null;
  const mine = counted ? counted.byReviewer.get(a.callerId) ?? 0 : null;
  const tiles = {
    over_72h: short ? null : pastAll,
    assigned_to_me: short ? null : mine,
    per_admin: short || !counted || !assignments.reviewers ? null : assignments.reviewers.map((r) => ({
      id: r.id, name: r.name, count: counted.byReviewer.get(r.id) ?? 0,
    })),
    // D4814: the items nobody holds, across every lane read, not one page. Like
    // the others it is null when a lane failed or was cut at the cap (shown
    // short), and null when the assignment record could not be read or counted
    // (that is "not read", never "nobody").
    unassigned: short || !counted ? null : board.items.length - counted.assigned,
    overdue_unassigned: short || !counted ? null : pastAll - counted.pastAssigned,
    // D4814: the oldest item read, with its lane. With a lane unreadable it is
    // the oldest of the lanes that answered, and `complete` says so.
    oldest: oldestOf(board.items, board.lanes),
    ...(short ? {
      // D4814: what the rows that were read hold, so a page can say "127+"
      // rather than nothing; each is a floor, never the figure.
      at_least: {
        over_72h: pastAll,
        unassigned: counted ? board.items.length - counted.assigned : null,
        assigned_to_me: mine,
      },
    } : {}),
    complete: !short,
    ...(short ? { reason: short }
      : !workload.ok ? { reason: workload.reason }
        : !assignments.reviewers ? { reason: assignments.reviewers_reason } : {}),
  };

  const filtered = isFiltered(query);
  const rows: InboxItem[] = byAssignee ? withAssignee(board.items, assignments.assignees) : board.items;
  const shown = filtered || query.sort !== 'oldest' ? filterInbox(rows, query, a.callerId) : rows;
  // A narrowed total counts the rows read; a lane cut at the cap may hold more
  // that match, so the total is withheld then rather than shown short.
  const matching: number | null = !filtered ? total : capped.length ? null : shown.length;

  const start = (a.page - 1) * INBOX_PAGE_SIZE;
  const pageRows = shown.slice(start, start + INBOX_PAGE_SIZE);
  // D5875: without an assigned filter, the assignees read are the page's own.
  // A failed page read leaves `assignee` off the rows (not read, never nobody).
  let page: InboxItem[] = pageRows;
  let pageState = assignments;
  if (!byAssignee && assignments.available) {
    try {
      page = withAssignee(pageRows, await readAssignees(env, pageRows));
    } catch (e) {
      console.error('[approval-assignments] could not read the page\'s assignees', (e as Error).message);
      pageState = { ...assignments, available: false, reason: ASSIGNMENTS_UNREADABLE };
    }
  }
  return {
    items: page,
    total: matching,
    ...(matching == null
      ? { total_reason: filtered && capped.length ? TOTAL_CAPPED_FILTERED(capped.map((c) => c.label)) : TOTAL_UNREADABLE }
      : {}),
    ...(filtered ? { unfiltered_total: total } : {}),
    query,
    page: a.page,
    page_size: INBOX_PAGE_SIZE,
    // D1132: each lane with its group and its split by age band (APR1's chart).
    lanes: laneBands(board.lanes, board.items, INBOX_LANE_CAP),
    unreadable: board.unreadable,
    ...(board.unreadable.length ? {
      reason: `${board.unreadable.join(', ')} could not be read, so the inbox is missing whatever is in them. `
        + 'The lanes that answered are complete; the ones that did not show no count rather than a zero.',
    } : {}),
    ...(capped.length ? { capped: capped.map((c) => c.label) } : {}),
    tiles,
    assignments: pageState.available ? { available: true } : { available: false, reason: pageState.reason },
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
