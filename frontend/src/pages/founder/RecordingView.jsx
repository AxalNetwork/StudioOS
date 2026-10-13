import React, { useEffect, useRef } from 'react';
import { Pause, Play, Square, Flag, ListChecks, X, Captions, CaptionsOff, MicOff, MonitorUp, Mic } from 'lucide-react';
import RingViz from '../../components/discovery/RingViz';
import { NO_SOUND_MS } from '../../lib/interviewCapture';
import { STAGES, elapsedMs } from '../../lib/activeRecording';
import { FOCUSABLE, tabTarget } from '../../ui/lightboxFocus.js';
import { NOT_STORED } from './recordSetup.js';

/**
 * The Recording View (D685 §5.7, #1588), full screen at `/validate/record/live`,
 * to `design/canvases/integrated/Recording View.dc.html` and RV1–RV13.
 *
 * INDEPENDENT LAYERS (§5.7.11). `layers` returns one flag per thing the screen
 * can be showing at once: paused AND offline, a mark's toast over the drawer.
 * The old one-state reducer hid all but the first.
 *
 * The visible status follows the canvas; a visually hidden `role="status"`
 * announces Recording, Paused, Offline and Stopped, because the timer is
 * `aria-live` off. Captions are NOT in a live region: every interim caption
 * was being read aloud.
 */

/** The canvas's state names, kept for the boards' census. */
export const STATES = ['speech', 'silence', 'paused', 'marked', 'offline', 'denied', 'nosound', 'stopping', 'reduced', 'drawer', 'confirm'];
export const SILENCE_MS = 2000;
export { STAGES };

/** The flags the screen draws from, each on its own (§5.7.11). */
export function layers(st, { reduced = false } = {}) {
  const cap = st?.cap || {};
  const live = st?.phase === 'recording';
  const silent = live ? Number(cap.silentMs) || 0 : 0;
  return {
    share: st?.phase === 'share',
    denied: st?.phase === 'denied' || cap.mic === 'denied',
    micLost: live && (cap.mic === 'ended' || cap.mic === 'muted'),
    paused: st?.phase === 'paused',
    offline: st?.online === false || cap.online === false,
    stopping: st?.phase === 'stopping',
    confirm: !!st?.confirm,
    drawer: !!st?.drawer,
    toast: !!st?.toast,
    nosound: live && silent >= NO_SOUND_MS,
    silence: live && silent >= SILENCE_MS,
    budget: !!cap.budget,
    shareNote: cap.shareNote || null,
    reduced: !!reduced,
  };
}

/** The ring's mode: one picture, from the layers. */
export function ringMode(l) {
  if (l.stopping) return 'stopping';
  if (l.denied) return 'denied';
  if (l.paused || l.share) return 'paused';
  if (l.silence || l.nosound) return 'silence';
  return 'speech';
}

/** What the hidden status announces (the timer is aria-live off). */
export function statusWord(l, phase) {
  if (phase === 'ready' || l.stopping) return 'Stopped';
  if (l.offline) return 'Offline';
  if (l.paused) return 'Paused';
  return 'Recording';
}

/** ms → hh:mm:ss, as the canvas draws it (§5.7.2), the hour always shown. */
export function clock(ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
/** mm:ss, for a marked moment. */
export const short = (ms) => clock(ms).replace(/^00:/, '');

/** The language under the timer: a name from the session, never a default "English". */
const LANGS = { en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', hi: 'Hindi', ar: 'Arabic', ru: 'Russian', pl: 'Polish', sv: 'Swedish', tr: 'Turkish' };
export const languageName = (code) => (code && Object.hasOwn(LANGS, code) ? LANGS[code] : null);

/** The share step's note when the call's audio is not in the recording (§5.8.3). */
export const SHARE_NOTES = {
  not_shared: 'Recording your microphone only: the call’s audio was not shared.',
  no_audio: 'Recording your microphone only: the call’s audio was not shared.',
  unsupported: 'Recording your microphone only: this browser cannot share a tab’s audio.',
};

/** Initials for the "You" tile. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : 'You';
}

const ROUND = 'inline-flex h-[68px] w-[68px] flex-col items-center justify-center gap-0.5 rounded-full border text-[10.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-40';
const ROUND_PLAIN = `${ROUND} border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-[#2a2140] dark:bg-[#130b22] dark:text-gray-100 dark:hover:bg-[#1c1230]`;
const PILL = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold';

/** Keep Tab inside a box, and Escape calls `onEscape`. */
function useTrap(ref, onEscape, active) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof el.querySelectorAll !== 'function') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
      if (e.key !== 'Tab') return;
      const list = Array.from(el.querySelectorAll(FOCUSABLE));
      const to = tabTarget(list, document.activeElement, e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      (to === -1 ? el : list[to]).focus();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref, onEscape, active]);
}

