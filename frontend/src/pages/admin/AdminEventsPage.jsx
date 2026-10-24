// D915 (#2368) — the admin Events desk, built to the owner's "Events Console"
// canvas (EV1–EV17) from the reads that exist. This file is the routed page
// at `/admin/events`, `/admin/events/review`, `/admin/events/all` and
// `/admin/events/:id` (one `guard(['admin'])` route each in App.jsx), and the
// desk's shell: the crumb, the header, the tab strip, then the tab the address
// names. The tabs, their model and their reads live in `events/` (see its
// README). Worker-only surface (`/api/admin/events/*`): the dev FastAPI does
// not implement it, so expect failed reads in the dev preview, each saying so.
import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { actionGhost } from '../../ui';
import AdminBoardFrame from './AdminBoardFrame';
import EventPage from './events/EventPage';
import EventsAll from './events/EventsAll';
import EventsOverview from './events/EventsOverview';
import EventsReview from './events/EventsReview';
import { useEventsDesk } from './events/useEventsDesk';
import {
  COULD_NOT_READ, LINE, READING, SCOPE_LABEL, SCOPE_TITLE, TITLE, clockLabel, eventIdFor, readyList, tabFor,
} from './events/eventsDeskModel';

const CRUMB = 'font-mono text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const CRUMB_LINK = 'text-axal-muted hover:text-axal-violet dark:text-gray-400 dark:hover:text-violet-300';

function DeskTab({ to, end = false, testId, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      className={({ isActive }) => `-mb-px inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-[13px] ${isActive
        ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
        : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
    >
      {children}
    </NavLink>
  );
}

/**
 * The tab strip (EV1). THE THREE PATHS ARE WRITTEN OUT, not mapped from
 * `TABS`, because the reachability walk (`admin_route_reachability.test.mjs`)
 * counts a literal `to="…"` as a door, as on Licences (D800);
 * `admin_events_desk_d915.test.mjs` holds the two lists equal. Review carries
 * an amber count when anything waits. On one event's page no tab is selected.
 * Calendar joins with D915 part 4.
 */
function DeskTabs({ waiting }) {
  return (
    <nav aria-label="Events desk" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]" data-testid="events-tabs">
      <div className="flex gap-[22px] border-b border-axal-hairline dark:border-gray-700">
        <DeskTab to="/admin/events" end testId="events-tab-overview">Overview</DeskTab>
        <DeskTab to="/admin/events/review" testId="events-tab-review">
          Review
          {waiting > 0 ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-[7px] font-mono text-[10.5px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="events-tab-review-count">
              {waiting.toLocaleString('en-US')}
            </span>
          ) : null}
        </DeskTab>
        <DeskTab to="/admin/events/all" testId="events-tab-all">All events</DeskTab>
      </div>
    </nav>
  );
}

function AdminEventsPageBody() {
  const { pathname } = useLocation();
  const tab = tabFor(pathname);
  const eventId = eventIdFor(pathname);
  const reads = useEventsDesk(tab, eventId);
  const now = Date.now();
  const waiting = readyList(reads.queue)?.length || 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="events-desk">
      <nav aria-label="Breadcrumb" className={CRUMB} data-testid="events-crumb">
        {tab === 'event'
          ? <Link to="/admin/events/all" className={CRUMB_LINK}>‹ All events</Link>
          : <><Link to="/admin/community" className={CRUMB_LINK}>Community</Link> › Events</>}
      </nav>

      {tab !== 'event' ? (
        <header className="flex flex-wrap items-start justify-between gap-3" data-testid="events-header">
          <div className="flex min-w-0 flex-col gap-[7px]">
            <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h1>
            <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400">{LINE}</p>
            <span title={SCOPE_TITLE} className="cursor-help self-start rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="events-scope-chip">{SCOPE_LABEL}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/events/new" className={actionGhost} data-testid="events-new">New event</Link>
            <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="events-asof">{reads.asOf ? `Updated ${clockLabel(reads.asOf)}` : reads.reading ? READING : COULD_NOT_READ}</span>
            <button type="button" aria-label="Refresh" onClick={reads.reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="events-refresh">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
      ) : null}

      <DeskTabs waiting={waiting} />

      {tab === 'overview' ? <EventsOverview reads={reads} now={now} /> : null}
      {tab === 'review' ? <EventsReview reads={reads} /> : null}
      {tab === 'all' ? <EventsAll reads={reads} now={now} /> : null}
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
