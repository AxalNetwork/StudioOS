import { useCallback, useEffect, useState } from 'react';
import { adminEvents, events as eventsApi } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { PAGE_LIMIT, isEventId, readEveryPage } from './eventsDeskModel';

/**
 * D915 (#2368) — the desk's reads, each made alone so one that fails leaves
 * the others answering (D915 §2):
 *   queue      R1 with `status=pending_review`, every page: the Review tab and
 *              the tab strip's count;
 *   all        R1, every page: Overview, All events and Calendar, and
 *              Review's Clashes card (D921), which needs every event's times;
 *   analytics  R2's per-event rows, joined under Guard G by the model;
 *   event      R3, one event's page;
 *   agenda     R5, that event's agenda;
 *   paid       D918's `GET /api/admin/events/overview`, only while All events
 *              shows "Cancelled with paid tickets" (D919): its needs_attention
 *              items are the one read that counts paid tickets per event.
 * D921 adds `useReviewReads`, the selected review event's history and its
 * free-seat preview, read for that one event only.
 * A read is made only on the tabs that draw it. `reload()` reads them again
 * after a write; a read that already answered keeps its rows on screen until
 * the new answer lands, so a refresh never blanks the page.
 *
 * R2 and the queue are read again whenever the list (R1) is switched on or
 * off, so coming back from an event's page re-reads all three together and
 * Guard G never joins a fresh list to old counts. `asOf` is the OLDEST answer
 * among the reads the tab draws, so "Updated" is never newer than what is on
 * screen; `reading` is true only while one of those reads is still loading.
 */

const idle = { status: 'loading', data: null, error: null, at: null, what: null };

/** One read. `what` names what it reads (a new `what` starts from loading); `tick` reads it again. */
function useRead(scope, what, tick, enabled, load) {
  const [read, setRead] = useState(idle);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setRead((r) => (r.status === 'ready' && r.what === what ? r : idle));
    Promise.resolve().then(load).then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null, at: Date.now(), what }); },
      (error) => {
        reportError(`admin-events:${scope}`, error);
        if (live) setRead({ status: 'error', data: null, error, at: null, what });
      },
    );
    return () => { live = false; };
    // `load` is rebuilt on every render; `what` and `tick` say when to call it.
  }, [what, tick, enabled]);
  return read;
}

const pages = (status) => readEveryPage((offset) => adminEvents.list({ status, limit: PAGE_LIMIT, offset }));

export function useEventsDesk(tab, eventId, { paidView = false } = {}) {
  const [tick, setTick] = useState(0);
  const wantAll = tab === 'overview' || tab === 'all' || tab === 'calendar';
  const wantList = wantAll || tab === 'review';
  const wantEvent = tab === 'event' && isEventId(eventId);
  const withList = `${tick}:${wantList}`;
  const queue = useRead('queue', 'queue', withList, true, () => pages('pending_review'));
  const all = useRead('list', 'all', tick, wantList, () => pages(undefined));
  const analytics = useRead('analytics', 'analytics', withList, wantAll || wantEvent, () => adminEvents.analytics());
  const event = useRead('event', `event:${eventId}`, tick, wantEvent, () => adminEvents.get(eventId));
  const agenda = useRead('agenda', `agenda:${eventId}`, tick, wantEvent, () => eventsApi.agenda(eventId));
  const wantPaid = tab === 'all' && paidView;
  const paid = useRead('overview', 'paid', withList, wantPaid, () => adminEvents.overview());
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // The queue is drawn on every tab: the tab strip's Review count.
  const drawn = [[queue, true], [all, wantList], [analytics, wantAll || wantEvent], [event, wantEvent], [agenda, wantEvent], [paid, wantPaid]]
    .filter(([, on]) => on).map(([r]) => r);
  const stamps = drawn.map((r) => r.at).filter(Boolean);
  const asOf = stamps.length ? Math.min(...stamps) : null;
  const reading = drawn.some((r) => r.status === 'loading');
  return { queue, all, analytics, event, agenda, paid, reload, asOf, reading, tick };
}

/**
 * D921 — the selected review event's own reads: its history (D918 §6) and what
 * approving it would invite (D918 §7). `tick` is the desk's, so they are read
 * again with everything else after a write.
 */
export function useReviewReads(id, tick) {
  const on = isEventId(id);
  const history = useRead('history', `history:${id}`, tick, on, () => adminEvents.history(id));
  const comp = useRead('comp-preview', `comp:${id}`, tick, on, () => adminEvents.compPreview(id));
  return { history, comp };
}
