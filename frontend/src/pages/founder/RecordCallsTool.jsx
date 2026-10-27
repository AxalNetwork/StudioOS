import React, { useCallback, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Lightbox } from '../../ui';
import { api as appApi } from '../../lib/api';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import { channelsApi } from '../../lib/api/channels.js';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { ATTESTATION_SENTENCE, UploadError, decodeFile, uploadRecording } from '../../lib/recordingUpload.js';
import { useVentureInterviews } from './ChannelsInbox';
import {
  BTN, BTN_GHOST, BTN_SEC, CARD, ChannelProposals, ConfirmDialog, ErrorBoard, H3, LoadingBoard, MUTED, NoPermissionBoard, Pill, useRead,
} from './ChannelSessionParts.jsx';
import { TX_VIEWS } from './channelSessionModel.js';
import {
  CONSENT_CHOICES, MC_TABS, PROVIDER_NAME, RETENTION_CHOICES, audioLine, callConsent, callProposalGroups, callRows, callTimeline, callTurns,
  chunkBar, durationOf, mcHref, mcRoute, noneConnected, renameCheck, retentionWord, setupCards, sourceBadge, speakersOf, summaryLines,
  tokenEstimate, upcomingRows, when,
} from './callsModel.js';

/**
 * D878 (#2525) — Record a session › Calls, the boards MC1–MC7 at
 * `/validate/record/calls` (`design/incoming/Record a session · Calls
 * Boards.dc.html`), with the WhatsApp and Telegram boards' parts (D862,
 * D869): the loading, error and no-permission boards, the transcript's
 * Original · Translation · Both, the proposals list and its dialogs.
 *
 *   Upcoming    MC2  calls in the next 14 days; Attach to interview
 *   Calls       MC3  each call's status and source; MC5 its transcript
 *   Upload      MC4  a recording, after the attestation, in resumable parts
 *   Proposals   MC6  summary, decisions, action items and data points
 *   Connection  MC1  Google Meet and Zoom, step by step
 *   Retention   MC7  how long call audio is kept; delete one call's audio
 *
 * Authorized audio only: an upload starts after the founder says how
 * everyone recorded agreed, and a call is attached with the same answer.
 * The call's own transcript comes first (Meet's, Zoom's); Axal transcribes
 * the audio only when there is none. Eadwyn proposes, the founder accepts:
 * nothing reaches Validate before Accept. The notetaker that joins a call
 * live waits on #2581, #2582 and #2587, and is drawn as not yet available.
 */

const SESSION_PAGE = (id) => `/validate/session/${Number(id)}`;
const RECORD = '/validate/record';
const LINK = 'font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300';

export const DEFAULT_CALLS_API = {
  channels: channelsApi, sessions: interviewSessionsApi, app: appApi,
  upload: { decode: decodeFile, run: uploadRecording },
  assign: (url) => window.location.assign(url),
};

