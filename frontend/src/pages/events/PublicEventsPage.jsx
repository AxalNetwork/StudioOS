/**
 * `/events` — Programs & Events, built to the owner's canvas (D679, #1553;
 * `design/canvases/integrated/Axal VC Website.dc.html`, PROGRAMS & EVENTS).
 *
 * Two live reads and nothing typed:
 *   - the Programs row is the Spin-Out Lab's open cohort, from the Lab's own
 *     cohort rule and cohort record. The canvas's other two cards (an advisor
 *     intake and Fund I onboarding) have no source, so they are not drawn;
 *   - the events are the public feed, with its filters, its archive, its paging
 *     and its calendar file, exactly as before this rebuild.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Search } from 'lucide-react';
import SitePage from '../../components/site/SitePage';
import NetworkSubNav from '../../components/site/NetworkSubNav';
import { EmptyNote, FilterPills } from '../../components/site/SiteBlocks';
import { eventsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';
import { FORMATS } from '../../data/network';
import { EVENT_TYPE_FILTERS } from '../../lib/eventTypes';
import { formatEventPrice } from '../../lib/money';
import { COHORT_WEEKS, openCohortCopy, useCohortPlaces } from '../../lib/spinoutLab';
import { EVENTS_COPY, eventDateParts, eventTypeTone } from '../../lib/siteNetwork2';
import '../site/network2.css';

const EVENT_TYPES = EVENT_TYPE_FILTERS;
const TYPE_LABEL = Object.fromEntries(EVENT_TYPES.filter((t) => t.id).map((t) => [t.id, t.label]));
const FORMAT_LABEL = Object.fromEntries(FORMATS.map((f) => [f.id, f.label]));
const WHEN_OPTIONS = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }];

/** The Lab's sprint length, from the cohort timing the Worker runs, never typed. */
const COHORT_DAYS = COHORT_WEEKS * 7;

// One server page. The feed used to be requested with the API's default
// LIMIT 20 and no offset handling at all, so a 21st public event simply did
// not exist on this page and nothing said so.
const PAGE_SIZE = 50;

// Month sections, in the order the server already sorted the feed — ascending
// for upcoming, descending for the archive. Re-sorting here would fight the
// server and put the archive back in oldest-first order.
function groupByMonth(list) {
  const out = [];
  for (const ev of list) {
    // The event's own zone, deliberately: the tile and the time on every row
    // render in it, so bucketing by UTC (or by the viewer's zone) would file a
    // late-evening event under a month its own tile does not show.
    const when = eventDateParts(ev.starts_at, ev.timezone);
    if (!when) continue;
    let bucket = out[out.length - 1];
    if (!bucket || bucket.key !== when.monthKey) {
      bucket = { key: when.monthKey, name: when.monthName, items: [] };
      out.push(bucket);
    }
    bucket.items.push(ev);
  }
  return out;
}

// The calendar tile on each row: day and month in the event's zone.
function DateTile({ when }) {
  if (!when) return <div className="ax-n2-date" aria-hidden="true" />;
  return (
    <div className="ax-n2-date">
      <div className="ax-mono ax-n2-day">{when.day}</div>
      <div className="ax-lbl-q ax-n2-mon">{when.mon}</div>
    </div>
  );
}

// Map an event's location_kind onto our online / in-person / hybrid taxonomy so
// the Format filter can work client-side against the live events feed.
function eventFormat(ev) {
  const k = (ev.location_kind || '').toLowerCase();
  if (k === 'virtual' || k === 'online') return 'online';
  if (k === 'hybrid') return 'hybrid';
  return 'in_person';
}

/**
 * The Spin-Out Lab card. Its cohort number and start date come from the Lab's
 * cohort rule (`openCohortCopy`), its length from `COHORT_WEEKS`, and its
 * places from the cohort record (`useCohortPlaces`). A fact that is not read is
 * not drawn.
 */
