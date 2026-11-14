/* Task #35 — Advisor directory + booking
 *
 * Browse all listed advisors, filter by specialty/sector/free/max-rate,
 * open an advisor's profile to see open office-hour slots, request a
 * booking, and after a booking is completed file a 1-5 star review.
 */
import { useEffect, useId, useState } from 'react';
import { Search, Star, Calendar, Clock, Video, MessageCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import Sheet from '../ui/Sheet.jsx';
import Lightbox from '../ui/Lightbox';
import { useAuth } from '../hooks/useAuthSync';
import UserTrustBadge from '../components/UserTrustBadge';
import PageExplainer from '../components/PageExplainer';
import { markMilestone } from '../lib/spinoutLabHooks';
// The shapes the worker actually emits. These adapters were private to the
// Advisory workspace, which is exactly why this page stayed broken against the
// same DTOs — see their header in that file.
import {
  bookingView, formatDateTime, isBookableSlot, offerFromType, offerLine, slotMinutes,
  slotUnavailableReason, slotView,
} from './advisor/advisory/kit';

/**
 * #4715 (D4715): a rating someone sets is five named, pressed-state buttons; a
 * rating someone reads is one image with its value in words, not five unnamed
 * buttons that do nothing.
 */
export function StarRow({ rating, onChange }) {
  const stars = [1, 2, 3, 4, 5];
  const value = Number(rating || 0);
  if (!onChange) {
    return (
      <div className="flex items-center gap-1" role="img" aria-label={`Rated ${value} of 5`}>
        {stars.map((n) => (
          <Star key={n} size={14} aria-hidden="true" className={n <= value ? 'text-amber-400' : 'text-zinc-300'} fill={n <= value ? 'currentColor' : 'none'} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Rating: ${value} of 5`}>
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={n === value}
          className={`${n <= value ? 'text-amber-400' : 'text-zinc-300'} min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600`}
        >
          <Star size={22} aria-hidden="true" fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

export function AdvisorCard({ advisor, onOpen, viewerRole }) {
  return (
    <button
      onClick={() => onOpen(advisor)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-5 hover:border-violet-400 hover:shadow-md transition dark:bg-gray-900 dark:border-gray-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-gray-900 dark:text-gray-100">{advisor.display_name}</div>
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
            {advisor.hourly_rate_usd == null ? 'Not recorded — no rate set' : advisor.hourly_rate_usd > 0 ? `$${advisor.hourly_rate_usd}/hr` : 'Free'}
          </div>
        </div>
      </div>
      {advisor.expertise?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {advisor.expertise.slice(0, 6).map((s) => (
            <span key={s} className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-700 rounded">{s}</span>
          ))}
        </div>
      )}
      {advisor.match_reasons?.length > 0 && (
        <div className="mt-2 text-[11px] text-emerald-600">{advisor.match_reasons.join(' · ')}</div>
      )}
      {!advisor.is_active && (
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

function BookingForm({ slot, advisor, sessionType, bookingLinkSlug, onClose, onBooked }) {
  const { user } = useAuth();
  const [topic, setTopic] = useState('');
  const [questions, setQuestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const offer = offerFromType(sessionType);
  const ids = useId();
  async function submit() {
    if (!topic.trim()) { setErr('Topic is required'); return; }
    setErr(null); setBusy(true);
    try {
      const b = await api.bookAdvisorSlot(slot.id, { topic, notes: questions, ...(sessionType ? { session_type_id: sessionType.id } : {}), ...(bookingLinkSlug ? { booking_link_slug: bookingLinkSlug } : {}) });
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
  // #4715 (D4715): a real dialog (Lightbox: role, name, focus in and back, Escape, ×), labelled fields,
  // and an error that is announced rather than only drawn.
  return (
    <Lightbox label={`Book ${advisor.display_name || 'this advisor'}`} title={`Book ${advisor.display_name || 'this advisor'}`}
      sub={`${formatDateTime(slot.startsAt)}${slotMinutes(slot) != null ? ` · ${slotMinutes(slot)} min` : ''}`}
      onClose={onClose} width={460} phone="sheet" testId="booking-dialog">
      <form className="px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {/* D4715: the exact offer being booked, as the worker will copy it onto the booking. */}
        {offer && (
          <div data-testid="booking-offer" className="mb-3 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100">
            You are booking: <span className="font-medium">{offerLine(offer)}</span>
            {offer.cadence_note && <div className="mt-0.5 text-violet-700 dark:text-violet-300">{offer.cadence_note}</div>}
          </div>
        )}
        <label htmlFor={`${ids}-topic`} className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Topic</label>
        <input id={`${ids}-topic`} value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="GTM strategy review" required aria-required="true"
          aria-invalid={err === 'Topic is required' ? 'true' : undefined}
          aria-describedby={err ? `${ids}-error` : undefined}
          className="w-full px-3 py-2 border border-gray-300 rounded mb-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 dark:border-gray-700" />
        <label htmlFor={`${ids}-notes`} className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Questions / context</label>
        <textarea id={`${ids}-notes`} value={questions} onChange={(e) => setQuestions(e.target.value)}
          rows={4} placeholder="What I want to walk away with…"
          className="w-full px-3 py-2 border border-gray-300 rounded mb-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 dark:border-gray-700" />
        {err && <div id={`${ids}-error`} role="alert" className="text-sm text-red-600 mb-2">{err}</div>}
        <button type="submit" disabled={busy} aria-busy={busy ? 'true' : undefined}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white py-2 rounded text-sm font-medium flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {busy ? 'Sending request…' : 'Request booking'}
        </button>
      </form>
    </Lightbox>
  );
}

export function AdvisorDetail({ advisor, sessionType, bookingLinkSlug, onClose, onBooked }) {
  const [slots, setSlots] = useState(null);
  const [slotsError, setSlotsError] = useState('');
  const [bookSlot, setBookSlot] = useState(null);
  useEffect(() => {
    let live = true;
    setSlots(null);
    setSlotsError('');
    api.listAdvisorSlots(advisor.uid)
      .then((d) => { if (live) setSlots(d.items || []); })
      // A failed read used to fall through to `setSlots([])`, which renders
      // "No open slots — check back later": a positive claim about this
      // advisor's availability that the page never actually read.
      .catch((e) => { if (live) setSlotsError(e?.message || 'Availability could not be loaded.'); });
    return () => { live = false; };
  }, [advisor.uid]);
  // What the worker calls bookable. `s.status === 'open' && s.remaining > 0`
  // stood here and matched nothing — `slotDto` emits neither key — so every
  // advisor looked fully booked and native booking was unreachable.
  const offered = (slots || []).filter(isBookableSlot).map(slotView).filter(s => sessionType?.duration_minutes == null || slotMinutes(s) === sessionType.duration_minutes);
  // #4692: the booking refuses an hour inside the advisor's minimum notice, a
  // blackout or the buffer around a session they hold, and a paid one in a week
  // at their paid cap. `GET /:uid/slots` answers all four per slot (D4692); the
  // page offered them a Book button regardless and let the founder find out at
  // the click. The hour stays listed, under the reason, so the schedule still
  // shows the time exists.
  const offer = sessionType ? offerFromType(sessionType) : null;
  const bookable = offered.filter((s) => !slotUnavailableReason(s, offer));
  const ruledOut = offered
    .map((s) => ({ slot: s, reason: slotUnavailableReason(s, offer) }))
    .filter((r) => r.reason);
  return (
    <Sheet label={advisor.display_name || 'Advisor'} title={advisor.display_name} sub={advisor.headline || undefined}
      onClose={onClose} width={640} testId="advisor-detail">
      <div className="p-6">
        {advisor.rating_avg && (
          <div className="flex items-center gap-2 mb-3">
            <StarRow rating={Math.round(advisor.rating_avg)} />
            <span className="text-sm text-gray-600">{advisor.rating_avg.toFixed(1)} ({advisor.rating_count} reviews)</span>
          </div>
        )}
        {advisor.bio && <p className="text-sm text-gray-700 mb-4 dark:text-gray-300">{advisor.bio}</p>}
        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          {/* D4715: a booking made for one session type states that offer, not the general hourly rate. */}
          {sessionType ? (
            <div data-testid="detail-offer" className="col-span-2"><span className="text-gray-500">Session:</span> {offerLine(offerFromType(sessionType))}</div>
          ) : (
            <div><span className="text-gray-500">Rate:</span> {advisor.hourly_rate_usd == null ? 'Not recorded — no rate set' : advisor.hourly_rate_usd > 0 ? `$${advisor.hourly_rate_usd}/hr` : 'Free'}</div>
          )}
          <div><span className="text-gray-500">Capacity:</span> Not recorded — no weekly capacity published</div>
          {advisor.timezone && <div><span className="text-gray-500">Timezone:</span> {advisor.timezone}</div>}
          {advisor.calcom_username && <div><span className="text-gray-500">Cal.com:</span> @{advisor.calcom_username}</div>}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 mt-4 dark:text-gray-100">Open office hours</h3>
        {slotsError ? (
          <div className="text-sm text-amber-700 dark:text-amber-300">
            {slotsError} Nothing is listed rather than an empty schedule — this advisor may well
            have open times.
          </div>
        ) : slots === null ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : bookable.length === 0 && ruledOut.length === 0 ? (
          <div className="text-sm text-gray-500">No open slots — check back later.</div>
        ) : (
          <div className="space-y-2">
            {bookable.length === 0 && (
              <div className="text-sm text-gray-500" data-testid="slots-all-ruled-out">
                This advisor has open hours, but none of them can be booked right now. Each one says why below.
              </div>
            )}
            {bookable.map((s) => (
              <div key={s.id} className="flex items-center justify-between border border-gray-200 rounded p-3 dark:border-gray-800">
                <div className="text-sm">
                  <div className="font-medium text-gray-900 flex items-center gap-2 dark:text-gray-100">
                    <Calendar size={14} /> {formatDateTime(s.startsAt)}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-3 mt-1">
                    {/* Duration is derived from the window the worker sends.
                        `duration_min` is an input to slot CREATION, not a key
                        `slotDto` returns — reading it printed "undefined min". */}
                    {slotMinutes(s) != null && (
                      <span className="flex items-center gap-1"><Clock size={12} /> {slotMinutes(s)} min</span>
                    )}
                    {s.hasMeetingLink && <span className="flex items-center gap-1"><Video size={12} /> video</span>}
                    {s.capacity > 1 && <span>group · {s.available}/{s.capacity} left</span>}
                  </div>
                </div>
                <button type="button" onClick={() => setBookSlot(s)}
                  aria-label={`Book ${formatDateTime(s.startsAt)}${slotMinutes(s) != null ? `, ${slotMinutes(s)} minutes` : ''}`}
                  className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 min-h-[44px] rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
                  Book
                </button>
              </div>
            ))}
            {ruledOut.map(({ slot: s, reason }) => (
              <div key={s.id} data-testid={`slot-unavailable-${s.id}`}
                className="flex items-center justify-between border border-dashed border-gray-200 rounded p-3 dark:border-gray-800">
                <div className="text-sm">
                  <div className="font-medium text-gray-500 flex items-center gap-2 dark:text-gray-400">
                    <Calendar size={14} /> {formatDateTime(s.startsAt)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {slotMinutes(s) != null && <span className="mr-2">{slotMinutes(s)} min</span>}
                    {reason}
                  </div>
                </div>
                <span className="text-xs text-gray-400 px-3 py-1.5">Not bookable</span>
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
          <BookingForm slot={bookSlot} advisor={advisor} sessionType={sessionType} bookingLinkSlug={bookingLinkSlug}
            onClose={() => setBookSlot(null)}
            onBooked={(b) => { setBookSlot(null); onBooked?.(b); onClose(); }} />
        )}
      </div>
    </Sheet>
  );
}

export function ReviewModal({ booking, onClose, onSubmitted }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ids = useId();
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
  // #4715 (D4715): the same dialog contract as the booking form.
  return (
    <Lightbox label="Review your session" title="Review your session" sub={booking.topic ? `Topic: ${booking.topic}` : undefined}
      onClose={onClose} width={460} phone="sheet" testId="review-dialog">
      <form className="px-5 py-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <fieldset className="mb-3">
          <legend className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Rating</legend>
          <StarRow rating={rating} onChange={setRating} />
        </fieldset>
        <label htmlFor={`${ids}-comment`} className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Comment (optional)</label>
        <textarea id={`${ids}-comment`} value={comment} onChange={(e) => setComment(e.target.value)}
          rows={4} placeholder="What stood out?"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 dark:border-gray-700" />
        {err && <div role="alert" className="text-sm text-red-600 mb-2">{err}</div>}
        <button type="submit" disabled={busy} aria-busy={busy ? 'true' : undefined}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white py-2 rounded text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
          {busy ? 'Submitting…' : 'Submit review'}
        </button>
      </form>
    </Lightbox>
  );
}

function MyBookings({ refreshKey }) {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(null);
  useEffect(() => {
    let live = true;
    setBookings(null);
    setError('');
    api.listMyMenteeBookings()
      .then((d) => { if (live) setBookings((d.items || []).map(bookingView)); })
      // Was `.catch(() => setBookings([]))`, which rendered "No bookings yet"
      // — a claim about the reader's own history that the page never read.
      .catch((e) => { if (live) setError(e?.message || 'Your bookings could not be loaded.'); });
    return () => { live = false; };
  }, [refreshKey]);
  if (error) {
    return (
      <div className="text-sm text-amber-700 dark:text-amber-300">
        {error} Nothing is listed rather than an empty history.
      </div>
    );
  }
  if (bookings === null) return <div className="text-sm text-gray-500">Loading…</div>;
  if (bookings.length === 0) return <div className="text-sm text-gray-500">No bookings yet.</div>;
  return (
    <div className="space-y-2">
      {bookings.map((b) => (
        <div key={b.id} className="bg-white border border-gray-200 rounded p-4 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{b.topic}</div>
              {b.offer && <div data-testid={`booking-offer-${b.id}`} className="text-xs text-gray-700 mt-0.5 dark:text-gray-300">{offerLine(b.offer)}</div>}
              <div className="text-xs text-gray-500 mt-0.5">
                {b.startsAt ? formatDateTime(b.startsAt) : 'Time not recorded'} · status:{' '}
                <span className="font-medium">{b.status}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {b.status === 'completed' && (
                <button onClick={() => setReviewing(b)}
                  className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded font-medium">
                  Review
                </button>
              )}
              {/* `requested` alone left a founder unable to cancel a booking
                  the worker had just created as `pending`. */}
              {(b.awaitingDecision || b.status === 'confirmed') && (
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
