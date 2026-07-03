import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Star, ShieldCheck, Clock, Sparkles, Filter, X,
  Handshake, Rocket, TrendingUp, GraduationCap, MapPin, ArrowRight,
} from 'lucide-react';
import { api } from '../lib/api';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import NetworkSubNav from '../components/NetworkSubNav';
import { DIRECTORY_CATEGORIES, DIRECTORY_PREVIEWS } from '../data/network';

const CATEGORIES = ['legal', 'accounting', 'design', 'recruiting', 'fractional_cfo', 'gtm', 'engineering', 'marketing'];
const CAPACITY = ['available', 'limited', 'unavailable'];
const PRICING = ['$', '$$', '$$$'];

const TAB_ICONS = { Handshake, Rocket, TrendingUp, GraduationCap };

// Preview card for the not-yet-live Directory tabs (Startups / Investors & LPs
// / Advisors). Explicitly badged as a preview so it's never mistaken for a
// verified, live listing.
function PreviewCard({ p }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{p.name}</h3>
          <p className="text-xs text-gray-500">{p.category}</p>
        </div>
        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          Preview
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        {p.geography && <span className="inline-flex items-center gap-1"><MapPin size={12} />{p.geography}</span>}
        {p.stage && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{p.stage}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(p.tags || []).map((t) => (
          <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">{t}</span>
        ))}
      </div>
    </div>
  );
}

// "Coming soon" panel wrapping the preview grid for non-live tabs.
function ComingSoonTab({ category }) {
  const previews = DIRECTORY_PREVIEWS[category.id] || [];
  return (
    <div>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="rounded-lg bg-violet-100 p-2 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          <Sparkles size={16} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {category.label} directory
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              Coming soon
            </span>
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{category.blurb} A public, searchable {category.label.toLowerCase()} directory is on the way — here's a preview of the structure.</p>
          <Link to="/register" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:text-violet-900 dark:text-violet-300">
            Get listed <ArrowRight size={14} />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {previews.map((p) => <PreviewCard key={p.name} p={p} />)}
      </div>
    </div>
  );
}

function Stars({ value }) {
  if (value == null) return <span className="text-xs text-gray-500">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} fill={n <= Math.round(value) ? 'currentColor' : 'none'} strokeWidth={1.5} />
      ))}
      <span className="ml-1 text-xs text-gray-700 dark:text-gray-300">{Number(value).toFixed(1)}</span>
    </span>
  );
}

