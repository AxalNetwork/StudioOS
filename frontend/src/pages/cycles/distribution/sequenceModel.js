/** D4493 (#4493): pure sequence copy, consent pills, blocked reasons, due counts and the hold line. Counts come from data only. */
import { holdLine } from './distributionAskModel.js';

/** The Worker's fixed reasons (services/distribution/sequences.ts), repeated for drawing; the Worker refuses these steps. */
export const BLOCKED_STEPS = Object.freeze([
  { channel: 'linkedin', label: 'LinkedIn message', reason: 'Needs LinkedIn’s approval.' },
  { channel: 'whatsapp', label: 'WhatsApp', reason: 'Only to contacts who wrote first or opted in · after counsel’s review.' },
  { channel: 'telegram', label: 'Telegram', reason: 'Only to contacts who wrote first or opted in · after counsel’s review.' },
]);
export const NO_SMS = 'There is no SMS step.';
export const AI_VOICE_LABEL = 'AI voice · disclosed';
export const AI_VOICE = 'Not offered';
export const OWN_RECORDING = 'Your own recording';
export const SEND_LIMIT = 'From your own mailbox · up to 20 sends an hour';
export const CONSENT_RULE = 'A step on a channel without consent is blocked, with its reason.';
export const STOPS_LINE = 'stops when someone replies or opts out.';
export const OPTOUT_LINE = 'one-click opt-out in every message';
export const NEVER_SENDS = 'Each due step becomes a draft. Nothing sends until you press Send.';
export const OFFERED = Object.freeze([{ channel: 'email', label: 'Email' }, { channel: 'voice', label: 'Voice note' }]);

const CHANNELS = { email: 'Email', voice: 'Voice note', linkedin: 'LinkedIn message', whatsapp: 'WhatsApp', telegram: 'Telegram' };
export const channelLabel = (channel) => CHANNELS[channel] ?? 'Not recorded';
export const blockedReason = (channel) => BLOCKED_STEPS.find((b) => b.channel === channel)?.reason ?? null;

/** Consent pills, per basis. A blocked channel is never drawn as consent. */
const PILLS = {
  opted_in: { label: 'Opted in', tone: 'positive' },
  wrote_first: { label: 'Wrote first', tone: 'lavender' },
  none: { label: 'No consent', tone: 'negative' },
  blocked: { label: 'Blocked', tone: 'muted' },
};
export const consentPill = (basis) => PILLS[basis] ?? PILLS.none;
/** The step's own pill: the channel's consent requirement, or its block. */
export function stepPill(step) {
  if (blockedReason(step?.channel)) return { label: step.channel === 'linkedin' ? 'Blocked · needs approval' : 'Blocked · no consent', tone: 'negative' };
  return { label: step?.channel === 'voice' ? 'Consent: email and voice' : 'Consent: email', tone: 'positive' };
}

const STATES = {
  due: { label: 'Due', tone: 'positive' }, waiting: { label: 'Waiting', tone: 'muted' }, held: { label: 'Held', tone: 'amber' },
  blocked: { label: 'Skipped', tone: 'amber' }, suppressed: { label: 'Suppressed', tone: 'negative' },
  stopped_replied: { label: 'Replied · stopped', tone: 'lavender' }, stopped_optout: { label: 'Opted out · stopped', tone: 'muted' }, done: { label: 'Done', tone: 'muted' },
};
export const rowState = (state) => STATES[state] ?? { label: 'Not recorded', tone: 'muted' };

export function waitLabel(step, index) {
  const n = step?.wait_days;
  if (!Number.isInteger(n)) return 'Wait: Not recorded';
  if (index === 0) return n ? `${n} ${n === 1 ? 'day' : 'days'} after enrolling` : 'When enrolled';
  return `If no reply in ${n} ${n === 1 ? 'day' : 'days'}`;
}

/** "Quiet hours 20:00–08:00 · suppression list 14 · one-click opt-out in every message", from data only. */
export function sequenceSubtitle(detail) {
  const quiet = detail?.quiet_hours ? `Quiet hours ${detail.quiet_hours.quiet_from}–${detail.quiet_hours.quiet_to}` : 'Quiet hours: Not recorded';
  const list = Number.isSafeInteger(detail?.suppressions) ? `suppression list ${detail.suppressions}` : 'suppression list: Not recorded';
  return `${quiet} · ${list} · ${OPTOUT_LINE}`;
}
export function prospectsLine(detail) {
  const n = detail?.counts?.enrolled;
  return Number.isSafeInteger(n) ? `${n} ${n === 1 ? 'prospect' : 'prospects'} · ${STOPS_LINE}` : `Prospects: Not recorded · ${STOPS_LINE}`;
}
/** Due rows from a read; null when the read failed (never zero). */
export function dueCount(reading) { return Array.isArray(reading?.rows) ? reading.rows.filter((r) => r?.state === 'due').length : null; }
export const dueButton = (n) => `${n} ${n === 1 ? 'step' : 'steps'} due · Review and send`;

/** The Ask's hold line, always with the AI-voice disclosure promise; no AI voice is offered. */
export const sequenceHoldLine = (estimate) => `${holdLine(estimate)} · an AI voice is always disclosed in the message`;

/** "[Prospect I] is skipped: no consent to email was recorded." from the consent rows. */
export function consentCaption(rows, steps) {
  const lines = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = r.contact_name || 'A prospect';
    const cells = Array.isArray(r.consent) ? r.consent : [];
    const email = cells.find((c) => c.channel === 'email');
    const voice = cells.find((c) => c.channel === 'voice');
    if (email && email.basis === 'none') lines.push(`${name} is skipped: no consent to email was recorded.`);
    else if (voice && voice.basis === 'none' && steps?.some((s) => s.channel === 'voice')) lines.push(`${name} gets no voice note: no consent to a voice note was recorded.`);
  }
  return lines;
}

/** The Overview's "This week" STEP items for one day (YYYY-MM-DD, UTC), due or waiting. */
export function stepsOn(reading, date) {
  if (!Array.isArray(reading?.rows)) return [];
  return reading.rows.filter((r) => (r.state === 'due' || r.state === 'waiting' || r.state === 'held') && typeof r.due_at === 'string' && r.due_at.slice(0, 10) === date);
}

/** Sequence proposal: email steps only, from a D4488 payload. */
export function proposedSequence(proposal) {
  const v = proposal?.decided_payload ?? proposal?.payload;
  return v?.kind === 'sequence' && v.values && Array.isArray(v.values.steps) ? v.values : null;
}
