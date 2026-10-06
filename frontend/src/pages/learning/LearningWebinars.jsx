import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Video } from 'lucide-react';
import { Pill, RailFrame, Unrecorded, WorkerRail } from '../../ui';
import { reportError } from '../../lib/log';
import WebinarPanel from './WebinarPanel';
import { LearningEmpty, LearningHeader, LearningLoading, LearningUnreadable, SectionCard } from './LearningStates';
import { statusOf } from './LearningWired';
import { webinarPhase } from './learningModel';
import {
  capacityLabel, formatWebinarDayTime, formatWebinarWhen, matchesWebinar, nextRereadAt, seatsOf,
} from './webinarModel';
import { cancelRegistration, readWebinar, readWebinars, registerForWebinar } from './webinarReads';
import useLearningRead from './useLearningRead';

/**
 * Webinars for the member (D560, #1161; drawn by D562): the webinar page, the
 * Webinars tab's two lists, and the home's "Upcoming webinars". Each is a pure
 * view drawn from a read's state, plus a container that makes the read. The
 * coming-soon gate is applied before any of them is mounted
 * (`LearningPage.jsx`, `LearningHome.jsx`), so a gated profile never reads.
 */

const WEBINARS = { to: '/learning?tab=webinars', label: 'Webinars' };
const ROW_TITLE = 'text-[14px] font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300';
const ROW_META = 'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-axal-muted dark:text-gray-400';
const ACTION = 'inline-flex flex-none items-center gap-1 text-[12.5px] font-semibold text-axal-violet-deep hover:text-axal-violet dark:text-violet-300';
const isLoading = (state) => !state || state.status === 'loading' || state.status === 'idle';
/** `GET /api/learning/webinars` answers at most this many rows (its `LIMIT 100`). */
export const WEBINAR_LIST_CAP = 100;

/** The clock, a tick at a time, so a page left open moves from upcoming to live to past. */
function useNow(every) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

// ── /learning/webinars/:slug ──────────────────────────────────────────────

/** What the rail says the page loaded: only what the read returned. */
export function webinarCoverage(state) {
  if (state?.status !== 'ready') return [];
  const seats = seatsOf(state.webinar);
  return [
    `One webinar: “${state.webinar.title}”`,
    seats.count !== null ? `${seats.count} registered${typeof seats.limit === 'number' ? ` of ${seats.limit} seats` : ''}` : null,
    state.registration?.registered ? 'You are registered' : null,
  ].filter(Boolean);
}

/**
 * The webinar page's body from the read's state (`readWebinar`). A 404 (no
 * such webinar, or one this member may not see: the route answers both alike)
 * is the panel's empty state.
 */
export function WebinarView({ state, now, locale, timeZone, onRegister, onUnregister, busy, actionError, onRetry }) {
  const ready = state.status === 'ready';
  return (
    <WebinarPanel
      status={statusOf(state)}
      webinar={ready ? state.webinar : null}
      registration={ready ? state.registration : null}
      recording={ready ? state.recording : null}
      icsHref={ready ? state.icsHref : null}
      now={now}
      locale={locale}
      timeZone={timeZone}
      onRegister={onRegister}
      onUnregister={onUnregister}
      busy={busy}
      actionError={actionError}
      onRetry={onRetry}
    />
  );
}

/**
 * `/learning/webinars/:slug` (the segment carries the uid, D562 departure 8):
 * the container. It reads the webinar, registers and cancels, and reads again
 * as the join window opens, at the start and at the end, so the join link and
 * the recording arrive on a page left open. A refusal is shown in the route's
 * own words, and the webinar is read again behind it, so "This webinar is
 * full." comes with the seats that say so.
 */
