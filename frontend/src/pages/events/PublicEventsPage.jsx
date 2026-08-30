import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, MapPin, Clock, Download, Search, Filter, Loader2, AlertTriangle,
  Repeat, Video, Users, ArrowRight,
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import NetworkSubNav from '../../components/NetworkSubNav';
import { eventsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';
import {
  PROGRAMS, PROGRAM_CATEGORIES, AUDIENCES, FORMATS,
} from '../../data/network';
import { EVENT_TYPE_FILTERS } from '../../lib/eventTypes';

const EVENT_TYPES = EVENT_TYPE_FILTERS;

const PROGRAM_CAT_LABEL = Object.fromEntries(PROGRAM_CATEGORIES.map((c) => [c.id, c.label]));
const FORMAT_LABEL = Object.fromEntries(FORMATS.map((f) => [f.id, f.label]));

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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
    const d = new Date(ev.starts_at);
    if (Number.isNaN(d.getTime())) continue;
    // Local month, deliberately: the tile and the time on every card already
    // render in the viewer's timezone, so bucketing by UTC would file a
    // late-evening event under the previous month it is shown in.
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let bucket = out[out.length - 1];
    if (!bucket || bucket.key !== key) {
      bucket = {
        key,
        name: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        items: [],
      };
      out.push(bucket);
    }
    bucket.items.push(ev);
  }
  return out;
}

// The calendar tile on each row.
function DateTile({ iso }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
        {d.toLocaleDateString(undefined, { month: 'short' })}
      </span>
      <span className="text-lg font-bold leading-none text-slate-900 dark:text-slate-100">
        {d.getDate()}
      </span>
      <span className="text-[10px] uppercase text-slate-500">
        {d.toLocaleDateString(undefined, { weekday: 'short' })}
      </span>
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

function FormatBadge({ format }) {
  const online = format === 'online';
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
      {online ? <Video className="w-2.5 h-2.5" /> : <MapPin className="w-2.5 h-2.5" />}
      {FORMAT_LABEL[format] || format}
    </span>
  );
}

