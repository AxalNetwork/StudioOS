/**
 * D684 — customer conversations from a member's business Telegram or WhatsApp.
 *
 * Every chat on a connected account is a thread. A thread starts PENDING: its
 * messages wait in `channel_thread_messages`, encrypted (columnCipher, AAD
 * `channel_thread_messages:text_enc:<uid>`), and nothing reaches an interview
 * until the member says which one — Axal never creates an interview because a
 * stranger wrote in. Then:
 *   assign   the pending messages become final transcript segments of a new
 *            Text session on that interview, and the pending copies are
 *            deleted in the same batch. Later messages on the chat go straight
 *            to that session.
 *   ignore   the pending copies are deleted and later messages are dropped
 *            (a personal chat on a business account is none of Axal's business).
 * Pending messages are purged after CHANNEL_LIMITS.pendingDays.
 *
 * Edits and deletions at the source change a PENDING message. Once a message
 * is in an interview the transcript is the member's record: they edit it there.
 *
 * Every function that takes `userId` scopes by it; every write into an
 * interview goes through `interviewIntake.ts`, which re-checks the member and
 * the venture on each call.
 */
import type { Env } from '../../types';
import type { StoredSegment } from '../interviewSessions';
import { decryptColumn, encryptColumn } from '../columnCipher';
import {
  IntakeError, activeMember, appendSegments, createInterview, openSession, writableInterview, type ScopedInterview,
} from '../interviewIntake';
import type { ChannelConnection } from './connections';
import { refKey } from './events';
import { isOurSend } from './outbound';
import { enqueueSessionStructure } from '../sessionAutoStructure';
import {
  CHANNEL_LIMITS, type InboundDelete, type InboundEdit, type InboundMessage, type MessageSide, type MessagingProvider,
} from './types';

export interface ThreadRow {
  id: number; uid: string; provider: MessagingProvider; integration_id: number; user_id: number;
  external_chat_id: string; contact_name_enc: string | null; interview_id: number | null; session_id: number | null;
  status: 'pending' | 'assigned' | 'ignored'; message_count: number;
  last_inbound_at: string | null; last_message_at: string | null; created_at: string; updated_at: string;
}

interface PendingRow {
  id: number; uid: string; external_message_id: string; direction: 'in' | 'out'; kind: 'text' | 'voice';
  text_enc: string; sent_at: string;
}

/** One message as the thread store takes it: from a webhook, a transcribed voice note, or a reply Axal sent. */
export interface ThreadMessageInput {
  externalChatId: string;
  externalMessageId: string;
  side: MessageSide;
  contactName: string | null;
  text: string;
  kind: 'text' | 'voice';
  sentAt: string;
  /**
   * 'provider' (default): it came in on a webhook. 'axal': a reply Axal just
   * sent, recorded by the reply route. A provider copy of an Axal reply (a
   * 'me' message whose id is in channel_outbound) is a duplicate.
   */
  origin?: 'provider' | 'axal';
}

export type StoreOutcome =
  | { stored: 'pending'; thread: ThreadRow }
  | { stored: 'session'; thread: ThreadRow; sessionId: number }
  | { stored: 'ignored'; thread: ThreadRow }
  | { stored: 'duplicate'; thread: ThreadRow }
  | { stored: 'empty'; thread: ThreadRow | null };

const MSG_TABLE = 'channel_thread_messages';
const THREAD_TABLE = 'channel_threads';

const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);
const isoOr = (s: string, fallback: string) => (Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : fallback);

export function messageFromInbound(msg: InboundMessage, transcribed?: string | null): ThreadMessageInput {
  return {
    externalChatId: msg.externalChatId,
    externalMessageId: msg.externalMessageId,
    side: msg.side,
    contactName: msg.contactName,
    text: transcribed ?? msg.text ?? '',
    kind: msg.voice && transcribed != null ? 'voice' : 'text',
    sentAt: msg.sentAt,
  };
}

