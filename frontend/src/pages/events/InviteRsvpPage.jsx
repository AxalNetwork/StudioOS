import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Calendar, MapPin, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, Download,
  CreditCard, LogIn,
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import AxalCheckout from '../../components/AxalCheckout';
import { eventsPublic, events } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { reportError } from '../../lib/log';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

function formatMoney(cents, currency) {
  const amt = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(amt);
  } catch { return `$${amt.toFixed(2)}`; }
}

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

export default function InviteRsvpPage() {
  const { token } = useParams();
  const [invite, setInvite] = useState(null);
  const [event, setEvent] = useState(null);
  const [, setAgenda] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [status, setStatus] = useState({ state: 'idle', error: '' });
  const [payment, setPayment] = useState(null); // { clientSecret, amountCents, currency } when a paid ticket needs payment
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);
  const { user } = useAuth();

  // A paid, non-comp ticket — the only case that needs an inline payment step.
  const isPaidTicket = !!event && Number(event.price_cents) > 0 && !invite?.comp;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    eventsPublic.invite(token)
      .then((data) => {
        if (cancelled) return;
        setInvite(data?.invitation || null);
        setEvent(data?.event || null);
        setAgenda(Array.isArray(data?.agenda) ? data.agenda : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('invite_rsvp_load_failed', err);
        const msg = err?.status === 404 ? 'Invitation not found.'
          : err?.status === 409 ? 'This invitation has been revoked.'
          : 'Unable to load invitation.';
        setError(msg);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  // Turnstile (only on the accept/decline form, not the payment / sign-in panels)
  const formVisible = !['sent', 'paying', 'needs_auth'].includes(status.state) && !error && !loading;
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

  // Mint (or resume) the PaymentIntent for a paid seat via the authenticated
  // self-register endpoint — the only path that returns a client_secret. The
  // public invite respond marks acceptance but never holds an unpaid seat, so
  // the signed-in invitee must register-as-self to pay. The call is idempotent:
  // an existing pending seat resumes payment; an already-paid seat needs none.
  const startPayment = async () => {
    if (!event?.id) return;
    setStatus({ state: 'sending', error: '' });
    setPayment(null);
    try {
      const res = await events.register(event.id);
      if (res?.client_secret) {
        setPayment({
          clientSecret: res.client_secret,
          amountCents: res.registration?.amount_cents ?? event?.price_cents ?? null,
          currency: event?.currency || 'usd',
        });
        setStatus({ state: 'paying', error: '', result: res });
        return;
      }
      if (res?.needs_payment) {
        setStatus({
          state: 'error',
          error: 'We couldn\'t start payment. Make sure you\'re signed in with the account this invitation was sent to.',
        });
        return;
      }
      // No payment required (e.g. already paid) — treat the seat as confirmed.
      setStatus({ state: 'sent', error: '', result: { ...res, status: 'accepted' } });
    } catch (err) {
      // Stale cached auth (a previously signed-in user whose session has since
      // expired) surfaces here as a 401. request() has already cleared the
      // token; route them to the sign-in panel instead of a dead-end error so
      // they can re-authenticate and resume payment.
      if (err?.status === 401) {
        setPayment(null);
        setStatus({ state: 'needs_auth', error: '' });
        return;
      }
      const raw = err?.message || '';
      const msg = raw === 'invite_required'
        ? 'This invitation is tied to a specific email. Please sign in with the address it was sent to.'
        : raw === 'full'
          ? 'This event is now full, so payment can\'t be completed.'
          : (raw || 'Something went wrong starting payment. Please try again.');
      setStatus({ state: 'error', error: msg });
    }
  };

  const respond = async (action) => {
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus({ state: 'error', error: 'Please complete the verification challenge.' });
      return;
    }
    setStatus({ state: 'sending', error: '' });
    try {
      const res = await eventsPublic.respondInvite(token, { action, turnstile_token: turnstileToken });
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }
      // Paid (non-comp) accept: the backend recorded acceptance but won't hold
      // an unpaid seat. Route the invitee into payment instead of a misleading
      // "you're all set" — sign-in first if they're not authenticated.
      if (action === 'accept' && res?.needs_payment) {
        if (user) {
          await startPayment();
        } else {
          setStatus({ state: 'needs_auth', error: '', result: res });
        }
        return;
      }
      setStatus({ state: 'sent', error: '', result: res });
    } catch (err) {
      const raw = err?.message || '';
      const msg = raw === 'turnstile_failed'
        ? 'Verification failed — please complete the challenge again.'
        : (raw || 'Something went wrong. Please try again.');
      setStatus({ state: 'error', error: msg });
      if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
        setTurnstileToken('');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {loading ? (
            <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" /> Loading invitation…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
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
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium uppercase tracking-wide">
                    {event.type?.replace(/_/g, ' ')}
                  </span>
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
                  </div>
                </div>

                {invite?.personal_message ? (
                  <div className="mt-6 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-4">
                    <p className="text-sm text-violet-800 dark:text-violet-200 italic">
                      “{invite.personal_message}”
                    </p>
                  </div>
                ) : null}

                {/* RSVP actions */}
                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                  {status.state === 'paying' && payment ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
                      <div className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                        {payment.amountCents != null
                          ? `Complete payment · ${formatMoney(payment.amountCents, payment.currency)}`
                          : 'Complete payment'}
                      </div>
                      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                        Your spot is held. Pay below to confirm your ticket — you won't leave this page.
                      </p>
                      <AxalCheckout
                        clientSecret={payment.clientSecret}
                        submitLabel={payment.amountCents != null ? `Pay ${formatMoney(payment.amountCents, payment.currency)}` : 'Pay now'}
                        onSuccess={() => {
                          setPayment(null);
                          setStatus((s) => ({ state: 'sent', error: '', result: { ...(s.result || {}), status: 'accepted', paid: true } }));
                        }}
                        onError={(err) => setStatus((s) => ({ ...s, error: err?.message || 'Payment failed. Please try again.' }))}
                      />
                      {status.error && (
                        <div className="mt-3 flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{status.error}</span>
                        </div>
                      )}
                    </div>
                  ) : status.state === 'sent' ? (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-6">
                      <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-300 font-semibold">
                        <CheckCircle2 className="w-5 h-5" />
                        {status.result?.status === 'declined' ? 'Declined' : 'Response recorded'}
                      </div>
                      <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
                        {status.result?.status === 'declined'
                          ? 'You\'ve declined this invitation. If you change your mind, contact the host.'
                          : status.result?.paid
                            ? 'Payment received — your ticket is confirmed once the payment clears. A calendar invite is attached below.'
                            : 'You\'re all set. A calendar invite is attached below.'}
                      </p>
                      {status.result?.status !== 'declined' ? (
                        <div className="mt-4 flex items-center gap-3">
                          <a
                            href={eventsPublic.icsUrl(event.slug)}
                            download
                            className="inline-flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300 hover:underline"
                          >
                            <Download className="w-4 h-4" /> Download .ics
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ) : status.state === 'needs_auth' ? (
                    <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-6">
                      <div className="flex items-center gap-3 text-violet-800 dark:text-violet-200 font-semibold">
                        <CheckCircle2 className="w-5 h-5" /> You've accepted — one more step
                      </div>
                      <p className="mt-2 text-sm text-violet-800 dark:text-violet-200">
                        This is a paid event
                        {isPaidTicket && event?.price_cents ? ` (${formatMoney(event.price_cents, event.currency)})` : ''}.
                        Sign in with the account this invitation was sent to, then return here to pay and confirm your seat.
                      </p>
                      <div className="mt-4">
                        <a
                          href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : `/invite/${token}`)}`}
                          className="inline-flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg"
                        >
                          <LogIn className="w-4 h-4" /> Sign in to pay
                        </a>
                      </div>
                    </div>
                  ) : (user && isPaidTicket && invite?.status === 'accepted') ? (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
                      <div className="flex items-center gap-3 text-amber-800 dark:text-amber-200 font-semibold">
                        <CreditCard className="w-5 h-5" /> Payment needed to confirm your seat
                      </div>
                      <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
                        You've accepted this paid invitation. Complete payment
                        {event?.price_cents ? ` (${formatMoney(event.price_cents, event.currency)})` : ''} to lock in your ticket.
                      </p>
                      {status.state === 'error' && status.error ? (
                        <div className="mt-3 flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{status.error}</span>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={startPayment}
                        disabled={status.state === 'sending'}
                        className="mt-4 inline-flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {status.state === 'sending'
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
                          : <><CreditCard className="w-4 h-4" /> Complete payment</>}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {invite?.invited_name ? `Hi ${invite.invited_name}, will you attend?` : 'Will you attend?'}
                      </h3>
                      {status.state === 'error' && (
                        <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{status.error}</span>
                        </div>
                      )}
                      {TURNSTILE_SITE_KEY && (
                        <div ref={turnstileRef} className="flex justify-start" />
                      )}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => respond('accept')}
                          disabled={status.state === 'sending' || (TURNSTILE_SITE_KEY && !turnstileToken)}
                          className="inline-flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {status.state === 'sending' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="w-4 h-4" /> Accept</>}
                        </button>
                        <button
                          type="button"
                          onClick={() => respond('decline')}
                          disabled={status.state === 'sending' || (TURNSTILE_SITE_KEY && !turnstileToken)}
                          className="inline-flex items-center gap-2 px-5 py-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <XCircle className="w-4 h-4" /> Decline
                        </button>
                      </div>
                    </div>
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
