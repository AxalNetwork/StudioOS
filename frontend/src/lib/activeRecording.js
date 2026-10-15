/**
 * D685 §5.6 (#1588) — the recording that lives above the routes.
 *
 * Capture used to live in a `useRef` inside `InterviewSessionPage`, whose
 * unmount stopped the microphone while the Worker session stayed `recording`.
 * Now one recorder owns the session, the capture, the timer and the status for
 * the life of the page: "Exit full screen" goes back to the workspace and a
 * 64px pill keeps the recording in the corner (`RecordingPill.jsx`); tapping
 * it returns to `/validate/record/live` (`RecordLivePage.jsx`).
 *
 * It is a small external store, not React state, so the parts of the app that
 * must not end a capture can ask it without a provider above them:
 * `isCapturing()` suspends the inactivity logout, the service-worker reload and
 * the stale-chunk reload while audio is being taken (§5.6.8).
 *
 * Every browser and Worker call is injected, so tests drive it without either.
 *
 * RECOVERY ON APP LOAD (§5.6.7, on #1584's `GET /sessions/active`): `recover`
 * flushes what this member left queued on the device, then restores the newest
 * recording or paused session, or follows one still processing. A recording is
 * paused, never left running, unless another tab holds it: the tab that
 * captures holds the Web Lock `rec-<id>`, and recovery only asks whether it is
 * free (`ifAvailable`), so a second tab never pauses the first one's recording.
 *
 * Each mark carries a `client_key` the Worker accepts (`[A-Za-z0-9_-]`), made
 * once when the moment is marked, so a replay is answered `duplicate`.
 *
 * The talking points are the Worker's (#1583, merged as #1591): the session
 * read carries them with their own ids, and a tick is `PUT
 * /sessions/:id/points/:pointId`, whose answer replaces the list.
 */
import { createCapture, flushQueue, indexedDbQueue, nextSeq } from './interviewCapture.js';

export const PHASES = ['idle', 'share', 'denied', 'recording', 'paused', 'stopping', 'ready', 'discarded'];
export const STAGES = ['Uploading', 'Transcribing', 'Summarising', 'Placing findings'];
/** The Worker's `processing_stage` for each of `STAGES` (D685 §5.9, migration 453). */
export const STAGE_KEYS = ['uploading', 'transcribing', 'summarising', 'placing'];
/** How often the processing view reads the session (§5.9.1). */
export const POLL_MS = 2000;

/**
 * The ring's fraction, only where the Worker counts something (§5.9.2):
 * Uploading (chunks stored of chunks recorded) and Transcribing (chunks
 * transcribed of chunks). Summarising and Placing findings have no count, so
 * this is null and the ring draws an indeterminate arc, never a guess.
 */
export function processingProgress(p) {
  if (!p || (p.stage !== 'uploading' && p.stage !== 'transcribing')) return null;
  const done = Number(p.done), total = Number(p.total);
  if (p.done == null || p.total == null || !Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(1, done / total));
}

/** Which of `STAGES` is current: its index, `STAGES.length` once done, -1 when unknown. */
export function stageIndex(p, last = -1) {
  if (!p) return last;
  if (p.stage === 'done') return STAGES.length;
  const i = STAGE_KEYS.indexOf(p.stage);
  return i >= 0 ? i : last;
}
const TOAST_MS = 2500;

const blank = () => ({
  phase: 'idle', session: null, interview: null, callLabel: null, channel: null, points: [],
  cap: {}, confirm: false, drawer: false, toast: null, error: null, wake: null, refused: null,
  marksQueued: [], online: true, video: false, pointError: null, meetingUrl: null,
  processing: null, stageAt: -1, stopStep: null, lastSeq: null, attach: null,
});

/**
 * A Start the Worker refused, in its words (D685 §5.5.8). On 409
 * `session_active` the session already recording is named, so the view can
 * offer it instead of a second recording.
 */
export function startRefused(e) {
  const sid = Number(e?.data?.session_id);
  return {
    text: (typeof e?.message === 'string' && e.message.trim()) || 'The recording could not start.',
    sessionId: e?.code === 'session_active' && Number.isSafeInteger(sid) && sid > 0 ? sid : null,
  };
}

