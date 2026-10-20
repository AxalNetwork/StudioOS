/**
 * D754 way B, "Send to Axal" part 2 (#1938, wb2) — recordings a linked member
 * forwards to Axal's own number, held until the member says everyone recorded
 * agreed.
 *
 * WHAT IS KEPT BEFORE CONSENT: the media ids only, encrypted
 * (`whatsapp_captures.media_refs_enc`, columnCipher, AAD = the capture's uid),
 * with each file's declared type and size. Nothing is downloaded.
 *
 *   forward   An `audio` message (a voice note or a file), or a `document`
 *             whose type the recorder admits (`CHUNK_MIME`), joins the
 *             member's open capture: at most CAPTURE_LIMITS.items files, for
 *             CAPTURE_LIMITS.windowMinutes after the first, while no answer
 *             is in. Otherwise a new capture opens, and Axal asks once, with
 *             reply buttons, whether everyone recorded agreed.
 *   answer    "Yes, out loud" / "Yes, in writing" write a `channel_consents`
 *             row (source 'member_attested', method 'verbal' | 'written',
 *             capture_id set) and mark the capture 'consented', in one batch.
 *             "No" deletes the capture, and is answered once
 *             (CAPTURE_COPY.declined). Axal's "Agreed beforehand"
 *             (`POST /whatsapp/captures/:uid/consent`) is the same answer
 *             with method 'pre_agreed'.
 *   import    On a yes, a `channel_followup` { kind: 'capture' } job
 *             (`importCapture`): each file is downloaded with Axal's token
 *             through #1896's `boundedDownload` and admitted with
 *             `admitAudio`, one at a time, into a new draft interview in the
 *             capture's venture (`project_id`), with one `in_person` session
 *             (`submitted_via 'whatsapp'`, the member's consent on it). Each
 *             file is a chunk (`putChunk`, `seq` its place in the capture);
 *             then the recorder's own `finishSession` runs the pipeline,
 *             which reaches D757's engine. No model is called here. The
 *             member gets one "Saved" reply.
 *   expiry    A capture not imported by `fetch_by` (the first file plus
 *             CAPTURE_LIMITS.fetchDays, WhatsApp's media lifetime) is deleted
 *             with its consent rows in the channel purge (threads.ts).
 */
import type { Env } from '../../types';
import { decryptColumn, encryptColumn } from '../columnCipher';
import {
  CHUNK_MIME, MAX_CHUNK_BYTES, deleteSession, dropInterviewMadeFor, loadSession, putChunk, type SessionRow,
} from '../interviewSessions';
import { finishSession } from '../interviewProcessing';
import { IntakeError, createInterview, openSession, writableInterview } from '../interviewIntake';
import { admitAudio, audioMimeAdmitted } from './channelAudio';
import { fetchAxalMedia } from './whatsapp';
import type { InboundAxalMessage } from './types';

export const CAPTURE_LIMITS = {
  /** The recorder's own `CHUNKS_PER_MESSAGE` (interviewProcessing.ts). */
  items: 20,
  windowMinutes: 30,
  /** WhatsApp keeps a media id downloadable for about this long. */
  fetchDays: 7,
  /** An import claim older than this was left by a run that died, and is taken over. */
  claimStaleMinutes: 30,
} as const;

/** The words Axal's number sends about a capture. */
export const CAPTURE_COPY = {
  question: 'Before Axal transcribes this: did everyone in the recording agree to be recorded and transcribed before it started?',
  buttons: { verbal: 'Yes, out loud', written: 'Yes, in writing', no: 'No' },
  unsupported: 'Axal takes voice notes and audio files here.',
  tooLarge: 'This recording is larger than Axal can take from WhatsApp (5 MB). Record it with the in-app recorder instead.',
  // S1 on #1938 (09:28Z): "No" deletes the capture before anything was downloaded.
  declined: 'Understood. Axal has not kept that recording.',
  saved: 'Saved. Open it in Axal › Customer research.',
} as const;

