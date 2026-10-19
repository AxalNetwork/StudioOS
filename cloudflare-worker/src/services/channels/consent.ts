/**
 * D754 §4, §5, §15 (#1893) — the interviewee's consent, asked and kept in the
 * chat, before anything from it enters an interview.
 *
 * WHERE IT LIVES (migration 488). `channel_consents` holds one row per request
 * — Axal's notice, then the answer on the same row. `channel_threads.consent_state`
 * is what the gate reads ('awaiting' | 'given' | 'declined' | 'withdrawn'),
 * written in the same batch as the row. On 'given' the session takes
 * `consent_status = 'given'` with the method and time, and the pipeline's own
 * gate (`consentBlocks`) passes.
 *
 * TWO WAYS TO 'given', both after Axal's notice went into the chat:
 *   interviewee_reply  they tap "Yes, I agree", or type YES as a WhatsApp
 *                      reply to the notice (method 'chat_reply');
 *   member_attested    the member's word (verbal | written | pre_agreed),
 *                      accepted only once the provider reported the notice
 *                      delivered or read.
 * The interviewee's answer always wins: the member's word is refused after a
 * decline or a withdrawal, and a "No" or STOP after the member's word
 * withdraws it.
 *
 * WHAT COUNTS AS THE INTERVIEWEE'S ANSWER (`recordReply`): a signed webhook
 * (the caller's), from the contact's side, on the thread that holds the
 * request. A button carries that request's uid and replies to one of the
 * thread's notices. A typed YES or NO counts only as a WhatsApp reply to a
 * notice; a bare "no" in the middle of an interview answers the member's own
 * question, and is stored as the message it is. STOP counts anywhere once a
 * notice has gone. Each answer is claimed once: its event, and
 * `reply_ref_hash UNIQUE`.
 *
 * THE NOTICE goes only when the member asks, from the member's own number,
 * inside the 24-hour window, at most twice per thread per version and at
 * least 24 hours apart. Its client keys are the server's (`noticeKeys`), so
 * `UNIQUE(client_key)` makes a third send impossible and a concurrent second
 * press re-reads the first. The reply route refuses any browser key under
 * `CONSENT_KEY_PREFIX`. The notice is not stored as a chat message: its record
 * is its `channel_outbound` row and the consent row.
 *
 * Provider-neutral, keyed by MessagingProvider: Telegram's own notice and
 * switch arrive with D756. Nothing here logs or returns message text, a wamid,
 * a hash or a phone number; logs carry codes only.
 */
import type { Env } from '../../types';
import { refKey } from './events';
import { CONSENT_NOTICE_VERSION } from './consentNotice';
import { replyWindowOpen, setAsideStatements, type ThreadRow } from './threads';
import {
  consentAsked, consentRequired, memberAttestationAllowed, type InboundConsentReply, type MessagingProvider,
} from './types';

export { consentRequired } from './types';

/** D756 §1.5: a typed Telegram answer counts only within this long of the notice. */
export const ANSWER_VALID_MS = 7 * 24 * 60 * 60 * 1000;

/** How a chat's consent was given. `chat_reply` is never one of the recorder's CONSENT_METHODS. */
export const CHANNEL_CONSENT_METHODS = ['chat_reply', 'verbal', 'written', 'pre_agreed'] as const;
/** The member's word: the recorder's methods without `in_app`. */
export const MEMBER_METHODS = ['verbal', 'written', 'pre_agreed'] as const;
export type MemberMethod = typeof MEMBER_METHODS[number];

/** Client keys under this prefix are the server's own notices; the reply route refuses them from a browser. */
export const CONSENT_KEY_PREFIX = 'consent:';
/** Notices per thread per version, and the least time between two. */
export const NOTICES_PER_VERSION = 2;
export const NOTICE_GAP_MS = 24 * 60 * 60 * 1000;

export const CONSENT_BUTTONS = { yes: 'Yes, I agree', no: 'No, thanks' } as const;

