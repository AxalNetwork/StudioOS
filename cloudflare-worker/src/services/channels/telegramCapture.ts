/** D867 (#2513): private forwards wait as encrypted references until attestation.
 * Reuses D754's limits and the recorder's intake/processing; no model call here.
 */
import type { Env } from '../../types';
import { decryptColumn, encryptColumn } from '../columnCipher';
import { deleteSession, dropInterviewMadeFor, loadSession, putChunk, type SessionRow } from '../interviewSessions';
import { finishSession } from '../interviewProcessing';
import { IntakeError, activeMember, createInterview, openSession, writableInterview } from '../interviewIntake';
import { CHANNEL_AUDIO_MAX_BYTES, audioMimeAdmitted } from './channelAudio';
import { CAPTURE_LIMITS } from './whatsappCapture';
import { fetchTelegramVoice, sendPrivateMessage } from './telegram';
import { channelOpenToMember, providerAvailable } from './connections';
import { connectionOverLimit, linkAttemptOverLimit, refKey } from './events';
import { beginOutbound, finishOutbound } from './outbound';
import { enqueueChannelJob, type ChannelJobPayload } from './jobs';
import type { InboundTelegramCapture, SendResult, VoiceMedia } from './types';

export const CAPTURE_COPY = {
  question: 'Before Axal transcribes this: did everyone in the recording agree to be recorded and transcribed before it started?',
  buttons: { verbal: 'Yes, out loud', written: 'Yes, in writing', no: 'No' },
  tooLarge: 'This recording is larger than Axal can take from Telegram (5 MB). Record it with the in-app recorder instead.',
  unsupported: 'Axal takes voice notes and audio files here.',
  unlinked: 'In Axal, open Account › Connectors and press Link Telegram. Nothing from this recording has been kept.',
  ambiguous: 'Reply directly to the consent question for the recording you mean.',
  declined: 'Understood. Axal has not kept that recording.',
  saved: 'Saved. Open it in Axal › Customer research.',
  failed: 'Axal could not import this recording. Nothing was saved. Send the audio again to try again.',
  noVenture: 'Axal could not import this recording because its venture is no longer available. Set up a venture in Axal, then send the audio again.',
} as const;
const KEYBOARD = { keyboard: Object.values(CAPTURE_COPY.buttons).map((text) => [{ text }]), one_time_keyboard: true, resize_keyboard: true };
const enabled = (env: Env) => String(env.TELEGRAM_CAPTURE ?? '').trim().toLowerCase() === 'on';

export function captureAnswer(text: string | null): 'verbal' | 'written' | 'no' | null {
  switch (text?.trim().toLowerCase()) {
    case 'yes, out loud': return 'verbal';
    case 'yes, in writing': return 'written';
    case 'no': return 'no';
    default: return null;
  }
}
interface CaptureItem { id: string; mime: string | null; size: number | null; type: VoiceMedia; ref: string }
interface CaptureRow {
  id: number; uid: string; user_id: number; integration_id: number; project_id: number | null;
  sender_hash: string; media_refs_enc: string | null; item_count: number; status: 'waiting' | 'consented' | 'imported';
  fetch_by: string; consent_id: number | null; session_id: number | null; import_job: string | null;
  import_error: string | null; created_at: string;
}
export async function captureItems(env: Env, row: Pick<CaptureRow, 'uid' | 'media_refs_enc'>): Promise<CaptureItem[] | null> {
  const plain = await decryptColumn(env, 'telegram_captures', 'media_refs_enc', row.uid, row.media_refs_enc);
  try { const v = plain ? JSON.parse(plain) : null; return Array.isArray(v) ? v : null; } catch { return null; }
}
const readItems = captureItems;

async function eligible(env: Env, userId: number, integrationId: number, senderHash: string): Promise<boolean> {
  if (!enabled(env) || !providerAvailable(env, 'telegram') || !(await channelOpenToMember(env, 'telegram', userId))) return false;
  try { await activeMember(env, userId); } catch (e) { if (e instanceof IntakeError) return false; throw e; }
  const link = await env.DB.prepare("SELECT external_account_id FROM integrations WHERE id = ? AND user_id = ? AND provider_key = 'telegram' AND status = 'active' AND external_account_id IS NOT NULL")
    .bind(integrationId, userId).first<{external_account_id: string}>();
  return !!link && await refKey('telegram', link.external_account_id) === senderHash;
}

