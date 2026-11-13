import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminEvents } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { actionGhost } from '../../../ui';
import { capacitySavedLine, eventHref, refusalText, summaryBlock, titleOf } from './eventsDeskModel';
import { CancelDialog, CapacityDialog, FeatureDialog, UnpublishDialog } from './EventDialogs';
import { CARD } from './parts';

/**
 * D1116 (#2996) — All events' per-row ⋯ menu (EV6, and EV17d's phone cards):
 * Open, Feature or Stop featuring, Change capacity, Unpublish (a published
 * event), Cancel event (one not cancelled already) and Open as host. Each
 * write opens the event page's own dialog (`EventDialogs.jsx`), which says
 * what it changes before anything is saved, and runs the same write.
 *
 * The menu is a disclosure, as the event page's ⋯ is: Escape closes it and
 * puts focus back on ⋯; a click or focus outside closes it.
 *
 * Change capacity counts from the row's own D918 counts (`counts`). Cancel
 * reads that one event's summary when it opens, for its paid tickets; until it
 * answers, a paid event says its tickets are still being counted and waits
 * for the refund box, as on the event page.
 */

const ITEM = 'block w-full rounded-[7px] px-2.5 py-2 text-left text-[13px] font-semibold text-axal-ink hover:bg-axal-ground max-sm:min-h-[44px] dark:text-gray-100 dark:hover:bg-gray-800';

/**
 * The items a row offers, in the canvas's order, by the event page's own rules
 * (`EventPage.jsx`): Unpublish only for a published event, Cancel only for one
 * not cancelled already.
 */
export function rowActions(ev) {
  const out = [{ key: 'open', label: 'Open' }];
  out.push({ key: 'feature', label: ev?.featured ? 'Stop featuring' : 'Feature' });
  out.push({ key: 'capacity', label: 'Change capacity' });
  if (ev?.status === 'published') out.push({ key: 'unpublish', label: 'Unpublish' });
  if (ev?.status !== 'cancelled') out.push({ key: 'cancel', label: 'Cancel event' });
  out.push({ key: 'host', label: 'Open as host' });
  return out;
}

export function RowMenu({ ev, onPick, testId }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const listId = useId();
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus?.(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const leave = (e) => { if (e.relatedTarget && wrap.current && !wrap.current.contains(e.relatedTarget)) setOpen(false); };
  const pick = (key) => { setOpen(false); onPick(key); };
  return (
    <div ref={wrap} onBlur={leave} className="relative">
      <button ref={button} type="button" aria-expanded={open} aria-controls={listId} aria-label={`More actions for ${titleOf(ev)}`}
        onClick={() => setOpen((o) => !o)} className={`${actionGhost} min-w-[36px] max-sm:min-h-[44px] max-sm:min-w-[44px]`} data-testid={testId}>⋯</button>
      {open ? (
        <div id={listId} className={`${CARD} absolute right-0 top-full z-20 mt-1.5 flex w-[220px] flex-col gap-0.5 p-1.5 shadow-[0_12px_30px_rgba(24,24,27,.14)]`} data-testid={`${testId}-list`}>
          {rowActions(ev).map((a) => (a.key === 'open' ? (
            <Link key={a.key} to={eventHref(ev.id)} className={ITEM} onClick={() => setOpen(false)} data-testid={`${testId}-open`}>{a.label}</Link>
          ) : a.key === 'host' ? (
            <Link key={a.key} to={`/events/${ev.id}/manage`} className={ITEM} onClick={() => setOpen(false)} data-testid={`${testId}-host`}>{a.label}</Link>
          ) : (
            <button key={a.key} type="button" className={ITEM} onClick={() => pick(a.key)} data-testid={`${testId}-${a.key}`}>{a.label}</button>
          )))}
        </div>
      ) : null}
    </div>
  );
}

/** That one event's summary, read only while Cancel is open, for its paid tickets. */
function usePayments(id, on) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    setRead({ status: 'loading', data: null });
    adminEvents.summary(id).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('admin-events:row-summary', e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [id, on]);
  return summaryBlock(read, 'payments');
}

/**
 * The dialog a row's menu opened. `onDone(line)` is called after the write
 * answered, with the sentence the page shows; a refusal stays in the dialog.
 */
export function RowDialog({ ev, kind, counts, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const payments = usePayments(ev.id, kind === 'cancel');
  const title = titleOf(ev);
  const close = () => { if (!busy) { setRefusal(null); onClose(); } };
  const run = async (write, line) => {
    setBusy(true); setRefusal(null);
    try {
      const reply = await write();
      onDone(typeof line === 'function' ? line(reply) : line);
    } catch (e) {
      setRefusal(refusalText(e));
    } finally {
      setBusy(false);
    }
  };
  if (kind === 'capacity') {
    return <CapacityDialog ev={ev} counts={counts} busy={busy} refusal={refusal} onClose={close}
      onConfirm={(value) => run(() => adminEvents.setCapacity(ev.id, value), (reply) => capacitySavedLine(reply?.promoted))} />;
  }
  if (kind === 'feature') {
    return <FeatureDialog ev={ev} busy={busy} refusal={refusal} onClose={close}
      onConfirm={(next) => run(() => adminEvents.feature(ev.id, next), next ? `${title} is featured.` : `${title} is no longer featured.`)} />;
  }
  if (kind === 'unpublish') {
    return <UnpublishDialog ev={ev} busy={busy} refusal={refusal} onClose={close}
      onConfirm={(note) => run(() => adminEvents.unpublish(ev.id, note), `${title} is back with its host as a draft. The host is told${note ? ', with your note' : ''}.`)} />;
  }
  if (kind === 'cancel') {
    return <CancelDialog ev={ev} payments={payments} busy={busy} refusal={refusal} onClose={close}
      onConfirm={(note) => run(() => adminEvents.cancel(ev.id, note), `${title} is cancelled.`)} />;
  }
  return null;
}