async function contactName(env: Env, t: Pick<ThreadRow, 'uid' | 'contact_name_enc'>): Promise<string | null> {
  return decryptColumn(env, THREAD_TABLE, 'contact_name_enc', t.uid, t.contact_name_enc);
}

/** The transcript speaker for a message: 'Me' for the member, the interviewee for their contact. */
function speaker(side: MessageSide | 'in' | 'out', intervieweeName: string | null, contact: string | null): string {
  if (side === 'me' || side === 'out') return 'Me';
  return clip(intervieweeName, 80) || clip(contact, 80) || 'Interviewee';
}

/** The thread for a chat on a connection, created pending on first sight. */
export async function upsertThread(
  env: Env, conn: ChannelConnection, externalChatId: string, name: string | null,
): Promise<ThreadRow> {
  const chat = clip(externalChatId, 200);
  if (!chat) throw new IntakeError(400, 'chat_required', 'The message had no conversation id.');
  const cleanName = clip(name, CHANNEL_LIMITS.maxNameChars) || null;
  const existing = await env.DB.prepare(`SELECT * FROM channel_threads WHERE integration_id = ? AND external_chat_id = ?`)
    .bind(conn.integrationId, chat).first<ThreadRow>();
  if (existing) {
    if (cleanName && cleanName !== (await contactName(env, existing))) {
      const enc = await encryptColumn(env, THREAD_TABLE, 'contact_name_enc', existing.uid, cleanName);
      await env.DB.prepare(`UPDATE channel_threads SET contact_name_enc = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(enc, existing.id).run();
      existing.contact_name_enc = enc;
    }
    return existing;
  }
  const uid = crypto.randomUUID();
  const enc = cleanName ? await encryptColumn(env, THREAD_TABLE, 'contact_name_enc', uid, cleanName) : null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_threads (uid, provider, integration_id, user_id, external_chat_id, contact_name_enc)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(uid, conn.provider, conn.integrationId, conn.userId, chat, enc).run();
  // A concurrent first message may have won the insert; either way this is the row.
  const row = await env.DB.prepare(`SELECT * FROM channel_threads WHERE integration_id = ? AND external_chat_id = ?`)
    .bind(conn.integrationId, chat).first<ThreadRow>();
  if (!row) throw new IntakeError(500, 'not_stored', 'The conversation could not be stored.');
  return row;
}

/** Back to pending: the interview or session the thread pointed at is gone, or no longer the member's. */
async function detach(env: Env, thread: ThreadRow): Promise<ThreadRow> {
  await env.DB.prepare(
    `UPDATE channel_threads SET status = 'pending', interview_id = NULL, session_id = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).bind(thread.id).run();
  return { ...thread, status: 'pending', interview_id: null, session_id: null };
}

async function storePending(env: Env, thread: ThreadRow, m: ThreadMessageInput, text: string): Promise<boolean> {
  const uid = crypto.randomUUID();
  const enc = await encryptColumn(env, MSG_TABLE, 'text_enc', uid, text);
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_thread_messages (uid, thread_id, external_message_id, direction, kind, text_enc, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, thread.id, await refKey(thread.provider, m.externalMessageId), m.side === 'me' ? 'out' : 'in', m.kind, enc,
    isoOr(m.sentAt, new Date().toISOString())).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/**
 * Store one message on the connection's thread for its chat. Tenancy is the
 * connection's (resolved by `connections.ts` from the webhook's connection id,
 * never from the payload); the event's dedupe is the caller's `claimEvent`,
 * and UNIQUE(thread_id, external_message_id) backs it for pending messages.
 */
export async function storeMessage(env: Env, conn: ChannelConnection, m: ThreadMessageInput): Promise<StoreOutcome> {
  // An inactive or deleted account keeps nothing, pending or not.
  await activeMember(env, conn.userId);
  const text = clip(m.text, CHANNEL_LIMITS.maxTextChars);
  let thread = await upsertThread(env, conn, m.externalChatId, m.side === 'contact' ? m.contactName : null);
  if (!text) return { stored: 'empty', thread };
  if (thread.status === 'ignored') return { stored: 'ignored', thread };
  if (m.side === 'me' && m.origin !== 'axal' && await isOurSend(env, conn.provider, m.externalMessageId)) {
    return { stored: 'duplicate', thread };
  }

  const now = new Date().toISOString();
  const bump = env.DB.prepare(
    `UPDATE channel_threads
        SET message_count = message_count + 1, last_message_at = ?,
            last_inbound_at = CASE WHEN ? = 'contact' THEN ? ELSE last_inbound_at END, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(now, m.side, now, thread.id);

  if (thread.status === 'assigned' && thread.session_id && thread.interview_id) {
    try {
      const { interview } = await writableInterview(env, conn.userId, Number(thread.interview_id));
      const seg: StoredSegment = {
        start_ms: null, end_ms: null, speaker_raw: null, text,
        speaker_label: speaker(m.side, interview.interviewee_name, m.contactName ?? (await contactName(env, thread))),
      };
      await appendSegments(env, conn.userId, Number(thread.session_id), [seg], conn.provider, [bump]);
      return { stored: 'session', thread, sessionId: Number(thread.session_id) };
    } catch (err) {
      // The interview or session went away, or the venture is no longer the
      // member's: keep the message, but pending, for the member to place again.
      if (!(err instanceof IntakeError) || err.status !== 404) throw err;
      thread = await detach(env, thread);
    }
  }

  const inserted = await storePending(env, thread, m, text);
  if (!inserted) return { stored: 'duplicate', thread };
  await bump.run();
  return { stored: 'pending', thread };
}

/** Convenience for adapters: a normalised inbound message (text, or a voice note's transcript). */
export function storeInbound(env: Env, conn: ChannelConnection, msg: InboundMessage, transcribed?: string | null) {
  return storeMessage(env, conn, messageFromInbound(msg, transcribed));
}

async function threadForChat(env: Env, conn: ChannelConnection, externalChatId: string): Promise<ThreadRow | null> {
  return (await env.DB.prepare(`SELECT * FROM channel_threads WHERE integration_id = ? AND external_chat_id = ?`)
    .bind(conn.integrationId, clip(externalChatId, 200)).first<ThreadRow>()) ?? null;
}

/** An edit at the source replaces a pending message's text. False when there is no pending copy. */
export async function applyEdit(env: Env, conn: ChannelConnection, edit: InboundEdit): Promise<boolean> {
  const thread = await threadForChat(env, conn, edit.externalChatId);
  if (!thread || thread.status !== 'pending') return false;
  const row = await env.DB.prepare(`SELECT uid FROM channel_thread_messages WHERE thread_id = ? AND external_message_id = ?`)
    .bind(thread.id, await refKey(thread.provider, edit.externalMessageId)).first<{ uid: string }>();
  const text = clip(edit.text, CHANNEL_LIMITS.maxTextChars);
  if (!row || !text) return false;
  const enc = await encryptColumn(env, MSG_TABLE, 'text_enc', row.uid, text);
  await env.DB.prepare(`UPDATE channel_thread_messages SET text_enc = ?, updated_at = datetime('now') WHERE uid = ?`).bind(enc, row.uid).run();
  return true;
}

/** Deletion at the source removes pending copies. Returns how many were removed. */
export async function applyDelete(env: Env, conn: ChannelConnection, del: InboundDelete): Promise<number> {
  const thread = await threadForChat(env, conn, del.externalChatId);
  if (!thread || thread.status !== 'pending') return 0;
  let removed = 0;
  for (const id of del.externalMessageIds.slice(0, 100)) {
    const res = await env.DB.prepare(`DELETE FROM channel_thread_messages WHERE thread_id = ? AND external_message_id = ?`)
      .bind(thread.id, await refKey(thread.provider, id)).run();
    removed += Number(res.meta?.changes ?? 0);
  }
  if (removed) {
    await env.DB.prepare(
      `UPDATE channel_threads SET message_count = MAX(0, message_count - ?), updated_at = datetime('now') WHERE id = ?`,
    ).bind(removed, thread.id).run();
  }
  return removed;
}

async function memberThread(env: Env, userId: number, threadUid: string): Promise<ThreadRow> {
  const row = await env.DB.prepare(`SELECT * FROM channel_threads WHERE uid = ? AND user_id = ?`)
    .bind(String(threadUid ?? ''), userId).first<ThreadRow>();
  if (!row) throw new IntakeError(404, 'thread_not_found', 'That conversation no longer exists.');
  return row;
}

export type AssignTarget = { interviewId: number } | { projectId: number; intervieweeName: string };

/**
 * Put a conversation into an interview. The pending messages become the first
 * segments of a new Text session there, marked with the channel, and are
 * deleted from the pending store in the same batch. Assigning an assigned
 * thread to the SAME interview is a no-op; to a different one, a new session
 * starts there and later messages follow it (earlier ones stay where they are).
 */
export async function assignThread(
  env: Env, userId: number, threadUid: string, target: AssignTarget,
): Promise<{ interviewId: number; sessionId: number; moved: number }> {
  const thread = await memberThread(env, userId, threadUid);
  const interviewId = 'interviewId' in target
    ? Number(target.interviewId)
    : await createInterview(env, userId, Number(target.projectId), target.intervieweeName);
  const scoped: ScopedInterview = await writableInterview(env, userId, interviewId);

  if (thread.status === 'assigned' && Number(thread.interview_id) === interviewId && thread.session_id) {
    return { interviewId, sessionId: Number(thread.session_id), moved: 0 };
  }
  // An assignment in flight (claimed, no session yet). One that died mid-way
  // frees itself after a minute.
  if (thread.status === 'assigned' && !thread.session_id
      && Date.now() - Date.parse(`${thread.updated_at.replace(' ', 'T')}Z`) < 60_000) {
    throw new IntakeError(409, 'thread_busy', 'That conversation is being assigned. Try again in a minute.');
  }

  // Claim the thread as it was read: of two concurrent assigns, one claim matches.
  const claim = await env.DB.prepare(
    `UPDATE channel_threads SET status = 'assigned', interview_id = ?, session_id = NULL, updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status = ? AND interview_id IS ? AND session_id IS ? RETURNING id`,
  ).bind(interviewId, thread.id, userId, thread.status, thread.interview_id, thread.session_id).first<{ id: number }>();
  if (!claim) throw new IntakeError(409, 'thread_busy', 'That conversation changed while you were assigning it. Try again.');

  let opened: number | null = null;
  try {
    const session = await openSession(env, scoped, thread.provider, 'text');
    opened = session.id;
    const name = await contactName(env, thread);
    let moved = 0;
    // Messages may land pending while the session opens; sweep until none are left.
    for (let pass = 0; pass < 3; pass++) {
      const rows = (await env.DB.prepare(
        `SELECT id, uid, external_message_id, direction, kind, text_enc, sent_at FROM channel_thread_messages
          WHERE thread_id = ? ORDER BY sent_at, id LIMIT 2000`,
      ).bind(thread.id).all<PendingRow>()).results ?? [];
      if (pass > 0 && !rows.length) break;
      const setSession = env.DB.prepare(
        `UPDATE channel_threads SET session_id = ?, updated_at = datetime('now') WHERE id = ?`,
      ).bind(session.id, thread.id);
      const segments: StoredSegment[] = [];
      for (const r of rows) {
        const text = await decryptColumn(env, MSG_TABLE, 'text_enc', r.uid, r.text_enc);
        if (!text) continue;
        segments.push({
          start_ms: null, end_ms: null, speaker_raw: null, text,
          speaker_label: speaker(r.direction, scoped.interview.interviewee_name, name),
        });
      }
      const drop = rows.map((r) => env.DB.prepare(`DELETE FROM channel_thread_messages WHERE id = ?`).bind(r.id));
      moved += await appendSegments(env, userId, session.id, segments, thread.provider, [...drop, setSession]);
    }
    // The chat's text is in the interview: the Worker AI proposes its findings
    // now; later messages are picked up by the quiet-chat sweep.
    if (moved > 0) await enqueueSessionStructure(env, session.id, userId, 'chat_assigned');
    return { interviewId, sessionId: session.id, moved };
  } catch (err) {
    // If the first move never landed, nothing moved (each move is one batch
    // with its deletion): release the claim and drop the empty session.
    const released = await env.DB.prepare(
      `UPDATE channel_threads SET status = ?, interview_id = ?, session_id = ?, updated_at = datetime('now')
        WHERE id = ? AND session_id IS NULL RETURNING id`,
    ).bind(thread.status, thread.interview_id, thread.session_id, thread.id).first();
    if (released && opened) {
      await env.DB.prepare(
        `DELETE FROM interview_sessions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ?)`,
      ).bind(opened, opened).run();
    }
    throw err;
  }
}

/** Ignore a conversation (its pending messages are deleted, later ones dropped), or stop ignoring it. */
export async function setThreadIgnored(env: Env, userId: number, threadUid: string, ignored: boolean): Promise<ThreadRow> {
  const thread = await memberThread(env, userId, threadUid);
  if (ignored) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM channel_thread_messages WHERE thread_id = ?`).bind(thread.id),
      env.DB.prepare(
        `UPDATE channel_threads SET status = 'ignored', interview_id = NULL, session_id = NULL, message_count = 0,
                updated_at = datetime('now') WHERE id = ?`,
      ).bind(thread.id),
    ]);
  } else if (thread.status === 'ignored') {
    await env.DB.prepare(`UPDATE channel_threads SET status = 'pending', updated_at = datetime('now') WHERE id = ?`).bind(thread.id).run();
  }
  return memberThread(env, userId, threadUid);
}

