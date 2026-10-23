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
 *            The thread stays as a tombstone — ids, no text — for as long as
 *            the contact keeps writing, so the ignore holds.
 * Pending messages are purged after CHANNEL_LIMITS.pendingDays.
 *
 * VOICE NOTES SPEND NOTHING UNTIL THE MEMBER CHOOSES THE CHAT. A voice note
 * arrives as a placeholder: kind 'voice', no text, its duration, and the
 * provider's file ref encrypted (`voice_ref_enc`, migration 451). Only a note
 * on a chat in an interview is transcribed — on arrival, or, for a chat still
 * pending, when the member assigns it (`queueVoiceTranscriptions`) — under the
 * connection's daily cap and the member's AI budget. A stranger who writes in
 * can therefore never run the model on the member's account.
 *
 * Edits and deletions at the source change a PENDING message. Once a message
 * is in an interview the transcript is the member's record: they edit it there.
 *
 * A CHAT WAITS FOR CONSENT WHERE ITS PROVIDER ASKS FOR IT (D754 §4, #1893;
 * `consentRequired`, WhatsApp today). Assigning such a chat links it to its
 * interview and opens the draft session, and nothing more: its text stays in
 * the pending store and its voice notes stay placeholders, never fetched,
 * until `consent_state` is 'given' (consent.ts). Then `admitConsentedThread`
 * moves what waited. A decline deletes what waited and sets the chat aside; a
 * withdrawal sets it aside so nothing new is kept.
 *
 * A TELEGRAM CHAT'S NOTES WAIT FOR CONSENT; ITS TEXT DOES NOT (D756 §1.5,
 * #1977; `audioConsentRequired`). Its text keeps D684's rule, and its voice
 * notes are queued only once its `consent_state` is 'given'. A consent given
 * while the chat is pending waits on the thread and is copied to the session
 * at assignment; a NO keeps the notes held, and a STOP stops further
 * downloads, without setting the chat aside. D757 (#1930) additionally clears
 * the digest on NO/STOP and stops new digest runs on the declined session; raw
 * text is still kept, and initial audio consent never gates admitted final text.
 *
 * Final text queues D757's engine (chat_text_added); voice notes keep their own
 * consent gate. Inbox reads show the linked digest state and pending suggestions.
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
import { enqueueChannelJob } from './jobs';
import { isOurSend } from './outbound';
import { expireCapturesStatements } from './whatsappCapture';
import { discardExpiredDrafts, expireCapturesStatements as expireTelegramCapturesStatements } from './telegramCapture';
import {
  CHANNEL_LIMITS, audioConsentRequired, consentAsked, consentRequired, consentRequiredProviders, type InboundDelete, type InboundEdit, type InboundMessage, type MessageSide,
  type MessagingProvider, type VoiceMedia,
} from './types';
import { deleteSession, dropInterviewMadeFor, type SessionRow } from '../interviewSessions';

export interface ThreadRow {
  id: number; uid: string; provider: MessagingProvider; integration_id: number; user_id: number;
  external_chat_id: string; contact_name_enc: string | null; interview_id: number | null; session_id: number | null;
  status: 'pending' | 'assigned' | 'ignored'; message_count: number;
  last_inbound_at: string | null; last_message_at: string | null; created_at: string; updated_at: string;
  /** D754 (migration 488): NULL where the provider asks for no consent. */
  consent_state?: ConsentState | null;
}

export type ConsentState = 'awaiting' | 'given' | 'declined' | 'withdrawn';

interface PendingRow {
  id: number; uid: string; external_message_id: string; direction: 'in' | 'out'; kind: 'text' | 'voice';
  text_enc: string; sent_at: string;
  /** Non-null: a voice note waiting for its transcript (its `text_enc` is ''). */
  voice_ref_enc: string | null; duration_sec: number | null;
}

/** Rows an assignment moves per batch, and batches before it stops (what is left is swept by the next assignment, and purged at 30 days regardless). */
const MOVE_BATCH = 2000;
const MOVE_PASSES = 50;

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

/**
 * Who a sentence about a chat names: the linked interview's interviewee, then
 * the contact's own name, else null (the caller says "This contact").
 */
export async function intervieweeLabel(env: Env, t: ThreadRow): Promise<string | null> {
  const iv = t.interview_id
    ? await env.DB.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?').bind(t.interview_id).first<{ interviewee_name: string | null }>()
    : null;
  return clip(iv?.interviewee_name, 80) || clip(await contactName(env, t), 80) || null;
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

/** Whether a thread is linked to an interview session (it may still be waiting for consent). */
const linked = (t: Pick<ThreadRow, 'status' | 'session_id' | 'interview_id'>): boolean =>
  t.status === 'assigned' && !!t.session_id && !!t.interview_id;

/**
 * Whether a thread's messages go straight into an interview session: it is
 * linked and, where its provider asks for consent, the consent is given
 * (D754 §4). This one test keeps a waiting chat's text and voice notes
 * pending: `storeMessage`, the webhook's voice queue and
 * `storeVoiceTranscript` all ask it.
 */
export const inInterview = (t: Pick<ThreadRow, 'status' | 'session_id' | 'interview_id' | 'provider' | 'consent_state'>): boolean =>
  linked(t) && (!consentRequired(t.provider) || t.consent_state === 'given');

/**
 * D754 §4: a chat whose consent was withdrawn keeps nothing new, as an ignored
 * one. A Telegram STOP stops downloads only (D756 §1.5): its text still flows.
 */
const keepsNothing = (t: Pick<ThreadRow, 'status' | 'consent_state' | 'provider'>): boolean =>
  t.status === 'ignored' || (consentRequired(t.provider) && t.consent_state === 'withdrawn');

/**
 * #1895 decision 3 (D756): whether a free-form message may go now, counted
 * from the contact's last message. A contact who never wrote means closed.
 */
export function replyWindowOpen(t: Pick<ThreadRow, 'last_inbound_at'>, now = Date.now()): boolean {
  const s = t.last_inbound_at;
  const last = s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN;
  return Number.isFinite(last) && now - last < CHANNEL_LIMITS.replyWindowMs;
}

/**
 * The thread's counters for one more message. With `onlyIfRow`, they move
 * only if the pending row of that uid exists — i.e. only if the INSERT before
 * it in the same batch went in.
 */
function bumpStatement(env: Env, threadId: number, side: MessageSide, onlyIfRow: string | null = null): D1PreparedStatement {
  const now = new Date().toISOString();
  return env.DB.prepare(
    `UPDATE channel_threads
        SET message_count = message_count + 1, last_message_at = ?,
            last_inbound_at = CASE WHEN ? = 'contact' THEN ? ELSE last_inbound_at END, updated_at = datetime('now')
      WHERE id = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM channel_thread_messages WHERE uid = ?))`,
  ).bind(now, side, now, threadId, onlyIfRow, onlyIfRow);
}

/**
 * A message arrived on an ignored chat. Nothing of it is kept, but the
 * tombstone records that the chat is still active (`updated_at`): the purge
 * takes an ignored thread only once it has been quiet for
 * CHANNEL_LIMITS.pendingDays, so the ignore cannot lapse while the contact
 * keeps writing (which would let their next message reopen the chat as
 * pending, its text kept).
 */
async function heardOnIgnored(env: Env, thread: ThreadRow): Promise<void> {
  await env.DB.prepare(`UPDATE channel_threads SET updated_at = datetime('now') WHERE id = ? AND status = 'ignored'`)
    .bind(thread.id).run();
}

interface NewPending {
  uid: string; externalMessageId: string; side: MessageSide; kind: 'text' | 'voice'; textEnc: string; sentAt: string;
  voiceRefEnc?: string | null; durationSec?: number | null;
}

/**
 * One pending row and the thread's counters, in one batch. A redelivery
 * (UNIQUE(thread_id, external_message_id)) counts nothing, and a failure
 * takes both with it, so the provider's retry applies both.
 */
async function insertPending(env: Env, thread: ThreadRow, p: NewPending): Promise<boolean> {
  const ref = await refKey(thread.provider, p.externalMessageId);
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO channel_thread_messages
         (uid, thread_id, external_message_id, direction, kind, text_enc, sent_at, voice_ref_enc, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(p.uid, thread.id, ref, p.side === 'me' ? 'out' : 'in', p.kind, p.textEnc, isoOr(p.sentAt, new Date().toISOString()),
      p.voiceRefEnc ?? null, p.durationSec ?? null),
    bumpStatement(env, thread.id, p.side, p.uid),
  ]);
  return Number(ins?.meta?.changes ?? 0) > 0;
}

/** Final chat text reaches only the engine; withdrawal never queues a new run. */
async function enqueueTextDigest(env: Env, sessionId: number, userId: number): Promise<void> {
  try {
    const { enqueueDigest } = await import('../validateEngine');
    await enqueueDigest(env, sessionId, userId, 'chat_text_added');
  } catch (err) {
    // Final text is already committed. Keep the webhook successful so it is
    // not appended again; the quiet sweep recovers the transcribed session.
    console.error('[channels] chat digest not queued', err instanceof Error ? err.name : 'error');
  }
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
  if (keepsNothing(thread)) {
    await heardOnIgnored(env, thread);
    return { stored: 'ignored', thread };
  }
  if (m.side === 'me' && m.origin !== 'axal' && await isOurSend(env, conn.provider, conn.userId, m.externalMessageId)) {
    return { stored: 'duplicate', thread };
  }

  if (inInterview(thread)) {
    try {
      const { interview } = await writableInterview(env, conn.userId, Number(thread.interview_id));
      const seg: StoredSegment = {
        start_ms: null, end_ms: null, speaker_raw: null, text,
        speaker_label: speaker(m.side, interview.interviewee_name, m.contactName ?? (await contactName(env, thread))),
      };
      await appendSegments(env, conn.userId, Number(thread.session_id), [seg], conn.provider, [bumpStatement(env, thread.id, m.side)]);
      if (m.kind === 'text') await enqueueTextDigest(env, Number(thread.session_id), conn.userId);
      return { stored: 'session', thread, sessionId: Number(thread.session_id) };
    } catch (err) {
      // The interview or session went away, or the venture is no longer the
      // member's: keep the message, but pending, for the member to place again.
      if (!(err instanceof IntakeError) || err.status !== 404) throw err;
      thread = await detach(env, thread);
    }
  }

  const uid = crypto.randomUUID();
  const inserted = await insertPending(env, thread, {
    uid, externalMessageId: m.externalMessageId, side: m.side, kind: m.kind, sentAt: m.sentAt,
    textEnc: await encryptColumn(env, MSG_TABLE, 'text_enc', uid, text),
  });
  if (!inserted) return { stored: 'duplicate', thread };
  return { stored: 'pending', thread };
}

export type VoiceArrival =
  | { stored: 'voice'; thread: ThreadRow; messageUid: string }
  | { stored: 'ignored' | 'duplicate'; thread: ThreadRow };

/**
 * A voice note as it arrives: a placeholder on its thread (header), never a
 * transcription. The caller queues the transcription when the thread is in an
 * interview (`queueVoiceTranscriptions`); a pending chat's note waits for the
 * member to assign it.
 */
export async function storeVoiceNote(env: Env, conn: ChannelConnection, msg: InboundMessage): Promise<VoiceArrival> {
  if (!msg.voice) throw new IntakeError(400, 'voice_required', 'The message had no voice note.');
  await activeMember(env, conn.userId);
  const thread = await upsertThread(env, conn, msg.externalChatId, msg.side === 'contact' ? msg.contactName : null);
  if (keepsNothing(thread)) {
    await heardOnIgnored(env, thread);
    return { stored: 'ignored', thread };
  }
  const uid = crypto.randomUUID();
  const d = msg.voice.durationSec;
  const inserted = await insertPending(env, thread, {
    uid, externalMessageId: msg.externalMessageId, side: msg.side, kind: 'voice', textEnc: '', sentAt: msg.sentAt,
    voiceRefEnc: await encryptColumn(env, MSG_TABLE, 'voice_ref_enc', uid, JSON.stringify({
      file: msg.voice.fileRef, mime: msg.voice.mime, media: msg.voice.media ?? 'voice', size: msg.voice.sizeBytes ?? null,
    })),
    durationSec: d != null && Number.isFinite(Number(d)) ? Math.max(0, Math.round(Number(d))) : null,
  });
  return inserted ? { stored: 'voice', thread, messageUid: uid } : { stored: 'duplicate', thread };
}

/**
 * Queue the transcription of a thread's waiting voice notes — only while the
 * thread is in an interview. Each note is first claimed for one job
 * (`transcribe_job`), so an assignment repeated, or a webhook and an
 * assignment at once, never queue one note twice; a claim an hour old is
 * taken to be a job that was lost. At most a day's cap of notes per call (the
 * rest wait for the next assignment). The job carries ids only: the file ref
 * stays encrypted on its row. Returns how many were queued.
 */
export async function queueVoiceTranscriptions(
  env: Env, thread: ThreadRow, opts: { only?: string; event?: number | null } = {},
): Promise<number> {
  if (!inInterview(thread)) return 0;
  // D754 §4, said twice on purpose: a chat that waits for consent queues nothing without it.
  // D756 §1.5: nor does a Telegram chat, whose text flows but whose notes wait for its YES.
  if (audioConsentRequired(thread.provider) && thread.consent_state !== 'given') return 0;
  const only = opts.only ?? null;
  const rows = (await env.DB.prepare(
    `SELECT uid FROM channel_thread_messages
      WHERE thread_id = ? AND voice_ref_enc IS NOT NULL AND (? IS NULL OR uid = ?)
        AND (transcribe_error IS NULL OR transcribe_error != 'expired')
      ORDER BY sent_at, id LIMIT ?`,
  ).bind(thread.id, only, only, CHANNEL_LIMITS.transcriptionsPerDay).all<{ uid: string }>()).results ?? [];
  let queued = 0;
  for (const r of rows) {
    const job = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      `UPDATE channel_thread_messages SET transcribe_job = ?, transcribe_error = NULL, updated_at = datetime('now')
        WHERE uid = ? AND voice_ref_enc IS NOT NULL
          AND (transcribe_error IS NULL OR transcribe_error != 'expired')
          AND (transcribe_job IS NULL OR datetime(updated_at) < datetime('now', '-60 minutes'))
        RETURNING id`,
    ).bind(job, r.uid).first<{ id: number }>();
    if (!claimed) continue;
    try {
      await enqueueChannelJob(env, 'channel_followup', thread.provider, job, {
        kind: 'voice', message: r.uid, job, event: opts.event ?? null,
      });
      queued++;
    } catch (err) {
      await releaseVoiceNote(env, r.uid, job).catch(() => {});
      throw err;
    }
  }
  return queued;
}