export function LabProgramCard() {
  const cohort = openCohortCopy();
  const places = useCohortPlaces();
  const facts = [];
  if (cohort?.startLabel) facts.push({ k: 'Starts', v: cohort.startLabel });
  facts.push({ k: 'Duration', v: `${COHORT_DAYS} days` });
  if (places.status === 'ok' && places.places > 0) facts.push({ k: 'Places', v: String(places.places) });
  return (
    <article className="ax-card ax-n2-program">
      <span className="ax-chip ax-n2-chip-green">Applications open</span>
      <h3 className="ax-n2-program-t">{cohort ? `Spin-Out Lab · Cohort ${cohort.cohortNum}` : 'Spin-Out Lab · Next cohort'}</h3>
      <p className="ax-n2-program-d">
        The {COHORT_DAYS}-day formation programme. Idea to incorporated, 83(b)-filed, cap-table-clean, with verified discovery and revenue proof.
      </p>
      <dl className="ax-n2-facts">
        {facts.map((f) => (
          <div key={f.k}><dt>{f.k}</dt><dd className="ax-mono">{f.v}</dd></div>
        ))}
      </dl>
      <Link to="/spinout-lab/apply" className="ax-btn ax-btn-primary ax-n2-program-cta">
        {cohort ? `Apply to Cohort ${cohort.cohortNum}` : 'Apply to the next cohort'}
      </Link>
    </article>
  );
}

/** One event row: the tile, the title and its type, the summary, the time, the way in. */
export function EventRow({ ev, isPast }) {
  const when = eventDateParts(ev.starts_at, ev.timezone);
  const fmt = eventFormat(ev);
  const place = fmt === 'online' ? 'Virtual' : ev.location_text || 'TBA';
  return (
    <div className="ax-n2-row">
      <DateTile when={when} />
      <div className="ax-n2-main">
        <div className="ax-n2-title-row">
          <h3 className="ax-n2-row-t"><Link to={`/events/${ev.slug}`}>{ev.title}</Link></h3>
          {ev.type && <span className={eventTypeTone(ev.type)}>{TYPE_LABEL[ev.type] || String(ev.type).replace(/_/g, ' ')}</span>}
        </div>
        {ev.summary ? <p className="ax-n2-row-d">{ev.summary}</p> : null}
        <p className="ax-n2-row-m">{FORMAT_LABEL[fmt] || fmt} · {place}</p>
      </div>
      <div className="ax-n2-side">
        <div className="ax-n2-when">
          {when && <div className="ax-mono">{when.time}</div>}
          {!isPast && (ev.price_cents > 0 ? (
            <div>{formatEventPrice(ev.price_cents, ev.currency)}</div>
          ) : (
            <div className="is-free">Free</div>
          ))}
        </div>
        <Link to={`/events/${ev.slug}`} className="ax-n2-row-cta">
          {/* Not "View recap": no recording_url or replay
              column exists on `events`, so a past event's
              detail page is the same detail page. */}
          {isPast ? 'View details' : 'Register'}
        </Link>
      </div>
    </div>
  );
}

