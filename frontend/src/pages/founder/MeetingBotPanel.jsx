import React, { useEffect, useRef, useState } from 'react';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { botView, createBotSession } from './meetingBotSession.js';

const BUTTON = 'rounded-md border border-gray-300 px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 dark:border-gray-700 dark:text-gray-100';
const time = (ms) => Number.isSafeInteger(ms) && ms >= 0 ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : 'Not recorded';

export function MeetingBotStatus({ snapshot, now = Date.now(), onStop, onRetry, participants }) {
  const view = botView(snapshot.read, { unreadable: snapshot.unreadable, now });
  return <section className="space-y-3 rounded-2xl border border-axal-hairline bg-white p-5 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100" data-testid="meeting-bot-panel" data-state={view.state}>
    <h2 className="m-0 text-[16px] font-bold">Eadwyn AI</h2>
    <p role="status" className="m-0 text-[14px] font-semibold" data-testid="bot-status">{view.label}{view.timer && <span className="ml-2 font-mono tabular-nums" aria-label="Approximate run time">Run time {view.timer}</span>}</p>
    {view.state === 'queued' && <p className="text-[12px] text-axal-faint">Eadwyn AI will join at the scheduled start time. Stop cancels that send.</p>}
    {view.state === 'processing' && <p className="text-[12px] text-axal-faint">The recording is being saved and processed. You can leave this page.</p>}
    {view.state === 'unreadable' && <p className="text-[12px] text-axal-faint">The bot status could not be read. This does not mean the bot has stopped.</p>}
    {view.failure && <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">{view.failure}</p>}
    {snapshot.error && <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">{snapshot.error}</p>}
    {view.participantCount !== null && <p className="text-[13px]" data-testid="bot-participant-count">{view.participantCount} in the latest roster</p>}
    <div className="flex flex-wrap gap-2">
      {view.canStop && <button type="button" className={BUTTON} disabled={!!snapshot.busy} onClick={onStop} data-testid="bot-stop">{snapshot.busy === 'stop' ? 'Stopping…' : 'Stop'}</button>}
      {view.state === 'unreadable' && <button type="button" className={BUTTON} onClick={onRetry} data-testid="bot-refresh">Read status again</button>}
    </div>
    <div className="space-y-1" data-testid="bot-participants">
      <h3 className="text-[13px] font-semibold">Participants</h3>
      {participants === undefined ? <p className="text-[12px] text-axal-faint">Reading participants…</p>
        : participants === 'unreadable' ? <p className="text-[12px] text-axal-faint">Unreadable: the participants could not be read.</p>
          : participants === null ? <p className="text-[12px] text-axal-faint">Not recorded: the bot has not sent a roster.</p>
            : <ul className="space-y-1 text-[13px]">{participants.length === 0 ? <li>No participants in the latest roster.</li> : participants.map((p, i) => <li key={i} className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="break-words">{p.display_name}</span><span className="text-[12px] text-axal-faint">Joined {time(p.joined_ms)} · {p.left_ms === null ? 'Still present in the latest roster' : `Left ${time(p.left_ms)}`}</span></li>)}</ul>}
    </div>
  </section>;
}

function BoundPanel({ sessionId, api, onStatus }) {
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
  useEffect(() => {
    if (!snapshot.read?.bot) return undefined;
    let alive = true;
    api.botParticipants(sessionId).then((r) => { if (alive) setParticipants(r?.participants === null || Array.isArray(r?.participants) ? r.participants : 'unreadable'); }, () => { if (alive) setParticipants('unreadable'); });
    return () => { alive = false; };
  }, [api, sessionId, snapshot.read]);
  if (view.state === 'missing') return null;
  return <MeetingBotStatus snapshot={snapshot} now={now} participants={snapshot.unreadable ? 'unreadable' : participants} onStop={() => control.current?.stop()} onRetry={() => control.current?.refresh()} />;
}

export default function MeetingBotPanel({ sessionId, api = interviewSessionsApi, onStatus }) {
  return <BoundPanel key={sessionId} sessionId={sessionId} api={api} onStatus={onStatus} />;
}
