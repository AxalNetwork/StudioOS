import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminEvents } from '../../../lib/api';
import { Unreadable, Unrecorded, actionGhost, actionPrimary } from '../../../ui';
import {
  NOTHING_WAITING, NOTHING_WAITING_SUB, QUEUE_CLAIM, QUEUE_SORTS, approveLines, approvedLine, factsOf, queueFlags,
  queueRows, readyList, refusalText, sentBackLine, startShort, titleOf,
} from './eventsDeskModel';
import { ApproveDialog, SendBackDialog } from './EventDialogs';
import { CARD, Card, Done, EYE, INPUT, LINK, Pill, SUB } from './parts';

/**
 * D915 (#2368) — Review (EV3). The queue is R1 with `status=pending_review`,
 * every page of it, searched by title and sorted by start or by creation. The
 * selected event's facts come from its R1 row. Approve (EV4) and Send back
 * (EV5) are dialogs; after either, one line appears over the list, and no
 * toast. The preview, clashes, history, host and venture wait for D915 parts
 * 2, 3 and 6.
 */

function QueueRow({ ev, selected, onSelect }) {
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined} data-testid={`events-queue-row-${ev.id}`}
        className={`flex w-full flex-col gap-1.5 rounded-[10px] border px-3 py-2.5 text-left ${selected
          ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40'
          : 'border-transparent hover:bg-axal-ground dark:hover:bg-gray-800'}`}>
        <span className="text-[13.5px] font-bold leading-snug text-axal-ink dark:text-gray-100">{titleOf(ev)}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-axal-ink dark:text-gray-100">{startShort(ev)}</span>
          {queueFlags(ev).map((f) => <Pill key={f}>{f}</Pill>)}
        </span>
      </button>
    </li>
  );
}

