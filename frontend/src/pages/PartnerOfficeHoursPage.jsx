/* Task #54 — Partner office hours admin.
 *
 * Partner-only page mirroring the advisor OfficeHoursPage flow but for
 * Partner records. Lets a partner publish bookable slots, manage incoming
 * bookings (confirm / complete / cancel / no-show) and see who booked.
 */
import { useEffect, useState } from 'react';
import { Calendar, Plus, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
// The production Worker and the dev FastAPI expose different wire shapes for
// slots and bookings (starts_at vs start_at, ends_at vs duration_min, pending
// vs requested, meeting_url vs location_uri). These are the same normalizers
// the founder-facing Office Hours page uses, so this console renders correctly
// in both environments instead of printing "Invalid Date" against the Worker.
import { normSlot, normBooking } from './SpinoutLabOfficeHoursPage';

// `new Date(undefined)` is Invalid Date and renders as the literal string
// "Invalid Date" — guard every timestamp before formatting.
const fmtDateTime = (iso) => {
  if (!iso) return 'Time not set';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Time not set' : d.toLocaleString();
};

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
      const startMs = new Date(draft.start_at).getTime();
      if (!Number.isFinite(startMs)) throw new Error('Pick a valid start time.');
      const minutes = Math.max(10, Number(draft.duration_min) || 30);
      // Production Worker (POST /partner-office-hours/me/slots) requires
      // `starts_at` + `ends_at` and reads `meeting_url`; it 400s on the
      // FastAPI-only `start_at` / `duration_min` shape. Send the Worker shape
      // and keep the FastAPI keys alongside — extra fields are ignored there.
      const payload = {
        title: draft.title || null,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(startMs + minutes * 60000).toISOString(),
        meeting_url: draft.location_uri || null,
        // dev FastAPI field names
        start_at: new Date(startMs).toISOString(),
        duration_min: minutes,
        location_kind: draft.location_kind,
        location_uri: draft.location_uri || null,
        capacity: Number(draft.capacity) || 1,
        notes: draft.notes || null,
      };
      await api.createPartnerSlot(payload);
      setDraft({ ...draft, start_at: '', notes: '', title: '' });
      onCreated();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end dark:bg-gray-900 dark:border-gray-800">
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Title (optional)</label>
        <input value={draft.title} placeholder="e.g. GTM 1:1"
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
      </div>
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
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Location</label>
        <select value={draft.location_kind}
          onChange={(e) => setDraft({ ...draft, location_kind: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700">
          <option value="video">Video</option>
          <option value="phone">Phone</option>
          <option value="in_person">In person</option>
        </select>
      </div>
      <div className="md:col-span-3">
        <input value={draft.location_uri} placeholder="https://meet.google.com/…"
          onChange={(e) => setDraft({ ...draft, location_uri: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
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

// ---- Office-hours booking guidance (partner-authored) ---------------------
// Founders see these four fields in the Office Hours booking drawer
// (/spinout-lab/office-hours). They are written here, by the partner, and
// nowhere else — nothing is ever generated on a partner's behalf. Server caps
// live in cloudflare-worker/src/routes/partner_portal.ts; the maxLength values
// below mirror them exactly so the UI never silently loses characters.
const G_MAX = { when_to_book: 600, stage_fit: 60, session_outcome: 120, bring_item: 120 };
const G_BRING_ROWS = 3; // design shows 3; the server accepts up to 5.
const EMPTY_GUIDANCE = () => ({
  when_to_book: '', stage_fit: '', session_outcome: '', bring: Array(G_BRING_ROWS).fill(''),
});
function toGuidanceDraft(g) {
  const bring = Array.isArray(g?.bring) ? g.bring.map((x) => String(x ?? '')) : [];
  return {
    when_to_book: g?.when_to_book || '',
    stage_fit: g?.stage_fit || '',
    session_outcome: g?.session_outcome || '',
    bring: Array.from({ length: Math.max(G_BRING_ROWS, bring.length) }, (_, i) => bring[i] || ''),
  };
}

// `loadState`: 'loading' | 'ok' | 'unsupported' | 'error'. The form is only
// editable once the server value is known — an empty draft must never be
// savable over live published copy — and a disabled form always states why.
function GuidanceCard({ draft, setDraft, base, loadState, busy, saved, error, onSave }) {
  const disabled = loadState !== 'ok' || !draft || busy;
  const d = draft || EMPTY_GUIDANCE();
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base);
  const setField = (k, v) => setDraft({ ...d, [k]: v });
  const setBring = (i, v) => setDraft({ ...d, bring: d.bring.map((x, j) => (j === i ? v : x)) });
  return (
    <section id="guidance">
      <h2 className="text-lg font-semibold text-gray-900 mb-1 dark:text-gray-100">Booking guidance</h2>
      <p className="text-sm text-gray-600 mb-3 dark:text-gray-400">
        Founders see this in your profile before they book. Leave a field blank to hide it — nothing is written on your behalf.
      </p>
      {loadState === 'loading' && (
        <div className="text-sm text-gray-500 mb-3" data-testid="guidance-loading">Loading your booking guidance…</div>
      )}
      {loadState === 'unsupported' && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 mb-3 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200" data-testid="guidance-unsupported">
          Booking guidance isn't available in this environment. It is served by the
          Cloudflare Worker (production); the Replit dev API has no counterpart route.
        </div>
      )}
      {loadState === 'error' && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 mb-3 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200" data-testid="guidance-load-error">
          Couldn't load your booking guidance — reload to try again.
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 dark:bg-gray-900 dark:border-gray-800" data-testid="guidance-editor">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300" htmlFor="oh-when-to-book">
            When to book you
          </label>
          <textarea
            id="oh-when-to-book" rows={4} maxLength={G_MAX.when_to_book} disabled={disabled}
            value={d.when_to_book}
            onChange={(e) => setField('when_to_book', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            data-testid="input-guidance-when"
          />
          <div className="text-[11px] text-gray-500 mt-1 text-right" data-testid="guidance-when-count">
            {d.when_to_book.length}/{G_MAX.when_to_book}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300" htmlFor="oh-stage-fit">
              Best for stage
            </label>
            <input
              id="oh-stage-fit" maxLength={G_MAX.stage_fit} disabled={disabled}
              value={d.stage_fit} placeholder="e.g. Pre-seed → Seed"
              onChange={(e) => setField('stage_fit', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              data-testid="input-guidance-stage"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300" htmlFor="oh-session-outcome">
              One session gets you
            </label>
            <input
              id="oh-session-outcome" maxLength={G_MAX.session_outcome} disabled={disabled}
              value={d.session_outcome} placeholder="e.g. A term-sheet redline you can send back"
              onChange={(e) => setField('session_outcome', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              data-testid="input-guidance-outcome"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Bring to the session</label>
          <div className="space-y-2">
            {d.bring.map((b, i) => (
              <input
                key={i} maxLength={G_MAX.bring_item} disabled={disabled}
                value={b} placeholder={i === 0 ? 'e.g. Your current cap table' : 'Optional'}
                onChange={(e) => setBring(i, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                aria-label={`Bring to the session, item ${i + 1}`}
                data-testid={`input-guidance-bring-${i}`}
              />
            ))}
          </div>
        </div>
        {error && <div className="text-sm text-red-600" data-testid="guidance-save-error">{error}</div>}
        <div className="flex items-center gap-3">
          <button
            type="button" onClick={onSave} disabled={disabled || !dirty}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white px-4 py-2 rounded text-sm font-medium flex items-center justify-center gap-1"
            data-testid="button-save-guidance"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Save guidance
          </button>
          {saved && !dirty && <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</span>}
        </div>
      </div>
    </section>
  );
}

export default function PartnerOfficeHoursPage() {
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  // Guidance editor state. `gBase` is the last known server value — the Save
  // button is dirty-gated against it, and a failed load leaves the form
  // disabled rather than presenting an empty form that could wipe real copy.
  const [gDraft, setGDraft] = useState(null);
  const [gBase, setGBase] = useState(null);
  const [gLoadState, setGLoadState] = useState('loading'); // loading|ok|unsupported|error
  const [gBusy, setGBusy] = useState(false);
  const [gErr, setGErr] = useState(null);
  const [gSaved, setGSaved] = useState(false);

  // Self-catching on purpose: this must never be able to abort loadAll(), and
  // loadAll() must never be able to skip it (a skipped call used to leave the
  // form permanently disabled with no banner explaining why).
  async function loadGuidance() {
    try {
      const res = await api.partnerPortal.officeHoursGuidance();
      const next = toGuidanceDraft(res?.guidance);
      setGBase(next);
      // Never clobber unsaved edits — loadAll() re-runs after slot/booking
      // actions and must not discard what the partner is typing.
      setGDraft((prev) => prev || next);
      setGLoadState('ok');
    } catch (e) {
      // 404 = the route does not exist on this deployment. The guidance
      // endpoints live only in the Cloudflare Worker; the Replit dev FastAPI
      // has no counterpart, so this is an environment limit, not a failure.
      const msg = (e?.message || '').toLowerCase();
      setGLoadState(e?.status === 404 || msg === 'not found' ? 'unsupported' : 'error');
    }
  }

  async function saveGuidance() {
    if (!gDraft) return;
    setGBusy(true); setGErr(null); setGSaved(false);
    try {
      const res = await api.partnerPortal.updateOfficeHoursGuidance({
        when_to_book: gDraft.when_to_book.trim(),
        stage_fit: gDraft.stage_fit.trim(),
        session_outcome: gDraft.session_outcome.trim(),
        bring: gDraft.bring.map((x) => x.trim()).filter(Boolean),
      });
      const next = toGuidanceDraft(res?.guidance);
      setGBase(next); setGDraft(next); setGSaved(true);
    } catch (e) { setGErr(e.message); } finally { setGBusy(false); }
  }

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
      // loadGuidance() rides in the same Promise.all so a rethrown list error
      // can never skip it — it handles its own failure state.
      const [sd, bd] = await Promise.all([
        api.listMyPartnerSlots(true).catch(quiet404),
        api.listMyPartnerBookings().catch(quiet404),
        loadGuidance(),
      ]);
      setSlots((sd.items || []).map(normSlot));
      setBookings((bd.items || []).map(normBooking));
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Partner office hours</h1>
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

      <GuidanceCard
        draft={gDraft} setDraft={setGDraft} base={gBase} loadState={gLoadState}
        busy={gBusy} saved={gSaved} error={gErr} onSave={saveGuidance}
      />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">Publish a slot</h2>
        <NewSlotForm onCreated={loadAll} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
          <Calendar size={18} /> Upcoming office hours
        </h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : slots.length === 0 ? (
          <div className="text-sm text-gray-500">No upcoming slots — publish one above.</div>
        ) : (
          <div className="space-y-2">
            {slots.map((s) => (
              <div key={s.id} className="bg-white border border-gray-200 rounded p-3 flex items-center justify-between dark:bg-gray-900 dark:border-gray-800">
                <div className="text-sm">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {s.title ? `${s.title} · ` : ''}{fmtDateTime(s.start_at)}
                    {Number.isFinite(s.duration_min) ? ` · ${s.duration_min} min` : ''}
                  </div>
                  <div className="text-xs text-gray-500">
                    {Number(s.taken || 0)}/{Number(s.capacity || 0)} booked
                    {s.location_kind ? ` · ${s.location_kind}` : ''}
                    {` · ${s.open ? 'open' : 'cancelled'}`}
                    {` · ${s.meeting_url || s.location_uri ? 'meeting link published' : 'no meeting link'}`}
                  </div>
                </div>
                {s.open && (
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
                      {fmtDateTime(b.scheduled_start)} · status: <span className="font-medium">{b.status || 'unknown'}</span>
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
