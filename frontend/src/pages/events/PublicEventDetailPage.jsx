import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Calendar, MapPin, Clock, Users, ArrowLeft, Loader2, AlertTriangle,
  CheckCircle2, Download
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import { eventsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function renderAgenda(items) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-3">
        Agenda
      </h3>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.id} className="flex gap-3 items-start">
            <div className="text-xs text-slate-500 dark:text-slate-400 w-20 shrink-0 pt-0.5">
              {it.starts_at ? formatTime(it.starts_at) : ''}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{it.title}</p>
              {it.description ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{it.description}</p>
              ) : null}
              {it.speaker_name ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Speaker: {it.speaker_name}
                  {it.speaker_title ? ` — ${it.speaker_title}` : ''}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PublicEventDetailPage() {
  const { slug } = useParams();
  const [event, setEvent] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [seatsTaken, setSeatsTaken] = useState(0);
  const [isFull, setIsFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState({ name: '', email: '' });
  const [status, setStatus] = useState({ state: 'idle', error: '', result: null });
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    eventsPublic.read(slug)
      .then((data) => {
        if (cancelled) return;
        setEvent(data?.event || null);
        setAgenda(Array.isArray(data?.agenda) ? data.agenda : []);
        setSeatsTaken(Number(data?.seats_taken || 0));
        setIsFull(!!data?.is_full);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('public_event_detail_failed', err);
        setError(err?.status === 404 ? 'Event not found.' : 'Unable to load event details.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  // Turnstile lifecycle
  const formVisible = status.state !== 'sent';
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !formVisible || !event) return;
    let cancelled = false;
    let interval;
    const renderTurnstile = () => {
      if (cancelled || !turnstileRef.current) return;
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
      }
      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        theme: 'auto',
      });
    };
    if (typeof window.turnstile === 'undefined') {
      let attempts = 0;
      interval = setInterval(() => {
        attempts += 1;
        if (typeof window.turnstile !== 'undefined' && turnstileRef.current) {
          clearInterval(interval);
          renderTurnstile();
        } else if (attempts >= 50) {
          clearInterval(interval);
        }
      }, 200);
    } else {
      renderTurnstile();
    }
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }
    };
  }, [formVisible, event]);

  const submit = async (e) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus({ state: 'error', error: 'Please complete the verification challenge.', result: null });
      return;
    }
    setStatus({ state: 'sending', error: '', result: null });
    try {
      const res = await eventsPublic.register(slug, {
        name: form.name,
        email: form.email,
        turnstile_token: turnstileToken,
      });
      setStatus({ state: 'sent', error: '', result: res });
      setTurnstileToken('');
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
      }
    } catch (err) {
      const raw = err?.message || '';
      const msg = raw === 'turnstile_failed'
        ? 'Verification failed — please complete the challenge again.'
        : (raw || 'Something went wrong. Please try again.');
      setStatus({ state: 'error', error: msg, result: null });
      if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
        setTurnstileToken('');
      }
    }
  };

  const capacityLabel = () => {
    if (event?.capacity == null) return null;
    const remaining = Math.max(0, event.capacity - seatsTaken);
    if (isFull) return <span className="text-xs text-red-600 dark:text-red-400 font-medium">Full</span>;
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {remaining} spot{remaining === 1 ? '' : 's'} left
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Link to="/events" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-6">
            <ArrowLeft className="w-4 h-4" /> All events
          </Link>

          {loading ? (
            <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" /> Loading event…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : event ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              {event.cover_url ? (
                <div className="h-56 sm:h-72">
                  <img src={event.cover_url} alt={event.title} className="w-full h-full object-cover" />
                </div>
              ) : null}
              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-3">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium uppercase tracking-wide">
                    {event.type?.replace(/_/g, ' ')}
                  </span>
                  {event.approval_required ? (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">Approval required</span>
                  ) : null}
                  {capacityLabel()}
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">{event.title}</h1>
                {event.summary ? (
                  <p className="mt-2 text-base text-slate-600 dark:text-slate-400">{event.summary}</p>
                ) : null}
                <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    {formatDate(event.starts_at)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {formatTime(event.starts_at)}
                    {event.ends_at ? ` — ${formatTime(event.ends_at)}` : ''}
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-slate-400" />
                    {event.location_kind === 'virtual' ? 'Virtual' : (event.location_text || 'TBA')}
                    {event.location_url ? (
                      <a href={event.location_url} target="_blank" rel="noopener noreferrer" className="text-violet-700 dark:text-violet-300 hover:underline ml-1">
                        Join link
                      </a>
                    ) : null}
                  </div>
                  {event.capacity != null ? (
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-400" />
                      {seatsTaken} / {event.capacity} registered
                    </div>
                  ) : null}
                </div>

                {event.description ? (
                  <div className="mt-6 text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">
                    {event.description}
                  </div>
                ) : null}

                {renderAgenda(agenda)}

                {/* Registration form */}
                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                  {status.state === 'sent' ? (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-6">
                      <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-300 font-semibold">
                        <CheckCircle2 className="w-5 h-5" />
                        {status.result?.status === 'waitlisted'
                          ? 'You\'re on the waitlist'
                          : status.result?.status === 'registered' && event.approval_required
                            ? 'Registration submitted — pending approval'
                            : 'Registered'}
                      </div>
                      <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
                        {status.result?.status === 'waitlisted'
                          ? 'If a spot opens up, you\'ll be notified automatically.'
                          : status.result?.status === 'registered' && event.approval_required
                            ? 'The host will review your request and confirm shortly.'
                            : 'You\'re all set. A calendar invite is attached below.'}
                      </p>
                      <div className="mt-4 flex items-center gap-3">
                        <a
                          href={eventsPublic.icsUrl(slug)}
                          download
                          className="inline-flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300 hover:underline"
                        >
                          <Download className="w-4 h-4" /> Download .ics
                        </a>
                        <button
                          type="button"
                          onClick={() => setStatus({ state: 'idle', error: '', result: null })}
                          className="text-sm text-slate-500 dark:text-slate-400 hover:underline"
                        >
                          Register someone else
                        </button>
                      </div>
                    </div>
                  ) : isFull && !event.waitlist_enabled ? (
                    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
                      <div className="flex items-center gap-3 text-red-700 dark:text-red-300 font-semibold">
                        <AlertTriangle className="w-5 h-5" /> This event is full
                      </div>
                      <p className="mt-2 text-sm text-red-800 dark:text-red-200">
                        No spots are currently available.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={submit} className="space-y-4">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {isFull ? 'Join the waitlist' : 'Register'}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Name</span>
                          <input
                            type="text"
                            required
                            maxLength={120}
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Email</span>
                          <input
                            type="email"
                            required
                            maxLength={254}
                            value={form.email}
                            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </label>
                      </div>
                      {status.state === 'error' && (
                        <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{status.error}</span>
                        </div>
                      )}
                      {TURNSTILE_SITE_KEY && (
                        <div ref={turnstileRef} className="flex justify-start" />
                      )}
                      <div className="flex items-center justify-end gap-4 pt-2">
                        <button
                          type="submit"
                          disabled={status.state === 'sending' || (TURNSTILE_SITE_KEY && !turnstileToken)}
                          className="inline-flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {status.state === 'sending' ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : (isFull ? 'Join waitlist' : 'Register')}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
