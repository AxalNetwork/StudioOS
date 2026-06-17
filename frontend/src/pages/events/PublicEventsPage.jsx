import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, MapPin, Clock, Download, Search, Filter, Loader2, AlertTriangle } from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import { eventsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';

const EVENT_TYPES = [
  { id: '', label: 'All types' },
  { id: 'meetup', label: 'Meetup' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'webinar', label: 'Webinar' },
  { id: 'demo_day', label: 'Demo Day' },
  { id: 'office_hours', label: 'Office Hours' },
  { id: 'conference', label: 'Conference' },
  { id: 'social', label: 'Social' },
  { id: 'other', label: 'Other' },
];

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

export default function PublicEventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    eventsPublic.list({ type: filterType || undefined, from: filterFrom || undefined, to: filterTo || undefined, q: searchQ || undefined })
      .then((data) => {
        if (cancelled) return;
        setEvents(Array.isArray(data?.events) ? data.events : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('public_events_list_failed', err);
        setError('Unable to load events. Please try again shortly.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filterType, filterFrom, filterTo, searchQ]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Events</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Upcoming Axal VC events — open to founders, partners, and the community.
              </p>
            </div>
            <a
              href={eventsPublic.icsUrl()}
              download="axal-events.ics"
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" /> Add to calendar
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="search"
                placeholder="Search events..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {EVENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
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

          {loading ? (
            <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" /> Loading events…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : events.length === 0 ? (
            <div className="text-center text-slate-500 py-20">
              <p className="text-sm">No upcoming events match your filters.</p>
              <button
                type="button"
                onClick={() => { setFilterType(''); setFilterFrom(''); setFilterTo(''); setSearchQ(''); }}
                className="mt-3 text-sm text-violet-700 dark:text-violet-300 hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((ev) => (
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
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium uppercase tracking-wide">
                            {ev.type?.replace(/_/g, ' ')}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {formatDate(ev.starts_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {formatTime(ev.starts_at)}
                          </span>
                        </div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          <Link to={`/events/${ev.slug}`} className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">
                            {ev.title}
                          </Link>
                        </h2>
                        {ev.summary ? (
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{ev.summary}</p>
                        ) : null}
                        <div className="mt-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <MapPin className="w-3 h-3" />
                          {ev.location_kind === 'virtual' ? 'Virtual' : ev.location_text || 'TBA'}
                        </div>
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <Link
                          to={`/events/${ev.slug}`}
                          className="inline-flex items-center gap-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          Register
                        </Link>
                        {ev.price_cents > 0 ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            ${(ev.price_cents / 100).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Free</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
