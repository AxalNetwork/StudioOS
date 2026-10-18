import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { useActiveRecording } from '../../contexts/ActiveRecordingContext';
import { STAGES, STAGE_KEYS, liveRefusal } from '../../lib/activeRecording.js';
import { AssistantBadge } from './AssistantEntry';
import { ChannelOriginBadge } from './ChannelOriginBadge.jsx';
import { channelOf, openingStep } from './assistantSession.js';
import { ModelList, AUDIO } from './RecordSessionSheet';
import InterviewReview from './InterviewReview';
import SessionSummary from './SessionSummary';
import { ChannelSessionPanel } from './InterviewChannels';
import { clock } from './interviewReviewModel.js';

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
 * STOP → FINISH → POLL (D685 §5.9). The recorder above the routes stops,
 * flushes, calls `finish` and follows the Worker's processing to the review
 * (`lib/activeRecording.js`). A session whose processing is under way or has
 * failed, opened here after a reload, is handed to it and shown in the live
 * view, from the Worker's processing state. `Transcribe` stays for a stopped
 * session that never reached `finish`.
 */

const POLL_MS = 3000;
export const SPEAKER_CHOICES = (name) => ['Me', (name || '').trim() || 'Interviewee', 'Speaker ?'];
const usd = (micro) => `$${(Number(micro || 0) / 1e6).toFixed(4)}`;

/** The start step: consent first, and the Worker's own words when it refuses. */
export function StartPanel({ session, error, liveHref = null, busy, onStart, onConsent }) {
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
      {error && (
        <p role="alert" data-testid="start-error" className="mt-3 text-[13px] font-semibold text-red-700 dark:text-red-400">
          {error}
          {liveHref && <>{' '}<Link to={liveHref} className="underline" data-testid="start-error-live">Return to that recording</Link></>}
        </p>
      )}
      <button type="button" data-testid="button-session-start" disabled={busy || (audio && !given)} onClick={onStart}
        className="mt-4 rounded-md bg-violet-700 px-4 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Start recording</button>
      {audio && !given && <p className="mt-2 text-[12px] text-axal-faint">Start unlocks once consent is recorded.</p>}
    </section>
  );
}

/**
 * The review step: the transcript, one tap per speaker. With `time` (the
 * interview record, D697), each passage starts with its time as `[hh:mm:ss]`;
 * this page's own review does not pass it, so it draws no time.
 */