export function WebinarPage({ uid }) {
  const [state, retry, setState] = useLearningRead(() => readWebinar(uid), [uid], { scope: 'webinar' });
  const now = useNow(30 * 1000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const webinar = state.status === 'ready' ? state.webinar : null;

  // Quietly: a refresh never draws "loading" over a page being read.
  const refresh = useCallback(() => readWebinar(uid).then(
    (fresh) => setState({ status: 'ready', ...fresh }),
    (err) => reportError('Learning:webinar-refresh', err),
  ), [uid, setState]);

  const rereadAt = webinar ? nextRereadAt(webinar, now) : null;
  useEffect(() => {
    if (rereadAt === null) return undefined;
    const t = setTimeout(refresh, Math.max(0, rereadAt - Date.now()) + 1000);
    return () => clearTimeout(t);
  }, [rereadAt, refresh]);

  const act = async (write) => {
    setBusy(true);
    setActionError('');
    try {
      const fresh = await write(uid);
      setState({ status: 'ready', ...fresh });
    } catch (err) {
      setActionError(err?.message || 'Your registration could not be saved.');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Learning"
          // Violet, the founder accent, as on every learner page of the canvas.
          role="founder"
          stance="Read-only learning view"
          note="Eadwyn reads back what this page has loaded, on a click. It does not register you, cancel a registration or join for you."
          coverage={webinarCoverage(state)}
        />
      )}
      data-testid="learning-webinar"
    >
      <div className="space-y-4">
        <LearningHeader eyebrow="Learning · Webinar" title={webinar?.title || 'Webinar'} back={WEBINARS} />
        <WebinarView
          state={state}
          now={now}
          onRegister={() => act(registerForWebinar)}
          onUnregister={() => act(cancelRegistration)}
          busy={busy}
          actionError={actionError}
          onRetry={retry}
        />
      </div>
    </RailFrame>
  );
}

// ── The Webinars tab ──────────────────────────────────────────────────────

/** What a row says about where it stands, from the route's fields and the clock. */
function RowPills({ row, phase }) {
  const seats = seatsOf(row);
  return (
    <>
      {phase === 'live' && <Pill tone="danger" dot>Live</Pill>}
      {phase === 'cancelled' && <Pill tone="danger">Cancelled</Pill>}
      {row.registered && phase !== 'cancelled' && <Pill tone="info">Registered</Pill>}
      {seats.full && !row.registered && phase !== 'cancelled' && phase !== 'past' && <Pill tone="neutral">Full</Pill>}
    </>
  );
}

const LIST_COPY = {
  upcoming: {
    what: 'The upcoming webinars', claim: 'This is not a claim that none is scheduled.',
    empty: ['No webinar scheduled', 'Webinars HQ schedules appear here, with a way to register.'],
  },
  past: {
    what: 'The past webinars', claim: 'This is not a claim that none has taken place.',
    empty: ['No past webinar', 'A webinar appears here once it has ended, with its recording when one is attached.'],
  },
};

/**
 * One list from `GET /api/learning/webinars?when=…`, kept whole: upcoming
 * (live ones included) with the calendar file, or past with the recording or
 * the route's reason it is not there. A list never carries a join link: the
 * webinar's page is where a registered member joins.
 */