function FeaturedBadge({ tier }) {
  const colour = tier === 'platinum'
    ? 'bg-violet-100 text-violet-700 ring-violet-300'
    : tier === 'gold'
      ? 'bg-amber-100 text-amber-800 ring-amber-300'
      : 'bg-sky-100 text-sky-700 ring-sky-300';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${colour}`}>
      <Sparkles size={10} /> Featured · {tier || 'editor'}
    </span>
  );
}

function PartnerCard({ p }) {
  return (
    <Link
      to={`/partners/${p.slug}`}
      className="group block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-violet-300 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-gray-900 group-hover:text-violet-700 dark:text-gray-100">{p.name}</h3>
            {p.kyb_verified && (
              <span title="KYB Verified" className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                <ShieldCheck size={10} /> Verified
              </span>
            )}
          </div>
          {p.company && <p className="text-xs text-gray-500">{p.company}</p>}
          {p.headline && <p className="mt-1 text-sm text-gray-700 line-clamp-2 dark:text-gray-300">{p.headline}</p>}
        </div>
        {p.featured && <FeaturedBadge tier={p.featured_tier} />}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(p.categories || []).slice(0, 4).map((c) => (
          <span key={c} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:text-gray-300">{c.replace(/_/g, ' ')}</span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
        <Stars value={p.reviews?.avg_rating} />
        <div className="flex items-center gap-3">
          {p.response_time_hours != null && (
            <span className="inline-flex items-center gap-1"><Clock size={12} />{p.response_time_hours}h</span>
          )}
          {p.pricing_tier && <span className="font-mono text-gray-700 dark:text-gray-300">{p.pricing_tier}</span>}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 text-[11px] text-gray-500">
        <span>{p.completed_engagements} completed engagement{p.completed_engagements === 1 ? '' : 's'}</span>
        <span title="Algorithmic ranking score">score · {Math.round(p.ranking_score)}</span>
      </div>
    </Link>
  );
}

export default function PublicDirectoryPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    q: '', category: '', capacity: '', pricing: '', verified_only: false, rate_max: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [tab, setTab] = useState('partners');
  const activeCategory = DIRECTORY_CATEGORIES.find((c) => c.id === tab);

  const load = (params) => {
    setLoading(true); setError(null);
    api.publicListPartners(params)
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load directory'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load({}); }, []);

  const apply = () => {
    const p = { ...filters };
    if (!p.verified_only) delete p.verified_only;
    if (!p.rate_max) delete p.rate_max;
    load(p);
  };

  const reset = () => {
    const blank = { q: '', category: '', capacity: '', pricing: '', verified_only: false, rate_max: '' };
    setFilters(blank);
    load({});
  };

  const partners = data?.partners || [];
  const featured = useMemo(() => partners.filter((p) => p.featured), [partners]);
  const standard = useMemo(() => partners.filter((p) => !p.featured), [partners]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white dark:from-slate-950 dark:to-slate-950">
      <PublicNav />
      <div className="pt-16"><NetworkSubNav /></div>

      <section className="mx-auto max-w-6xl px-6 pt-10 pb-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Network Directory</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">Discover the people and companies in the Axal VC network — startups, service partners, investors, and advisors.</p>
        </div>

        {/* Category tabs */}
        <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800">
          {DIRECTORY_CATEGORIES.map((c) => {
            const Icon = TAB_ICONS[c.icon] || Handshake;
            const active = tab === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setTab(c.id)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                    : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                <Icon size={15} /> {c.label}
                {!c.live && (
                  <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab !== 'partners' ? (
          <ComingSoonTab category={activeCategory} />
        ) : (
        <>
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, company, or specialization"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <button onClick={() => setShowFilters((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
            <Filter size={14} /> Filters
          </button>
          <button onClick={apply} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">Search</button>
          {(filters.q || filters.category || filters.capacity || filters.pricing || filters.verified_only || filters.rate_max) && (
            <button onClick={reset} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <X size={14} /> Clear
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-800 dark:bg-gray-900">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Category</label>
              <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700">
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Capacity</label>
              <select value={filters.capacity} onChange={(e) => setFilters({ ...filters, capacity: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700">
                <option value="">Any</option>
                {CAPACITY.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Pricing tier</label>
              <select value={filters.pricing} onChange={(e) => setFilters({ ...filters, pricing: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700">
                <option value="">Any</option>
                {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Max hourly rate (USD)</label>
              <input type="number" min="0" value={filters.rate_max}
                     onChange={(e) => setFilters({ ...filters, rate_max: e.target.value })}
                     className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700" />
            </div>
            <label className="col-span-full inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={filters.verified_only}
                     onChange={(e) => setFilters({ ...filters, verified_only: e.target.checked })} />
              KYB-verified partners only
            </label>
          </div>
        )}

        {loading && <p className="text-sm text-gray-500">Loading directory…</p>}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {!loading && !error && (
          <>
            {featured.length > 0 && (
              <div className="mb-8">
                <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-violet-700">
                  <Sparkles size={14} /> Featured Partners
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((p) => <PartnerCard key={p.slug} p={p} />)}
                </div>
              </div>
            )}

            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
                {featured.length > 0 ? 'All Partners' : 'Partners'}
                <span className="ml-2 text-xs text-gray-500">({data?.total || 0} total)</span>
              </h2>
            </div>
            {standard.length === 0 && featured.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-900">
                <p className="text-sm text-gray-500">No partners match your filters yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {standard.map((p) => <PartnerCard key={p.slug} p={p} />)}
              </div>
            )}
          </>
        )}
        </>
        )}
      </section>

      <PublicFooter />
    </div>
  );
}