export function TranscriptReview({ segments, intervieweeName, onAssign, time = false }) {
  const finals = segments.filter((s) => s.source === 'final');
  const rows = finals.length ? finals : segments;
  if (!rows.length) return <p className="text-[13px] text-axal-faint" data-testid="transcript-empty">Not recorded</p>;
  return (
    <ol className="space-y-3" data-testid="transcript">
      {rows.map((s) => (
        <li key={s.id} id={`seg-${s.id}`} className="scroll-mt-4 text-[13px]">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {SPEAKER_CHOICES(intervieweeName).map((label) => (
              <button key={label} type="button" data-testid={`speaker-${s.id}-${label}`} aria-pressed={s.speaker_label === label}
                onClick={() => s.speaker_label !== label && onAssign?.(s.id, label)}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${s.speaker_label === label ? 'border-violet-700 bg-violet-700 text-white' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}>{label}</button>
            ))}
          </div>
          <p className="text-gray-800 dark:text-gray-200">
            {time && clock(s.start_ms) && (
              <span className="mr-1.5 font-mono text-[11.5px] tabular-nums text-axal-faint dark:text-gray-400" data-testid={`seg-time-${s.id}`}>{clock(s.start_ms)}</span>
            )}
            {s.text}
          </p>
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
      {/* D684: a Zoom or Meet session's words are the provider's transcript; no model of ours made them. */}
      {AUDIO.has(session.channel) && !channelOf(session) && (
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

/**
 * The review step's calls (D658, #1494), as functions over a state setter so
 * a test can drive them with a fake API. Each failure is kept as the thrown
 * error, so `InterviewReview` can tell a budget refusal from a writer's
 * refusal from a citation refusal by the Worker's own fields.
 */
export function makeReviewActions({ api, sessionId, set, onSpent }) {
  const reload = async () => {
    try { const read = await api.placements(sessionId); set((st) => ({ ...st, read })); } catch { set((st) => ({ ...st, read: null })); }
  };
  return {
    reload,
    async structure(model) {
      set((st) => ({ ...st, running: true, runError: null }));
      // Only a model id is sent; anything else (a click event, say) is no model, so the Worker picks its default (#1589).
      try { await api.structure(sessionId, typeof model === 'string' && model ? model : undefined); await reload(); } catch (e) { set((st) => ({ ...st, runError: e })); }
      set((st) => ({ ...st, running: false }));
      onSpent?.();
    },
    async accept(id, payload) {
      set((st) => ({ ...st, busyId: id, errors: { ...st.errors, [id]: null } }));
      try { await api.accept(id, payload); await reload(); } catch (e) { set((st) => ({ ...st, errors: { ...st.errors, [id]: e } })); }
      set((st) => ({ ...st, busyId: null }));
    },
    async discard(id) {
      set((st) => ({ ...st, busyId: id, errors: { ...st.errors, [id]: null } }));
      try { await api.discard(id); await reload(); } catch (e) { set((st) => ({ ...st, errors: { ...st.errors, [id]: e } })); }
      set((st) => ({ ...st, busyId: null }));
    },
    async ask(question) {
      set((st) => ({ ...st, ask: { busy: true, result: null, error: null } }));
      try {
        const result = await api.ask(sessionId, question);
        set((st) => ({ ...st, ask: { busy: false, result, error: null } }));
      } catch (e) {
        set((st) => ({ ...st, ask: { busy: false, result: null, error: e } }));
      }
      onSpent?.();
    },
  };
}

export const REVIEW_INITIAL = { read: undefined, running: false, runError: null, errors: {}, busyId: null, ask: {} };

/** The review step, mounted: reads the placements and wires each action. */
export function ReviewStep({ api, sessionId, theme, receiptItems, onSpent }) {
  const [st, setSt] = useState(REVIEW_INITIAL);
  const actions = React.useMemo(() => makeReviewActions({ api, sessionId, set: setSt, onSpent }), [api, sessionId, onSpent]);
  useEffect(() => { actions.reload(); }, [actions]);
  if (st.read === undefined) return <p className="text-[13px] text-axal-faint">Reading the placements…</p>;
  if (st.read === null) return <p role="alert" className="text-[13px] text-red-700 dark:text-red-400">Unreadable: the placements could not be read.</p>;
  return (
    <InterviewReview
      theme={theme} read={st.read} running={st.running} runError={st.runError} errors={st.errors} busyId={st.busyId}
      onAccept={actions.accept} onDiscard={actions.discard} onStructure={actions.structure}
      ask={st.ask} onAsk={actions.ask} receiptItems={receiptItems}
    />
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
  const navigate = useNavigate();
  const theme = useDarkTheme();
  const { state: rec, recorder } = useActiveRecording();
  const [data, setData] = useState(undefined);
  const [models, setModels] = useState(undefined);
  const [receipt, setReceipt] = useState(undefined);
  const [error, setError] = useState(null);
  const [startError, setStartError] = useState(null);
  // #1588: a Start refused because this tab is still recording another session offers that one.
  const [startLive, setStartLive] = useState(null);
  const [adoptNote, setAdoptNote] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get(id).then((r) => { setData(r); return r; }).catch((e) => { setError(e?.message || 'Unreadable'); setData(null); }), [api, id]);
  const loadReceipt = useCallback(() => api.receipt(id).then(setReceipt).catch(() => setReceipt(null)), [api, id]);

  useEffect(() => { load(); loadReceipt(); api.models().then(setModels).catch(() => setModels(null)); }, [api, load, loadReceipt]);
  // §5.9.5: processing under way, or failed, and not followed in this tab: the live view shows it from the Worker's state.
  const followed = rec.session?.id != null && data?.session && String(rec.session.id) === String(data.session.id);
  const inFlight = !!data?.session && !followed && !!data?.processing?.stage && data.processing.stage !== 'done';
  // #1588: never handed over while this tab records another session, which
  // would leave that one's microphone running; the page shows it itself.
  const recordingOther = inFlight && !!liveRefusal(rec, recorder.isCapturing());
  // #1933: a session imported from a chat, an assistant or a call (`submitted_via`)
  // has nothing to capture, so it never opens the Recording View; the page shows its processing.
  const imported = inFlight && !!String(data?.session?.submitted_via || '').trim();
  const handOver = inFlight && !recordingOther && !imported;
  useEffect(() => {
    if (!handOver) return;
    recorder.follow({ session: data.session, interview: location.state?.interview || data.interview || null, processing: data.processing, callLabel: data.call_label ?? null });
    navigate(`/validate/record/live?session=${encodeURIComponent(data.session.id)}`, { replace: true });
  }, [handOver, data, recorder, navigate, location.state]);
  // Poll while the Worker transcribes, or processes an imported session here.
  useEffect(() => {
    if (data?.session?.status !== 'transcribing' && !imported) return undefined;
    const t = setTimeout(() => { load(); }, POLL_MS);
    return () => clearTimeout(t);
  }, [data, imported, load]);

  if (data === undefined) return <div className="p-6 text-[13px] text-axal-faint">Reading the session…</div>;
  if (data === null) return <div role="alert" className="p-6 text-[13px] text-red-700">{error}</div>;
  const { session, segments = [], marks = [], chunks = [] } = data;
  // The lightbox passes the interview it opened from; after a reload the session read carries it.
  const interview = location.state?.interview || data.interview || null;
  const intervieweeName = (interview?.interviewee_name || '').trim() || null;
  // D685 §5.6: the recording lives above the routes. This page hands it over and links to it.
  const mine = rec.session?.id != null && String(rec.session.id) === String(session.id);
  const live = `/validate/record/live?session=${encodeURIComponent(session.id)}`;

  /** Start, in this click: the recorder opens the microphone, then posts start (§5.6.5). */
  const refuseOverLive = () => {
    const held = liveRefusal(recorder.getSnapshot(), recorder.isCapturing());
    if (!held) return false;
    setStartError(held.text);
    setStartLive(`/validate/record/live?session=${encodeURIComponent(held.sessionId)}`);
    return true;
  };
  const start = async () => {
    setStartError(null); setStartLive(null);
    // Refused before the microphone opens or anything is posted (#1588).
    if (refuseOverLive()) return;
    // In this click, before anything is awaited (§5.6.5): the microphone and
    // the AudioContext, so iOS Safari does not start the context suspended.
    // A video call asks in its own click, "Share the call's tab".
    if (AUDIO.has(session.channel) && session.channel !== 'video') recorder.prepare?.();
    setBusy(true);
    try {
      const r = await recorder.begin({ session, interview, callLabel: data.call_label ?? null, points: data.points || [], video: session.channel === 'video' });
      if (r === 'busy') { refuseOverLive(); return; }
      if (r === 'refused') { setStartError(recorder.getSnapshot().error); return; }
      navigate(live);
    } catch (e) {
      recorder.release?.();
      // The Worker's 409 `consent_not_recorded` — in its own words.
      setStartError(e?.message || 'The session could not start.');
    } finally { setBusy(false); }
  };

  /**
   * A session left recording or paused with no capture in this tab (a reload,
   * another tab): it is paused, and resumed by hand with its seqs continued
   * (§5.6.6, §5.6.7). #1584's active read makes this automatic on app load.
   */
  const adopt = async () => {
    setBusy(true); setAdoptNote(null);
    try {
      const r = await recorder.adopt({ session, interview, callLabel: data.call_label ?? null, points: data.points || [], storedSeqs: chunks.map((c) => c.seq) });
      // #1588: the tab that holds it keeps it; nothing here pauses it.
      if (r === 'other_tab') { setAdoptNote('This recording is live in another tab. Go back to that tab to pause, resume or stop it.'); return; }
      if (r === 'busy') { setAdoptNote(liveRefusal(recorder.getSnapshot(), true)?.text || 'You are already recording another session.'); return; }
      navigate(live);
    } finally { setBusy(false); }
  };

  const consent = async (method) => {
    try { const r = await api.setConsent(session.id, 'given', method); setData((d) => ({ ...d, session: r.session })); setStartError(null); } catch (e) { setStartError(e?.message); }
  };

  const assign = async (segId, label) => {
    await api.setSpeaker(session.id, segId, label);
    setData((d) => ({ ...d, segments: d.segments.map((s) => (s.id === segId ? { ...s, speaker_label: label } : s)) }));
  };

  const recording = ['recording', 'paused'].includes(session.status);

  const reviewFirst = openingStep(session) === 'review';
  // D684: a channel session still waiting for its messages or its call's transcript.
  const waiting = openingStep(session) === 'channel';
  const review = ['transcribed', 'structured', 'reviewed'].includes(session.status) && (
    <section data-testid="session-review" data-first={reviewFirst ? 'true' : 'false'} className="space-y-2">
      <h2 className="text-[16px] font-bold">Review</h2>
      <SessionSummary summary={data.summary || null} segments={segments} />
      <ReviewStep api={api} sessionId={session.id} theme={theme} receiptItems={receipt === null ? null : receipt?.items} onSpent={loadReceipt} />
    </section>
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-[1fr_280px] md:p-6" data-testid="interview-session-page">
      <main className="min-w-0 space-y-4">
        <nav className="flex items-center gap-2 text-[12px]"><Link to={`/validate/customer-research?project_id=${session.project_id}`} className="text-axal-muted underline dark:text-gray-400">Customer research</Link><AssistantBadge session={session} /><ChannelOriginBadge session={session} /></nav>
        {error && <p role="alert" className="text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>}
        {session.status === 'draft' && (waiting
          ? <ChannelSessionPanel session={session} onChanged={() => { load(); loadReceipt(); }} />
          : <StartPanel session={session} error={startError} liveHref={startLive} busy={busy} onStart={start} onConsent={consent} />)}
        {recording && (
          <section className="rounded-2xl border border-axal-hairline p-5 dark:border-gray-800" data-testid="session-recording">
            {mine ? (
              <>
                <h2 className="m-0 text-[16px] font-bold">{session.status === 'paused' ? 'Paused' : 'Recording'}</h2>
                <p className="mt-1 text-[13px] text-axal-muted">The recording continues while you move around StudioOS.</p>
                <Link to={live} className="mt-3 inline-block rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-violet-800" data-testid="link-open-recording">Open the recording</Link>
              </>
            ) : (
              <>
                <h2 className="m-0 text-[16px] font-bold">This recording was interrupted</h2>
                <p className="mt-1 text-[13px] text-axal-muted">It was {session.status === 'paused' ? 'paused' : 'recording'} in another tab or before the page reloaded. Resume it here: it carries on after the audio already saved.</p>
                <button type="button" onClick={adopt} disabled={busy} className="mt-3 rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-violet-800 disabled:opacity-50" data-testid="button-adopt-recording">Resume here</button>
                {adoptNote && <p role="status" className="mt-2 text-[13px] font-semibold text-amber-800 dark:text-amber-300" data-testid="adopt-note">{adoptNote}</p>}
              </>
            )}
          </section>
        )}
        {(recordingOther || imported) && (
          <section role="status" className="rounded-2xl border border-axal-hairline p-4 text-[13px] dark:border-gray-800" data-testid="processing-here">
            <p className="m-0 font-semibold">
              {data.processing.stage === 'failed' ? 'Processing stopped' : `Processing · ${STAGES[STAGE_KEYS.indexOf(data.processing.stage)] || 'under way'}`}
            </p>
            {data.processing.error && <p className="m-0 mt-1 text-amber-800 dark:text-amber-300">{data.processing.error}</p>}
            {recordingOther && <p className="m-0 mt-1 text-axal-muted dark:text-gray-400">You are recording another session. Its processing view opens here once you stop that one.</p>}
          </section>
        )}
        {session.status === 'transcribing' && <p className="text-[13px] text-axal-faint" data-testid="session-transcribing">Transcribing…</p>}
        {data.processing?.stage === 'done' && data.processing.error && <p role="status" className="text-[13px] font-semibold text-amber-800 dark:text-amber-300" data-testid="processing-note">{data.processing.error}</p>}
        {['stopped', 'transcribed', 'structured', 'reviewed'].includes(session.status) && (
          <section className="space-y-3">
            <h2 className="text-[16px] font-bold">Transcript</h2>
            {session.status === 'stopped' && AUDIO.has(session.channel) && (
              <button type="button" onClick={async () => { try { await api.transcribe(session.id, session.final_model); } catch (e) { setError(e?.message); } load(); loadReceipt(); }} className="rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white">Transcribe</button>
            )}
            {/* D668: a session an assistant submitted opens on the review step, above its transcript. */}
            {reviewFirst && review}
            <TranscriptReview segments={segments} intervieweeName={intervieweeName} onAssign={assign} />
            {!reviewFirst && review}
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
