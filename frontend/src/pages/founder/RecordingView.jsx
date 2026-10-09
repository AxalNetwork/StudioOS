import React from 'react';
import { Pause, Play, Square, Flag, MicOff, WifiOff, Captions, CaptionsOff } from 'lucide-react';
import RingViz from '../../components/discovery/RingViz';
import { NO_SOUND_MS } from '../../lib/interviewCapture';

/**
 * The Recording View (D660, #1473), to `design/canvases/integrated/Recording View.dc.html`
 * and its boards (RV1–RV12). Eleven states, in light (the default) and dark.
 *
 * `recordingState` picks ONE state from what the capture reports, in the order
 * the canvas ranks them: a dialog or a stop in progress covers everything; a
 * denied microphone means nothing else can be true; offline and silence are
 * warnings over a live recording.
 */

export const STATES = ['speech', 'silence', 'paused', 'marked', 'offline', 'denied', 'nosound', 'stopping', 'reduced', 'drawer', 'confirm'];
export const SILENCE_MS = 2000;
export const STAGES = ['Uploading', 'Transcribing', 'Summarising', 'Placing findings'];

export function recordingState({ confirm, stopping, mic, paused, online, silentMs = 0, markedAt, now = 0, drawer, reduced }) {
  if (confirm) return 'confirm';
  if (stopping) return 'stopping';
  if (mic === 'denied') return 'denied';
  if (paused) return 'paused';
  if (online === false) return 'offline';
  if (silentMs >= NO_SOUND_MS) return 'nosound';
  if (markedAt != null && now - markedAt < 2500) return 'marked';
  if (drawer) return 'drawer';
  if (silentMs >= SILENCE_MS) return 'silence';
  if (reduced) return 'reduced';
  return 'speech';
}

