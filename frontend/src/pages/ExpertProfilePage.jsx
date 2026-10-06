import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Star, Globe, Calendar, FileText, ArrowLeft, ArrowRight, Shield } from 'lucide-react';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';
import { NotRecorded } from './wellbeing/WellbeingParts';
import { SERVICE_GAP } from './wellbeing/WellbeingBookPage';

/**
 * /wellbeing/expert/:uid — an expert's public profile, and a card that sends a
 * member to book them.
 *
 * THE CARD DOES NOT BOOK. `/wellbeing/book` is the one booking flow (D570).
 * This card used to post its own booking, and failed three ways against
 * `routes/wellbeing.ts`:
 *   - it asked for a note, which a booking never carries (D331);
 *   - it sent no time, so `POST /experts/:uid/book` refused every expert who
 *     has no scheduler of their own ("scheduled_at is required");
 *   - it offered services, and a payment for one, that `GET /experts/:uid`
 *     never returns (`services: null`).
 * It now hands this expert's card to the flow, which lists them first
 * (`withArrived`) and books them the way it books anyone.
 */

/** Who may open `/wellbeing/book`: App.jsx guards the route to these roles. */
export const BOOKING_ROLES = ['admin', 'founder'];

/** The signed-in user as the app shows them: an admin's View As role, else their own. */
export function viewerOf(user, viewMode) {
  const role = String(user?.role || '').toLowerCase();
  return { id: user?.id ?? null, role: role === 'admin' && viewMode ? viewMode : role };
}

function readViewer() {
  let viewMode = null;
  try { viewMode = localStorage.getItem('viewMode'); } catch { /* storage blocked: the account's own role */ }
  return viewerOf(safeReadJSON('user', {}), viewMode);
}

function StarRow({ value }) {
  const v = Math.round((Number(value) || 0) * 2) / 2;
  return (
    <div className="flex items-center gap-0.5 text-amber-500">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} fill={n <= v ? 'currentColor' : 'none'} />
      ))}
    </div>
  );
}

/**
 * The Services tab. The route sends `services: null` to members today, so
 * the tab says so rather than "none listed"; a list, when one is sent, is
 * shown to read. It is not picked from: the booking flow attaches no service.
 */
