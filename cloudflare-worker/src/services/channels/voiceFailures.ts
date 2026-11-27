/**
 * D685 S19 (#1586) — a voice note that could not be transcribed, told to the
 * member on its thread in plain words.
 *
 * Since 451 a voice note waits as a placeholder on its thread until a
 * `channel_followup` job transcribes it (threads.ts). When the job cannot, it
 * gives the note back with a code (`channel_thread_messages.transcribe_error`,
 * migration 454), and this file turns the code into what the thread read says:
 *
 *   budget        the member's AI budget (D640) was spent
 *   ai_off        AI was switched off on Axal (the org kill switch)
 *   daily_cap     the connection's daily transcription cap was reached
 *   too_large     the file is over 5 MB, the recorder's chunk (D756)
 *   unsupported_format  the file is not MP3, M4A, OGG, WAV or WebM audio, or
 *                 its bytes do not match the type it declares (D756)
 *   video_note_unsupported  a round video message: not transcribed yet (D756)
 *   unreadable    the file could not be fetched or read
 *   expired       WhatsApp refused an old media id at lookup; never queued again
 *   reconnect     the account's connection had expired
 *   bot_off       the Axal bot is switched off for the member's Telegram
 *                 Business account (D756)
 *   unreachable   Telegram or Meta did not answer, after every try
 *   not_transcribed  transcription did not answer, after every try
 *   retrying      Telegram, Meta or transcription did not answer yet; the job
 *                 still holds the note and tries again
 *   no_consent    the chat waits for the interviewee's consent (D754, #1893):
 *                 nothing is fetched until it is given, and then the note is
 *                 queued by itself, so no retry is offered
 *
 * Nothing here returns message text, provider text, a file id or a phone
 * number: a code, our sentence, and whether a retry is offered.
 */
import type { Env } from '../../types';
import { loadAiBudget } from '../aiBudget';
import { IntakeError } from '../interviewIntake';
import { inInterview, queueVoiceTranscriptions, threadForReply } from './threads';
import { audioConsentRequired, type MessagingProvider } from './types';

/** How many times the follow-up tries a provider or transcription that does not answer, and the wait before each next try (seconds). */
export const VOICE_TRIES = 4;
export const VOICE_RETRY_DELAYS = [60, 300, 900] as const;

/** The codes the follow-up records while it still holds the note and will try again. */
export const STILL_TRYING = new Set(['provider_unreachable', 'transcription_unavailable']);

export type VoiceReason =
  | 'budget' | 'ai_off' | 'daily_cap' | 'too_large' | 'unreadable' | 'reconnect'
  | 'unreachable' | 'not_transcribed' | 'retrying' | 'bot_off' | 'no_consent' | 'expired'
  | 'unsupported_format' | 'video_note_unsupported';

const PROVIDER_NAME: Record<MessagingProvider, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp' };
const PROVIDER_HOST: Record<MessagingProvider, string> = { telegram: 'Telegram', whatsapp: 'Meta' };
/** D756 (#1896): Telegram's, and D754 §6's own words for WhatsApp. */
const TOO_LARGE: Record<MessagingProvider, string> = {
  telegram: 'This file is over 5 MB. Axal takes up to 5 MB per note from Telegram for now.',
  whatsapp: 'This recording is larger than Axal can take from WhatsApp (5 MB). Record it with the in-app recorder instead.',
};

/** The reason for a note's code; `held` is whether a job still holds the note. Null when there is nothing to say. */
export function voiceReason(error: string | null, held: boolean): VoiceReason | null {
  const code = String(error ?? '');
  if (!code) return null;
  if (held) return STILL_TRYING.has(code) ? 'retrying' : null;
  if (/^budget_/.test(code)) return 'budget';
  if (code === 'kill_switch') return 'ai_off';
  if (code === 'transcription_cap') return 'daily_cap';
  if (code === 'too_large') return 'too_large';
  if (code === 'expired') return 'expired';
  if (code === 'token_invalid' || code === 'not_connected') return 'reconnect';
  if (code === 'connection_disabled') return 'bot_off';
  if (code === 'provider_unreachable') return 'unreachable';
  if (code === 'transcription_unavailable') return 'not_transcribed';
  if (code === 'no_consent') return 'no_consent';
  if (code === 'unsupported_format') return 'unsupported_format';
  if (code === 'video_note_unsupported') return 'video_note_unsupported';
  return 'unreadable';
}

