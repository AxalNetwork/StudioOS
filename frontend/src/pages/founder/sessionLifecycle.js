/**
 * D1455 (#3710, REC1, REC2, REC6): one session's life as one status.
 *
 * A call Eadwyn AI joined has a bot state (`GET /sessions/:id/bot`, D886) and
 * a processing state (`processing` on `GET /sessions/:id`, #3711). The page
 * drew them as two cards; this merges them into one stepper:
 *   Scheduled → Joining → Waiting to be admitted → Recording → Uploading →
 *   Transcribing → Summarising → Placing → Ready.
 * A session with no bot (this device, an import) starts at Recording.
 *
 * Every step is read, never guessed:
 *   · an unknown bot status or processing stage gives `current: null` and
 *     `unreadable: true`, drawn "Unreadable", never Ready;
 *   · a failed bot marks the step its failure code belongs to;
 *   · a failed processing run marks `processing.failed_stage` when the Worker
 *     sends it (#3710 W2, migration 760); without it the failure is drawn
 *     with no step marked ("at a step not recorded"), never a guessed one.
 * Pure: no React, no read.
 */
export const STEPS = Object.freeze([
  { key: 'scheduled', label: 'Scheduled', bot: true },
  { key: 'joining', label: 'Joining', bot: true },
  { key: 'waiting', label: 'Waiting to be admitted', bot: true },
  { key: 'recording', label: 'Recording' },
  { key: 'uploading', label: 'Uploading' },
  { key: 'transcribing', label: 'Transcribing' },
  { key: 'summarising', label: 'Summarising' },
  { key: 'placing', label: 'Placing' },
  { key: 'ready', label: 'Ready' },
]);

const BOT_STEP = Object.freeze({ queued: 'scheduled', joining: 'joining', waiting_room: 'waiting', recording: 'recording' });
// The step a bot failure code belongs to; a code not listed fails at Joining.
const BOT_FAIL_STEP = Object.freeze({
  schedule_missed: 'scheduled',
  runtime_unavailable: 'joining', link_invalid: 'joining', platform_blocked: 'joining', obf_unavailable: 'joining',
  admission_refused: 'waiting', not_admitted: 'waiting',
  heartbeat_timeout: 'recording', meeting_ended: 'recording', no_audio: 'recording',
});
const PROCESSING = new Set(['uploading', 'transcribing', 'summarising', 'placing']);
const READY_STATUS = new Set(['transcribed', 'structured', 'reviewed']);
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);

/**
 * `{ steps, current, failedAt, failed, unreadable, kind }`.
 *   bot         the bot DTO (`read.bot`), or null when the session has none
 *   session     the session row (`status`)
 *   processing  `{ stage, failed_stage?, error? }` or null
 * `kind` is 'bot' or 'processing' when something failed, else null.
 */
export function lifecycle({ bot = null, session = null, processing = null } = {}) {
  const steps = STEPS.filter((s) => (bot ? true : !s.bot));
  let current = null;
  let failedAt = null;
  let failed = false;
  let unreadable = false;
  let kind = null;
  const stage = processing?.stage ?? null;

  if (bot && bot.status === 'failed') {
    failed = true; kind = 'bot';
    failedAt = own(BOT_FAIL_STEP, bot.failure_code) ? BOT_FAIL_STEP[bot.failure_code] : 'joining';
  } else if (stage === 'failed') {
    failed = true; kind = 'processing';
    failedAt = PROCESSING.has(processing?.failed_stage) ? processing.failed_stage : null;
  } else if (PROCESSING.has(stage)) {
    current = stage;
  } else if (bot && own(BOT_STEP, bot.status)) {
    current = BOT_STEP[bot.status];
  } else if (stage === 'done' || READY_STATUS.has(session?.status)) {
    current = 'ready';
  } else if (bot && ['processing', 'done', 'stopped'].includes(bot.status)) {
    // The bot is done with the call; processing has not been read yet.
    current = bot.status === 'processing' ? 'uploading' : null;
    unreadable = current === null && !READY_STATUS.has(session?.status);
  } else if (!bot && ['recording', 'paused'].includes(session?.status)) {
    current = 'recording';
  } else {
    unreadable = true;
  }

  const at = failed ? failedAt : current;
  const index = at ? steps.findIndex((s) => s.key === at) : -1;
  return {
    steps: steps.map((s, i) => ({
      key: s.key, label: s.label,
      state: failed && s.key === failedAt ? 'failed'
        : !failed && s.key === current ? (s.key === 'ready' ? 'done' : 'current')
          : index >= 0 && i < index ? 'done' : 'todo',
    })),
    current, failedAt, failed, unreadable, kind,
  };
}

/** REC6, a phone: the stepper collapsed to "[4 of 9] · Recording". */
export function stepLine(view) {
  const at = view.failed ? view.failedAt : view.current;
  const i = view.steps.findIndex((s) => s.key === at);
  if (view.unreadable) return 'Unreadable';
  if (view.failed && i < 0) return 'Failed at a step not recorded';
  if (i < 0) return 'Not started';
  return `${i + 1} of ${view.steps.length} · ${view.steps[i].label}${view.failed ? ' · failed' : ''}`;
}

/**
 * REC2: the failure in plain words, with its likely causes and what to do.
 * `botFailure` is `botView(...).failure` (D886's words); a processing failure
 * uses the Worker's own sentence, else the safe default. Codes and times go
 * to "See details" only, never into the sentence.
 */
const CAUSES = Object.freeze({
  scheduled: ['The call started before Eadwyn AI was sent', 'The scheduled time passed'],
  joining: ['The meeting link changed or expired', 'The platform blocks outside participants'],
  waiting: ['Nobody admitted Eadwyn AI from the lobby', 'The host only admits invited guests'],
  recording: ['The host ended the meeting', 'The connection dropped'],
  uploading: ['The connection dropped while saving'],
  transcribing: ['The transcription service did not answer in time'],
  summarising: ['The summary model did not answer in time'],
  placing: ['The placement step did not finish'],
});
export function failureView(view, { botFailure = null, processingError = null } = {}) {
  if (!view?.failed) return null;
  const title = view.kind === 'bot'
    ? (botFailure || 'Eadwyn AI could not record this call.')
    : (processingError || 'Processing stopped. Your audio is safe.');
  return {
    title,
    causes: view.failedAt ? (CAUSES[view.failedAt] || []) : [],
    retry: view.kind === 'processing' ? 'process' : 'new-session',
  };
}

/**
 * REC5: money in two decimals; the full value is kept for a hover. Null stays
 * null, never $0.00, and a charge under half a cent reads "< $0.01", never
 * "$0.00", which would say nothing was charged.
 */
export function money(micro) {
  if (micro === null || micro === undefined || micro === '' || !Number.isFinite(Number(micro))) return null;
  const usd = Number(micro) / 1e6;
  return { text: usd > 0 && usd < 0.005 ? '< $0.01' : `$${usd.toFixed(2)}`, full: `$${usd.toFixed(4)}` };
}
