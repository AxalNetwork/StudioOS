// Shared UI primitives for the advisor Advisory workspace pages. The base
// primitives (chips, search, slide-over, sections, stat cards, sub-tabs, empty
// state) are reused from the Network kit so both advisor sections read
// identically; this file adds Advisory-specific pieces (status badges, progress
// bars, checklists, timelines) on top.
import React from 'react';
import { Check } from 'lucide-react';

export {
  Avatar, Chip, SearchInput, FilterChips, SlideOver, Section, Field, StatCard,
  SubTabs, EmptyState,
} from '../network/kit';

// Map a free-text status to a chip tone so statuses read consistently.
const STATUS_TONE = {
  // positive / done
  won: 'emerald', 'closed won': 'emerald', active: 'emerald', signed: 'emerald',
  paid: 'emerald', delivered: 'emerald', completed: 'emerald', high: 'emerald',
  // in-flight / neutral-positive
  'in progress': 'blue', 'in review': 'blue', 'under review': 'blue', sent: 'blue',
  scheduled: 'blue', processing: 'blue', onboarding: 'blue', 'call scheduled': 'blue',
  medium: 'blue', qualified: 'blue', 'verbal agreement': 'blue',
  // pending / attention
  proposed: 'amber', 'awaiting signature': 'amber', 'awaiting reply': 'amber',
  'proposal sent': 'amber', draft: 'amber', upcoming: 'amber', pending: 'amber',
  new: 'amber', 'needs assessment done': 'amber', 'kickoff complete': 'amber',
  'in negotiation': 'amber', 'not started': 'gray',
  // negative
  lost: 'rose', 'closed lost': 'rose', overdue: 'rose', low: 'rose',
};

export function StatusBadge({ status }) {
  if (!status) return null;
  const tone = STATUS_TONE[String(status).toLowerCase()] || 'gray';
  const tones = {
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${tones[tone]}`}>
      {status}
    </span>
  );
}

export function ProgressBar({ value, tone = 'violet' }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const bar = {
    violet: 'bg-violet-500', emerald: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500',
  }[tone] || 'bg-violet-500';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-gray-600 dark:text-gray-400 w-9 text-right">{v}%</span>
    </div>
  );
}

// Checklist of { label, done } items.
export function Checklist({ items }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
            it.done ? 'bg-emerald-500 text-white' : 'border border-gray-300 dark:border-gray-600'
          }`}>
            {it.done && <Check size={11} />}
          </span>
          <span className={it.done ? 'text-gray-500 line-through dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}>
            {it.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Simple bulleted list with a heading, used across detail panels.
export function BulletList({ items, tone = 'gray' }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-gray-400 italic">—</p>;
  }
  const dot = {
    gray: 'bg-gray-400', emerald: 'bg-emerald-500', rose: 'bg-rose-400', violet: 'bg-violet-500',
    blue: 'bg-blue-500', amber: 'bg-amber-500',
  }[tone] || 'bg-gray-400';
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <span className={`w-1.5 h-1.5 rounded-full ${dot} mt-1.5 flex-shrink-0`} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

// Vertical timeline of { date, label, type } events.
const TIMELINE_TONE = {
  engagement: 'bg-violet-500', contract: 'bg-blue-500', meeting: 'bg-amber-500',
  deliverable: 'bg-emerald-500', milestone: 'bg-fuchsia-500', renewal: 'bg-teal-500',
};
export function Timeline({ events, renderMeta }) {
  return (
    <ol className="relative border-l border-gray-200 dark:border-gray-800 ml-1.5 space-y-4">
      {events.map((e, i) => (
        <li key={i} className="ml-4">
          <span className={`absolute -left-[5px] w-2.5 h-2.5 rounded-full ${TIMELINE_TONE[e.type] || 'bg-gray-400'}`} />
          <div className="text-sm text-gray-800 dark:text-gray-200">{e.label}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{renderMeta ? renderMeta(e) : e.date}</div>
        </li>
      ))}
    </ol>
  );
}

// Labelled placeholder wrapper for AI-generated sample output.
export function AiSample({ children }) {
  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-900/60 bg-violet-50/60 dark:bg-violet-900/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300 mb-1">
        AI summary · sample output
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">{children}</p>
    </div>
  );
}

// Clickable list-row card used by the pipeline / list surfaces.
export function RowCard({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors"
    >
      {children}
    </button>
  );
}

// ---- Live-data helpers (Wave 1b) ------------------------------------------
// These replace the formatters that lived in data/advisor/advisory.js, which
// were pinned to a fixed demo "today" (2026-07-11). Real pages use the real
// clock.
export function formatDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  });
}