function Facts({ ev }) {
  const [open, setOpen] = useState(false);
  const description = String(ev?.description || '').trim();
  return (
    <Card title="Facts" testId="events-review-facts">
      <dl className="m-0 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {factsOf(ev).map((f) => (
          <div key={f.key} className="flex min-w-0 flex-col gap-0.5">
            <dt className={EYE}>{f.label}</dt>
            <dd className="m-0 text-[13px] font-semibold leading-snug text-axal-ink dark:text-gray-100">
              {f.unrecorded ? <Unrecorded reason={f.unrecorded.reason}>{f.unrecorded.text}</Unrecorded> : f.value}
            </dd>
            {f.sub ? <dd className={`m-0 ${SUB}`}>{f.sub}</dd> : null}
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-700">
        <span className={EYE}>Description</span>
        {description ? (
          <>
            <p className={`m-0 whitespace-pre-line text-[13px] leading-relaxed text-axal-ink dark:text-gray-100 ${open ? '' : 'line-clamp-4'}`}>{description}</p>
            <button type="button" className={`${LINK} self-start`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Show less' : 'Show all'}</button>
          </>
        ) : <span className="text-[13px]"><Unrecorded /></span>}
      </div>
    </Card>
  );
}

export default function EventsReview({ reads }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('starts');
  const [picked, setPicked] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  // `{ id, line, at }`: the event just decided, and when.
  const [done, setDone] = useState(null);
  const doneRef = useRef(null);
  useEffect(() => { if (done) doneRef.current?.focus?.(); }, [done]);

  // The Worker checks no status, so the event just decided stays out of the
  // queue until a queue read newer than the decision lands: it cannot be
  // approved or sent back a second time in that gap.
  const read = readyList(reads.queue);
  const settling = Boolean(done) && (reads.queue.at || 0) < done.at;
  const list = read && settling ? read.filter((r) => String(r.id) !== String(done.id)) : read;
  const rows = list ? queueRows(list, { q, sort }) : [];
  const ev = rows.find((r) => String(r.id) === String(picked)) || rows[0] || null;

  const close = () => { if (!busy) { setDialog(null); setRefusal(null); } };

  const approve = async ({ feature }) => {
    setBusy(true); setRefusal(null);
    try {
      await adminEvents.approve(ev.id);
    } catch (e) {
      setRefusal(refusalText(e)); setBusy(false);
      return;
    }
    let featureError = null;
    if (feature) {
      try { await adminEvents.feature(ev.id, true); } catch (e) { featureError = e; }
    }
    setDone({ id: ev.id, line: approvedLine(ev, { featured: feature && !featureError, featureError }), at: Date.now() });
    setBusy(false); setDialog(null); setPicked(null);
    reads.reload();
  };

  const sendBack = async (reason) => {
    setBusy(true); setRefusal(null);
    try {
      await adminEvents.reject(ev.id, reason);
    } catch (e) {
      setRefusal(refusalText(e)); setBusy(false);
      return;
    }
    setDone({ id: ev.id, line: sentBackLine(ev), at: Date.now() });
    setBusy(false); setDialog(null); setPicked(null);
    reads.reload();
  };

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" data-testid="events-review">
      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="events-queue-h" data-testid="events-queue">
        {done ? (
          <Done focusRef={doneRef}>
            <span>{done.line}</span>
            <Link to={`/admin/events/${done.id}`} className={LINK}>Open event</Link>
          </Done>
        ) : null}
        <h2 id="events-queue-h" className="m-0 text-[15px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">
          {list ? `Waiting for review · ${list.length.toLocaleString('en-US')}` : 'Waiting for review'}
        </h2>
        {reads.queue.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
        {reads.queue.status === 'error' ? <Unreadable what="The review queue" claim={QUEUE_CLAIM} onRetry={reads.reload} /> : null}
        {list && list.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-6 text-center" data-testid="events-nothing-waiting">
            <span className="text-[16px] font-extrabold text-axal-ink dark:text-gray-100">{NOTHING_WAITING}</span>
            <span className={SUB}>{NOTHING_WAITING_SUB}</span>
          </div>
        ) : null}
        {list && list.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 flex-col">
                <span className="sr-only">Search titles</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles" className={INPUT} data-testid="events-queue-search" />
              </label>
              <label className="flex flex-col">
                <span className="sr-only">Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)} className={INPUT} data-testid="events-queue-sort">
                  {QUEUE_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
                </select>
              </label>
            </div>
            {rows.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {rows.map((r) => <QueueRow key={r.id} ev={r} selected={ev && String(ev.id) === String(r.id)} onSelect={() => setPicked(r.id)} />)}
              </ul>
            ) : <p className={`m-0 ${SUB}`}>No title matches.</p>}
          </>
        ) : null}
      </section>

      {ev ? (
        <div className="flex min-w-0 flex-col gap-3.5" data-testid="events-review-event">
          <Facts ev={ev} />
          <Card title="What approving does" className="!border-axal-lavender-edge !bg-axal-lavender dark:!border-violet-800 dark:!bg-violet-950/40" testId="events-approving-does">
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-normal text-axal-ink marker:text-axal-violet dark:text-gray-100">
              {approveLines(ev).map((l) => <li key={l}>{l}</li>)}
            </ul>
          </Card>
          <div className={`${CARD} sticky bottom-0 flex flex-col gap-2 px-[18px] py-3 shadow-[0_-8px_24px_rgba(24,24,27,.06)]`} data-testid="events-review-actions">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <Link to={`/events/${ev.id}/manage`} className={LINK}>Open as host</Link>
              <span className="flex flex-wrap gap-2">
                <button type="button" className={actionGhost} onClick={() => setDialog('send')} data-testid="events-sendback">Send back</button>
                <button type="button" className={actionPrimary} onClick={() => setDialog('approve')} data-testid="events-approve">Approve and publish</button>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {dialog === 'approve' && ev ? <ApproveDialog ev={ev} busy={busy} refusal={refusal} onClose={close} onConfirm={approve} /> : null}
      {dialog === 'send' && ev ? <SendBackDialog ev={ev} busy={busy} refusal={refusal} onClose={close} onConfirm={sendBack} /> : null}
    </div>
  );
}