export function WebinarList({ state, when = 'upcoming', q = '', now = Date.now(), locale, timeZone, onRetry }) {
  const copy = LIST_COPY[when] || LIST_COPY.upcoming;
  if (isLoading(state)) return <LearningLoading rows={3} what={copy.what.toLowerCase()} />;
  if (state.status !== 'ready') return <LearningUnreadable what={copy.what} claim={copy.claim} onRetry={onRetry} />;
  const rows = (state.rows || []).filter((r) => matchesWebinar(r, q));
  if (!rows.length) {
    return q
      ? <LearningEmpty title={`No ${when === 'past' ? 'past' : 'upcoming'} webinar matches “${q}”`} body="Try another word, or clear the search." />
      : <LearningEmpty title={copy.empty[0]} body={copy.empty[1]} />;
  }
  const opts = { locale, timeZone };
  // A list the route cut at its cap says so, rather than passing for every webinar there is.
  const capped = (state.rows || []).length >= WEBINAR_LIST_CAP;
  return (
    <div>
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid={`list-webinars-${when}`}>
        {rows.map((w) => {
          const phase = webinarPhase(w, now);
          const seats = seatsOf(w);
          return (
            <li key={w.uid} className="flex flex-col gap-1.5 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4" data-testid="row-webinar">
              <div className="min-w-0">
                <p className="text-[12px] tabular-nums text-axal-muted dark:text-gray-400">{formatWebinarWhen(w.starts_at, opts) || <Unrecorded>Start not recorded</Unrecorded>}</p>
                {w.href
                  ? <Link to={w.href} className={ROW_TITLE} data-testid="link-webinar-row">{w.title || 'Untitled webinar'}</Link>
                  : <span className="text-[14px] font-semibold text-axal-ink dark:text-gray-100">{w.title || 'Untitled webinar'}</span>}
                <p className={ROW_META}>
                  <RowPills row={w} phase={phase} />
                  <span>Host {w.host_name || <Unrecorded>not recorded</Unrecorded>}</span>
                  <span aria-hidden="true">·</span>
                  <span>{capacityLabel(seats) || <Unrecorded>capacity not recorded</Unrecorded>}</span>
                  <span aria-hidden="true">·</span>
                  <span>{seats.count !== null ? `${seats.count} registered` : <Unrecorded>registrations not recorded</Unrecorded>}</span>
                </p>
              </div>
              {when === 'past' ? <PastRecording recording={w.recording} /> : (
                phase !== 'cancelled' && w.icsHref && (
                  <a href={w.icsHref} download className={ACTION} data-testid="link-webinar-row-ics">
                    <CalendarPlus size={14} aria-hidden="true" /> Add to calendar
                  </a>
                )
              )}
            </li>
          );
        })}
      </ul>
      {capped && (
        <p className="mt-3 border-t border-axal-hairline pt-3 text-[11.5px] text-axal-faint dark:border-gray-800 dark:text-gray-500" data-testid={`text-webinars-${when}-cap`}>
          {when === 'past'
            ? `The newest ${WEBINAR_LIST_CAP} past webinars. The list stops at ${WEBINAR_LIST_CAP}, so older ones are not shown here.`
            : `The next ${WEBINAR_LIST_CAP} webinars. The list stops at ${WEBINAR_LIST_CAP}, so later ones are not shown here.`}
        </p>
      )}
    </div>
  );
}

/** A past row's recording: the route's link, or the route's reason. */
function PastRecording({ recording }) {
  if (recording?.available && typeof recording.href === 'string' && recording.href.startsWith('/learning/')) {
    return (
      <Link to={recording.href} className={ACTION} data-testid="link-webinar-row-recording">
        <Video size={14} aria-hidden="true" /> Watch the recording
      </Link>
    );
  }
  return (
    <span className="flex-none text-[12px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-row-recording">
      {recording?.reason || <Unrecorded />}
    </span>
  );
}

/**
 * The Webinars tab: upcoming and live first, then past with recordings, each
 * from its own read. One list failing names itself and blanks nothing else.
 *
 *   upcoming, past   `readWebinars('upcoming')` and `readWebinars('past')` states
 *   q                the home's settled search; the route takes no query
 */
export function WebinarsTabPanel({ upcoming, past, q = '', now = Date.now(), locale, timeZone, onRetry = {} }) {
  const shared = { q, now, locale, timeZone };
  return (
    <div className="space-y-5" data-testid="webinars-tab">
      <section aria-labelledby="webinars-upcoming-title" className="space-y-2">
        <h3 id="webinars-upcoming-title" className="text-[12px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">Upcoming and live</h3>
        <WebinarList state={upcoming} when="upcoming" onRetry={onRetry.upcoming} {...shared} />
      </section>
      <section aria-labelledby="webinars-past-title" className="space-y-2">
        <h3 id="webinars-past-title" className="text-[12px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">Past, with recordings</h3>
        <WebinarList state={past} when="past" onRetry={onRetry.past} {...shared} />
      </section>
    </div>
  );
}

