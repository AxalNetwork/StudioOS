import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Lightbox } from '../../ui';
import { api as appApi } from '../../lib/api';
import { channelsApi, allowMeetTranscripts, MEMBER_CONSENT_METHODS } from '../../lib/api/channels.js';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { ATTESTATIONS, ATTESTATION_SENTENCE, UploadError, uploadRecording } from '../../lib/recordingUpload.js';
import { useVentureInterviews } from './ChannelsInbox';
import { SubTabs } from './RecordChatTool.jsx';
import {
  BTN, BTN_GHOST, BTN_SEC, CARD, ChannelProposals, ConfirmDialog, ErrorBoard, H3, LoadingBoard, MUTED, NoPermissionBoard, Pill, useRead,
} from './ChannelSessionParts.jsx';
import { TX_VIEWS } from './channelSessionModel.js';
import {
  MC_TABS, NOT_RECORDED, RETENTION_CHOICES, UPLOAD_TYPES, audioAt, callConsent, callProposalGroups, callSummary, callTimeline, callTurns,
  chunkCells, mcHref, mcRoute, renameTargets, retentionChoice, retentionRows, setupCards, speakerName, uploadEstimate, uploadRow, upcomingRows,
} from './callsModel.js';

/**
 * D878 (#2525) — Record a session › Calls, the boards MC1–MC7 at
 * `/validate/record/calls` (`design/incoming/Record a session · Calls
 * Boards.dc.html`), in the canvas's six tabs:
 *
 *   Upcoming    MC2  the next 14 days from the founder's calendar (D875); a Meet call is attached here (D871)
 *   Calls       MC3  each call's status timeline and each upload; with a session, MC5 its transcript
 *   Upload      MC4  a recording, the attestation first, resumable (D872)
 *   Proposals   MC6  summary, decisions, action items and data points (D873), each accepted by the founder
 *   Connection  MC1  Zoom's and Google Meet's steps (D875)
 *   Retention   MC7  how long call audio is kept, and deleting audio or a session (D877)
 *
 * The parts are WhatsApp's (D862): the four states, the dialogs and the
 * proposals list. Every change opens a dialog that says what it changes.
 * The meeting bot's live join (#2581, #2582) is not on this page: it is not
 * deployed yet.
 */

const TOOL = { label: 'Calls', prefix: 'mc', tabs: MC_TABS };
const LINK = 'font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300';
const SESSION_PAGE = (id) => `/validate/session/${Number(id)}`;
const CONSENT_WORDS = { verbal: 'Out loud, at the start', written: 'In writing', pre_agreed: 'Agreed beforehand' };

export const DEFAULT_CALLS_API = { channels: channelsApi, sessions: interviewSessionsApi, app: appApi, allowMeetTranscripts, uploadRecording };

/** MC-S: one board's empty line, in the canvas's words. */
function Empty({ t, action, testId }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-gray-300 bg-white p-6 dark:border-gray-600 dark:bg-gray-900" data-testid={testId}>
      <p className="m-0 text-[14px] font-semibold text-gray-900 dark:text-gray-100">{t}</p>
      {action || null}
    </div>
  );
}

