import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CreditCard, Plus, RefreshCcw } from 'lucide-react';
import { api } from '../lib/api';
import { Card, SectionLabel, Skeleton, Unrecorded, Unreadable, WorkerRail } from '../ui';
import {
  EXPERT_MODALITIES, EXPERT_PRICING_MODELS, browserTimeZone, gridTimeZone, practiceCoverage,
  profileBody, profileDraft, splitBookings,
} from './wellbeing/wellbeingModel';
import { BTN, FIELD, PageHeader, CardHead, Outcome } from './wellbeing/WellbeingParts';
import { AvailabilityCard, PracticeBookingsCard, ServicesCard } from './wellbeing/PracticeZones';

/**
 * /wellbeing/practice — the expert's practice (canvas `wbx-practice`, D570),
 * and /wellbeing/expert-dashboard, which now redirects here.
 *
 * ONE PAGE, EXTENDED RATHER THAN DUPLICATED. This was the expert dashboard:
 * a profile form, payouts, and plain lists of services, availability windows
 * and bookings. The canvas's practice — services with an active switch and
 * edit, a weekly grid, upcoming bookings with names and times only — now
 * leads the page, and the profile and payouts it already had follow under
 * their own label. The old route redirects so the notification links and the
 * Stripe return URL (`?stripe=return`) still land somewhere real.
 *
 * Each zone reads on its own: services from `wellbeingExpertMyServices`,
 * windows from `wellbeingExpertMyAvailability`, bookings from
 * `wellbeingExpertMyBookings`, and the profile from `wellbeingExpertMe`.
 * Writes that change completion (a service, a window) re-read the profile's
 * completion without touching a profile edit in progress.
 *
 * THE BRIEF'S "RATE" IS NOT `wellbeingExpertRate`. That method posts a
 * member's star rating of an expert (`POST /experts/:uid/rate`), and lives on
 * the member's past bookings. An expert's prices are each service's rate here,
 * and the directory's hourly rate is the profile's.
 */

const IDLE = { busy: false, error: null, ok: null };

function Field({ label, htmlFor, children, error }) {
  return (
    <div>
      <label className={FIELD.label} htmlFor={htmlFor}>{label}</label>
      {children}
      {error && <p role="alert" className={FIELD.error}>{error}</p>}
    </div>
  );
}

export function BecomeExpert({ busy, error, onApply }) {
  return (
    <Card padding="lg" className="max-w-2xl space-y-3" data-testid="card-become-expert">
      <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Become a wellbeing expert</h2>
      <p className="text-[13px] text-axal-muted dark:text-gray-400">
        Create your expert profile to appear in the wellbeing directory once it is complete and verified.
        You can then list services, open weekly hours and set up payouts.
      </p>
      <button type="button" className={BTN.primary} onClick={onApply} disabled={busy}>
        {busy ? 'Creating…' : 'Create my expert profile'}
      </button>
      <Outcome error={error} />
    </Card>
  );
}

