import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { createCapture, indexedDbQueue } from '../../lib/interviewCapture';
import { prefersReducedMotion } from '../../components/discovery/RingViz';
import RecordingView, { recordingState } from './RecordingView';
import { ModelList, AUDIO } from './RecordSessionSheet';

/**
 * Validate › an interview session (D660, #1473), at `/validate/session/:id`, to
 * `design/incoming/Interview Session.dc.html` (`start`, `record`, `liveoff`,
 * `text`, `review`). On a phone the Recording View covers the screen.
 *
 * EVERY NUMBER IS THE WORKER'S. The clock on screen is the browser's, for the
 * person recording; the duration billed and stored is D657's `active_ms`. The
 * receipt and the meter read `GET /sessions/:id/receipt`; a budget that cannot
 * be read says "Unreadable", never $0.
 *
 * STOP → TRANSCRIBE → POLL. Stopping flushes the device's queue, asks the
 * Worker to transcribe with the session's final model, and re-reads the session
 * until it leaves `transcribing`. Summarising and placing findings are #1471's
 * (D658) and say "Not recorded" until that lands.
 */

const POLL_MS = 3000;
export const SPEAKER_CHOICES = (name) => ['Me', (name || '').trim() || 'Interviewee', 'Speaker ?'];
const usd = (micro) => `$${(Number(micro || 0) / 1e6).toFixed(4)}`;