/**
 * A Start made while this tab is still taking (or saving) another recording's
 * audio (#1588): refused before anything is posted or the microphone opened,
 * in the words of the Worker's 409 `session_active`, naming the recording to
 * return to. Null when nothing would be replaced: a video call still waiting
 * at "Share the call's tab" has opened no microphone and posted no start.
 */
export function liveRefusal(st, capturing) {
  if (!capturing || !st?.session || st.phase === 'share') return null;
  return {
    text: st.phase === 'stopping'
      ? 'The last recording is still being saved. Wait for it to finish, or return to it.'
      : 'You are already recording another session. Stop it, or return to it, first.',
    sessionId: st.session.id,
  };
}

/**
 * The pill's variant, from the phase (D685 §5.6.4). Null when there is no
 * session. It never says "Recording" when nothing records (#1588): a video
 * call waiting for its tab is `share`, a blocked microphone `blocked`, and a
 * Start the Worker refused `refused`.
 */
export function pillVariant(st) {
  if (!st?.session) return null;
  if (st.phase === 'ready') return 'ready';
  if (st.phase === 'stopping') return st.processing?.stage === 'failed' ? 'failed' : 'processing';
  if (st.phase === 'paused') return 'paused';
  if (st.phase === 'share') return 'share';
  if (st.phase === 'denied') return st.refused ? 'refused' : 'blocked';
  // Offline is said of a recording only: a Start still opening draws no pill (#1588).
  if (st.phase === 'recording') return st.online === false || st.cap?.online === false ? 'offline' : 'recording';
  return null;
}

/** The pill's accessible name: it states the state. */
export function pillLabel(variant, clockText) {
  return {
    recording: `Recording · ${clockText} · tap to expand`,
    paused: `Paused · ${clockText} · tap to expand`,
    offline: `Recording offline · ${clockText} · saved on this device · tap to expand`,
    processing: 'Processing the session · tap to expand',
    failed: 'Processing stopped · tap to retry',
    ready: 'Ready · see it in Interviews',
    share: 'Not recording yet · share the call\'s tab · tap to expand',
    blocked: 'Not recording · the microphone is blocked · tap to expand',
    refused: 'Not recording · the recording did not start · tap to expand',
  }[variant] || '';
}

/** Worker time → ms. `recording_since` is SQLite's UTC text, with a space. */
const at = (t) => (t ? Date.parse(`${String(t).replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(String(t)) ? '' : 'Z'}`) : NaN);

/** The timer: the Worker's `active_ms`, plus the live stretch since `recording_since` (D685 §5.6.1). */
export function elapsedMs(session, now) {
  if (!session) return 0;
  const base = Number(session.active_ms) || 0;
  const since = at(session.recording_since);
  return session.status === 'recording' && Number.isFinite(since) ? base + Math.max(0, now - since) : base;
}

/** Return to Customer research, keeping the recording's venture when known (D694). */
export function reviewPath(session) {
  const projectId = session?.project_id;
  return Number.isSafeInteger(projectId) && projectId > 0
    ? `/validate/customer-research?project_id=${projectId}`
    : '/validate/customer-research';
}

/**
 * A mark's `client_key`: the session, the offset and a few random characters,
 * in the Worker's alphabet (`[A-Za-z0-9_-]{1,80}`). Made once per mark, so its
 * replays are one mark and two marks in the same millisecond are two.
 */
export const markKey = (sessionId, offset, rand = () => Math.random().toString(36).slice(2, 8)) =>
  `m${String(sessionId).replace(/[^A-Za-z0-9]/g, '')}-${Math.max(0, Math.round(Number(offset) || 0))}-${String(rand()).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || '0'}`;

/** The Web Lock a capturing tab holds for its session (§5.6.7). */
export const lockName = (sessionId) => `rec-${sessionId}`;

