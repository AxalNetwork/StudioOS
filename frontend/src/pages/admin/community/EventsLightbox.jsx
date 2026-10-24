import React, { useMemo, useState } from 'react';
import { adminEvents } from '../../../lib/api';
import { BoxShell, BoxTable, Failed, ListControls, Pager, Reading, useBoxRead } from './CommunityLightbox';
import { EVENTS, EVENTS_LINE, eventRow, eventsPage, eventsQuery, initialState } from './lightboxModel';

/**
 * D934 (#2718) — CM3, Events: D918's paged list (#2701), 25 rows a page. The
 * Worker searches (title, host or venture), filters, sorts and pages, and
 * each row carries its own seats taken, attended and waitlisted, so D915's
 * Guard G is retired here and no analytics read is made.
 *
 * Fill and show-up are D915's words through its own functions
 * (`eventsDeskModel.js`), so this lightbox and the Events desk cannot
 * disagree. The host's name the list carries is never drawn. A title opens
 * the event in the Events console (`/admin/events/:id`); nothing is changed
 * here.
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

export default function EventsLightbox({ onClose, now: at }) {
  const [now] = useState(() => at ?? Date.now());
  const [state, setState] = useState(() => initialState(EVENTS));
  const query = useMemo(() => eventsQuery(state), [state]);
  const { read, retry } = useBoxRead(() => adminEvents.list(query), 'box-events', JSON.stringify(query));
  const view = useMemo(() => (read.status === 'ready' ? eventsPage(read.data, state.page) : null), [read, state.page]);
  const failed = read.status === 'error' || (read.status === 'ready' && !view);
  const id = 'community-box-events';

  return (
    <BoxShell id={id} title={EVENTS.title} sub={EVENTS_LINE} onClose={onClose}>
      {(phone) => (
        <>
          <ListControls id={id} spec={EVENTS} state={state} setState={setState} phone={phone} />
          {read.status === 'loading' && <Reading id={id} />}
          {failed && <Failed id={id} reason="The events could not be read. That is not the same as no events." onRetry={retry} />}
          {view && (
            <>
              <BoxTable id={id} cols={COLS} phone={phone} empty="No event matches."
                rows={view.rows.map((ev) => { const r = eventRow(ev, now); return { ...r, badge: r.featured ? 'Featured' : null }; })}
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
