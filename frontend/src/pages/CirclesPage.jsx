import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Users, MapPin, CalendarDays, MessageSquare, Lock, Globe,
  Sparkles, Rocket, TrendingUp, Handshake, GraduationCap, Plus,
  ArrowRight, ChevronRight,
} from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import NetworkSubNav from '../components/NetworkSubNav';
import {
  CIRCLES, CIRCLE_TYPES, CIRCLE_TYPE_LABEL, ACTIVITY_LEVELS, ACCESS_TYPES,
} from '../data/network';

// lucide icons referenced by name in the circle-type config.
const TYPE_ICONS = {
  Rocket, TrendingUp, Handshake, GraduationCap, MapPin, Sparkles,
};

// Tailwind accent families are enumerated as full class strings so the JIT
// compiler keeps them (dynamic `text-${accent}-600` would be purged).
const ACCENT = {
  violet: { chip: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', ring: 'ring-violet-200 dark:ring-violet-800' },
  emerald: { chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-800' },
  sky: { chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', ring: 'ring-sky-200 dark:ring-sky-800' },
  amber: { chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', ring: 'ring-amber-200 dark:ring-amber-800' },
  rose: { chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', ring: 'ring-rose-200 dark:ring-rose-800' },
  indigo: { chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', ring: 'ring-indigo-200 dark:ring-indigo-800' },
};

function AccessBadge({ access }) {
  const isPrivate = access === 'private';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isPrivate
          ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      }`}
    >
      {isPrivate ? <Lock className="w-2.5 h-2.5" /> : <Globe className="w-2.5 h-2.5" />}
      {isPrivate ? 'Invite-only' : 'Public'}
    </span>
  );
}

function ActivityDot({ activity }) {
  const a = ACTIVITY_LEVELS[activity] || ACTIVITY_LEVELS.quiet;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span className={`h-1.5 w-1.5 rounded-full ${a.dot}`} />
      {a.label}
    </span>
  );
}

function CircleCard({ c, featured }) {
  const type = CIRCLE_TYPES.find((t) => t.id === c.type);
  const Icon = TYPE_ICONS[type?.icon] || Users;
  const accent = ACCENT[type?.accent] || ACCENT.violet;
  return (
    <div
      className={`group flex flex-col rounded-2xl border bg-white dark:bg-slate-900 p-5 shadow-sm transition hover:shadow-md ${
        featured
          ? 'border-violet-200 dark:border-violet-800 hover:border-violet-400'
          : 'border-slate-200 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-700'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${accent.chip} ${accent.ring}`}>
          <Icon className="h-5 w-5" />
        </div>
        <AccessBadge access={c.access} />
      </div>

      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{c.name}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className={`rounded px-1.5 py-0.5 font-medium ${accent.chip}`}>{CIRCLE_TYPE_LABEL[c.type]}</span>
        {c.region && (
          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{c.region}</span>
        )}
      </div>

      <p className="mt-3 flex-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-3">{c.tagline}</p>

      {c.tags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-center">
        <div>
          <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Users className="w-3.5 h-3.5 text-slate-400" />{c.members}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Members</div>
        </div>
        <div>
          <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400" />{c.upcomingEvents}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Events</div>
        </div>
        <div>
          <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <MessageSquare className="w-3.5 h-3.5 text-slate-400" />{c.discussions}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Threads</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <ActivityDot activity={c.activity} />
        <Link
          to={`/register?intent=circle&circle=${encodeURIComponent(c.id)}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200"
        >
          {c.access === 'private' ? 'Request access' : 'Join'}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

const ACCESS_FILTERS = [{ id: '', label: 'All access' }, ...ACCESS_TYPES];

export default function CirclesPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [access, setAccess] = useState('');

  const regions = useMemo(() => {
    const set = new Set(CIRCLES.map((c) => c.region).filter(Boolean));
    return Array.from(set).sort();
  }, []);
  const [region, setRegion] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CIRCLES.filter((c) => {
      if (type && c.type !== type) return false;
      if (access && c.access !== access) return false;
      if (region && c.region !== region) return false;
      if (q) {
        const hay = `${c.name} ${c.tagline} ${c.theme} ${(c.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [search, type, access, region]);

  const featured = useMemo(() => filtered.filter((c) => c.featured), [filtered]);
  const rest = useMemo(() => filtered.filter((c) => !c.featured), [filtered]);
  const hasFilters = search || type || access || region;

  const totalMembers = useMemo(
    () => CIRCLES.reduce((n, c) => n + (c.members || 0), 0),
    [],
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <NetworkSubNav />

      {/* Hero */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-gradient-to-b from-violet-50 to-white dark:from-slate-900 dark:to-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-14">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 dark:bg-violet-900/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              <Sparkles className="w-3.5 h-3.5" /> The network layer
            </span>
            <h1 className="mt-4 text-3xl md:text-4xl font-bold text-slate-900 dark:text-slate-100">
              Communities &amp; Circles
            </h1>
            <p className="mt-3 text-base md:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
              Circles are where the network actually happens — founders, investors, service
              partners, and advisors organised by stage, city, and topic. Join a public circle,
              request access to a private one, or start your own.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                to="/register?intent=circle"
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
              >
                Join the network <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#circles"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-slate-400 transition-colors"
              >
                Browse circles
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
              <span><strong className="text-slate-900 dark:text-slate-100">{CIRCLES.length}</strong> circles</span>
              <span><strong className="text-slate-900 dark:text-slate-100">{totalMembers.toLocaleString()}</strong> members</span>
              <span><strong className="text-slate-900 dark:text-slate-100">6</strong> circle types</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-10">
          {/* Type overview */}
          <section className="mb-10">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Explore by type
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {CIRCLE_TYPES.map((t) => {
                const Icon = TYPE_ICONS[t.icon] || Users;
                const accent = ACCENT[t.accent] || ACCENT.violet;
                const active = type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(active ? '' : t.id)}
                    className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-violet-400 dark:border-violet-600 ring-1 ring-violet-200 dark:ring-violet-800 bg-white dark:bg-slate-900'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-violet-300 dark:hover:border-violet-700'
                    }`}
                  >
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${accent.chip}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{t.short}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Filters */}
          <section id="circles" className="scroll-mt-24">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search circles by name, theme, or tag"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <select
                value={access}
                onChange={(e) => setAccess(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-label="Filter by access"
              >
                {ACCESS_FILTERS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-label="Filter by region"
              >
                <option value="">All regions</option>
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {hasFilters && (
              <div className="mb-4 flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                <span>{filtered.length} circle{filtered.length === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  onClick={() => { setSearch(''); setType(''); setAccess(''); setRegion(''); }}
                  className="text-violet-700 dark:text-violet-300 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-12 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">No circles match your filters yet.</p>
              </div>
            ) : (
              <>
                {featured.length > 0 && !hasFilters && (
                  <div className="mb-8">
                    <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                      <Sparkles className="w-4 h-4" /> Featured circles
                    </h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {featured.map((c) => <CircleCard key={c.id} c={c} featured />)}
                    </div>
                  </div>
                )}

                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  {hasFilters ? 'Results' : 'All circles'}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(hasFilters ? filtered : rest).map((c) => <CircleCard key={c.id} c={c} />)}
                </div>
              </>
            )}
          </section>

          {/* How circles connect to the rest of the network */}
          <section className="mt-14 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Users, title: 'Members', body: 'Every circle is a curated group of founders, investors, partners, or advisors — verified through the network.', to: '/directory', cta: 'Browse the Directory' },
              { icon: CalendarDays, title: 'Events & programs', body: 'Circles host meetups, office hours, and demo days. Upcoming sessions surface on each card.', to: '/events', cta: 'See Programs & Events' },
              { icon: MessageSquare, title: 'Discussions', body: 'Ongoing threads, intros, and shared resources keep the circle active between events.', to: '/register?intent=circle', cta: 'Join to participate', soon: true },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                  <f.icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {f.title}
                  {f.soon && (
                    <span className="ml-2 rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Coming soon
                    </span>
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{f.body}</p>
                <Link to={f.to} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline">
                  {f.cta} <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </section>

          {/* CTA band */}
          <section className="mt-14 overflow-hidden rounded-3xl border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-900/20">
            <div className="grid gap-6 p-8 md:grid-cols-2 md:items-center md:p-10">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Start or join a circle</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Public circles are open to any member of the network. Private circles are
                  invite-only — request access and a host will review. Want to convene your own
                  founder, city, or topic circle? Propose one and we'll help you launch it.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
                <Link
                  to="/register?intent=circle"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
                >
                  Join the network <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/contact?topic=circle"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-slate-400 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Create a circle
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