// ---- Programs (curated, recurring series) --------------------------------
function ProgramCard({ p }) {
  const open = p.status === 'open';
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition hover:shadow-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          {PROGRAM_CAT_LABEL[p.category] || 'Program'}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
          <Repeat className="w-3 h-3" /> {p.cadence}
        </span>
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{p.name}</h3>
      <p className="mt-1 flex-1 text-sm text-slate-600 dark:text-slate-400">{p.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <FormatBadge format={p.format} />
        {(p.audience || []).map((a) => (
          <span key={a} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-600 dark:text-slate-300">
            <Users className="w-2.5 h-2.5" />{a}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
        <span className="text-xs text-slate-500 dark:text-slate-400">{p.nextSession}</span>
        {open ? (
          <Link to="/register?intent=program" className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline">
            RSVP <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        ) : (
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Coming soon
          </span>
        )}
      </div>
    </div>
  );
}

function ProgramsSection() {
  const [audience, setAudience] = useState('');
  const [format, setFormat] = useState('');
  const [category, setCategory] = useState('');

  const filtered = useMemo(() => PROGRAMS.filter((p) => {
    if (audience && !(p.audience || []).includes(audience)) return false;
    if (format && p.format !== format) return false;
    if (category && p.category !== category) return false;
    return true;
  }), [audience, format, category]);

  const Chip = ({ active, onClick, children }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300'
          : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
      }`}
    >
      {children}
    </button>
  );

  return (
    <section className="mb-12">
      <div className="mb-1 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Programs</h2>
      </div>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Recurring series across the network — office hours, roundtables, workshops, demo days, and
        community-hosted sessions.
      </p>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Audience</span>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!audience} onClick={() => setAudience('')}>All</Chip>
          {AUDIENCES.map((a) => (
            <Chip key={a.id} active={audience === a.id} onClick={() => setAudience(a.id)}>{a.label}</Chip>
          ))}
        </div>
        <span className="ml-0 sm:ml-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Format</span>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!format} onClick={() => setFormat('')}>All</Chip>
          {FORMATS.map((f) => (
            <Chip key={f.id} active={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</Chip>
          ))}
        </div>
        <span className="ml-0 sm:ml-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Category</span>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!category} onClick={() => setCategory('')}>All</Chip>
          {PROGRAM_CATEGORIES.map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Chip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No programs match these filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => <ProgramCard key={p.id} p={p} />)}
        </div>
      )}
    </section>
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <NetworkSubNav />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Programs &amp; Events</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Recurring programs and one-off events across the network — open to founders,
                investors, partners, and advisors.
              </p>
            </div>
            <a
              href={eventsPublic.icsUrl()}
              download="axal-events.ics"
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
            >
              <Download className="w-4 h-4" /> Add to calendar
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <ProgramsSection />

          {/* Events */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Events</h2>
            </div>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              Scheduled sessions you can register for.
            </p>

            {/* Upcoming / Past toggle */}
            <div className="mb-4 inline-flex rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 bg-white dark:bg-slate-900">
              {['upcoming', 'past'].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWhen(w)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition ${
                    when === w
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="search"
                  placeholder="Search events..."
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  aria-label="Event category"
                >
                  {EVENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <select
                  value={filterFormat}
                  onChange={(e) => setFilterFormat(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  aria-label="Event format"
                >
                  <option value="">All formats</option>
                  {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                <input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  aria-label="From date"
                />
                <input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  aria-label="To date"
                />
              </div>
            </div>

            {loading && offset === 0 ? (
              <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin" /> Loading events…
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : visibleEvents.length === 0 ? (
              <div className="text-center text-slate-500 py-20">
                <p className="text-sm">
                  {when === 'past' ? 'No past events match your filters.' : 'No upcoming events match your filters.'}
                </p>
                {hasEventFilters && (
                  <button
                    type="button"
                    onClick={() => { setFilterType(''); setFilterFormat(''); setFilterFrom(''); setFilterTo(''); setSearchQ(''); }}
                    className="mt-3 text-sm text-violet-700 dark:text-violet-300 hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-8">
                {monthSections.map((section) => (
                  <div key={section.key}>
                    <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-1.5">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                        {section.name}
                      </h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {section.items.length} {section.items.length === 1 ? 'event' : 'events'}
                      </span>
                    </div>
                    <div className="space-y-4">
                {section.items.map((ev) => {
                  const fmt = eventFormat(ev);
                  const isPast = when === 'past';
                  return (
                    <div
                      key={ev.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hover:shadow-md transition-shadow"
                    >
                      <div className="flex flex-col sm:flex-row">
                        {ev.cover_url ? (
                          <div className="sm:w-48 h-40 sm:h-auto shrink-0">
                            <img src={ev.cover_url} alt={ev.title} className="w-full h-full object-cover" />
                          </div>
                        ) : null}
                        <div className="flex-1 p-5 flex flex-col justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
                              <DateTile iso={ev.starts_at} />
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium uppercase tracking-wide">
                                {ev.type?.replace(/_/g, ' ')}
                              </span>
                              <FormatBadge format={fmt} />
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> {formatDate(ev.starts_at)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {formatTime(ev.starts_at)}
                              </span>
                            </div>
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                              <Link to={`/events/${ev.slug}`} className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">
                                {ev.title}
                              </Link>
                            </h3>
                            {ev.summary ? (
                              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{ev.summary}</p>
                            ) : null}
                            <div className="mt-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                              <MapPin className="w-3 h-3" />
                              {fmt === 'online' ? 'Virtual' : ev.location_text || 'TBA'}
                            </div>
                          </div>
                          <div className="mt-4 flex items-center gap-3">
                            <Link
                              to={`/events/${ev.slug}`}
                              className="inline-flex items-center gap-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              {/* Not "View recap": no recording_url or replay
                                  column exists on `events`, so a past event's
                                  detail page is the same detail page. */}
                              {isPast ? 'View details' : 'Register'}
                            </Link>
                            {!isPast && (ev.price_cents > 0 ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                ${(ev.price_cents / 100).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Free</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                    </div>
                  </div>
                ))}
                {hasMore && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => setOffset((o) => o + PAGE_SIZE)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-violet-400 disabled:opacity-50"
                    >
                      {loading ? 'Loading…' : 'Load more events'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