/**
 * A waiting voice note, as the job that holds it reads it. `media` and `size`
 * (D756, #1896) are the kind and the declared size; a note stored before them
 * reads as a voice note of unknown size.
 */
export interface VoiceJobNote {
  id: number; uid: string; side: MessageSide; file: string; mime: string | null; media: VoiceMedia; size: number | null;
  durationSec: number | null; sentAt: string; thread: ThreadRow;
}

const VOICE_MEDIA: ReadonlySet<string> = new Set<VoiceMedia>(['voice', 'audio', 'video_note']);

/** A waiting note's file ref, decrypted; null when it cannot be read. It never leaves the Worker. */
async function voiceRef(env: Env, uid: string, enc: string): Promise<{ file?: unknown; mime?: unknown; media?: unknown; size?: unknown } | null> {
  try { return JSON.parse((await decryptColumn(env, MSG_TABLE, 'voice_ref_enc', uid, enc)) ?? 'null'); } catch { return null; }
}

/** The note's kind; a note stored before #1896 recorded one reads as a voice note. */
const mediaOf = (ref: { media?: unknown } | null): VoiceMedia =>
  typeof ref?.media === 'string' && VOICE_MEDIA.has(ref.media) ? ref.media as VoiceMedia : 'voice';

/**
 * The note a voice job was queued for, while that job still holds it — or
 * null: transcribed already, deleted at the source, ignored, purged, or held
 * by another job.
 */
