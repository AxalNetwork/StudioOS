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
 * WAITS ON THE WORKER (wired when each merges):
 *   · #1584: `GET /sessions/active`, so a reload restores an active recording on
 *     its own; and the marks' `client_key`, so a replayed mark is never doubled.
 *     Until then a session opened from its page after a reload is paused and
 *     resumed by hand, with its seqs continued from `GET /sessions/:id`.
 *   · #1583: the talking points' ticks. Until then the drawer lists the points
 *     picked in the lightbox, unticked, and says they are not saved yet.
 */
import { createCapture, indexedDbQueue, nextSeq } from './interviewCapture.js';

export const PHASES = ['idle', 'share', 'denied', 'recording', 'paused', 'stopping', 'ready', 'discarded'];
export const STAGES = ['Uploading', 'Transcribing', 'Summarising', 'Placing findings'];
const TOAST_MS = 2500;

const blank = () => ({
  phase: 'idle', session: null, interview: null, callLabel: null, channel: null, points: [],
  cap: {}, confirm: false, drawer: false, toast: null, stage: 0, error: null, wake: null,
  marksQueued: [], online: true, video: false,
});

/** The pill's variant, from the phase (D685 §5.6.4). Null when nothing is recording. */
export function pillVariant(st) {
  if (!st?.session) return null;
  if (st.phase === 'ready') return 'ready';
  if (st.phase === 'stopping') return 'processing';
  if (st.phase === 'paused') return 'paused';
  if (st.online === false || st.cap?.online === false) return 'offline';
  if (st.phase === 'recording' || st.phase === 'share' || st.phase === 'denied') return 'recording';
  return null;
}