/** The interviewee's name on the draft until the member names them on review. */
export const CAPTURE_INTERVIEWEE = 'Recording from WhatsApp';

export type CaptureAnswer = 'verbal' | 'written' | 'no';
const BUTTON_ID = /^capture_(verbal|written|no):([0-9a-f-]{36})$/;

export function captureButtons(uid: string): { id: string; title: string }[] {
  return (['verbal', 'written', 'no'] as const).map((a) => ({ id: `capture_${a}:${uid}`, title: CAPTURE_COPY.buttons[a] }));
}

export function captureButton(id: string | null | undefined): { answer: CaptureAnswer; uid: string } | null {
  const m = BUTTON_ID.exec(String(id ?? ''));
  return m ? { answer: m[1] as CaptureAnswer, uid: m[2] } : null;
}

/** `audio/ogg; codecs=opus` → `audio/ogg`; `audio/x-m4a` → `audio/mp4`; `audio/mp3` → `audio/mpeg`. */
export function captureMime(raw: unknown): string | null {
  const m = String(raw ?? '').split(';')[0].trim().toLowerCase();
  const n = m === 'audio/x-m4a' ? 'audio/mp4' : m === 'audio/mp3' ? 'audio/mpeg' : m;
  return n || null;
}

/** Whether a forwarded file may wait in a capture: audio of any declared type; a document the recorder admits. */
export function capturable(media: NonNullable<InboundAxalMessage['media']>): boolean {
  if (media.type === 'audio') return true;
  const mime = captureMime(media.mime);
  return !!mime && Object.prototype.hasOwnProperty.call(CHUNK_MIME, mime);
}

export const declaredTooLarge = (media: NonNullable<InboundAxalMessage['media']>) =>
  media.sizeBytes != null && media.sizeBytes > MAX_CHUNK_BYTES;

export interface CaptureItem { id: string; mime: string | null; size: number | null; type: 'audio' | 'document' }

export interface CaptureRow {
  id: number; uid: string; user_id: number; integration_id: number; media_refs_enc: string | null; item_count: number;
  status: 'waiting' | 'consented' | 'imported' | 'declined' | 'expired'; fetch_by: string | null;
  consent_id: number | null; session_id: number | null; created_at: string; updated_at: string;
  // Migration 497 (#1938).
  project_id?: number | null; import_job?: string | null; import_error?: string | null;
}

async function readItems(env: Env, row: Pick<CaptureRow, 'uid' | 'media_refs_enc'>): Promise<CaptureItem[] | null> {
  const plain = await decryptColumn(env, 'whatsapp_captures', 'media_refs_enc', row.uid, row.media_refs_enc);
  if (!plain) return null;
  try { const v = JSON.parse(plain); return Array.isArray(v) ? v as CaptureItem[] : null; } catch { return null; }
}

/** A capture's files, decrypted — for the import job (#1896) and nothing else. */
export const captureItems = readItems;

/**
 * One forwarded file into the link's open capture, or a new one. Concurrent
 * deliveries race on `item_count`: an append that lost re-reads and tries
 * again, so no file is dropped and none counted twice.
 */