/** Our sentence for a reason. Never the provider's words. */
export function voiceSentence(reason: VoiceReason, provider: MessagingProvider): string {
  const name = PROVIDER_NAME[provider] ?? 'the provider';
  const host = PROVIDER_HOST[provider] ?? 'The provider';
  switch (reason) {
    case 'budget': return 'Your AI budget was spent, so this voice note was not transcribed.';
    case 'ai_off': return 'AI transcription was switched off on Axal, so this voice note was not transcribed.';
    case 'daily_cap': return `This ${name} account reached its voice notes for today, so this one waits. Retry it tomorrow.`;
    case 'too_large': return TOO_LARGE[provider] ?? 'This file is over 5 MB, so it was not transcribed.';
    case 'expired': return 'WhatsApp keeps a voice note for 7 days; this one can no longer be fetched.';
    case 'unreadable': return 'The audio could not be read, so this voice note was not transcribed.';
    case 'reconnect': return `The connection to your ${name} account had expired, so the voice note could not be fetched. Connect it again in Account › Connectors.`;
    case 'unreachable': return `${host} could not be reached to fetch this voice note, after several tries.`;
    case 'not_transcribed': return 'Transcription did not answer, after several tries, so this voice note was not transcribed.';
    case 'retrying': return 'This voice note could not be transcribed yet. Axal tries again in a few minutes.';
    case 'bot_off': return 'The Axal bot is switched off for your Telegram Business account, so this voice note was not fetched. Turn it back on in Telegram › Settings › Telegram Business › Chatbots, then retry.';
    case 'no_consent': return 'This voice note waits until consent is given in the chat. Axal fetches it only then.';
    case 'unsupported_format': return 'Axal can transcribe MP3, M4A, OGG, WAV and WebM audio only, so this file was not transcribed.';
    case 'video_note_unsupported': return "Round video messages can't be transcribed yet.";
  }
}

/**
 * The reasons a member can retry: the budget (checked first), the kill switch
 * (likewise), the day's cap and the switched-off bot (the job checks each).
 */
const RETRYABLE = new Set<VoiceReason>(['budget', 'ai_off', 'daily_cap', 'unreachable', 'not_transcribed', 'bot_off']);
const NEEDS_BUDGET = new Set<VoiceReason>(['budget', 'ai_off']);

/**
 * Whether the member's budget allows a run now: nothing held for review, and
 * some included allowance or paid balance left. Null when it cannot be read;
 * then no retry is offered rather than a guess.
 */
export async function budgetAllows(env: Env, userId: number): Promise<boolean | null> {
  try {
    const b = await loadAiBudget(env, userId);
    if (b.held_for_review.length) return false;
    const day = b.daily_microusd - b.day_spend_microusd - b.day_reserved_microusd;
    const month = b.monthly_microusd - b.month_spend_microusd - b.month_reserved_microusd;
    return Math.max(0, Math.min(day, month)) + b.balance_microusd > 0;
  } catch {
    return null;
  }
}

export interface TranscriptionFailure {
  reason: VoiceReason;
  sentence: string;
  /**
   * 'available'     the retry route will queue it now;
   * 'after_budget'  it waits for the budget to allow a run;
   * 'unknown'       the budget could not be read;
   * 'after_assign'  the chat is not in an interview: assigning it queues the note;
   * null            no retry exists for this reason.
   */
  retry: 'available' | 'after_budget' | 'unknown' | 'after_assign' | null;
}

/**
 * Each waiting voice note's failure, by message uid, for one of the member's
 * threads. The thread is matched on its uid AND the member.
 */
