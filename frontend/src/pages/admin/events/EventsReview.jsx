import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminEvents } from '../../../lib/api';
import { Unreadable, Unrecorded, actionGhost, actionPrimary } from '../../../ui';
import {
  CHANGED, NOTHING_WAITING, NOTHING_WAITING_SUB, QUEUE_CLAIM, approveLines, approvedLine, eventHref, readyList, refusalText,
  sentBackLine, titleOf,
} from './eventsDeskModel';
import {
  CLASH_CLAIM, COUNTING, DEFAULT_SORT, EMPTY_FILTERS, FIRST_TIME, HISTORY_CLAIM, NO_CLASH, PREVIEW_EYE, PREVIEW_FOOT,
  PRICE_CHOICES, REVIEW_SORTS, STARTS_CHOICES, clashesFor, compPreviewOf, countedApproveLines, filterCount, historyOf,
  previewOf, queueRowView, reviewFacts, reviewRows, roleChoices, stepSelection, typeChoices,
} from './reviewModel';
import { useReviewReads } from './useEventsDesk';
import { ApproveDialog, SendBackDialog } from './EventDialogs';
import { CARD, Card, Done, EYE, INPUT, LINK, Pill, Refusal, StatusPill, SUB } from './parts';

/**
 * D915 (#2368), completed by D921 (#2704) — Review (EV3, EV4, EV4b, EV5, EV15c,
 * EV17b, EV17c).
 *
 * The queue is D918's list with `status=pending_review`, every page of it:
 * searched by title, host and venture; filtered by type, host role, Free or
 * Paid and start; sorted Waiting longest (the default), Starts soonest or
 * Newest. J and K, or the arrow keys inside the queue, move the selection.
 *
 * The selected event draws its preview on the public calendar, its facts,
 * "What approving does" with line 3 counted from part 3's free-seat preview,
 * its Clashes (D915 §2's rule over every event) and its History (D918 §6).
 * Approve (EV4) and Send back (EV5) are dialogs; after either, one line
 * appears over the list, and no toast. D917's 409 says the event changed and
 * offers a reload; its 400 `reason_required` is drawn under the reason.
 *
 * Under the `lg` breakpoint the selected event opens as a full-screen sheet
 * (EV17c) with Send back and Approve and publish kept in view.
 */

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

function QueueRow({ view, selected, onSelect, buttonRef }) {
  return (
    <li>
      <button type="button" ref={buttonRef} onClick={onSelect} aria-current={selected ? 'true' : undefined} data-testid={`events-queue-row-${view.id}`}
        className={`flex min-h-[44px] w-full items-start gap-3 rounded-[10px] border px-3 py-2.5 text-left ${selected
          ? 'border-axal-lavender-edge border-l-[3px] border-l-axal-violet bg-axal-lavender dark:border-violet-800 dark:border-l-violet-400 dark:bg-violet-950/40'
          : 'border-transparent border-t-axal-hairline hover:bg-axal-ground dark:border-t-gray-800 dark:hover:bg-gray-800'}`}>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13.5px] font-bold leading-snug text-axal-ink dark:text-gray-100">{view.title}</span>
          <span className={SUB} data-testid={`events-queue-host-${view.id}`}>{view.host}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {view.type ? <Pill tone="violet">{view.type}</Pill> : null}
            <span className="text-[12px] text-axal-ink dark:text-gray-100">{view.when}</span>
            {view.flags.map((f) => <Pill key={f.label} tone={f.tone}>{f.label}</Pill>)}
          </span>
        </span>
        <span title={view.waitNote || undefined} data-testid={`events-queue-wait-${view.id}`}
          className={`whitespace-nowrap font-mono text-[11.5px] font-semibold ${view.overdue ? 'text-amber-800 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`}>
          {view.overdue ? <span aria-label="Overdue">● </span> : null}{view.wait}
        </span>
      </button>
    </li>
  );
}

function Choice({ label, value, onChange, choices, testId }) {
  return (
    <label className="flex flex-col">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} data-testid={testId}>
        {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
    </label>
  );
}

