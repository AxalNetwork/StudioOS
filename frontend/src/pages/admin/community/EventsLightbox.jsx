import React, { useMemo, useState } from 'react';
import { adminEvents } from '../../../lib/api';
import { readEveryPage } from '../events/eventsDeskModel';
import { BoxShell, BoxTable, Failed, ListControls, Pager, Reading, SUB, useBoxRead } from './CommunityLightbox';
import { EVENTS, EVENTS_LINE, analyticsJoin, eventRow, initialState, listView } from './lightboxModel';

/**
 * D934 (#2718) — CM3, Events: every event, searched, filtered, sorted and
 * paged, 25 rows a page. A title opens the event in the Events console
 * (`/admin/events/:id`); nothing is changed here.
 *
 * Two reads, each answering alone:
 *   - `GET /api/admin/events`, every page and every status. Its failure is
 *     the lightbox's: there is no list to draw.
 *   - `GET /api/admin/events/analytics`, its rows only, under D915's Guard G.
 *     Its failure costs only the counts, which say "Could not be read"; an
 *     event missing from its 200 rows says "Not in this read". Neither is 0.
 * Fill and show-up are D915's (`eventsDeskModel.js`), so this lightbox and the
 * Events desk cannot disagree.
 */

const COLS = [
  { key: 'title', label: 'Title' },
  { key: 'type', label: 'Type' },
  { key: 'starts', label: 'Starts', mono: true },
  { key: 'status', label: 'Status' },
  { key: 'capacity', label: 'Capacity', mono: true },
  { key: 'registered', label: 'Registered', mono: true },
  { key: 'attended', label: 'Attended', mono: true },
  { key: 'waitlisted', label: 'Waitlisted', mono: true },
  { key: 'fill', label: 'Fill', mono: true },
  { key: 'showUp', label: 'Show-up', mono: true },
];

const loadEvents = () => readEveryPage((offset) => adminEvents.list({ limit: 200, offset }));
const loadAnalytics = () => adminEvents.analytics();

export default function EventsLightbox({ onClose, now: at }) {
  const [now] = useState(() => at ?? Date.now());
  const { read: list, retry: retryList } = useBoxRead(loadEvents, 'box-events');
  const { read: analytics, retry: retryCounts } = useBoxRead(loadAnalytics, 'box-events-analytics');
  const retry = () => { retryList(); retryCounts(); };
  const [state, setState] = useState(() => initialState(EVENTS));
  const join = useMemo(() => analyticsJoin(analytics, list.status === 'ready' ? list.data.length : 0), [analytics, list]);
  const view = useMemo(() => (list.status === 'ready' ? listView(EVENTS, list.data, state, { now, join }) : null), [list, state, now, join]);
  const id = 'community-box-events';

  return (
    <BoxShell id={id} title={EVENTS.title} sub={EVENTS_LINE} onClose={onClose}>
      {(phone) => (
        <>
          <ListControls id={id} spec={EVENTS} state={state} setState={setState} phone={phone} />
          {list.status === 'loading' && <Reading id={id} />}
          {list.status === 'error' && <Failed id={id} reason="The events could not be read. That is not the same as no events." onRetry={retry} />}
          {view && (
            <>
              {join.state === 'unreadable' ? <p className={`${SUB} px-5 pt-3`} role="status" data-testid={`${id}-counts-unreadable`}>Registrations could not be read. That is not a claim that nobody registered.</p> : null}
              <BoxTable id={id} cols={COLS} phone={phone} empty="No event matches."
                rows={view.rows.map((ev) => { const r = eventRow(ev, join, now); return { ...r, badge: r.featured ? 'Featured' : null }; })}
                phoneLine={(r) => `${r.starts} · ${r.type} · ${r.status}`}
                phoneValue={(r) => (r.capacity === 'No cap' ? `${r.registered} · no cap` : `${r.registered} / ${r.capacity}`)} />
              <Pager id={id} view={view} none={EVENTS.none} onPage={(page) => setState((s) => ({ ...s, page }))} />
            </>
          )}
        </>
      )}
    </BoxShell>
  );
}
