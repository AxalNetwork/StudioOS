import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Globe, ShieldCheck, Sparkles,
  Briefcase, Target, Star, Users, DollarSign,
} from 'lucide-react';
import { api } from '../lib/api';
import TrustScoreBadge from '../components/TrustScoreBadge';

// Task #4 (Y-2) — admin / partner / investor viewers see the profile
// owner's trust score next to their identity badge. Other roles + the
// unauthenticated public never see it (the backend 403s and we render
// nothing). Self-view is also allowed.
function ProfileTrustBadge({ userId, size = 'sm' }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    api.trustScore(userId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);
  if (!data) return null;
  return <TrustScoreBadge size={size} score={data.score} missing={data.missing} label="Trust" />;
}

// Brand icons were removed in lucide-react v1; inline minimal SVGs instead.
const Linkedin = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM10 9h3.8v1.71h.05c.53-.95 1.83-1.95 3.77-1.95C21.4 8.76 22 11.06 22 14.06V21h-4v-6.2c0-1.48-.03-3.39-2.07-3.39-2.07 0-2.39 1.62-2.39 3.29V21h-4z"/>
  </svg>
);
const Twitter = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2H21l-6.52 7.45L22 22h-6.79l-4.78-6.26L4.8 22H2.04l6.97-7.97L2 2h6.91l4.32 5.71L18.244 2zm-2.38 18h1.88L7.22 4H5.27l10.6 16z"/>
  </svg>
);
const Github = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.18-1.49 3.14-1.18 3.14-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.7.41.36.78 1.07.78 2.16 0 1.56-.01 2.81-.01 3.19 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5z"/>
  </svg>
);