export interface ThreadView {
  uid: string; provider: MessagingProvider; contact_name: string | null; status: ThreadRow['status'];
  message_count: number; last_message_at: string | null; last_inbound_at: string | null;
  interview_id: number | null; interviewee_name: string | null; session_id: number | null; can_reply: boolean;
  /** Whether a free-form reply is allowed now (CHANNEL_LIMITS.replyWindowMs). */
  reply_window_open: boolean;
}

async function view(env: Env, t: ThreadRow & { interviewee_name?: string | null }, canReply: boolean): Promise<ThreadView> {
  // WhatsApp counts from the customer's last message; Telegram from the chat's last activity.
  const since = t.provider === 'whatsapp' ? t.last_inbound_at : t.last_message_at;
  const last = since ? Date.parse(since) : NaN;
  return {
    uid: t.uid, provider: t.provider, contact_name: await contactName(env, t), status: t.status,
    message_count: Number(t.message_count) || 0, last_message_at: t.last_message_at, last_inbound_at: t.last_inbound_at,
    interview_id: t.interview_id, interviewee_name: t.interviewee_name ?? null, session_id: t.session_id,
    can_reply: canReply,
    reply_window_open: canReply && Number.isFinite(last) && Date.now() - last < CHANNEL_LIMITS.replyWindowMs,
  };
}