/** The Webinars tab with its own two reads, for a home that mounts it while the tab is open. */
export function WebinarsTab({ q = '' }) {
  const now = useNow(60 * 1000);
  const [upcoming, retryUpcoming] = useLearningRead(() => readWebinars('upcoming'), [], { scope: 'webinars-upcoming' });
  const [past, retryPast] = useLearningRead(() => readWebinars('past'), [], { scope: 'webinars-past' });
  return <WebinarsTabPanel upcoming={upcoming} past={past} q={q} now={now} onRetry={{ upcoming: retryUpcoming, past: retryPast }} />;
}

// ── The home's "Upcoming webinars" ────────────────────────────────────────

/** The right-hand side of a row: register, or where it stands. */
function UpcomingAction({ row, phase }) {
  if (phase === 'cancelled') return <Pill tone="danger">Cancelled</Pill>;
  if (row.registered) return <Pill tone="info">Registered</Pill>;
  if (seatsOf(row).full) return <Pill tone="neutral">Full</Pill>;
  return row.href ? <Link to={row.href} className={ACTION} data-testid="link-upcoming-register">Register →</Link> : null;
}

/**
 * "Upcoming webinars" on the home: the next few from `readWebinars('upcoming')`,
 * each with its date and time in the viewer's zone and a way to register on
 * its page, and a link to the Webinars tab.
 */
export function UpcomingWebinarsList({ state, limit = 3, now = Date.now(), locale, timeZone, onRetry }) {
  if (isLoading(state)) return <LearningLoading rows={3} what="the upcoming webinars" />;
  if (state.status !== 'ready') return <LearningUnreadable what="The upcoming webinars" claim="This is not a claim that none is scheduled." onRetry={onRetry} />;
  const all = state.rows || [];
  if (!all.length) return <LearningEmpty title="No webinar scheduled" body="Webinars HQ schedules appear here, with a way to register." />;
  const rows = all.slice(0, limit);
  const opts = { locale, timeZone };
  return (
    <div data-testid="list-upcoming-webinars">
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
        {rows.map((w) => {
          const phase = webinarPhase(w, now);
          return (
            <li key={w.uid} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5 first:pt-0" data-testid="row-upcoming-webinar">
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="whitespace-nowrap text-[12px] tabular-nums text-axal-muted dark:text-gray-400">
                  {formatWebinarDayTime(w.starts_at, opts) || <Unrecorded>Start not recorded</Unrecorded>}
                </span>
                {phase === 'live' && <Pill tone="danger" dot>Live</Pill>}
                {w.href
                  ? <Link to={w.href} className="min-w-0 text-[13.5px] font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{w.title || 'Untitled webinar'}</Link>
                  : <span className="text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{w.title || 'Untitled webinar'}</span>}
              </span>
              <UpcomingAction row={w} phase={phase} />
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-axal-hairline pt-3 text-[11.5px] tabular-nums text-axal-faint dark:border-gray-800 dark:text-gray-500">
        {all.length > rows.length ? `The next ${rows.length} of ${all.length}. ` : ''}
        <Link to="/learning?tab=webinars" className="font-semibold text-axal-violet-deep underline dark:text-violet-300" data-testid="link-all-webinars">All webinars</Link>
      </p>
    </div>
  );
}

/** "Upcoming webinars" with its own read, in the home's section card. */
export function UpcomingWebinars({ limit = 3 }) {
  const now = useNow(60 * 1000);
  const [state, retry] = useLearningRead(() => readWebinars('upcoming'), [], { scope: 'webinars-upcoming' });
  return (
    <SectionCard title="Upcoming webinars" testid="section-webinars">
      <UpcomingWebinarsList state={state} limit={limit} now={now} onRetry={retry} />
    </SectionCard>
  );
}
