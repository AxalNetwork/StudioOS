// D886 B7 (#2585): layout-independent contract for the founder's bot controls.
// Not mounted until B1's routes and the approved canvas exist. The adapter is
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
const FAILURES = Object.freeze({
  not_admitted: 'Eadwyn AI was not admitted. Ask the host to check the waiting room.',
  meeting_ended: 'The meeting ended before Eadwyn AI could finish recording.',
  link_invalid: 'Eadwyn AI could not use this meeting link. Check it and try again.',
  platform_blocked: 'The meeting platform did not allow Eadwyn AI to join.',
  obf_unavailable: 'Zoom authorization is required. Reconnect Zoom and join the meeting before sending Eadwyn AI.',
});
const REFUSALS = Object.freeze({
  consent_required: 'Record the interviewee’s agreement before sending Eadwyn AI.',
  unsupported_link: 'Use a Zoom, Google Meet or Microsoft Teams meeting link.',
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
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'teams';
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
  if (error?.status === 402) return 'There are not enough AI tokens for this call’s time limit. Add tokens before sending Eadwyn AI.';
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
  const empty = (state, label) => ({ state, label, canStop: false, poll: false, timer: null, participantCount: null, failure: null });
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
  return {
    state: bot.status,
    label: WORDS[bot.status],
    canStop: STOPPABLE.has(bot.status),
    poll: STOPPABLE.has(bot.status) || bot.status === 'processing',
    timer,
    participantCount: Number.isSafeInteger(bot.participant_count) && bot.participant_count >= 0 ? bot.participant_count : null,
    failure: bot.status === 'failed'
      ? (own(FAILURES, bot.failure_code) ? FAILURES[bot.failure_code] : 'Eadwyn AI could not record this call. Check the meeting before trying again.')
      : null,
  };
}

/**
 * The future screen supplies B1's get/send/stop methods bound to ONE session.
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