export function ServicesPanel({ services }) {
  if (!Array.isArray(services)) {
    return <NotRecorded label="Services not recorded" reason={SERVICE_GAP} testId="text-services-gap" />;
  }
  if (!services.length) {
    return <div className="text-sm text-slate-500 dark:text-slate-400">This expert lists no services.</div>;
  }
  return (
    <div className="space-y-3">
      {services.map((s) => (
        <div key={s.uid} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div>
            <div className="font-medium text-slate-900 dark:text-white">{s.title}</div>
            {s.description && (
              <div className="text-sm text-slate-600 dark:text-slate-300">{s.description}</div>
            )}
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {s.duration_minutes} min
            </div>
          </div>
          <div className="text-right font-semibold text-slate-900 dark:text-white">
            {s.price_cents > 0
              ? `${(s.price_cents / 100).toLocaleString(undefined, { style: 'currency', currency: (s.currency || 'usd').toUpperCase() })}`
              : 'Free'}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Book a session. Closed when the route would refuse the booking (an
 * incomplete or hidden profile); the expert's own view of their profile; a
 * link into the flow for the roles that can open it; and a plain line for the
 * rest, whom the flow's route guard would turn away.
 */
export function BookingCard({ expert, viewer = {} }) {
  const closed = expert.hidden
    ? 'This expert is not taking bookings at the moment.'
    : expert.profile_completion_pct != null && expert.profile_completion_pct < 70
      ? 'This expert hasn’t completed their profile yet, so bookings are not open.'
      : null;
  const own = viewer.id != null && expert.user_id != null && String(viewer.id) === String(expert.user_id);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800" data-testid="card-book">
      <h2 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
        <Calendar size={18} /> Book a session
      </h2>
      {closed ? (
        <div className="text-sm text-amber-700 dark:text-amber-400" data-testid="text-booking-closed">{closed}</div>
      ) : own ? (
        <div className="text-sm text-slate-600 dark:text-slate-300" data-testid="text-booking-own">
          This is the profile members see. They book you from the booking flow, and the bookings arrive in{' '}
          <Link to="/wellbeing/practice" className="font-medium text-indigo-600 hover:underline">your practice</Link>.
        </div>
      ) : BOOKING_ROLES.includes(viewer.role) ? (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Choose one of {expert.name}’s open times in the booking flow. A booking is visible to you and the expert alone, and carries no note.
          </div>
          <Link
            to={`/wellbeing/book?expert=${encodeURIComponent(expert.uid)}`}
            state={{ expert }}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            data-testid="link-book-expert"
          >
            Choose a time <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="text-sm text-slate-500 dark:text-slate-400" data-testid="text-booking-founders">
          Booking a wellbeing expert is open to founders.
        </div>
      )}
    </div>
  );
}

export default function ExpertProfilePage() {
  const { uid } = useParams();
  const [expert, setExpert] = useState(null);
  const [articles, setArticles] = useState([]);
  const [tab, setTab] = useState('about');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.wellbeingExpertGet(uid)
      .then((data) => {
        if (cancelled) return;
        setExpert(data);
        if (data?.user_id) {
          api.articlesByAuthor(data.user_id)
            .then((r) => { if (!cancelled) setArticles(r?.articles || r || []); })
            .catch(() => { if (!cancelled) setArticles([]); });
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Could not load expert'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  if (loading) return <div className="p-8 text-slate-500 dark:text-slate-400">Loading…</div>;
  if (error || !expert) {
    return (
      <div className="p-8">
        <Link to="/wellbeing" className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to Wellbeing
        </Link>
        <div className="mt-4 text-slate-700 dark:text-slate-200">{error || 'Expert not found.'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <Link to="/wellbeing" className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1">
        <ArrowLeft size={14} /> Back to Wellbeing
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col sm:flex-row gap-5">
          {expert.photo_url ? (
            <img src={expert.photo_url} alt="" className="w-24 h-24 rounded-full object-cover" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-slate-100 dark:bg-slate-700" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{expert.name}</h1>
              {expert.verified && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                  <Shield size={12} /> Verified
                </span>
              )}
            </div>
            {expert.headline && (
              <p className="mt-1 text-slate-600 dark:text-slate-300">{expert.headline}</p>
            )}
            <div className="mt-2 flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              {expert.rating_avg != null && (
                <span className="inline-flex items-center gap-1">
                  <StarRow value={expert.rating_avg} />
                  <span>{(expert.rating_avg || 0).toFixed(1)} · {expert.rating_count || 0} reviews</span>
                </span>
              )}
              {expert.website_url && (
                <a href={expert.website_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-indigo-600">
                  <Globe size={14} /> Website
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3 border-b border-slate-200 dark:border-slate-700">
          {['about', 'services', 'articles'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                tab === t
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'articles' && articles.length > 0 && (
                <span className="ml-1 text-xs text-slate-400">({articles.length})</span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === 'about' && (
            <div className="space-y-3 text-slate-700 dark:text-slate-200">
              {expert.bio
                ? <p className="whitespace-pre-wrap">{expert.bio}</p>
                : <p className="text-slate-500 dark:text-slate-400">No bio yet.</p>}
              {Array.isArray(expert.categories) && expert.categories.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {expert.categories.map((cat) => (
                    <span key={cat} className="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {String(cat).replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'services' && <ServicesPanel services={expert.services} />}

          {tab === 'articles' && (
            <div className="space-y-2">
              {articles.length === 0 && (
                <div className="text-sm text-slate-500 dark:text-slate-400">No published articles yet.</div>
              )}
              {articles.map((a) => (
                <a key={a.id || a.slug} href={`/articles/${a.slug || a.id}`}
                  className="block rounded-lg border border-slate-200 p-3 hover:border-indigo-400 dark:border-slate-700">
                  <div className="flex items-start gap-2">
                    <FileText size={16} className="text-slate-400 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-white">{a.title || a.slug}</div>
                      {a.excerpt && (
                        <div className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{a.excerpt}</div>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <BookingCard expert={expert} viewer={readViewer()} />
    </div>
  );
}