export async function transcriptionFailures(
  env: Env, userId: number, threadUid: string,
): Promise<Map<string, TranscriptionFailure>> {
  const rows = (await env.DB.prepare(
    `SELECT m.uid, m.transcribe_error, m.transcribe_job IS NOT NULL AS held, t.provider, t.status, t.session_id
       FROM channel_thread_messages m JOIN channel_threads t ON t.id = m.thread_id
      WHERE t.uid = ? AND t.user_id = ? AND m.voice_ref_enc IS NOT NULL AND m.transcribe_error IS NOT NULL
      LIMIT 500`,
  ).bind(threadUid, userId).all<{ uid: string; transcribe_error: string; held: number; provider: MessagingProvider; status: string; session_id: number | null }>()).results ?? [];
  const out = new Map<string, TranscriptionFailure>();
  let allows: boolean | null | undefined;
  for (const r of rows) {
    const reason = voiceReason(r.transcribe_error, !!Number(r.held));
    if (!reason) continue;
    let retry: TranscriptionFailure['retry'] = null;
    if (RETRYABLE.has(reason)) {
      if (!(r.status === 'assigned' && r.session_id)) retry = 'after_assign';
      else if (NEEDS_BUDGET.has(reason)) {
        if (allows === undefined) allows = await budgetAllows(env, userId);
        retry = allows === null ? 'unknown' : allows ? 'available' : 'after_budget';
      } else retry = 'available';
    }
    out.set(r.uid, { reason, sentence: voiceSentence(reason, r.provider), retry });
  }
  return out;
}

/**
 * Transcribe one waiting voice note again, at the member's request: a note
 * given back for the budget, the kill switch, the day's cap, or a provider or
 * transcription that never answered. The budget is checked first for the two
 * that need it. The note is queued through threads.ts, which claims it for one
 * job (and clears its error), so two presses never queue it twice.
 */
export async function retryVoiceNote(env: Env, userId: number, threadUid: string, messageUid: string): Promise<{ queued: number }> {
  const thread = await threadForReply(env, userId, threadUid);
  const row = await env.DB.prepare(
    `SELECT transcribe_error, transcribe_job FROM channel_thread_messages
      WHERE uid = ? AND thread_id = ? AND voice_ref_enc IS NOT NULL`,
  ).bind(messageUid, thread.id).first<{ transcribe_error: string | null; transcribe_job: string | null }>();
  if (!row) throw new IntakeError(404, 'voice_not_found', 'That voice note is not waiting on this conversation.');
  const reason = voiceReason(row.transcribe_error, row.transcribe_job != null);
  if (reason === 'no_consent' || (audioConsentRequired(thread.provider) && thread.consent_state !== 'given')) {
    throw new IntakeError(409, 'no_consent', 'This voice note waits until consent is given in the chat. Axal fetches it only then.');
  }
  if (!reason || !RETRYABLE.has(reason)) throw new IntakeError(409, 'voice_not_retryable', 'This voice note cannot be retried.');
  if (!inInterview(thread)) {
    throw new IntakeError(409, 'voice_not_assigned', 'Assign this conversation to an interview first; its voice notes are transcribed then.');
  }
  if (NEEDS_BUDGET.has(reason)) {
    const allows = await budgetAllows(env, userId);
    if (allows === null) throw new IntakeError(503, 'budget_unreadable', 'Your AI budget could not be read just now. Try again in a minute.');
    if (!allows) throw new IntakeError(402, 'budget_spent', 'Your AI budget is still spent. Try again once it renews, or after a top-up.');
  }
  const queued = await queueVoiceTranscriptions(env, thread, { only: messageUid });
  if (!queued) throw new IntakeError(409, 'voice_busy', 'That voice note is already being transcribed.');
  return { queued };
}

/** D754 §6: the inbound media lifetime is one assumption to re-check with Meta. Telegram documents no deadline. */
export const MEDIA_FETCH_DAYS: Record<MessagingProvider, number | null> = { whatsapp: 7, telegram: null };

/** D1's timestamp without an offset is UTC, just like an ISO timestamp with Z. */
export const channelTimestampMs = (s: string | null | undefined) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

/** A display deadline only: the clock itself never prevents a fetch. */
export function voiceFetchBy(provider: MessagingProvider, msg: { awaiting_transcription: boolean; sent_at: string }): string | null {
  const days = MEDIA_FETCH_DAYS[provider];
  if (!msg.awaiting_transcription || days == null) return null;
  const sent = channelTimestampMs(msg.sent_at);
  return Number.isFinite(sent) ? new Date(sent + days * 86_400_000).toISOString() : null;
}