export async function voiceNoteForJob(env: Env, messageUid: string, job: string): Promise<VoiceJobNote | null> {
  if (!messageUid || !job) return null;
  const row = await env.DB.prepare(
    `SELECT id, uid, direction, voice_ref_enc, duration_sec, sent_at, thread_id FROM channel_thread_messages
      WHERE uid = ? AND transcribe_job = ? AND voice_ref_enc IS NOT NULL`,
  ).bind(messageUid, job).first<{ id: number; uid: string; direction: 'in' | 'out'; voice_ref_enc: string; duration_sec: number | null; sent_at: string; thread_id: number }>();
  if (!row) return null;
  const thread = await env.DB.prepare('SELECT * FROM channel_threads WHERE id = ?').bind(row.thread_id).first<ThreadRow>();
  const ref = await voiceRef(env, row.uid, row.voice_ref_enc);
  if (!thread || typeof ref?.file !== 'string' || !ref.file) return null;
  return {
    id: Number(row.id), uid: row.uid, side: row.direction === 'out' ? 'me' : 'contact', file: ref.file,
    mime: typeof ref.mime === 'string' ? ref.mime : null,
    media: mediaOf(ref),
    size: Number.isSafeInteger(ref.size) && Number(ref.size) >= 0 ? Number(ref.size) : null,
    durationSec: row.duration_sec, sentAt: row.sent_at, thread,
  };
}

/**
 * The job could not transcribe the note now (the day's cap, the member's
 * budget, a refused download): the next assignment may queue it again. `error`
 * (#1586) is why, as a code, kept on the note so the thread read can say so.
 */
export async function releaseVoiceNote(env: Env, messageUid: string, job: string, error: string | null = null): Promise<void> {
  await env.DB.prepare(`UPDATE channel_thread_messages SET transcribe_job = NULL, transcribe_error = ? WHERE uid = ? AND transcribe_job = ?`)
    .bind(error ? String(error).slice(0, 80) : null, messageUid, job).run();
}

/** #1586: the job still holds the note and will try again; `error` says why the last try failed. */
export async function noteVoiceTry(env: Env, messageUid: string, job: string, error: string): Promise<void> {
  await env.DB.prepare(`UPDATE channel_thread_messages SET transcribe_error = ? WHERE uid = ? AND transcribe_job = ?`)
    .bind(String(error).slice(0, 80), messageUid, job).run();
}

