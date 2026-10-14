import { useEffect, useState, useSyncExternalStore } from 'react';
import { interviewSessionsApi } from '../lib/api/interviewSessions.js';
import { createRecorder } from '../lib/activeRecording.js';
import { isCapturing as probeCapturing, setCaptureProbe } from '../lib/captureGuard.js';

/**
 * D685 §5.6 (#1588) — the one recording, above the routes. The store and its
 * rules are `lib/activeRecording.js`; this file binds them to the browser and
 * to React.
 *
 * `ActiveRecordingProvider` is mounted once, above `<Routes>` in `App.jsx`. It
 * listens for the browser going offline and back, and for the tab coming back
 * (the screen lock is asked for again), and stops the capture on sign-out or an
 * account switch, so queued chunks never flush under another member. On sign-in
 * (and so on every app load) it restores the recording in flight (`recover`).
 */

function realBrowser() {
  if (typeof window === 'undefined') return {};
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const md = nav.mediaDevices;
  return {
    getUserMedia: md?.getUserMedia ? (c) => md.getUserMedia(c) : undefined,
    getDisplayMedia: md?.getDisplayMedia ? (c) => md.getDisplayMedia(c) : undefined,
    AudioContext: window.AudioContext || window.webkitAudioContext,
    MediaStream: window.MediaStream,
    MediaRecorder: window.MediaRecorder,
    WebSocket: window.WebSocket,
    clearTimeout: (t) => window.clearTimeout(t),
    setInterval: (f, ms) => window.setInterval(f, ms),
    clearInterval: (t) => window.clearInterval(t),
    wakeLock: nav.wakeLock,
    locks: nav.locks,
  };
}

let recorder = null;
/** The app's one recorder. Tests replace it with `setRecorder`. */
export function getRecorder() {
  if (!recorder) setRecorder(createRecorder({ api: interviewSessionsApi, browser: realBrowser() }));
  return recorder;
}
export function setRecorder(r) {
  recorder = r;
  // The inactivity logout and the reloads ask this probe (lib/captureGuard.js).
  setCaptureProbe(() => !!recorder && recorder.isCapturing());
}

/** Is audio being taken, or still leaving this device? (D685 §5.6.8) */
export const isCapturing = probeCapturing;

/** `{ state, recorder }`, re-rendered on every change to the recording. */
export function useActiveRecording() {
  const r = getRecorder();
  const state = useSyncExternalStore(r.subscribe, r.getSnapshot, r.getSnapshot);
  return { state, recorder: r };
}

/** A clock that ticks every half second while `on`, for the timer. */
export function useNow(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function ActiveRecordingProvider({ userId = null, children }) {
  const r = getRecorder();
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const on = () => r.setOnline(true);
    const off = () => r.setOnline(false);
    const vis = () => { if (document.visibilityState === 'visible') r.onVisible(); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [r]);
  // Sign-out or an account switch: the capture stops, and what is queued stays on the device.
  const [owner, setOwner] = useState(userId);
  useEffect(() => {
    if (owner != null && userId !== owner) r.signOut();
    setOwner(userId);
  }, [userId, owner, r]);
  // Recovery on app load (D685 §5.6.7): once per signed-in member, the recording
  // in flight comes back paused, what is queued here is sent, processing is followed.
  useEffect(() => {
    if (userId == null) return;
    r.setUser(userId);
    r.recover().catch(() => { /* a failed read leaves the app as it was */ });
  }, [userId, r]);
  return children ?? null;
}