export async function addToCapture(
  env: Env, link: { id: number; user_id: number }, media: NonNullable<InboundAxalMessage['media']>, now = new Date(),
): Promise<{ uid: string; created: boolean }> {
  const item: CaptureItem = { id: media.mediaId, mime: media.mime, size: media.sizeBytes, type: media.type };
  const since = new Date(now.getTime() - CAPTURE_LIMITS.windowMinutes * 60_000).toISOString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const open = await env.DB.prepare(
      `SELECT * FROM whatsapp_captures WHERE integration_id = ? AND status = 'waiting' AND item_count < ?
          AND datetime(created_at) > datetime(?) ORDER BY id DESC LIMIT 1`,
    ).bind(link.id, CAPTURE_LIMITS.items, since).first<CaptureRow>();
    if (open) {
      const items = await readItems(env, open);
      if (items) {
        const enc = await encryptColumn(env, 'whatsapp_captures', 'media_refs_enc', open.uid, JSON.stringify([...items, item]));
        const r = await env.DB.prepare(
          `UPDATE whatsapp_captures SET media_refs_enc = ?, item_count = item_count + 1, updated_at = datetime('now')
            WHERE id = ? AND status = 'waiting' AND item_count = ?`,
        ).bind(enc, open.id, open.item_count).run();
        if (Number(r.meta?.changes ?? 0) === 1) return { uid: open.uid, created: false };
        continue;
      }
    }
    const uid = crypto.randomUUID();
    const enc = await encryptColumn(env, 'whatsapp_captures', 'media_refs_enc', uid, JSON.stringify([item]));
    const fetchBy = new Date(now.getTime() + CAPTURE_LIMITS.fetchDays * 86_400_000).toISOString();
    // The venture the draft opens in, fixed now (S1 on #1938): where the member
    // pointed when they sent it, even if they change the picker later. Their
    // choice on the link (#1939 part 3, migration 504) while they can still
    // write it, else their most recently updated venture.
    await env.DB.prepare(
      `INSERT INTO whatsapp_captures (uid, user_id, integration_id, media_refs_enc, item_count, status, fetch_by, created_at, project_id)
       VALUES (?, ?, ?, ?, 1, 'waiting', ?, ?, COALESCE(
         (SELECT p.id FROM whatsapp_link_settings s
           JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
           JOIN users u ON u.id = ? AND u.founder_id IS NOT NULL AND p.founder_id = u.founder_id
           WHERE s.integration_id = ?),
         (SELECT p.id FROM projects p JOIN users u ON u.id = ? AND u.founder_id IS NOT NULL AND p.founder_id = u.founder_id
           WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC, p.id DESC LIMIT 1)))`,
    ).bind(uid, link.user_id, link.id, enc, fetchBy, now.toISOString(), link.user_id, link.id, link.user_id).run();
    return { uid, created: true };
  }
  throw new Error('capture_contended');
}

export type CaptureAnswerOutcome =
  | { done: 'consented'; captureId: number; consentId: number }
  | { done: 'deleted' }
  | { done: 'nothing' };

/**
 * The member's answer for a capture still waiting. Scoped to the member: a
 * button pressed from WhatsApp is the sender's link's member, and a member has
 * one link. A capture already answered, expired or gone is `nothing`, so a
 * replayed press does nothing.
 */
