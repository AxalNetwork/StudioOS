/**
 * #4717 package 6 — The Circles and roster card: circles by type and as entered, and the roster counted on the server (#4717), never named.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { blockOf, count } from './read.js';

export const CIRCLE_TYPES = { founder: 'Founder', investor: 'Investor', partner: 'Partner', advisor: 'Advisor', city: 'City', topic: 'Topic' };

/** The roster's kinds. A legacy `mentor` row counts as Advisor, as #2369 asks. */
export const ROSTER_KINDS = [['advisor', 'Advisor'], ['partner', 'Partner'], ['investor', 'Investor']];

export const rosterKind = (k) => (k === 'mentor' ? 'advisor' : k);

export const ROSTER_UNREAD = 'The roster could not be read. That is not the same as an empty roster.';

export function rosterOf(reads) {
  const nb = blockOf(reads.overview, 'network', ROSTER_UNREAD);
  if (nb.state === 'loading') return { state: 'loading' };
  if (nb.state !== 'ready') return { state: 'unreadable', reason: nb.reason || ROSTER_UNREAD };
  const byKind = nb.block.by_kind_state;
  if (!byKind || typeof byKind !== 'object') return { state: 'unreadable', reason: ROSTER_UNREAD };
  const known = new Set(ROSTER_KINDS.map(([k]) => k));
  const rows = ROSTER_KINDS.map(([key, label]) => ({ key, label, active: 0, inactive: 0 }));
  const other = { key: 'other', label: 'Other', active: 0, inactive: 0 };
  for (const [kind, v] of Object.entries(byKind)) {
    const active = count(v?.active);
    const hidden = count(v?.hidden);
    if (active === null || hidden === null) return { state: 'unreadable', reason: ROSTER_UNREAD };
    const k = rosterKind(kind);
    const row = known.has(k) ? rows.find((r) => r.key === k) : other;
    row.active += active;
    row.inactive += hidden;
  }
  if (other.active + other.inactive > 0) rows.push(other);
  return { state: 'ready', rows: rows.map(({ key: _k, ...r }) => r), active: rows.reduce((t, r) => t + r.active, 0) };
}

/**
 * #4717 — THE PAGE'S CLOCK. Days open, waits, Overdue and the next 30 days are
 * measured from the Community read's own `as_of`, so a Refresh moves them with
 * the rows it re-reads. Before that read answers, the moment the page's reads
 * last settled (`asOf`); before anything, now. It used to be frozen at mount.
 */

/** #4717 — the circles block's counts, strictly: a missing or odd count makes the block unreadable, never 0. */
export function circlesOf(reads) {
  const reason = 'The circles could not be read. That is not the same as no circles.';
  const b = blockOf(reads.overview, 'circles', reason);
  if (b.state === 'loading') return { state: 'loading' };
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason || reason };
  const [total, published, featured] = [count(b.block.total), count(b.block.published), count(b.block.featured)];
  const members = count(b.block.members_entered?.value);
  if ([total, published, featured, members].includes(null) || published > total) return { state: 'unreadable', reason };
  const byType = new Map();
  for (const [type, v] of Object.entries(b.block.by_type || {})) {
    const c = count(v);
    if (c === null) return { state: 'unreadable', reason };
    const label = CIRCLE_TYPES[type] || 'Other';
    byType.set(label, (byType.get(label) || 0) + c);
  }
  return {
    state: 'ready', total, published, draft: total - published, featured, membersEntered: members,
    byType: [...byType].map(([label, value]) => ({ label, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value),
  };
}

/** The Circles and roster card. Members are as entered; the roster is counted, never named. */
export function buildCircles(reads) {
  return { circles: circlesOf(reads), roster: rosterOf(reads) };
}

/**
 * Needs a decision: pending events and jobs, oldest first, at most six rows,
 * from the Community read (#4717): `queue.event_rows` (D918's oldest waiting
 * events) and `queue.jobs.review` (the job board's). Each row's wait and
 * Overdue (past 72 hours, D915) are the server's, measured at its `as_of`:
 *   - an event waits from `submitted_at`, or from `created_at` when it was
 *     queued before submission was stamped, and it says so;
 *   - a job submitted before migration 550 has no recorded wait, and is never
 *     Overdue or a wait of 0.
 * `total` and `overdue` are the queues' own counts, not the rows'.
 * Nothing is decided here: Review opens the console that decides.
 */