// Per-role badge colour. Keeps the surface visually distinct so a
// visitor instantly knows whether they're on a founder, investor, or
// partner page.
const ROLE_STYLES = {
  founder:  { label: 'Founder',  ring: 'ring-emerald-200', bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  investor: { label: 'Investor', ring: 'ring-violet-200',  bg: 'bg-violet-50',   text: 'text-violet-700'  },
  partner:  { label: 'Partner',  ring: 'ring-amber-200',   bg: 'bg-amber-50',    text: 'text-amber-700'   },
  admin:    { label: 'Team',     ring: 'ring-slate-200',   bg: 'bg-slate-50',    text: 'text-slate-700'   },
};

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

function FounderBlock({ p }) {
  return (
    <>
      {p.projects && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <Briefcase size={16} className="text-emerald-600" /> Projects
          </h2>
          {p.projects.length === 0 ? (
            <p className="text-sm text-gray-500">No public projects yet.</p>
          ) : (
            <ul className="space-y-2">
              {p.projects.map((proj, i) => (
                <li key={i} className="flex items-center justify-between border-b border-gray-100 pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{proj.name}</p>
                    {proj.sector && <p className="text-xs text-gray-500">{proj.sector}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {proj.stage && <Badge tone="slate">{proj.stage}</Badge>}
                    {proj.week && <Badge tone="emerald">{proj.week}</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {p.traction && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <Target size={16} className="text-emerald-600" /> Traction
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Active projects" value={p.traction.active_projects ?? '—'} />
            <Stat label="Users" value={p.traction.users != null ? p.traction.users.toLocaleString() : '—'} icon={<Users size={13} />} />
            <Stat label="Revenue" value={p.traction.revenue != null ? `$${Math.round(p.traction.revenue).toLocaleString()}` : '—'} icon={<DollarSign size={13} />} />
          </div>
        </section>
      )}
    </>
  );
}

function InvestorBlock({ p }) {
  return (
    <>
      {p.thesis && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <Target size={16} className="text-violet-600" /> Investment thesis
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Type" value={(p.thesis.investor_type || '—').toUpperCase()} />
            <Stat label="Accreditation" value={p.thesis.accredited ? 'Verified' : 'Self-attested'} />
            <Stat label="Sector focus" value={p.thesis.sector_focus || '—'} />
            <Stat label="Stage focus" value={p.thesis.stage_focus || '—'} />
            <Stat
              label="Check size"
              value={p.thesis.check_size_min != null || p.thesis.check_size_max != null
                ? `$${(p.thesis.check_size_min ?? 0).toLocaleString()}–$${(p.thesis.check_size_max ?? 0).toLocaleString()}`
                : '—'}
            />
            {p.thesis.accredited && (
              <Stat label="Status" value={<span className="inline-flex items-center gap-1"><ShieldCheck size={13} className="text-emerald-600" />Accredited</span>} />
            )}
          </div>
        </section>
      )}
      {p.portfolio_summary && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Portfolio</h2>
          <p className="text-sm text-gray-600">{p.portfolio_summary.engagements ?? 0} capital engagement{p.portfolio_summary.engagements === 1 ? '' : 's'}.</p>
          <p className="mt-1 text-xs text-gray-400">Specific deals are private.</p>
        </section>
      )}
    </>
  );
}

function PartnerBlock({ p }) {
  return (
    <>
      {p.services && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Briefcase size={16} className="text-amber-600" /> Services
            </h2>
            {p.services.kyb_verified && (
              <Badge tone="emerald"><ShieldCheck size={12} /> KYB verified</Badge>
            )}
          </div>
          {p.services.headline && <p className="mb-3 text-sm text-gray-800">{p.services.headline}</p>}
          {p.services.specialization && <p className="mb-3 text-sm text-gray-600">{p.services.specialization}</p>}
          <div className="flex flex-wrap gap-2">
            {(p.services.categories || []).map((c) => <Badge key={c} tone="slate">{String(c).replace(/_/g, ' ')}</Badge>)}
            {(p.services.sectors || []).map((s) => <Badge key={s} tone="violet">{String(s).replace(/_/g, ' ')}</Badge>)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Capacity" value={<span className="capitalize">{p.services.capacity_status || '—'}</span>} />
            <Stat label="Response time" value={p.services.response_time_hours != null ? `${p.services.response_time_hours}h` : '—'} />
            {p.services.directory_slug && (
              <Stat label="Marketplace" value={
                <Link to={`/partners/${p.services.directory_slug}`} className="text-violet-700 hover:underline">View listing</Link>
              } />
            )}
          </div>
        </section>
      )}
      {p.pricing && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <DollarSign size={16} className="text-amber-600" /> Pricing
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Tier" value={p.pricing.tier || '—'} />
            <Stat label="Hourly rate" value={
              p.pricing.hourly_min != null || p.pricing.hourly_max != null
                ? `$${p.pricing.hourly_min ?? '?'}–$${p.pricing.hourly_max ?? '?'}/h`
                : '—'
            } />
          </div>
        </section>
      )}
      {p.reviews && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <Star size={16} className="text-amber-500" /> Reviews
          </h2>
          {p.reviews.count > 0 ? (
            <p className="text-sm text-gray-700">
              <span className="font-semibold">{p.reviews.avg_rating?.toFixed(1)} / 5</span>
              <span className="text-gray-500"> · {p.reviews.count} review{p.reviews.count === 1 ? '' : 's'}</span>
            </p>
          ) : (
            <p className="text-sm text-gray-500">No reviews yet.</p>
          )}
        </section>
      )}
    </>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-[11px] uppercase text-gray-500">{label}</p>
      <p className="mt-1 inline-flex items-center gap-1 text-sm text-gray-900">{icon}{value}</p>
    </div>
  );
}

function SocialLink({ kind, href }) {
  const Icon = { linkedin: Linkedin, twitter: Twitter, github: Github, website: Globe }[kind] || Globe;
  return (
    <a href={/^https?:/.test(href) ? href : `https://${href}`} target="_blank" rel="noreferrer noopener"
       className="inline-flex items-center gap-1.5 text-sm text-violet-700 hover:underline">
      <Icon size={14} /> {String(href).replace(/^https?:\/\//, '')}
    </a>
  );
}

export default function PublicProfilePage() {
  const { handle } = useParams();
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true); setError(null);
    api.publicGetUserByHandle(handle)
      .then(setP)
      .catch((e) => setError(e.status === 404 ? 'Profile not found' : (e.message || 'Failed to load profile')))
      .finally(() => setLoading(false));
  }, [handle]);

  const role = (p?.role || 'admin').toLowerCase();
  const styles = ROLE_STYLES[role] || ROLE_STYLES.admin;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft size={16} /> Axal StudioOS
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

        {p && (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start gap-5">
                {p.headshot_url ? (
                  <img src={p.headshot_url} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-white shadow" />
                ) : (
                  <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-2xl font-semibold ${styles.bg} ${styles.text} ring-2 ring-white shadow`}>
                    {(p.name || p.handle || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold text-gray-900">{p.name || `@${p.handle}`}</h1>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${styles.bg} ${styles.text} ${styles.ring}`}>
                      <Sparkles size={12} /> {styles.label}
                    </span>
                    {p.user_id && <ProfileTrustBadge userId={p.user_id} size={role === 'founder' ? 'md' : 'sm'} />}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-gray-400">@{p.handle}</p>
                  {p.bio && <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{p.bio}</p>}
                  {Object.keys(p.socials || {}).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {Object.entries(p.socials).map(([k, v]) => <SocialLink key={k} kind={k} href={v} />)}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="mt-6 space-y-6">
              {role === 'founder'  && <FounderBlock  p={p} />}
              {role === 'investor' && <InvestorBlock p={p} />}
              {role === 'partner'  && <PartnerBlock  p={p} />}
            </div>

            <p className="mt-8 text-center text-xs text-gray-400">
              Public information is controlled by {p.name ? p.name.split(' ')[0] : 'this member'} in their privacy settings.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
