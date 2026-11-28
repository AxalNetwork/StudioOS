// D886 B7 (#2585): layout-independent contract for the founder's bot controls.
// Mounted by MeetingBotPanel in the existing Record a Session look (S1 ruling). The adapter is
// injected: this module neither fetches a route nor starts a device recorder.

const WORDS = Object.freeze({
  queued: 'Queued',
  joining: 'Joining the call',
  waiting_room: 'Waiting to be admitted',
  recording: 'Recording',
  processing: 'Processing the recording',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
});
const STOPPABLE = new Set(['queued', 'joining', 'waiting_room', 'recording']);
// #2582: Zoom joins on the founder's behalf, so Eadwyn AI cannot enter until they have.
// The Worker's read says so with `waiting_for: 'founder'`; the status stays `waiting_room`.
const WAITING_FOR_FOUNDER = 'Join the call first; Eadwyn AI follows.';
const FAILURES = Object.freeze({
  runtime_unavailable: 'Eadwyn AI is temporarily unavailable. Check the session before trying again.',
  heartbeat_timeout: 'The connection to Eadwyn AI was interrupted.',
  schedule_missed: 'The scheduled start was missed. Schedule the call again.',
  admission_refused: 'Eadwyn AI was not admitted. Ask the host to check the waiting room.',
  not_admitted: 'Eadwyn AI was not admitted. Ask the host to check the waiting room.',
  no_audio: 'Eadwyn AI joined, but no audio was stored. No transcript was created. Start a new recording.',
  meeting_ended: 'The meeting ended before Eadwyn AI could finish recording.',
  link_invalid: 'Eadwyn AI could not use this meeting link. Check it and try again.',
  platform_blocked: 'The meeting platform did not allow Eadwyn AI to join.',
  obf_unavailable: 'Zoom authorization is required. Reconnect Zoom and join the meeting before sending Eadwyn AI.',
  // D5813: the bot leaves without recording when it cannot post its notice (B2, notice before capture).
  notice_failed: 'Eadwyn AI was admitted but could not post its recording notice in the meeting chat, so it left without recording.',
  processing_failed: 'Eadwyn AI recorded the call, but the recording could not be saved for processing.',
});
// D5813 (D1451 part 3): a Teams admission that never came, said in Teams' own word for the waiting room.
const TEAMS_NOT_ADMITTED = 'Eadwyn AI was not admitted from the Teams lobby. Ask the organizer to admit it from the lobby, or to let guests skip the lobby, then try again with a new session.';
/**
 * D5813 (D1451 part 3): the three Teams refusals the Worker recognises
 * (`bot.blocked`, from the bot's allowlisted stage). Each says what happened,
 * its one likely cause, and what the organizer can do; captcha has no
 * organizer action, only the fallback. Any other `blocked` value is ignored
 * and the member keeps the generic failure. Never a provider sentence or code.
 */
export const TEAMS_BLOCKED = Object.freeze({
  guests_off: Object.freeze({
    failure: 'This Teams meeting does not let anonymous guests join, so Eadwyn AI could not enter. Nothing was recorded.',
    cause: 'The organizer’s Teams settings turn off anonymous join',
    organizer: 'Ask the organizer, or their Teams admin, to let anonymous users join meetings, then try again with a new session.',
  }),
  bot_blocked: Object.freeze({
    failure: 'This Teams organization blocks meeting bots, so Eadwyn AI was turned away. Nothing was recorded.',
    cause: 'The organizer’s Teams admin blocks detected bots from meetings',
    organizer: 'Ask the organizer’s Teams admin to allow Eadwyn AI in their meetings, then try again with a new session.',
  }),
  captcha: Object.freeze({
    failure: 'Teams asked Eadwyn AI to solve a verification challenge. Eadwyn AI never answers one, so it did not join. Nothing was recorded.',
    cause: 'Teams challenged the guest with a verification check',
    organizer: null,
  }),
});
/**
 * D5813: Eadwyn AI's Teams capability in one set of words, shared with the
 * Teams connector page (`teamsConnector.js`, D5810) and the run view, so the
 * two never disagree: on, it joins as a guest; off, the fallback.
 */
export const TEAMS_BOT_GUEST = 'Eadwyn AI joins Teams calls as a guest with the meeting link, whichever account hosts it. It does not need your Microsoft connection.';
export const TEAMS_BOT_OFF = 'Upload the recording or paste the transcript after the call.';
// D5153 (#5153): the runtime never reported, so the meeting provider was never contacted.
// Said plainly, with no provider cause; the operator's code stays in HQ.
export const INFRASTRUCTURE_FAILURE = 'Eadwyn AI’s recording service did not start, so the meeting was not contacted and nothing was recorded. Try again in a few minutes.';
const REFUSALS = Object.freeze({
  bot_unavailable: 'Eadwyn AI is not available on this deployment yet. You can choose Record this device.',
  bot_price_unavailable: 'Eadwyn AI is not available until its price has been measured.',
  ai_paused: 'AI is paused on this account. Contact support.',
  budget_review: 'An earlier AI charge needs review before another call can start.',
  invalid_schedule: 'Choose a call time in the next seven days.',
  session_in_use: 'Create a fresh session for Eadwyn AI.',
  audio_removed: 'This session’s recording was removed. Create a new session.',
  bot_stop_pending: 'Eadwyn AI is still stopping. Read its status before trying again.',
  consent_required: 'Record the interviewee’s agreement before sending Eadwyn AI.',
  unsupported_link: 'Use a Zoom, Google Meet or Microsoft Teams meeting link. A Google Meet link looks like https://meet.google.com/abc-defg-hij.',
  bot_already_running: 'Eadwyn AI is already assigned to this session. Check its status before trying again.',
});
const own = (object, key) => typeof key === 'string' && Object.hasOwn(object, key);
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0;

