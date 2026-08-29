import React, { useEffect, useState } from 'react';
import { Truck, Star, Info } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, SlideOver, EmptyState, StatCard, StatusBadge, RowCard,
  formatDateTime, formatRelativeDay,
} from './kit';

// Delivery — what you owe a client after a session, and what they said about it.
//
// Wave 1b, and the tab that needed the most honesty. The canvas specifies a
// document deliverable trail with versions and opened/unopened receipts.
// **No such store exists**: there is no advisor deliverables table, and
// `deliverable_snapshots` (migration 156) belongs to cohort timing, not to
// advisory. Building a UI over an invented store is exactly what this Wave is
// undoing, so this tab does not pretend.
//
// What IS real is the post-session loop: sessions you have held, whether a
// review has been filed, and the review itself. That is a genuine advisor
// workflow backed by `advisor_bookings` + `engagement`-style reviews, so this
// tab serves it and states plainly what is not tracked yet.
export default function DeliveryPage() {
  const [bookings, setBookings] = useState([]);
  const [reviewsByBooking, setReviewsByBooking] = useState({});
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.getMyAdvisor();
        if (!me) { setNoProfile(true); setLoading(false); return; }
      } catch { setNoProfile(true); setLoading(false); return; }
      let held = [];
      try {
        const r = await api.listMyAdvisorBookings('completed');
        held = r.items || [];
        setBookings(held);
      } catch (e) { setError(e?.message || 'Could not load held sessions.'); }
      // Bounded: only the most recent sessions get a review lookup.
      const map = {};
      for (const b of held.slice(0, 20)) {
        try {
          const rv = await api.listBookingReviews(b.id);
          map[b.id] = rv.items || [];
        } catch { map[b.id] = []; }
      }
      setReviewsByBooking(map);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading held sessions…</div>;
  }
  if (noProfile) {
    return <EmptyState>You do not have an advisor profile yet, so there is nothing to deliver against.</EmptyState>;
  }

  const reviewed = bookings.filter((b) => (reviewsByBooking[b.id] || []).length > 0);
  const awaiting = bookings.filter((b) => (reviewsByBooking[b.id] || []).length === 0);
  const ratings = Object.values(reviewsByBooking).flat().map((r) => Number(r.rating)).filter(Boolean);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Sessions held" value={bookings.length} />
        <StatCard label="Reviewed" value={reviewed.length} hint={`${awaiting.length} without a review`} />
        <StatCard
          label="Average rating"
          value={avg != null ? avg.toFixed(1) : '—'}
          hint={ratings.length ? `${ratings.length} review${ratings.length === 1 ? '' : 's'}` : 'no reviews yet'}
        />
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/10 p-3.5 text-xs text-blue-800 dark:text-blue-300">
        <Info size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          Document deliverables with version history and opened/unopened receipts
          are <strong>not tracked yet</strong> — there is no store behind them, so
          nothing is shown rather than invented. This tab covers the part that is
          recorded: sessions you held and the reviews clients filed.
        </span>
      </div>

      <Section title={`Awaiting a review (${awaiting.length})`}>
        {awaiting.length === 0 ? (
          <EmptyState>
            {bookings.length === 0
              ? 'No sessions held yet. Mark a confirmed session as held under Engagements.'
              : 'Every held session has a review. '}
          </EmptyState>
        ) : (
          <div className="space-y-2.5">
            {awaiting.map((b) => <SessionRow key={b.id} b={b} onOpen={() => setOpen(b)} />)}
          </div>
        )}
      </Section>

      {reviewed.length > 0 && (
        <Section title={`Reviewed (${reviewed.length})`}>
          <div className="space-y-2.5">
            {reviewed.map((b) => (
              <SessionRow
                key={b.id}
                b={b}
                reviews={reviewsByBooking[b.id]}
                onOpen={() => setOpen(b)}
              />
            ))}
          </div>
        </Section>
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
              <Chip>{formatRelativeDay(open.slot_starts_at)}</Chip>
            </div>
            {open.notes && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">What they asked for</div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{open.notes}</p>
              </div>
            )}
            <Section title="Reviews">
              {(reviewsByBooking[open.id] || []).length === 0 ? (
                <EmptyState>
                  No review filed for this session. Reviews are written by the
                  person you met — they cannot be authored here.
                </EmptyState>
              ) : (
                <div className="space-y-2.5">
                  {(reviewsByBooking[open.id] || []).map((r) => (
                    <div key={r.id || r.uid} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3.5">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Star
                            key={i}
                            size={13}
                            className={i <= Number(r.rating) ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'}
                            fill={i <= Number(r.rating) ? 'currentColor' : 'none'}
                          />
                        ))}
                      </div>
                      {r.comment && <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">“{r.comment}”</p>}
                      <div className="text-[11px] text-gray-400 mt-2">{formatRelativeDay(r.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </SlideOver>
    </div>
  );
}

function SessionRow({ b, reviews, onOpen }) {
  const rating = reviews?.length ? Number(reviews[0].rating) : null;
  return (
    <RowCard onClick={onOpen}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
            <Truck size={15} className="text-violet-500 flex-shrink-0" />
            <span className="truncate">{b.topic || 'Session'}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip>{b.founder_name || b.founder_email || `Member #${b.founder_user_id}`}</Chip>
            {rating != null && (
              <Chip tone="emerald">
                <Star size={10} fill="currentColor" /> {rating.toFixed(1)}
              </Chip>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs text-gray-600 dark:text-gray-400">{formatDateTime(b.slot_starts_at)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">{formatRelativeDay(b.slot_starts_at)}</div>
        </div>
      </div>
    </RowCard>
  );
}