function SubTabs({ active }) {
  return (
    <nav aria-label="Calls" className="flex gap-5 overflow-x-auto border-b border-gray-200 dark:border-gray-700" data-testid="mc-tabs">
      {MC_TABS.map((t) => (
        <NavLink key={t.key} to={t.to} end={t.key === 'upcoming'} aria-current={active === t.key ? 'page' : undefined} data-testid={`mc-tab-${t.key}`}
          className={`-mb-px inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 text-[13.5px] sm:min-h-[40px] ${active === t.key ? 'border-violet-600 font-bold text-gray-900 dark:border-violet-400 dark:text-gray-100' : 'border-transparent font-semibold text-gray-500 dark:text-gray-400'}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** A board's empty or not-connected state (MC-S), with its one next step. */
function StateBoard({ title, line, to, action, testId }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-gray-300 bg-white p-6 dark:border-gray-600 dark:bg-gray-900" data-testid={testId}>
      <h2 className="m-0 text-[16px] font-extrabold text-gray-900 dark:text-gray-100">{title}</h2>
      {line ? <p className="m-0 text-[13px] text-gray-600 dark:text-gray-400">{line}</p> : null}
      {to ? <Link to={to} className={BTN} data-testid={`${testId}-go`}>{action}</Link> : null}
    </div>
  );
}

function ProviderPill({ provider }) {
  return <Pill tone="out">{PROVIDER_NAME[provider] || provider}</Pill>;
}

/** The pill a ref or upload's status reads as. */
function StatusPill({ status }) {
  return <Pill tone={status[1]}>{status[0]}</Pill>;
}

/* ------------------------------------------------------------------ *
 * MC2: Upcoming
 * ------------------------------------------------------------------ */

function AttachDialog({ row, interviews, onAttach, onClose }) {
  const [interviewId, setInterviewId] = useState('');
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    if (!interviewId) { setErr('Choose the interview this call belongs to.'); return; }
    if (!method) { setErr('Say how the interviewee agreed to be recorded and transcribed.'); return; }
    setBusy(true); setErr('');
    try { await onAttach(Number(interviewId), method); onClose(); } catch (e) { setErr(e?.data?.message || e?.message || 'The call could not be attached. Nothing changed.'); setBusy(false); }
  };
  return (
    <Lightbox label="Attach to interview" title="Attach to interview" onClose={onClose} width={480} phone="sheet" testId="mc-attach-dialog"
      sub={`${row.title} · ${row.day}, ${row.span}. After the call, Axal imports Google Meet’s transcript into this interview. Nothing is imported until the call has ended.`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_SEC} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN} onClick={go} disabled={busy} data-testid="mc-attach-dialog-confirm">{busy ? 'Working…' : 'Attach'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mc-attach-error">{err}</p> : null}
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Interview
          <select value={interviewId} onChange={(e) => setInterviewId(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[13px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[36px]" data-testid="mc-attach-interview">
            <option value="">Choose an interview</option>
            {interviews.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </label>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">How the interviewee agreed to be recorded</legend>
          {CONSENT_CHOICES.map((c) => (
            <label key={c.method} className="flex min-h-[44px] items-center gap-2 text-[13px] text-gray-800 dark:text-gray-200 sm:min-h-[32px]">
              <input type="radio" name="mc-attach-consent" value={c.method} checked={method === c.method} onChange={() => setMethod(c.method)} data-testid={`mc-attach-consent-${c.method}`} />{c.label}
            </label>
          ))}
        </fieldset>
      </div>
    </Lightbox>
  );
}

function UpcomingTab({ api, venture, setup }) {
  const projectId = venture.project?.id || null;
  const upcoming = useRead(() => api.channels.upcomingCalls(), [api]);
  const calls = useRead(() => (projectId ? api.channels.calls(projectId) : { calls: [] }), [api, projectId]);
  const [attach, setAttach] = useState(null);
  if (upcoming.status === 'loading' || calls.status === 'loading') return <LoadingBoard testId="mc-upcoming-loading" />;
  if (upcoming.status === 'forbidden') return <NoPermissionBoard label="call" />;
  if (upcoming.error?.status === 409) {
    return <StateBoard title="Google no longer accepts Axal’s sign-in." line={upcoming.error?.data?.message || 'Reconnect Google to read your upcoming calls.'} to={mcHref('connection')} action="Open Connection" testId="mc-upcoming-reconnect" />;
  }
  if (upcoming.status !== 'ready') return <ErrorBoard what="Your upcoming calls" onRetry={upcoming.reload} testId="mc-upcoming-error" />;
  if (!upcoming.data?.connected && setup.status === 'ready' && noneConnected(setup.data)) {
    return <StateBoard title="Connect your calendar to see upcoming calls." line="Axal lists the Google Meet and Zoom calls on your Google Calendar for the next 14 days. Uploading a recording works without it." to={mcHref('connection')} action="Connect" testId="mc-upcoming-nc" />;
  }
  const rows = upcomingRows({ upcoming: upcoming.data, calls: calls.status === 'ready' ? calls.data?.calls : [] });
  return (
    <section className="flex flex-col gap-3" data-testid="mc-upcoming">
      <p className={MUTED}>Calls on your Google Calendar in the next 14 days with a Meet or Zoom link. Attached calls show their interview.</p>
      {calls.status !== 'ready' && calls.status !== 'loading' ? (
        <p className={`${MUTED} text-amber-800 dark:text-amber-300`} data-testid="mc-upcoming-calls-unread">The calls already on an interview could not be read; only the calendar’s are listed. <button type="button" className={LINK} onClick={calls.reload}>Try again</button></p>
      ) : null}
      {!rows.length ? <StateBoard title="No calls in the next 14 days." testId="mc-upcoming-empty" /> : (
        <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid="mc-upcoming-list">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid={`mc-upcoming-${r.key}`}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{r.title}</span>
                <span className={MUTED}>{r.day} · {r.span}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ProviderPill provider={r.provider} />
                {r.attached ? <Link to={mcHref('calls', r.attached.sessionId)} className={BTN_GHOST} data-testid={`mc-upcoming-open-${r.key}`}>On its interview</Link> : null}
                {r.attach ? <button type="button" className={BTN_SEC} onClick={() => setAttach(r)} data-testid={`mc-upcoming-attach-${r.key}`}>Attach to interview</button> : null}
                {r.zoomLater ? <span className={`${MUTED} max-w-[18rem]`} data-testid={`mc-upcoming-zoom-${r.key}`}>A Zoom call is attached when it starts: open <Link to={RECORD} className={LINK}>Record a session</Link> on its interview and paste the link.</span> : null}
                {r.blocked ? <span className={`${MUTED} max-w-[18rem]`} data-testid={`mc-upcoming-blocked-${r.key}`}>{r.blocked}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {attach ? (
        <AttachDialog row={attach} interviews={venture.interviews || []} onClose={() => setAttach(null)}
          onAttach={(interviewId, method) => api.channels.attachCalendarMeet(interviewId, { join_url: attach.attach.join_url, consent: { status: 'given', method } })
            .then(() => { upcoming.reload(); calls.reload(); })} />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * MC3 and MC5: Calls
 * ------------------------------------------------------------------ */

const MARK = {
  done: 'bg-emerald-700 text-white',
  now: 'border-[1.5px] border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  todo: 'border-[1.5px] border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400',
  stop: 'bg-red-700 text-white',
  failed: 'bg-red-700 text-white',
  blocked: 'border-[1.5px] border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500',
};
const MARK_TEXT = { done: '✓', now: '…', todo: '', stop: '!', failed: '!', blocked: '' };

function Timeline({ steps }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="mc-timeline">
      {steps.map((s, i) => (
        <li key={`${s.t}-${i}`} className="flex gap-3" data-testid={`mc-step-${i}`} data-state={s.state}>
          <span aria-hidden="true" className={`grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-bold ${MARK[s.state] || MARK.todo}`}>{MARK_TEXT[s.state]}</span>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{s.t}{s.at ? <span className="font-normal text-gray-500 dark:text-gray-400"> · {s.at}</span> : null}</span>
            {s.line ? <span className={MUTED}>{s.line}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CallList({ read, connected }) {
  const rows = callRows(read.data);
  if (!rows.length) {
    return connected === false
      ? <StateBoard title="Connect Google or Zoom to follow calls." line="Uploaded recordings appear here too, and get transcripts without a connection." to={mcHref('connection')} action="Connect" testId="mc-calls-nc" />
      : <StateBoard title="No call yet." line="Attach an upcoming call to an interview, or upload a recording." to={mcHref('upload')} action="Upload a recording" testId="mc-calls-empty" />;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid="mc-calls-list">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={mcHref('calls', r.id)} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800" data-testid={`mc-call-${r.id}`}>
              <span className="flex flex-col"><span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{r.title}</span><span className={MUTED}>{r.provider} · {r.at}</span></span>
              <span className="flex flex-wrap items-center gap-1.5"><StatusPill status={r.status} /><Pill tone={r.badge.tone}>{r.badge.t}</Pill>{r.pending ? <Pill tone="lav">{r.pending} to accept</Pill> : null}</span>
            </Link>
          </li>
        ))}
      </ul>
      {read.data?.truncated ? <p className={MUTED} data-testid="mc-calls-truncated">The newest 100 calls are listed. Older ones are on each interview.</p> : null}
    </div>
  );
}

function RenameDialog({ label, onRename, onClose }) {
  const [name, setName] = useState(/^(Speaker \S+|Unknown Speaker)$/i.test(label) ? '' : label);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    const check = renameCheck(label, name);
    if (check.error) { setErr(check.error); return; }
    setBusy(true); setErr('');
    try { await onRename(check.name); onClose(); } catch (e) { setErr(e?.data?.message || 'The name could not be saved. Nothing changed. Try again.'); setBusy(false); }
  };
  return (
    <Lightbox label="Rename speaker" title={`Rename ${label}`} onClose={onClose} width={440} phone="sheet" testId="mc-rename-dialog"
      sub={`Every line of ${label} in this call takes the new name. Proposals already made keep the quote they cite.`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_SEC} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN} onClick={go} disabled={busy} data-testid="mc-rename-dialog-confirm">{busy ? 'Working…' : 'Rename'}</button>
        </div>
      )}>
      {err ? <p role="alert" className="m-0 mb-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mc-rename-error">{err}</p> : null}
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Name
        <input type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[13px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[36px]" data-testid="mc-rename-input" />
      </label>
    </Lightbox>
  );
}

/** MC5: speakers by name or "Speaker n", each turn's time jumping to its audio, and the language switch. */
function CallTranscript({ id, read, api }) {
  const [view, setView] = useState('both');
  const [renaming, setRenaming] = useState(null);
  const [audio, setAudio] = useState({ state: 'idle' });
  const player = useRef(null);
  const segments = read.data?.segments || [];
  const turns = callTurns(segments, view);
  const speakers = speakersOf(segments);
  const consent = callConsent(read.data?.session);
  const jump = useCallback(async (ms) => {
    setAudio({ state: 'loading' });
    try {
      const parts = (await api.sessions.audio(id))?.parts || [];
      const part = [...parts].filter((p) => Number(p.start_ms) <= ms).sort((a, b) => Number(b.start_ms) - Number(a.start_ms))[0] || parts[0];
      if (!part) { setAudio({ state: 'none' }); return; }
      setAudio({ state: 'ready', url: part.url, at: Math.max(0, (ms - Number(part.start_ms || 0)) / 1000) });
    } catch (e) {
      setAudio({ state: e?.status === 404 ? 'removed' : 'error', message: e?.data?.message || null });
    }
  }, [api, id]);
  const onLoaded = () => {
    const el = player.current;
    if (!el || audio.state !== 'ready') return;
    try { el.currentTime = audio.at; const p = el.play?.(); if (p && p.catch) p.catch(() => {}); } catch { /* the reader presses play */ }
  };
  return (
    <section className="flex flex-col gap-3" data-testid="mc-transcript">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>Transcript</h3>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
          {TX_VIEWS.map((v) => (
            <button key={v.key} type="button" role="radio" aria-checked={view === v.key ? 'true' : 'false'} onClick={() => setView(v.key)} data-testid={`mc-view-${v.key}`}
              className={`min-h-[44px] rounded-md px-3 text-[12px] font-semibold sm:min-h-[30px] ${view === v.key ? 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'text-gray-700 dark:text-gray-300'}`}>{v.t}</button>
          ))}
        </div>
      </div>
      <p className={`m-0 rounded-xl p-3 text-[13px] font-semibold ${consent.tone === 'pos' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/30 dark:text-amber-300'}`} data-testid="mc-consent">{consent.t}</p>
      {speakers.length ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="mc-speakers">
          <span className={MUTED}>Speakers</span>
          {speakers.map((s) => (
            <button key={s.label} type="button" className={BTN_SEC} onClick={() => setRenaming(s.label)} data-testid={`mc-rename-${s.label}`} aria-label={`Rename speaker ${s.label}`}>
              {s.label} <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{s.turns}</span>{s.unnamed ? <span className="text-violet-700 dark:text-violet-300">· Rename</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {audio.state === 'ready' ? <audio ref={player} controls src={audio.url} onLoadedMetadata={onLoaded} className="w-full" data-testid="mc-audio" /> : null}
      {audio.state === 'removed' ? <p className={MUTED} data-testid="mc-audio-removed">{audio.message || 'This call’s audio was deleted. Its text is kept.'}</p> : null}
      {audio.state === 'none' ? <p className={MUTED} data-testid="mc-audio-none">This call has no audio held: its text came from the call’s own transcript.</p> : null}
      {audio.state === 'error' ? <p className={MUTED} data-testid="mc-audio-error">The audio could not be opened. <button type="button" className={LINK} onClick={() => setAudio({ state: 'idle' })}>Try again</button></p> : null}
      {!turns.length ? <StateBoard title="No transcript yet." line="It appears here once the call’s transcript is in." testId="mc-transcript-none" /> : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {turns.map((t) => (
            <li key={t.id} className={`${CARD} flex flex-col gap-1`} data-testid={`mc-turn-${t.id}`}>
              <span className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-gray-700 dark:text-gray-300">
                <span data-testid={`mc-turn-who-${t.id}`}>{t.who}</span>
                {t.at ? <button type="button" className="min-h-[44px] font-mono text-[12px] text-violet-700 underline dark:text-violet-300 sm:min-h-0" onClick={() => jump(t.startMs)} data-testid={`mc-jump-${t.id}`} aria-label={`Play from ${t.at}`}>{t.at}</button> : null}
              </span>
              {t.showOriginal ? <p className="m-0 text-[13px] text-gray-900 dark:text-gray-100" data-testid={`mc-turn-original-${t.id}`}>{t.original}</p> : null}
              {t.showTranslation ? (
                <p className="m-0 border-t border-gray-100 pt-1.5 text-[13px] text-gray-700 dark:border-gray-800 dark:text-gray-300" data-testid={`mc-turn-translation-${t.id}`}>
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.from}</span>{t.translation}
                </p>
              ) : null}
              {t.pending ? <span className="text-[11.5px] font-semibold text-amber-800 dark:text-amber-300">Translation pending</span> : null}
            </li>
          ))}
        </ol>
      )}
      {renaming ? <RenameDialog label={renaming} onClose={() => setRenaming(null)} onRename={(name) => api.sessions.renameSpeaker(id, renaming, name).then(() => read.reload())} /> : null}
    </section>
  );
}

function DriveRecordings({ api, call, onClose }) {
  const read = useRead(() => api.channels.meetingRecording(call.interview_id, call.meeting.uid), [api, call]);
  return (
    <Lightbox label="The recording in Drive" title="The recording in Drive" onClose={onClose} width={480} phone="sheet" testId="mc-drive-dialog"
      sub="Google saved this call’s recording to Drive but no transcript. Download it from Drive, then upload it here."
      footer={<div className="flex justify-end gap-2"><Link to={mcHref('upload')} className={BTN} onClick={onClose}>Upload it</Link><button type="button" className={BTN_SEC} onClick={onClose}>Close</button></div>}>
      {read.status === 'loading' ? <p className={MUTED}>Reading…</p> : read.status !== 'ready' ? <p className={MUTED}>The recording could not be found. Look in your Drive’s Meet Recordings folder.</p> : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {(read.data?.recordings || []).map((r) => <li key={r.url}><a className={LINK} href={r.url} rel="noreferrer">Recording · {when(r.started_at)}</a></li>)}
        </ul>
      )}
    </Lightbox>
  );
}

function CallDetail({ id, api, calls, models }) {
  const session = useRead(() => api.sessions.get(id), [api, id]);
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState('');
  const call = calls.status === 'ready' ? (calls.data?.calls || []).find((c) => c.session_id === id) : null;
  if (calls.status === 'loading' || session.status === 'loading') return <LoadingBoard testId="mc-call-loading" />;
  if (session.status === 'forbidden' || session.error?.status === 404) return <NoPermissionBoard label="call" testId="mc-call-nop" />;
  if (calls.status !== 'ready') return <ErrorBoard what="Your calls" onRetry={calls.reload} testId="mc-calls-error" />;
  if (session.status !== 'ready') return <ErrorBoard what="This call" onRetry={session.reload} testId="mc-call-error" />;
  if (!call) return <p className={`${CARD} ${MUTED}`} data-testid="mc-call-missing">This session is not one of your venture’s calls. <Link to={SESSION_PAGE(id)} className={LINK}>Open its session page</Link></p>;
  const tl = callTimeline(call);
  const badge = sourceBadge(call);
  const run = async (key) => {
    setNote('');
    if (key === 'import') await api.channels.importMeeting(call.interview_id, call.meeting.uid);
    if (key === 'process') await api.sessions.process(id);
    calls.reload(); session.reload();
    setNote(key === 'import' ? 'Asked again. The status updates as it moves.' : 'Started again.');
  };
  return (
    <div className="flex flex-col gap-4" data-testid="mc-call">
      <section className={`${CARD} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className={H3}>{call.interviewee_name || 'Interviewee not recorded'}{call.interviewee_company ? ` · ${call.interviewee_company}` : ''}</h2>
            <p className={MUTED}>{PROVIDER_NAME[call.source]} · {when(call.meeting?.starts_at || call.session?.created_at)}</p>
          </div>
          <Pill tone={badge.tone} testId="mc-source">{badge.t}</Pill>
        </div>
        <Timeline steps={tl.steps} />
        {tl.next.length ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="mc-next">
            {tl.next.map((n) => {
              if (n.key === 'connection') return <Link key={n.key} to={mcHref('connection')} className={BTN_SEC}>{n.t}</Link>;
              if (n.key === 'upload') return <Link key={n.key} to={`${mcHref('upload')}?interview=${call.interview_id}`} className={BTN_SEC} data-testid="mc-next-upload">{n.t}</Link>;
              if (n.key === 'drive') return <button key={n.key} type="button" className={BTN_GHOST} onClick={() => setAsk({ key: 'drive' })}>{n.t}</button>;
              const est = n.tokens ? tokenEstimate(n.minutes, models.status === 'ready' ? models.data : null) : null;
              return <button key={n.key} type="button" className={BTN} onClick={() => setAsk({ ...n, est })} data-testid={`mc-next-${n.key}`}>{n.t}{est ? ` · ${est}` : ''}</button>;
            })}
          </div>
        ) : null}
        {tl.why ? <p className={MUTED} data-testid="mc-why">{tl.why}{call.meeting?.error_code === 'stt_budget' ? <> <a href={ADD_TOKENS_PATH} className={LINK}>Add tokens</a></> : null}</p> : null}
        {note ? <p role="status" className="m-0 text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="mc-note">{note}</p> : null}
        <div className="flex flex-wrap gap-3 text-[12.5px]">
          <Link to={mcHref('proposals', id)} className={LINK} data-testid="mc-call-proposals">Its proposals{call.pending_proposals ? ` (${call.pending_proposals})` : ''}</Link>
          <Link to={SESSION_PAGE(id)} className={LINK}>The full session page</Link>
        </div>
      </section>
      <CallTranscript id={id} read={session} api={api} />
      {ask?.key === 'import' || ask?.key === 'process' ? (
        <ConfirmDialog title={ask.t} testId="mc-run-dialog" confirm={ask.t} onConfirm={() => run(ask.key)} onClose={() => setAsk(null)}
          sub={ask.tokens
            ? `Axal transcribes this call’s audio with speech-to-text on your AI tokens${ask.est ? `: ${ask.est}` : ''}. The text goes into the interview; nothing is proposed until you ask.`
            : 'Axal asks for this call’s transcript again. Nothing already imported changes.'} />
      ) : null}
      {ask?.key === 'drive' ? <DriveRecordings api={api} call={call} onClose={() => setAsk(null)} /> : null}
    </div>
  );
}

function CallsTab({ id, api, calls, setup, models }) {
  if (id) return <CallDetail id={id} api={api} calls={calls} models={models} />;
  if (calls.status === 'loading') return <LoadingBoard testId="mc-calls-loading" />;
  if (calls.status === 'forbidden') return <NoPermissionBoard label="call" testId="mc-calls-nop" />;
  if (calls.status !== 'ready') return <ErrorBoard what="Your calls" onRetry={calls.reload} testId="mc-calls-error" />;
  return <CallList read={calls} connected={setup.status === 'ready' ? !noneConnected(setup.data) : null} />;
}

/* ------------------------------------------------------------------ *
 * MC4: Upload
 * ------------------------------------------------------------------ */

function UploadTab({ api, venture, models }) {
  const { search } = useLocation();
  const pre = Number(new URLSearchParams(search).get('interview')) || '';
  const [interviewId, setInterviewId] = useState(String(pre || ''));
  const [method, setMethod] = useState('');
  const [file, setFile] = useState(null);
  const [decoded, setDecoded] = useState({ state: 'none' });
  const [progress, setProgress] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [err, setErr] = useState('');
  const projectId = venture.project?.id || null;
  const pick = async (f) => {
    if (!f) return;
    setFile(f); setOutcome(null); setErr(''); setProgress(null);
    setDecoded({ state: 'reading' });
    try { setDecoded({ state: 'ready', ...(await api.upload.decode(f)) }); } catch (e) { setDecoded({ state: 'failed', message: e instanceof UploadError ? e.message : 'This file could not be read as audio.' }); }
  };
  const est = decoded.state === 'ready' ? tokenEstimate(decoded.durationMs / 60000, models.status === 'ready' ? models.data : null) : null;
  const ready = projectId && interviewId && method && decoded.state === 'ready' && !progress?.running;
  const go = async () => {
    setErr('');
    if (!method) { setErr('Say how everyone recorded agreed before uploading.'); return; }
    setProgress({ running: true, done: 0, total: 0 });
    try {
      const r = await api.upload.run({
        file, api: api.sessions, target: { project_id: projectId, interview_id: Number(interviewId) }, attestation: { agreed: true, method },
        decode: async () => ({ samples: decoded.samples, durationMs: decoded.durationMs }),
        onProgress: ({ done, total }) => setProgress({ running: true, done, total }),
      });
      setProgress((p) => ({ ...(p || {}), running: false, done: r.parts, total: r.parts }));
      setOutcome(r);
    } catch (e) {
      setProgress((p) => ({ ...(p || {}), running: false }));
      setErr(`${e instanceof UploadError ? e.message : e?.data?.message || 'The upload stopped.'} Drop the same file again: it carries on from the part it stopped at.`);
    }
  };
  if (!projectId) return <StateBoard title="Uploads go into a venture’s interview." line="Open a venture first." testId="mc-upload-noventure" />;
  const bar = progress?.total ? chunkBar(progress.done, progress.total) : [];
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_300px]" data-testid="mc-upload">
      <div className={`${CARD} flex flex-col gap-3`}>
        <h2 className={H3}>Upload a recording</h2>
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Interview
          <select value={interviewId} onChange={(e) => setInterviewId(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[13px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[36px]" data-testid="mc-upload-interview">
            <option value="">Choose an interview</option>
            {(venture.interviews || []).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </label>
        <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer?.files?.[0]); }}
          className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700" data-testid="mc-upload-drop">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{file ? file.name : 'Drop a recording here, or choose a file'}</span>
          <span className={MUTED}>MP3, M4A, MP4 or WAV, up to 3 hours. It is read on this device and sent in two-minute parts.</span>
          <input type="file" accept="audio/*,video/mp4" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} data-testid="mc-upload-file" />
        </label>
        {decoded.state === 'reading' ? <p className={MUTED} data-testid="mc-upload-reading">Reading the file…</p> : null}
        {decoded.state === 'failed' ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mc-upload-unreadable">{decoded.message}</p> : null}
        {decoded.state === 'ready' ? (
          <p className="m-0 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="mc-upload-estimate">
            {durationOf(decoded.durationMs)} · transcribing it uses {est || 'AI tokens (the price is not recorded here)'}
          </p>
        ) : null}
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="mc-attest">
          <legend className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">{ATTESTATION_SENTENCE} How?</legend>
          {CONSENT_CHOICES.map((c) => (
            <label key={c.method} className="flex min-h-[44px] items-center gap-2 text-[13px] text-gray-800 dark:text-gray-200 sm:min-h-[32px]">
              <input type="radio" name="mc-attest" value={c.method} checked={method === c.method} onChange={() => setMethod(c.method)} data-testid={`mc-attest-${c.method}`} />{c.label}
            </label>
          ))}
          <span className={MUTED}>Upload only audio everyone recorded agreed to. The transcript starts only after this answer.</span>
        </fieldset>
        {bar.length ? (
          <div className="flex flex-col gap-1" data-testid="mc-upload-progress">
            <div className="flex gap-1" aria-hidden="true">{bar.map((s, i) => <span key={i} className={`block h-2.5 flex-1 rounded ${s === 'done' ? 'bg-violet-600' : s === 'now' ? 'border border-amber-500 bg-amber-100 dark:bg-amber-900/40' : 'bg-gray-200 dark:bg-gray-700'}`} />)}</div>
            <span className={MUTED} role="status">{progress.done} of {progress.total} parts stored</span>
          </div>
        ) : null}
        {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mc-upload-error">{err}</p> : null}
        {outcome ? (
          <p role="status" className="m-0 text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="mc-upload-done">
            Uploaded{outcome.skipped ? ` (${outcome.skipped} part${outcome.skipped === 1 ? ' was' : 's were'} already stored)` : ''}. The transcript is on its way. <Link to={mcHref('calls', outcome.sessionId)} className={LINK}>Follow the call</Link>
          </p>
        ) : null}
        <div><button type="button" className={BTN} disabled={!ready} onClick={go} data-testid="mc-upload-go">{progress?.running ? 'Uploading…' : 'Upload and transcribe'}</button></div>
      </div>
      <aside className={`${CARD} flex flex-col gap-2`}>
        <h3 className={H3}>Resumable</h3>
        <p className={MUTED}>If the upload stops, drop the same file again. It carries on from the part it stopped at; a part already stored is never sent twice.</p>
        <h3 className={H3}>No connection needed</h3>
        <p className={MUTED}>Uploading works without Google or Zoom: any call’s recording, from any tool.</p>
      </aside>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * MC6: Proposals
 * ------------------------------------------------------------------ */

function ProposalsTab({ id, api, calls }) {
  const session = useRead(() => (id ? api.sessions.get(id) : null), [api, id]);
  const read = useRead(() => (id ? api.sessions.placements(id) : null), [api, id]);
  const [note, setNote] = useState('');
  const [keep, setKeep] = useState(false);
  if (!id) {
    if (calls.status === 'loading') return <LoadingBoard testId="mc-proposals-loading" />;
    if (calls.status !== 'ready') return <ErrorBoard what="Your calls" onRetry={calls.reload} testId="mc-proposals-error" />;
    const rows = callRows(calls.data).filter((r) => r.pending);
    if (!rows.length) return <StateBoard title="Nothing to accept yet." line="Proposals come from any call’s transcript, connected or uploaded, once Eadwyn has read it." testId="mc-proposals-none" />;
    return (
      <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid="mc-proposals-list">
        {rows.map((r) => (
          <li key={r.id}><Link to={mcHref('proposals', r.id)} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] hover:bg-gray-50 dark:hover:bg-gray-800" data-testid={`mc-proposals-pick-${r.id}`}>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{r.title}</span><span className={MUTED}>{r.pending} waiting</span>
          </Link></li>
        ))}
      </ul>
    );
  }
  if (read.status === 'loading' || session.status === 'loading') return <LoadingBoard testId="mc-proposals-loading" />;
  if (read.status === 'forbidden' || session.status === 'forbidden') return <NoPermissionBoard label="call" testId="mc-proposals-nop" />;
  if (read.status !== 'ready') return <ErrorBoard what="This call’s proposals" onRetry={read.reload} testId="mc-proposals-error" />;
  const after = (r) => { read.reload(); return r; };
  const digest = session.status === 'ready' ? session.data?.digest : null;
  const lines = summaryLines(digest);
  return (
    <div className="flex flex-col gap-3" data-testid="mc-proposals">
      <section className={`${CARD} flex flex-col gap-2`} data-testid="mc-summary">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={H3}>Summary</h3>
          {digest?.kept ? <Pill tone="pos" testId="mc-summary-kept">Kept</Pill> : null}
        </div>
        {session.status !== 'ready' ? <p className={MUTED}>The summary could not be read. <button type="button" className={LINK} onClick={session.reload}>Try again</button></p>
          : !lines.length ? <p className={MUTED} data-testid="mc-summary-none">No summary yet. It is written from the call’s transcript when you ask for it on the session page.</p>
            : <ul className="m-0 flex flex-col gap-1 pl-4 text-[13px] text-gray-900 dark:text-gray-100">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        {lines.length ? (
          <div className="flex flex-wrap gap-1.5">
            {!digest?.kept ? <button type="button" className={BTN_SEC} onClick={() => setKeep(true)} data-testid="mc-summary-keep">Accept</button> : null}
            <Link to={SESSION_PAGE(id)} className={BTN_GHOST}>Edit</Link>
          </div>
        ) : null}
      </section>
      {note ? <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="mc-proposals-note">{note}</p> : null}
      <ChannelProposals
        groups={callProposalGroups(read.data)}
        editHref={SESSION_PAGE(id)}
        line="Eadwyn read the call and proposed these. Nothing lands in Validate until you accept it."
        onAccept={(pid) => api.sessions.accept(pid).then(after).then(() => setNote('Accepted. It is in Validate now.'))}
        onDiscard={(pid) => api.sessions.discard(pid).then(after).then(() => setNote('Dismissed.'))}
        onAcceptAll={(ids) => api.sessions.acceptAll(id, ids).then(after).then((r) => setNote(`${Number(r?.accepted) || 0} accepted.${Number(r?.remaining) ? ` ${Number(r.remaining)} still wait.` : ''}`))}
      />
      {keep ? <ConfirmDialog title="Accept the summary" sub="The summary is kept as it stands, under your name. You can still edit it on the session page." confirm="Accept" testId="mc-summary-dialog"
        onConfirm={() => api.sessions.keepDigest(id).then(() => { session.reload(); setNote('The summary is kept.'); })} onClose={() => setKeep(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * MC1: Connection
 * ------------------------------------------------------------------ */

const PRESS = {
  google_connect: { t: 'Connect Google', sub: 'You go to Google to sign in, then come back here. Axal reads your calendar’s calls and, once you allow it, their Meet transcripts.' },
  google_reconnect: { t: 'Reconnect', sub: 'You go to Google to sign in again, then come back here. Nothing already imported changes.' },
  meet_allow: { t: 'Allow transcript import', sub: 'You go to Google to allow Axal to read the transcripts of the Meet calls you organize, then come back here.' },
};

function ConnectionTab({ api, setup, google }) {
  const [ask, setAsk] = useState(null);
  if (setup.status === 'loading') return <LoadingBoard testId="mc-connect-loading" />;
  if (setup.status === 'forbidden') return <NoPermissionBoard label="call" />;
  if (setup.status !== 'ready') return <ErrorBoard what="Your Zoom and Google setup" onRetry={setup.reload} testId="mc-connect-error" />;
  const cards = setupCards(setup.data, google.status === 'ready' ? google.data : null);
  const press = async (kind) => {
    if (kind === 'meet_allow') { await api.channels.allowMeetTranscripts('record', api.assign); return; }
    const r = await api.app.googleCalConnect({ return_to: 'record' });
    const url = r?.redirect_url || r?.auth_url;
    if (typeof url !== 'string' || !/^https:\/\/accounts\.google\.com\//.test(url)) throw new Error('Google did not answer with its sign-in page. Try again in a moment.');
    api.assign(url);
  };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_300px]" data-testid="mc-connect">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className={H3}>Connect calls</h2>
            <p className={MUTED}>Axal reads the transcript each tool saves after a call. Uploading a recording works without either.</p>
          </div>
          <button type="button" className={BTN_SEC} onClick={() => { setup.reload(); google.reload(); }} data-testid="mc-check-again">Check again</button>
        </div>
        {cards.map((c) => (
          <div key={c.provider} className={`${CARD} flex flex-col gap-3`} data-testid={`mc-card-${c.provider}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2"><h3 className={H3}>{c.name}</h3>{c.pills.map(([t, tone]) => <Pill key={t} tone={tone} testId={`mc-pill-${c.provider}`}>{t}</Pill>)}</span>
              <span className="flex flex-wrap gap-2">
                {c.press === 'zoom_connect' ? <Link to={c.page} className={BTN} data-testid="mc-press-zoom">Connect Zoom</Link> : null}
                {c.press && c.press !== 'zoom_connect' ? <button type="button" className={BTN} onClick={() => setAsk(c.press)} data-testid={`mc-press-${c.press}`}>{PRESS[c.press].t}</button> : null}
                <Link to={c.page} className={BTN_GHOST}>Its connector page</Link>
              </span>
            </div>
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {c.steps.map((s) => (
                <li key={s.key} className="flex gap-3" data-testid={`mc-setup-${c.provider}-${s.key}`} data-state={s.state}>
                  <span aria-hidden="true" className={`grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-bold ${MARK[s.state] || MARK.todo}`}>{s.state === 'done' ? '✓' : s.state === 'failed' ? '!' : s.n}</span>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{s.label} <span className="font-normal text-gray-500 dark:text-gray-400">· {s.state === 'done' ? 'Done' : s.state === 'todo' ? 'To do' : s.state === 'failed' ? 'Failed' : 'Waiting'}</span></span>
                    {s.line ? <span className={MUTED}>{s.line}</span> : null}
                  </div>
                </li>
              ))}
            </ol>
            {c.prerequisite ? <p className={`${MUTED} flex flex-wrap items-center gap-2`} data-testid={`mc-prereq-${c.provider}`}><span>{c.prerequisite}</span><Pill tone="out">Not checked by Axal</Pill></p> : null}
          </div>
        ))}
      </div>
      <aside className="flex flex-col gap-3">
        <div className={`${CARD} flex flex-col gap-1`}>
          <h3 className={H3}>Upload instead</h3>
          <p className={MUTED}>Any call’s recording file becomes a transcript here, with no connection.</p>
          <Link to={mcHref('upload')} className={LINK}>Upload a recording</Link>
        </div>
        <div className={`${CARD} flex flex-col gap-1`} data-testid="mc-bot-later">
          <span className="flex flex-wrap items-center gap-2"><h3 className={H3}>Eadwyn joins the call</h3><Pill tone="mut">Not available yet</Pill></span>
          <p className={MUTED}>A notetaker that joins your Zoom or Meet call and records it is being built. Until it is, the call’s own transcript, or its uploaded recording, is what Axal reads.</p>
        </div>
      </aside>
      {ask ? <ConfirmDialog title={PRESS[ask].t} sub={PRESS[ask].sub} confirm="Continue to Google" testId="mc-press-dialog" onConfirm={() => press(ask)} onClose={() => setAsk(null)} /> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * MC7: Retention
 * ------------------------------------------------------------------ */

function RetentionTab({ api, calls }) {
  const setting = useRead(() => api.sessions.audioRetention(), [api]);
  const [choice, setChoice] = useState(undefined);
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState('');
  if (setting.status === 'loading') return <LoadingBoard testId="mc-retention-loading" />;
  if (setting.status === 'forbidden') return <NoPermissionBoard label="call" />;
  if (setting.status !== 'ready') return <ErrorBoard what="Your audio retention" onRetry={setting.reload} testId="mc-retention-error" />;
  const current = setting.data?.days === undefined ? undefined : setting.data.days;
  const picked = choice === undefined ? current : choice;
  const choices = RETENTION_CHOICES.includes(current) || current === undefined ? RETENTION_CHOICES : [current, ...RETENTION_CHOICES];
  const kept = calls.status === 'ready' ? (calls.data?.calls || []) : [];
  return (
    <section className="grid gap-4 lg:grid-cols-[320px_1fr]" data-testid="mc-retention">
      <div className={`${CARD} flex flex-col gap-2`}>
        <h2 className={H3}>Keep call audio for</h2>
        <p className={MUTED}>Audio is kept for the days chosen; the text stays until you delete it.{setting.data?.chosen ? '' : ` You have not chosen: ${retentionWord(setting.data?.default_days)} applies.`}</p>
        <div role="radiogroup" aria-label="Keep call audio for" className="flex flex-col gap-1">
          {choices.map((d) => (
            <label key={String(d)} className="flex min-h-[44px] items-center gap-2 text-[13px] text-gray-800 dark:text-gray-200 sm:min-h-[32px]">
              <input type="radio" name="mc-retention" checked={picked === d} onChange={() => setChoice(d)} data-testid={`mc-retention-${d ?? 'keep'}`} />{retentionWord(d)}
            </label>
          ))}
        </div>
        <div><button type="button" className={BTN} disabled={picked === current} onClick={() => setAsk({ kind: 'set', days: picked })} data-testid="mc-retention-save">Save</button></div>
        {note ? <p role="status" className="m-0 text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="mc-retention-note">{note}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        {calls.status === 'loading' ? <LoadingBoard testId="mc-retention-calls-loading" /> : calls.status !== 'ready' ? <ErrorBoard what="Your calls" onRetry={calls.reload} testId="mc-retention-calls-error" />
          : !kept.length ? <StateBoard title="No recordings kept." line="Applies to uploaded recordings too." testId="mc-retention-empty" /> : (
            <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid="mc-retention-list">
              {kept.map((c) => (
                <li key={c.session_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid={`mc-kept-${c.session_id}`}>
                  <span className="flex flex-col">
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{c.interviewee_name || 'Interviewee not recorded'}{c.interviewee_company ? ` · ${c.interviewee_company}` : ''}</span>
                    <span className={MUTED}>{PROVIDER_NAME[c.source]} · {when(c.meeting?.starts_at || c.session?.created_at)} · <span data-testid={`mc-kept-audio-${c.session_id}`}>{audioLine(c.audio)}</span></span>
                  </span>
                  {c.audio?.state === 'held' ? <button type="button" className={BTN_GHOST} onClick={() => setAsk({ kind: 'delete', call: c })} data-testid={`mc-delete-audio-${c.session_id}`}>Delete audio</button> : null}
                </li>
              ))}
            </ul>
          )}
      </div>
      {ask?.kind === 'set' ? (
        <ConfirmDialog title={`Keep call audio for ${retentionWord(ask.days).toLowerCase()}`} confirm="Save" testId="mc-retention-dialog"
          sub={ask.days === null ? 'Call audio is kept until you delete it. Transcripts are unchanged.' : `Call audio older than ${retentionWord(ask.days).toLowerCase()} is deleted in the next daily run, uploads included. Transcripts stay.`}
          onConfirm={() => api.sessions.setAudioRetention(ask.days).then(() => { setChoice(undefined); setting.reload(); calls.reload(); setNote('Saved.'); })} onClose={() => setAsk(null)} />
      ) : null}
      {ask?.kind === 'delete' ? (
        <ConfirmDialog title="Delete this call’s audio" tone="neg" confirm="Delete audio" testId="mc-delete-dialog"
          sub={`The audio of the call with ${ask.call.interviewee_name || 'this interviewee'} is deleted for good. Its transcript and anything accepted from it stay. Jumping to the audio stops working.`}
          onConfirm={() => api.sessions.removeAudio(ask.call.session_id).then(() => { calls.reload(); setNote('The audio was deleted. The text is kept.'); })} onClose={() => setAsk(null)} />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The tool
 * ------------------------------------------------------------------ */

export default function RecordCallsTool({ api = DEFAULT_CALLS_API }) {
  const { pathname } = useLocation();
  const route = mcRoute(pathname) || { tab: 'upcoming', id: null };
  const venture = useVentureInterviews(api.app);
  const projectId = venture.project?.id || null;
  const setup = useRead(() => api.channels.meetingSetup(), [api]);
  const google = useRead(() => api.channels.googleStatus(), [api]);
  const models = useRead(() => api.sessions.models(), [api]);
  const calls = useRead(() => (venture.status === 'loading' ? new Promise(() => {}) : projectId ? api.channels.calls(projectId) : { calls: [], truncated: false }), [api, projectId, venture.status]);
  let body;
  if (route.tab === 'connection') body = <ConnectionTab api={api} setup={setup} google={google} />;
  else if (venture.status === 'loading') body = <LoadingBoard testId="mc-loading" />;
  else if (venture.status !== 'ready') body = <ErrorBoard what="Your venture" onRetry={venture.reload} testId="mc-error" />;
  else if (route.tab === 'upcoming') body = <UpcomingTab api={api} venture={venture} setup={setup} />;
  else if (route.tab === 'calls') body = <CallsTab id={route.id} api={api} calls={calls} setup={setup} models={models} />;
  else if (route.tab === 'upload') body = <UploadTab api={api} venture={venture} models={models} />;
  else if (route.tab === 'proposals') body = <ProposalsTab id={route.id} api={api} calls={calls} />;
  else body = <RetentionTab api={api} calls={calls} />;
  return (
    <div className="flex flex-col gap-4" data-testid="mc-tool">
      <SubTabs active={route.tab} />
      <h2 className={`${H3} sr-only`}>{MC_TABS.find((t) => t.key === route.tab)?.label}</h2>
      {body}
    </div>
  );
}