export interface ConsentRow {
  id: number; uid: string; user_id: number; provider: MessagingProvider; integration_id: number | null;
  thread_id: number | null; capture_id: number | null; interview_id: number | null; session_id: number | null;
  source: 'interviewee_reply' | 'member_attested' | null; method: string | null;
  status: 'requested' | 'given' | 'declined' | 'withdrawn' | 'expired';
  notice_version: number | null; request_ref_hash: string | null; reply_ref_hash: string | null;
  requested_at: string | null; delivered_at: string | null; answered_at: string | null; withdrawn_at: string | null;
  created_at: string; updated_at: string;
}

/** One line: control characters and line breaks become spaces, runs of spaces one, clipped to `n`. */
export function oneLine(s: unknown, n: number): string {
  // eslint-disable-next-line no-control-regex
  return String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim();
}

/** The parts of a notice: the member's first name (40), the venture (80), and the page's link. */
export interface NoticeParts { firstName: string | null; venture: string | null; url: string }

/**
 * The words of each notice version, which the member cannot edit. New words
 * are a new version (consentNotice.ts). English only (D754 §5).
 */
export const NOTICES: Record<number, (p: NoticeParts) => string> = {
  1: ({ firstName, venture, url }) => {
    const first = oneLine(firstName, 40);
    const at = oneLine(venture, 80);
    const who = `${first || 'The founder'}${at ? ` at ${at}` : ''}`;
    return `${who} would like to record and transcribe this chat for customer research, using Axal VC. `
      + 'That includes voice notes, audio files and videos, and what you have already sent here. '
      + `It is kept until ${first || 'the founder'} deletes it. What this means: ${url}\n\n`
      + 'Tap Yes to agree or No to decline. You can send STOP at any time.';
  },
};

export function noticeText(version: number, parts: NoticeParts): string | null {
  const words = NOTICES[version];
  return words ? words(parts) : null;
}

/** The server's client keys for a thread's notices of a version: at most NOTICES_PER_VERSION. */
export function noticeKeys(thread: Pick<ThreadRow, 'uid'>, version: number = CONSENT_NOTICE_VERSION): string[] {
  return Array.from({ length: NOTICES_PER_VERSION }, (_, i) => `${CONSENT_KEY_PREFIX}${thread.uid}:v${version}:${i + 1}`);
}

/** A D1 or ISO timestamp, in ms; NaN when unreadable. */
const ms = (s: string | null | undefined) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

export interface NoticeState {
  /** Notice keys used, whatever came of them: the cap counts these. */
  used: number;
  /** Notices the provider accepted (submitted, delivered or read). */
  went: number;
  /** When the last notice not refused outright was created, ms; null when there is none. */
  lastAt: number | null;
  /** The newest notice's outbound status, or null. */
  latestStatus: string | null;
  /** Whether the provider reported any notice of this version delivered or read. */
  delivered: boolean;
  /** The next key to use, or null when the cap is spent. */
  nextKey: string | null;
  /** The notices' provider ids, hashed: what a reply's `context.id` must be one of. */
  refs: Set<string>;
}

/** A thread's notices of one version, read by `thread_id` and the exact keys. */
export async function noticeState(env: Env, thread: Pick<ThreadRow, 'id' | 'uid'>, version: number = CONSENT_NOTICE_VERSION): Promise<NoticeState> {
  const keys = noticeKeys(thread, version);
  const rows = (await env.DB.prepare(
    `SELECT client_key, status, external_message_id, created_at FROM channel_outbound
      WHERE thread_id = ? AND client_key IN (SELECT value FROM json_each(?))`,
  ).bind(thread.id, JSON.stringify(keys)).all<{ client_key: string; status: string; external_message_id: string | null; created_at: string }>()).results ?? [];
  const byKey = new Map(rows.map((r) => [r.client_key, r]));
  const went = rows.filter((r) => ['submitted', 'delivered', 'read'].includes(r.status));
  // The gap runs from any notice not refused outright: one still in flight counts, or a
  // concurrent second press would send at once.
  const counted = rows.filter((r) => r.status !== 'failed').map((r) => ms(r.created_at)).filter(Number.isFinite);
  const lastAt = counted.length ? Math.max(...counted) : null;
  const newest = [...keys].reverse().map((k) => byKey.get(k)).find(Boolean) ?? null;
  return {
    used: rows.length,
    went: went.length,
    lastAt: lastAt != null && Number.isFinite(lastAt) ? lastAt : null,
    latestStatus: newest?.status ?? null,
    delivered: rows.some((r) => r.status === 'delivered' || r.status === 'read'),
    nextKey: keys.find((k) => !byKey.has(k)) ?? null,
    refs: new Set(rows.map((r) => r.external_message_id).filter((x): x is string => !!x)),
  };
}