/** The start step: consent first, and the Worker's own words when it refuses. */
export function StartPanel({ session, error, busy, onStart, onConsent }) {
  const audio = AUDIO.has(session.channel);
  const given = session.consent_status === 'given';
  return (
    <section className="rounded-2xl border border-axal-hairline p-5 dark:border-gray-800" data-testid="session-start">
      <h2 className="text-[16px] font-bold">Ready to record</h2>
      {audio && !given && (
        <div className="mt-3 space-y-2">
          <p className="text-[13px] text-axal-faint" data-testid="start-consent-note">{session.consent_status === 'declined' ? 'The interviewee declined to be recorded.' : 'Recording consent · Not recorded'}</p>
          <div className="flex flex-wrap gap-1.5">
            {[['verbal', 'Said yes, out loud'], ['written', 'In writing'], ['in_app', 'In the app'], ['pre_agreed', 'Agreed beforehand']].map(([m, l]) => (
              <button key={m} type="button" data-testid={`start-consent-${m}`} onClick={() => onConsent?.(m)} className="rounded-full border border-gray-200 px-3 py-1 text-[12px] font-semibold dark:border-gray-700">{l}</button>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert" data-testid="start-error" className="mt-3 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>}
      <button type="button" data-testid="button-session-start" disabled={busy || (audio && !given)} onClick={onStart}
        className="mt-4 rounded-md bg-violet-700 px-4 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Start recording</button>
      {audio && !given && <p className="mt-2 text-[12px] text-axal-faint">Start unlocks once consent is recorded.</p>}
    </section>
  );
}

/** The review step: the transcript, one tap per speaker. */
export function TranscriptReview({ segments, intervieweeName, onAssign }) {
  const finals = segments.filter((s) => s.source === 'final');
  const rows = finals.length ? finals : segments;
  if (!rows.length) return <p className="text-[13px] text-axal-faint" data-testid="transcript-empty">Not recorded</p>;
  return (
    <ol className="space-y-3" data-testid="transcript">
      {rows.map((s) => (
        <li key={s.id} className="text-[13px]">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {SPEAKER_CHOICES(intervieweeName).map((label) => (
              <button key={label} type="button" data-testid={`speaker-${s.id}-${label}`} aria-pressed={s.speaker_label === label}
                onClick={() => s.speaker_label !== label && onAssign?.(s.id, label)}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${s.speaker_label === label ? 'border-violet-700 bg-violet-700 text-white' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}>{label}</button>
            ))}
          </div>
          <p className="text-gray-800 dark:text-gray-200">{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

/** The rail: models, the cost receipt and the meter. */
export function SessionRail({ session, models, receipt }) {
  const live = models?.live?.find((m) => m.model === session.live_model);
  const fin = models?.final?.find((m) => m.model === session.final_model);
  return (
    <aside className="space-y-4 text-[12px]" data-testid="session-rail">
      {AUDIO.has(session.channel) && (
        <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase text-axal-faint">Speech to text</h3>
          <p>Live: <strong>{session.live_model ? (live?.label || session.live_model) : 'Off'}</strong></p>
          <p>Final: <strong>{fin?.label || session.final_model || 'Not recorded'}</strong></p>
          {models === null && <p className="text-axal-faint">Unreadable: the model list could not be read.</p>}
          {models && (
            <details className="mt-1"><summary className="cursor-pointer text-axal-muted">All models</summary>
              <ModelList kind="rail-live" models={models.live} value={session.live_model} onChange={() => {}} />
              <ModelList kind="rail-final" models={models.final} value={session.final_model} onChange={() => {}} />
            </details>
          )}
        </section>
      )}
      <section data-testid="session-receipt">
        <h3 className="mb-1 text-[11px] font-bold uppercase text-axal-faint">Cost receipt</h3>
        {receipt === undefined ? <p className="text-axal-faint">Reading…</p>
          : receipt === null ? <p className="text-axal-faint">Unreadable: the receipt could not be read.</p>
            : receipt.items.length === 0 ? <p className="text-axal-faint">Not recorded</p>
              : (
                <ul className="space-y-0.5">
                  {receipt.items.map((r, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{r.kind} · {r.model}{r.fallback_used ? ' (fallback)' : ''}{r.outcome !== 'ok' && r.outcome ? ` · ${r.outcome}` : ''}</span>
                      <span className="tabular-nums">{usd(r.cost_microusd)}</span>
                    </li>
                  ))}
                </ul>
              )}
      </section>
      <section data-testid="session-meter">
        <h3 className="mb-1 text-[11px] font-bold uppercase text-axal-faint">Meter</h3>
        {receipt ? (
          <>
            <p className="flex justify-between"><span>This session</span><span className="tabular-nums">{usd(receipt.total_cost_microusd)}</span></p>
            {receipt.budget ? (
              <>
                <p className="flex justify-between"><span>Left today</span><span className="tabular-nums">{usd(receipt.budget.day_left_microusd)}</span></p>
                <p className="flex justify-between"><span>Left this month</span><span className="tabular-nums">{usd(receipt.budget.month_left_microusd)}</span></p>
              </>
            ) : <p className="text-axal-faint" data-testid="meter-unreadable">{receipt.budget_error || 'Unreadable'}</p>}
          </>
        ) : <p className="text-axal-faint">{receipt === null ? 'Unreadable' : 'Reading…'}</p>}
      </section>
    </aside>
  );
}

function useDarkTheme() {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return dark ? 'dark' : 'light';
}

export default function InterviewSessionPage({ api = interviewSessionsApi }) {
  const { id } = useParams();
  const location = useLocation();
  const theme = useDarkTheme();
  const [data, setData] = useState(undefined);
  const [models, setModels] = useState(undefined);
  const [receipt, setReceipt] = useState(undefined);
  const [error, setError] = useState(null);
  const [startError, setStartError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState({});
  const [ui, setUi] = useState({ confirm: false, drawer: false, stopping: false, stage: 0, markedAt: null, lastMark: null });
  const [now, setNow] = useState(() => Date.now());
  const capture = useRef(null);

  const load = useCallback(() => api.get(id).then((r) => { setData(r); return r; }).catch((e) => { setError(e?.message || 'Unreadable'); setData(null); }), [api, id]);
  const loadReceipt = useCallback(() => api.receipt(id).then(setReceipt).catch(() => setReceipt(null)), [api, id]);

  useEffect(() => { load(); loadReceipt(); api.models().then(setModels).catch(() => setModels(null)); }, [api, load, loadReceipt]);
  useEffect(() => () => { capture.current?.stop(); }, []);
  useEffect(() => {
    if (data?.session?.status !== 'recording') return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [data?.session?.status]);
  // Poll while the Worker transcribes.
  useEffect(() => {
    if (data?.session?.status !== 'transcribing') return undefined;
    const t = setTimeout(() => { load(); }, POLL_MS);
    return () => clearTimeout(t);
  }, [data, load]);

  // Reconnect: anything left on the device goes up when the browser is back.
  useEffect(() => {
    const on = () => capture.current?.flush();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);

  if (data === undefined) return <div className="p-6 text-[13px] text-axal-faint">Reading the session…</div>;
  if (data === null) return <div role="alert" className="p-6 text-[13px] text-red-700">{error}</div>;
  const { session, segments = [], marks = [] } = data;
  // The session row has no name; the sheet passes the interview it opened from.
  const intervieweeName = (location.state?.interview?.interviewee_name || '').trim() || null;

  const ensureCapture = () => {
    if (capture.current) return capture.current;
    capture.current = createCapture({
      deps: {
        getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
        AudioContext: window.AudioContext || window.webkitAudioContext,
        MediaRecorder: window.MediaRecorder,
        WebSocket: window.WebSocket,
        now: () => Date.now(), setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (t) => window.clearTimeout(t),
        liveUrl: api.liveUrl(session.id),
      },
      api: { uploadChunk: (seq, blob, startMs) => api.uploadChunk(session.id, seq, blob, startMs) },
      queue: indexedDbQueue(),
      sessionId: session.id,
      liveOn: !!session.live_model,
      onState: (st) => setCap((c) => ({ ...c, ...st, online: st.online !== false && (typeof navigator === 'undefined' || navigator.onLine !== false) })),
    });
    return capture.current;
  };

  const start = async () => {
    setBusy(true); setStartError(null);
    try {
      const c = ensureCapture();
      const mic = await c.open();
      if (mic === 'denied') { setCap((x) => ({ ...x, mic: 'denied' })); return; }
      const r = await api.action(session.id, session.status === 'paused' ? 'resume' : 'start');
      setData((d) => ({ ...d, session: r.session }));
      c.start();
    } catch (e) {
      // The Worker's 409 `consent_not_recorded` — in its own words.
      setStartError(e?.message || 'The session could not start.');
    } finally { setBusy(false); }
  };

  const consent = async (method) => {
    try { const r = await api.setConsent(session.id, 'given', method); setData((d) => ({ ...d, session: r.session })); setStartError(null); } catch (e) { setStartError(e?.message); }
  };

  const act = async (action) => {
    const r = await api.action(session.id, action);
    setData((d) => ({ ...d, session: r.session }));
    if (action === 'pause') capture.current?.pause();
    if (action === 'resume') capture.current?.resume();
  };

  const mark = async () => {
    const offset = capture.current?.offsetMs() ?? 0;
    setUi((u) => ({ ...u, markedAt: Date.now(), lastMark: offset }));
    try { await api.mark(session.id, offset); } catch { /* the moment stays on screen; the Worker did not keep it */ }
  };

  const stop = async () => {
    setUi((u) => ({ ...u, confirm: false, stopping: true, stage: 0 }));
    try {
      const r = await api.action(session.id, 'stop');
      setData((d) => ({ ...d, session: r.session }));
      await capture.current?.stop();
      capture.current = null;
      setUi((u) => ({ ...u, stage: 1 }));
      setData((d) => ({ ...d, session: { ...d.session, status: 'transcribing' } }));
      await api.transcribe(session.id, session.final_model);
    } catch (e) {
      setError(e?.message || 'The transcript could not be made.');
    } finally {
      setUi((u) => ({ ...u, stopping: false }));
      await load(); loadReceipt();
    }
  };

  const assign = async (segId, label) => {
    await api.setSpeaker(session.id, segId, label);
    setData((d) => ({ ...d, segments: d.segments.map((s) => (s.id === segId ? { ...s, speaker_label: label } : s)) }));
  };

  const recording = ['recording', 'paused'].includes(session.status) || ui.stopping;
  const state = recordingState({
    confirm: ui.confirm, stopping: ui.stopping, mic: cap.mic, paused: session.status === 'paused',
    online: cap.online, silentMs: cap.silentMs, markedAt: ui.markedAt, now, drawer: ui.drawer, reduced: prefersReducedMotion(),
  });
  const elapsed = (session.active_ms || 0) + (session.status === 'recording' && session.recording_since
    ? Math.max(0, now - Date.parse(`${String(session.recording_since).replace(' ', 'T')}Z`)) : 0);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-[1fr_280px] md:p-6" data-testid="interview-session-page">
      <main className="min-w-0 space-y-4">
        <nav className="text-[12px]"><Link to="/validate/interviews" className="text-axal-muted underline">Interviews</Link></nav>
        {error && <p role="alert" className="text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>}
        {session.status === 'draft' && <StartPanel session={session} error={startError} busy={busy} onStart={start} onConsent={consent} />}
        {recording && (
          <RecordingView
            state={state} theme={theme} analyser={cap.analyser} elapsedMs={elapsed} interviewee={intervieweeName}
            liveOn={cap.live ?? !!session.live_model} liveAvailable={!!session.live_model} caption={cap.caption}
            lastMark={ui.lastMark} stage={ui.stage} pending={cap.pending || 0}
            segments={segments.filter((s) => s.source === 'live')}
            onPause={() => act('pause')} onResume={() => (capture.current ? act('resume') : start())} onMark={mark}
            onStop={() => setUi((u) => ({ ...u, confirm: true }))} onCancelStop={() => setUi((u) => ({ ...u, confirm: false }))}
            onConfirmStop={stop} onToggleDrawer={() => setUi((u) => ({ ...u, drawer: !u.drawer }))}
            onToggleLive={() => capture.current?.setLive(!(cap.live ?? !!session.live_model))} onRetryMic={start}
          />
        )}
        {session.status === 'transcribing' && <p className="text-[13px] text-axal-faint" data-testid="session-transcribing">Transcribing…</p>}
        {['stopped', 'transcribed', 'structured', 'reviewed'].includes(session.status) && !ui.stopping && (
          <section className="space-y-3">
            <h2 className="text-[16px] font-bold">Transcript</h2>
            {session.status === 'stopped' && AUDIO.has(session.channel) && (
              <button type="button" onClick={async () => { try { await api.transcribe(session.id, session.final_model); } catch (e) { setError(e?.message); } load(); loadReceipt(); }} className="rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white">Transcribe</button>
            )}
            <TranscriptReview segments={segments} intervieweeName={intervieweeName} onAssign={assign} />
            {marks.length > 0 && (
              <ul className="text-[12px] text-axal-muted">{marks.map((m) => <li key={m.id}>Marked at {Math.floor(m.offset_ms / 60000)}:{String(Math.floor((m.offset_ms % 60000) / 1000)).padStart(2, '0')}{m.label ? ` · ${m.label}` : ''}</li>)}</ul>
            )}
          </section>
        )}
      </main>
      <SessionRail session={session} models={models} receipt={receipt} />
    </div>
  );
}
