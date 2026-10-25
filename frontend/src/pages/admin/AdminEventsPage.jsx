// D915 (#2368) — the admin Events desk, built to the owner's "Events Console"
// canvas (EV1–EV17) from the reads that exist. This file is the routed page
// at `/admin/events`, `/admin/events/review`, `/admin/events/all`,
// `/admin/events/calendar` (D919) and `/admin/events/:id` (one `guard(['admin'])` route each in App.jsx), and the
// desk's shell: the shared admin header (D936, D938) with its crumb and tab
// strip, then the tab the address names. The tabs, their model and their reads live in `events/` (see its
// README). Worker-only surface (`/api/admin/events/*`): the dev FastAPI does
// not implement it, so expect failed reads in the dev preview, each saying so.
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminPageHeader, HeaderTab, actionGhost } from '../../ui';
import AdminBoardFrame from './AdminBoardFrame';
import EventPage from './events/EventPage';
import EventsAll from './events/EventsAll';
import EventsCalendar from './events/EventsCalendar';
import EventsOverview from './events/EventsOverview';
import EventsReview from './events/EventsReview';
import { useEventsDesk } from './events/useEventsDesk';
import {
  COULD_NOT_READ, LINE, READING, TITLE, clockLabel, eventIdFor, readyList, tabFor,
} from './events/eventsDeskModel';

const CRUMB = 'font-mono text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const CRUMB_LINK = 'text-axal-muted hover:text-axal-violet dark:text-gray-400 dark:hover:text-violet-300';

/**
 * The tab strip (EV1). THE FOUR PATHS ARE WRITTEN OUT, not mapped from
 * `TABS`, because the reachability walk (`admin_route_reachability.test.mjs`)
 * counts a literal `to="…"` as a door, as on Licences (D800);
 * `admin_events_desk_d915.test.mjs` holds the two lists equal. Review carries
 * an amber count when anything waits. On one event's page no tab is selected.
 * Calendar joined with D915 part 4 (D919, #2702). D938: they are the shared
 * header's `HeaderTab`s (D936), drawn in its tab bar.
 */
function DeskTabs({ waiting }) {
  return (
    <>
      <HeaderTab to="/admin/events" end data-testid="events-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/admin/events/review" data-testid="events-tab-review">
        Review
        {waiting > 0 ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-[7px] font-mono text-[10.5px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="events-tab-review-count">
            {waiting.toLocaleString('en-US')}
          </span>
        ) : null}
      </HeaderTab>
      <HeaderTab to="/admin/events/all" data-testid="events-tab-all">All events</HeaderTab>
      <HeaderTab to="/admin/events/calendar" data-testid="events-tab-calendar">Calendar</HeaderTab>
    </>
  );
}

function AdminEventsPageBody() {
  const { pathname, search } = useLocation();
  const tab = tabFor(pathname);
  const [weeks, setWeeks] = useState(12);
  const eventId = eventIdFor(pathname);
  // D919: "Cancelled with paid tickets" is the one view that needs the overview read.
  const reads = useEventsDesk(tab, eventId, { paidView: new URLSearchParams(search).get('view') === 'paid_cancelled', weeks });
  const now = Date.now();
  const waiting = readyList(reads.queue)?.length || 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="events-desk">
      {tab === 'event' ? (
        <>
          <nav aria-label="Breadcrumb" className={CRUMB} data-testid="events-crumb">
            <Link to="/admin/events/all" className={CRUMB_LINK}>‹ All events</Link>
          </nav>
          <nav aria-label="Events desk" className="-mb-px flex gap-5 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" data-testid="events-tabs">
            <DeskTabs waiting={waiting} />
          </nav>
        </>
      ) : (
        <AdminPageHeader
          crumb={{ to: '/admin/community', label: 'Community', current: 'Events' }}
          title={TITLE}
          line={LINE}
          scope
          actions={(
            <>
              <Link to="/events/new" className={actionGhost} data-testid="events-new">New event</Link>
              <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="events-asof">{reads.asOf ? `Updated ${clockLabel(reads.asOf)}` : reads.reading ? READING : COULD_NOT_READ}</span>
              <button type="button" aria-label="Refresh" onClick={reads.reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="events-refresh">
                <RefreshCw size={16} aria-hidden="true" />
              </button>
            </>
          )}
          tabs={<DeskTabs waiting={waiting} />}
          data-testid="events-header"
        />
      )}

      {tab === 'overview' ? <EventsOverview reads={reads} now={now} weeks={weeks} onWeeks={setWeeks} /> : null}
      {tab === 'review' ? <EventsReview reads={reads} /> : null}
      {tab === 'all' ? <EventsAll reads={reads} now={now} /> : null}
      {tab === 'calendar' ? <EventsCalendar reads={reads} now={now} /> : null}
      {tab === 'event' ? <EventPage key={eventId} id={eventId} reads={reads} now={now} /> : null}
    </div>
  );
}

// D774 (#2100): S15 drew no rail. The board's page, in the Admin boards' frame.
export default function AdminEventsPage() {
  return (
    <AdminBoardFrame workspace="Events" note="Eadwyn reads the events listed here. An event is approved or published only when you do it." data-testid="admin-board-events">
      <AdminEventsPageBody />
    </AdminBoardFrame>
  );
}