/**
 * Why a notice may not go now, or null. The window is the contact's last
 * message (`replyWindowOpen`); the cap is NOTICES_PER_VERSION keys, at least
 * NOTICE_GAP_MS apart.
 */
export function noticeRefusal(
  thread: Pick<ThreadRow, 'last_inbound_at'>, notices: NoticeState, now = Date.now(),
): { code: 'window_closed' | 'too_soon' | 'asked_twice'; next_at?: string } | null {
  if (!replyWindowOpen(thread, now)) return { code: 'window_closed' };
  if (!notices.nextKey) return { code: 'asked_twice' };
  if (notices.lastAt != null && now - notices.lastAt < NOTICE_GAP_MS) {
    return { code: 'too_soon', next_at: new Date(notices.lastAt + NOTICE_GAP_MS).toISOString() };
  }
  return null;
}

/** The thread's open request, or a new one for its linked interview. The partial unique index decides a race. */
export async function openRequest(
  env: Env, thread: ThreadRow, scoped: { interviewId: number | null; sessionId: number | null },
): Promise<ConsentRow> {
  const find = () => env.DB.prepare(`SELECT * FROM channel_consents WHERE thread_id = ? AND status = 'requested'`)
    .bind(thread.id).first<ConsentRow>();
  const open = await find();
  if (open) return open;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_consents (uid, user_id, provider, integration_id, thread_id, interview_id, session_id, notice_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), thread.user_id, thread.provider, thread.integration_id, thread.id,
    scoped.interviewId, scoped.sessionId, CONSENT_NOTICE_VERSION).run();
  const row = await find();
  if (!row) throw new Error('consent_request_not_stored');
  return row;
}

/**
 * A notice went (or its send is unknown), or the member pasted it themselves
 * (D756 §1.5 (b)): the request records when, and which message it was, and
 * the thread reads 'awaiting' unless consent is already given.
 */
export async function markRequested(
  env: Env, consentId: number, externalMessageId: string | null, provider: MessagingProvider, threadId: number,
): Promise<void> {
  const ref = externalMessageId ? await refKey(provider, externalMessageId) : null;
  await env.DB.batch([
    // ISO, to the millisecond, as `last_inbound_at` is: Telegram's "first message after the notice" compares the two.
    env.DB.prepare(
      `UPDATE channel_consents SET requested_at = ?, request_ref_hash = COALESCE(?, request_ref_hash),
              notice_version = ?, updated_at = datetime('now') WHERE id = ? AND status = 'requested'`,
    ).bind(new Date().toISOString(), ref, CONSENT_NOTICE_VERSION, consentId),
    env.DB.prepare(
      `UPDATE channel_threads SET consent_state = 'awaiting', updated_at = datetime('now')
        WHERE id = ? AND (consent_state IS NULL OR consent_state <> 'given')`,
    ).bind(threadId),
  ]);
}

/**
 * A delivery report for a message Axal sent (the webhook's status branch,
 * after `applyDeliveryStatus`): when it is one of a thread's notices, its open
 * request records `delivered_at`. True when it did.
 */
export async function markDelivered(env: Env, externalMessageId: string, status: string): Promise<boolean> {
  if (status !== 'delivered' && status !== 'read') return false;
  const ob = await env.DB.prepare(
    `SELECT thread_id, client_key FROM channel_outbound WHERE provider = 'whatsapp' AND external_message_id = ?`,
  ).bind(await refKey('whatsapp', externalMessageId)).first<{ thread_id: number | null; client_key: string }>();
  if (!ob?.thread_id || !String(ob.client_key).startsWith(CONSENT_KEY_PREFIX)) return false;
  const r = await env.DB.prepare(
    `UPDATE channel_consents SET delivered_at = COALESCE(delivered_at, datetime('now')), updated_at = datetime('now')
      WHERE thread_id = ? AND status = 'requested'`,
  ).bind(ob.thread_id).run();
  return Number(r.meta?.changes ?? 0) > 0;
}

