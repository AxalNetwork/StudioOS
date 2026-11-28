import React, { useEffect, useRef, useState } from 'react';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { Link } from 'react-router-dom';
import { TEAMS_BOT_GUEST, TEAMS_BOT_OFF, botView, createBotSession } from './meetingBotSession.js';

const BUTTON = 'rounded-md border border-gray-300 px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 dark:border-gray-700 dark:text-gray-100';
const time = (ms) => Number.isSafeInteger(ms) && ms >= 0 ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : 'Not recorded';

const LINK = 'text-[12px] font-semibold text-axal-violet underline dark:text-violet-300 max-sm:inline-flex max-sm:min-h-[44px] max-sm:items-center';

/**
 * D5813: after a recognised Teams refusal, what the organizer can do (none for
 * a captcha) and the existing fallbacks: upload the call's recording, or paste
 * its transcript in Record a session (`recordHref`, the session's own interview).
 */
export function BlockedActions({ view, recordHref = null }) {
  if (!view?.blocked) return null;
  return <div className="space-y-1.5" data-testid="bot-blocked-actions" data-blocked={view.blocked}>
    {view.organizer && <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="bot-organizer-action"><span className="font-semibold">What the organizer can do: </span>{view.organizer}</p>}
    <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="bot-fallback-note">{TEAMS_BOT_GUEST} {TEAMS_BOT_OFF}</p>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link to="/validate/record/calls/upload" className={LINK} data-testid="bot-fallback-upload">Upload the recording</Link>
      {recordHref && <Link to={recordHref} className={LINK} data-testid="bot-fallback-paste">Paste the transcript</Link>}
    </div>
  </div>;
}

// D1455 (#3710, REC2): with `hideFailure`, the page's one failure panel says what failed; this card no longer repeats it in red.
// #4018 (REC3): with `hideParticipants`, the page's participants timeline shows the roster, so this card's list goes.
export function MeetingBotStatus({ snapshot, now = Date.now(), onStop, onRetry, participants, hideFailure = false, hideParticipants = false, recordHref = null }) {
  const view = botView(snapshot.read, { unreadable: snapshot.unreadable, now });
  return <section className="space-y-3 rounded-2xl border border-axal-hairline bg-white p-5 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100" data-testid="meeting-bot-panel" data-state={view.state}>
    <h2 className="m-0 text-[16px] font-bold">Eadwyn AI</h2>
    <p role="status" className="m-0 text-[14px] font-semibold" data-testid="bot-status">{view.label}{view.timer && <span className="ml-2 font-mono tabular-nums" aria-label="Approximate run time">Run time {view.timer}</span>}</p>
    {view.note && <p className="text-[12px] text-axal-faint dark:text-gray-400" data-testid="bot-note">{view.note}</p>}
    {view.state === 'unreadable' && <p className="text-[12px] text-axal-faint">The bot status could not be read. This does not mean the bot has stopped.</p>}
    {view.failure && !(hideFailure && view.state === 'failed') && <p role="alert" className="text-[13px] text-red-700 dark:text-red-300" data-testid="bot-failure" data-blocked={view.blocked || undefined}>{view.failure}</p>}
    {view.blocked && !hideFailure && <BlockedActions view={view} recordHref={recordHref} />}
    {snapshot.error && <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">{snapshot.error}</p>}
    {view.participantCount !== null && <p className="text-[13px]" data-testid="bot-participant-count">{view.participantCount} in the latest roster</p>}
    <div className="flex flex-wrap gap-2">
      {view.canStop && <button type="button" className={BUTTON} disabled={!!snapshot.busy} onClick={onStop} data-testid="bot-stop">{snapshot.busy === 'stop' ? 'Stopping…' : 'Stop'}</button>}
      {view.state === 'unreadable' && <button type="button" className={BUTTON} onClick={onRetry} data-testid="bot-refresh">Read status again</button>}
    </div>
    {!hideParticipants && <div className="space-y-1" data-testid="bot-participants">
      <h3 className="text-[13px] font-semibold">Participants</h3>
      {participants === undefined ? <p className="text-[12px] text-axal-faint">Reading participants…</p>
        : participants === 'unreadable' ? <p className="text-[12px] text-axal-faint">Unreadable: the participants could not be read.</p>
          : participants === null ? <p className="text-[12px] text-axal-faint">Not recorded: the bot has not sent a roster.</p>
            : <ul className="space-y-1 text-[13px]">{participants.length === 0 ? <li>No participants in the latest roster.</li> : participants.map((p, i) => <li key={i} className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="break-words">{p.display_name}</span><span className="text-[12px] text-axal-faint">Joined {time(p.joined_ms)} · {p.left_ms === null ? 'Still present in the latest roster' : `Left ${time(p.left_ms)}`}</span></li>)}</ul>}
    </div>}
  </section>;
}

function BoundPanel({ sessionId, api, onStatus, onRead, onParticipants, hideFailure, hideParticipants }) {
  const [snapshot, setSnapshot] = useState({ read: undefined, unreadable: false, busy: null, error: null });
  const [now, setNow] = useState(Date.now());
  const [participants, setParticipants] = useState(undefined);
  const control = useRef(null);
  const view = botView(snapshot.read, { unreadable: snapshot.unreadable, now });
  useEffect(() => {
    const bound=createBotSession({getBot:()=>api.getBot(sessionId),sendBot:(body)=>api.sendBot(sessionId,body),stopBot:()=>api.stopBot(sessionId),changed:setSnapshot});
    control.current=bound; bound.refresh();
    return () => { bound.dispose(); if (control.current===bound) control.current=null; };
  }, [api,sessionId]);
  useEffect(() => {
    if (!view.poll && !snapshot.unreadable) return undefined;
    const timer = setTimeout(() => control.current?.refresh(), 3000);
    return () => clearTimeout(timer);
  }, [control, snapshot.read, snapshot.unreadable, view.poll]);
  useEffect(() => {
    if (view.state !== 'recording') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.state]);
  useEffect(() => { if (snapshot.read?.bot) onStatus?.(snapshot.read.bot.status); }, [snapshot.read?.bot?.status, onStatus]);
  // D1455: the page's stepper and failure panel read the same bot read.
  useEffect(() => { onRead?.(snapshot.unreadable ? { unreadable: true } : snapshot.read); }, [snapshot.read, snapshot.unreadable, onRead]);
  useEffect(() => {
    if (!snapshot.read?.bot) return undefined;
    let alive = true;
    api.botParticipants(sessionId).then((r) => { if (alive) setParticipants(r?.participants === null || Array.isArray(r?.participants) ? r.participants : 'unreadable'); }, () => { if (alive) setParticipants('unreadable'); });
    return () => { alive = false; };
  }, [api, sessionId, snapshot.read]);
  const shown = snapshot.unreadable ? 'unreadable' : participants;
  // #4018: the page's participants timeline reads the same roster, refreshed by this poll.
  useEffect(() => { onParticipants?.(shown); }, [shown, onParticipants]);
  if (view.state === 'missing') return null;
  return <MeetingBotStatus snapshot={snapshot} now={now} hideFailure={hideFailure} hideParticipants={hideParticipants} participants={shown} onStop={() => control.current?.stop()} onRetry={() => control.current?.refresh()} />;
}

export default function MeetingBotPanel({ sessionId, api = interviewSessionsApi, onStatus, onRead, onParticipants, hideFailure = false, hideParticipants = false }) {
  return <BoundPanel key={sessionId} sessionId={sessionId} api={api} onStatus={onStatus} onRead={onRead} onParticipants={onParticipants} hideFailure={hideFailure} hideParticipants={hideParticipants} />;
}