export async function answerCapture(env: Env, userId: number, uid: string, answer: CaptureAnswer | 'pre_agreed'): Promise<CaptureAnswerOutcome> {
  const row = await env.DB.prepare(
    `SELECT * FROM whatsapp_captures WHERE uid = ? AND user_id = ? AND status = 'waiting' AND fetch_by > ?`,
  ).bind(uid, userId, new Date().toISOString()).first<CaptureRow>();
  if (!row) return { done: 'nothing' };
  if (answer === 'no') {
    const [, r] = await env.DB.batch([
      env.DB.prepare(`DELETE FROM channel_consents WHERE capture_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM whatsapp_captures WHERE id = ? AND status = 'waiting'`).bind(row.id),
    ]);
    return Number(r.meta?.changes ?? 0) ? { done: 'deleted' } : { done: 'nothing' };
  }
  const consentUid = crypto.randomUUID();
  const at = new Date().toISOString();
  // The consent row exists only if the capture moved, and the capture names it.
  const [ins, upd] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO channel_consents (uid, user_id, provider, integration_id, capture_id, source, method, status, answered_at)
       SELECT ?, ?, 'whatsapp', ?, ?, 'member_attested', ?, 'given', ?
        WHERE EXISTS (SELECT 1 FROM whatsapp_captures WHERE id = ? AND status = 'waiting')`,
    ).bind(consentUid, row.user_id, row.integration_id, row.id, answer, at, row.id),
    env.DB.prepare(
      `UPDATE whatsapp_captures SET status = 'consented', updated_at = datetime('now'),
              consent_id = (SELECT id FROM channel_consents WHERE uid = ?)
        WHERE id = ? AND status = 'waiting'`,
    ).bind(consentUid, row.id),
  ]);
  if (!Number(ins.meta?.changes ?? 0) || !Number(upd.meta?.changes ?? 0)) return { done: 'nothing' };
  const consent = await env.DB.prepare('SELECT id FROM channel_consents WHERE uid = ?').bind(consentUid).first<{ id: number }>();
  return { done: 'consented', captureId: row.id, consentId: Number(consent?.id) };
}

export type CaptureImportOutcome =
  | { done: 'imported'; userId: number; integrationId: number; sessionId: number }
  | { done: 'refused'; userId: number; code: string }
  | { done: 'retry'; code: string }
  | { done: 'nothing' };

/**
 * A consented capture becomes a draft interview (#1938, step 4). Only the run
 * that claims it (`import_job`) goes on, so two deliveries never import twice;
 * a later try takes up where the last stopped, on the same session, and
 * `putChunk` stores nothing twice. The consent row must still be
 * `given`, and the capture inside `fetch_by`.
 *
 * Files are downloaded one at a time and stored at once, so at most one 5 MB
 * file is in memory. A declared size over 5 MB, or a declared type the
 * recorder does not take, is refused before any call. A refusal (`refused`)
 * removes the draft and every stored chunk, keeps the capture `consented`
 * with its `import_error` until it expires, and is never retried; a provider
 * that did not answer (`retry`) keeps what is stored for the next try.
 */
export async function importCapture(env: Env, uid: string, job: string, now = new Date()): Promise<CaptureImportOutcome> {
  // One holder at a time. A claim left by a run that died is taken over once stale.
  const claimed = await env.DB.prepare(
    `UPDATE whatsapp_captures SET import_job = ?, updated_at = datetime('now')
      WHERE uid = ? AND status = 'consented' AND fetch_by > ?
        AND (import_job IS NULL OR datetime(updated_at) <= datetime('now', ?))`,
  ).bind(job, uid, now.toISOString(), `-${CAPTURE_LIMITS.claimStaleMinutes} minutes`).run();
  if (!Number(claimed.meta?.changes ?? 0)) return { done: 'nothing' };
  const row = await env.DB.prepare('SELECT * FROM whatsapp_captures WHERE uid = ?').bind(uid).first<CaptureRow>();
  if (!row) return { done: 'nothing' };
  const userId = Number(row.user_id);
  const consent = await env.DB.prepare(
    "SELECT method FROM channel_consents WHERE id = ? AND capture_id = ? AND status = 'given'",
  ).bind(row.consent_id, row.id).first<{ method: string }>();
  if (!consent) return release(env, row, null, { done: 'nothing' });

  const stop = async (code: string): Promise<CaptureImportOutcome> => {
    const session = row.session_id ? await loadSession(env, Number(row.session_id)) : null;
    if (session) {
      await deleteSession(env, session, userId);
      await dropInterviewMadeFor(env, Number(session.interview_id), session.created_at);
    }
    return release(env, row, code, { done: 'refused', userId, code }, true);
  };

  const items = await readItems(env, row);
  if (!items?.length) return stop('unreadable');
  // Refused before any call: a size or a type the recorder cannot take.
  if (items.some((it) => it.size != null && it.size > MAX_CHUNK_BYTES)) return stop('too_large');
  if (items.some((it) => it.type === 'document' && !audioMimeAdmitted(it.mime))) return stop('unsupported_format');
  if (!row.project_id) return stop('no_venture');

  let session: SessionRow | null = row.session_id ? await loadSession(env, Number(row.session_id)) : null;
  if (!session) {
    try {
      const interviewId = await createInterview(env, userId, Number(row.project_id), CAPTURE_INTERVIEWEE);
      const scoped = await writableInterview(env, userId, interviewId);
      session = await openSession(env, scoped, 'whatsapp', 'in_person', { method: consent.method });
    } catch (e) {
      if (e instanceof IntakeError) return stop(e.code);
      throw e;
    }
    // A recording that has stopped, as the recorder's is before its chunks are processed.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE interview_sessions SET status = 'stopped', started_at = datetime('now'), stopped_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND status = 'draft'`,
      ).bind(session.id),
      env.DB.prepare('UPDATE whatsapp_captures SET session_id = ? WHERE id = ? AND session_id IS NULL').bind(session.id, row.id),
    ]);
    row.session_id = session.id;
  }

  for (const [seq, item] of items.entries()) {
    if (await env.DB.prepare('SELECT 1 AS hit FROM interview_session_chunks WHERE session_id = ? AND seq = ?').bind(session.id, seq).first()) continue;
    const got = await fetchAxalMedia(env, item.id);
    if (!got.ok) {
      if (got.retryable) return release(env, row, got.code, { done: 'retry', code: got.code });
      return stop(got.code);
    }
    const admitted = admitAudio(item.mime, got.container);
    if (!admitted.ok) return stop(admitted.code);
    const bytes = got.bytes.buffer.slice(got.bytes.byteOffset, got.bytes.byteOffset + got.bytes.byteLength) as ArrayBuffer;
    await putChunk(env, session, userId, seq, admitted.mime, bytes, null);
  }
  await finishSession(env, session, userId, items.length - 1, true);
  // The media ids are no longer needed: the audio is the session's now.
  await env.DB.prepare(
    `UPDATE whatsapp_captures SET status = 'imported', media_refs_enc = NULL, import_job = NULL, import_error = NULL,
            updated_at = datetime('now') WHERE id = ? AND status = 'consented'`,
  ).bind(row.id).run();
  return { done: 'imported', userId, integrationId: Number(row.integration_id), sessionId: session.id };
}

