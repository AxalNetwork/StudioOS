/* Task #54 — Partner office hours admin.
 *
 * Partner-only page mirroring the mentor OfficeHoursPage flow but for
 * Partner records. Lets a partner publish bookable slots, manage incoming
 * bookings (confirm / complete / cancel / no-show) and see who booked.
 */
import { useEffect, useState } from 'react';
import { Calendar, Plus, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

function NewSlotForm({ onCreated }) {
  const [draft, setDraft] = useState({
    title: '', start_at: '', duration_min: 30, capacity: 1,
    location_kind: 'video', location_uri: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    setErr(null); setBusy(true);
    try {
      const payload = {
        title: draft.title || null,
        start_at: new Date(draft.start_at).toISOString(),
        duration_min: Number(draft.duration_min),
        capacity: Number(draft.capacity),
        location_kind: draft.location_kind,
        location_uri: draft.location_uri || null,
        notes: draft.notes || null,
      };
      await api.createPartnerSlot(payload);
      setDraft({ ...draft, start_at: '', notes: '', title: '' });
      onCreated();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-gray-700 mb-1">Title (optional)</label>
        <input value={draft.title} placeholder="e.g. GTM 1:1"
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-gray-700 mb-1">Start (local)</label>
        <input type="datetime-local" value={draft.start_at}
          onChange={(e) => setDraft({ ...draft, start_at: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Duration (min)</label>
        <input type="number" min="10" value={draft.duration_min}
          onChange={(e) => setDraft({ ...draft, duration_min: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Capacity</label>
        <input type="number" min="1" value={draft.capacity}
          onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
        <select value={draft.location_kind}
          onChange={(e) => setDraft({ ...draft, location_kind: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm">
          <option value="video">Video</option>
          <option value="phone">Phone</option>
          <option value="in_person">In person</option>
        </select>
      </div>
      <div className="md:col-span-3">
        <input value={draft.location_uri} placeholder="https://meet.google.com/…"
          onChange={(e) => setDraft({ ...draft, location_uri: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
      </div>
      <div>
        <button disabled={busy || !draft.start_at} onClick={submit}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white py-2 rounded text-sm font-medium flex items-center justify-center gap-1">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add slot
        </button>
      </div>
      {err && <div className="md:col-span-6 text-sm text-red-600">{err}</div>}
    </div>
  );
}

export default function PartnerOfficeHoursPage() {
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setErr(null); setLoading(true);
    // 404 = office-hours route missing on this deployment (stale worker).
    // The empty-state cards already cover "no slots / no bookings" — don't
    // double up with a raw red banner above them.
    const quiet404 = (e) => {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') return { items: [] };
      throw e;
    };
    try {
      const [sd, bd] = await Promise.all([
        api.listMyPartnerSlots(true).catch(quiet404),
        api.listMyPartnerBookings().catch(quiet404),
      ]);
      setSlots(sd.items || []);
      setBookings(bd.items || []);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  async function transition(id, kind, reason) {
    try {
      if (kind === 'confirm') await api.confirmPartnerBooking(id);
      else if (kind === 'cancel') await api.cancelPartnerBooking(id, reason || 'Cancelled by partner');
      else if (kind === 'complete') await api.completePartnerBooking(id);
      else if (kind === 'no_show') await api.noShowPartnerBooking(id, reason || 'No-show');
      loadAll();
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Partner office hours</h1>
        <p className="text-sm text-gray-600 mt-1">
          Publish bookable slots for founders and other portfolio members. Bookings appear
          here and on your unified calendar.
        </p>
      </div>

      {err && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
          {err} {err.includes('partner profile') && '— complete partner onboarding first.'}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Publish a slot</h2>
        <NewSlotForm onCreated={loadAll} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Calendar size={18} /> Upcoming office hours
        </h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : slots.length === 0 ? (
          <div className="text-sm text-gray-500">No upcoming slots — publish one above.</div>
        ) : (
          <div className="space-y-2">
            {slots.map((s) => (
              <div key={s.id} className="bg-white border border-gray-200 rounded p-3 flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium text-gray-900">
                    {s.title ? `${s.title} · ` : ''}{new Date(s.start_at).toLocaleString()} · {s.duration_min} min
                  </div>
                  <div className="text-xs text-gray-500">
                    {s.taken}/{s.capacity} booked · {s.location_kind} · status {s.status}
                  </div>
                </div>
                {s.status === 'open' && (
                  <button onClick={async () => {
                    if (!confirm('Cancel this slot? All its bookings will also be cancelled.')) return;
                    try { await api.cancelPartnerSlot(s.id); loadAll(); }
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
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Bookings</h2>
        {bookings.length === 0 ? (
          <div className="text-sm text-gray-500">No bookings yet.</div>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="bg-white border border-gray-200 rounded p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">{b.topic}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {new Date(b.scheduled_start).toLocaleString()} · status: <span className="font-medium">{b.status}</span>
                    </div>
                    {b.questions && <div className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{b.questions}</div>}
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {b.status === 'requested' && (
                      <>
                        <button onClick={() => transition(b.id, 'confirm')}
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1">
                          <CheckCircle size={12} /> Confirm
                        </button>
                        <button onClick={() => transition(b.id, 'cancel', prompt('Reason?') || '')}
                          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded">
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
                          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded">
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