/** Candidate selection only; B1 must validate the link again before dispatch. */
export function botPlatform(raw) {
  if (typeof raw !== 'string') return null;
  let url;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname === '/') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'zoom';
  if (host === 'meet.google.com') return 'google_meet';
  if (host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft') return 'teams';
  return null;
}

export function botActions(meetingUrl) {
  return botPlatform(meetingUrl)
    ? { primary: 'Send Eadwyn AI', secondary: 'Record this device' }
    : { primary: 'Record this device', secondary: null };
}

/** Never echo server/provider messages: they may contain a private link. */
export function botRefusal(error) {
  if (own(REFUSALS, error?.code)) return REFUSALS[error.code];
  if (error?.status === 402 || ['budget_user_day', 'budget_user_month', 'spend_limit', 'tokens'].includes(error?.code)) return 'There are not enough AI tokens for this call’s time limit. Add tokens before sending Eadwyn AI.';
  return 'Eadwyn AI could not complete that request. Check the status before trying again.';
}

/**
 * Prepare dispatch only after the existing consent has been saved. Auto-send
 * defaults on for a scheduled call; an explicit opt-out produces no request.
 * This does not create a schedule or save a preference. B1 owns the alarm.
 */
export function botDispatchPlan({ meetingUrl, consentGiven, scheduledAt = null, autoSend = true }, now = Date.now()) {
  if (scheduledAt !== null && autoSend === false) return { body: null, error: null };
  if (consentGiven !== true) return { body: null, error: botRefusal({ code: 'consent_required' }) };
  if (!botPlatform(meetingUrl)) return { body: null, error: botRefusal({ code: 'unsupported_link' }) };
  const body = { meeting_url: meetingUrl.trim() };
  if (scheduledAt !== null) {
    const at = typeof scheduledAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) ? Date.parse(scheduledAt) : NaN;
    if (!timestamp(now) || !timestamp(at) || at <= now || at - now > 7 * 86400000) {
      return { body: null, error: 'Choose a call time in the next seven days.' };
    }
    body.scheduled_at = new Date(at).toISOString();
  }
  return { body, error: null };
}

/**
 * Missing/failed reads never become a successful run or a zero count. Timer
 * is approximate: it mixes server started_at with the caller's clock. Clock
 * skew can delay/inflate it; this is never billing or time-limit authority.
 */
