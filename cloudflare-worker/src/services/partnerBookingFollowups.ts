/**
 * Office Hours follow-ups — what a session left behind (D355, migrations 360
 * and 361): the action items both parties keep, and the founder's rating.
 *
 * WHO MAY DO WHAT, stated so it can be tested:
 *
 *   * A booking has two parties: its founder (`partner_bookings.founder_user_id`)
 *     and its partner (an account whose `users.partner_id` is the booking's
 *     `partner_id`). Anyone else — another founder, another partner, staff —
 *     gets the same 404 as a booking that does not exist, so ids cannot be
 *     enumerated. No request field chooses the actor or their side.
 *   * Action items: either party adds one, and the item records who added it
 *     and on which side. Either party ticks it done or reopens it (the tick
 *     records who). Only the author edits its text, due date or tool, or
 *     deletes it. Items attach to a booking that was not cancelled.
 *   * Rating: only the booking's founder, only once the booking is
 *     `completed`, 1–5 with an optional comment, one per booking (a second
 *     write replaces the first). The partner and founder ids on the row are
 *     copied from the booking, never from the request.
 *   * The partner sees the rating on each of their own completed sessions,
 *     comment included. The directory shows each partner's average from the
 *     first rating, always with the count beside it.
 *
 * Pure SQL through `env.DB`, so the tests run it on a real SQLite
 * (test/_d1_sqlite.mjs) over the real migration DDL.
 */
import type { Env, User } from '../types';

/** The Lab tools an action item may link to → /spinout-lab/<key>. */
export const LINKED_TOOLS = [
  'profiling', 'discovery', 'market', 'scoring', 'advisors', 'cofounder-match',
  'cofounder-agreement', 'captable', '83b', 'incorporate', 'use-of-funds',
  'revenue', 'pitch-deck', 'brand', 'capital', 'compliance', 'roadmap',
] as const;
export const TITLE_MAX = 200;
export const COMMENT_MAX = 1000;

export type Side = 'founder' | 'partner';
export type Refusal = { status: number; code: string; message: string };
const refusal = (status: number, code: string, message: string): { refused: Refusal } => ({ refused: { status, code, message } });

const NOT_FOUND = refusal(404, 'booking_not_found', 'That office-hours session was not found.');
const ITEM_NOT_FOUND = refusal(404, 'action_item_not_found', 'That action item was not found.');

type BookingRow = { id: number; partner_id: number; founder_user_id: number; status: string };
type ItemRow = {
  id: number; booking_id: number; title: string; linked_tool: string | null; due_date: string | null;
  done_at: string | null; completed_by_user_id: number | null;
  created_by_user_id: number; created_by_role: Side; created_at: string; updated_at: string;
};

/** The caller's side of one booking, or null when they are not a party. */
export function sideOf(booking: BookingRow, user: User): Side | null {
  if (Number(booking.founder_user_id) === Number(user.id)) return 'founder';
  const pid = (user as any).partner_id;
  if (pid != null && Number(pid) === Number(booking.partner_id)) return 'partner';
  return null;
}

export async function bookingAccess(env: Env, bookingId: number, user: User) {
  if (!Number.isInteger(bookingId) || bookingId <= 0) return NOT_FOUND;
  const booking = await env.DB.prepare(
    'SELECT id, partner_id, founder_user_id, status FROM partner_bookings WHERE id = ?',
  ).bind(bookingId).first<BookingRow>();
  if (!booking) return NOT_FOUND;
  const side = sideOf(booking, user);
  if (!side) return NOT_FOUND;
  return { booking, side };
}

const ITEM_BY_ID = `SELECT id, booking_id, title, linked_tool, due_date, done_at, completed_by_user_id,
         created_by_user_id, created_by_role, created_at, updated_at
    FROM partner_booking_action_items WHERE id = ?`;

function itemDto(r: ItemRow, user: User) {
  return {
    id: r.id,
    booking_id: r.booking_id,
    title: r.title,
    linked_tool: r.linked_tool,
    due_date: r.due_date,
    done: r.done_at != null,
    done_at: r.done_at,
    completed_by_you: r.completed_by_user_id != null && Number(r.completed_by_user_id) === Number(user.id),
    added_by: r.created_by_role,
    added_by_you: Number(r.created_by_user_id) === Number(user.id),
    created_at: r.created_at,
  };
}