/** MC-S: not connected. Upload works without a connection, so the board says so. */
function NotConnected({ line, testId = 'mc-not-connected' }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900" data-testid={testId}>
      <Pill tone="mut">Not connected</Pill>
      <p className="m-0 text-[14px] font-semibold text-gray-900 dark:text-gray-100">{line}</p>
      <div className="flex flex-wrap gap-2">
        <Link to={mcHref('connection')} className={BTN} data-testid={`${testId}-connect`}>Connect</Link>
        <Link to={mcHref('upload')} className={BTN_SEC}>Upload a recording</Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * MC1: Connect calls
 * ------------------------------------------------------------------ */

const MARK = {
  done: 'bg-emerald-700 text-white',
  todo: 'border-[1.5px] border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400',
  blocked: 'border-[1.5px] border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500',
};

function ConnectionTab({ api }) {
  const read = useRead(() => api.channels.meetingSetup(), [api]);
  const [err, setErr] = useState('');
  if (read.status === 'loading') return <LoadingBoard testId="mc-connect-loading" />;
  if (read.status === 'forbidden') return <NoPermissionBoard label="Calls" testId="mc-nop" />;
  if (read.status !== 'ready') return <ErrorBoard what="Your call setup" onRetry={read.reload} testId="mc-connect-error" />;
  const cards = setupCards(read.data);
  if (!cards.length) return <Empty t="Neither Google nor Zoom is connected." testId="mc-connect-empty" action={<Link to="/account/connectors" className={BTN}>Connect</Link>} />;
  const allow = () => { setErr(''); Promise.resolve(api.allowMeetTranscripts('record')).catch((e) => setErr(e?.message || 'Google could not be reached. Try again.')); };
  return (
    <section className="flex flex-col gap-3" data-testid="mc-connect">
      <p className={MUTED}>Axal reads the transcript each tool saves after a call. Uploading a recording works without either.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {cards.map((c) => (
          <div key={c.key} className={`${CARD} flex flex-col gap-3 p-0`} data-testid={`mc-connect-${c.key}`}>
            <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
              <span className="flex flex-wrap items-center gap-2"><h2 className={H3}>{c.name}</h2><Pill tone={c.pill.tone} testId={`mc-connect-pill-${c.key}`}>{c.pill.t}</Pill></span>
              {c.press?.kind === 'link' ? <Link to={c.press.to} className={BTN} data-testid={`mc-connect-press-${c.key}`}>{c.press.t}</Link> : null}
              {c.press?.kind === 'allow' ? <button type="button" className={BTN} onClick={allow} data-testid={`mc-connect-press-${c.key}`}>{c.press.t}</button> : null}
            </div>
            <ol className="m-0 list-none p-0">
              {c.steps.map((s) => (
                <li key={s.key} className="flex items-start gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-800" data-testid={`mc-step-${c.key}-${s.key}`}>
                  <span className={`grid h-7 w-7 flex-none place-items-center rounded-full text-[12px] font-extrabold ${MARK[s.state]}`}>{s.state === 'done' ? '✓' : s.n}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100">{s.t}<Pill tone={s.state === 'done' ? 'pos' : s.state === 'todo' ? 'amb' : 'mut'}>{s.pill}</Pill></span>
                    {s.action ? <span className={MUTED}>{s.action}</span> : null}
                  </div>
                </li>
              ))}
            </ol>
            {c.prerequisite ? (
              <p className="m-0 border-t border-gray-100 px-4 py-3 text-[12px] text-gray-600 dark:border-gray-800 dark:text-gray-400" data-testid={`mc-prereq-${c.key}`}>
                <span className="font-semibold text-gray-900 dark:text-gray-100">Plan requirement · not checked by Axal. </span>{c.prerequisite}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{err}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * MC2: Upcoming calls
 * ------------------------------------------------------------------ */

/** Attach a Meet call to an interview, with the interviewee's consent as scheduling takes it (D871). */
function AttachDialog({ row, interviews, onAttach, onClose }) {
  const list = interviews.status === 'ready' ? interviews.interviews : [];
  const [id, setId] = useState(list[0] ? String(list[0].id) : '');
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await onAttach(Number(id), method); onClose(); } catch (e) { setErr(e?.message || 'The call could not be attached. Nothing was changed.'); setBusy(false); }
  };
  return (
    <Lightbox label="Attach to interview" title="Attach to interview" sub={`${row.title} · ${row.time}. After the call, Axal imports the transcript Google Meet saves into this interview.`} onClose={onClose} width={520} phone="sheet" testId="mc-attach"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_SEC} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN} onClick={go} disabled={busy || !id || !method} data-testid="mc-attach-confirm">{busy ? 'Attaching…' : 'Attach'}</button>
        </div>
      )}>
      {interviews.status === 'loading' ? <p className={MUTED}>Reading your interviews…</p> : null}
      {interviews.status === 'unreadable' ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">Your interviews could not be read. Try again.</p> : null}
      {interviews.status === 'ready' && !list.length ? <p className={MUTED} data-testid="mc-attach-none">This venture has no interview yet. <Link to="/validate/customer-research" className={LINK}>Add one in Customer research</Link>.</p> : null}
      {list.length ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">Interview
            <select value={id} onChange={(e) => setId(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[13px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" data-testid="mc-attach-select">
              {list.map((i) => <option key={i.id} value={String(i.id)}>{i.label || i.name || `Interview ${i.id}`}</option>)}
            </select>
          </label>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">The person agreed to be recorded and transcribed</legend>
            {MEMBER_CONSENT_METHODS.map((m) => (
              <label key={m} className="flex min-h-[44px] items-center gap-2 text-[13px] text-gray-800 sm:min-h-[32px] dark:text-gray-200">
                <input type="radio" name="mc-attach-consent" value={m} checked={method === m} onChange={() => setMethod(m)} data-testid={`mc-attach-consent-${m}`} />{CONSENT_WORDS[m]}
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}
      {err ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mc-attach-error">{err}</p> : null}
    </Lightbox>
  );
}

function UpcomingTab({ api, venture }) {
  const read = useRead(() => api.channels.upcomingCalls(), [api]);
  const [attach, setAttach] = useState(null);
  const [note, setNote] = useState('');
  if (read.status === 'loading') return <LoadingBoard testId="mc-upcoming-loading" />;
  if (read.status === 'forbidden') return <NoPermissionBoard label="Calls" testId="mc-nop" />;
  // A 409 is the Worker's "connect or reconnect Google" (D875): the sign-in is missing or has expired.
  if (read.error?.status === 409) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-500/40 dark:bg-red-950/30" data-testid="mc-upcoming-reconnect">
        <Pill tone="neg">Sign-in expired</Pill>
        <p className="m-0 text-[14px] font-semibold text-red-900 dark:text-red-200">{read.error?.message || 'Google needs a new sign-in before your calendar can be read.'}</p>
        <Link to="/account/connectors/google" className={BTN}>Reconnect</Link>
      </div>
    );
  }
  if (read.status !== 'ready') return <ErrorBoard what="Your upcoming calls" onRetry={read.reload} testId="mc-upcoming-error" />;
  if (read.data?.connected === false) return <NotConnected line="Connect your calendar to see upcoming calls." testId="mc-upcoming-nc" />;
  const rows = upcomingRows(read.data?.calls);
  return (
    <section className="flex flex-col gap-3" data-testid="mc-upcoming">
      <p className={MUTED}>Calls on your Google Calendar in the next 14 days that carry a Meet or Zoom link and are not attached yet. Attached calls are under Calls.</p>
      {note ? <p role="status" className="m-0 text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="mc-upcoming-note">{note}</p> : null}
      {!rows.length ? <Empty t="No calls in the next 14 days." testId="mc-upcoming-empty" /> : (
        <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid="mc-upcoming-list">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`mc-upcoming-row-${r.provider}`}>
              <span className="flex w-14 flex-none flex-col items-center rounded-lg border border-gray-200 py-1 font-mono text-[10.5px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <span>{r.wd}</span><span className="text-[17px] font-bold text-gray-900 dark:text-gray-100">{r.day}</span><span>{r.mon}</span>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{r.title}</span>
                <span className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12px] text-gray-600 dark:text-gray-400">{r.time}</span><Pill tone="out">{r.word}</Pill></span>
                {r.note ? <span className={MUTED} data-testid="mc-upcoming-row-note">{r.note}</span> : null}
              </div>
              {r.canAttach ? <button type="button" className={BTN_SEC} onClick={() => setAttach(r)} data-testid="mc-upcoming-attach">Attach to interview</button> : null}
            </li>
          ))}
        </ul>
      )}
      {attach ? (
        <AttachDialog row={attach} interviews={venture} onClose={() => setAttach(null)}
          onAttach={(interviewId, method) => api.channels.attachCalendarMeet(interviewId, { join_url: attach.join.join_url, consent: { status: 'given', method } })
            .then(() => { setNote('Attached. The call is under Calls now.'); read.reload(); })} />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * MC3: Calls (each call's status), MC5: one call's transcript
 * ------------------------------------------------------------------ */

const TL_MARK = {
  done: 'bg-emerald-700 text-white',
  stop: 'border-[1.5px] border-red-600 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  todo: 'border-[1.5px] border-gray-300 bg-white text-gray-400 dark:border-gray-600 dark:bg-gray-900',
};

function Timeline({ tl, onRetry }) {
  return (
    <div className={`${CARD} flex flex-col gap-3`} data-testid={`mc-call-${tl.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>{tl.title}</h3>
        {tl.badge ? <Pill tone="out" testId={`mc-call-badge-${tl.id}`}>{tl.badge}</Pill> : null}
      </div>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {tl.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3" data-testid={`mc-call-step-${tl.id}-${s.key}`} data-state={s.state}>
            <span className={`grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[11px] font-extrabold ${TL_MARK[s.state]}`}>{s.state === 'done' ? '✓' : s.state === 'stop' ? '!' : ''}</span>
            <span className="flex flex-col"><span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{s.t}</span>{s.at ? <span className={MUTED}>{s.at}</span> : null}</span>
          </li>
        ))}
      </ol>
      {tl.whisperNote ? <p className={MUTED}>{tl.whisperNote}</p> : null}
      <div className="flex flex-wrap gap-2">
        {tl.open ? <Link to={mcHref('calls', tl.sessionId)} className={BTN_SEC} data-testid={`mc-call-open-${tl.id}`}>Open the transcript</Link> : null}
        {tl.next.map((n) => (n.kind === 'retry'
          ? <button key={n.kind} type="button" className={BTN} onClick={() => onRetry(tl)} data-testid={`mc-call-retry-${tl.id}`}>{n.t}</button>
          : <Link key={n.kind} to={mcHref('upload')} className={BTN_SEC} data-testid={`mc-call-upload-${tl.id}`}>{n.t}</Link>))}
      </div>
    </div>
  );
}

function CallsList({ calls, api }) {
  const [retry, setRetry] = useState(null);
  if (calls.status === 'loading') return <LoadingBoard testId="mc-calls-loading" />;
  if (calls.status === 'forbidden') return <NoPermissionBoard label="Calls" testId="mc-nop" />;
  if (calls.status !== 'ready') return <ErrorBoard what="Your calls" onRetry={calls.reload} testId="mc-calls-error" />;
  const list = (calls.data?.calls || []).map((c) => callTimeline(c));
  const uploads = (calls.data?.uploads || []).map((u) => uploadRow(u));
  if (!list.length && !uploads.length) return <Empty t="No call yet." testId="mc-calls-empty" action={<Link to={mcHref('upload')} className={BTN_SEC}>Upload a recording</Link>} />;
  return (
    <section className="flex flex-col gap-3" data-testid="mc-calls">
      <div className="grid gap-3 lg:grid-cols-2">{list.map((tl) => <Timeline key={tl.id} tl={tl} onRetry={setRetry} />)}</div>
      {uploads.length ? (
        <div className={`${CARD} p-0`} data-testid="mc-uploads">
          <h3 className={`${H3} px-4 pt-4`}>Uploaded recordings</h3>
          <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800">
            {uploads.map((u) => (
              <li key={u.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`mc-upload-row-${u.sessionId}`}>
                <span className="flex flex-col"><span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{u.title}</span><span className={MUTED}>{u.at}</span></span>
                <span className="flex flex-wrap items-center gap-2"><Pill tone={u.status.tone}>{u.status.t}</Pill><Link to={mcHref('calls', u.sessionId)} className={BTN_GHOST}>Open</Link></span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {retry ? (
        <ConfirmDialog title="Try the import again" sub="Axal reads the call’s transcript again, or transcribes what is left of its audio. Parts already transcribed are not charged twice." confirm="Try again"
          onConfirm={() => api.channels.importMeeting(retry.interviewId, retry.id).then(() => calls.reload())} onClose={() => setRetry(null)} testId="mc-retry-dialog" />
      ) : null}
    </section>
  );
}

/** One `<audio>` for the transcript: a turn's press fetches fresh single-use URLs (D690) and plays from its time. */
function useJump(api, id) {
  const audio = useRef(null);
  const [err, setErr] = useState('');
  const jump = async (startMs) => {
    setErr('');
    try {
      const r = await api.sessions.audio(id);
      const at = audioAt(r?.parts, startMs);
      if (!at || !audio.current) { setErr('This part of the call has no audio to play.'); return; }
      audio.current.src = at.part.url;
      audio.current.currentTime = at.offset;
      await audio.current.play();
    } catch (e) {
      setErr(e?.message || 'The audio could not be played.');
    }
  };
  return { audio, jump, err };
}

function CallTranscript({ id, api }) {
  const read = useRead(() => api.sessions.get(id), [id, api]);
  const [view, setView] = useState('both');
  const [rename, setRename] = useState(null);
  const { audio, jump, err } = useJump(api, id);
  if (read.status === 'loading') return <LoadingBoard testId="mc-tx-loading" />;
  if (read.status === 'forbidden') return <NoPermissionBoard label="Calls" testId="mc-nop" />;
  if (read.status !== 'ready') return <ErrorBoard what="This call’s transcript" onRetry={read.reload} testId="mc-tx-error" />;
  const s = read.data?.session || {};
  const segments = read.data?.segments || [];
  const turns = callTurns(segments, view);
  const consent = callConsent(s);
  const source = read.data?.summary?.transcript?.source;
  const via = s.submitted_via === 'upload' ? 'Uploaded' : s.submitted_via === 'zoom' ? 'Zoom' : s.submitted_via === 'google_meet' ? 'Google Meet' : 'Call';
  const meta = [via, s.started_at ? String(s.started_at).replace('T', ' ').slice(0, 16) : null, `Interview ${Number(s.interview_id) || NOT_RECORDED}`].filter(Boolean).join(' · ');
  const hasAudio = !s.audio_removed_at && (read.data?.chunks || []).length > 0;
  return (
    <section className="flex flex-col gap-3" data-testid="mc-transcript">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={MUTED} data-testid="mc-tx-meta">{meta}{source ? ` · ${source === 'whisper' ? 'Transcribed by Axal' : `${via} transcript`}` : ''}</p>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
          {TX_VIEWS.map((v) => (
            <button key={v.key} type="button" role="radio" aria-checked={view === v.key ? 'true' : 'false'} onClick={() => setView(v.key)} data-testid={`mc-tx-view-${v.key}`}
              className={`min-h-[44px] rounded-md px-3 text-[12px] font-semibold sm:min-h-[30px] ${view === v.key ? 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'text-gray-700 dark:text-gray-300'}`}>{v.t}</button>
          ))}
        </div>
      </div>
      <div className={`rounded-xl p-3 ${consent.tone === 'pos' ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/30 dark:text-amber-300'}`} data-testid="mc-tx-consent">
        <p className="m-0 text-[13px] font-semibold">{consent.t}</p>{consent.p ? <p className="m-0 text-[12px]">{consent.p}</p> : null}
      </div>
      <div className="flex flex-wrap gap-3 text-[12.5px]">
        <Link to={mcHref('proposals', id)} className="font-semibold text-violet-700 dark:text-violet-300" data-testid="mc-tx-proposals">Summary and proposals</Link>
        <Link to={SESSION_PAGE(id)} className="font-semibold text-violet-700 dark:text-violet-300">The full session page</Link>
      </div>
      {!turns.length ? <Empty t="No transcript yet." testId="mc-tx-none" /> : (
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {turns.map((t) => (
            <li key={t.id} className={`flex flex-col gap-1 rounded-xl px-3 py-2.5 ${t.you ? 'border border-violet-200 bg-violet-50 dark:border-violet-400/40 dark:bg-violet-950/30' : 'border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'}`} data-testid={`mc-turn-${t.id}`}>
              <span className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-semibold text-gray-900 dark:text-gray-100" data-testid={`mc-turn-who-${t.id}`}>{t.who}</span>
                {t.at ? (hasAudio
                  ? <button type="button" className="min-h-[44px] font-mono text-violet-700 underline underline-offset-2 sm:min-h-0 dark:text-violet-300" onClick={() => jump(t.startMs)} data-testid={`mc-turn-jump-${t.id}`} aria-label={`Play from ${t.at}`}>{t.at}</button>
                  : <span className="font-mono text-gray-500 dark:text-gray-400">{t.at}</span>) : null}
                {t.canRename ? <button type="button" className={`${BTN_GHOST} px-1`} onClick={() => setRename(t.label)} data-testid={`mc-turn-rename-${t.id}`}>Rename speaker</button> : null}
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
      {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mc-tx-audio-error">{err}</p> : null}
      <audio ref={audio} controls={hasAudio} className={hasAudio ? 'w-full' : 'hidden'} data-testid="mc-tx-audio" />
      {rename !== null ? <RenameDialog label={rename} segments={segments} onClose={() => setRename(null)}
        onRename={async (name) => {
          for (const seg of renameTargets(segments, rename)) await api.sessions.setSpeaker(id, seg, name);
          read.reload();
        }} /> : null}
    </section>
  );
}

/** Rename a speaker in every passage of theirs in this call. */
function RenameDialog({ label, segments, onRename, onClose }) {
  const [name, setName] = useState(label === 'Speaker ?' ? '' : label);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = renameTargets(segments, label).length;
  const clean = speakerName(name);
  const go = async () => {
    setBusy(true); setErr('');
    try { await onRename(clean); onClose(); } catch (e) { setErr(e?.message || 'The speaker could not be renamed. Passages already renamed keep the new name.'); setBusy(false); }
  };
  return (
    <Lightbox label="Rename speaker" title="Rename speaker" sub={`${n === 1 ? 'One passage' : `${n} passages`} by “${label}” in this call take the new name. Nothing else changes.`} onClose={onClose} width={440} phone="sheet" testId="mc-rename"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_SEC} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN} onClick={go} disabled={busy || !clean || !n} data-testid="mc-rename-confirm">{busy ? 'Renaming…' : 'Rename'}</button>
        </div>
      )}>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="[Participant]" className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[13px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" data-testid="mc-rename-input" />
      </label>
      {err ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-red-700 dark:text-red-300">{err}</p> : null}
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * MC4: Upload a recording
 * ------------------------------------------------------------------ */

/** The file's length from its own metadata, for the estimate before anything is sent; null when the browser cannot say. */
function useDuration(file) {
  const [ms, setMs] = useState(null);
  useEffect(() => {
    setMs(null);
    if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Audio !== 'function') return undefined;
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => { if (Number.isFinite(a.duration)) setMs(Math.round(a.duration * 1000)); };
    a.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return ms;
}

function UploadTab({ api, venture }) {
  const list = venture.status === 'ready' ? venture.interviews : [];
  const [interviewId, setInterviewId] = useState('');
  const [file, setFile] = useState(null);
  const [method, setMethod] = useState('');
  const [progress, setProgress] = useState(null);
  const [state, setState] = useState({ kind: 'idle' });
  const durationMs = useDuration(file);
  const estimate = uploadEstimate(durationMs);
  useEffect(() => { if (!interviewId && list[0]) setInterviewId(String(list[0].id)); }, [list, interviewId]);
  const ready = !!file && !!method && !!interviewId && !!venture.project && state.kind !== 'busy';
  const start = async () => {
    setState({ kind: 'busy' }); setProgress({ done: 0, total: 0 });
    try {
      const r = await api.uploadRecording({
        file, api: api.sessions, attestation: { agreed: true, method },
        target: { project_id: venture.project.id, interview_id: Number(interviewId) },
        onProgress: (p) => setProgress(p),
      });
      setState({ kind: 'done', sessionId: r.sessionId });
    } catch (e) {
      setState({ kind: 'error', t: e instanceof UploadError ? e.message : (e?.message || 'The recording could not be uploaded. Parts already sent are kept; choose the same file to resume.') });
    }
  };
  const cells = chunkCells(progress?.done, progress?.total);
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="mc-upload">
      <div className="flex flex-col gap-3">
        <div className={`${CARD} flex flex-col gap-3`}>
          <h2 className={H3}>Upload a recording</h2>
          <label className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center dark:border-gray-600 dark:bg-gray-800/40" data-testid="mc-upload-drop">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{file ? file.name : 'Choose a recording'}</span>
            <span className={MUTED}>MP3, M4A, MP4, WebM or WAV, up to 3 hours. It is read on this device; the name never leaves it.</span>
            <input type="file" accept={UPLOAD_TYPES} className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] || null); setState({ kind: 'idle' }); setProgress(null); }} data-testid="mc-upload-file" />
          </label>
          {venture.status === 'ready' && !list.length ? <p className={MUTED} data-testid="mc-upload-no-interview">This venture has no interview yet. <Link to="/validate/customer-research" className={LINK}>Add one in Customer research</Link> first.</p> : null}
          {list.length ? (
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">Interview
              <select value={interviewId} onChange={(e) => setInterviewId(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[13px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" data-testid="mc-upload-interview">
                {list.map((i) => <option key={i.id} value={String(i.id)}>{i.label || i.name || `Interview ${i.id}`}</option>)}
              </select>
            </label>
          ) : null}
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="mc-upload-attest">
            <legend className="mb-1 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">Everyone recorded agreed</legend>
            {ATTESTATIONS.map((a) => (
              <label key={a.method} className="flex min-h-[44px] items-center gap-2 text-[13px] text-gray-800 sm:min-h-[32px] dark:text-gray-200">
                <input type="radio" name="mc-upload-attest" value={a.method} checked={method === a.method} onChange={() => setMethod(a.method)} data-testid={`mc-upload-attest-${a.method}`} />{CONSENT_WORDS[a.method] || a.label}
              </label>
            ))}
            <span className={MUTED}>{ATTESTATION_SENTENCE} The transcript starts only after you confirm it.</span>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN} onClick={start} disabled={!ready} data-testid="mc-upload-start">{state.kind === 'busy' ? 'Uploading…' : 'Upload and transcribe'}</button>
            <span className={MUTED} data-testid="mc-upload-estimate">{estimate ? `About ${estimate.minutes} min · about $${estimate.usd.toFixed(2)} in AI tokens` : 'The cost in AI tokens shows once the file’s length is read.'}</span>
          </div>
        </div>
        {progress ? (
          <div className={`${CARD} flex flex-col gap-2`} data-testid="mc-upload-progress">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{progress.total ? `${progress.done} of ${progress.total} parts stored` : 'Reading the recording on this device…'}</span>
            <div className="flex gap-1" aria-hidden="true">
              {cells.map((c, i) => <span key={i} className={`block h-2.5 flex-1 rounded ${c === 'done' ? 'bg-violet-600' : c === 'now' ? 'border-[1.5px] border-amber-300 bg-amber-50 dark:bg-amber-950/30' : 'bg-gray-100 dark:bg-gray-800'}`} data-cell={c} />)}
            </div>
            <span className={MUTED}>If it stops, choose the same file again: the upload resumes from the part it stopped at.</span>
          </div>
        ) : null}
        {state.kind === 'error' ? <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300" data-testid="mc-upload-error">{state.t}</p> : null}
        {state.kind === 'done' ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" data-testid="mc-upload-done">
            <span>Uploaded. Axal is transcribing it; summary and proposals stay your press.</span>
            <Link to={mcHref('calls', state.sessionId)} className={BTN_SEC}>Open the transcript</Link>
          </div>
        ) : null}
      </div>
      <aside className="flex flex-col gap-3">
        <div className={CARD}>
          <h3 className={H3}>Works without a connection</h3>
          <p className={MUTED}>Any call can be uploaded: a Zoom local recording, a Meet recording from Drive, Teams, or a phone recorder.</p>
        </div>
        <div className={CARD}>
          <h3 className={H3}>Speakers</h3>
          <p className={MUTED}>Passages read “Speaker ?” until you name them in the transcript.</p>
        </div>
      </aside>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * MC6: Summary, decisions, action items and data points
 * ------------------------------------------------------------------ */

function sessionsOf(calls) {
  const rows = [
    ...(calls?.calls || []).filter((c) => c.session_id != null && c.state === 'imported').map((c) => ({ id: Number(c.session_id), t: callTimeline(c).title })),
    ...(calls?.uploads || []).map((u) => ({ id: Number(u.session_id), t: uploadRow(u).title })),
  ];
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
}

function ProposalsTab({ id, calls, api }) {
  const placements = useRead(() => (id ? api.sessions.placements(id) : null), [id, api]);
  const session = useRead(() => (id ? api.sessions.get(id) : null), [id, api]);
  const [note, setNote] = useState('');
  if (!id) {
    if (calls.status === 'loading') return <LoadingBoard testId="mc-prop-loading" />;
    if (calls.status !== 'ready') return <ErrorBoard what="Your calls" onRetry={calls.reload} testId="mc-prop-error" />;
    const rows = sessionsOf(calls.data);
    if (!rows.length) return <Empty t="Nothing to accept yet." testId="mc-prop-empty" />;
    return (
      <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid="mc-prop-list">
        {rows.map((r) => (
          <li key={r.id}><Link to={mcHref('proposals', r.id)} className="flex min-h-[44px] items-center px-4 py-2.5 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`mc-prop-pick-${r.id}`}>{r.t}</Link></li>
        ))}
      </ul>
    );
  }
  if (placements.status === 'loading') return <LoadingBoard testId="mc-prop-loading" />;
  if (placements.status === 'forbidden') return <NoPermissionBoard label="Calls" testId="mc-nop" />;
  if (placements.status !== 'ready') return <ErrorBoard what="This call’s proposals" onRetry={placements.reload} testId="mc-prop-error" />;
  const summary = session.status === 'ready' ? callSummary(session.data) : null;
  const after = (r) => { placements.reload(); return r; };
  return (
    <div className="flex flex-col gap-3" data-testid="mc-proposals">
      <div className={CARD} data-testid="mc-summary">
        <h3 className={H3}>Summary</h3>
        {session.status === 'loading' ? <p className={MUTED}>Reading…</p>
          : summary ? <p className="m-0 mt-1 text-[13px] text-gray-800 dark:text-gray-200" data-testid="mc-summary-text">{summary.text}</p>
            : <p className={MUTED} data-testid="mc-summary-none">No summary yet. Write one from <Link to={SESSION_PAGE(id)} className={LINK}>the session page</Link>; it uses AI tokens.</p>}
      </div>
      {note ? <p role="status" className="m-0 text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="mc-prop-note">{note}</p> : null}
      <ChannelProposals
        groups={callProposalGroups(placements.data)}
        editHref={SESSION_PAGE(id)}
        line="Eadwyn read the call and proposed these. Nothing lands in Validate until you accept it."
        onAccept={(pid) => api.sessions.accept(pid).then(after).then(() => setNote('Accepted. It is in Validate now.'))}
        onDiscard={(pid) => api.sessions.discard(pid).then(after).then(() => setNote('Dismissed.'))}
        onAcceptAll={(ids) => api.sessions.acceptAll(id, ids).then(after).then((r) => setNote(`${Number(r?.accepted) || 0} accepted.${Number(r?.remaining) ? ` ${Number(r.remaining)} still wait.` : ''}`))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * MC7: Retention
 * ------------------------------------------------------------------ */

function RetentionTab({ calls, api }) {
  const setting = useRead(() => api.sessions.audioRetention(), [api]);
  const [ask, setAsk] = useState(null);
  if (setting.status === 'loading' || calls.status === 'loading') return <LoadingBoard testId="mc-ret-loading" />;
  if (setting.status === 'forbidden' || calls.status === 'forbidden') return <NoPermissionBoard label="Calls" testId="mc-nop" />;
  if (setting.status !== 'ready') return <ErrorBoard what="Your retention" onRetry={setting.reload} testId="mc-ret-error" />;
  if (calls.status !== 'ready') return <ErrorBoard what="Your calls" onRetry={calls.reload} testId="mc-ret-error" />;
  const held = retentionChoice(setting.data);
  const rows = retentionRows(calls.data || {});
  const reloadAll = () => { setting.reload(); calls.reload(); };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="mc-retention">
      <div className="flex flex-col gap-3">
        <div className={CARD}>
          <h2 className={H3}>Keep call audio for</h2>
          <p className={MUTED}>Audio is kept for the days you choose, counted from when it arrived; the text stays until you delete it. Applies to uploaded recordings too.</p>
          <div role="radiogroup" aria-label="Keep call audio for" className="mt-2 flex flex-wrap gap-2">
            {RETENTION_CHOICES.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={held?.key === c.key ? 'true' : 'false'} onClick={() => (held?.key === c.key ? null : setAsk({ kind: 'days', c }))} data-testid={`mc-ret-${c.key}`}
                className={`min-h-[44px] rounded-lg border px-3 text-[12.5px] font-semibold sm:min-h-[34px] ${held?.key === c.key ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-400/40 dark:bg-violet-950/40 dark:text-violet-200' : 'border-gray-300 text-gray-800 dark:border-gray-600 dark:text-gray-200'}`}>{c.t}</button>
            ))}
            {held && !RETENTION_CHOICES.some((c) => c.key === held.key) ? <Pill tone="lav" testId="mc-ret-custom">{held.t}</Pill> : null}
          </div>
        </div>
        {!rows.length ? <Empty t="No recordings kept." testId="mc-ret-empty" /> : (
          <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid="mc-ret-list">
            {rows.map((r) => (
              <li key={r.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`mc-ret-row-${r.sessionId}`}>
                <span className="flex flex-col"><span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{r.title}</span><span className={MUTED}>{r.sub}</span><span className="text-[12px] text-gray-700 dark:text-gray-300" data-testid={`mc-ret-line-${r.sessionId}`}>{r.t}</span></span>
                <span className="flex flex-wrap gap-1.5">
                  {r.has ? <button type="button" className={BTN_SEC} onClick={() => setAsk({ kind: 'audio', r })} data-testid={`mc-ret-del-audio-${r.sessionId}`}>Delete audio</button> : null}
                  <button type="button" className={BTN_GHOST} onClick={() => setAsk({ kind: 'session', r })} data-testid={`mc-ret-del-session-${r.sessionId}`}>Delete session</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <aside className={`${CARD} h-fit`}>
        <h3 className={H3}>What stays</h3>
        <p className={MUTED}>Deleting audio keeps the transcript, the summary and anything you accepted into Validate. Deleting a session removes its audio and its text.</p>
      </aside>
      {ask?.kind === 'days' ? <ConfirmDialog title="Change how long call audio is kept" sub={ask.c.days === null ? 'Call audio is kept until you delete it.' : `Call audio older than ${ask.c.t} is removed on the next daily run; its text stays.`} confirm="Change" onConfirm={() => api.sessions.setAudioRetention(ask.c.days).then(reloadAll)} onClose={() => setAsk(null)} testId="mc-ret-days-dialog" /> : null}
      {ask?.kind === 'audio' ? <ConfirmDialog title="Delete this call’s audio" sub={`The audio of “${ask.r.title}” is deleted for good. Its transcript and summary stay.`} confirm="Delete audio" tone="neg" onConfirm={() => api.sessions.deleteAudio(ask.r.sessionId).then(reloadAll)} onClose={() => setAsk(null)} testId="mc-ret-audio-dialog" /> : null}
      {ask?.kind === 'session' ? <ConfirmDialog title="Delete this session" sub={`“${ask.r.title}” is deleted for good: its audio, its transcript and its summary. Anything already accepted into Validate stays.`} confirm="Delete session" tone="neg" onConfirm={() => api.sessions.remove(ask.r.sessionId).then(reloadAll)} onClose={() => setAsk(null)} testId="mc-ret-session-dialog" /> : null}
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
  const calls = useRead(() => api.channels.calls(), [api]);
  let body;
  if (route.tab === 'connection') body = <ConnectionTab api={api} />;
  else if (route.tab === 'upload') body = <UploadTab api={api} venture={venture} />;
  else if (route.tab === 'calls') body = route.id ? <CallTranscript id={route.id} api={api} /> : <CallsList calls={calls} api={api} />;
  else if (route.tab === 'proposals') body = <ProposalsTab id={route.id} calls={calls} api={api} />;
  else if (route.tab === 'retention') body = <RetentionTab calls={calls} api={api} />;
  else body = <UpcomingTab api={api} venture={venture} />;
  return (
    <div className="flex flex-col gap-4" data-testid="mc-tool">
      <SubTabs tool={TOOL} active={route.tab} />
      <h2 className={`${H3} sr-only`}>{MC_TABS.find((t) => t.key === route.tab)?.label}</h2>
      {body}
    </div>
  );
}