async function replyRights(env: Env, userId: number): Promise<Record<MessagingProvider, boolean>> {
  const tg = await env.DB.prepare(
    `SELECT MAX(can_reply) AS r FROM telegram_business_connections WHERE user_id = ? AND is_enabled = 1`,
  ).bind(userId).first<{ r: number | null }>();
  return { telegram: !!tg?.r, whatsapp: true };
}

/** The member's conversations, newest first. */
export async function listThreads(
  env: Env, userId: number, opts: { status?: ThreadRow['status']; limit?: number } = {},
): Promise<ThreadView[]> {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const status = opts.status ?? null;
  const rows = (await env.DB.prepare(
    `SELECT t.*, di.interviewee_name FROM channel_threads t
       JOIN integrations i ON i.id = t.integration_id AND i.status = 'active'
       LEFT JOIN discovery_interviews di ON di.id = t.interview_id
      WHERE t.user_id = ? AND (? IS NULL OR t.status = ?)
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT ?`,
  ).bind(userId, status, status, limit).all<ThreadRow & { interviewee_name: string | null }>()).results ?? [];
  const rights = await replyRights(env, userId);
  return Promise.all(rows.map((t) => view(env, t, rights[t.provider])));
}

/** One conversation and, while it is pending, its messages (decrypted for the member only). */
export async function readThread(env: Env, userId: number, threadUid: string): Promise<{
  thread: ThreadView;
  messages: { uid: string; side: MessageSide; kind: 'text' | 'voice'; text: string | null; sent_at: string }[];
}> {
  const t = await memberThread(env, userId, threadUid);
  const interview = t.interview_id
    ? await env.DB.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?').bind(t.interview_id).first<{ interviewee_name: string }>()
    : null;
  const rights = await replyRights(env, userId);
  const rows = (await env.DB.prepare(
    `SELECT id, uid, external_message_id, direction, kind, text_enc, sent_at FROM channel_thread_messages
      WHERE thread_id = ? ORDER BY sent_at, id LIMIT 500`,
  ).bind(t.id).all<PendingRow>()).results ?? [];
  const messages = await Promise.all(rows.map(async (r) => ({
    uid: r.uid,
    side: (r.direction === 'out' ? 'me' : 'contact') as MessageSide,
    kind: r.kind,
    text: await decryptColumn(env, MSG_TABLE, 'text_enc', r.uid, r.text_enc),
    sent_at: r.sent_at,
  })));
  return { thread: await view(env, { ...t, interviewee_name: interview?.interviewee_name ?? null }, rights[t.provider]), messages };
}

