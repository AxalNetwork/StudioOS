/* Task #35 — Advisor admin: profile + office-hour slots + bookings.
 *
 * For users with role=advisor only. Lets them edit their profile,
 * publish office-hour slots, manage incoming bookings, and review
 * mentees after a session.
 */
import { useEffect, useState } from 'react';
import { Calendar, Plus, Trash2, CheckCircle, Star, X, Loader2, UserCircle } from 'lucide-react';
import { api } from '../lib/api';
import PageExplainer from '../components/PageExplainer';

function StarPicker({ rating, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n)} type="button"
          className={n <= rating ? 'text-amber-400' : 'text-gray-300'}>
          <Star size={22} fill={n <= rating ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

function ProfileCard({ profile, onSaved }) {
  const [draft, setDraft] = useState({
    name: profile?.name || '',
    headline: profile?.headline || '',
    bio: profile?.bio || '',
    specialties: (profile?.specialties || []).join(', '),
    sectors: (profile?.sectors || []).join(', '),
    hourly_rate: profile?.hourly_rate ?? 0,
    capacity_per_week: profile?.capacity_per_week ?? 4,
    timezone: profile?.timezone || '',
    accepting_bookings: profile?.accepting_bookings ?? true,
    listed: profile?.listed ?? true,
    calcom_username: profile?.calcom_username || '',
  });
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);

  async function save() {
    setErr(null); setInfo(null); setBusy(true);
    try {
      const payload = {
        ...draft,
        hourly_rate: Number(draft.hourly_rate) || 0,
        capacity_per_week: Number(draft.capacity_per_week) || 0,
        specialties: draft.specialties.split(',').map((s) => s.trim()).filter(Boolean),
        sectors: draft.sectors.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const m = await api.upsertMyAdvisor(payload);
      setInfo('Profile saved');
      onSaved?.(m);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 dark:bg-gray-900 dark:border-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-gray-100">
        <UserCircle size={18} /> Advisor profile
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Name</label>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Headline</label>
          <input value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
            placeholder="ex-Stripe payments PM"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Bio</label>
          <textarea value={draft.bio} rows={3}
            onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Specialties (comma-separated)</label>
          <input value={draft.specialties}
            onChange={(e) => setDraft({ ...draft, specialties: e.target.value })}
            placeholder="fundraising, gtm, pricing"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Sectors (comma-separated)</label>
          <input value={draft.sectors}
            onChange={(e) => setDraft({ ...draft, sectors: e.target.value })}
            placeholder="b2b_saas, fintech, ai"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Hourly rate ($, 0 = free)</label>
          <input type="number" min="0" value={draft.hourly_rate}
            onChange={(e) => setDraft({ ...draft, hourly_rate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Capacity per week</label>
          <input type="number" min="0" value={draft.capacity_per_week}
            onChange={(e) => setDraft({ ...draft, capacity_per_week: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Timezone (IANA)</label>
          <input value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            placeholder="America/New_York"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Cal.com username (optional)</label>
          <input value={draft.calcom_username}
            onChange={(e) => setDraft({ ...draft, calcom_username: e.target.value })}
            placeholder="janedoe"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.accepting_bookings}
            onChange={(e) => setDraft({ ...draft, accepting_bookings: e.target.checked })} />
          Accepting bookings
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.listed}
            onChange={(e) => setDraft({ ...draft, listed: e.target.checked })} />
          Listed in public directory
        </label>
      </div>
      {err && <div className="text-sm text-red-600 mt-3">{err}</div>}
      {info && <div className="text-sm text-emerald-600 mt-3">{info}</div>}
      <button disabled={busy} onClick={save}
        className="mt-4 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2">
        {busy && <Loader2 size={14} className="animate-spin" />} Save profile
      </button>
    </div>
  );
}

function NewSlotForm({ onCreated }) {
  const [draft, setDraft] = useState({
    start_at: '', duration_min: 30, capacity: 1,
    location_kind: 'video', location_uri: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    setErr(null); setBusy(true);
    try {
      const payload = {
        ...draft,
        start_at: new Date(draft.start_at).toISOString(),
        duration_min: Number(draft.duration_min),
        capacity: Number(draft.capacity),
      };
      await api.createAdvisorSlot(payload);
      setDraft({ ...draft, start_at: '', notes: '' });
      onCreated();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end dark:bg-gray-900 dark:border-gray-800">
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Start (local)</label>
        <input type="datetime-local" value={draft.start_at}
          onChange={(e) => setDraft({ ...draft, start_at: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Duration (min)</label>
        <input type="number" min="10" value={draft.duration_min}
          onChange={(e) => setDraft({ ...draft, duration_min: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Capacity</label>
        <input type="number" min="1" value={draft.capacity}
          onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Location</label>
        <select value={draft.location_kind}
          onChange={(e) => setDraft({ ...draft, location_kind: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700">
          <option value="video">Video</option>
          <option value="phone">Phone</option>
          <option value="in_person">In person</option>
        </select>
      </div>
      <div>
        <button disabled={busy || !draft.start_at} onClick={submit}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white py-2 rounded text-sm font-medium flex items-center justify-center gap-1">
          <Plus size={14} /> Add slot
        </button>
      </div>
      <div className="md:col-span-6">
        <input value={draft.location_uri} placeholder="https://meet.google.com/…"
          onChange={(e) => setDraft({ ...draft, location_uri: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
      </div>
      {err && <div className="md:col-span-6 text-sm text-red-600">{err}</div>}
    </div>
  );
}

function AdvisorReviewModal({ booking, onClose, onSubmitted }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    setErr(null); setBusy(true);
    try {
      await api.fileAdvisorReview(booking.id, { rating, comment });
      onSubmitted();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 dark:bg-gray-900">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Review the mentee</div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mb-3 text-sm text-gray-600">Topic: {booking.topic}</div>
        <StarPicker rating={rating} onChange={setRating} />
        <textarea value={comment} onChange={(e) => setComment(e.target.value)}
          rows={4} placeholder="Was the mentee prepared? Would you take another session?"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm mt-3 mb-3 dark:border-gray-700" />
        {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
        <button disabled={busy} onClick={submit}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white py-2 rounded text-sm font-medium">
          {busy ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </div>
  );
}

export default function OfficeHoursPage() {
  const [profile, setProfile] = useState(null);
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [reviewing, setReviewing] = useState(null);
  const [, setErr] = useState(null);

  async function loadAll() {
    try {
      const me = await api.getMyAdvisor();
      setProfile(me);
      const [sd, bd] = await Promise.all([
        api.listAdvisorSlots(me.uid),
        api.listMyAdvisorBookings(),
      ]);
      setSlots(sd.items || []);
      setBookings(bd.items || []);
    } catch (e) {
      // No profile yet — show empty profile draft.
      setProfile({});
      setErr(e.message);
    }
  }
  useEffect(() => { loadAll(); }, []);

  async function transition(id, kind, reason) {
    try {
      if (kind === 'confirm') await api.confirmAdvisorBooking(id);
      else if (kind === 'cancel') await api.cancelAdvisorBooking(id, reason || 'Cancelled by advisor');
      else if (kind === 'complete') await api.completeAdvisorBooking(id);
      else if (kind === 'no_show') await api.noShowAdvisorBooking(id, reason || 'No-show');
      loadAll();
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Office hours</h1>
        <PageExplainer pageKey="office_hours" />
        <p className="text-sm text-gray-600 mt-1">
          Publish bookable slots and manage incoming requests. After each session you can
          review the mentee — same as they review you.
        </p>
      </div>

      <ProfileCard profile={profile} onSaved={loadAll} />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">Publish a slot</h2>
        <NewSlotForm onCreated={loadAll} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
          <Calendar size={18} /> Upcoming office hours
        </h2>
        {slots.length === 0 ? (
          <div className="text-sm text-gray-500">No upcoming slots — publish one above.</div>
        ) : (
          <div className="space-y-2">
            {slots.map((s) => (
              <div key={s.id} className="bg-white border border-gray-200 rounded p-3 flex items-center justify-between dark:bg-gray-900 dark:border-gray-800">
                <div className="text-sm">
                  <div className="font-medium text-gray-900 dark:text-gray-100">{new Date(s.start_at).toLocaleString()} · {s.duration_min} min</div>
                  <div className="text-xs text-gray-500">
                    {s.taken}/{s.capacity} booked · {s.location_kind} · status {s.status}
                  </div>
                </div>
                {s.status === 'open' && (
                  <button onClick={async () => {
                    if (!confirm('Cancel this slot? All its bookings will also be cancelled.')) return;
                    try { await api.cancelAdvisorSlot(s.id); loadAll(); }
                    catch (e) { alert(e.message); }
                  }} className="text-red-600 hover:bg-red-50 p-2 rounded">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">Bookings</h2>
        {bookings.length === 0 ? (
          <div className="text-sm text-gray-500">No bookings yet.</div>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="bg-white border border-gray-200 rounded p-4 dark:bg-gray-900 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{b.topic}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {new Date(b.scheduled_start).toLocaleString()} · status: <span className="font-medium">{b.status}</span>
                    </div>
                    {b.questions && <div className="text-xs text-gray-600 mt-2">{b.questions}</div>}
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {b.status === 'requested' && (
                      <>
                        <button onClick={() => transition(b.id, 'confirm')}
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
                          <CheckCircle size={12} /> Confirm
                        </button>
                        <button onClick={() => transition(b.id, 'cancel', prompt('Reason?') || '')}
                          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded dark:text-gray-200">
                          Decline
                        </button>
                      </>
                    )}
                    {b.status === 'confirmed' && (
                      <>
                        <button onClick={() => transition(b.id, 'complete')}
                          className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded font-medium">
                          Mark complete
                        </button>
                        <button onClick={() => transition(b.id, 'no_show', 'No-show')}
                          className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded">
                          No-show
                        </button>
                        <button onClick={() => transition(b.id, 'cancel', prompt('Reason?') || '')}
                          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded dark:text-gray-200">
                          Cancel
                        </button>
                      </>
                    )}
                    {b.status === 'completed' && (
                      <button onClick={() => setReviewing(b)}
                        className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded font-medium">
                        Review mentee
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {reviewing && (
        <AdvisorReviewModal booking={reviewing}
          onClose={() => setReviewing(null)}
          onSubmitted={() => { setReviewing(null); loadAll(); }} />
      )}
    </div>
  );
}