export function botView(read, { unreadable = false, now = Date.now() } = {}) {
  const empty = (state, label) => ({ state, label, canStop: false, poll: false, timer: null, participantCount: null, failure: null, note: null, blocked: null, organizer: null, cause: null, fallback: false });
  if (unreadable) return empty('unreadable', 'Unreadable');
  if (read === undefined) return empty('loading', 'Loading');
  if (read?.bot === null) return empty('missing', 'Not recorded');
  const bot = read?.bot;
  if (!bot || !own(WORDS, bot.status)) return empty('unreadable', 'Unreadable');
  let timer = null;
  if (bot.status === 'recording' && timestamp(bot.started_at) && timestamp(now) && now >= bot.started_at) {
    const seconds = Math.floor((now - bot.started_at) / 1000);
    timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const waitingForFounder = (bot.status === 'joining' || bot.status === 'waiting_room') && bot.waiting_for === 'founder';
  const teams = bot.platform === 'teams';
  const infrastructure = bot.status === 'failed' && bot.failure_category === 'infrastructure';
  // D5813: only a failed Teams run, never the service's own failure, and only a value this module knows.
  const blocked = bot.status === 'failed' && teams && !infrastructure && own(TEAMS_BLOCKED, bot.blocked) ? bot.blocked : null;
  return {
    state: bot.status,
    label: waitingForFounder ? WAITING_FOR_FOUNDER : WORDS[bot.status],
    waitingForFounder,
    canStop: STOPPABLE.has(bot.status),
    poll: STOPPABLE.has(bot.status) || bot.status === 'processing',
    timer,
    participantCount: Number.isSafeInteger(bot.participant_count) && bot.participant_count >= 0 ? bot.participant_count : null,
    failure: bot.status === 'stopped' && ['tokens','time_limit','access_revoked'].includes(bot.failure_code)
      ? ({ tokens:'Eadwyn AI stopped because there are not enough AI tokens to continue.',time_limit:'Eadwyn AI stopped at this plan’s call time limit.',access_revoked:'Eadwyn AI stopped because recording permission ended.' }[bot.failure_code])
      : bot.status === 'failed'
      ? (infrastructure ? INFRASTRUCTURE_FAILURE
        : blocked ? TEAMS_BLOCKED[blocked].failure
          : teams && ['admission_refused', 'not_admitted'].includes(bot.failure_code) ? TEAMS_NOT_ADMITTED
            : own(FAILURES, bot.failure_code) ? FAILURES[bot.failure_code] : 'Eadwyn AI could not record this call. Check the meeting before trying again.')
      : null,
    note: waitingForFounder ? null : botNote(bot.status, teams),
    infrastructure,
    blocked,
    cause: blocked ? TEAMS_BLOCKED[blocked].cause : null,
    organizer: blocked ? TEAMS_BLOCKED[blocked].organizer : null,
    // D5813: a refused Teams run offers the existing upload and paste routes; another failure keeps its own retry.
    fallback: !!blocked,
  };
}

/**
 * D5813: one plain line for each state, true of what the run has reported and
 * nothing more. The notice comes before capture on every platform (B2), so
 * "nothing is recorded" holds until `recording`.
 */
function botNote(status, teams) {
  if (status === 'queued') return 'Eadwyn AI will join at the scheduled start time. Stop cancels that send.';
  if (status === 'joining') return teams ? 'Eadwyn AI is opening the Teams meeting in a browser as a guest named Eadwyn AI, with its microphone and camera off.' : null;
  if (status === 'waiting_room') return teams
    ? 'Eadwyn AI is in the Teams lobby. The organizer admits it from the lobby. Nothing is recorded until it is admitted and has posted its recording notice in the meeting chat.'
    : 'Admit Eadwyn AI from the call’s waiting room. Nothing is recorded until it is admitted and has posted its recording notice in the meeting chat.';
  if (status === 'recording') return 'Eadwyn AI posted its recording notice in the meeting chat and is recording.';
  if (status === 'processing') return 'The recording is being saved and processed. You can leave this page.';
  if (status === 'done') return 'The recording was saved and processed.';
  return null;
}

/**
 * The screen supplies B1's get/send/stop methods bound to ONE session.
 * Explicit reads only: the screen owns its poll lifecycle. Actions invalidate
 * older reads, duplicate presses share one write, and disposal ignores late
 * responses. A refusal never retries a dispatch or falls back to microphone.
 */
export function createBotSession({ getBot, sendBot, stopBot, changed = () => {}, now = Date.now }) {
  let snapshot = { read: undefined, unreadable: false, busy: null, error: null };
  let revision = 0;
  let disposed = false;
  let pending = null;
  const update = (patch) => {
    snapshot = { ...snapshot, ...patch };
    changed(snapshot);
  };
  const run = (kind, invoke) => {
    if (disposed) return Promise.resolve(false);
    if (pending) return snapshot.busy === kind ? pending : Promise.resolve(false);
    const ticket = ++revision;
    update({ busy: kind, error: null });
    // Defer the adapter so pending is installed even if it throws synchronously.
    pending = Promise.resolve().then(() => disposed ? undefined : invoke()).then((read) => {
      if (disposed || ticket !== revision) return false;
      if (!read?.bot || botView(read).state === 'unreadable') {
        update({ unreadable: true });
        return false;
      }
      update({ read, unreadable: false });
      return true;
    }, (error) => {
      if (!disposed && ticket === revision) update({ error: botRefusal(error) });
      return false;
    }).finally(() => {
      pending = null;
      if (!disposed) update({ busy: null });
    });
    return pending;
  };
  return {
    getSnapshot: () => snapshot,
    async refresh() {
      if (disposed || pending) return false;
      const ticket = ++revision;
      try {
        const read = await getBot();
        if (disposed || ticket !== revision) return false;
        if (read === undefined || botView(read).state === 'unreadable') {
          update({ unreadable: true });
          return false;
        }
        update({ read, unreadable: false, error: null });
        return true;
      } catch {
        if (!disposed && ticket === revision) update({ unreadable: true });
        return false;
      }
    },
    send(options) {
      if (disposed) return Promise.resolve(false);
      if (pending) return snapshot.busy === 'send' ? pending : Promise.resolve(false);
      const plan = botDispatchPlan(options, now());
      if (plan.error) { update({ error: plan.error }); return Promise.resolve(false); }
      if (!plan.body) return Promise.resolve(false);
      return run('send', () => sendBot(plan.body));
    },
    stop() {
      if (disposed) return Promise.resolve(false);
      if (pending) return snapshot.busy === 'stop' ? pending : Promise.resolve(false);
      if (!botView(snapshot.read, { unreadable: snapshot.unreadable }).canStop) return Promise.resolve(false);
      return run('stop', () => stopBot());
    },
    dispose() { disposed = true; revision++; },
  };
}
