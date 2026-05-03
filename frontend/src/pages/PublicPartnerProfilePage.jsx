import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Star, ShieldCheck, Clock, Globe, Sparkles, CheckCircle2,
} from 'lucide-react';
import { api } from '../lib/api';

function Stars({ value, size = 16 }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} fill={n <= Math.round(value || 0) ? 'currentColor' : 'none'} strokeWidth={1.5} />
      ))}
    </span>
  );
}

function ScoreRow({ label, value, points }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="text-gray-900">
        <span className="font-mono text-xs text-gray-400">{String(value)}</span>
        <span className="ml-2 inline-block min-w-[3.5rem] text-right font-semibold">+{Number(points).toFixed(1)}</span>
      </span>
    </div>
  );
}

export default function PublicPartnerProfilePage() {
  const { slug } = useParams();
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setError(null);
    api.publicGetPartner(slug)
      .then(setP)
      .catch((e) => setError(e.status === 404 ? 'Partner not found' : (e.message || 'Failed to load partner')))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/directory" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft size={16} /> Back to directory
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/login" className="text-gray-600 hover:text-gray-900">Sign in</Link>
            <Link to="/register" className="rounded-lg bg-violet-600 px-3 py-1.5 text-white hover:bg-violet-700">Get Started</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <p className="text-sm text-red-700">{error}</p>
            <Link to="/directory" className="mt-3 inline-block text-sm text-violet-700 underline">Browse all partners</Link>
          </div>
        )}

        {p && (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold text-gray-900">{p.name}</h1>
                    {p.kyb_verified && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                        <ShieldCheck size={12} /> KYB Verified
                      </span>
                    )}
                    {p.featured && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-300">
                        <Sparkles size={12} /> Featured · {p.featured_tier || 'editor'}
                      </span>
                    )}
                  </div>
                  {p.company && <p className="text-sm text-gray-500">{p.company}</p>}
                  {p.headline && <p className="mt-2 text-base text-gray-800">{p.headline}</p>}
                </div>
                <div className="text-right">
                  <Stars value={p.reviews?.avg_rating} />
                  <p className="mt-1 text-xs text-gray-500">
                    {p.reviews?.count || 0} review{(p.reviews?.count || 0) === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {p.bio && <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{p.bio}</p>}

              <div className="mt-5 flex flex-wrap gap-2">
                {(p.categories || []).map((c) => (
                  <span key={c} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">{c.replace(/_/g, ' ')}</span>
                ))}
                {(p.sectors || []).map((s) => (
                  <span key={s} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs text-violet-700">{s.replace(/_/g, ' ')}</span>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-[11px] uppercase text-gray-500">Pricing</p>
                  <p className="mt-1 font-mono text-sm text-gray-900">{p.pricing_tier || '—'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-[11px] uppercase text-gray-500">Hourly rate</p>
                  <p className="mt-1 text-sm text-gray-900">
                    {p.hourly_rate_min != null || p.hourly_rate_max != null
                      ? `$${p.hourly_rate_min ?? '?'}${p.hourly_rate_max != null ? `–$${p.hourly_rate_max}` : ''}/h`
                      : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-[11px] uppercase text-gray-500">Response time</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-sm text-gray-900">
                    <Clock size={13} />{p.response_time_hours != null ? `${p.response_time_hours}h` : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-[11px] uppercase text-gray-500">Capacity</p>
                  <p className="mt-1 text-sm capitalize text-gray-900">{p.capacity_status}</p>
                </div>
              </div>

              {p.website && (
                <a href={p.website} target="_blank" rel="noreferrer noopener"
                   className="mt-5 inline-flex items-center gap-1.5 text-sm text-violet-700 hover:underline">
                  <Globe size={14} /> {p.website.replace(/^https?:\/\//, '')}
                </a>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
                <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  {p.completed_engagements} completed engagement{p.completed_engagements === 1 ? '' : 's'}
                </span>
                <Link to="/register" className="ml-auto rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
                  Engage this partner
                </Link>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-base font-semibold text-gray-900">Recent reviews</h2>
                {p.recent_reviews?.length ? (
                  <ul className="space-y-4">
                    {p.recent_reviews.map((r) => (
                      <li key={r.id} className="border-b border-gray-100 pb-3 last:border-0">
                        <div className="mb-1 flex items-center justify-between">
                          <Stars value={r.rating} size={14} />
                          <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                        {r.comment && <p className="text-sm text-gray-700">{r.comment}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No reviews yet.</p>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-2 text-base font-semibold text-gray-900">Ranking score · {Math.round(p.ranking_score)}</h2>
                <p className="mb-3 text-xs text-gray-500">How partners are ranked in the public directory.</p>
                <div className="space-y-2">
                  {p.ranking_breakdown && Object.entries(p.ranking_breakdown).map(([k, v]) => (
                    <ScoreRow
                      key={k}
                      label={k.replace(/_/g, ' ')}
                      value={v.value === true ? 'yes' : v.value === false ? 'no' : (v.value ?? '—')}
                      points={v.points}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