// ---- Events (live feed) ---------------------------------------------------
export default function PublicEventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterFormat, setFilterFormat] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [when, setWhen] = useState('upcoming'); // 'upcoming' | 'past'
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Any filter change restarts paging from the top; otherwise page 2 of the
  // old query would be appended under the new one.
  useEffect(() => {
    setOffset(0);
  }, [filterType, filterFrom, filterTo, searchQ, when]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    eventsPublic.list({
      limit: PAGE_SIZE,
      offset,
      type: filterType || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
      q: searchQ || undefined,
      past: when === 'past' ? true : undefined,
    })
      .then((data) => {
        if (cancelled) return;
        const page = Array.isArray(data?.events) ? data.events : [];
        setEvents((prev) => (offset === 0 ? page : [...prev, ...page]));
        // A short page is the end of the feed. A full one may or may not be —
        // the endpoint returns no total — so the control says "Load more"
        // rather than claiming a count nobody sent.
        setHasMore(page.length === PAGE_SIZE);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('public_events_list_failed', err);
        setError('Unable to load events. Please try again shortly.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filterType, filterFrom, filterTo, searchQ, when, offset]);

  // Format is not a server-side filter on the public events API, so refine the
  // returned page client-side.
  const visibleEvents = useMemo(
    () => (filterFormat ? events.filter((ev) => eventFormat(ev) === filterFormat) : events),
    [events, filterFormat],
  );

  const monthSections = useMemo(() => groupByMonth(visibleEvents), [visibleEvents]);

  const hasEventFilters = filterType || filterFormat || filterFrom || filterTo || searchQ;
  const isPast = when === 'past';

  return (
    <SitePage title={EVENTS_COPY.title}>
      <NetworkSubNav />
      <div className="ax-wrap ax-n2-page">
        <header className="ax-n2-head">
          <div>
            <div className="ax-lbl-q">{EVENTS_COPY.eyebrow}</div>
            <h1 className="ax-n2-h1">{EVENTS_COPY.title}</h1>
            <p className="ax-n2-lede">{EVENTS_COPY.lede}</p>
          </div>
          <a href={eventsPublic.icsUrl()} download="axal-events.ics" className="ax-btn ax-btn-md ax-btn-quiet">
            <CalendarPlus size={15} aria-hidden="true" /> Add to calendar
          </a>
        </header>

        <section aria-labelledby="ax-n2-programs">
          <h2 id="ax-n2-programs" className="ax-n2-k">Programs</h2>
          <div className="ax-grid-3">
            <LabProgramCard />
          </div>
        </section>

        <section aria-labelledby="ax-n2-events">
          <h2 id="ax-n2-events" className="ax-n2-k is-gap">{isPast ? 'Past events' : 'Upcoming events'}</h2>
          <FilterPills label="Upcoming or past" options={WHEN_OPTIONS} value={when} onChange={setWhen} />
          <div className="ax-n2-tools">
            <label className="ax-n2-search" style={{ position: 'relative', display: 'flex' }}>
              <span className="sr-only">Search events</span>
              <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ax-faint)' }} />
              <input
                type="search"
                placeholder="Search events..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="ax-n2-input"
                style={{ width: '100%', paddingLeft: 34 }}
              />
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="ax-n2-select"
              aria-label="Event category"
            >
              {EVENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select
              value={filterFormat}
              onChange={(e) => setFilterFormat(e.target.value)}
              className="ax-n2-select"
              aria-label="Event format"
            >
              <option value="">All formats</option>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="ax-n2-input"
              aria-label="From date"
            />
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="ax-n2-input"
              aria-label="To date"
            />
          </div>

          {loading && offset === 0 ? (
            <EmptyNote>Loading events…</EmptyNote>
          ) : error ? (
            <p role="alert" className="ax-n2-alert">{error}</p>
          ) : visibleEvents.length === 0 ? (
            <div>
              <EmptyNote>
                {isPast ? 'No past events match your filters.' : 'No upcoming events match your filters.'}
              </EmptyNote>
              {hasEventFilters && (
                <button
                  type="button"
                  onClick={() => { setFilterType(''); setFilterFormat(''); setFilterFrom(''); setFilterTo(''); setSearchQ(''); }}
                  className="ax-n2-textlink"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <ul className="ax-n2-list">
                {monthSections.map((section) => (
                  <li key={section.key}>
                    <div className="ax-n2-month">
                      <h3 className="ax-lbl-q ax-n2-month-t">{section.name}</h3>
                      <span className="ax-mono ax-n2-muted">
                        {section.items.length} {section.items.length === 1 ? 'event' : 'events'}
                      </span>
                    </div>
                    {section.items.map((ev) => <EventRow key={ev.id} ev={ev} isPast={isPast} />)}
                  </li>
                ))}
              </ul>
              {hasMore && (
                <div className="ax-n2-more">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setOffset((o) => o + PAGE_SIZE)}
                    className="ax-btn ax-btn-md ax-btn-quiet"
                  >
                    {loading ? 'Loading…' : 'Load more events'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </SitePage>
  );
}