/** ms → [hh:]mm:ss, as the canvas's clock. */
export function clock(ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

const ROUND = 'inline-flex h-12 w-12 items-center justify-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';

export default function RecordingView({
  state, theme = 'light', analyser, elapsedMs, interviewee, liveOn, liveAvailable, caption, lastMark,
  stage = 0, pending = 0, segments = [], points = [],
  onPause, onResume, onMark, onStop, onConfirmStop, onCancelStop, onToggleLive, onToggleDrawer, onRetryMic,
}) {
  const dark = theme === 'dark';
  const mode = state === 'paused' ? 'paused' : state === 'denied' ? 'denied' : state === 'stopping' ? 'stopping'
    : (state === 'silence' || state === 'nosound') ? 'silence' : 'speech';
  return (
    <div data-testid="recording-view" data-state={state} data-theme={theme}
      className={`${dark ? 'dark bg-[#0b0614] text-gray-100' : 'bg-[#faf9ff] text-gray-900'} fixed inset-0 z-40 flex flex-col md:static md:min-h-[640px] md:rounded-2xl md:border md:border-axal-hairline`}>
      <header className="flex items-center justify-between px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide">
            {state === 'paused' ? <span className="text-amber-600 dark:text-amber-400">Paused</span>
              : state === 'offline' ? <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><WifiOff size={13} /> Offline</span>
                : <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"><span className="h-2 w-2 rounded-full bg-current" /> Recording</span>}
          </div>
          <div className="text-[13px] text-gray-500 dark:text-gray-400">{interviewee || 'Name not recorded'}</div>
        </div>
        <div className="font-mono text-[22px] tabular-nums" data-testid="recording-clock">{clock(elapsedMs)}</div>
      </header>

      <div className="relative mx-auto flex w-full max-w-[420px] flex-1 items-center justify-center px-6">
        <div className="aspect-square w-full">
          <RingViz analyser={analyser} mode={mode} theme={theme} motion={state === 'reduced' ? 'reduced' : undefined} progress={(stage + 1) / STAGES.length} />
        </div>
        {state === 'stopping' && (
          <ol className="absolute inset-x-0 bottom-0 space-y-1 text-center text-[13px]" data-testid="stopping-stages">
            {STAGES.map((s, i) => <li key={s} className={i === stage ? 'font-bold' : i < stage ? 'text-gray-400 line-through' : 'text-gray-400'}>{s}{i >= 2 ? ' · Not recorded' : ''}</li>)}
          </ol>
        )}
      </div>

      <div className="min-h-[56px] px-6 text-center text-[14px]" aria-live="polite" data-testid="recording-banner">
        {state === 'denied' && (
          <div className="mx-auto max-w-md space-y-2">
            <p className="inline-flex items-center gap-1 font-bold"><MicOff size={14} /> StudioOS cannot hear the microphone</p>
            <p className="text-[12px] text-gray-500 dark:text-gray-400">Allow the microphone for axal.vc in this browser: click the lock icon in the address bar, set Microphone to Allow, then try again.</p>
            <button type="button" onClick={onRetryMic} className="rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white">Try again</button>
          </div>
        )}
        {state === 'nosound' && <p className="font-semibold text-amber-700 dark:text-amber-400">We can't hear anything. Check the microphone.</p>}
        {state === 'offline' && <p className="text-amber-700 dark:text-amber-400">Saved on this device, uploading when online{pending ? ` · ${pending} waiting` : ''}{liveOn ? ' · Live transcript paused while offline' : ''}</p>}
        {state === 'marked' && lastMark != null && <p className="font-semibold text-violet-700 dark:text-violet-300">Moment marked at {clock(lastMark)}</p>}
        {['speech', 'silence', 'reduced', 'drawer', 'paused'].includes(state) && (
          liveOn && liveAvailable
            ? <p className="text-gray-700 dark:text-gray-300" data-testid="live-caption">{caption || '…'}</p>
            : <p className="text-gray-500 dark:text-gray-400" data-testid="live-off-note">Live transcript off. The transcript appears when you stop.</p>
        )}
      </div>

      {state === 'drawer' && (
        <section className="mx-4 mb-2 max-h-[40vh] overflow-y-auto rounded-xl border border-axal-hairline bg-white/80 p-3 text-[13px] dark:border-gray-800 dark:bg-gray-900/80" data-testid="transcript-drawer">
          <h3 className="mb-1 text-[11px] font-bold uppercase text-gray-500">Talking points</h3>
          {points.length ? <ul className="mb-2 list-disc pl-4">{points.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="mb-2 text-gray-500">Not recorded</p>}
          {segments.length ? segments.map((s) => <p key={s.id}><strong>{s.speaker_label}</strong> {s.text}</p>) : <p className="text-gray-500">No live passages yet.</p>}
        </section>
      )}

      <footer className="flex items-center justify-center gap-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        {liveAvailable && (
          <button type="button" data-testid="button-toggle-live" className={`${ROUND} border-gray-200 dark:border-gray-700`} onClick={onToggleLive}
            aria-label={liveOn ? 'Hide live transcript' : 'Show live transcript'} title={liveOn ? 'Hide live transcript' : 'Show live transcript'}>
            {liveOn ? <CaptionsOff size={18} /> : <Captions size={18} />}
          </button>
        )}
        <button type="button" data-testid="button-mark" className={`${ROUND} border-gray-200 dark:border-gray-700`} onClick={onMark} disabled={state === 'paused' || state === 'denied'} aria-label="Mark this moment"><Flag size={18} /></button>
        {state === 'paused'
          ? <button type="button" data-testid="button-resume" className={`${ROUND} h-16 w-16 border-violet-700 bg-violet-700 text-white`} onClick={onResume} aria-label="Resume"><Play size={22} /></button>
          : <button type="button" data-testid="button-pause" className={`${ROUND} h-16 w-16 border-violet-700 bg-violet-700 text-white`} onClick={onPause} disabled={state === 'denied' || state === 'stopping'} aria-label="Pause"><Pause size={22} /></button>}
        <button type="button" data-testid="button-stop" className={`${ROUND} border-gray-200 dark:border-gray-700`} onClick={onStop} disabled={state === 'stopping'} aria-label="Stop and process this session"><Square size={18} /></button>
        <button type="button" data-testid="button-drawer" className="text-[12px] font-semibold underline" onClick={onToggleDrawer}>Talking points</button>
      </footer>

      {state === 'confirm' && (
        <div role="dialog" aria-label="Stop and process this session?" data-testid="confirm-stop" className="absolute inset-0 flex items-end justify-center bg-black/40 p-4 md:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
            <h3 className="text-[16px] font-bold">Stop and process this session?</h3>
            <p className="mt-1 text-[13px] text-gray-600 dark:text-gray-300">The recording ends. Eadwyn transcribes it, writes the summary and proposes placements for you to review.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onCancelStop} className="rounded-md px-3 py-1.5 text-[13px] font-bold">Keep recording</button>
              <button type="button" data-testid="button-confirm-stop" onClick={onConfirmStop} className="rounded-md bg-violet-700 px-3 py-1.5 text-[13px] font-bold text-white">Stop and process</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