export async function listItems(env: Env, bookingId: number, user: User) {
  const access = await bookingAccess(env, bookingId, user);
  if ('refused' in access) return access;
  const res = await env.DB.prepare(
    `SELECT id, booking_id, title, linked_tool, due_date, done_at, completed_by_user_id,
            created_by_user_id, created_by_role, created_at, updated_at
       FROM partner_booking_action_items WHERE booking_id = ? ORDER BY id`,
  ).bind(bookingId).all<ItemRow>();
  return { booking_id: bookingId, side: access.side, items: (res.results || []).map((r) => itemDto(r, user)) };
}

function cleanTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, TITLE_MAX) : null;
}
/** undefined = not sent; null = cleared; string = valid; false = invalid. */
function cleanTool(v: unknown): string | null | undefined | false {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return typeof v === 'string' && (LINKED_TOOLS as readonly string[]).includes(v) ? v : false;
}
function cleanDue(v: unknown): string | null | undefined | false {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : false;
}
const BAD_TOOL = refusal(400, 'invalid_linked_tool', 'An action item links to one of the Lab tools, or to none.');
const BAD_DUE = refusal(400, 'invalid_due_date', 'A due date is a calendar date (YYYY-MM-DD), or none.');

export async function addItem(env: Env, args: { bookingId: number; user: User; title: unknown; linkedTool: unknown; dueDate: unknown }) {
  const title = cleanTitle(args.title);
  if (!title) return refusal(400, 'title_required', 'An action item needs a title.');
  const tool = cleanTool(args.linkedTool);
  if (tool === false) return BAD_TOOL;
  const due = cleanDue(args.dueDate);
  if (due === false) return BAD_DUE;
  const access = await bookingAccess(env, args.bookingId, args.user);
  if ('refused' in access) return access;
  if (access.booking.status === 'cancelled') {
    return refusal(409, 'booking_cancelled', 'This session was cancelled, so it takes no action items.');
  }
  const ins = await env.DB.prepare(
    `INSERT INTO partner_booking_action_items
       (booking_id, title, linked_tool, due_date, created_by_user_id, created_by_role)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(args.bookingId, title, tool ?? null, due ?? null, args.user.id, access.side).run();
  const row = await env.DB.prepare(ITEM_BY_ID)
    .bind(Number((ins as any).meta?.last_row_id)).first<ItemRow>();
  return { item: itemDto(row!, args.user) };
}

async function itemAccess(env: Env, itemId: number, user: User) {
  if (!Number.isInteger(itemId) || itemId <= 0) return ITEM_NOT_FOUND;
  const row = await env.DB.prepare(ITEM_BY_ID)
    .bind(itemId).first<ItemRow>();
  if (!row) return ITEM_NOT_FOUND;
  const access = await bookingAccess(env, row.booking_id, user);
  if ('refused' in access) return ITEM_NOT_FOUND;
  return { row, side: access.side, isAuthor: Number(row.created_by_user_id) === Number(user.id) };
}

/**
 * `done` may be sent by either party. `title`, `linked_tool` and `due_date`
 * change the item's wording, so only its author may send them.
 */
export async function updateItem(env: Env, args: { itemId: number; user: User; patch: Record<string, unknown> }) {
  const p = args.patch || {};
  const access = await itemAccess(env, args.itemId, args.user);
  if ('refused' in access) return access;
  const editsText = p.title !== undefined || p.linked_tool !== undefined || p.due_date !== undefined;
  if (editsText && !access.isAuthor) {
    return refusal(403, 'not_the_author', 'Only the person who added this action item can change its wording. Either of you can tick it done.');
  }
  let title = access.row.title;
  let tool: string | null = access.row.linked_tool;
  let due: string | null = access.row.due_date;
  if (p.title !== undefined) {
    const t = cleanTitle(p.title);
    if (!t) return refusal(400, 'title_required', 'An action item needs a title.');
    title = t;
  }
  if (p.linked_tool !== undefined) {
    const t = cleanTool(p.linked_tool);
    if (t === false) return BAD_TOOL;
    tool = t ?? null;
  }
  if (p.due_date !== undefined) {
    const d = cleanDue(p.due_date);
    if (d === false) return BAD_DUE;
    due = d ?? null;
  }
  if (p.done !== undefined && typeof p.done !== 'boolean') {
    return refusal(400, 'invalid_done', '`done` is true or false.');
  }
  if (!editsText && p.done === undefined) return refusal(400, 'nothing_to_change', 'Send a title, tool, due date or done.');
  // 1 = tick (keeps the first tick's time and ticker), 0 = reopen, -1 = leave.
  const doneFlag = p.done === undefined ? -1 : p.done ? 1 : 0;
  await env.DB.prepare(
    `UPDATE partner_booking_action_items
        SET title = ?, linked_tool = ?, due_date = ?,
            done_at = CASE ? WHEN 1 THEN COALESCE(done_at, datetime('now')) WHEN 0 THEN NULL ELSE done_at END,
            completed_by_user_id = CASE ? WHEN 1 THEN COALESCE(completed_by_user_id, ?) WHEN 0 THEN NULL ELSE completed_by_user_id END,
            updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(title, tool, due, doneFlag, doneFlag, args.user.id, args.itemId).run();
  const row = await env.DB.prepare(ITEM_BY_ID)
    .bind(args.itemId).first<ItemRow>();
  return { item: itemDto(row!, args.user) };
}

export async function deleteItem(env: Env, itemId: number, user: User) {
  const access = await itemAccess(env, itemId, user);
  if ('refused' in access) return access;
  if (!access.isAuthor) {
    return refusal(403, 'not_the_author', 'Only the person who added this action item can delete it.');
  }
  await env.DB.prepare('DELETE FROM partner_booking_action_items WHERE id = ?').bind(itemId).run();
  return { ok: true as const };
}

/**
 * Every action item on the caller's own sessions, both sides: bookings they
 * made as a founder and bookings on their partner profile. Cancelled
 * sessions' items are left out.
 */
export async function myItems(env: Env, user: User) {
  const pid = (user as any).partner_id;
  const res = await env.DB.prepare(
    `SELECT i.id, i.booking_id, i.title, i.linked_tool, i.due_date, i.done_at, i.completed_by_user_id,
            i.created_by_user_id, i.created_by_role, i.created_at, i.updated_at
       FROM partner_booking_action_items i
       JOIN partner_bookings b ON b.id = i.booking_id
      WHERE b.status <> 'cancelled'
        AND (b.founder_user_id = ? OR (? IS NOT NULL AND b.partner_id = ?))
      ORDER BY i.done_at IS NOT NULL, i.due_date IS NULL, i.due_date, i.id`,
  ).bind(user.id, pid ?? null, pid ?? null).all<ItemRow>();
  return { items: (res.results || []).map((r) => itemDto(r, user)) };
}

/** The founder rates a completed session: 1–5, optional comment, one per booking. */
export async function rateBooking(env: Env, args: { bookingId: number; user: User; rating: unknown; comment: unknown }) {
  const n = args.rating;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 5) {
    return refusal(400, 'invalid_rating', 'A rating is a whole number from 1 to 5.');
  }
  const access = await bookingAccess(env, args.bookingId, args.user);
  if ('refused' in access) return access;
  if (access.side !== 'founder') {
    return refusal(403, 'founder_only', 'Only the founder who booked this session can rate it.');
  }
  if (access.booking.status !== 'completed') {
    return refusal(409, 'not_completed', 'A session can be rated once the partner has marked it completed.');
  }
  const comment = typeof args.comment === 'string' && args.comment.trim() ? args.comment.trim().slice(0, COMMENT_MAX) : null;
  await env.DB.prepare(
    `INSERT INTO partner_booking_ratings (booking_id, partner_id, founder_user_id, rating, comment)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (booking_id)
     DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = datetime('now')`,
  ).bind(args.bookingId, access.booking.partner_id, access.booking.founder_user_id, n, comment).run();
  return { booking_id: args.bookingId, rating: n, rating_comment: comment };
}

/**
 * Every rated partner's average and count. A partner with no ratings is
 * ABSENT from the result — never an average of 0. Averages are about a
 * partner, not about any founder, so the read names no founder and no booking.
 */
export async function ratingSummary(env: Env) {
  const res = await env.DB.prepare(
    `SELECT partner_id, AVG(rating) AS average, COUNT(*) AS count
       FROM partner_booking_ratings
      GROUP BY partner_id`,
  ).all<{ partner_id: number; average: number; count: number }>();
  return {
    items: (res.results || []).map((r) => ({
      partner_id: Number(r.partner_id),
      average: Math.round(Number(r.average) * 10) / 10,
      count: Number(r.count),
    })),
  };
}