/** A meeting link the view may open: https only, as the Worker stored it. */
export function joinHref(url) {
  try { const u = new URL(String(url || '')); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
}

/**
 * Is the recovery on app load still to finish (§5.6.7, #1588)? Until it has,
 * a reload of `/validate/record/live?session=` cannot tell a recording about
 * to come back from one that is gone, so the route waits instead of leaving.
 * A recorder that does not say (a test's stub) has nothing to wait for.
 */
export const recovering = (st) => st?.recovery === 'pending' || st?.recovery === 'running';

export function createRecorder({ api, browser = {}, queue = null, now = () => Date.now(), setTimeout: st = (f, ms) => globalThis.setTimeout(f, ms), wait = null } = {}) {
  // `recovery` is not in `blank()`, so a clear or a sign-out leaves it as it is:
  // 'pending' from page load until the first recovery has finished.
  let state = { ...blank(), recovery: 'pending' };
  // One poll at a time: a new Stop, a sign-out or a clear ends the one before.
  let pollGen = 0;
  const pause = wait || ((ms) => new Promise((r) => st(r, ms)));
  let capture = null;
  let pre = null;
  let wakeLock = null;
  let userId = null;
  let heldLock = null; // { id, release, granted }
  // A Start between its click and the Worker's answer (#1588): the mic is
  // opening and `capture` is about to be its, so another Start is refused.
  let opening = false;
  // The AudioContext a Start click prepared and its capture never used (a
  // denied mic returns before the context is made): closed, not leaked.
  let unusedPrepared = () => {};
  const listeners = new Set();
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; listeners.forEach((l) => l(state)); };
  const q = () => queue || (queue = indexedDbQueue());

  const makeCapture = ({ startSeq = 0 } = {}) => {
    const s = state.session;
    // What the Start click prepared is this capture's, once; `pre` is cleared
    // so the next Start prepares its own inside its click (§5.6.5, #1588).
    let stream = pre?.stream || null;
    let ctx = pre?.ctx || null;
    pre = null;
    unusedPrepared = () => { if (ctx) { try { ctx.close?.(); } catch { /* gone */ } ctx = null; } };
    capture = createCapture({
      deps: {
        getUserMedia: stream ? ((opts) => { if (!stream) return browser.getUserMedia(opts); const p = stream; stream = null; return p; }) : browser.getUserMedia,
        getDisplayMedia: browser.getDisplayMedia,
        AudioContext: ctx ? function PreparedContext(...a) { if (!ctx) return new browser.AudioContext(...a); const c = ctx; ctx = null; return c; } : browser.AudioContext,
        MediaStream: browser.MediaStream,
        MediaRecorder: browser.MediaRecorder, WebSocket: browser.WebSocket,
        now, setTimeout: st, clearTimeout: browser.clearTimeout, setInterval: browser.setInterval, clearInterval: browser.clearInterval,
        liveUrl: api.liveUrl?.(s.id),
      },
      api: { uploadChunk: (seq, blob, startMs) => api.uploadChunk(s.id, seq, blob, startMs) },
      queue: q(), sessionId: s.id, liveOn: !!s.live_model, startSeq, baseOffsetMs: Number(s.active_ms) || 0, userId,
      onState: (cap) => set((x) => ({ cap: { ...x.cap, ...cap } })),
    });
    return capture;
  };

  const keepAwake = async () => {
    const wl = browser.wakeLock;
    if (!wl || typeof wl.request !== 'function') { set({ wake: 'unsupported' }); return; }
    try { wakeLock = await wl.request('screen'); set({ wake: 'on' }); } catch { set({ wake: 'unsupported' }); }
  };
  const letSleep = () => { try { wakeLock?.release?.(); } catch { /* gone */ } wakeLock = null; set({ wake: null }); };

  /** Hold `rec-<id>` while this tab captures, so another tab's recovery leaves it alone. */
  const holdLock = (id) => {
    const locks = browser.locks;
    if (!locks || typeof locks.request !== 'function' || heldLock?.id === id) return;
    dropLock();
    let release;
    const held = new Promise((r) => { release = r; });
    heldLock = { id, release, granted: false };
    const mine = heldLock;
    locks.request(lockName(id), () => { mine.granted = true; return held; }).catch(() => {});
  };
  const dropLock = () => { heldLock?.release?.(); heldLock = null; };
  /** Does this tab hold `rec-<id>` already? Then a probe would only find itself. */
  const holding = (id) => heldLock?.id === id && heldLock.granted;
  /** Is `rec-<id>` free here? Asked without waiting; with no Web Locks, every lock is free. */
  const lockFree = async (id) => {
    const locks = browser.locks;
    if (!locks || typeof locks.request !== 'function') return true;
    try { return await locks.request(lockName(id), { ifAvailable: true }, (lock) => lock !== null); } catch { return true; }
  };

  /** Open the microphone, then post start (or resume) only once it is granted (D685 §5.6.5). */
  const goLive = async (opts = {}) => {
    opening = true;
    try { return await openAndPost(opts); } finally { opening = false; }
  };
  const openAndPost = async ({ display = false, resume = false } = {}) => {
    const s = state.session;
    const queued = await q().list(s.id).catch(() => []);
    const c = makeCapture({ startSeq: nextSeq(state.storedSeqs || [], queued.map((r) => r.seq)) });
    const mic = await c.open({ display });
    if (mic === 'denied') { unusedPrepared(); set({ phase: 'denied' }); return 'denied'; }
    try {
      const r = await api.action(s.id, resume ? 'resume' : 'start');
      set({ session: r.session, phase: 'recording', error: null, refused: null });
      c.start();
      keepAwake();
      holdLock(s.id);
      return 'recording';
    } catch (e) {
      await c.stop({ flush: false });
      // Only this call's own capture: another Start's is not dropped (#1588).
      if (capture === c) capture = null;
      // The mic was granted, so whatever failed is the request: the Worker's
      // words (409 `session_active` names the recording already live), or the
      // request's own when it never answered (offline, a timeout), never the
      // microphone's (#1588).
      const refused = !resume ? startRefused(e) : null;
      set({ phase: resume ? 'paused' : 'denied', error: e?.message || 'The recording could not start.', refused });
      return 'refused';
    }
  };

  const replayMarks = async () => {
    const s = state.session;
    const left = [];
    for (const m of state.marksQueued) {
      try { await api.mark(s.id, m.offset, undefined, m.key); } catch { left.push(m); }
    }
    set({ marksQueued: left });
  };

  /** The processing state, and the stage reached (kept through a failure, so the chips stay put). */
  const showProcessing = (p) => set((x) => ({ processing: p, stageAt: stageIndex(p, x.stageAt) }));
  const upload = (id) => (seq, blob, startMs) => api.uploadChunk(id, seq, blob, startMs);
  const failWith = (sentence) => set((x) => ({ processing: { ...(x.processing || {}), stage: 'failed', error: sentence } }));

  /**
   * Read the session about every two seconds until processing is done or has
   * failed (§5.9.1). While it is uploading, what still waits on this device is
   * sent again, so a Stop made offline finishes when the network returns.
   */
  const follow = async (id) => {
    const gen = ++pollGen;
    for (;;) {
      if (gen !== pollGen) return 'cancelled';
      if (state.processing?.stage === 'uploading') { try { await flushQueue(q(), id, upload(id)); } catch { /* the next pass tries again */ } }
      let r = null;
      try { r = await api.get(id); } catch { /* offline: keep the last state on screen and read again */ }
      if (gen !== pollGen) return 'cancelled';
      if (r) {
        const p = r.processing || null;
        set({ session: r.session });
        showProcessing(p);
        if (p?.stage === 'done' || (!p && ['transcribed', 'structured', 'reviewed'].includes(r.session?.status))) {
          set({ phase: 'ready' });
          return 'done';
        }
        if (p?.stage === 'failed') return 'failed';
        if (p?.stale) {
          failWith(p.error || 'Processing has not moved for 15 minutes. Nothing was lost; try again.');
          return 'failed';
        }
      }
      await pause(POLL_MS);
    }
  };

  /**
   * Stop and process (§5.9.1), resumable: each step is done once, so Retry
   * picks up at the step that failed. Stop, then the capture's stop and flush
   * (or the device's queue, with no capture here), then `finish` with the last
   * seq recorded, then the poll.
   */
  const process = async (auto) => {
    const s = state.session;
    if (!state.stopStep) {
      await replayMarks();
      if (s.status === 'recording' || s.status === 'paused') {
        const r = await api.action(s.id, 'stop');
        set({ session: r.session });
      }
      set({ stopStep: 'stopped' });
    }
    if (state.stopStep === 'stopped') {
      let last = -1;
      if (capture) {
        const out = await capture.stop();
        if (Number.isFinite(out?.lastSeq)) last = out.lastSeq;
        capture = null;
      } else {
        await flushQueue(q(), s.id, upload(s.id)).catch(() => null);
      }
      letSleep();
      const queued = await q().list(s.id).catch(() => []);
      last = Math.max(last, nextSeq(state.storedSeqs || [], queued.map((r) => r.seq)) - 1);
      set({ stopStep: 'flushed', lastSeq: last });
    }
    if (state.stopStep === 'flushed') {
      if (state.lastSeq == null || state.lastSeq < 0) {
        failWith('No audio was recorded, so there is nothing to process.');
        return 'failed';
      }
      const f = await api.finish(s.id, state.lastSeq, auto);
      showProcessing(f?.processing || { stage: 'uploading', done: null, total: null, error: null });
      set({ stopStep: 'finished' });
    }
    return follow(s.id);
  };

  const api_ = {
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    getSnapshot: () => state,
    /**
     * Is audio being taken, or still leaving this device? Nothing may reload or
     * log out under it. Once `finish` is accepted and the chunks are stored,
     * the rest runs on the Worker, and a reload only re-reads it (§5.9.5).
     */
    isCapturing: () => opening || ['share', 'recording', 'paused'].includes(state.phase)
      || (state.phase === 'stopping' && (state.stopStep !== 'finished' || state.processing?.stage === 'uploading')),

    /**
     * Inside the Start click (D685 §5.6.5): the microphone and the AudioContext
     * are asked for in the gesture, so iOS Safari does not start the context
     * suspended. The session does not exist yet; `begin` hands it over.
     */
    prepare() {
      if (pre) return pre;
      const stream = browser.getUserMedia ? Promise.resolve().then(() => browser.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })) : null;
      stream?.catch(() => {}); // a denial is read in `begin`, not here
      const ctx = browser.AudioContext ? new browser.AudioContext() : null;
      pre = { stream, ctx };
      return pre;
    },
    /** Let a prepared microphone go, when the Start it was opened for was refused. */
    release() {
      pre?.stream?.then?.((m) => m?.getTracks?.().forEach((t) => t.stop())).catch(() => {});
      try { pre?.ctx?.close?.(); } catch { /* gone */ }
      pre = null;
    },

    /**
     * The modal hands over its draft. Audio starts here; a video call waits
     * for the second click, "Share the call's tab" (§5.8.1).
     */
    async begin({ session, interview = null, callLabel = null, points = [], video = false, storedSeqs = [], meetingUrl = null, attach = null }) {
      // Never over a live capture: replacing it would leave its microphone
      // running with nothing to stop it (#1588). The caller offers it instead.
      if (liveRefusal(state, api_.isCapturing())) { api_.release(); return 'busy'; }
      pollGen += 1; // the last session's processing poll ends here, never writes over this one
      capture = null;
      set({ ...blank(), session, interview, callLabel, channel: session?.channel || null, points, video, storedSeqs, phase: video ? 'share' : 'idle', meetingUrl: joinHref(meetingUrl), attach });
      if (video) { api_.release(); return 'share'; }
      return goLive();
    },
    /**
     * A session that already exists (its page, or after a reload): paused
     * until resumed in a click. One another tab is capturing holds `rec-<id>`
     * (§5.6.7): it is left alone, never paused from here, or a later Resume
     * would start a second capture whose seqs collide with the first's.
     */
    async adopt({ session, interview = null, callLabel = null, points = [], storedSeqs = [] }) {
      if (liveRefusal(state, api_.isCapturing())) return 'busy';
      if (session?.id != null && ['recording', 'paused'].includes(session.status) && !(await lockFree(session.id))) return 'other_tab';
      pollGen += 1;
      capture = null;
      let s = session;
      // A recording with no capture in this tab is paused, never left running (§5.6.7).
      if (s?.status === 'recording') { try { s = (await api.action(s.id, 'pause')).session; } catch { /* the Worker keeps its own state */ } }
      set({ ...blank(), session: s, interview, callLabel, channel: s?.channel || null, points, storedSeqs, phase: s?.status === 'draft' ? 'idle' : 'paused', video: s?.channel === 'video' });
      // This tab has it now: another tab's recovery or Resume leaves it alone (§5.6.7, #1588).
      if (state.phase === 'paused' && s?.id != null) holdLock(s.id);
      return state.phase;
    },
    /** Video, second click: share the call's tab, or record the microphone only. */
    share({ micOnly = false } = {}) { return goLive({ display: !micOnly }); },
    /** "Try again" after a denial, in its own click. */
    retryMic() { return goLive({ display: false }); },

    async pause() {
      const r = await api.action(state.session.id, 'pause');
      capture?.pause();
      set({ session: r.session, phase: 'paused' });
    },
    async resume() {
      if (!capture) {
        // A paused session this tab never captured: another tab may have taken it since (#1588).
        const id = state.session?.id;
        if (id != null && !holding(id) && !(await lockFree(id))) {
          set({ error: 'This recording is live in another tab. Go back to that tab to pause, resume or stop it.' });
          return 'other_tab';
        }
        return goLive({ resume: true, display: false });
      }
      const r = await api.action(state.session.id, 'resume');
      capture.resume();
      set({ session: r.session, phase: 'recording' });
      return 'recording';
    },
    /** Mark the moment. Offline, or refused, it waits on this device and replays (§5.7.10). */
    async mark() {
      const offset = capture?.offsetMs() ?? elapsedMs(state.session, now());
      set({ toast: { at: now(), offset } });
      st(() => set((x) => (x.toast && now() - x.toast.at >= TOAST_MS ? { toast: null } : {})), TOAST_MS);
      const key = markKey(state.session.id, offset);
      if (state.online === false) { set((x) => ({ marksQueued: [...x.marksQueued, { offset, key }] })); return 'queued'; }
      try { await api.mark(state.session.id, offset, undefined, key); return 'sent'; } catch {
        set((x) => ({ marksQueued: [...x.marksQueued, { offset, key }] }));
        return 'queued';
      }
    },
    /**
     * Tick or untick a talking point (§5.2). Shown at once; the Worker's answer
     * replaces the list, and a refusal puts the box back and says so.
     */
    async tick(pointId, covered) {
      const flip = (on) => (x) => ({ points: x.points.map((p) => (p.id === pointId ? { ...p, covered: on } : p)) });
      set((x) => ({ ...flip(covered)(x), pointError: null }));
      try {
        const r = await api.tickPoint(state.session.id, pointId, covered);
        if (Array.isArray(r?.points)) set({ points: r.points });
        return 'saved';
      } catch {
        set((x) => ({ ...flip(!covered)(x), pointError: 'That tick was not saved. Try again.' }));
        return 'refused';
      }
    },
    toggleLive() { capture?.setLive(!(state.cap.live ?? !!state.session?.live_model)); },
    toggleDrawer(open) { set((x) => ({ drawer: open ?? !x.drawer })); },
    askStop() { set({ confirm: true }); },
    cancelStop() { set({ confirm: false }); },

    /**
     * Stop and process. `auto: false` is the rail's Manual mode: the Worker
     * stops after Transcribing and the review offers Summarise and Structure.
     * Nobody is navigated from here; the live view goes to the review when it
     * is open, and the pill says "Ready to review" when it is not.
     */
    async confirmStop({ auto = true } = {}) {
      set({ confirm: false, phase: 'stopping', error: null, auto: auto !== false, stopStep: null, lastSeq: null,
        processing: { stage: 'uploading', done: null, total: null, error: null }, stageAt: 0 });
      dropLock(); // nothing is captured from here: another tab may follow the processing
      try { return await process(auto !== false); } catch (e) {
        failWith(e?.message || 'Processing could not start. Nothing was lost; try again.');
        return 'failed';
      }
    },
    /** Retry after a failure: the step that failed, or the Worker's run from the stage it reached (`POST /process`). */
    async retry() {
      const s = state.session;
      set((x) => ({ processing: { ...(x.processing || {}), stage: x.stageAt >= 0 ? STAGE_KEYS[Math.min(x.stageAt, STAGE_KEYS.length - 1)] : 'uploading', error: null } }));
      try {
        if (state.stopStep !== 'finished') return await process(state.auto !== false);
        const r = await api.process(s.id);
        showProcessing(r?.processing || null);
        return await follow(s.id);
      } catch (e) {
        failWith(e?.message || 'Processing could not start. Nothing was lost; try again.');
        return 'failed';
      }
    },
    /**
     * A session already being processed, opened after a reload or from its
     * page: the view renders from the Worker's processing state (§5.9.5).
     */
    follow({ session, interview = null, processing = null, callLabel = null }) {
      // Never over a live capture (#1588): the page shows that session's processing itself.
      if (liveRefusal(state, api_.isCapturing())) return Promise.resolve('busy');
      pollGen += 1;
      capture = null;
      const done = processing?.stage === 'done';
      set({ ...blank(), session, interview, callLabel, channel: session?.channel || null, phase: done ? 'ready' : 'stopping', stopStep: 'finished' });
      showProcessing(processing);
      if (done || processing?.stage === 'failed') return Promise.resolve(done ? 'done' : 'failed');
      return follow(session.id);
    },
    /**
     * "Discard this recording" (D685 §5.7.9, required by #1470): pause, record
     * that consent was withdrawn, then delete the session and its audio.
     */
    async discard() {
      const s = state.session;
      set({ confirm: false });
      try {
        if (state.phase === 'recording') { try { await api.action(s.id, 'pause'); } catch { /* deleting is what matters */ } }
        await capture?.discard();
        capture = null;
        letSleep();
        try { await api.setConsent(s.id, 'declined'); } catch { /* the delete removes it all the same */ }
        await api.remove(s.id);
        dropLock();
        set({ ...blank(), phase: 'discarded' });
        return 'discarded';
      } catch (e) {
        set({ error: e?.message || 'The recording could not be discarded.' });
        return 'error';
      }
    },
    /** The browser went offline or came back (D685 §5.7.7). */
    setOnline(on) {
      set({ online: !!on });
      if (on) { capture?.reconnect(); if (state.marksQueued.length) replayMarks(); } else capture?.offline();
    },
    /** The tab came back: the screen lock is asked for again (it is released when hidden). */
    onVisible() { if (state.phase === 'recording') keepAwake(); },
    /** Sign-out or an account switch: stop, and leave queued chunks on the device (§5.6.8). */
    async signOut() {
      pollGen += 1;
      await capture?.stop({ flush: false });
      capture = null;
      letSleep();
      dropLock();
      userId = null;
      set(blank());
    },
    /** Done with the review: the pill goes. */
    clear() { if (!api_.isCapturing()) { pollGen += 1; dropLock(); set(blank()); } },
    /** The signed-in member: queued chunks are tagged with them, and only theirs flush on load. */
    setUser(id) { userId = id ?? null; },
    /** Can this browser share a tab? iOS Safari and Android Chrome cannot (§5.8.6). */
    get canShareTab() { return typeof browser.getDisplayMedia === 'function'; },
    /**
     * Recovery on app load (D685 §5.6.7), from `GET /sessions/active`:
     *   1. what this member left queued on the device is flushed, every
     *      session (stopped ones too: `PUT /chunks` admits `stopped`);
     *   2. the newest recording or paused session is restored, paused, unless
     *      another tab holds its lock; its full read gives the points, the
     *      Worker's call label and the stored seqs, so a resume continues them;
     *   3. else the newest one still processing reopens its processing view.
     * Nothing is done for a tab that already holds a session, or with no member.
     */
    async recover() {
      if (userId == null) return 'skipped';
      if (state.session) { set({ recovery: 'done' }); return 'skipped'; }
      set({ recovery: 'running' });
      try { return await recoverNow(); } finally { set({ recovery: 'done' }); }
    },
    /** For tests and the route: the capture this recorder holds. */
    get capture() { return capture; },
  };

  async function recoverNow() {
    let items;
    try { const r = await api.active(); items = Array.isArray(r?.items) ? r.items : []; } catch { return 'unread'; }
    const ids = await q().sessions(userId).catch(() => []);
    for (const id of ids) { try { await flushQueue(q(), id, upload(id)); } catch { /* the next load tries again */ } }
    if (state.session) return 'skipped'; // a Start made while this ran wins
    const live = items.find((x) => x.status === 'recording' || x.status === 'paused');
    if (live) {
      if (!(await lockFree(live.id))) return 'other_tab';
      let full;
      try { full = await api.get(live.id); } catch { return 'unread'; }
      if (state.session) return 'skipped';
      const who = full.interview || { id: live.interview_id, interviewee_name: live.interviewee_name ?? null, interviewee_company: live.interviewee_company ?? null };
      await api_.adopt({
        session: full.session, interview: who, callLabel: full.call_label ?? live.call_label ?? null, points: full.points || [],
        storedSeqs: (full.chunks || []).map((c) => c.seq),
      });
      set({ meetingUrl: joinHref(full.meeting_url) });
      return 'restored';
    }
    const busy = items.find((x) => x.processing && x.processing.stage && x.processing.stage !== 'done');
    if (busy) {
      api_.follow({
        session: busy, interview: { id: busy.interview_id, interviewee_name: busy.interviewee_name ?? null, interviewee_company: busy.interviewee_company ?? null },
        processing: busy.processing, callLabel: busy.call_label ?? null,
      });
      return 'following';
    }
    return 'none';
  }
  return api_;
}