export type ReplyOutcome =
  | { outcome: 'given' | 'declined' | 'withdrawn'; consent: ConsentRow }
  | { outcome: 'ignored'; reason: 'not_from_contact' | 'request_mismatch' | 'request_closed' | 'not_a_reply_to_notice' | 'no_notice' | 'too_late' | 'duplicate' };

const ignored = (reason: Extract<ReplyOutcome, { outcome: 'ignored' }>['reason']): ReplyOutcome => ({ outcome: 'ignored', reason });

/*
 * Every statement after the row's own update carries the same guard, written
 * out in each: EXISTS (the row, with this reply's ref and its new status). The
 * row took this answer, or none of the batch applies.
 */

/** The thread's `consent_state` only, under the same guard (a chat that is not set aside). */
function stateStatement(
  env: Env, threadId: number, state: 'declined' | 'withdrawn', guard: { consentId: number; replyRef: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE channel_threads SET consent_state = ?, updated_at = datetime('now')
      WHERE id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`,
  ).bind(state, threadId, guard.consentId, guard.replyRef, state);
}

function isUnique(err: unknown): boolean {
  return /UNIQUE constraint failed/i.test(err instanceof Error ? err.message : '');
}

/**
 * A reply that may be the interviewee's answer, on the thread of its chat.
 * Decides whether it counts (the header) and applies it in one batch: the
 * consent row, the thread's `consent_state`, the session's consent columns,
 * and for a decline the thread store's own statements. 'given' does not move
 * text: the caller queues `admitConsentedThread`.
 */
export async function recordReply(env: Env, thread: ThreadRow, reply: InboundConsentReply): Promise<ReplyOutcome> {
  if (reply.side !== 'contact') return ignored('not_from_contact');
  if (reply.provider !== thread.provider || String(reply.externalChatId).slice(0, 200) !== thread.external_chat_id) {
    return ignored('request_mismatch');
  }
  const replyRef = await refKey(reply.provider, reply.externalMessageId);
  if (await env.DB.prepare('SELECT 1 AS hit FROM channel_consents WHERE reply_ref_hash = ?').bind(replyRef).first()) {
    return ignored('duplicate');
  }
  const notices = await noticeState(env, thread);
  const contextRef = reply.contextMessageId ? await refKey(reply.provider, reply.contextMessageId) : null;
  const repliesToNotice = !!contextRef && notices.refs.has(contextRef);

  let row: ConsentRow | null;
  if (reply.via === 'button') {
    row = reply.requestUid
      ? await env.DB.prepare('SELECT * FROM channel_consents WHERE uid = ?').bind(reply.requestUid).first<ConsentRow>()
      : null;
    if (!row || Number(row.thread_id) !== Number(thread.id)) return ignored('request_mismatch');
    if (row.status !== 'requested' && row.status !== 'given') return ignored('request_closed');
    if (!repliesToNotice) return ignored('not_a_reply_to_notice');
  } else if (reply.provider === 'telegram') {
    // D756 §1.5: the request may be Axal's notice or the member's own pasted
    // copy (its ref is on the row). A YES or NO counts as a reply to it, or as
    // the contact's first message after it, within 7 days; a STOP after a YES
    // counts anywhere.
    row = await env.DB.prepare(
      `SELECT * FROM channel_consents WHERE thread_id = ? AND status IN ('requested', 'given') ORDER BY id DESC LIMIT 1`,
    ).bind(thread.id).first<ConsentRow>();
    if (!row) return ignored('request_closed');
    const askedAt = ms(row.requested_at);
    if (!Number.isFinite(askedAt)) return ignored('no_notice');
    if (!(row.status === 'given' && reply.answer === 'stop')) {
      if (Date.now() - askedAt > ANSWER_VALID_MS) return ignored('too_late');
      const toNotice = repliesToNotice || (!!contextRef && contextRef === row.request_ref_hash);
      // Both times are the Worker's, to the millisecond (`markRequested`, `bumpStatement`).
      const lastIn = ms(thread.last_inbound_at);
      const first = !Number.isFinite(lastIn) || lastIn <= askedAt;
      if (!toNotice && !first) return ignored('not_a_reply_to_notice');
    }
  } else {
    if (!notices.went) return ignored('no_notice');
    row = await env.DB.prepare(
      `SELECT * FROM channel_consents WHERE thread_id = ? AND status IN ('requested', 'given') ORDER BY id DESC LIMIT 1`,
    ).bind(thread.id).first<ConsentRow>();
    if (!row) return ignored('request_closed');
    if (reply.answer !== 'stop' && !repliesToNotice) return ignored('not_a_reply_to_notice');
  }

  if (row.status === 'given') {
    if (reply.answer === 'yes') return ignored('duplicate');
    return withdraw(env, thread, row, replyRef);
  }
  return reply.answer === 'yes' ? give(env, thread, row, replyRef) : decline(env, thread, row, replyRef);
}

async function give(env: Env, thread: ThreadRow, row: ConsentRow, replyRef: string): Promise<ReplyOutcome> {
  const sessionId = thread.session_id ?? row.session_id;
  try {
    const [res] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE channel_consents SET status = 'given', source = 'interviewee_reply', method = 'chat_reply',
                answered_at = datetime('now'), reply_ref_hash = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'requested'`,
      ).bind(replyRef, row.id),
      env.DB.prepare(`UPDATE channel_threads SET consent_state = 'given', updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`)
        .bind(thread.id, row.id, replyRef, 'given'),
      env.DB.prepare(
        `UPDATE interview_sessions SET consent_status = 'given', consent_method = 'chat_reply', consent_at = datetime('now'),
                updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`,
      ).bind(sessionId, row.id, replyRef, 'given'),
    ]);
    if (!Number(res?.meta?.changes ?? 0)) return ignored('duplicate');
  } catch (err) {
    if (isUnique(err)) return ignored('duplicate');
    throw err;
  }
  return { outcome: 'given', consent: (await env.DB.prepare('SELECT * FROM channel_consents WHERE id = ?').bind(row.id).first<ConsentRow>())! };
}