/** The claim let go, with a code for the `fb` screens; a refusal also forgets the session it removed. */
async function release<T>(env: Env, row: CaptureRow, code: string | null, out: T, dropSession = false): Promise<T> {
  await (dropSession
    ? env.DB.prepare(
      `UPDATE whatsapp_captures SET import_job = NULL, import_error = ?, session_id = NULL, updated_at = datetime('now') WHERE id = ?`,
    )
    : env.DB.prepare(
      `UPDATE whatsapp_captures SET import_job = NULL, import_error = ?, updated_at = datetime('now') WHERE id = ?`,
    )).bind(code, row.id).run();
  return out;
}

/** A link's captures still waiting for an answer go when the link does. */
export async function dropWaitingCaptures(env: Env, integrationId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM whatsapp_captures WHERE integration_id = ? AND status = 'waiting'`).bind(integrationId).run();
}

/** The member's captures, newest first: what the `fb` screens draw. No media ids. */
export async function listCaptures(env: Env, userId: number) {
  const rows = (await env.DB.prepare(
    `SELECT c.uid, c.item_count, c.status, c.fetch_by, c.created_at, k.method AS consent_method, k.answered_at AS consent_at
       FROM whatsapp_captures c LEFT JOIN channel_consents k ON k.id = c.consent_id
      WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 50`,
  ).bind(userId).all<{ uid: string; item_count: number; status: string; fetch_by: string | null; created_at: string;
    consent_method: string | null; consent_at: string | null }>()).results ?? [];
  return rows.map((r) => ({ ...r, item_count: Number(r.item_count) }));
}

/**
 * The purge's share (threads.ts `purgeExpired`): a capture not imported by its
 * `fetch_by` can no longer be fetched, so it goes, with its consent rows.
 */
export function expireCapturesStatements(env: Env, now: Date): D1PreparedStatement[] {
  const at = now.toISOString();
  return [
    env.DB.prepare(
      `DELETE FROM channel_consents WHERE capture_id IN
        (SELECT id FROM whatsapp_captures WHERE status IN ('waiting', 'consented') AND fetch_by <= ?)`,
    ).bind(at),
    env.DB.prepare(`DELETE FROM whatsapp_captures WHERE status IN ('waiting', 'consented') AND fetch_by <= ?`).bind(at),
  ];
}
