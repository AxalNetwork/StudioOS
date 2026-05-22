import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Star, ShieldCheck, Clock, Sparkles, Filter, X,
} from 'lucide-react';
import { api } from '../lib/api';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';

const CATEGORIES = ['legal', 'accounting', 'design', 'recruiting', 'fractional_cfo', 'gtm', 'engineering', 'marketing'];
const CAPACITY = ['available', 'limited', 'unavailable'];
const PRICING = ['$', '$$', '$$$'];

function Stars({ value }) {
  if (value == null) return <span className="text-xs text-gray-400">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} fill={n <= Math.round(value) ? 'currentColor' : 'none'} strokeWidth={1.5} />
      ))}
      <span className="ml-1 text-xs text-gray-700">{Number(value).toFixed(1)}</span>
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
      className="group block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-violet-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-gray-900 group-hover:text-violet-700">{p.name}</h3>
            {p.kyb_verified && (
              <span title="KYB Verified" className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                <ShieldCheck size={10} /> Verified
              </span>
            )}
          </div>
          {p.company && <p className="text-xs text-gray-500">{p.company}</p>}
          {p.headline && <p className="mt-1 text-sm text-gray-700 line-clamp-2">{p.headline}</p>}
        </div>
        {p.featured && <FeaturedBadge tier={p.featured_tier} />}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(p.categories || []).slice(0, 4).map((c) => (
          <span key={c} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{c.replace(/_/g, ' ')}</span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
        <Stars value={p.reviews?.avg_rating} />
        <div className="flex items-center gap-3">
          {p.response_time_hours != null && (
            <span className="inline-flex items-center gap-1"><Clock size={12} />{p.response_time_hours}h</span>
          )}
          {p.pricing_tier && <span className="font-mono text-gray-700">{p.pricing_tier}</span>}
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
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
      <PublicNav />

      <section className="mx-auto max-w-6xl px-6 pt-32 pb-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Service Provider Directory</h1>
          <p className="mt-1 text-gray-600">Browse vetted partners — ranked by completed engagements, ratings, response time and KYB status.</p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, company, or specialization"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500"
            />
          </div>
          <button onClick={() => setShowFilters((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
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
          <div className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Category</label>
              <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Capacity</label>
              <select value={filters.capacity} onChange={(e) => setFilters({ ...filters, capacity: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Any</option>
                {CAPACITY.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Pricing tier</label>
              <select value={filters.pricing} onChange={(e) => setFilters({ ...filters, pricing: e.target.value })}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Any</option>
                {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Max hourly rate (USD)</label>
              <input type="number" min="0" value={filters.rate_max}
                     onChange={(e) => setFilters({ ...filters, rate_max: e.target.value })}
                     className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <label className="col-span-full inline-flex items-center gap-2 text-sm text-gray-700">
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
                <span className="ml-2 text-xs text-gray-400">({data?.total || 0} total)</span>
              </h2>
            </div>
            {standard.length === 0 && featured.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
                <p className="text-sm text-gray-500">No partners match your filters yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {standard.map((p) => <PartnerCard key={p.slug} p={p} />)}
              </div>
            )}
          </>
        )}
      </section>

      <PublicFooter />
    </div>
  );
}