/** The pill's accessible name: it states the state. */
export function pillLabel(variant, clockText) {
  return {
    recording: `Recording · ${clockText} · tap to expand`,
    paused: `Paused · ${clockText} · tap to expand`,
    offline: `Recording offline · ${clockText} · saved on this device · tap to expand`,
    processing: 'Processing the session · tap to expand',
    ready: 'Ready to review · open the review',
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

/** A key a replayed mark can be recognised by, once the Worker takes one (#1584). */
export const markKey = (sessionId, offset) => `${sessionId}:${Math.round(offset)}`;

export function createRecorder({ api, browser = {}, queue = null, now = () => Date.now(), setTimeout: st = (f, ms) => globalThis.setTimeout(f, ms) } = {}) {
  let state = blank();
  let capture = null;
  let pre = null;
  let wakeLock = null;
  const listeners = new Set();
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; listeners.forEach((l) => l(state)); };
  const q = () => queue || (queue = indexedDbQueue());

  const makeCapture = ({ startSeq = 0 } = {}) => {
    const s = state.session;
    capture = createCapture({
      deps: {
        getUserMedia: pre?.stream ? (() => { const p = pre.stream; pre = { ...pre, stream: null }; return p; }) : browser.getUserMedia,
        getDisplayMedia: browser.getDisplayMedia,
        AudioContext: pre?.ctx ? function PreparedContext() { const c = pre.ctx; pre = { ...pre, ctx: null }; return c; } : browser.AudioContext,
        MediaStream: browser.MediaStream,
        MediaRecorder: browser.MediaRecorder, WebSocket: browser.WebSocket,
        now, setTimeout: st, clearTimeout: browser.clearTimeout, setInterval: browser.setInterval, clearInterval: browser.clearInterval,
        liveUrl: api.liveUrl?.(s.id),
      },
      api: { uploadChunk: (seq, blob, startMs) => api.uploadChunk(s.id, seq, blob, startMs) },
      queue: q(), sessionId: s.id, liveOn: !!s.live_model, startSeq, baseOffsetMs: Number(s.active_ms) || 0,
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

  /** Open the microphone, then post start (or resume) only once it is granted (D685 §5.6.5). */
  const goLive = async ({ display = false, resume = false } = {}) => {
    const s = state.session;
    const queued = await q().list(s.id).catch(() => []);
    const c = makeCapture({ startSeq: nextSeq(state.storedSeqs || [], queued.map((r) => r.seq)) });
    const mic = await c.open({ display });
    if (mic === 'denied') { set({ phase: 'denied' }); return 'denied'; }
    try {
      const r = await api.action(s.id, resume ? 'resume' : 'start');
      set({ session: r.session, phase: 'recording', error: null });
      c.start();
      keepAwake();
      return 'recording';
    } catch (e) {
      await c.stop({ flush: false });
      capture = null;
      set({ phase: resume ? 'paused' : 'denied', error: e?.message || 'The recording could not start.' });
      return 'refused';
    }
  };

  const replayMarks = async () => {
    const s = state.session;
    const left = [];
    for (const m of state.marksQueued) {
      try { await api.mark(s.id, m.offset); } catch { left.push(m); }
    }
    set({ marksQueued: left });
  };

  const api_ = {
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    getSnapshot: () => state,
    /** Is audio being taken, or still leaving this device? Nothing may reload or log out under it. */
    isCapturing: () => ['share', 'recording', 'paused', 'stopping'].includes(state.phase),

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
    async begin({ session, interview = null, callLabel = null, points = [], video = false, storedSeqs = [] }) {
      capture = null;
      set({ ...blank(), session, interview, callLabel, channel: session?.channel || null, points, video, storedSeqs, phase: video ? 'share' : 'idle' });
      if (video) { api_.release(); return 'share'; }
      return goLive();
    },
    /** A session that already exists (its page, or after a reload): paused until resumed in a click. */
    async adopt({ session, interview = null, callLabel = null, storedSeqs = [] }) {
      capture = null;
      let s = session;
      // A recording with no capture in this tab is paused, never left running (§5.6.7).
      if (s?.status === 'recording') { try { s = (await api.action(s.id, 'pause')).session; } catch { /* the Worker keeps its own state */ } }
      set({ ...blank(), session: s, interview, callLabel, channel: s?.channel || null, storedSeqs, phase: s?.status === 'draft' ? 'idle' : 'paused', video: s?.channel === 'video' });
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
      if (!capture) return goLive({ resume: true, display: false });
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
      if (state.online === false) { set((x) => ({ marksQueued: [...x.marksQueued, { offset, key: markKey(x.session.id, offset) }] })); return 'queued'; }
      try { await api.mark(state.session.id, offset); return 'sent'; } catch {
        set((x) => ({ marksQueued: [...x.marksQueued, { offset, key: markKey(x.session.id, offset) }] }));
        return 'queued';
      }
    },
    toggleLive() { capture?.setLive(!(state.cap.live ?? !!state.session?.live_model)); },
    toggleDrawer(open) { set((x) => ({ drawer: open ?? !x.drawer })); },
    askStop() { set({ confirm: true }); },
    cancelStop() { set({ confirm: false }); },

    /** Stop and process: marks first, then stop, flush, transcribe. The pill turns "Ready to review"; nobody is navigated away. */
    async confirmStop() {
      set({ confirm: false, phase: 'stopping', stage: 0, error: null });
      const s = state.session;
      try {
        await replayMarks();
        const r = await api.action(s.id, 'stop');
        set({ session: r.session });
        await capture?.stop();
        capture = null;
        letSleep();
        set({ stage: 1 });
        await api.transcribe(s.id, s.final_model);
        set((x) => ({ phase: 'ready', stage: 2, session: { ...x.session, status: 'transcribed' } }));
      } catch (e) {
        set({ phase: 'ready', error: e?.message || 'The transcript could not be made.' });
      }
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
      await capture?.stop({ flush: false });
      capture = null;
      letSleep();
      set(blank());
    },
    /** Done with the review: the pill goes. */
    clear() { if (!api_.isCapturing()) set(blank()); },
    /** For tests and the route: the capture this recorder holds. */
    get capture() { return capture; },
  };
  return api_;
}
