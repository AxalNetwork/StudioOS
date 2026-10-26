import React, { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { dataRoomApi } from '../../../lib/api/dataRoom';
import { Unreadable } from '../../../ui';
import DataRoomDialog from './DataRoomDialog.jsx';
import { GrantFields } from './DataRoomAccess.jsx';
import { NDA_WORD, accessRefusal, declineError, diligenceRows, grantBody, grantBodyError, requestRows, shareEffect } from './accessModel';

/**
 * D1107 (#2987) — Requests (DR9, DR9d): access requests from the round call
 * and the deal page in one queue (D1104), and the venture's diligence
 * requests with the files that answer them. Only the owner answers an access
 * request (D1103); a co-founder reads it and answers diligence with a file.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'block w-full rounded-[7px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN_G = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] px-2 text-[12px] font-bold text-axal-violet-deep hover:text-axal-violet dark:text-violet-300';
const NOTE = 'rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2.5 text-[12.5px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-900/30 dark:text-gray-100';
const PILL = {
  Waiting: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  Answered: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  other: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const Pill = ({ t }) => <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[t] || PILL.other}`}>{t}</span>;

/** The queue, read on its own: a failure here never blanks the room. */
function useRequests(projectUid, reload) {
  const [state, setState] = useState({ status: 'loading', read: null });
  useEffect(() => {
    if (!projectUid) return undefined;
    let alive = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading', read: null }));
    dataRoomApi.requests(projectUid)
      .then((read) => { if (alive) setState({ status: 'ready', read }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', read: null }); });
    return () => { alive = false; };
  }, [projectUid, reload]);
  return state;
}

function AcceptDialog({ room, projectUid, row, onClose, onDone }) {
  const [fields, setFields] = useState({ until: '', scope: 'all', chosen: [] });
  const error = grantBodyError(fields);
  return (
    <DataRoomDialog testId="accept-dialog" copy={{ title: `Share the room with ${row.who}`, body: 'They asked for the room. Sharing answers their request and tells them.', action: 'Share' }}
      disabled={Boolean(error)} refusalOf={accessRefusal} onClose={onClose}
      onConfirm={async () => { await dataRoomApi.acceptRequest(projectUid, row.uid, grantBody(fields)); onDone(`${row.who} can open the room now.`); }}>
      <GrantFields room={room} value={fields} onChange={setFields} />
      {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="accept-error">{error}</p> : null}
      <p className={NOTE} data-testid="accept-effect">{shareEffect(room, { folders: fields.scope === 'all' ? null : fields.chosen })}{row.nda === 'active' ? ' Their NDA with you is in force.' : ''}</p>
    </DataRoomDialog>
  );
}

function DeclineDialog({ projectUid, row, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const error = declineError(reason);
  return (
    <DataRoomDialog testId="decline-dialog" danger copy={{ title: `Decline ${row.who}’s request?`, body: 'They are told you declined, with your note. Nothing in the room changes.', action: 'Decline' }}
      disabled={Boolean(error)} refusalOf={accessRefusal} onClose={onClose}
      onConfirm={async () => { await dataRoomApi.declineRequest(projectUid, row.uid, reason.trim()); onDone(`${row.who}’s request is declined.`); }}>
      <label className="flex flex-col gap-1.5">
        <span className={EYEBROW}>Note to them</span>
        <textarea className={`${FIELD} min-h-[60px]`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="decline-reason" />
      </label>
      {reason && error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{error}</p> : null}
    </DataRoomDialog>
  );
}

function AnswerDialog({ room, projectUid, row, onClose, onDone }) {
  const [file, setFile] = useState('');
  const files = (room?.files || []).filter((f) => !row.files.some((x) => x.uid === f.uid));
  const chosen = files.find((f) => f.uid === file) || null;
  return (
    <DataRoomDialog testId="answer-dialog" copy={{ title: `Answer “${row.title}”`, body: 'The file is matched to this request. Who can open it does not change.', action: 'Answer with this file' }}
      disabled={!chosen} refusalOf={accessRefusal} onClose={onClose}
      onConfirm={async () => { await api.dataRoomUpdateFile(projectUid, chosen.uid, { dd_request_id: row.id }); onDone(`${chosen.name} answers “${row.title}”.`); }}>
      {files.length ? (
        <label className="flex flex-col gap-1.5">
          <span className={EYEBROW}>File</span>
          <select className={FIELD} value={file} onChange={(e) => setFile(e.target.value)} data-testid="answer-file">
            <option value="">Choose a file in the room</option>
            {files.map((f) => <option key={f.uid} value={f.uid}>{f.name}</option>)}
          </select>
        </label>
      ) : <p className={`m-0 ${MUTED}`}>Every file in the room already answers this, or the room has no files. Upload one in Files.</p>}
    </DataRoomDialog>
  );
}

export default function DataRoomRequests({ room, projectUid, reload: reloadRoom }) {
  const [reload, setReload] = useState(0);
  const q = useRequests(projectUid, reload);
  const [dialog, setDialog] = useState(null);
  const [said, setSaid] = useState(null);
  const done = (line) => { setDialog(null); setSaid(line); setReload((n) => n + 1); reloadRoom?.(); };
  const retry = () => setReload((n) => n + 1);
  const canAnswer = Boolean(q.read?.can_answer);
  const rows = q.status === 'ready' ? requestRows(q.read) : [];
  const dil = q.status === 'ready' ? diligenceRows(q.read) : null;
  const waiting = rows.filter((r) => r.open).length;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2" data-testid="dataroom-requests">
      {said ? <p role="status" className={`m-0 text-[12.5px] font-semibold lg:col-span-2 ${INK}`} data-testid="requests-said">{said}</p> : null}
      <section className={CARD} data-testid="requests-access">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Access requests</h2>
          {q.status === 'ready' ? <span className={`font-mono text-[12px] font-bold ${waiting ? 'text-amber-700 dark:text-amber-300' : MUTED}`} data-testid="requests-waiting">{waiting} waiting</span> : null}
        </div>
        <div className="flex flex-col px-4 py-3">
          {q.status === 'loading' ? <div className="h-16 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" aria-busy="true" data-testid="requests-loading" /> : null}
          {q.status === 'unreadable' ? <Unreadable what="The access requests" claim="This is not a claim that nobody asked." onRetry={retry} /> : null}
          {q.status === 'ready' && !rows.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="requests-none">Nobody has asked for the room from the round call or the deal page.</p> : null}
          {rows.map((r) => (
            <div key={r.uid} className="flex flex-col gap-1 border-b border-axal-hairline py-2.5 last:border-0 dark:border-gray-800" data-testid={`request-${r.uid}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-[13.5px] font-bold ${INK}`}>{r.who}</span><Pill t={r.state} />
              </div>
              <span className={`text-[12px] ${MUTED}`}>{r.line} · NDA: {NDA_WORD[r.nda === 'active' ? 'signed' : r.nda]}</span>
              {r.message ? <span className={`text-[12.5px] ${INK}`}>“{r.message}”</span> : null}
              {r.decided ? <span className={`text-[12px] ${MUTED}`}>{r.decided}{r.reason ? ` · “${r.reason}”` : ''}</span> : null}
              {r.open && canAnswer ? (
                <span className="flex flex-wrap gap-2 pt-1">
                  {r.hasAccess ? <span className={`text-[12px] ${MUTED}`}>They already have the room.</span> : null}
                  <button type="button" className={BTN} onClick={() => setDialog({ kind: 'accept', row: r })} data-testid={`request-share-${r.uid}`}>Share the room</button>
                  <button type="button" className={BTN_G} onClick={() => setDialog({ kind: 'decline', row: r })} data-testid={`request-decline-${r.uid}`}>Decline</button>
                </span>
              ) : null}
            </div>
          ))}
          {q.status === 'ready' && !canAnswer && waiting ? <p className={`m-0 pt-2 text-[12px] ${MUTED}`} data-testid="requests-owner-only">Only the venture’s owner answers access requests.</p> : null}
        </div>
      </section>
      <section className={CARD} data-testid="requests-diligence">
        <div className="border-b border-axal-hairline px-4 py-3 dark:border-gray-800"><h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Diligence requests</h2></div>
        <div className="flex flex-col px-4 py-3">
          {q.status === 'ready' && dil === null ? <Unreadable what="The diligence requests" claim="This is not a claim that none were sent." onRetry={retry} /> : null}
          {q.status === 'ready' && dil && !dil.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="diligence-none">No diligence request has been sent to this venture.</p> : null}
          {(dil || []).map((d) => (
            <div key={d.id} className="flex flex-col gap-1 border-b border-axal-hairline py-2.5 last:border-0 dark:border-gray-800" data-testid={`diligence-${d.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className={`text-[13.5px] font-bold ${INK}`}>{d.title}</span><Pill t={d.state} /></div>
              <span className={`text-[12px] ${MUTED}`}>{d.line}</span>
              <span><button type="button" className={BTN} onClick={() => setDialog({ kind: 'answer', row: d })} data-testid={`diligence-answer-${d.id}`}>Answer with a file</button></span>
            </div>
          ))}
          {q.status === 'ready' && dil?.length ? <p className={`m-0 pt-2 text-[11.5px] ${MUTED}`}>A request shows as Requested until a file answers it.</p> : null}
        </div>
      </section>
      {dialog?.kind === 'accept' ? <AcceptDialog room={room} projectUid={projectUid} row={dialog.row} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'decline' ? <DeclineDialog projectUid={projectUid} row={dialog.row} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'answer' ? <AnswerDialog room={room} projectUid={projectUid} row={dialog.row} onClose={() => setDialog(null)} onDone={done} /> : null}
    </div>
  );
}