/**
 * A waiting voice note's transcript, stored once. In an interview, the
 * segment is appended and the placeholder deleted in ONE batch, with
 * `alongside` (the job's event record): a retry after that finds no note and
 * does nothing, so nothing is appended or billed twice. If the chat fell back
 * to pending meanwhile (its interview went away), the placeholder becomes an
 * ordinary pending message carrying the text. An empty transcript deletes the
 * placeholder. 'gone': the note was deleted at the source, or the chat ignored,
 * while the model ran — nothing is kept and `alongside` is not run.
 */
export async function storeVoiceTranscript(
  env: Env, conn: ChannelConnection, note: VoiceJobNote, transcript: string, alongside: D1PreparedStatement[] = [],
): Promise<'session' | 'pending' | 'empty' | 'gone'> {
  const still = await env.DB.prepare(`SELECT thread_id FROM channel_thread_messages WHERE id = ? AND uid = ? AND voice_ref_enc IS NOT NULL`)
    .bind(note.id, note.uid).first<{ thread_id: number }>();
  const thread = still ? await env.DB.prepare('SELECT * FROM channel_threads WHERE id = ?').bind(still.thread_id).first<ThreadRow>() : null;
  if (!thread || keepsNothing(thread)) return 'gone';
  const drop = env.DB.prepare(`DELETE FROM channel_thread_messages WHERE id = ?`).bind(note.id);
  const text = clip(transcript, CHANNEL_LIMITS.maxTextChars);
  if (!text) {
    await env.DB.batch([drop, ...alongside]);
    return 'empty';
  }
  if (inInterview(thread)) {
    try {
      const { interview } = await writableInterview(env, conn.userId, Number(thread.interview_id));
      const seg: StoredSegment = {
        start_ms: null, end_ms: null, speaker_raw: null, text,
        speaker_label: speaker(note.side, interview.interviewee_name, await contactName(env, thread)),
      };
      await appendSegments(env, conn.userId, Number(thread.session_id), [seg], conn.provider, [drop, ...alongside]);
      return 'session';
    } catch (err) {
      if (!(err instanceof IntakeError) || err.status !== 404) throw err;
      // The interview is gone: the chat goes back to pending, and the note with it.
      await detach(env, thread);
    }
  }
  const enc = await encryptColumn(env, MSG_TABLE, 'text_enc', note.uid, text);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE channel_thread_messages SET text_enc = ?, voice_ref_enc = NULL, transcribe_job = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).bind(enc, note.id),
    ...alongside,
  ]);
  return 'pending';
}

/** Convenience for adapters: a normalised inbound message (text, or a voice note's transcript). */
export function storeInbound(env: Env, conn: ChannelConnection, msg: InboundMessage, transcribed?: string | null) {
  return storeMessage(env, conn, messageFromInbound(msg, transcribed));
}

export async function threadForChat(env: Env, conn: ChannelConnection, externalChatId: string): Promise<ThreadRow | null> {
  return (await env.DB.prepare(`SELECT * FROM channel_threads WHERE integration_id = ? AND external_chat_id = ?`)
    .bind(conn.integrationId, clip(externalChatId, 200)).first<ThreadRow>()) ?? null;
}

/** An edit at the source replaces a pending message's text. False when there is no pending copy. */
export async function applyEdit(env: Env, conn: ChannelConnection, edit: InboundEdit): Promise<boolean> {
  const thread = await threadForChat(env, conn, edit.externalChatId);
  if (!thread || thread.status !== 'pending') return false;
  // A voice note's placeholder has no text to replace.
  const row = await env.DB.prepare(
    `SELECT uid FROM channel_thread_messages WHERE thread_id = ? AND external_message_id = ? AND voice_ref_enc IS NULL`,
  ).bind(thread.id, await refKey(thread.provider, edit.externalMessageId)).first<{ uid: string }>();
  const text = clip(edit.text, CHANNEL_LIMITS.maxTextChars);
  if (!row || !text) return false;
  const enc = await encryptColumn(env, MSG_TABLE, 'text_enc', row.uid, text);
  await env.DB.prepare(`UPDATE channel_thread_messages SET text_enc = ?, updated_at = datetime('now') WHERE uid = ?`).bind(enc, row.uid).run();
  return true;
}

/**
 * Deletion at the source removes pending copies, whatever the thread's state:
 * every row in `channel_thread_messages` is one — on an assigned chat, a voice
 * note still waiting for its transcript, whose job then finds nothing to
 * transcribe. Returns how many were removed.
 */
