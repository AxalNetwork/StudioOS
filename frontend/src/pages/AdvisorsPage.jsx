/* Task #35 — Advisor directory + booking
 *
 * Browse all listed advisors, filter by specialty/sector/free/max-rate,
 * open an advisor's profile to see open office-hour slots, request a
 * booking, and after a booking is completed file a 1-5 star review.
 */
import { useEffect, useState } from 'react';
import { Search, Star, Calendar, Clock, Video, X, MessageCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import UserTrustBadge from '../components/UserTrustBadge';
import PageExplainer from '../components/PageExplainer';
import { markMilestone } from '../lib/spinoutLabHooks';

function StarRow({ rating, onChange }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="flex items-center gap-1">
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          className={n <= (rating || 0) ? 'text-amber-400' : 'text-zinc-300'}
        >
          <Star size={onChange ? 22 : 14} fill={n <= (rating || 0) ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

function AdvisorCard({ advisor, onOpen, viewerRole }) {
  return (
    <button
      onClick={() => onOpen(advisor)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-5 hover:border-violet-400 hover:shadow-md transition dark:bg-gray-900 dark:border-gray-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-gray-900 dark:text-gray-100">{advisor.name}</div>
          {advisor.headline && <div className="text-sm text-gray-600 mt-0.5">{advisor.headline}</div>}
        </div>
        <div className="text-right">
          {advisor.rating_avg ? (
            <div className="flex items-center gap-1 text-amber-500 text-sm font-medium">
              <Star size={14} fill="currentColor" /> {advisor.rating_avg.toFixed(1)}
              <span className="text-gray-400 text-xs">({advisor.rating_count})</span>
            </div>
          ) : <div className="text-xs text-gray-400">No reviews yet</div>}
          <div className="mt-1 text-xs font-medium text-gray-700 dark:text-gray-300">
            {advisor.hourly_rate > 0 ? `$${advisor.hourly_rate}/hr` : 'Free'}
          </div>
        </div>
      </div>
      {advisor.specialties?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {advisor.specialties.slice(0, 6).map((s) => (
            <span key={s} className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-700 rounded">{s}</span>
          ))}
        </div>
      )}
      {advisor.match_reasons?.length > 0 && (
        <div className="mt-2 text-[11px] text-emerald-600">{advisor.match_reasons.join(' · ')}</div>
      )}
      {!advisor.accepting_bookings && (
        <div className="mt-2 text-[11px] text-amber-700">Not accepting bookings right now</div>
      )}
      {advisor.user_id && (
        <div className="mt-2">
          <UserTrustBadge userId={advisor.user_id} viewerRole={viewerRole} />
        </div>
      )}
      {advisor.user_id && <CalendlyCTA userId={advisor.user_id} />}
    </button>
  );
}

// Task #3 — Calendly inline CTA. Renders only when the target user has
// connected Calendly + configured a booking URL via Settings → Integrations.
// Falls back to silent absence (404 → null) so the advisor card stays clean.
function CalendlyCTA({ userId }) {
  const [link, setLink] = useState(null);
  useEffect(() => {
    let alive = true;
    api.publicCalendlyBooking(userId).then((r) => { if (alive) setLink(r); }).catch(() => {});
    return () => { alive = false; };
  }, [userId]);
  if (!link?.booking_url) return null;
  return (
    <a
      href={link.booking_url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded px-2 py-1"
    >
      <Calendar size={12} /> Book via Calendly
    </a>
  );
}

function BookingForm({ slot, advisor, onClose, onBooked }) {
  const { user } = useAuth();
  const [topic, setTopic] = useState('');
  const [questions, setQuestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    if (!topic.trim()) { setErr('Topic is required'); return; }
    setErr(null); setBusy(true);
    try {
      const b = await api.bookAdvisorSlot(slot.id, { topic, questions });
      onBooked(b);
      // Spin-Out Lab — Week 3 milestone for first advisor booking.
      await markMilestone(user, 'advisor_meeting_booked');
    } catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        setErr('This slot is no longer available — please pick a different time.');
      } else if (status === 409 || msg.includes('conflict') || msg.includes('already')) {
        setErr('This slot was just booked by someone else. Please pick a different time.');
      } else if (status === 401 || status === 403) {
        setErr('Your session expired. Please sign in again to book.');
      } else {
        setErr('Booking failed. Please retry in a moment, or contact support if it persists.');
      }
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 dark:bg-gray-900">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Book {advisor.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {new Date(slot.start_at).toLocaleString()} · {slot.duration_min} min
            </div>
          </div>
          <button onClick={onClose}><X size={18} className="text-gray-500" /></button>
        </div>
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Topic</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="GTM strategy review"
          className="w-full px-3 py-2 border border-gray-300 rounded mb-3 text-sm dark:border-gray-700" />
        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Questions / context</label>
        <textarea value={questions} onChange={(e) => setQuestions(e.target.value)}
          rows={4} placeholder="What I want to walk away with…"
          className="w-full px-3 py-2 border border-gray-300 rounded mb-3 text-sm dark:border-gray-700" />
        {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
        <button disabled={busy} onClick={submit}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white py-2 rounded text-sm font-medium flex items-center justify-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin" />}
          Request booking
        </button>
      </div>
    </div>
  );
}

function AdvisorDetail({ advisor, onClose, onBooked }) {
  const [slots, setSlots] = useState(null);
  const [bookSlot, setBookSlot] = useState(null);
  useEffect(() => {
    api.listAdvisorSlots(advisor.uid).then((d) => setSlots(d.items)).catch(() => setSlots([]));
  }, [advisor.uid]);
  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto dark:bg-gray-900">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">{advisor.name}</div>
            {advisor.headline && <div className="text-sm text-gray-600">{advisor.headline}</div>}
            {advisor.rating_avg && (
              <div className="flex items-center gap-2 mt-2">
                <StarRow rating={Math.round(advisor.rating_avg)} />
                <span className="text-sm text-gray-600">{advisor.rating_avg.toFixed(1)} ({advisor.rating_count} reviews)</span>
              </div>
            )}
          </div>
          <button onClick={onClose}><X size={18} className="text-gray-500" /></button>
        </div>
        {advisor.bio && <p className="text-sm text-gray-700 mb-4 dark:text-gray-300">{advisor.bio}</p>}
        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div><span className="text-gray-500">Rate:</span> {advisor.hourly_rate > 0 ? `$${advisor.hourly_rate}/hr` : 'Free'}</div>
          <div><span className="text-gray-500">Capacity:</span> {advisor.capacity_per_week}/week</div>
          {advisor.timezone && <div><span className="text-gray-500">Timezone:</span> {advisor.timezone}</div>}
          {advisor.calcom_username && <div><span className="text-gray-500">Cal.com:</span> @{advisor.calcom_username}</div>}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 mt-4 dark:text-gray-100">Open office hours</h3>
        {slots === null ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : slots.length === 0 ? (
          <div className="text-sm text-gray-500">No open slots — check back later.</div>
        ) : (
          <div className="space-y-2">
            {slots.filter((s) => s.status === 'open' && s.remaining > 0).map((s) => (
              <div key={s.id} className="flex items-center justify-between border border-gray-200 rounded p-3 dark:border-gray-800">
                <div className="text-sm">
                  <div className="font-medium text-gray-900 flex items-center gap-2 dark:text-gray-100">
                    <Calendar size={14} /> {new Date(s.start_at).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1"><Clock size={12} /> {s.duration_min} min</span>
                    {s.location_kind === 'video' && <span className="flex items-center gap-1"><Video size={12} /> video</span>}
                    {s.capacity > 1 && <span>group · {s.remaining}/{s.capacity} left</span>}
                  </div>
                </div>
                <button onClick={() => setBookSlot(s)}
                  className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded font-medium">
                  Book
                </button>
              </div>
            ))}
          </div>
        )}
        {advisor.recent_reviews?.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-gray-900 mb-2 mt-6 dark:text-gray-100">Recent reviews</h3>
            <div className="space-y-2">
              {advisor.recent_reviews.map((r) => (
                <div key={r.id} className="border border-gray-200 rounded p-3 dark:border-gray-800">
                  <StarRow rating={r.rating} />
                  {r.comment && <div className="text-sm text-gray-700 mt-1 dark:text-gray-300">{r.comment}</div>}
                  <div className="text-[10px] text-gray-400 mt-1">{new Date(r.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          </>
        )}
        {bookSlot && (
          <BookingForm slot={bookSlot} advisor={advisor}
            onClose={() => setBookSlot(null)}
            onBooked={(b) => { setBookSlot(null); onBooked?.(b); onClose(); }} />
        )}
      </div>
    </div>
  );
}

function ReviewModal({ booking, onClose, onSubmitted }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    setErr(null); setBusy(true);
    try {
      await api.fileAdvisorReview(booking.id, { rating, comment });
      onSubmitted();
    } catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        setErr('This booking is no longer available. Refresh the page and try again.');
      } else if (status === 409 || msg.includes('already')) {
        setErr("You've already reviewed this booking.");
      } else if (status === 401 || status === 403) {
        setErr('Your session expired. Please sign in again to file a review.');
      } else {
        setErr('Filing the review failed. Please retry in a moment, or contact support if it persists.');
      }
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 dark:bg-gray-900">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Review your session</div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mb-3 text-sm text-gray-600">Topic: {booking.topic}</div>
        <div className="mb-3"><StarRow rating={rating} onChange={setRating} /></div>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)}
          rows={4} placeholder="What stood out? (optional)"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-3 dark:border-gray-700" />
        {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
        <button disabled={busy} onClick={submit}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white py-2 rounded text-sm font-medium">
          {busy ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </div>
  );
}

function MyBookings({ refreshKey }) {
  const [bookings, setBookings] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  useEffect(() => {
    api.listMyMenteeBookings().then((d) => setBookings(d.items)).catch(() => setBookings([]));
  }, [refreshKey]);
  if (bookings === null) return <div className="text-sm text-gray-500">Loading…</div>;
  if (bookings.length === 0) return <div className="text-sm text-gray-500">No bookings yet.</div>;
  return (
    <div className="space-y-2">
      {bookings.map((b) => (
        <div key={b.id} className="bg-white border border-gray-200 rounded p-4 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{b.topic}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(b.scheduled_start).toLocaleString()} · status: <span className="font-medium">{b.status}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {b.status === 'completed' && (
                <button onClick={() => setReviewing(b)}
                  className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded font-medium">
                  Review
                </button>
              )}
              {(b.status === 'requested' || b.status === 'confirmed') && (
                <button
                  onClick={async () => {
                    if (!confirm('Cancel this booking?')) return;
                    try { await api.cancelAdvisorBooking(b.id, 'Cancelled by mentee'); location.reload(); }
                    catch (e) {
                      const status = e?.status;
                      const msg = (e?.message || '').toLowerCase();
                      if (status === 404 || msg.includes('not found')) {
                        // Already gone — refresh to drop it from the list.
                        location.reload();
                      } else if (status === 401 || status === 403) {
                        alert('Your session expired. Please sign in again to cancel this booking.');
                      } else {
                        alert('Cancellation failed. Please retry in a moment, or contact support if it persists.');
                      }
                    }
                  }}
                  className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded dark:text-gray-200">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {reviewing && (
        <ReviewModal booking={reviewing}
          onClose={() => setReviewing(null)}
          onSubmitted={() => { setReviewing(null); location.reload(); }} />
      )}
    </div>
  );
}

export default function AdvisorsPage({ embedded = false }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filters, setFilters] = useState({ q: '', specialty: '', sector: '', free_only: false, max_rate: '' });
  const [openAdvisor, setOpenAdvisor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const opts = { ...filters };
      if (!opts.q) delete opts.q;
      if (!opts.specialty) delete opts.specialty;
      if (!opts.sector) delete opts.sector;
      if (!opts.free_only) delete opts.free_only;
      if (opts.max_rate === '') delete opts.max_rate;
      else opts.max_rate = Number(opts.max_rate);
      const r = await api.listAdvisors(opts);
      setItems(r.items || []);
    } catch (e) {
      // Defensive 404 — backend may return "Not found" if the advisors index
      // is empty or the user has no scope. Treat as the empty state below
      // ("No advisors match your filters yet.") instead of a raw red banner.
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        setItems([]);
      } else if (status === 401 || status === 403) {
        setErr('Your session expired. Please sign in again to browse advisors.');
      } else {
        setErr("Couldn't load the advisor directory right now. Please retry in a moment, or contact support if it persists.");
      }
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-6">
      {/* When embedded inside the Team Building workspace the page-level
          heading is suppressed so the parent's single title governs. */}
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Advisor directory</h1>
          <PageExplainer pageKey="advisors" />
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Find an operator-advisor for office hours or 1:1 guidance. Bookings include
            two-sided reviews so quality compounds.
          </p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end dark:bg-gray-900 dark:border-gray-800">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="name, headline, keyword"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Specialty</label>
          <input value={filters.specialty}
            onChange={(e) => setFilters({ ...filters, specialty: e.target.value })}
            placeholder="e.g. fundraising"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Max $/hr</label>
          <input value={filters.max_rate} type="number" min="0"
            onChange={(e) => setFilters({ ...filters, max_rate: e.target.value })}
            placeholder="any"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm dark:border-gray-700" />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-700 flex items-center gap-1 dark:text-gray-300">
            <input type="checkbox" checked={filters.free_only}
              onChange={(e) => setFilters({ ...filters, free_only: e.target.checked })} />
            Free only
          </label>
          <button onClick={load}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm py-2 rounded font-medium">
            Apply
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading advisors…</div>
      ) : err ? (
        <div className="text-sm text-red-600">{err}</div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500 dark:bg-gray-900 dark:border-gray-800">
          No advisors match your filters yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((m) => <AdvisorCard key={m.uid} advisor={m} onOpen={setOpenAdvisor} viewerRole={user?.role} />)}
        </div>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
          <MessageCircle size={18} /> My bookings
        </h2>
        <MyBookings refreshKey={refreshKey} />
      </section>

      {openAdvisor && (
        <AdvisorDetail advisor={openAdvisor}
          onClose={() => setOpenAdvisor(null)}
          onBooked={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}
