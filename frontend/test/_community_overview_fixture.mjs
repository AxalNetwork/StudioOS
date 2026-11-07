/**
 * #4717 — a whole Community read, in the worker's shape (D931 with D918's
 * events blocks), that draws every part and keeps the read's contract
 * (`model/contract.js`). Package 3's shape tests break it one field at a
 * time; package 6's accessibility test mounts the page on it. Every record is
 * made up.
 */
import { EVENT_TYPES } from '../src/lib/eventTypes.js';

export const NOW = Date.parse('2026-10-24T12:00:00Z');
export const at = (hours) => new Date(NOW + hours * 3_600_000).toISOString();
export const WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const TYPES = Object.fromEntries(EVENT_TYPES.map((t) => [t.id, 0]));
const ROLES = { founder: 0, investor: 0, advisor: 0, operating_partner: 0, explorer: 0, guest: 0, other: 0 };

/** A whole answer, in the worker's shape (D931 with D918's events blocks), that draws every part. */
export function full() {
  return {
    weeks: 4, week_starts: WEEKS, current_week: WEEKS[3], as_of: at(0),
    blocks: {
      queue: {
        events: { available: true, count: 2, oldest_since: at(-100), oldest_hours: 100, overdue: 1, overdue_after_hours: 72, waiting_from_created_at: 1 },
        event_rows: { available: true, total: 2, rows: [
          { event_id: 9, title: 'Pricing Clinic', waiting_since: at(-100), from_created: false, waiting_hours: 100, overdue: true },
        ] },
        jobs: { available: true, pending: 2, overdue: 0, wait_not_recorded: 1, oldest_wait_hours: 30, review: [
          { posting_id: 3, title: 'Backend Engineer', company: 'Acme', waiting_since: at(-30), waiting_hours: 30, overdue: false },
        ] },
      },
      events: {
        weekly: { available: true, registrations: { window: 60, previous: 40 }, weekly: WEEKS.map((w, i) => ({ week: w, registrations: 15, checkins: 2, to_date: i === 3 })) },
        show_up: { available: true, events: 3, seats_taken: 80, confirmed: 64, attended: 52, rate: 0.65 },
        upcoming: { available: true, events: 3, seats_taken: 59, full: 0 },
        next_up: { available: true, total: 3, rows: [
          { event_id: 1, title: 'Demo Day', status: 'published', starts_at: at(48), timezone: 'UTC', capacity: 60, seats_taken: 42 },
        ] },
        by_type: { available: true, counts: { ...TYPES, workshop: 4, office_hours: 2 } },
        waitlisted: { available: true, registrations: 9, events: 2 },
        by_status: { available: true, counts: { published: 3, pending_review: 2 } },
      },
      jobs: {
        available: true,
        applications: { window: 12, previous: 10 },
        weekly: WEEKS.map((w, i) => ({ week: w, count: 3, to_date: i === 3 })),
        by_status: { draft: 1, pending_review: 2, published: 3, rejected: 0, closed: 0, other: 0 },
        most_applied: [{ posting_id: 3, title: 'Backend Engineer', company: 'Acme', status: 'published', applications: 4, days_open: 10 }],
      },
      participation_by_role: {
        events: { available: true, by_role: { ...ROLES, founder: 30, investor: 10 }, not_recorded: 4 },
        jobs: { available: true, by_role: { ...ROLES, founder: 2, explorer: 6 } },
      },
      circles: { available: true, total: 4, published: 3, featured: 1, members_entered: { value: 40 }, by_type: { founder: 2, city: 2 } },
      network: { available: true, by_kind_state: { advisor: { active: 3, hidden: 1 } } },
      wellbeing: {
        experts: { available: true, verified: 9, unverified: 3, hidden: 1, inactive: 2 },
        bookings: { available: true, window: 7, previous: 2, weekly: WEEKS.map((w, i) => ({ week: w, count: 2, to_date: i === 3 })) },
        checkins: { available: true, withheld: false, min_cohort: 7, band: { at_least: 10, under: 15 } },
      },
    },
  };
}