export async function applyDelete(env: Env, conn: ChannelConnection, del: InboundDelete): Promise<number> {
  const thread = await threadForChat(env, conn, del.externalChatId);
  if (!thread) return 0;
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

export type AssignTarget = { interviewId: number } | { projectId: number; intervieweeName: string; intervieweeCompany?: string | null };

/**
 * D685 §5.1.4 (#1586) — quote consent for a text chat. The member says the
 * interviewee agreed to be quoted: `discovery_interviews.quote_consent`
 * becomes 1. It is consent to quote, not recording consent; leaving it out
 * changes nothing (NULL stays NULL, and a 1 is never taken back here).
 */
export type AssignOptions = { quoteConsent?: boolean };

export interface AssignResult {
  interviewId: number; sessionId: number; moved: number;
  /** Voice notes queued for transcription now that the chat is in an interview. */
  queued: number;
}

/**
 * D754 §4 decision 8, D756 §1.5: what consent a chat carries into a new link.
 *   given     only within the venture its consent was given for (another
 *             venture is refused: nothing changes). A Telegram chat that
 *             agreed while pending has no venture yet, and takes this one.
 *   awaiting  a WhatsApp chat without it: the whole chat waits again.
 *   keep      a Telegram chat without it: its text keeps D684's rule, and its
 *             consent state (asked, declined, stopped) stays as it is.
 */
async function consentForMove(
  env: Env, thread: ThreadRow, projectId: number,
): Promise<{ state: 'awaiting' | 'keep' } | { state: 'given'; method: string; rowId: number }> {
  const whole = consentRequired(thread.provider);
  const none = { state: whole ? 'awaiting' as const : 'keep' as const };
  if (thread.consent_state !== 'given') return none;
  const row = await env.DB.prepare(
    `SELECT c.id, c.method,
            (SELECT di.project_id FROM discovery_interviews di WHERE di.id = COALESCE(?, c.interview_id)) AS project_id
       FROM channel_consents c
      WHERE c.thread_id = ? AND c.status = 'given' ORDER BY c.id DESC LIMIT 1`,
  ).bind(thread.interview_id, thread.id).first<{ id: number; method: string; project_id: number | null }>();
  if (!row) return none;
  // A WhatsApp consent whose interview is gone has no venture to carry it to.
  if (row.project_id == null && whole) return none;
  if (row.project_id != null && Number(row.project_id) !== Number(projectId)) {
    throw new IntakeError(409, 'consent_other_venture',
      'This chat agreed to be recorded for its venture only. Add it to an interview in the same venture, or ask again after moving it.');
  }
  return { state: 'given', method: row.method, rowId: Number(row.id) };
}

/**
 * Move a thread's pending text into a session, in batches that each delete
 * what they append, until none is left (or MOVE_PASSES batches). `first`
 * joins the first batch even when there is nothing to move: the assignment's
 * `session_id`, so the thread points at its session exactly when the first
 * move lands. Voice notes still waiting for a transcript stay; they are queued.
 */
async function movePending(
  env: Env, userId: number, thread: ThreadRow, sessionId: number, scoped: ScopedInterview, first: D1PreparedStatement[] = [],
): Promise<number> {
  const name = await contactName(env, thread);
  let moved = 0;
  let extra = first;
  for (let pass = 0; pass < MOVE_PASSES; pass++) {
    const rows = (await env.DB.prepare(
      `SELECT id, uid, external_message_id, direction, kind, text_enc, sent_at, voice_ref_enc, duration_sec FROM channel_thread_messages
        WHERE thread_id = ? AND voice_ref_enc IS NULL ORDER BY sent_at, id LIMIT ?`,
    ).bind(thread.id, MOVE_BATCH).all<PendingRow>()).results ?? [];
    if (!rows.length && !extra.length) break;
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
    moved += await appendSegments(env, userId, sessionId, segments, thread.provider, [...drop, ...extra]);
    extra = [];
  }
  return moved;
}

/** Queue the voice notes of a thread now in an interview. Never fails an assignment: the notes wait, and the next assignment queues them. */
async function queueAfterAssign(env: Env, thread: ThreadRow): Promise<number> {
  try {
    return await queueVoiceTranscriptions(env, thread);
  } catch (err) {
    console.error('[channels] voice notes not queued after assignment', err instanceof Error ? err.name : 'error');
    return 0;
  }
}

/** An interview this assignment created, removed again while nothing hangs off it. */
async function dropCreatedInterview(env: Env, interviewId: number): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM discovery_interviews WHERE id = ? AND NOT EXISTS (SELECT 1 FROM interview_sessions WHERE interview_id = ?)`,
  ).bind(interviewId, interviewId).run();
}

/** An assignment in flight (claimed, no session yet). One that died mid-way frees itself after a minute. */
function refuseIfBusy(thread: ThreadRow): void {
  if (thread.status === 'assigned' && !thread.session_id
      && Date.now() - Date.parse(`${thread.updated_at.replace(' ', 'T')}Z`) < 60_000) {
    throw new IntakeError(409, 'thread_busy', 'That conversation is being assigned. Try again in a minute.');
  }
}

/**
 * Put a conversation into an interview. The pending messages become the first
 * segments of a new Text session there, marked with the channel, and are
 * deleted from the pending store in the same batch; its waiting voice notes
 * are queued for transcription. Assigning an assigned thread to the SAME
 * interview moves anything left pending since (a message that landed while an
 * assignment was in flight, or a move cut short) and queues its voice notes;
 * to a different one, a new session starts there and later messages follow it
 * (earlier ones stay where they are).
 *
 * "Create interview from this chat" creates the interview only past the busy
 * check, and removes it again if the claim or the move fails, so a refused or
 * repeated press leaves no empty interview behind.
 */
export async function assignThread(
  env: Env, userId: number, threadUid: string, target: AssignTarget, opts: AssignOptions = {},
): Promise<AssignResult> {
  const r = await assignInto(env, userId, threadUid, target);
  // Recorded only once the assignment has succeeded, on the interview it
  // landed in, which `writableInterview` has checked: a refused assign changes nothing.
  if (opts.quoteConsent === true) {
    await env.DB.prepare('UPDATE discovery_interviews SET quote_consent = 1 WHERE id = ?').bind(r.interviewId).run();
  }
  return r;
}

async function assignInto(env: Env, userId: number, threadUid: string, target: AssignTarget): Promise<AssignResult> {
  const thread = await memberThread(env, userId, threadUid);
  if ('interviewId' in target) {
    const scoped = await writableInterview(env, userId, Number(target.interviewId));
    if (linked(thread) && Number(thread.interview_id) === scoped.interview.id) {
      const sessionId = Number(thread.session_id);
      // D754 decision 8: a chat waiting for consent is already linked here; the press opens nothing new.
      if (!inInterview(thread)) return { interviewId: scoped.interview.id, sessionId, moved: 0, queued: 0 };
      // A repeated assignment can recover text left pending by an interrupted move.
      const moved = await movePending(env, userId, thread, sessionId, scoped);
      if (moved > 0) await enqueueTextDigest(env, sessionId, userId);
      return { interviewId: scoped.interview.id, sessionId, moved, queued: await queueAfterAssign(env, thread) };
    }
    refuseIfBusy(thread);
    return moveInto(env, userId, thread, scoped, null);
  }
  refuseIfBusy(thread);
  // Checked before the interview is created, so a refusal leaves none behind.
  if (consentAsked(thread.provider)) await consentForMove(env, thread, Number(target.projectId));
  const created = await createInterview(env, userId, Number(target.projectId), target.intervieweeName, target.intervieweeCompany ?? null);
  let scoped: ScopedInterview;
  try {
    scoped = await writableInterview(env, userId, created);
  } catch (err) {
    await dropCreatedInterview(env, created).catch(() => {});
    throw err;
  }
  return moveInto(env, userId, thread, scoped, created);
}

async function moveInto(
  env: Env, userId: number, thread: ThreadRow, scoped: ScopedInterview, created: number | null,
): Promise<AssignResult> {
  const interviewId = scoped.interview.id;
  const waits = consentRequired(thread.provider);
  let consent: Awaited<ReturnType<typeof consentForMove>> | null = null;
  if (consentAsked(thread.provider)) {
    try {
      consent = await consentForMove(env, thread, scoped.project.id);
    } catch (err) {
      if (created) await dropCreatedInterview(env, created).catch(() => {});
      throw err;
    }
  }
  // Claim the thread as it was read: of two concurrent assigns, one claim
  // matches. A chat that waits for consent takes its consent state in the
  // same claim (D754): 'given' within the venture, else 'awaiting'.
  const claim = await env.DB.prepare(
    `UPDATE channel_threads SET status = 'assigned', interview_id = ?, session_id = NULL,
            consent_state = CASE WHEN ? = 1 THEN ? ELSE consent_state END, updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status = ? AND interview_id IS ? AND session_id IS ? RETURNING id`,
  ).bind(interviewId, waits ? 1 : 0, consent && consent.state !== 'keep' ? consent.state : null, thread.id, userId, thread.status,
    thread.interview_id, thread.session_id)
    .first<{ id: number }>();
  if (!claim) {
    if (created) await dropCreatedInterview(env, created).catch(() => {});
    throw new IntakeError(409, 'thread_busy', 'That conversation changed while you were assigning it. Try again.');
  }

  let opened: number | null = null;
  try {
    // Within the venture a consented chat's new session takes its consent; the consent row keeps its first session.
    const session = await openSession(env, scoped, thread.provider, 'text', consent?.state === 'given' ? { method: consent.method } : null);
    opened = session.id;
    const setSession = env.DB.prepare(
      `UPDATE channel_threads SET session_id = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(session.id, thread.id);
    if (consentAsked(thread.provider)) {
      // A request still open was for the chat's old interview: it closes. One
      // made while the chat was pending (Telegram) now belongs to this interview.
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE channel_consents SET status = 'expired', updated_at = datetime('now')
            WHERE thread_id = ? AND status = 'requested' AND ? IS NOT NULL`,
        ).bind(thread.id, thread.interview_id),
        env.DB.prepare(
          `UPDATE channel_consents SET interview_id = ?, session_id = ?, updated_at = datetime('now')
            WHERE thread_id = ? AND status = 'requested' AND interview_id IS NULL`,
        ).bind(interviewId, session.id, thread.id),
      ]);
      // A consent given while pending is copied to its first session; a given row keeps its first session.
      if (consent?.state === 'given') {
        await env.DB.prepare(
          `UPDATE channel_consents SET interview_id = COALESCE(interview_id, ?), session_id = COALESCE(session_id, ?),
                  updated_at = datetime('now') WHERE id = ?`,
        ).bind(interviewId, session.id, consent.rowId).run();
      }
    }
    if (consent?.state === 'awaiting') {
      // D754 §4: linked and waiting. Nothing moves, nothing is structured or queued.
      await setSession.run();
      return { interviewId, sessionId: session.id, moved: 0, queued: 0 };
    }
    // Messages may land pending while the session opens; sweep until none are left.
    const moved = await movePending(env, userId, thread, session.id, scoped, [setSession]);
    // New final text queues the one engine entry; its hash and quiet bound govern re-runs.
    if (moved > 0) await enqueueTextDigest(env, session.id, userId);
    const assigned: ThreadRow = {
      ...thread, status: 'assigned', interview_id: interviewId, session_id: session.id,
      consent_state: waits && consent && consent.state !== 'keep' ? consent.state : thread.consent_state,
    };
    return { interviewId, sessionId: session.id, moved, queued: await queueAfterAssign(env, assigned) };
  } catch (err) {
    // If the first move never landed, nothing moved (each move is one batch
    // with its deletion): release the claim and drop the empty session, and
    // the interview this assignment created for it.
    const released = await env.DB.prepare(
      `UPDATE channel_threads SET status = ?, interview_id = ?, session_id = ?, consent_state = ?, updated_at = datetime('now')
        WHERE id = ? AND session_id IS NULL RETURNING id`,
    ).bind(thread.status, thread.interview_id, thread.session_id, thread.consent_state ?? null, thread.id).first();
    if (released && opened) {
      await env.DB.prepare(
        `DELETE FROM interview_sessions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ?)`,
      ).bind(opened, opened).run();
    }
    if (released && created) await dropCreatedInterview(env, created).catch(() => {});
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

/**
 * D754 §4 — consent is given: move what waited on the chat into its session
 * and queue its voice notes, as an assignment would have. Each step is
 * idempotent (a move deletes what it appends; a note is claimed once), so the
 * webhook's follow-up and the member's own confirmation may both run it.
 */
export async function admitConsentedThread(
  env: Env, userId: number, threadId: number,
): Promise<{ moved: number; queued: number }> {
  const thread = await env.DB.prepare('SELECT * FROM channel_threads WHERE id = ? AND user_id = ?').bind(threadId, userId).first<ThreadRow>();
  if (!thread || !inInterview(thread)) return { moved: 0, queued: 0 };
  const scoped = await writableInterview(env, userId, Number(thread.interview_id));
  const sessionId = Number(thread.session_id);
  const moved = await movePending(env, userId, thread, sessionId, scoped);
  if (moved > 0) await enqueueTextDigest(env, sessionId, userId);
  return { moved, queued: await queueAfterAssign(env, thread) };
}

/**
 * D754 §4 decision 5 — a decline or a withdrawal sets the chat aside, as an
 * ignore does: its waiting copies and placeholders are deleted (a running
 * voice job then finds the note gone), later messages are dropped, and
 * `consent_state` says why. Unrun, for consent.ts to batch with the consent
 * row; `onlyIf` is that row's own guard, so the batch lands whole or not at all.
 */
export function setAsideStatements(
  env: Env, threadId: number, state: 'declined' | 'withdrawn', onlyIf: { consentId: number; replyRef: string },
): D1PreparedStatement[] {
  return [
    env.DB.prepare(`DELETE FROM channel_thread_messages WHERE thread_id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`)
      .bind(threadId, onlyIf.consentId, onlyIf.replyRef, state),
    env.DB.prepare(
      `UPDATE channel_threads SET status = 'ignored', interview_id = NULL, session_id = NULL, message_count = 0, consent_state = ?,
              updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`,
    ).bind(state, threadId, onlyIf.consentId, onlyIf.replyRef, state),
  ];
}

export interface ThreadView {
  uid: string; provider: MessagingProvider; contact_name: string | null; status: ThreadRow['status'];
  message_count: number; last_message_at: string | null; last_inbound_at: string | null;
  interview_id: number | null; interviewee_name: string | null; session_id: number | null; can_reply: boolean;
  /** Whether a free-form reply is allowed now (CHANNEL_LIMITS.replyWindowMs). */
  reply_window_open: boolean;
  /**
   * D754: 'not_asked' | 'awaiting' | 'given' | 'declined' | 'withdrawn' where
   * the provider waits for consent, so the inbox can mark a waiting chat; null elsewhere.
   */
  consent_status: string | null;
  /** D757 (#1930): the linked session's engine state and suggestions still awaiting review. */
  digest_status: SessionRow['digest_status'] | null;
  pending_suggestions: number;
}

type ThreadRead = ThreadRow & { interviewee_name?: string | null; digest_status?: SessionRow['digest_status']; pending_suggestions?: number };

async function view(env: Env, t: ThreadRead, canReply: boolean): Promise<ThreadView> {
  return {
    uid: t.uid, provider: t.provider, contact_name: await contactName(env, t), status: t.status,
    message_count: Number(t.message_count) || 0, last_message_at: t.last_message_at, last_inbound_at: t.last_inbound_at,
    interview_id: t.interview_id, interviewee_name: t.interviewee_name ?? null, session_id: t.session_id,
    can_reply: canReply,
    reply_window_open: canReply && replyWindowOpen(t),
    consent_status: consentAsked(t.provider) ? t.consent_state ?? 'not_asked' : null,
    digest_status: t.digest_status ?? null, pending_suggestions: Number(t.pending_suggestions ?? 0),
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
    `SELECT t.*, di.interviewee_name, s.digest_status,
            (SELECT COUNT(*) FROM validate_proposals vp WHERE vp.session_id = s.id AND vp.status = 'pending') AS pending_suggestions
       FROM channel_threads t
       JOIN integrations i ON i.id = t.integration_id AND i.status = 'active'
       LEFT JOIN discovery_interviews di ON di.id = t.interview_id
       LEFT JOIN interview_sessions s ON s.id = t.session_id AND s.created_by_user_id = t.user_id AND s.interview_id = t.interview_id
      WHERE t.user_id = ? AND (? IS NULL OR t.status = ?)
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT ?`,
  ).bind(userId, status, status, limit).all<ThreadRead>()).results ?? [];
  const rights = await replyRights(env, userId);
  return Promise.all(rows.map((t) => view(env, t, rights[t.provider])));
}

export interface MessageView {
  uid: string; side: MessageSide; kind: 'text' | 'voice'; text: string | null; sent_at: string;
  /**
   * A voice note with no transcript yet (`text` null). On a pending chat it is
   * transcribed when the member assigns the chat; on an assigned one it is
   * queued, or waiting for the next assignment after the day's cap.
   */
  awaiting_transcription: boolean;
  duration_sec: number | null;
  /** D756 §1.12: a waiting note's kind (a voice note, an audio file, a round video); null on text. Only the kind leaves the ref. */
  media: VoiceMedia | null;
}

/** One conversation and, while it is pending, its messages (decrypted for the member only). */
export async function readThread(env: Env, userId: number, threadUid: string): Promise<{ thread: ThreadView; messages: MessageView[] }> {
  const t = await memberThread(env, userId, threadUid);
  const interview = t.interview_id
    ? await env.DB.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?').bind(t.interview_id).first<{ interviewee_name: string }>()
    : null;
  const digest = t.session_id ? await env.DB.prepare(
    `SELECT s.digest_status,
            (SELECT COUNT(*) FROM validate_proposals vp WHERE vp.session_id = s.id AND vp.status = 'pending') AS pending_suggestions
       FROM interview_sessions s WHERE s.id = ? AND s.created_by_user_id = ? AND s.interview_id = ?`,
  ).bind(t.session_id, userId, t.interview_id).first<Pick<ThreadRead, 'digest_status' | 'pending_suggestions'>>() : null;
  const rights = await replyRights(env, userId);
  const rows = (await env.DB.prepare(
    `SELECT id, uid, external_message_id, direction, kind, text_enc, sent_at, voice_ref_enc, duration_sec FROM channel_thread_messages
      WHERE thread_id = ? ORDER BY sent_at, id LIMIT 500`,
  ).bind(t.id).all<PendingRow>()).results ?? [];
  const messages = await Promise.all(rows.map(async (r): Promise<MessageView> => {
    const waiting = r.voice_ref_enc != null;
    return {
      uid: r.uid,
      side: r.direction === 'out' ? 'me' : 'contact',
      kind: r.kind,
      // The file ref never leaves the Worker.
      text: waiting ? null : await decryptColumn(env, MSG_TABLE, 'text_enc', r.uid, r.text_enc),
      sent_at: r.sent_at,
      awaiting_transcription: waiting,
      duration_sec: r.duration_sec == null ? null : Number(r.duration_sec),
      media: r.kind !== 'voice' ? null : waiting ? mediaOf(await voiceRef(env, r.uid, r.voice_ref_enc!)) : 'voice',
    };
  }));
  return { thread: await view(env, { ...t, ...digest, interviewee_name: interview?.interviewee_name ?? null }, rights[t.provider]), messages };
}

/** The member's thread for sending a reply, with the chat id the adapter needs. Internal: never returned to the browser. */
export async function threadForReply(env: Env, userId: number, threadUid: string): Promise<ThreadRow> {
  return memberThread(env, userId, threadUid);
}

/**
 * The empty draft sessions a chat that waits for consent left behind
 * (D754 §7): consent not given, no segment and no chunk, and no thread
 * pointing at them that still holds a waiting copy. `scope` narrows them to a
 * connection's threads, or to drafts older than a cutoff. Each goes through
 * `deleteSession`, and the interview made for it with it.
 */
async function dropEmptyDrafts(env: Env, scope: { integrationId: number } | { before: string }): Promise<number> {
  const providers = JSON.stringify(consentRequiredProviders());
  const byConn = 'integrationId' in scope ? scope.integrationId : null;
  const before = 'before' in scope ? scope.before : null;
  const rows = (await env.DB.prepare(
    `SELECT s.* FROM interview_sessions s
      WHERE s.submitted_via IN (SELECT value FROM json_each(?)) AND s.consent_status <> 'given' AND s.status = 'draft'
        AND NOT EXISTS (SELECT 1 FROM interview_transcript_segments g WHERE g.session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM interview_session_chunks k WHERE k.session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM channel_threads t JOIN channel_thread_messages m ON m.thread_id = t.id WHERE t.session_id = s.id)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM channel_threads t WHERE t.session_id = s.id AND t.integration_id = ?))
        AND (? IS NULL OR datetime(s.created_at) < datetime(?))
      ORDER BY s.id LIMIT 200`,
  ).bind(providers, byConn, byConn, before, before).all<SessionRow>()).results ?? [];
  for (const s of rows) {
    await deleteSession(env, s, Number(s.created_by_user_id));
    await dropInterviewMadeFor(env, Number(s.interview_id), s.created_at);
  }
  return rows.length;
}

/**
 * A connection was disconnected: its conversations go. What was already
 * assigned stays in the interviews it was assigned to. What waited for
 * consent goes first (D754 §7): its open requests, and the empty drafts made
 * for it; a consent given for an interview that stays keeps its row, without
 * the thread.
 */
export async function forgetConnection(env: Env, integrationId: number): Promise<number> {
  await env.DB.prepare(
    `DELETE FROM channel_consents WHERE status = 'requested'
        AND thread_id IN (SELECT id FROM channel_threads WHERE integration_id = ?)`,
  ).bind(integrationId).run();
  await dropEmptyDrafts(env, { integrationId });
  await env.DB.prepare(
    `UPDATE channel_consents SET thread_id = NULL, updated_at = datetime('now')
      WHERE thread_id IN (SELECT id FROM channel_threads WHERE integration_id = ?)`,
  ).bind(integrationId).run();
  const res = await env.DB.prepare(`DELETE FROM channel_threads WHERE integration_id = ?`).bind(integrationId).run();
  return Number(res.meta?.changes ?? 0);
}

/**
 * The retention sweep (daily cron).
 *   messages  every pending copy older than CHANNEL_LIMITS.pendingDays,
 *             whatever its thread's state: a row here is always a pending
 *             copy — on a pending chat, a voice note waiting on an assigned
 *             one, or text an interrupted assignment left behind.
 *   threads   pending chats whose last message is that old; ignored ones
 *             only once they have also been QUIET that long (`updated_at` is
 *             when an ignored chat was last heard from), so an ignore holds
 *             while the contact keeps writing.
 *   codes     spent link codes after a day; event ids after 90 days; the
 *             per-connection counters after two days.
 *   links     D754 way B (#1937): a linked WhatsApp unused for
 *             CHANNEL_LIMITS.senderLinkDays lapses — phone numbers are
 *             reassigned. Its row stays, disconnected, with only the mask.
 *   captures  (#1938) forwarded recordings not imported by their `fetch_by`,
 *             with their consent rows (whatsappCapture.ts).
 *   drafts    (D754 §7) a draft session a chat waiting for consent left
 *             empty for that long, with the interview made for it
 *             (`dropEmptyDrafts`), after the messages above are gone.
 */
export async function purgeExpired(env: Env, now = new Date()): Promise<{
  threads: number; messages: number; codes: number; events: number; counters: number; drafts: number; lapsed: number; captures: number;
}> {
  await discardExpiredDrafts(env, now);
  const cutoff = new Date(now.getTime() - CHANNEL_LIMITS.pendingDays * 86_400_000).toISOString();
  const day = new Date(now.getTime() - 86_400_000).toISOString();
  const twoDays = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const events = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const unused = new Date(now.getTime() - CHANNEL_LIMITS.senderLinkDays * 86_400_000).toISOString();
  const [msgs, threads, codes, evs, counters, linkAttempts, lapsed, , captures, , telegramCaptures] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM channel_thread_messages WHERE datetime(sent_at) < datetime(?)`).bind(cutoff),
    env.DB.prepare(
      `DELETE FROM channel_threads WHERE status IN ('pending', 'ignored')
          AND datetime(COALESCE(last_message_at, created_at)) < datetime(?)
          AND (status = 'pending' OR datetime(updated_at) < datetime(?))
          AND NOT EXISTS (SELECT 1 FROM channel_thread_messages m WHERE m.thread_id = channel_threads.id)`,
    ).bind(cutoff, cutoff),
    env.DB.prepare(
      `DELETE FROM channel_link_codes WHERE (used_at IS NOT NULL OR datetime(expires_at) < datetime(?))
          AND datetime(created_at) < datetime(?)`,
    ).bind(now.toISOString(), day),
    env.DB.prepare(`DELETE FROM channel_events WHERE datetime(created_at) < datetime(?)`).bind(events),
    env.DB.prepare(`DELETE FROM channel_counters WHERE datetime(created_at) < datetime(?)`).bind(twoDays),
    env.DB.prepare(`DELETE FROM channel_link_attempts WHERE window_start < ?`).bind(twoDays),
    env.DB.prepare(
      `UPDATE integrations SET status = 'disconnected', credentials_enc = NULL, external_account_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE provider_key = 'whatsapp_link' AND status = 'active'
          AND datetime(COALESCE(last_synced_at, updated_at, created_at)) < datetime(?)`,
    ).bind(unused),
    ...expireCapturesStatements(env, now),
    ...expireTelegramCapturesStatements(env, now),
  ]);
  // #1939 part 3: a lapsed (or otherwise ended) link keeps no venture choice, so relinking starts clean.
  await env.DB.prepare(`DELETE FROM whatsapp_link_settings WHERE integration_id NOT IN
      (SELECT id FROM integrations WHERE provider_key = 'whatsapp_link' AND status = 'active')`).run()
    .catch((e: unknown) => { if (!/no such table: whatsapp_link_settings/.test(String((e as Error)?.message ?? e))) throw e; });
  const drafts = await dropEmptyDrafts(env, { before: cutoff });
  return {
    drafts,
    messages: Number(msgs.meta?.changes ?? 0), threads: Number(threads.meta?.changes ?? 0),
    codes: Number(codes.meta?.changes ?? 0), events: Number(evs.meta?.changes ?? 0),
    counters: Number(counters.meta?.changes ?? 0) + Number(linkAttempts.meta?.changes ?? 0),
    lapsed: Number(lapsed.meta?.changes ?? 0),
    captures: Number(captures.meta?.changes ?? 0) + Number(telegramCaptures.meta?.changes ?? 0),
  };
}
