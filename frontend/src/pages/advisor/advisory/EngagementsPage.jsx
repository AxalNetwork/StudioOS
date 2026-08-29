import React, { useEffect, useMemo, useState } from 'react';
import { Layers, CheckCircle2, UserX, XCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, SlideOver, EmptyState, StatCard, FilterChips, StatusBadge,
  RowCard, formatDateTime, formatRelativeDay,
} from './kit';

// Engagements — confirmed and past sessions, with the transitions that move
// them (Wave 1b; previously a fixture of invented multi-month engagements with
// invented progress percentages).
//
// A confirmed advisor_booking IS the engagement. The lifecycle here is the
// real one the worker enforces: confirmed → completed | no_show | cancelled.
const VIEWS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
];

export default function EngagementsPage() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('upcoming');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const me = await api.getMyAdvisor();
      if (!me) { setNoProfile(true); setLoading(false); return; }
    } catch { setNoProfile(true); setLoading(false); return; }
    try {
      const r = await api.listMyAdvisorBookings();
      setBookings(r.items || []);
    } catch (e) { setError(e?.message || 'Could not load sessions.'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const act = async (b, action) => {
    setBusy(true); setError('');
    try {
      if (action === 'complete') await api.completeAdvisorBooking(b.id);
      else if (action === 'no-show') await api.noShowAdvisorBooking(b.id, note.trim() || undefined);
      else if (action === 'cancel') await api.cancelAdvisorBooking(b.id, note.trim() || 'Cancelled by advisor');
      setOpen(null); setNote('');
      await load();
    } catch (e) {
      setError(e?.message || `Could not ${action} the session.`);
    }
    setBusy(false);
  };

  const upcoming = useMemo(
    () => bookings.filter((b) => b.status === 'confirmed'),
    [bookings],
  );
  const past = useMemo(
    () => bookings.filter((b) => ['completed', 'no_show', 'cancelled'].includes(b.status)),
    [bookings],
  );
  const shown = view === 'upcoming' ? upcoming : view === 'past' ? past : bookings;

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading your sessions…</div>;
  }
  if (noProfile) {
    return <EmptyState>You do not have an advisor profile yet, so there are no sessions to show.</EmptyState>;
  }

  const held = bookings.filter((b) => b.status === 'completed').length;
  const noShows = bookings.filter((b) => b.status === 'no_show').length;
  const closed = held + noShows;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Confirmed ahead" value={upcoming.length} />
        <StatCard label="Sessions held" value={held} />
        <StatCard label="No-shows" value={noShows} />
        <StatCard
          label="Attendance"
          value={closed > 0 ? `${Math.round((held / closed) * 100)}%` : '—'}
          hint={closed > 0 ? `${held} of ${closed} closed` : 'nothing closed yet'}
        />
      </div>

      <FilterChips options={VIEWS} value={view} onChange={setView} />

      {shown.length === 0 ? (
        <EmptyState>
          {view === 'upcoming'
            ? 'No confirmed sessions ahead. Confirm a request under Opportunities and it appears here.'
            : view === 'past'
              ? 'No past sessions yet.'
              : 'No sessions yet.'}
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {shown.map((b) => (
            <RowCard key={b.id} onClick={() => { setOpen(b); setNote(''); }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
                    <Layers size={15} className="text-violet-500 flex-shrink-0" />
                    <span className="truncate">{b.topic || 'Session'}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={b.status} />
                    <Chip>{b.founder_name || b.founder_email || `Member #${b.founder_user_id}`}</Chip>
                  </div>
                  {b.cancel_reason && (
                    <p className="text-xs text-rose-500 dark:text-rose-400 mt-1.5">Reason: {b.cancel_reason}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-gray-600 dark:text-gray-400">{formatDateTime(b.slot_starts_at)}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{formatRelativeDay(b.slot_starts_at)}</div>
                </div>
              </div>
            </RowCard>
          ))}
        </div>
      )}

      <SlideOver
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.topic || 'Session'}
        subtitle={open ? `${open.founder_name || open.founder_email || ''} · ${formatDateTime(open.slot_starts_at)}` : ''}
      >
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={open.status} />
              <Chip>Booked {formatRelativeDay(open.created_at)}</Chip>
            </div>
            {open.notes && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Their note</div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{open.notes}</p>
              </div>
            )}

            {open.status === 'confirmed' && (
              <>
                <label className="block">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">Reason (used if you mark a no-show or cancel)</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => act(open, 'complete')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} /> Session held
                  </button>
                  <button
                    onClick={() => act(open, 'no-show')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:border-amber-300 disabled:opacity-50"
                  >
                    <UserX size={14} /> No-show
                  </button>
                  <button
                    onClick={() => act(open, 'cancel')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:border-rose-300 hover:text-rose-500 disabled:opacity-50"
                  >
                    <XCircle size={14} /> Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}
