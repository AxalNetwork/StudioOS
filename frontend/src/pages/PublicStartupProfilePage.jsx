import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Rocket, Globe, Target, Users, DollarSign,
  MapPin, Calendar, Newspaper,
} from 'lucide-react';
import { api } from '../lib/api';
import FollowButton from '../components/profile/FollowButton';
import PersonCard from '../components/profile/PersonCard';

function Stat({ label, value, icon }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <p className="text-[11px] uppercase text-gray-500">{label}</p>
      <p className="mt-1 inline-flex items-center gap-1 text-sm text-gray-900 dark:text-gray-100">{icon}{value}</p>
    </div>
  );
}

function Prose({ title, body }) {
  if (!body) return null;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <p className="whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">{body}</p>
    </section>
  );
}

export default function PublicStartupProfilePage() {
  const { handle } = useParams();
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true); setError(null);
    api.publicGetStartup(handle)
      .then(setS)
      .catch((e) => setError(e.status === 404 ? 'Startup not found' : (e.message || 'Failed to load startup')))
      .finally(() => setLoading(false));
  }, [handle]);

  const t = s?.traction || {};

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft size={16} /> Axal VC StudioOS
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
            <Link to="/" className="mt-3 inline-block text-sm text-violet-700 underline">Back to home</Link>
          </div>
        )}

        {s && (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex flex-wrap items-start gap-5">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-2 ring-white shadow">
                  <Rocket size={30} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{s.name || `@${s.handle}`}</h1>
                    {s.stage && (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                        {String(s.stage).replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    {s.sector && <span>{String(s.sector).replace(/_/g, ' ')}</span>}
                    {s.hq && <span className="inline-flex items-center gap-1"><MapPin size={12} />{s.hq}</span>}
                    {s.founded_year && <span className="inline-flex items-center gap-1"><Calendar size={12} />Founded {s.founded_year}</span>}
                  </div>
                  {s.description && <p className="mt-3 whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">{s.description}</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {s.id != null && (
                      <FollowButton entityType="project" entityId={s.id} initialFollowers={s.followers} />
                    )}
                    {s.website && (
                      <a href={s.website} target="_blank" rel="noreferrer noopener"
                         className="inline-flex items-center gap-1.5 text-sm text-violet-700 hover:underline">
                        <Globe size={14} /> Visit website
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <div className="mt-6 space-y-6">
              {(t.users != null || t.revenue != null || t.funding_needed != null) && (
                <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                    <Target size={16} className="text-emerald-600" /> Traction
                  </h2>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Users" value={t.users != null ? Number(t.users).toLocaleString() : '—'} icon={<Users size={13} />} />
                    <Stat label="Revenue" value={t.revenue != null ? `$${Math.round(t.revenue).toLocaleString()}` : '—'} icon={<DollarSign size={13} />} />
                    <Stat label="Raising" value={t.funding_needed != null ? `$${Math.round(t.funding_needed).toLocaleString()}` : '—'} icon={<DollarSign size={13} />} />
                  </div>
                </section>
              )}

              <Prose title="Problem" body={s.problem_statement} />
              <Prose title="Solution" body={s.solution} />
              <Prose title="Why now" body={s.why_now} />

              {Array.isArray(s.founders) && s.founders.length > 0 && (
                <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                    <Users size={16} className="text-emerald-600" /> Team
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {s.founders.map((f, i) => <PersonCard key={f.handle || i} person={f} />)}
                  </div>
                </section>
              )}

              {Array.isArray(s.updates) && s.updates.length > 0 && (
                <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                    <Newspaper size={16} className="text-emerald-600" /> Latest news
                  </h2>
                  <ul className="space-y-3">
                    {s.updates.map((u, i) => (
                      <li key={u.uid || i} className="border-b border-gray-100 pb-3 last:border-0 dark:border-gray-800">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{u.title || 'Update'}</p>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {u.period ? `${u.period} · ` : ''}
                          {u.submitted_at ? new Date(u.submitted_at).toLocaleDateString() : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <p className="mt-8 text-center text-xs text-gray-400">
              This is a public profile for {s.name || 'this startup'} on Axal StudioOS.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
