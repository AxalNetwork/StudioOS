import { useCallback, useEffect, useState } from 'react';
import { adminEvents, events as eventsApi } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { PAGE_LIMIT, isEventId, readEveryPage } from './eventsDeskModel';

/**
 * D915 (#2368) — the desk's reads, each made alone so one that fails leaves
 * the others answering (D915 §2):
 *   queue      R1 with `status=pending_review`, every page: the Review tab and
 *              the tab strip's count;
 *   all        R1, every page: Overview and All events;
 *   analytics  R2's per-event rows, joined under Guard G by the model;
 *   event      R3, one event's page;
 *   agenda     R5, that event's agenda.
 * A read is made only on the tabs that draw it. `reload()` reads them again
 * after a write; a read that already answered keeps its rows on screen until
 * the new answer lands, so a refresh never blanks the page.
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

export function useEventsDesk(tab, eventId) {
  const [tick, setTick] = useState(0);
  const wantAll = tab === 'overview' || tab === 'all';
  const wantEvent = tab === 'event' && isEventId(eventId);
  const queue = useRead('queue', 'queue', tick, true, () => pages('pending_review'));
  const all = useRead('list', 'all', tick, wantAll, () => pages(undefined));
  const analytics = useRead('analytics', 'analytics', tick, wantAll || wantEvent, () => adminEvents.analytics());
  const event = useRead('event', `event:${eventId}`, tick, wantEvent, () => adminEvents.get(eventId));
  const agenda = useRead('agenda', `agenda:${eventId}`, tick, wantEvent, () => eventsApi.agenda(eventId));
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const asOf = Math.max(0, ...[queue, all, analytics, event, agenda].map((r) => r.at || 0)) || null;
  return { queue, all, analytics, event, agenda, reload, asOf };
}
