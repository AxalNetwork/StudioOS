import React, { useEffect, useState } from 'react';
import { Target, Check, X, Calendar, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, SlideOver, EmptyState, StatCard, StatusBadge, RowCard,
  formatDateTime, formatRelativeDay,
  AWAITING_DECISION, isBookableSlot, slotView,
} from './kit';

// Opportunities — inbound session requests awaiting the advisor's decision,
// plus the availability that generates them.
//
// Wave 1b: this tab previously rendered a fixture pipeline of invented deals
// with invented values and probabilities. An advisor's real inbound is
// `advisor_bookings` in `pending` (Worker) or `requested` (FastAPI) — someone
// has asked for time and is waiting
// on an answer. Confirming or declining here is the actual decision, and the
// slots panel is where supply comes from, so an advisor with no pending
// requests is told whether the reason is that they have published no
// availability.
export default function OpportunitiesPage() {
  const [pending, setPending] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [newSlot, setNewSlot] = useState({ starts_at: '', ends_at: '', capacity: '1', meeting_url: '' });
  const [addingSlot, setAddingSlot] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    let me = null;
    try {
      me = await api.getMyAdvisor();
      if (!me) setNoProfile(true);
    } catch { setNoProfile(true); }
    try {
      const r = await api.listMyAdvisorBookings();
      setPending((r.items || []).filter((booking) => AWAITING_DECISION.includes(booking.status)));
    } catch (e) { setError(e?.message || 'Could not load requests.'); }
    if (me?.uid) {
      try {
        const s = await api.listAdvisorSlots(me.uid, true);
        setSlots(s.items || []);
      } catch { setSlots([]); }
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const decide = async (booking, action) => {
    setBusy(true); setError('');
    try {
      if (action === 'confirm') await api.confirmAdvisorBooking(booking.id);
      else await api.cancelAdvisorBooking(booking.id, declineReason.trim() || 'Declined by advisor');
      setOpen(null); setDeclineReason('');
      await load();
    } catch (e) {
      setError(e?.message || `Could not ${action} the request.`);
    }
    setBusy(false);
  };

  const addSlot = async () => {
    setAddingSlot(true); setError('');
    try {
      if (!newSlot.starts_at || !newSlot.ends_at) throw new Error('Start and end times are required.');
      await api.createAdvisorSlot({
        starts_at: new Date(newSlot.starts_at).toISOString(),
        ends_at: new Date(newSlot.ends_at).toISOString(),
        capacity: Number(newSlot.capacity) || 1,
        meeting_url: newSlot.meeting_url.trim() || null,
      });
      setNewSlot({ starts_at: '', ends_at: '', capacity: '1', meeting_url: '' });
      await load();
    } catch (e) {
      setError(e?.message || 'Could not publish the slot.');
    }
    setAddingSlot(false);
  };

  const dropSlot = async (slot) => {
    setError('');
    try { await api.cancelAdvisorSlot(slot.id); await load(); }
    catch (e) { setError(e?.message || 'Could not cancel the slot.'); }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading your inbound…</div>;
  }

  if (noProfile) {
    return (
      <EmptyState>
        <p className="font-medium text-gray-700 dark:text-gray-300">You do not have an advisor profile yet.</p>
        <p className="mt-1">
          Create one from the Advisors directory and publish availability — inbound
          session requests then arrive here.
        </p>
      </EmptyState>
    );
  }

  // These four adapters used to live here, privately, which is precisely why
  // every other caller stayed broken against the same DTOs. They are in
  // ./kit now; this page reads them like everyone else.
  const openSlots = slots.filter(isBookableSlot);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Awaiting your decision" value={pending.length} />
        <StatCard label="Open slots" value={openSlots.length} hint="published and not full" />
        <StatCard
          label="Seats free"
          value={openSlots.reduce((a, slot) => a + slotView(slot).available, 0)}
          hint="across open slots"
        />
      </div>

      <Section title={`Requests awaiting you (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>
            {openSlots.length === 0
              ? 'No pending requests — and no open availability published, so nobody can book you. Add a slot below.'
              : 'No pending requests. Confirmed sessions live under Engagements.'}
          </EmptyState>
        ) : (
          <div className="space-y-2.5">
            {pending.map((b) => (
              <RowCard key={b.id} onClick={() => { setOpen(b); setDeclineReason(''); }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
                      <Target size={15} className="text-violet-500 flex-shrink-0" />
                      <span className="truncate">{b.topic || 'Session request'}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={b.status} />
                      <Chip>{b.client_name || b.founder_name || b.client_email || b.founder_email || `Member #${b.client_user_id ?? b.founder_user_id ?? b.requester_user_id}`}</Chip>
                    </div>
                    {(b.client_message || b.questions || b.notes) && <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{b.client_message || b.questions || b.notes}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-gray-600 dark:text-gray-400">{formatDateTime(b.scheduled_start || b.slot_starts_at)}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">asked {formatRelativeDay(b.created_at)}</div>
                  </div>
                </div>
              </RowCard>
            ))}
          </div>
        )}
      </Section>

      <Section title="Your availability">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <label className="block">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Starts</span>
              <input
                type="datetime-local"
                value={newSlot.starts_at}
                onChange={(e) => setNewSlot((s) => ({ ...s, starts_at: e.target.value }))}
                className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Ends</span>
              <input
                type="datetime-local"
                value={newSlot.ends_at}
                onChange={(e) => setNewSlot((s) => ({ ...s, ends_at: e.target.value }))}
                className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Seats</span>
              <input
                value={newSlot.capacity}
                onChange={(e) => setNewSlot((s) => ({ ...s, capacity: e.target.value }))}
                inputMode="numeric"
                className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Meeting URL</span>
              <input
                value={newSlot.meeting_url}
                onChange={(e) => setNewSlot((s) => ({ ...s, meeting_url: e.target.value }))}
                placeholder="optional"
                className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5"
              />
            </label>
          </div>
          <button
            onClick={addSlot}
            disabled={addingSlot}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            <Plus size={14} /> {addingSlot ? 'Publishing…' : 'Publish slot'}
          </button>
        </div>

        {slots.length > 0 && (
          <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {slots.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5">
                    <Calendar size={13} className="text-violet-500" /> {formatDateTime(slotView(s).startsAt)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                     {slotView(s).taken}/{slotView(s).capacity} booked · {formatRelativeDay(slotView(s).startsAt)}
                  </div>
                </div>
                <button
                  onClick={() => dropSlot(s)}
                  title="Cancel slot"
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-rose-300 hover:text-rose-500 flex-shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <SlideOver
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.topic || 'Session request'}
        subtitle={open ? `${open.client_name || open.founder_name || open.client_email || open.founder_email || ''} · ${formatDateTime(open.scheduled_start || open.slot_starts_at)}` : ''}
      >
        {open && (
          <div className="space-y-4">
            {(open.client_message || open.questions || open.notes) ? (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">What they wrote</div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{open.client_message || open.questions || open.notes}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">They did not add a note.</p>
            )}
            <label className="block">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Reason (only sent if you decline)</span>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={3}
                className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => decide(open, 'confirm')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                <Check size={14} /> Confirm
              </button>
              <button
                onClick={() => decide(open, 'decline')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:border-rose-300 hover:text-rose-500 disabled:opacity-50"
              >
                <X size={14} /> Decline
              </button>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