/** Outbound ledger makes every prompt/confirmation an at-most-once send. */
async function reply(env: Env, userId: number, chat: string, key: string, text: string, keyboard = false): Promise<void> {
  const out = await beginOutbound(env, 'telegram', userId, null, key);
  if (out.existing) return;
  const sent = await sendPrivateMessage(env, chat, text, keyboard ? KEYBOARD : { remove_keyboard: true })
    .catch(() => ({ ok: false, code: 'send_unknown' } as SendResult));
  await finishOutbound(env, out.row.id, sent);
}

/** A file's event hash also makes replay after a partial webhook write safe. */
async function addToCapture(env: Env, link: { id: number; user_id: number }, ev: InboundTelegramCapture): Promise<string> {
  const note = ev.voice!;
  const senderHash = await refKey('telegram', ev.telegramUserId);
  const item: CaptureItem = { id: note.fileRef, mime: note.mime, size: note.sizeBytes ?? null, type: note.media ?? 'voice', ref: await refKey('telegram', ev.externalMessageId) };
  const since = new Date(Date.now() - CAPTURE_LIMITS.windowMinutes * 60_000).toISOString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = (await env.DB.prepare("SELECT * FROM telegram_captures WHERE integration_id = ? AND sender_hash = ? AND status = 'waiting' ORDER BY id DESC")
      .bind(link.id, senderHash).all<CaptureRow>()).results ?? [];
    for (const row of rows) {
      const items = await readItems(env, row);
      if (!items) throw new Error('capture_unreadable');
      if (items.some((it) => it.ref === item.ref)) return row.uid;
    }
    const open = rows.find((row) => row.item_count < CAPTURE_LIMITS.items && Date.parse(row.created_at) > Date.parse(since));
    if (open) {
      const items = (await readItems(env, open))!;
      const enc = await encryptColumn(env, 'telegram_captures', 'media_refs_enc', open.uid, JSON.stringify([...items, item]));
      const r = await env.DB.prepare("UPDATE telegram_captures SET media_refs_enc = ?, item_count = item_count + 1, updated_at = datetime('now') WHERE id = ? AND status = 'waiting' AND item_count = ?")
        .bind(enc, open.id, open.item_count).run();
      if (Number(r.meta?.changes)) return open.uid;
      continue;
    }
    const uid = crypto.randomUUID();
    const enc = await encryptColumn(env, 'telegram_captures', 'media_refs_enc', uid, JSON.stringify([item]));
    // Pin the venture at arrival; writableInterview re-checks it at import.
    const r = await env.DB.prepare(`INSERT INTO telegram_captures
      (uid, user_id, integration_id, sender_hash, media_refs_enc, item_count, fetch_by, created_at, project_id)
      SELECT ?, ?, ?, ?, ?, 1, ?, ?, (SELECT p.id FROM projects p JOIN users u ON u.id = ? AND u.founder_id = p.founder_id
        WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC, p.id DESC LIMIT 1)
      WHERE NOT EXISTS (SELECT 1 FROM telegram_captures WHERE integration_id = ? AND sender_hash = ? AND status = 'waiting' AND item_count < ? AND datetime(created_at) > datetime(?))`)
      .bind(uid, link.user_id, link.id, senderHash, enc, new Date(Date.now() + CAPTURE_LIMITS.fetchDays * 86_400_000).toISOString(), new Date().toISOString(), link.user_id,
        link.id, senderHash, CAPTURE_LIMITS.items, since).run();
    if (Number(r.meta?.changes)) return uid;
  }
  throw new Error('capture_contended');
}

/** A reply to a prompt selects that capture; bare keyboard text needs exactly one waiting prompt. */
async function targetCapture(env: Env, linkId: number, senderHash: string, context: string | null): Promise<CaptureRow | null> {
  const rows = (await env.DB.prepare("SELECT * FROM telegram_captures WHERE integration_id = ? AND sender_hash = ? AND status IN ('waiting', 'consented') AND fetch_by > ? ORDER BY id DESC")
    .bind(linkId, senderHash, new Date().toISOString()).all<CaptureRow>()).results ?? [];
  if (context) {
    const hash = await refKey('telegram', context);
    for (const row of rows) {
      if (await env.DB.prepare("SELECT 1 AS hit FROM channel_outbound WHERE provider = 'telegram' AND user_id = ? AND client_key = ? AND external_message_id = ? AND status = 'submitted'")
        .bind(row.user_id, `tgcapture:${row.uid}`, hash).first()) return row;
    }
    return null;
  }
  const waiting = rows.filter((r) => r.status === 'waiting');
  if (waiting.length === 1) return waiting[0];
  // Replayed YES after a queue failure can re-enqueue the same consented capture.
  return rows.length === 1 ? rows[0] : null;
}