export default function ExpertEditorPage() {
  const fallbackZone = useMemo(() => browserTimeZone(), []);
  const [me, setMe] = useState({ status: 'loading', expert: null });
  const [services, setServices] = useState({ status: 'loading', rows: [] });
  const [windows, setWindows] = useState({ status: 'loading', rows: [] });
  const [bookings, setBookings] = useState({ status: 'loading', rows: [] });
  const [creating, setCreating] = useState(false);
  const [availability, setAvailability] = useState(IDLE);
  const [bookingAct, setBookingAct] = useState({ busyUid: null, error: null, ok: null });
  const [draft, setDraft] = useState(null);
  const [profile, setProfile] = useState({ ...IDLE, fields: {} });
  const [stripe, setStripe] = useState({ account_id: null, charges_enabled: false, payouts_enabled: false });
  const [payouts, setPayouts] = useState(IDLE);
  const [apply, setApply] = useState(IDLE);

  // `fillDraft` is false for the re-reads a practice write triggers, so a
  // profile edit in progress is never replaced by the stored one.
  const loadMe = useCallback(async ({ fillDraft = true } = {}) => {
    try {
      const expert = await api.wellbeingExpertMe();
      setMe({ status: 'ready', expert });
      setStripe(expert?.stripe || { account_id: null, charges_enabled: false, payouts_enabled: false });
      if (fillDraft) setDraft(profileDraft(expert));
    } catch (e) {
      setMe({ status: e?.status === 404 ? 'missing' : 'unreadable', expert: null });
    }
  }, []);

  const loadServices = useCallback(async () => {
    try {
      const r = await api.wellbeingExpertMyServices();
      setServices({ status: 'ready', rows: Array.isArray(r?.services) ? r.services : [] });
    } catch {
      setServices({ status: 'unreadable', rows: [] });
    }
  }, []);
  const loadWindows = useCallback(async () => {
    try {
      const r = await api.wellbeingExpertMyAvailability();
      setWindows({ status: 'ready', rows: Array.isArray(r?.availability) ? r.availability : [] });
    } catch {
      setWindows({ status: 'unreadable', rows: [] });
    }
  }, []);
  const loadBookings = useCallback(async () => {
    try {
      const r = await api.wellbeingExpertMyBookings();
      setBookings({ status: 'ready', rows: Array.isArray(r?.bookings) ? r.bookings : [] });
    } catch {
      setBookings({ status: 'unreadable', rows: [] });
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);
  // On arriving at `ready` only. A later re-read of the profile keeps the
  // status `ready`, so it does not re-read the zones; each zone re-reads
  // itself after its own writes.
  const isReady = me.status === 'ready';
  useEffect(() => {
    if (!isReady) return;
    loadServices();
    loadWindows();
    loadBookings();
  }, [isReady, loadServices, loadWindows, loadBookings]);

  const timeZone = gridTimeZone(windows.rows, fallbackZone);

  // --- services ----------------------------------------------------------
  const afterServiceWrite = async () => { await loadServices(); await loadMe({ fillDraft: false }); };
  const createService = async (body) => { await api.wellbeingExpertServiceCreate(body); await afterServiceWrite(); };
  const updateService = async (uid, patch) => { await api.wellbeingExpertServiceUpdate(uid, patch); await afterServiceWrite(); };
  const deleteService = async (uid) => { await api.wellbeingExpertServiceDelete(uid); await afterServiceWrite(); };

  // --- availability --------------------------------------------------------
  const availabilityWrite = async (fn, ok) => {
    setAvailability({ busy: true, error: null, ok: null });
    try {
      await fn();
      setAvailability({ busy: false, error: null, ok });
    } catch (e) {
      setAvailability({ busy: false, error: e?.message || 'That change could not be saved.', ok: null });
    }
    await loadWindows();
    await loadMe({ fillDraft: false });
  };
  const openHour = (body) => availabilityWrite(() => api.wellbeingExpertAvailabilityCreate(body), 'Hour opened.');
  const closeHour = (uid) => availabilityWrite(() => api.wellbeingExpertAvailabilityDelete(uid), 'Hour closed.');
  const removeWindows = (uids) => availabilityWrite(async () => {
    // One delete per window. A failure part-way is reported with what was
    // already removed, because the grid re-read below shows the rest.
    let removed = 0;
    for (const uid of uids) {
      try {
        await api.wellbeingExpertAvailabilityDelete(uid);
        removed += 1;
      } catch (e) {
        throw new Error(`${removed ? `${removed} window${removed === 1 ? '' : 's'} removed, then: ` : ''}${e?.message || 'a window could not be removed.'}`);
      }
    }
  }, uids.length === 1 ? 'Window removed.' : 'Windows removed.');

  // --- bookings ------------------------------------------------------------
  const bookingAction = async (booking, status) => {
    setBookingAct({ busyUid: booking.uid, error: null, ok: null });
    try {
      await api.wellbeingExpertBookingPatch(booking.uid, { status });
      setBookingAct({ busyUid: null, error: null, ok: { confirmed: 'Booking confirmed.', cancelled: 'Booking cancelled. The member is told.', completed: 'Marked completed.' }[status] || 'Booking updated.' });
      await loadBookings();
    } catch (e) {
      setBookingAct({ busyUid: null, error: e?.message || 'The booking could not be updated.', ok: null });
    }
  };

  // --- profile and payouts ---------------------------------------------------
  const saveProfile = async () => {
    const parsed = profileBody(draft);
    if (!parsed.ok) { setProfile({ ...IDLE, fields: parsed.fields }); return; }
    setProfile({ busy: true, error: null, ok: null, fields: {} });
    try {
      await api.wellbeingExpertMeUpdate(parsed.body);
      setProfile({ busy: false, error: null, ok: 'Profile saved.', fields: {} });
      await loadMe();
    } catch (e) {
      setProfile({ busy: false, error: e?.message || 'The profile could not be saved.', ok: null, fields: {} });
    }
  };
  const connectStripe = async () => {
    setPayouts({ busy: true, error: null, ok: null });
    try {
      const r = await api.wellbeingExpertStripeConnect();
      if (r?.url) window.location.href = r.url;
      else setPayouts({ busy: false, error: 'Stripe returned no onboarding link.', ok: null });
    } catch (e) {
      setPayouts({ busy: false, error: e?.message || 'Stripe Connect could not be started.', ok: null });
    }
  };
  const refreshStripe = async () => {
    setPayouts({ busy: true, error: null, ok: null });
    try {
      const r = await api.wellbeingExpertStripeStatus();
      setStripe(r);
      setPayouts({ busy: false, error: r?.error ? 'Stripe could not be reached; this is the last status on record.' : null, ok: r?.error ? null : 'Payout status refreshed.' });
    } catch (e) {
      setPayouts({ busy: false, error: e?.message || 'The payout status could not be read.', ok: null });
    }
  };
  const applyNow = async () => {
    setApply({ busy: true, error: null, ok: null });
    try {
      await api.wellbeingExpertApply({});
      setApply(IDLE);
      await loadMe();
    } catch (e) {
      setApply({ busy: false, error: e?.message || 'The profile could not be created.', ok: null });
    }
  };

  const ready = me.status === 'ready';
  const upcoming = bookings.status === 'ready' ? splitBookings(bookings.rows).upcoming.length : null;
  const expert = me.expert;
  const completion = Number(expert?.profile_completion_pct);
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_var(--fwr-track,286px)]" data-testid="wellbeing-practice">
      <section className="min-w-0 space-y-4" aria-label="My practice">
        <PageHeader
          title="My practice"
          sub="Your services, weekly availability and upcoming bookings. Bookings show names and times only."
          action={ready ? (
            <button type="button" className={BTN.primary} onClick={() => setCreating(true)} data-testid="button-new-service">
              <Plus size={14} aria-hidden="true" /> New service
            </button>
          ) : null}
        />

        {me.status === 'loading' ? <Skeleton.Card /> : me.status === 'missing' ? (
          <BecomeExpert busy={apply.busy} error={apply.error} onApply={applyNow} />
        ) : me.status === 'unreadable' ? (
          <Card><Unreadable what="Your practice" claim="This is not a sign that you have no expert profile." onRetry={() => loadMe()} /></Card>
        ) : (
          <>
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="space-y-4">
                <ServicesCard
                  status={services.status}
                  services={services.rows}
                  creating={creating}
                  onCreatingChange={setCreating}
                  onCreate={createService}
                  onUpdate={updateService}
                  onDelete={deleteService}
                  onRetry={loadServices}
                />
                <AvailabilityCard
                  status={windows.status}
                  windows={windows.rows}
                  bookings={bookings.rows}
                  timeZone={timeZone}
                  busy={availability.busy}
                  error={availability.error}
                  ok={availability.ok}
                  onRetry={loadWindows}
                  onOpen={openHour}
                  onClose={closeHour}
                  onRemove={removeWindows}
                />
              </div>
              <PracticeBookingsCard
                status={bookings.status}
                bookings={bookings.rows}
                busyUid={bookingAct.busyUid}
                error={bookingAct.error}
                ok={bookingAct.ok}
                onAction={bookingAction}
                onRetry={loadBookings}
              />
            </div>

            <SectionLabel as="h2" className="pt-2">Profile and payouts</SectionLabel>

            <Card data-testid="card-completion">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">Profile completion</div>
                  <div className="text-xs text-axal-muted dark:text-gray-400">At 70% or more, a verified profile is listed in the directory and can take bookings.</div>
                </div>
                <div className="text-2xl font-extrabold tabular-nums text-axal-ink dark:text-gray-100">
                  {Number.isFinite(completion) ? `${completion}%` : <Unrecorded reason="The profile carries no completion figure.">Not recorded</Unrecorded>}
                </div>
              </div>
              {Number.isFinite(completion) && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
                  <div className={`h-full ${completion >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} />
                </div>
              )}
              {expert?.uid && (
                <Link to={`/wellbeing/expert/${expert.uid}`} className={`${BTN.link} mt-2`}>View public profile →</Link>
              )}
            </Card>

            {draft && (
              <Card padding="lg" data-testid="card-profile">
                <CardHead title="Profile" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Display name" htmlFor="pf-name"><input id="pf-name" className={FIELD.input} value={draft.name} onChange={set('name')} /></Field>
                  <Field label="Headline" htmlFor="pf-headline"><input id="pf-headline" className={FIELD.input} value={draft.headline} onChange={set('headline')} /></Field>
                  <Field label="Photo URL" htmlFor="pf-photo"><input id="pf-photo" className={FIELD.input} value={draft.photo_url} onChange={set('photo_url')} /></Field>
                  <Field label="Website" htmlFor="pf-website"><input id="pf-website" className={FIELD.input} value={draft.website_url} onChange={set('website_url')} /></Field>
                  <Field label="External scheduler URL (optional)" htmlFor="pf-calendly"><input id="pf-calendly" className={FIELD.input} value={draft.calendly_url} onChange={set('calendly_url')} /></Field>
                  <Field label="Pricing model" htmlFor="pf-pricing">
                    <select id="pf-pricing" className={FIELD.input} value={draft.pricing_model} onChange={set('pricing_model')}>
                      {EXPERT_PRICING_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="Hourly rate, shown on your directory card (USD)" htmlFor="pf-rate" error={profile.fields?.hourly_rate_usd}>
                    <input id="pf-rate" className={FIELD.input} inputMode="decimal" value={draft.hourly_rate_usd} onChange={set('hourly_rate_usd')} placeholder="Not recorded" />
                  </Field>
                  <Field label="Categories (comma-separated)" htmlFor="pf-categories"><input id="pf-categories" className={FIELD.input} value={draft.categories} onChange={set('categories')} /></Field>
                  <Field label="Sectors (comma-separated)" htmlFor="pf-sectors"><input id="pf-sectors" className={FIELD.input} value={draft.sectors} onChange={set('sectors')} /></Field>
                  <Field label="Languages (comma-separated)" htmlFor="pf-languages"><input id="pf-languages" className={FIELD.input} value={draft.languages} onChange={set('languages')} /></Field>
                  <Field label="Time zones (comma-separated IANA)" htmlFor="pf-timezones"><input id="pf-timezones" className={FIELD.input} value={draft.timezones} onChange={set('timezones')} /></Field>
                </div>
                <div className="mt-3">
                  <Field label="Bio" htmlFor="pf-bio"><textarea id="pf-bio" rows={5} className={FIELD.input} value={draft.bio} onChange={set('bio')} /></Field>
                </div>
                <fieldset className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-axal-ink dark:text-gray-100">
                  <legend className="sr-only">How you meet members</legend>
                  <span className="text-xs font-semibold">How you meet:</span>
                  {EXPERT_MODALITIES.map(([m, l]) => (
                    <label key={m} className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={draft.modalities.includes(m)}
                        onChange={(e) => setDraft((d) => {
                          const next = new Set(d.modalities);
                          if (e.target.checked) next.add(m); else next.delete(m);
                          return { ...d, modalities: [...next] };
                        })}
                      />
                      {l}
                    </label>
                  ))}
                  <label className="inline-flex items-center gap-1.5 sm:ml-3">
                    <input type="checkbox" checked={draft.first_session_free} onChange={(e) => setDraft((d) => ({ ...d, first_session_free: e.target.checked }))} />
                    First session free
                  </label>
                </fieldset>
                <p className={`${FIELD.note} mt-2`}>An hourly rate left empty is kept as it is: the directory shows “Rate not recorded” until one is set.</p>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                  <Outcome ok={profile.ok} error={profile.error} testId="profile" />
                  <button type="button" className={BTN.primary} onClick={saveProfile} disabled={profile.busy}>
                    {profile.busy ? 'Saving…' : 'Save profile'}
                  </button>
                </div>
              </Card>
            )}

            <Card padding="lg" data-testid="card-payouts">
              <CardHead title={<span className="inline-flex items-center gap-2"><CreditCard size={16} aria-hidden="true" /> Payouts · Stripe Connect</span>} />
              {stripe.account_id ? (
                <div className="space-y-2 text-[13px]">
                  <div className="text-axal-muted dark:text-gray-400">Account: <code className="text-xs">{stripe.account_id}</code></div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`inline-flex items-center gap-1 ${stripe.charges_enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-amber-deep dark:text-amber-300'}`}>
                      {stripe.charges_enabled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} Charges {stripe.charges_enabled ? 'enabled' : 'pending'}
                    </span>
                    <span className={`inline-flex items-center gap-1 ${stripe.payouts_enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-amber-deep dark:text-amber-300'}`}>
                      {stripe.payouts_enabled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} Payouts {stripe.payouts_enabled ? 'enabled' : 'pending'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" className={BTN.ghost} onClick={connectStripe} disabled={payouts.busy}>Continue onboarding</button>
                    <button type="button" className={BTN.ghost} onClick={refreshStripe} disabled={payouts.busy}><RefreshCcw size={14} aria-hidden="true" /> Refresh</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[13px] text-axal-muted dark:text-gray-400">Connect Stripe to take paid sessions. Axal VC applies a 15% platform fee.</p>
                  <button type="button" className={BTN.primary} onClick={connectStripe} disabled={payouts.busy}>Set up payouts</button>
                </div>
              )}
              <div className="mt-2"><Outcome ok={payouts.ok} error={payouts.error} testId="payouts" /></div>
            </Card>
          </>
        )}
      </section>
      <WorkerRail
        workspace="Wellbeing practice"
        role="advisor"
        className="self-start lg:sticky lg:top-4"
        stance="Your practice, as stored"
        note="Eadwyn reads back counts only: services, open hours and upcoming bookings. It never sees a member’s name or note, and it changes nothing here."
        coverage={practiceCoverage({
          services: services.status === 'ready' ? services.rows : null,
          windows: windows.status === 'ready' ? windows.rows : null,
          upcoming,
        })}
        coverageNote="Counts only. A member’s name never leaves this page."
        unavailable={[
          ['Which hours to open', 'No route records the times members asked for and could not get, so there is nothing to suggest from.'],
        ]}
      />
    </div>
  );
}