/**
 * A "No" or STOP while the request is open. Where the whole chat waits for
 * consent (WhatsApp), what waited is deleted and the chat set aside. Where
 * only its notes wait (Telegram, D756 §1.5), the notes stay undownloaded until
 * the 30-day purge and the text is untouched.
 */
async function decline(env: Env, thread: ThreadRow, row: ConsentRow, replyRef: string): Promise<ReplyOutcome> {
  const sessionId = thread.session_id ?? row.session_id;
  const guard = { consentId: row.id, replyRef };
  const aside = consentRequired(thread.provider)
    ? setAsideStatements(env, thread.id, 'declined', guard)
    : [stateStatement(env, thread.id, 'declined', guard)];
  const { withdrawDigest } = await import('../validateEngine');
  try {
    const res = await withdrawDigest(env, Number(sessionId ?? 0), Number(thread.user_id), { onlyDeclined: true, before: [
      env.DB.prepare(
        `UPDATE channel_consents SET status = 'declined', source = 'interviewee_reply', method = 'chat_reply',
                answered_at = datetime('now'), reply_ref_hash = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'requested'`,
      ).bind(replyRef, row.id),
      env.DB.prepare(
        `UPDATE interview_sessions SET consent_status = 'declined', consent_method = NULL, consent_at = NULL,
                updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`,
      ).bind(sessionId, row.id, replyRef, 'declined'),
      ...aside,
    ] });
    if (!res.claim_changed) return ignored('duplicate');
  } catch (err) {
    if (isUnique(err)) return ignored('duplicate');
    throw err;
  }
  return { outcome: 'declined', consent: (await env.DB.prepare('SELECT * FROM channel_consents WHERE id = ?').bind(row.id).first<ConsentRow>())! };
}

/**
 * A "No" or STOP after 'given' (D754 §4 decision 5): nothing new is kept —
 * the chat is set aside — the session reads declined with its method and time
 * cleared, as the recorder's PATCH does, and quotes are switched off. The
 * session's summary, digest and pending suggestions go (D757 `withdrawDigest`);
 * the transcript stays until the member discards the session.
 */
