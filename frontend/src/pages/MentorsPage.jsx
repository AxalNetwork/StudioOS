/* Task #35 — Mentor directory + booking
 *
 * Browse all listed mentors, filter by specialty/sector/free/max-rate,
 * open a mentor's profile to see open office-hour slots, request a
 * booking, and after a booking is completed file a 1-5 star review.
 */
import { useEffect, useState } from 'react';
import { Search, Star, Calendar, Clock, Video, X, Send, MessageCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

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

function MentorCard({ mentor, onOpen }) {
  return (
    <button
      onClick={() => onOpen(mentor)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-5 hover:border-violet-400 hover:shadow-md transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-gray-900">{mentor.name}</div>
          {mentor.headline && <div className="text-sm text-gray-600 mt-0.5">{mentor.headline}</div>}
        </div>
        <div className="text-right">
          {mentor.rating_avg ? (
            <div className="flex items-center gap-1 text-amber-500 text-sm font-medium">
              <Star size={14} fill="currentColor" /> {mentor.rating_avg.toFixed(1)}
              <span className="text-gray-400 text-xs">({mentor.rating_count})</span>
            </div>
          ) : <div className="text-xs text-gray-400">No reviews yet</div>}
          <div className="mt-1 text-xs font-medium text-gray-700">
            {mentor.hourly_rate > 0 ? `$${mentor.hourly_rate}/hr` : 'Free'}
          </div>
        </div>
      </div>
      {mentor.specialties?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {mentor.specialties.slice(0, 6).map((s) => (
            <span key={s} className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-700 rounded">{s}</span>
          ))}
        </div>
      )}
      {mentor.match_reasons?.length > 0 && (
        <div className="mt-2 text-[11px] text-emerald-600">{mentor.match_reasons.join(' · ')}</div>
      )}
      {!mentor.accepting_bookings && (
        <div className="mt-2 text-[11px] text-amber-700">Not accepting bookings right now</div>
      )}
    </button>
  );
}

function BookingForm({ slot, mentor, onClose, onBooked }) {
  const [topic, setTopic] = useState('');
  const [questions, setQuestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    if (!topic.trim()) { setErr('Topic is required'); return; }
    setErr(null); setBusy(true);
    try {
      const b = await api.bookMentorSlot(slot.id, { topic, questions });
      onBooked(b);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-lg font-semibold text-gray-900">Book {mentor.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {new Date(slot.start_at).toLocaleString()} · {slot.duration_min} min
            </div>
          </div>
          <button onClick={onClose}><X size={18} className="text-gray-500" /></button>
        </div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Topic</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="GTM strategy review"
          className="w-full px-3 py-2 border border-gray-300 rounded mb-3 text-sm" />
        <label className="block text-xs font-medium text-gray-700 mb-1">Questions / context</label>
        <textarea value={questions} onChange={(e) => setQuestions(e.target.value)}
          rows={4} placeholder="What I want to walk away with…"
          className="w-full px-3 py-2 border border-gray-300 rounded mb-3 text-sm" />
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

function MentorDetail({ mentor, onClose, onBooked }) {
  const [slots, setSlots] = useState(null);
  const [bookSlot, setBookSlot] = useState(null);
  useEffect(() => {
    api.listMentorSlots(mentor.uid).then((d) => setSlots(d.items)).catch(() => setSlots([]));
  }, [mentor.uid]);
  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-xl font-semibold text-gray-900">{mentor.name}</div>
            {mentor.headline && <div className="text-sm text-gray-600">{mentor.headline}</div>}
            {mentor.rating_avg && (
              <div className="flex items-center gap-2 mt-2">
                <StarRow rating={Math.round(mentor.rating_avg)} />
                <span className="text-sm text-gray-600">{mentor.rating_avg.toFixed(1)} ({mentor.rating_count} reviews)</span>
              </div>
            )}
          </div>
          <button onClick={onClose}><X size={18} className="text-gray-500" /></button>
        </div>
        {mentor.bio && <p className="text-sm text-gray-700 mb-4">{mentor.bio}</p>}
        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div><span className="text-gray-500">Rate:</span> {mentor.hourly_rate > 0 ? `$${mentor.hourly_rate}/hr` : 'Free'}</div>
          <div><span className="text-gray-500">Capacity:</span> {mentor.capacity_per_week}/week</div>
          {mentor.timezone && <div><span className="text-gray-500">Timezone:</span> {mentor.timezone}</div>}
          {mentor.calcom_username && <div><span className="text-gray-500">Cal.com:</span> @{mentor.calcom_username}</div>}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 mt-4">Open office hours</h3>
        {slots === null ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : slots.length === 0 ? (
          <div className="text-sm text-gray-500">No open slots — check back later.</div>
        ) : (
          <div className="space-y-2">
            {slots.filter((s) => s.status === 'open' && s.remaining > 0).map((s) => (
              <div key={s.id} className="flex items-center justify-between border border-gray-200 rounded p-3">
                <div className="text-sm">
                  <div className="font-medium text-gray-900 flex items-center gap-2">
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
        {mentor.recent_reviews?.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-gray-900 mb-2 mt-6">Recent reviews</h3>
            <div className="space-y-2">
              {mentor.recent_reviews.map((r) => (
                <div key={r.id} className="border border-gray-200 rounded p-3">
                  <StarRow rating={r.rating} />
                  {r.comment && <div className="text-sm text-gray-700 mt-1">{r.comment}</div>}
                  <div className="text-[10px] text-gray-400 mt-1">{new Date(r.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          </>
        )}
        {bookSlot && (
          <BookingForm slot={bookSlot} mentor={mentor}
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
      await api.fileMentorReview(booking.id, { rating, comment });
      onSubmitted();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Review your session</div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mb-3 text-sm text-gray-600">Topic: {booking.topic}</div>
        <div className="mb-3"><StarRow rating={rating} onChange={setRating} /></div>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)}
          rows={4} placeholder="What stood out? (optional)"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-3" />
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
        <div key={b.id} className="bg-white border border-gray-200 rounded p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900">{b.topic}</div>
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
                    try { await api.cancelMentorBooking(b.id, 'Cancelled by mentee'); location.reload(); }
                    catch (e) { alert(e.message); }
                  }}
                  className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded">
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

export default function MentorsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filters, setFilters] = useState({ q: '', specialty: '', sector: '', free_only: false, max_rate: '' });
  const [openMentor, setOpenMentor] = useState(null);
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
      const r = await api.listMentors(opts);
      setItems(r.items || []);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mentor directory</h1>
        <p className="text-sm text-gray-600 mt-1">
          Find an operator-mentor for office hours or 1:1 guidance. Bookings include
          two-sided reviews so quality compounds.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="name, headline, keyword"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Specialty</label>
          <input value={filters.specialty}
            onChange={(e) => setFilters({ ...filters, specialty: e.target.value })}
            placeholder="e.g. fundraising"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Max $/hr</label>
          <input value={filters.max_rate} type="number" min="0"
            onChange={(e) => setFilters({ ...filters, max_rate: e.target.value })}
            placeholder="any"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-700 flex items-center gap-1">
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
        <div className="text-sm text-gray-500">Loading mentors…</div>
      ) : err ? (
        <div className="text-sm text-red-600">{err}</div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
          No mentors match your filters yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((m) => <MentorCard key={m.uid} mentor={m} onOpen={setOpenMentor} />)}
        </div>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <MessageCircle size={18} /> My bookings
        </h2>
        <MyBookings refreshKey={refreshKey} />
      </section>

      {openMentor && (
        <MentorDetail mentor={openMentor}
          onClose={() => setOpenMentor(null)}
          onBooked={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}
