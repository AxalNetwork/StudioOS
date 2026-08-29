/**
 * Messages — a person-to-person inbox. Mounted at /api/messages.
 * Schema: migration 185.
 *
 *   GET    /                      my threads, newest activity first
 *   POST   /                      start a thread with someone
 *   GET    /:uid                  one thread and its messages
 *   POST   /:uid/messages         post to it
 *   POST   /:uid/read             mark read up to now
 *   POST   /:uid/archive          archive it for everyone in it
 *
 * MEMBERSHIP IS THE ONLY KEY. Every read and every write joins
 * `message_thread_participants` on the caller. There is no admin override:
 * unlike a fund or a project, a private conversation has no oversight reading
 * — an operator who needs one has the audit log, not the inbox. That is a
 * deliberate divergence from the other scopes in `tenancyScope.ts`, which is
 * why this one is inline and narrow rather than added there as a fifth
 * resource: it is not a tenancy rule, it is "you are in the room or you are
 * not".
 *
 * Unread is DERIVED from `last_read_at`, never stored. A counter is a second
 * source of truth that drifts the first time a write half-fails.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

const BODY_MAX = 8000;
const SUBJECT_MAX = 200;
// The objects a thread may be pinned to. A free-text subject_type would let
// the UI invent context rails for things that do not exist.
const SUBJECT_TYPES = new Set(['introduction', 'match', 'engagement', 'service', 'session', 'job']);

type ThreadRow = { id: number; uid: string; status: string };

/** The thread, only if the caller is in it. */
async function memberThread(env: Env, uid: string, userId: number): Promise<ThreadRow | null> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.uid, t.status
       FROM message_threads t
       JOIN message_thread_participants p ON p.thread_id = t.id AND p.user_id = ?
      WHERE t.uid = ?`,
  ).bind(userId, uid).first<ThreadRow>();
  return row || null;
}

r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT t.uid, t.subject, t.subject_type, t.subject_id, t.status,
              t.last_message_at, t.created_at,
              (SELECT COUNT(*) FROM messages m
                WHERE m.thread_id = t.id
                  AND m.sender_user_id != ?
                  AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)) AS unread,
              (SELECT m2.body FROM messages m2
                WHERE m2.thread_id = t.id ORDER BY m2.created_at DESC LIMIT 1) AS preview
         FROM message_threads t
         JOIN message_thread_participants p ON p.thread_id = t.id AND p.user_id = ?
        WHERE t.status = 'open'
        ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
        LIMIT 100`,
    ).bind(user.id, user.id).all<any>();

    // Counterparties, in one pass rather than a query per thread.
    const items = rows.results || [];
    let people: any[] = [];
    if (items.length) {
      const placeholders = items.map(() => '?').join(',');
      const res = await c.env.DB.prepare(
        `SELECT t.uid AS thread_uid, u.id AS user_id, u.name, u.email
           FROM message_thread_participants p
           JOIN message_threads t ON t.id = p.thread_id
           JOIN users u ON u.id = p.user_id
          WHERE t.uid IN (${placeholders}) AND p.user_id != ?`,
      ).bind(...items.map((x: any) => x.uid), user.id).all<any>();
      people = res.results || [];
    }
    const byThread = new Map<string, any[]>();
    for (const p of people) {
      if (!byThread.has(p.thread_uid)) byThread.set(p.thread_uid, []);
      byThread.get(p.thread_uid)!.push({ user_id: p.user_id, name: p.name, email: p.email });
    }
    return c.json({
      items: items.map((t: any) => ({ ...t, unread: Number(t.unread) || 0, participants: byThread.get(t.uid) || [] })),
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const email = String(body.to_email || '').trim().toLowerCase();
    const text = String(body.body || '').trim();
    if (!email) return c.json({ detail: 'to_email is required' }, 400);
    if (!text) return c.json({ detail: 'A first message is required' }, 400);
    if (body.subject_type !== undefined && body.subject_type !== null
        && !SUBJECT_TYPES.has(String(body.subject_type))) {
      return c.json({ detail: 'invalid subject_type' }, 400);
    }

    // An existing account only. Nothing is mailed and no placeholder user is
    // created — the UI says so rather than implying an invite.
    const other = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?')
      .bind(email).first<{ id: number }>();
    if (!other) return c.json({ detail: 'No account with that address' }, 404);
    if (other.id === user.id) return c.json({ detail: 'You cannot message yourself' }, 400);

    const uid = newUid();
    const now = nowIso();
    const ins = await c.env.DB.prepare(
      `INSERT INTO message_threads
         (uid, subject, subject_type, subject_id, created_by_user_id, status, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).bind(uid, body.subject ? String(body.subject).slice(0, SUBJECT_MAX) : null,
           body.subject_type ? String(body.subject_type) : null,
           body.subject_id != null ? Number(body.subject_id) : null,
           user.id, now, now, now).run();
    const threadId = Number((ins as any).meta?.last_row_id);

    // The sender has read their own opening message by definition; the
    // recipient has never opened the thread, which is what NULL means here.
    for (const participantId of [user.id, other.id]) {
      await c.env.DB.prepare(
        `INSERT INTO message_thread_participants (thread_id, user_id, last_read_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(threadId, participantId, participantId === user.id ? now : null, now).run();
    }
    await c.env.DB.prepare(
      'INSERT INTO messages (uid, thread_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(newUid(), threadId, user.id, text.slice(0, BODY_MAX), now).run();

    return c.json({ uid }, 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    // A thread the caller is not in is indistinguishable from one that does
    // not exist. A 403 would confirm the conversation is real.
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);

    const detail = await c.env.DB.prepare(
      'SELECT uid, subject, subject_type, subject_id, status, created_at FROM message_threads WHERE id = ?',
    ).bind(thread.id).first<any>();
    const msgs = await c.env.DB.prepare(
      `SELECT m.uid, m.body, m.created_at, m.sender_user_id, u.name AS sender_name, u.email AS sender_email
         FROM messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.thread_id = ? ORDER BY m.created_at ASC LIMIT 500`,
    ).bind(thread.id).all<any>();
    const people = await c.env.DB.prepare(
      `SELECT u.id AS user_id, u.name, u.email
         FROM message_thread_participants p JOIN users u ON u.id = p.user_id
        WHERE p.thread_id = ?`,
    ).bind(thread.id).all<any>();

    return c.json({
      thread: detail,
      messages: msgs.results || [],
      participants: people.results || [],
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/messages', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);
    if (thread.status !== 'open') return c.json({ detail: 'This conversation is archived' }, 409);

    const body = await c.req.json().catch(() => ({} as any));
    const text = String(body.body || '').trim();
    if (!text) return c.json({ detail: 'A message is required' }, 400);

    const now = nowIso();
    await c.env.DB.prepare(
      'INSERT INTO messages (uid, thread_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(newUid(), thread.id, user.id, text.slice(0, BODY_MAX), now).run();
    await c.env.DB.prepare('UPDATE message_threads SET last_message_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, thread.id).run();
    // Sending is reading: otherwise your own message counts against you.
    await c.env.DB.prepare(
      'UPDATE message_thread_participants SET last_read_at = ? WHERE thread_id = ? AND user_id = ?',
    ).bind(now, thread.id, user.id).run();
    return c.json({ ok: true }, 201);
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/read', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);
    await c.env.DB.prepare(
      'UPDATE message_thread_participants SET last_read_at = ? WHERE thread_id = ? AND user_id = ?',
    ).bind(nowIso(), thread.id, user.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/archive', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);
    // Archiving is for the whole thread, not per-person. A per-person hide
    // would need its own column, and a conversation one side has "archived"
    // while the other is still writing into it is a worse experience than
    // either alternative.
    await c.env.DB.prepare("UPDATE message_threads SET status = 'archived', updated_at = ? WHERE id = ?")
      .bind(nowIso(), thread.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export default r;