export async function withdraw(env: Env, thread: ThreadRow, row: ConsentRow, replyRef: string): Promise<ReplyOutcome> {
  const guard = { consentId: row.id, replyRef };
  // Telegram keeps raw text (D756); D757 #1930 removes the digest and quotes.
  const whole = consentRequired(thread.provider);
  const tail = whole
    ? [
      env.DB.prepare(`UPDATE discovery_interviews SET quote_consent = 0 WHERE id IN (?, ?) AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`)
        .bind(row.interview_id, thread.interview_id, row.id, replyRef, 'withdrawn'),
      ...setAsideStatements(env, thread.id, 'withdrawn', guard),
    ]
    : [stateStatement(env, thread.id, 'withdrawn', guard)];
  const { withdrawDigest } = await import('../validateEngine');
  try {
    const res = await withdrawDigest(env, Number(row.session_id ?? thread.session_id ?? 0), Number(thread.user_id), {
      onlyDeclined: true, otherSessionIds: thread.session_id == null ? [] : [Number(thread.session_id)], before: [
      env.DB.prepare(
        `UPDATE channel_consents SET status = 'withdrawn', withdrawn_at = datetime('now'), reply_ref_hash = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'given'`,
      ).bind(replyRef, row.id),
      env.DB.prepare(
        `UPDATE interview_sessions SET consent_status = 'declined', consent_method = NULL, consent_at = NULL,
                updated_at = datetime('now') WHERE id IN (?, ?) AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND reply_ref_hash = ? AND status = ?)`,
      ).bind(row.session_id, thread.session_id, row.id, replyRef, 'withdrawn'),
      ...tail,
    ] });
    if (!res.claim_changed) return ignored('duplicate');
  } catch (err) {
    if (isUnique(err)) return ignored('duplicate');
    throw err;
  }
  return { outcome: 'withdrawn', consent: (await env.DB.prepare('SELECT * FROM channel_consents WHERE id = ?').bind(row.id).first<ConsentRow>())! };
}

export type AttestOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; code: 'consent_not_offered' | 'attestation_not_offered' | 'consent_needs_interview' | 'notice_not_delivered' | 'interviewee_declined' | 'consent_withdrawn' };

/**
 * The member's word (`verbal`, `written` or `pre_agreed`), accepted only once
 * the provider reported a notice of the current version delivered or read,
 * and never after the interviewee declined or withdrew on this chat.
 */
