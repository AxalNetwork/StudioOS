/**
 * D860 (#2505) — WhatsApp calls: groundwork only, behind `WHATSAPP_CALLS`
 * (off unless exactly "true"). No call is answered, recorded or transcribed
 * here, and nothing here calls Meta.
 *
 * Read D860 first. In short: the numbers Axal onboards are coexistence
 * numbers, and calls on those stay in the WhatsApp Business app (D754 §3).
 * A call reaches the Calling API only on an API-only number, and then as a
 * WebRTC offer in a `calls` webhook. This file holds the two pieces every
 * later build needs and that can be tested without Meta:
 *
 *   normaliseCallEvents  a `calls` delivery read into events. The caller's SDP
 *                        is never copied: an event says only whether one came.
 *   decideCall           what Axal may do with a ring, consent first. Today
 *                        every path ends in `ignore` or `decline`; a decision
 *                        to ring needs a consent notice that names calls, and
 *                        none exists yet (CALL_NOTICE_VERSIONS is empty).
 *
 * The webhook's signature is `whatsapp.ts`'s `verifyWhatsAppSignature`, over
 * the raw body, as for messages: a `calls` change arrives in the same POST.
 * `normaliseWhatsAppPayload` ignores `calls` changes, so with the flag off a
 * call delivery moves nothing.
 */
import type { Env } from '../../types';
import type { ConsentView } from './consent';

/** On only when the setting is exactly "true". */
export function whatsappCallsEnabled(env: Env): boolean {
  return env.WHATSAPP_CALLS === 'true';
}

/**
 * Who must be told before a call is recorded. D860 §3: the default is every
 * party, whatever the jurisdiction's own rule, so one rule holds everywhere.
 */
export const RECORDING_RULE = 'all_party' as const;

/**
 * The consent-notice versions (consentNotice.ts) whose words name a recorded
 * call. A chat consent given to another version covers the chat's messages and
 * voice notes, never a call. Empty until the owner approves a notice for calls.
 */
export const CALL_NOTICE_VERSIONS: ReadonlySet<number> = new Set<number>();

export type CallEventKind = 'connect' | 'terminate' | 'status';

/** One call event from a `calls` change. Never the SDP, never a name. */
export interface CallEvent {
  callId: string;
  /** The business number's id the call reached (`metadata.phone_number_id`). */
  phoneNumberId: string;
  /** The other party's WhatsApp id: used to find the chat's consent, never logged. */
  contact: string | null;
  event: CallEventKind;
  direction: 'user_initiated' | 'business_initiated' | null;
  /** True when the event carried an SDP offer or answer. */
  hasSdp: boolean;
  status: string | null;
  /** Seconds, from a terminate event; null when not reported. */
  durationSec: number | null;
  at: string;
}

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v.slice(0, 200) : []);
const idStr = (v: unknown): string | null => (typeof v === 'number' || (typeof v === 'string' && v.trim()) ? String(v).trim().slice(0, 200) : null);
const word = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z_]{1,40}$/.test(v) ? v.toUpperCase() : null);

const DIRECTIONS: Record<string, CallEvent['direction']> = {
  USER_INITIATED: 'user_initiated', BUSINESS_INITIATED: 'business_initiated',
};

/**
 * Every call event in a delivery: `entry[].changes[]` with `field: "calls"`,
 * `value.calls[]` (connect and terminate) and `value.statuses[]` of type
 * `call`. The field names follow Meta's partners' copies of the Calling docs
 * (D860 §1, unverified against Meta's own page); a shape this does not know is
 * skipped, never guessed.
 */
export function normaliseCallEvents(body: unknown): CallEvent[] {
  const out: CallEvent[] = [];
  if (obj(body)?.object !== 'whatsapp_business_account') return out;
  for (const entry of arr(obj(body)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const ch = obj(change);
      if (ch?.field !== 'calls') continue;
      const value = obj(ch.value);
      const phoneNumberId = idStr(obj(value?.metadata)?.phone_number_id);
      if (!phoneNumberId) continue;
      for (const c of arr(value?.calls)) {
        const call = obj(c);
        const callId = idStr(call?.id);
        const event = call?.event === 'connect' || call?.event === 'terminate' ? call.event as CallEventKind : null;
        if (!callId || !event) continue;
        const duration = Number(call?.duration);
        out.push({
          callId, phoneNumberId,
          contact: idStr(call?.direction === 'BUSINESS_INITIATED' ? call?.to : call?.from),
          event,
          direction: DIRECTIONS[String(call?.direction ?? '')] ?? null,
          hasSdp: typeof obj(call?.session)?.sdp === 'string' && obj(call?.session)!.sdp.length > 0,
          status: word(call?.status),
          durationSec: event === 'terminate' && Number.isInteger(duration) && duration >= 0 ? duration : null,
          at: isoFromUnix(call?.timestamp),
        });
      }
      for (const s of arr(value?.statuses)) {
        const st = obj(s);
        const callId = idStr(st?.id);
        if (!callId || st?.type !== 'call') continue;
        out.push({
          callId, phoneNumberId, contact: idStr(st?.recipient_id), event: 'status', direction: null,
          hasSdp: false, status: word(st?.status), durationSec: null, at: isoFromUnix(st?.timestamp),
        });
      }
    }
  }
  return out;
}

function isoFromUnix(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

export type CallDecision =
  | { action: 'ignore'; reason: 'calls_off' | 'not_a_ring' }
  | { action: 'decline'; reason: 'no_offer' | 'no_consent' | 'notice_not_for_calls' | 'not_built' };

/**
 * What Axal may do with one call event, before any media. Consent first
 * (D754): a ring is declined unless the chat's consent was given, under a
 * notice that names recorded calls. Today the last step always declines:
 * the media path (D860 §2) is not built, and nothing here answers a call.
 */
export function decideCall(
  env: Env,
  ev: Pick<CallEvent, 'event' | 'hasSdp' | 'direction'>,
  consent: Pick<ConsentView, 'status' | 'notice_version'> | null,
  callNoticeVersions: ReadonlySet<number> = CALL_NOTICE_VERSIONS,
): CallDecision {
  if (!whatsappCallsEnabled(env)) return { action: 'ignore', reason: 'calls_off' };
  if (ev.event !== 'connect' || ev.direction !== 'user_initiated') return { action: 'ignore', reason: 'not_a_ring' };
  if (!ev.hasSdp) return { action: 'decline', reason: 'no_offer' };
  if (!consent || consent.status !== 'given') return { action: 'decline', reason: 'no_consent' };
  if (consent.notice_version == null || !callNoticeVersions.has(consent.notice_version)) {
    return { action: 'decline', reason: 'notice_not_for_calls' };
  }
  return { action: 'decline', reason: 'not_built' };
}