async function queueImport(env: Env, uid: string, attempt = 1): Promise<void> {
  await enqueueChannelJob(env, 'channel_followup', 'telegram', `capture:${uid}:${attempt}`, { kind: 'capture', capture: uid, try: attempt },
    attempt > 1 ? { delaySeconds: 60 * (attempt - 1) } : {});
}

export async function handleCapture(env: Env, ev: InboundTelegramCapture): Promise<void> {
  if (!enabled(env)) return;
  const link = await env.DB.prepare("SELECT id, user_id FROM integrations WHERE provider_key = 'telegram' AND status = 'active' AND external_account_id = ?")
    .bind(ev.telegramUserId).first<{ id: number; user_id: number }>();
  if (!link) {
    if (!(await linkAttemptOverLimit(env, `tgcapture:${ev.telegramUserId}`, 5))) await sendPrivateMessage(env, ev.chatId, CAPTURE_COPY.unlinked);
    return;
  }
  const senderHash = await refKey('telegram', ev.telegramUserId);
  if (!(await eligible(env, Number(link.user_id), Number(link.id), senderHash)) || await connectionOverLimit(env, Number(link.id))) return;
  const answer = captureAnswer(ev.text);
  if (answer) {
    const row = await targetCapture(env, Number(link.id), senderHash, ev.contextMessageId);
    if (!row) { await reply(env, link.user_id, ev.chatId, `tgcapture-ambiguous:${ev.eventId}`, CAPTURE_COPY.ambiguous); return; }
    if (answer === 'no') {
      // No consent row exists for a waiting capture. Never delete a YES's consent in a race.
      const r = await env.DB.prepare("DELETE FROM telegram_captures WHERE id = ? AND user_id = ? AND status = 'waiting'").bind(row.id, link.user_id).run();
      if (Number(r.meta?.changes)) await reply(env, link.user_id, ev.chatId, `tgcapture-no:${row.uid}`, CAPTURE_COPY.declined);
      return;
    }
    const consentUid = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO channel_consents (uid, user_id, provider, integration_id, capture_id, source, method, status, answered_at)
        SELECT ?, user_id, 'telegram', integration_id, id, 'member_attested', ?, 'given', ? FROM telegram_captures
        WHERE id = ? AND user_id = ? AND status = 'waiting' AND fetch_by > ?`)
        .bind(consentUid, answer, new Date().toISOString(), row.id, link.user_id, new Date().toISOString()),
      env.DB.prepare(`UPDATE telegram_captures SET status = 'consented', answered_at = ?, consent_id = (SELECT id FROM channel_consents WHERE uid = ?), updated_at = datetime('now')
        WHERE id = ? AND status = 'waiting' AND EXISTS (SELECT 1 FROM channel_consents WHERE uid = ?)`)
        .bind(new Date().toISOString(), consentUid, row.id, consentUid),
    ]);
    await queueImport(env, row.uid);
    return;
  }
  if (!ev.voice || (ev.voice.mime && !audioMimeAdmitted(ev.voice.mime))) {
    await reply(env, link.user_id, ev.chatId, `tgcapture-unsupported:${ev.eventId}`, CAPTURE_COPY.unsupported); return;
  }
  if (ev.voice.sizeBytes != null && ev.voice.sizeBytes > CHANNEL_AUDIO_MAX_BYTES) {
    await reply(env, link.user_id, ev.chatId, `tgcapture-large:${ev.eventId}`, CAPTURE_COPY.tooLarge); return;
  }
  const uid = await addToCapture(env, link, ev);
  await reply(env, link.user_id, ev.chatId, `tgcapture:${uid}`, CAPTURE_COPY.question, true);
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
    `UPDATE telegram_captures SET import_job = ?, updated_at = datetime('now')
      WHERE uid = ? AND status = 'consented' AND fetch_by > ?
        AND import_error IS NULL AND (import_job IS NULL OR datetime(updated_at) <= datetime('now', ?))`,
  ).bind(job, uid, now.toISOString(), `-${CAPTURE_LIMITS.claimStaleMinutes} minutes`).run();
  if (!Number(claimed.meta?.changes ?? 0)) return { done: 'nothing' };
  const row = await env.DB.prepare('SELECT * FROM telegram_captures WHERE uid = ?').bind(uid).first<CaptureRow>();
  if (!row) return { done: 'nothing' };
  const userId = Number(row.user_id);
  if (!(await eligible(env, userId, Number(row.integration_id), row.sender_hash))) return release(env, row, null, { done: 'nothing' });
  try {
    const consent = await env.DB.prepare(
      "SELECT method FROM channel_consents WHERE id = ? AND capture_id = ? AND provider = 'telegram' AND user_id = ? AND status = 'given'",
    ).bind(row.consent_id, row.id, userId).first<{ method: string }>();
    if (!consent) return release(env, row, null, { done: 'nothing' });

    const allowed = async () => await eligible(env, userId, Number(row.integration_id), row.sender_hash)
      && !!await env.DB.prepare(`SELECT 1 AS hit FROM telegram_captures c JOIN channel_consents a ON a.id = c.consent_id
        WHERE c.id = ? AND c.status = 'consented' AND c.import_job = ? AND c.fetch_by > ?
          AND a.provider = 'telegram' AND a.capture_id = c.id AND a.user_id = c.user_id AND a.status = 'given'`)
        .bind(row.id, job, new Date().toISOString()).first();
    const stop = async (code: string): Promise<CaptureImportOutcome> => {
      await discardDraft(env, row);
      return release(env, row, code, { done: 'refused', userId, code }, true);
    };

    const items = await readItems(env, row);
    if (!items?.length) return stop('unreadable');
    // Refused before any call: a size or a type the recorder cannot take.
    if (items.some((it) => it.size != null && it.size > CHANNEL_AUDIO_MAX_BYTES)) return stop('too_large');
    if (items.some((it) => it.mime != null && !audioMimeAdmitted(it.mime))) return stop('unsupported_format');
    if (!row.project_id) return stop('no_venture');

    let session: SessionRow | null = row.session_id ? await loadSession(env, Number(row.session_id)) : null;
    if (!session) {
      try {
        const interviewId = await createInterview(env, userId, Number(row.project_id), 'Recording from Telegram');
        const scoped = await writableInterview(env, userId, interviewId);
        session = await openSession(env, scoped, 'telegram', 'in_person', { method: consent.method });
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
        env.DB.prepare('UPDATE telegram_captures SET session_id = ? WHERE id = ? AND import_job = ? AND session_id IS NULL').bind(session.id, row.id, job),
        env.DB.prepare("UPDATE channel_consents SET session_id = ?, interview_id = ? WHERE id = ? AND provider = 'telegram'").bind(session.id, session.interview_id, row.consent_id),
      ]);
      row.session_id = session.id;
    }

    for (const [seq, item] of items.entries()) {
      if (await env.DB.prepare('SELECT 1 AS hit FROM interview_session_chunks WHERE session_id = ? AND seq = ?').bind(session.id, seq).first()) continue;
      if (!(await allowed())) return stop('link_ended');
      const got = await fetchTelegramVoice(env, { file: item.id, mime: item.mime, size: item.size, media: item.type });
      if (!got.ok) {
        if (got.retryable) return release(env, row, null, { done: 'retry', code: got.code });
        return stop(got.code);
      }
      if (!(await allowed())) return stop('link_ended');
      const bytes = got.bytes.buffer.slice(got.bytes.byteOffset, got.bytes.byteOffset + got.bytes.byteLength) as ArrayBuffer;
      await putChunk(env, session, userId, seq, got.mime, bytes, null);
    }
    if (!(await allowed())) return stop('link_ended');
    await finishSession(env, session, userId, items.length - 1, true);
    // The media ids are no longer needed: the audio is the session's now.
    await env.DB.prepare(
      `UPDATE telegram_captures SET status = 'imported', media_refs_enc = NULL, import_job = NULL, import_error = NULL,
              imported_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'consented' AND import_job = ?`,
    ).bind(row.id, job).run();
    return { done: 'imported', userId, integrationId: Number(row.integration_id), sessionId: session.id };
  } catch (error) {
    await release(env, row, null, null);
    throw error;
  }
}

/** Only a draft this capture created is eligible for capture cleanup. */
async function discardDraft(env: Env, row: Pick<CaptureRow, 'session_id' | 'user_id'>): Promise<void> {
  const session = row.session_id ? await loadSession(env, Number(row.session_id)) : null;
  if (session && session.created_by_user_id === Number(row.user_id) && session.submitted_via === 'telegram') {
    await deleteSession(env, session, Number(row.user_id));
    await dropInterviewMadeFor(env, Number(session.interview_id), session.created_at);
  }
}

/** Abandoned partial audio must not outlive its expiring capture. */
export async function discardExpiredDrafts(env: Env, now: Date): Promise<void> {
  const rows = (await env.DB.prepare(`SELECT * FROM telegram_captures WHERE status = 'consented' AND fetch_by <= ?
    AND session_id IS NOT NULL AND (import_job IS NULL OR datetime(updated_at) <= datetime('now', ?))`)
    .bind(now.toISOString(), `-${CAPTURE_LIMITS.claimStaleMinutes} minutes`).all<CaptureRow>()).results ?? [];
  for (const row of rows) await discardDraft(env, row);
}

/** Release only this import's lease, with a terminal refusal code; a refusal also forgets the session it removed. */
async function release<T>(env: Env, row: CaptureRow, code: string | null, out: T, dropSession = false): Promise<T> {
  await (dropSession
    ? env.DB.prepare(
      `UPDATE telegram_captures SET import_job = NULL, import_error = ?, session_id = NULL, updated_at = datetime('now') WHERE id = ? AND import_job = ?`,
    )
    : env.DB.prepare(
      `UPDATE telegram_captures SET import_job = NULL, import_error = ?, updated_at = datetime('now') WHERE id = ? AND import_job = ?`,
    )).bind(code, row.id, row.import_job).run();
  return out;
}


/** Registered through the existing provider dispatcher; queue payloads carry Axal ids only. */
export async function runCaptureFollowup(env: Env, p: ChannelJobPayload): Promise<void> {
  if (p.provider !== 'telegram' || !enabled(env)) return;
  const uid = String(p.capture ?? '');
  const out = await importCapture(env, uid, crypto.randomUUID());
  if (out.done === 'retry') {
    const attempt = Math.max(1, Number(p.try) || 1);
    if (attempt < 3) { await queueImport(env, uid, attempt + 1); return; }
    const failed = await env.DB.prepare("SELECT * FROM telegram_captures WHERE uid = ? AND status = 'consented' AND import_job IS NULL").bind(uid).first<CaptureRow>();
    if (failed) await discardDraft(env, failed);
    await env.DB.prepare("UPDATE telegram_captures SET import_error = 'provider_unavailable', session_id = NULL WHERE uid = ? AND status = 'consented' AND import_job IS NULL").bind(uid).run();
  }
  const row = await env.DB.prepare("SELECT c.user_id, c.sender_hash, c.status, c.import_error, i.external_account_id FROM telegram_captures c JOIN integrations i ON i.id = c.integration_id AND i.user_id = c.user_id AND i.status = 'active' WHERE c.uid = ? AND c.status IN ('imported', 'consented') AND i.provider_key = 'telegram'")
    .bind(uid).first<{ user_id: number; sender_hash: string; status: string; import_error: string | null; external_account_id: string | null }>();
  if (!row?.external_account_id || await refKey('telegram', row.external_account_id) !== row.sender_hash) return;
  if (row.status === 'imported') await reply(env, row.user_id, row.external_account_id, `tgcapture-saved:${uid}`, CAPTURE_COPY.saved);
  else if (row.import_error) await reply(env, row.user_id, row.external_account_id, `tgcapture-failed:${uid}`,
    row.import_error === 'too_large' ? CAPTURE_COPY.tooLarge : row.import_error === 'unsupported_format' ? CAPTURE_COPY.unsupported
      : row.import_error === 'no_venture' || row.import_error === 'project_not_found' ? CAPTURE_COPY.noVenture : CAPTURE_COPY.failed);
}

/** Seven days is Axal's retention bound, not a claimed Telegram file_id expiry. */
export function expireCapturesStatements(env: Env, now: Date): D1PreparedStatement[] {
  return [
    env.DB.prepare(`DELETE FROM channel_consents WHERE provider = 'telegram' AND capture_id IN
      (SELECT id FROM telegram_captures WHERE status IN ('waiting', 'consented') AND fetch_by <= ?
        AND (import_job IS NULL OR datetime(updated_at) <= datetime('now', ?)))`)
      .bind(now.toISOString(), `-${CAPTURE_LIMITS.claimStaleMinutes} minutes`),
    env.DB.prepare("DELETE FROM telegram_captures WHERE status IN ('waiting', 'consented') AND fetch_by <= ? AND (import_job IS NULL OR datetime(updated_at) <= datetime('now', ?))")
      .bind(now.toISOString(), `-${CAPTURE_LIMITS.claimStaleMinutes} minutes`),
  ];
}
