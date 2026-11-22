/**
 * D6186 (#6186) — the deal page's Documents tab for the venture's founder, an Admin and an Operating Partner,
 * in the frame's cards (the investor's own tab is `DealWorkTabs.jsx` `DealDocuments`, DL8). Each read has its
 * four states: reading, unreadable with Try again, empty in words, and its rows. The rules and the words are
 * `dealDocumentsModel.js`'s.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { api } from '../../lib/api';
import { dataRoomApi } from '../../lib/api/dataRoom';
import { reportError } from '../../lib/log';
import DealPaperRow from './DealPaper';
import { paperRows } from './dealWorkModel';
import { CARD, EYE, H3, SUB } from './DealFrame';
import {
  DOCS_NDA, DOCS_NONE, PAPER_NONE, PAPER_SCOPE, ROOM_LINE, documentRows, documentsViewer, pendingRequests, plural,
  requestsLine, roomCounts, roomHref, shown,
} from './dealDocumentsModel';

const LINK = 'text-[12.5px] font-bold text-axal-violet-deep underline dark:text-violet-300';
const Reading = () => <p className={`m-0 ${SUB}`} aria-live="polite">Reading…</p>;
const Card = ({ title, eye, children, testId }) => (
  <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid={testId}>
    {eye && <span className={EYE}>{eye}</span>}
    {title && <h3 className={H3}>{title}</h3>}
    {children}
  </section>
);

/** A read with its own state; an answer from a superseded read lands nowhere (as `DealWorkTabs.jsx` `useRead`). */
function useRead(load, deps, enabled = true) {
  const [read, setRead] = useState({ status: enabled ? 'loading' : 'off' });
  const serial = useRef(0);
  useEffect(() => () => { serial.current += 1; }, []);
  const run = () => {
    if (!enabled) { setRead({ status: 'off' }); return; }
    const mine = ++serial.current;
    setRead({ status: 'loading' });
    load().then((data) => { if (serial.current === mine) setRead({ status: 'ready', data }); })
      .catch((e) => { if (e?.code !== 'nda_required') reportError('DealDocuments:read', e); if (serial.current === mine) setRead({ status: e?.code === 'nda_required' ? 'nda' : 'unreadable' }); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, [...deps, enabled]);
  return [read, run];
}

function Count({ label, value, testId }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className={EYE}>{label}</span>
      <span className="text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{shown(value)}</span>
    </div>
  );
}

/** The founder's own data room: its counts, the requests waiting, and where to see who opened what. */
function FounderRoom({ deal }) {
  const projectUid = deal.profile_uid || null;
  const projectId = deal.project_id ?? null;
  const [room, reloadRoom] = useRead(() => api.dataRoom(projectUid), [projectUid], !!projectUid);
  const [requests, reloadRequests] = useRead(() => dataRoomApi.requests(projectUid), [projectUid], !!projectUid);
  if (!projectUid) {
    return (
      <Card title="Your data room" testId="deal-docs-room">
        <p className={`m-0 ${SUB}`}>This deal names no venture, so it has no data room.</p>
      </Card>
    );
  }
  const counts = room.status === 'ready' ? roomCounts(room.data) : null;
  const waiting = requests.status === 'ready' ? pendingRequests(requests.data) : null;
  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <Card title="Your data room" testId="deal-docs-room">
        {room.status === 'loading' && <Reading />}
        {room.status === 'unreadable' && <Unreadable what="Your data room" claim="That is not a claim that it is empty." onRetry={reloadRoom} />}
        {counts && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Files" value={counts.files} testId="deal-docs-room-files" />
            <Count label="Folders" value={counts.folders} testId="deal-docs-room-folders" />
            <Count label="Open grants" value={counts.granted} testId="deal-docs-room-grants" />
            <Count label="Opened this week" value={counts.opened} testId="deal-docs-room-opened" />
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Link to={roomHref('', projectId)} className={LINK} data-testid="deal-docs-room-open">Open Raise › Data room</Link>
          <Link to={roomHref('activity', projectId)} className={LINK} data-testid="deal-docs-room-activity">See who opened what</Link>
        </div>
      </Card>
      <Card title="Access requests" testId="deal-docs-requests">
        {requests.status === 'loading' && <Reading />}
        {requests.status === 'unreadable' && <Unreadable what="The access requests" claim="That is not a claim that nobody asked." onRetry={reloadRequests} />}
        {requests.status === 'ready' && (
          <p className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100" data-testid="deal-docs-requests-line">
            {requestsLine(waiting) ?? 'The requests could not be counted.'}
          </p>
        )}
        <Link to={roomHref('requests', projectId)} className={LINK} data-testid="deal-docs-requests-open">
          {waiting ? `Decide ${plural(waiting, 'request', 'requests')}` : 'Open Requests'}
        </Link>
      </Card>
    </div>
  );
}

/** The venture's documents: each row with the reason it cannot be opened (no route serves their text). */
function DocumentList({ dealId }) {
  const [docs, reload] = useRead(() => api.dealDocuments(dealId), [dealId]);
  const rows = docs.status === 'ready' ? documentRows(docs.data) : [];
  return (
    <Card title="Documents" testId="deal-docs-list">
      {docs.status === 'loading' && <Reading />}
      {docs.status === 'nda' && <p className={`m-0 ${SUB}`} data-testid="deal-documents-nda">{DOCS_NDA}</p>}
      {docs.status === 'unreadable' && <Unreadable what="The documents" claim="That is not a claim that no documents exist." onRetry={reload} />}
      {docs.status === 'ready' && rows.length === 0 && <p className={`m-0 ${SUB}`} data-testid="deal-docs-none">{DOCS_NONE}</p>}
      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 py-2.5" data-testid="deal-docs-row">
              <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
              <span className={SUB}>{r.kind} · {r.status}</span>
              <span className={SUB} data-testid="deal-docs-row-reason">{r.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Paper({ dealId, who }) {
  const [paper, reload] = useRead(() => api.esignList({ deal_id: dealId }), [dealId]);
  const rows = paper.status === 'ready' ? paperRows(paper.data?.envelopes) : [];
  return (
    <Card title="Deal paper" testId="deal-paper">
      <p className={`m-0 ${SUB}`}>{PAPER_SCOPE[who]}</p>
      {paper.status === 'loading' && <Reading />}
      {paper.status === 'unreadable' && <Unreadable what="The deal paper" claim="That is not a claim that nothing was sent." onRetry={reload} />}
      {paper.status === 'ready' && rows.length === 0 && <p className={`m-0 ${SUB}`}>{PAPER_NONE[who]}</p>}
      {rows.map((p) => <DealPaperRow key={p.id} row={p} />)}
    </Card>
  );
}

export default function DealDocumentsStaff({ deal, viewer }) {
  const who = documentsViewer(viewer);
  if (!who) {
    return <p className={`m-0 ${SUB}`} data-testid="deal-docs-not-yours">The documents on this deal are not open to you.</p>;
  }
  return (
    <div className="flex flex-col gap-3.5" data-testid={`deal-docs-${who}`}>
      {who === 'founder' && <FounderRoom deal={deal} />}
      {who !== 'founder' && (
        <section className={`${CARD} p-4`} data-testid="deal-docs-room-line">
          <p className={`m-0 ${SUB}`}>{ROOM_LINE[who]}</p>
        </section>
      )}
      <div className="grid gap-3.5 md:grid-cols-2">
        <Paper dealId={deal.id} who={who} />
        <DocumentList dealId={deal.id} />
      </div>
    </div>
  );
}
