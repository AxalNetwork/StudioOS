import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, CreditCard, RefreshCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';

const MODALITY_OPTIONS = ['video', 'in_person', 'chat', 'phone'];
const PRICING_OPTIONS = ['free', 'paid', 'sliding_scale', 'insurance'];

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
    />
  );
}

function csv(value) {
  return Array.isArray(value) ? value.join(', ') : '';
}
function parseCsv(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

export default function ExpertEditorPage() {
  const [expert, setExpert] = useState(null);
  const [services, setServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [stripe, setStripe] = useState({ account_id: null, charges_enabled: false, payouts_enabled: false });
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [toast, setToast] = useState(null);
  const [draft, setDraft] = useState(null);
  const [newSvc, setNewSvc] = useState({ title: '', duration_minutes: 30, price_cents: 0, currency: 'usd', description: '' });
  const [newAvail, setNewAvail] = useState({ day_of_week: 1, start_minute: 540, end_minute: 1020, timezone: 'UTC' });

  async function reload() {
    setLoading(true);
    try {
      const me = await api.wellbeingExpertMe();
      setExpert(me);
      setDraft({
        name: me.name || '',
        headline: me.headline || '',
        bio: me.bio || '',
        photo_url: me.photo_url || '',
        website_url: me.website_url || '',
        calendly_url: me.calendly_url || '',
        booking_url: me.booking_url || '',
        categories: csv(me.categories),
        sectors: csv(me.sectors),
        languages: csv(me.languages),
        timezones: csv(me.timezones),
        modalities: me.modalities || ['video'],
        pricing_model: me.pricing_model || 'paid',
        hourly_rate_usd: me.hourly_rate_usd ?? '',
        first_session_free: !!me.first_session_free,
      });
      setServices(me.services || []);
      setAvailability(me.availability || []);
      setStripe(me.stripe || { account_id: null, charges_enabled: false, payouts_enabled: false });
      setMissing(false);
      const bks = await api.wellbeingExpertMyBookings().catch(() => ({ bookings: [] }));
      setBookings(bks.bookings || []);
    } catch (e) {
      if (String(e?.message || '').match(/No expert profile|404/i)) setMissing(true);
      else setToast({ kind: 'err', msg: e?.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  async function handleApply() {
    try {
      await api.wellbeingExpertApply({});
      setToast({ kind: 'ok', msg: 'Expert profile created — finish filling it in below.' });
      await reload();
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Could not create profile.' });
    }
  }

  async function handleSaveProfile() {
    if (!draft) return;
    setSavingProfile(true);
    try {
      const payload = {
        ...draft,
        categories: parseCsv(draft.categories),
        sectors: parseCsv(draft.sectors),
        languages: parseCsv(draft.languages),
        timezones: parseCsv(draft.timezones),
        hourly_rate_usd: draft.hourly_rate_usd === '' ? null : Number(draft.hourly_rate_usd),
      };
      await api.wellbeingExpertMeUpdate(payload);
      setToast({ kind: 'ok', msg: 'Profile saved.' });
      await reload();
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Save failed.' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleConnect() {
    try {
      const r = await api.wellbeingExpertStripeConnect();
      if (r?.url) window.location.href = r.url;
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Stripe Connect failed.' });
    }
  }
  async function handleRefreshStripe() {
    try {
      const r = await api.wellbeingExpertStripeStatus();
      setStripe(r);
      setToast({ kind: 'ok', msg: 'Stripe status refreshed.' });
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Refresh failed.' });
    }
  }

  async function addService() {
    if (!newSvc.title.trim()) return;
    try {
      await api.wellbeingExpertServiceCreate({
        ...newSvc,
        price_cents: Math.round(Number(newSvc.price_cents) || 0),
        duration_minutes: Math.round(Number(newSvc.duration_minutes) || 30),
      });
      setNewSvc({ title: '', duration_minutes: 30, price_cents: 0, currency: 'usd', description: '' });
      await reload();
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Add service failed' });
    }
  }
  async function delService(uid) {
    if (!confirm('Delete this service?')) return;
    try { await api.wellbeingExpertServiceDelete(uid); await reload(); }
    catch (e) { setToast({ kind: 'err', msg: e?.message || 'Delete failed' }); }
  }

  async function addAvail() {
    try { await api.wellbeingExpertAvailabilityCreate(newAvail); await reload(); }
    catch (e) { setToast({ kind: 'err', msg: e?.message || 'Add slot failed' }); }
  }
  async function delAvail(uid) {
    try { await api.wellbeingExpertAvailabilityDelete(uid); await reload(); }
    catch (e) { setToast({ kind: 'err', msg: e?.message || 'Delete failed' }); }
  }

  async function patchBooking(uid, status) {
    try { await api.wellbeingExpertBookingPatch(uid, { status }); await reload(); }
    catch (e) { setToast({ kind: 'err', msg: e?.message || 'Update failed' }); }
  }

  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;

  if (missing) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Link to="/wellbeing" className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Become a wellbeing expert</h1>
        <p className="text-slate-600 dark:text-slate-300">
          Create your expert profile to appear in the Axal wellbeing directory. You'll be able to add services,
          set availability, and accept paid bookings via Stripe Connect.
        </p>
        <button onClick={handleApply}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Create my expert profile
        </button>
      </div>
    );
  }

  const completionPct = Number(expert?.profile_completion_pct ?? 0);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/wellbeing" className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back
        </Link>
        {expert?.uid && (
          <Link to={`/wellbeing/expert/${expert.uid}`} className="text-sm text-indigo-600 hover:underline">
            View public profile →
          </Link>
        )}
      </div>

      {toast && (
        <div className={`rounded-lg border p-3 text-sm ${toast.kind === 'err' ? 'border-red-300 bg-red-50 text-red-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Profile completion</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              You need ≥ 70% to appear in the directory and accept bookings.
            </div>
          </div>
          <div className="text-2xl font-semibold text-slate-900 dark:text-white">{completionPct}%</div>
        </div>
        <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden dark:bg-slate-700">
          <div className={`h-full ${completionPct >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${completionPct}%` }} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Profile</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Display name"><TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Headline"><TextInput value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} /></Field>
          <Field label="Photo URL"><TextInput value={draft.photo_url} onChange={(e) => setDraft({ ...draft, photo_url: e.target.value })} /></Field>
          <Field label="Website"><TextInput value={draft.website_url} onChange={(e) => setDraft({ ...draft, website_url: e.target.value })} /></Field>
          <Field label="External scheduler URL (optional)"><TextInput value={draft.calendly_url} onChange={(e) => setDraft({ ...draft, calendly_url: e.target.value })} /></Field>
          <Field label="Pricing model">
            <select value={draft.pricing_model}
              onChange={(e) => setDraft({ ...draft, pricing_model: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
              {PRICING_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Hourly rate (USD)"><TextInput type="number" value={draft.hourly_rate_usd} onChange={(e) => setDraft({ ...draft, hourly_rate_usd: e.target.value })} /></Field>
          <Field label="Categories (comma-separated)"><TextInput value={draft.categories} onChange={(e) => setDraft({ ...draft, categories: e.target.value })} /></Field>
          <Field label="Sectors (comma-separated)"><TextInput value={draft.sectors} onChange={(e) => setDraft({ ...draft, sectors: e.target.value })} /></Field>
          <Field label="Languages (comma-separated)"><TextInput value={draft.languages} onChange={(e) => setDraft({ ...draft, languages: e.target.value })} /></Field>
          <Field label="Timezones (comma-separated IANA)"><TextInput value={draft.timezones} onChange={(e) => setDraft({ ...draft, timezones: e.target.value })} /></Field>
        </div>
        <div className="mt-4">
          <Field label="Bio">
            <TextArea rows={5} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="text-sm text-slate-700 dark:text-slate-200">Modalities:</div>
          {MODALITY_OPTIONS.map((m) => (
            <label key={m} className="text-sm inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.modalities.includes(m)}
                onChange={(e) => {
                  const set = new Set(draft.modalities);
                  if (e.target.checked) set.add(m); else set.delete(m);
                  setDraft({ ...draft, modalities: Array.from(set) });
                }}
              />
              {m}
            </label>
          ))}
          <label className="text-sm inline-flex items-center gap-1 ml-4">
            <input type="checkbox" checked={draft.first_session_free}
              onChange={(e) => setDraft({ ...draft, first_session_free: e.target.checked })} />
            First session free
          </label>
        </div>
        <div className="mt-4 text-right">
          <button onClick={handleSaveProfile} disabled={savingProfile}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <CreditCard size={18} /> Payments — Stripe Connect
        </h2>
        {stripe.account_id ? (
          <div className="space-y-2">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Account: <code className="text-xs">{stripe.account_id}</code>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className={`inline-flex items-center gap-1 ${stripe.charges_enabled ? 'text-emerald-700' : 'text-amber-700'}`}>
                {stripe.charges_enabled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} Charges {stripe.charges_enabled ? 'enabled' : 'pending'}
              </span>
              <span className={`inline-flex items-center gap-1 ${stripe.payouts_enabled ? 'text-emerald-700' : 'text-amber-700'}`}>
                {stripe.payouts_enabled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} Payouts {stripe.payouts_enabled ? 'enabled' : 'pending'}
              </span>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleConnect}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700">
                Continue onboarding
              </button>
              <button onClick={handleRefreshStripe}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm inline-flex items-center gap-1 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700">
                <RefreshCcw size={14} /> Refresh
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Connect Stripe to accept paid sessions. Axal applies a 15% platform fee.
            </p>
            <button onClick={handleConnect}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Set up payouts
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">Services</h2>
        <div className="space-y-2">
          {services.map((s) => (
            <div key={s.uid} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">{s.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {s.duration_minutes} min · {s.price_cents > 0
                    ? `${(s.price_cents / 100).toLocaleString(undefined, { style: 'currency', currency: (s.currency || 'usd').toUpperCase() })}`
                    : 'Free'}
                </div>
              </div>
              <button onClick={() => delService(s.uid)} className="text-red-600 hover:text-red-700">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {services.length === 0 && (
            <div className="text-sm text-slate-500 dark:text-slate-400">No services yet — add your first below.</div>
          )}
        </div>
        <div className="mt-4 grid sm:grid-cols-5 gap-2 items-end">
          <div className="sm:col-span-2"><Field label="Title"><TextInput value={newSvc.title} onChange={(e) => setNewSvc({ ...newSvc, title: e.target.value })} /></Field></div>
          <Field label="Min"><TextInput type="number" value={newSvc.duration_minutes} onChange={(e) => setNewSvc({ ...newSvc, duration_minutes: e.target.value })} /></Field>
          <Field label="Price (cents)"><TextInput type="number" value={newSvc.price_cents} onChange={(e) => setNewSvc({ ...newSvc, price_cents: e.target.value })} /></Field>
          <button onClick={addService}
            className="h-[38px] rounded-lg bg-indigo-600 px-3 text-sm text-white inline-flex items-center justify-center gap-1 hover:bg-indigo-700">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">Availability</h2>
        <div className="space-y-2">
          {availability.map((a) => (
            <div key={a.uid} className="flex items-center justify-between rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <div className="text-sm text-slate-700 dark:text-slate-200">
                Day {a.day_of_week} · {Math.floor(a.start_minute / 60)}:{String(a.start_minute % 60).padStart(2, '0')} – {Math.floor(a.end_minute / 60)}:{String(a.end_minute % 60).padStart(2, '0')} ({a.timezone})
              </div>
              <button onClick={() => delAvail(a.uid)} className="text-red-600 hover:text-red-700"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-5 gap-2 items-end">
          <Field label="Day (0=Sun)"><TextInput type="number" min={0} max={6} value={newAvail.day_of_week} onChange={(e) => setNewAvail({ ...newAvail, day_of_week: Number(e.target.value) })} /></Field>
          <Field label="Start (min)"><TextInput type="number" value={newAvail.start_minute} onChange={(e) => setNewAvail({ ...newAvail, start_minute: Number(e.target.value) })} /></Field>
          <Field label="End (min)"><TextInput type="number" value={newAvail.end_minute} onChange={(e) => setNewAvail({ ...newAvail, end_minute: Number(e.target.value) })} /></Field>
          <Field label="Timezone"><TextInput value={newAvail.timezone} onChange={(e) => setNewAvail({ ...newAvail, timezone: e.target.value })} /></Field>
          <button onClick={addAvail}
            className="h-[38px] rounded-lg bg-indigo-600 px-3 text-sm text-white inline-flex items-center justify-center gap-1 hover:bg-indigo-700">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">Bookings</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          You see only the booker's note — never their wellbeing check-ins.
        </p>
        <div className="space-y-2">
          {bookings.length === 0 && <div className="text-sm text-slate-500">No bookings yet.</div>}
          {bookings.map((b) => (
            <div key={b.uid} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">
                    {b.booker_name || 'Founder'} · <span className="text-xs font-normal text-slate-500">{b.status}</span>
                    {b.payment_status && b.payment_status !== 'free' && (
                      <span className="ml-2 text-xs text-slate-500">payment: {b.payment_status}</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {b.scheduled_at ? new Date(b.scheduled_at).toUTCString() : 'Time TBD'} · {b.duration_minutes} min
                  </div>
                  {b.meet_link && (
                    <a href={b.meet_link} target="_blank" rel="noreferrer"
                      className="text-xs text-indigo-600 hover:underline">Meeting link</a>
                  )}
                </div>
                <div className="flex gap-2">
                  {b.status !== 'confirmed' && b.status !== 'cancelled' && (
                    <button onClick={() => patchBooking(b.uid, 'confirmed')}
                      className="text-xs rounded border border-emerald-300 text-emerald-700 px-2 py-1 hover:bg-emerald-50">Confirm</button>
                  )}
                  {b.status !== 'cancelled' && (
                    <button onClick={() => patchBooking(b.uid, 'cancelled')}
                      className="text-xs rounded border border-red-300 text-red-700 px-2 py-1 hover:bg-red-50">Cancel</button>
                  )}
                  {b.status === 'confirmed' && (
                    <button onClick={() => patchBooking(b.uid, 'completed')}
                      className="text-xs rounded border border-slate-300 text-slate-700 px-2 py-1 hover:bg-slate-50">Complete</button>
                  )}
                </div>
              </div>
              {b.booker_note && (
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-xs uppercase tracking-wide text-slate-500">Booker note:</span> {b.booker_note}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