function Preview({ ev }) {
  const p = previewOf(ev);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid="events-review-preview">
      {p.cover
        ? <img src={p.cover} alt="" className="h-[120px] w-full rounded-[10px] border border-axal-hairline object-cover dark:border-gray-700" />
        : <div aria-hidden="true" className="h-[120px] rounded-[10px] border border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800" />}
      <span className={EYE}>{PREVIEW_EYE}</span>
      <div className="flex items-start gap-3">
        {p.date ? (
          <span className="flex w-[52px] flex-none flex-col items-center rounded-[8px] border border-axal-hairline py-1 dark:border-gray-700" data-testid="events-review-date">
            <span className="text-[10px] font-bold tracking-[.07em] text-axal-violet dark:text-violet-300">{p.date.m}</span>
            <span className="font-mono text-[18px] font-semibold leading-tight text-axal-ink dark:text-gray-100">{p.date.d}</span>
            <span className="text-[10px] font-bold tracking-[.07em] text-axal-muted dark:text-gray-400">{p.date.w}</span>
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="m-0 text-[16px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{p.title}</h2>
          <span className="flex flex-wrap items-center gap-1.5">
            {p.type ? <Pill tone="violet">{p.type}</Pill> : null}
            <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{p.place}</span>
          </span>
          <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">
            {p.lede ? `${p.lede} ` : null}{p.hostedBy}
          </p>
        </div>
      </div>
      <span className={SUB}>{PREVIEW_FOOT}</span>
    </section>
  );
}

function Facts({ ev }) {
  const [open, setOpen] = useState(false);
  const description = String(ev?.description || '').trim();
  return (
    <Card title="Facts" testId="events-review-facts">
      <dl className="m-0 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {reviewFacts(ev).map((f) => (
          <div key={f.key} className="flex min-w-0 flex-col gap-0.5" data-testid={`events-fact-${f.key}`}>
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

function Clashes({ clash, onRetry }) {
  const hit = clash.state === 'ready' && clash.items.length > 0;
  return (
    <Card title="Clashes" testId="events-review-clashes"
      className={hit ? '!border-amber-300 !bg-amber-50 dark:!border-amber-800 dark:!bg-amber-950/40' : ''}>
      {clash.state === 'loading' ? <span className={SUB}>Reading…</span> : null}
      {clash.state === 'unreadable' ? <Unreadable what="The other events" claim={CLASH_CLAIM} onRetry={onRetry} /> : null}
      {clash.state === 'ready' && !hit ? <p className={`m-0 ${SUB}`}>{NO_CLASH}</p> : null}
      {hit ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {clash.items.map((c) => (
            <li key={c.id} className="flex flex-col gap-1">
              <span className="flex gap-2.5 text-[13px] font-medium leading-normal text-axal-ink dark:text-gray-100">
                <span aria-hidden="true" className="font-extrabold text-amber-800 dark:text-amber-300">⇄</span>{c.line}
              </span>
              <span className={`${SUB} pl-6`}>{c.sub}</span>
              <Link to={eventHref(c.id)} className={`${LINK} self-start pl-6`}>{`Open ${c.title} ›`}</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function History({ history, onRetry }) {
  return (
    <Card title="History" testId="events-review-history">
      {history.state === 'loading' ? <span className={SUB}>Reading…</span> : null}
      {history.state === 'unreadable' ? <Unreadable what="The history" claim={HISTORY_CLAIM} onRetry={onRetry} /> : null}
      {history.state === 'ready' ? (
        <>
          {history.firstTime ? <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="events-history-first">{FIRST_TIME}</p> : null}
          {history.lines.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {history.lines.map((l) => (
                <li key={l.key} className="flex gap-2.5 text-[13px] leading-normal text-axal-ink dark:text-gray-100">
                  <span aria-hidden="true" className="w-4 flex-none text-center text-axal-muted dark:text-gray-400">{l.glyph}</span>{l.text}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default function EventsReview({ reads }) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [picked, setPicked] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  // D917's 409: drawn under the action bar (EV15c), with a reload.
  const [changed, setChanged] = useState(false);
  // `{ id, line, at }`: the event just decided, and when.
  const [done, setDone] = useState(null);
  const doneRef = useRef(null);
  const queueRef = useRef(null);
  const rowRefs = useRef(new Map());
  const backRef = useRef(null);
  useEffect(() => { if (done) doneRef.current?.focus?.(); }, [done]);

  // The Worker answers 409 to a second decision, but the event just decided
  // still stays out of the queue until a queue read newer than the decision
  // lands, so it is not offered twice in that gap.
  const now = Date.now();
  const read = readyList(reads.queue);
  const settling = Boolean(done) && (reads.queue.at || 0) < done.at;
  const list = read && settling ? read.filter((r) => String(r.id) !== String(done.id)) : read;
  const rows = list ? reviewRows(list, { q, filters, sort }, now) : [];
  const ev = rows.find((r) => String(r.id) === String(picked)) || rows[0] || null;

  const own = useReviewReads(ev ? ev.id : null, reads.tick);
  const history = historyOf(own.history);
  const preview = compPreviewOf(own.comp);
  const clash = clashesFor(ev, reads.all);
  const counted = ev ? countedApproveLines(approveLines(ev), ev, preview) : null;

  const select = (id, { open = false, focus = false } = {}) => {
    setPicked(id);
    setChanged(false);
    if (open) setSheet(true);
    if (focus) rowRefs.current.get(String(id))?.focus?.();
  };

  // J and K anywhere on the tab, the arrow keys inside the queue; never while typing or in a dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (dialog || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && sheet) { setSheet(false); return; }
      const target = e.target || {};
      if (TYPING.test(String(target.tagName || '').toUpperCase()) || target.isContentEditable) return;
      const inQueue = queueRef.current?.contains?.(document.activeElement);
      let delta = 0;
      if (e.key === 'j' || e.key === 'J' || (inQueue && e.key === 'ArrowDown')) delta = 1;
      if (e.key === 'k' || e.key === 'K' || (inQueue && e.key === 'ArrowUp')) delta = -1;
      if (!delta || !rows.length) return;
      e.preventDefault?.();
      select(stepSelection(rows, ev?.id, delta), { focus: inQueue });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (sheet) backRef.current?.focus?.(); }, [sheet]);

  const close = () => { if (!busy) { setDialog(null); setRefusal(null); setFieldError(null); } };

  /** A refused write: the 409 closes the dialog and says so under the bar; the rest stay in the dialog. */
  const refused = (e) => {
    setBusy(false);
    if (e?.code === 'not_waiting' || Number(e?.status) === 409) { setDialog(null); setRefusal(null); setChanged(true); return; }
    if (e?.code === 'reason_required') { setFieldError(refusalText(e)); return; }
    setRefusal(refusalText(e));
  };

  const decided = (line) => {
    setDone({ id: ev.id, line, at: Date.now() });
    setBusy(false); setDialog(null); setPicked(null); setSheet(false);
    reads.reload();
  };

  const approve = async ({ feature }) => {
    setBusy(true); setRefusal(null);
    try {
      await adminEvents.approve(ev.id);
    } catch (e) { refused(e); return; }
    let featureError = null;
    if (feature) {
      try { await adminEvents.feature(ev.id, true); } catch (e) { featureError = e; }
    }
    decided(approvedLine(ev, { featured: feature && !featureError, featureError }));
  };

  const sendBack = async (reason) => {
    setBusy(true); setRefusal(null); setFieldError(null);
    try {
      await adminEvents.reject(ev.id, reason);
    } catch (e) { refused(e); return; }
    decided(sentBackLine(ev));
  };

  const reload = () => { setChanged(false); reads.reload(); };
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const nFilters = filterCount(filters);

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" data-testid="events-review">
      <section ref={queueRef} className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="events-queue-h" data-testid="events-queue">
        {done ? (
          <Done focusRef={doneRef}>
            <span>{done.line}</span>
            <Link to={eventHref(done.id)} className={LINK}>Open event</Link>
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
                <span className="sr-only">Search title, host or venture</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, host or venture" className={INPUT} data-testid="events-queue-search" />
              </label>
              <button type="button" className={`${actionGhost} lg:hidden`} aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)} data-testid="events-queue-filters-toggle">
                {`Filters · ${nFilters}`}
              </button>
            </div>
            <div className={`flex flex-wrap gap-2 ${showFilters ? '' : 'max-lg:hidden'}`} data-testid="events-queue-filters">
              <Choice label="Type" value={filters.type} onChange={setFilter('type')} choices={typeChoices(list)} testId="events-queue-type" />
              <Choice label="Host role" value={filters.role} onChange={setFilter('role')} choices={roleChoices(list)} testId="events-queue-role" />
              <Choice label="Free or Paid" value={filters.price} onChange={setFilter('price')} choices={PRICE_CHOICES} testId="events-queue-price" />
              <Choice label="Starts" value={filters.starts} onChange={setFilter('starts')} choices={STARTS_CHOICES} testId="events-queue-starts" />
              <Choice label="Sort" value={sort} onChange={setSort} choices={REVIEW_SORTS.map((s) => ({ key: s.key, label: `Sort: ${s.label}` }))} testId="events-queue-sort" />
            </div>
            {rows.length ? (
              // A new sort draws the list afresh rather than moving its rows.
              <ul key={sort} className="m-0 flex list-none flex-col gap-1 p-0">
                {rows.map((r) => {
                  const selected = Boolean(ev) && String(ev.id) === String(r.id);
                  const view = queueRowView(r, now, selected && history.state === 'ready' ? history.sentBack : null);
                  return (
                    <QueueRow key={r.id} view={view} selected={selected} onSelect={() => select(r.id, { open: true })}
                      buttonRef={(n) => { if (n) rowRefs.current.set(String(r.id), n); else rowRefs.current.delete(String(r.id)); }} />
                  );
                })}
              </ul>
            ) : <p className={`m-0 ${SUB}`}>Nothing in the queue matches.</p>}
            <p className={`m-0 max-lg:hidden ${SUB}`}>J and K, or the arrow keys, move through the queue.</p>
          </>
        ) : null}
      </section>

      {ev ? (
        <div className={`min-w-0 flex-col gap-3.5 ${sheet
          ? 'flex max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:overflow-y-auto max-lg:bg-axal-ground max-lg:p-4 dark:max-lg:bg-gray-950'
          : 'hidden lg:flex'}`}
          role={sheet ? 'dialog' : undefined} aria-label={sheet ? titleOf(ev) : undefined} data-testid="events-review-event">
          <div className="flex flex-col gap-2 lg:hidden" data-testid="events-review-sheet-head">
            <button type="button" ref={backRef} className={`${LINK} min-h-[44px] self-start`} onClick={() => setSheet(false)} data-testid="events-review-back">‹ Review</button>
            <span className="text-[18px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{titleOf(ev)}</span>
            <span className="flex flex-wrap gap-1.5"><StatusPill status={ev.status} />{previewOf(ev).type ? <Pill tone="violet">{previewOf(ev).type}</Pill> : null}</span>
          </div>
          <Preview ev={ev} />
          <Facts ev={ev} />
          <Card title="What approving does" className="!border-axal-lavender-edge !bg-axal-lavender dark:!border-violet-800 dark:!bg-violet-950/40" testId="events-approving-does">
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-normal text-axal-ink marker:text-axal-violet dark:text-gray-100">
              {counted.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
            {preview.state === 'loading' && counted.delivery ? <span className={SUB}>{COUNTING}</span> : null}
            {counted.delivery ? <span className={SUB}>{counted.delivery}</span> : null}
          </Card>
          <Clashes clash={clash} onRetry={reads.reload} />
          <History history={history} onRetry={reads.reload} />
          <div className={`${CARD} sticky bottom-0 flex flex-col gap-2 px-[18px] py-3 shadow-[0_-8px_24px_rgba(24,24,27,.06)]`} data-testid="events-review-actions">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <Link to={`/events/${ev.id}/manage`} className={`${LINK} max-lg:hidden`}>Open as host</Link>
              <span className="flex flex-wrap gap-2 max-lg:w-full">
                <button type="button" className={`${actionGhost} max-lg:min-h-[44px] max-lg:flex-1`} onClick={() => setDialog('send')} data-testid="events-sendback">Send back</button>
                <button type="button" className={`${actionPrimary} max-lg:min-h-[44px] max-lg:flex-[1.4]`} onClick={() => setDialog('approve')} data-testid="events-approve">Approve and publish</button>
              </span>
            </div>
            {changed ? (
              <div className="flex flex-wrap items-center gap-2">
                <Refusal text={CHANGED} testId="events-review-changed" />
                <button type="button" className={LINK} onClick={reload} data-testid="events-review-reload">Reload</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {dialog === 'approve' && ev ? <ApproveDialog ev={ev} lines={counted.lines} delivery={counted.delivery} busy={busy} refusal={refusal} onClose={close} onConfirm={approve} /> : null}
      {dialog === 'send' && ev ? <SendBackDialog ev={ev} busy={busy} refusal={refusal} fieldError={fieldError} onClose={close} onConfirm={sendBack} /> : null}
    </div>
  );
}