export async function attest(env: Env, userId: number, thread: ThreadRow, method: MemberMethod): Promise<AttestOutcome> {
  if (!consentAsked(thread.provider)) return { ok: false, code: 'consent_not_offered' };
  // D756 ruling 6: on Telegram only the interviewee's own answer gives consent.
  if (!memberAttestationAllowed(thread.provider)) return { ok: false, code: 'attestation_not_offered' };
  if (thread.consent_state === 'given') return { ok: true, changed: false };
  const answered = await env.DB.prepare(
    `SELECT MAX(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) AS declined, MAX(CASE WHEN status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn
       FROM channel_consents WHERE thread_id = ?`,
  ).bind(thread.id).first<{ declined: number | null; withdrawn: number | null }>();
  if (Number(answered?.withdrawn)) return { ok: false, code: 'consent_withdrawn' };
  if (Number(answered?.declined)) return { ok: false, code: 'interviewee_declined' };
  if (!(thread.status === 'assigned' && thread.interview_id && thread.session_id)) return { ok: false, code: 'consent_needs_interview' };
  if (!(await noticeState(env, thread)).delivered) return { ok: false, code: 'notice_not_delivered' };
  // A re-link within the venture closed the request the notice went with; the notice still reached them.
  const row = await openRequest(env, thread, { interviewId: thread.interview_id, sessionId: thread.session_id });
  // The batch lands whole: each statement after the row's own update needs the row to read as this attestation.
  const [res] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE channel_consents SET status = 'given', source = 'member_attested', method = ?, answered_at = datetime('now'),
              updated_at = datetime('now') WHERE id = ? AND status = 'requested' AND user_id = ?`,
    ).bind(method, row.id, userId),
    env.DB.prepare(`UPDATE channel_threads SET consent_state = 'given', updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND status = 'given' AND source = 'member_attested' AND method = ?)`)
      .bind(thread.id, row.id, method),
    env.DB.prepare(
      `UPDATE interview_sessions SET consent_status = 'given', consent_method = ?, consent_at = datetime('now'),
              updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM channel_consents WHERE id = ? AND status = 'given' AND source = 'member_attested' AND method = ?)`,
    ).bind(method, thread.session_id, row.id, method),
  ]);
  return { ok: true, changed: Number(res?.meta?.changes ?? 0) > 0 };
}

export interface ConsentView {
  required: boolean;
  status: 'not_asked' | 'requested' | 'given' | 'declined' | 'withdrawn' | null;
  source: string | null; method: string | null; notice_version: number | null;
  requested_at: string | null; delivered_at: string | null; answered_at: string | null; withdrawn_at: string | null;
  notice_status: string | null;
  window_open: boolean; can_request: boolean; next_request_at: string | null; notices_left: number;
}

const NOT_REQUIRED: ConsentView = {
  required: false, status: null, source: null, method: null, notice_version: null,
  requested_at: null, delivered_at: null, answered_at: null, withdrawn_at: null, notice_status: null,
  window_open: false, can_request: false, next_request_at: null, notices_left: 0,
};

function viewOf(row: ConsentRow | null, status: ConsentView['status'], extra: Partial<ConsentView> = {}): ConsentView {
  return {
    ...NOT_REQUIRED, required: true, status,
    source: row?.source ?? null, method: row?.method ?? null, notice_version: row?.notice_version ?? null,
    requested_at: row?.requested_at ?? null, delivered_at: row?.delivered_at ?? null,
    answered_at: row?.answered_at ?? null, withdrawn_at: row?.withdrawn_at ?? null,
    ...extra,
  };
}

/** The thread's consent, for the member. No hash and no provider id leave here. */
export async function consentForThread(env: Env, thread: ThreadRow, now = Date.now()): Promise<ConsentView> {
  if (!consentAsked(thread.provider)) return NOT_REQUIRED;
  const row = await env.DB.prepare(
    `SELECT * FROM channel_consents WHERE thread_id = ? AND status <> 'expired' ORDER BY id DESC LIMIT 1`,
  ).bind(thread.id).first<ConsentRow>();
  const state = thread.consent_state ?? null;
  const status: ConsentView['status'] = state === 'given' || state === 'declined' || state === 'withdrawn' ? state
    : row?.status === 'requested' && state === 'awaiting' ? 'requested' : 'not_asked';
  const shown = status === 'not_asked' ? null : row;
  const notices = await noticeState(env, thread);
  const refusal = noticeRefusal(thread, notices, now);
  const isLinked = thread.status === 'assigned' && !!thread.interview_id && !!thread.session_id;
  return viewOf(shown, status, {
    notice_status: notices.latestStatus,
    window_open: replyWindowOpen(thread, now),
    // A WhatsApp chat is asked once linked (its notice names the venture); a Telegram chat may be asked while pending (D756 §1.5).
    can_request: (isLinked || !consentRequired(thread.provider)) && thread.status !== 'ignored' && status !== 'given' && !refusal,
    next_request_at: refusal?.code === 'too_soon' ? refusal.next_at ?? null : null,
    notices_left: Math.max(0, NOTICES_PER_VERSION - notices.used),
  });
}

/** A session's chat consent, or null for a session that is not a chat waiting on consent. */
export async function consentForSession(env: Env, sessionId: number): Promise<ConsentView | null> {
  const s = await env.DB.prepare('SELECT submitted_via, consent_status FROM interview_sessions WHERE id = ?').bind(sessionId)
    .first<{ submitted_via: string | null; consent_status: string }>();
  if (!s || !consentAsked(s.submitted_via)) return null;
  const thread = await env.DB.prepare('SELECT * FROM channel_threads WHERE session_id = ?').bind(sessionId).first<ThreadRow>();
  if (thread) return consentForThread(env, thread);
  const row = await env.DB.prepare(
    `SELECT * FROM channel_consents WHERE session_id = ? AND status <> 'expired' ORDER BY id DESC LIMIT 1`,
  ).bind(sessionId).first<ConsentRow>();
  if (!row) return viewOf(null, s.consent_status === 'declined' ? 'declined' : 'not_asked');
  return viewOf(row, row.status === 'expired' ? 'not_asked' : row.status);
}