export function formatRelativeDay(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.round((t - Date.now()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${-diff}d ago`;
  if (diff === 1) return 'Tomorrow';
  return `in ${diff}d`;
}

/**
 * THE SLOT AND BOOKING SHAPES THE WORKER ACTUALLY EMITS.
 *
 * WHY THESE EXIST, and it is a live defect rather than tidiness. Several pages
 * read keys the DTOs have never emitted, and each one fails silently:
 *
 *   `slotDto`    (routes/advisors.ts:106) emits starts_at, ends_at, capacity,
 *                taken, available, meeting_url, notes, is_cancelled.
 *                It does NOT emit start_at, duration_min, location_kind,
 *                status, or remaining.
 *   `bookingDto` (routes/advisors.ts:117) emits slot_starts_at (on
 *                /me/bookings) and a status born as 'pending'.
 *                It does NOT emit scheduled_start, and never 'requested'.
 *
 * The damage: `AdvisorsPage.jsx` filtered slots on `s.status === 'open' &&
 * s.remaining > 0`, which matches nothing, so **no founder could ever see an
 * advisor's availability** and native booking was unreachable. `/office-hours`
 * rendered "Invalid Date · undefined min" on every slot, never showed its
 * cancel button, and gated Confirm/Decline on a status the worker does not
 * write — so an advisor could not accept a booking there either.
 *
 * The Advisory pages were the only ones defended, with private copies of these
 * adapters. Private is how the other callers stayed broken, so they move here.
 *
 * WORKER-OUT, per the convention `documentation/audits/PARTNER_UX_AUDIT.md:66`
 * states: the frontend moves to the worker's contract, not the reverse. The
 * legacy key is still read FIRST where one exists, because the FastAPI dev
 * backend emits some of them and a dev session should not break.
 */
export function slotView(slot) {
  const s = slot || {};
  const capacity = Number(s.capacity || 0);
  const available = s.remaining ?? s.available ?? Math.max(0, capacity - Number(s.taken || 0));
  return {
    ...s,
    startsAt: s.start_at || s.starts_at || null,
    endsAt: s.ends_at || null,
    capacity,
    available,
    taken: s.taken ?? Math.max(0, capacity - available),
    // `is_cancelled` is the worker's word; `status` is the dev backend's.
    cancelled: s.status ? s.status === 'cancelled' : Boolean(s.is_cancelled),
    meetingUrl: s.meeting_url ?? s.location_uri ?? null,
  };
}

/** A slot a founder can actually book: published, not cancelled, not full. */
export function isBookableSlot(slot) {
  const v = slotView(slot);
  return !v.cancelled && v.available > 0;
}

/**
 * How long a slot runs, derived from the window rather than read off a key.
 *
 * `duration_min` is an INPUT to slot creation — `api.createAdvisorSlot` turns
 * it into `ends_at` before POSTing — and is not something `slotDto` ever
 * returns. Reading it back printed "undefined min". Returns null rather than a
 * guess when either end is missing.
 */
export function slotMinutes(slot) {
  const v = slotView(slot);
  if (!v.startsAt || !v.endsAt) return null;
  const ms = new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

/**
 * Booking statuses that mean "the advisor has not decided yet".
 *
 * BOTH WORDS, and that is not defensive padding. The worker's only INSERT
 * (routes/advisors.ts:530) writes 'pending' and its confirm handler
 * (:709) allows 'pending'; nothing in the worker has ever written
 * 'requested'. The FastAPI dev backend uses the other word. A page that picks
 * one is broken against the other runtime — which is exactly how Confirm and
 * Decline came to never render on `/office-hours`.
 */
export const AWAITING_DECISION = ['requested', 'pending'];

export function bookingView(booking) {
  const b = booking || {};
  return {
    ...b,
    // Time lives on the SLOT. `/me/bookings` joins it in as slot_starts_at;
    // `scheduled_start` is the dev backend's key. Neither is `bookingDto`'s.
    startsAt: b.scheduled_start || b.slot_starts_at || null,
    endsAt: b.slot_ends_at || null,
    awaitingDecision: AWAITING_DECISION.includes(b.status),
    counterpartyId: b.client_user_id ?? b.founder_user_id ?? b.requester_user_id ?? null,
    counterpartyName: b.client_name || b.founder_name || b.client_email || b.founder_email || null,
    counterpartyEmail: b.client_email || b.founder_email || null,
    note: b.client_message || b.questions || b.notes || null,
  };
}

/**
 * Group advisor bookings by counterparty. The advisor's "clients" are not a
 * table — they are whoever has booked them — so this derivation IS the client
 * list. Keyed on founder_user_id so two people sharing a display name stay
 * distinct. Both runtimes expose neutral client_* aliases; founder_* remains
 * supported for older Worker responses.
 */
export function clientsFromBookings(bookings) {
  const byId = new Map();
  for (const b of bookings || []) {
    const key = b.client_user_id ?? b.founder_user_id ?? b.requester_user_id;
    if (key == null) continue;
    if (!byId.has(key)) {
      byId.set(key, {
        id: key,
        name: b.client_name || b.founder_name || b.client_email || b.founder_email || `Member #${key}`,
        email: b.client_email || b.founder_email || null,
        bookings: [],
      });
    }
    byId.get(key).bookings.push(b);
  }
  for (const c of byId.values()) {
    c.bookings.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    c.total = c.bookings.length;
    c.completed = c.bookings.filter((b) => b.status === 'completed').length;
    c.upcoming = c.bookings.filter((b) => ['requested', 'pending', 'confirmed'].includes(b.status)).length;
    c.lastSeen = c.bookings[0]?.scheduled_start || c.bookings[0]?.slot_starts_at || c.bookings[0]?.created_at || null;
    c.topics = [...new Set(c.bookings.map((b) => b.topic).filter(Boolean))];
  }
  return [...byId.values()].sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
}