/** The talking-points drawer (§5.2, RV11): a bottom sheet, its count announced politely. */
export function PointsDrawer({ points = [], stored = false, onClose, returnTo }) {
  const box = useRef(null);
  const close = useRef(null);
  useTrap(box, onClose, true);
  useEffect(() => {
    close.current?.focus?.();
    const back = returnTo?.current;
    return () => { back?.focus?.(); };
  }, [returnTo]);
  const covered = points.filter((p) => p.covered).length;
  return (
    <section ref={box} id="recording-points" role="dialog" aria-modal="false" aria-label="Talking points" data-testid="points-drawer"
      className="absolute inset-x-0 bottom-0 z-10 max-h-[60vh] overflow-y-auto rounded-t-[20px] border-t border-gray-200 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-gray-900 shadow-2xl dark:border-[#2a2140] dark:bg-[#130b22] dark:text-gray-100">
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-[#3a2f52]" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-bold">Talking points</h2>
        <button ref={close} type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#1c1230]" data-testid="points-close">Close</button>
      </div>
      {points.length === 0 ? (
        <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400" data-testid="points-empty">No talking points were picked for this session.</p>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] text-gray-500 dark:text-gray-400" aria-live="polite" data-testid="points-count">{covered} of {points.length} covered</p>
          <ul className="mt-2 space-y-1.5">
            {points.map((p, i) => (
              <li key={p.id ?? i}>
                <label className={`flex items-start gap-2 text-[13.5px] ${p.covered ? 'text-violet-700 line-through opacity-50 dark:text-violet-300' : ''}`}>
                  <input type="checkbox" checked={!!p.covered} disabled={!stored} onChange={() => {}} className="mt-0.5 accent-violet-600" />
                  <span>{p.text}</span>
                </label>
              </li>
            ))}
          </ul>
          {!stored && <p className="mt-2 text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="points-not-stored">{NOT_STORED}</p>}
        </>
      )}
    </section>
  );
}

/** "Stop and process this session?" (§5.7.9): modal, Escape keeps recording, focus returns to Stop. */
export function StopConfirm({ onKeep, onStop, onDiscard, returnTo }) {
  const box = useRef(null);
  const keep = useRef(null);
  useTrap(box, onKeep, true);
  useEffect(() => {
    keep.current?.focus?.();
    const back = returnTo?.current;
    return () => { back?.focus?.(); };
  }, [returnTo]);
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/50 p-4 md:items-center">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="stop-title" aria-describedby="stop-body" data-testid="confirm-stop"
        className="w-full max-w-sm rounded-2xl bg-white p-5 text-gray-900 shadow-2xl dark:bg-[#130b22] dark:text-gray-100">
        <h2 id="stop-title" className="m-0 text-[16px] font-bold">Stop and process this session?</h2>
        <p id="stop-body" className="mt-1 text-[13px] text-gray-600 dark:text-gray-300">The recording ends. Eadwyn transcribes it, writes the summary and proposes placements for you to review.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={keep} type="button" onClick={onKeep} data-testid="button-keep-recording" className="rounded-md px-3 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-[#1c1230]">Keep recording</button>
          <button type="button" onClick={onStop} data-testid="button-confirm-stop" className="rounded-md bg-red-600 px-3 py-2 text-[13px] font-bold text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600">Stop and process</button>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-[#2a2140]">
          <button type="button" onClick={onDiscard} data-testid="button-discard" className="text-[12.5px] font-semibold text-gray-500 underline hover:text-red-700 dark:text-gray-400 dark:hover:text-red-300">Discard this recording</button>
          <p className="m-0 mt-1 text-[11.5px] text-gray-500 dark:text-gray-400">Use this if the interviewee withdraws consent. It records that, then deletes the session and its audio.</p>
        </div>
      </div>
    </div>
  );
}

/** The shared tab's picture, for the interviewee's tile. Nothing of it is recorded. */
function TabVideo({ stream }) {
  const v = useRef(null);
  useEffect(() => { if (v.current && 'srcObject' in v.current) v.current.srcObject = stream || null; }, [stream]);
  return <video ref={v} autoPlay muted playsInline className="h-full w-full rounded-xl bg-black object-cover" data-testid="tile-video" />;
}

export default function RecordingView({ st, now = Date.now(), theme = 'light', reduced = false, you = '', actions = {}, onExit }) {
  const exitRef = useRef(null);
  const stopRef = useRef(null);
  const drawerBtn = useRef(null);
  const l = layers(st, { reduced });
  const s = st?.session || {};
  const dark = theme === 'dark';
  const name = String(st?.interview?.interviewee_name || '').trim() || 'Name not recorded';
  const company = String(st?.interview?.interviewee_company || '').trim() || 'Not recorded';
  const elapsed = elapsedMs(s, now);
  const lang = l.denied ? null : languageName(s.language);
  const liveOn = st?.cap?.live ?? !!s.live_model;
  const liveAvailable = !!s.live_model && !l.budget;
  const tiles = st?.video && !l.share;

  // Focus moves into the view when it opens; the caller returns it on exit.
  useEffect(() => { exitRef.current?.focus?.(); }, []);

  return (
    <div data-testid="recording-view" data-theme={theme} role="region" aria-label="Recording"
      data-paused={l.paused ? 'true' : 'false'} data-offline={l.offline ? 'true' : 'false'}
      className={`${dark ? 'dark text-gray-100' : 'text-gray-900'} fixed inset-0 z-[90] flex flex-col overflow-hidden`}
      style={{ background: dark ? 'radial-gradient(120% 90% at 50% 40%, #130b22 0%, #07050d 70%)' : '#faf9ff' }}>
      <p className="sr-only" role="status" data-testid="recording-status">{statusWord(l, st?.phase)}</p>

      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="min-w-0 space-y-1.5">
          <div className="truncate text-[14px] font-semibold" data-testid="recording-who">{name} · <span className={company === 'Not recorded' ? 'text-gray-500 dark:text-gray-400' : ''}>{company}</span></div>
          <div className="flex flex-wrap items-center gap-1.5">
            {st?.callLabel && <span className={`${PILL} bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200`} data-testid="recording-call-label">{st.callLabel}</span>}
            {l.offline && <span className={`${PILL} bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`} data-testid="recording-offline">Saved on this device, uploading when online</span>}
          </div>
        </div>
        <button ref={exitRef} type="button" onClick={onExit} aria-label="Exit full screen" title="Exit full screen" data-testid="button-exit-full-screen"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#1c1230]"><X size={20} /></button>
      </header>

      {tiles && (
        <div className="hidden justify-center gap-3 px-5 md:flex" data-testid="recording-tiles">
          <figure className="m-0 flex h-[168px] w-[240px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#2a2140] dark:bg-[#130b22]">
            <div className="min-h-0 flex-1">{st?.cap?.displayVideo ? <TabVideo stream={st.cap.displayVideo} /> : <div className="flex h-full items-center justify-center text-[12px] text-gray-500 dark:text-gray-400">The call’s tab is not shared</div>}</div>
            <figcaption className="px-2 py-1 text-[11.5px] font-semibold">{name}</figcaption>
          </figure>
          <figure className="m-0 flex h-[112px] w-[112px] flex-col items-center justify-center rounded-xl border border-gray-200 bg-white dark:border-[#2a2140] dark:bg-[#130b22]" data-testid="tile-you">
            <span className="text-[22px] font-bold text-violet-700 dark:text-violet-300">{initials(you)}</span>
            <figcaption className="text-[11.5px] text-gray-500 dark:text-gray-400">You</figcaption>
          </figure>
        </div>
      )}

      <div className="relative mx-auto flex w-full max-w-[420px] flex-1 items-center justify-center px-6">
        <div className="relative aspect-square w-full">
          <RingViz analyser={st?.cap?.analyser || null} mode={ringMode(l)} theme={theme} motion={reduced ? 'reduced' : undefined}
            progress={(Number(st?.stage) + 1) / STAGES.length} flash={reduced ? null : st?.toast?.at ?? null} />
          {!l.stopping && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div role="timer" aria-live="off" aria-label={`Elapsed ${clock(elapsed)}`} data-testid="recording-clock"
                className={`font-mono text-[34px] font-semibold tabular-nums ${l.paused && !reduced ? 'motion-safe:animate-pulse' : ''}`}>{clock(elapsed)}</div>
              {lang && <div className="text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="recording-language">{lang}</div>}
            </div>
          )}
        </div>
        {l.stopping && (
          <ol className="absolute inset-x-0 bottom-0 space-y-1 text-center text-[13px]" data-testid="stopping-stages">
            {STAGES.map((x, i) => <li key={x} className={i === st.stage ? 'font-bold' : i < st.stage ? 'text-gray-400 line-through' : 'text-gray-400 dark:text-gray-500'}>{x}{i >= 2 ? ' · Not recorded' : ''}</li>)}
          </ol>
        )}
      </div>

      <div className="min-h-[56px] space-y-2 px-6 text-center text-[14px]" data-testid="recording-notes">
        {l.toast && <p role="status" className="font-semibold text-violet-700 dark:text-violet-300" data-testid="recording-toast">Moment marked at {short(st.toast.offset)}</p>}
        {l.nosound && <p className="font-semibold text-amber-700 dark:text-amber-300" data-testid="recording-nosound">We can't hear anything. Check the microphone.</p>}
        {l.micLost && <p className="font-semibold text-amber-700 dark:text-amber-300" data-testid="recording-mic-lost">The microphone stopped sending sound. Check it is connected and not muted.</p>}
        {l.offline && liveOn && <p className="text-amber-700 dark:text-amber-300">Live transcript paused while offline</p>}
        {l.budget && <p className="text-amber-700 dark:text-amber-300" data-testid="recording-budget">Live captions stopped: your AI budget is spent. The recording continues, and the transcript appears when you stop.</p>}
        {l.shareNote && SHARE_NOTES[l.shareNote] && <p className="text-gray-600 dark:text-gray-300" data-testid="recording-share-note">{SHARE_NOTES[l.shareNote]}</p>}
        {st?.wake === 'unsupported' && (l.paused || st?.phase === 'recording') && <p className="text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="recording-wake">This browser cannot keep the screen on. Keep it awake so the recording continues.</p>}
        {st?.error && <p role="alert" className="font-semibold text-red-700 dark:text-red-300" data-testid="recording-error">{st.error}</p>}
        {!l.share && !l.denied && !l.stopping && !l.offline && (
          liveOn && liveAvailable
            ? <p className="text-gray-700 dark:text-gray-300" data-testid="live-caption">{st?.cap?.caption || '…'}</p>
            : !l.budget && <p className="text-gray-500 dark:text-gray-400" data-testid="live-off-note">Live transcript off. The transcript appears when you stop.</p>
        )}
      </div>

      {l.share && (
        <div className="mx-4 mb-4 rounded-2xl border border-gray-200 bg-white p-4 text-center dark:border-[#2a2140] dark:bg-[#130b22]" data-testid="share-step">
          <p className="m-0 text-[13.5px] font-semibold">Share the call’s tab, so its audio is recorded with your microphone.</p>
          <p className="m-0 mt-1 text-[12px] text-gray-500 dark:text-gray-400">Pick the tab the call is in, and turn on “Share tab audio”. Nothing of its picture is recorded or stored.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => actions.share?.()} data-testid="button-share-tab" className="inline-flex items-center gap-1.5 rounded-md bg-violet-700 px-3 py-2 text-[13px] font-bold text-white hover:bg-violet-800"><MonitorUp size={15} /> Share the call’s tab</button>
            <button type="button" onClick={() => actions.share?.({ micOnly: true })} data-testid="button-mic-only" className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-[13px] font-semibold hover:bg-gray-50 dark:border-[#2a2140] dark:hover:bg-[#1c1230]"><Mic size={15} /> Record without the call’s audio</button>
          </div>
        </div>
      )}

      {l.denied && (
        <div className="mx-4 mb-4 rounded-2xl border border-gray-200 bg-white p-4 text-center dark:border-[#2a2140] dark:bg-[#130b22]" data-testid="denied-card">
          <p className="m-0 inline-flex items-center gap-1 font-bold"><MicOff size={14} /> StudioOS cannot hear the microphone</p>
          <p className="m-0 mt-1 text-[12px] text-gray-500 dark:text-gray-400">Allow the microphone for axal.vc in this browser: click the lock icon in the address bar, set Microphone to Allow, then try again.</p>
          <button type="button" onClick={() => actions.retryMic?.()} data-testid="button-retry-mic" className="mt-3 rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-violet-800">Try again</button>
        </div>
      )}

      {!l.stopping && !l.share && !l.denied && (
        <footer className="flex items-center justify-center gap-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:gap-4">
          {l.paused
            ? <button type="button" data-testid="button-resume" className={ROUND_PLAIN} onClick={() => actions.resume?.()} aria-label="Resume"><Play size={20} />Resume</button>
            : <button type="button" data-testid="button-pause" className={ROUND_PLAIN} onClick={() => actions.pause?.()} aria-label="Pause"><Pause size={20} />Pause</button>}
          <button type="button" data-testid="button-mark" className={ROUND_PLAIN} onClick={() => actions.mark?.()} disabled={l.paused} aria-label="Mark this moment"><Flag size={18} />Mark</button>
          <button ref={stopRef} type="button" data-testid="button-stop" className={`${ROUND} border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-500 dark:bg-red-500 dark:hover:bg-red-600`} onClick={() => actions.askStop?.()} aria-label="Stop and process this session"><Square size={18} />Stop</button>
          <button ref={drawerBtn} type="button" data-testid="button-drawer" className={ROUND_PLAIN} onClick={() => actions.toggleDrawer?.()} aria-label="Talking points" aria-expanded={l.drawer} aria-controls="recording-points"><ListChecks size={18} />Points</button>
          {s.live_model && !l.budget && (
            <button type="button" data-testid="button-toggle-live" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-[#2a2140] dark:text-gray-200 dark:hover:bg-[#1c1230]" onClick={() => actions.toggleLive?.()}
              aria-label={liveOn ? 'Hide live transcript' : 'Show live transcript'} title={liveOn ? 'Hide live transcript' : 'Show live transcript'}>
              {liveOn ? <CaptionsOff size={17} /> : <Captions size={17} />}
            </button>
          )}
        </footer>
      )}

      {l.drawer && <PointsDrawer points={st?.points || []} stored={false} onClose={() => actions.toggleDrawer?.(false)} returnTo={drawerBtn} />}
      {l.confirm && <StopConfirm onKeep={() => actions.cancelStop?.()} onStop={() => actions.confirmStop?.()} onDiscard={() => actions.discard?.()} returnTo={stopRef} />}
    </div>
  );
}
