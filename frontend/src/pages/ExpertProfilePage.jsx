import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Star, Globe, Calendar, ExternalLink, FileText, ArrowLeft, Shield } from 'lucide-react';
import { api } from '../lib/api';
import AxalCheckout from '../components/AxalCheckout';

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

export default function ExpertProfilePage() {
  const { uid } = useParams();
  const [expert, setExpert] = useState(null);
  const [articles, setArticles] = useState([]);
  const [tab, setTab] = useState('about');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookingState, setBookingState] = useState({ status: 'idle', message: '' });
  const [payIntent, setPayIntent] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [bookerNote, setBookerNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.wellbeingExpertGet(uid)
      .then((data) => {
        if (cancelled) return;
        setExpert(data);
        if (Array.isArray(data?.services) && data.services.length > 0) {
          setSelectedService(data.services[0].uid);
        }
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

  async function handleBook() {
    if (!expert) return;
    setBookingState({ status: 'pending', message: '' });
    setPayIntent(null);
    try {
      const data = {};
      if (selectedService) data.service_uid = selectedService;
      if (bookerNote.trim()) data.booker_note = bookerNote.trim().slice(0, 1000);
      const res = await api.wellbeingExpertBook(expert.uid, data);
      if (res?.client_secret) {
        // Paid session — pay inline via the embedded Axal VC terminal (no redirect
        // to Stripe). The Connect destination transfer to the expert is baked
        // into the server-created PaymentIntent.
        setPayIntent({
          clientSecret: res.client_secret,
          amountCents: res.amount_cents,
          currency: res.currency,
        });
        setBookingState({ status: 'pay', message: '' });
        return;
      }
      setBookingState({ status: 'ok', message: res?.message || 'Booking submitted.' });
    } catch (e) {
      setBookingState({ status: 'err', message: e?.message || 'Could not book this expert.' });
    }
  }

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

  const services = expert.services || [];
  const acceptsPayments = !!expert.accepts_payments;

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

          {tab === 'services' && (
            <div className="space-y-3">
              {services.length === 0 && (
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  No specific services listed — use the booking action below.
                </div>
              )}
              {services.map((s) => (
                <label key={s.uid} className={`flex items-start justify-between gap-3 rounded-lg border p-3 cursor-pointer ${
                  selectedService === s.uid ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950' : 'border-slate-200 dark:border-slate-700'
                }`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="svc"
                      checked={selectedService === s.uid}
                      onChange={() => setSelectedService(s.uid)}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">{s.title}</div>
                      {s.description && (
                        <div className="text-sm text-slate-600 dark:text-slate-300">{s.description}</div>
                      )}
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {s.duration_minutes} min
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {s.price_cents > 0
                        ? `${(s.price_cents / 100).toLocaleString(undefined, { style: 'currency', currency: (s.currency || 'usd').toUpperCase() })}`
                        : 'Free'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

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

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Calendar size={18} /> Book a session
        </h2>
        {expert.profile_completion_pct != null && expert.profile_completion_pct < 70 ? (
          <div className="text-sm text-amber-700 dark:text-amber-400">
            This expert hasn't completed their profile yet — bookings are temporarily unavailable.
          </div>
        ) : (
          <>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
              Note to the expert (optional)
            </label>
            <textarea
              value={bookerNote}
              onChange={(e) => setBookerNote(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Share what you'd like to focus on. The expert never sees your check-ins."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {acceptsPayments
                  ? 'Paid sessions are charged securely in-app via Stripe — you never leave Axal VC. A 15% platform fee is applied.'
                  : 'Free intro or external scheduler — no payment required here.'}
              </div>
              {bookingState.status !== 'pay' && (
                <button
                  onClick={handleBook}
                  disabled={bookingState.status === 'pending'}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {bookingState.status === 'pending' ? 'Working…' : 'Book this expert'}
                  <ExternalLink size={14} />
                </button>
              )}
            </div>

            {bookingState.status === 'pay' && payIntent && (
              <div className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {payIntent.amountCents != null
                    ? `Complete payment · ${(payIntent.amountCents / 100).toLocaleString(undefined, { style: 'currency', currency: (payIntent.currency || 'usd').toUpperCase() })}`
                    : 'Complete payment'}
                </div>
                <AxalCheckout
                  clientSecret={payIntent.clientSecret}
                  submitLabel={payIntent.amountCents != null
                    ? `Pay ${(payIntent.amountCents / 100).toLocaleString(undefined, { style: 'currency', currency: (payIntent.currency || 'usd').toUpperCase() })}`
                    : 'Pay now'}
                  onSuccess={() => {
                    setPayIntent(null);
                    setBookingState({
                      status: 'ok',
                      message: 'Payment successful — your session is confirmed. Check your email for the meeting link.',
                    });
                  }}
                  onError={(err) => setBookingState({ status: 'err', message: err?.message || 'Payment failed. Please try again.' })}
                />
              </div>
            )}

            {bookingState.message && (
              <div className={`mt-3 text-sm ${bookingState.status === 'err' ? 'text-red-600' : 'text-emerald-700'}`}>
                {bookingState.message}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