/** The member's thread for sending a reply, with the chat id the adapter needs. Internal: never returned to the browser. */
export async function threadForReply(env: Env, userId: number, threadUid: string): Promise<ThreadRow> {
  return memberThread(env, userId, threadUid);
}

/**
 * A connection was disconnected: its conversations go. What was already
 * assigned stays in the interviews it was assigned to.
 */
export async function forgetConnection(env: Env, integrationId: number): Promise<number> {
  const res = await env.DB.prepare(`DELETE FROM channel_threads WHERE integration_id = ?`).bind(integrationId).run();
  return Number(res.meta?.changes ?? 0);
}

/**
 * The retention sweep (daily cron). Pending and ignored conversations whose
 * last message is older than CHANNEL_LIMITS.pendingDays go with their
 * messages; spent link codes after a day; event ids after 90 days.
 */
export async function purgeExpired(env: Env, now = new Date()): Promise<{ threads: number; messages: number; codes: number; events: number }> {
  const cutoff = new Date(now.getTime() - CHANNEL_LIMITS.pendingDays * 86_400_000).toISOString();
  const day = new Date(now.getTime() - 86_400_000).toISOString();
  const events = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const [msgs, threads, codes, evs] = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM channel_thread_messages WHERE datetime(sent_at) < datetime(?)
          AND thread_id IN (SELECT id FROM channel_threads WHERE status = 'pending')`,
    ).bind(cutoff),
    env.DB.prepare(
      `DELETE FROM channel_threads WHERE status IN ('pending', 'ignored')
          AND datetime(COALESCE(last_message_at, created_at)) < datetime(?)
          AND NOT EXISTS (SELECT 1 FROM channel_thread_messages m WHERE m.thread_id = channel_threads.id)`,
    ).bind(cutoff),
    env.DB.prepare(
      `DELETE FROM channel_link_codes WHERE (used_at IS NOT NULL OR datetime(expires_at) < datetime(?))
          AND datetime(created_at) < datetime(?)`,
    ).bind(now.toISOString(), day),
    env.DB.prepare(`DELETE FROM channel_events WHERE datetime(created_at) < datetime(?)`).bind(events),
  ]);
  return {
    messages: Number(msgs.meta?.changes ?? 0), threads: Number(threads.meta?.changes ?? 0),
    codes: Number(codes.meta?.changes ?? 0), events: Number(evs.meta?.changes ?? 0),
  };
}
