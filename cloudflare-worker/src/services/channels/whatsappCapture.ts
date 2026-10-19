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
 *             "No" deletes the capture. Axal's "Agreed beforehand"
 *             (`POST /whatsapp/captures/:uid/consent`) is the same answer
 *             with method 'pre_agreed'.
 *   expiry    A capture not imported by `fetch_by` (the first file plus
 *             CAPTURE_LIMITS.fetchDays, WhatsApp's media lifetime) is deleted
 *             with its consent rows in the channel purge (threads.ts).
 *
 * THE IMPORT IS NOT HERE YET. Downloading a consented capture's files and
 * opening the draft interview waits for #1896's bounded download
 * (`boundedDownload`, `channelAudio.ts`); until it lands a consented capture
 * waits, and expires at `fetch_by` like any other.
 */
import type { Env } from '../../types';
import { decryptColumn, encryptColumn } from '../columnCipher';
import { CHUNK_MIME, MAX_CHUNK_BYTES } from '../interviewSessions';
import type { InboundAxalMessage } from './types';

export const CAPTURE_LIMITS = {
  /** The recorder's own `CHUNKS_PER_MESSAGE` (interviewProcessing.ts). */
  items: 20,
  windowMinutes: 30,
  /** WhatsApp keeps a media id downloadable for about this long. */
  fetchDays: 7,
} as const;

/** The words Axal's number sends about a capture. */
export const CAPTURE_COPY = {
  question: 'Before Axal transcribes this: did everyone in the recording agree to be recorded and transcribed before it started?',
  buttons: { verbal: 'Yes, out loud', written: 'Yes, in writing', no: 'No' },
  unsupported: 'Axal takes voice notes and audio files here.',
  tooLarge: 'This recording is larger than Axal can take from WhatsApp (5 MB). Record it with the in-app recorder instead.',
} as const;

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
    await env.DB.prepare(
      `INSERT INTO whatsapp_captures (uid, user_id, integration_id, media_refs_enc, item_count, status, fetch_by, created_at)
       VALUES (?, ?, ?, ?, 1, 'waiting', ?, ?)`,
    ).bind(uid, link.user_id, link.id, enc, fetchBy, now.toISOString()).run();
    return { uid, created: true };
  }
  throw new Error('capture_contended');
}

export type CaptureAnswerOutcome =
  | { done: 'consented'; captureId: number; consentId: number }
  | { done: 'deleted' }
  | { done: 'nothing' };

/**
 * The member's answer for a capture still waiting. Scoped to the member (and,
 * from WhatsApp, to the link the button was pressed on); a capture already
 * answered, expired or gone is `nothing`, so a replayed press does nothing.
 */
export async function answerCapture(
  env: Env, scope: { userId: number; integrationId?: number }, uid: string, answer: CaptureAnswer | 'pre_agreed',
): Promise<CaptureAnswerOutcome> {
  const row = await env.DB.prepare(
    `SELECT * FROM whatsapp_captures WHERE uid = ? AND user_id = ? AND (? IS NULL OR integration_id = ?) AND status = 'waiting'
        AND fetch_by > ?`,
  ).bind(uid, scope.userId, scope.integrationId ?? null, scope.integrationId ?? null, new Date().toISOString()).first<CaptureRow>();
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
