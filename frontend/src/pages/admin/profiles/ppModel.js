/**
 * D989 (#2380) — Partner profiles at /admin/partner-profiles, as pure
 * functions: the address and tabs, the moved notice, and the blocks built from
 * the reads that exist today. No React here, so `node --test` loads it alone.
 *
 * The reads (each answers alone; D989 §2):
 *   - `list`    GET /api/profiling/admin/list — every profile, newest first by
 *               `created_at`, no limit, with `email, persona,
 *               legal_entity_name, founder_track, company_established,
 *               partnership_goal, agreement_type, admin_status, user_name`.
 *               It carries no date, no source and no account state, and each
 *               read writes an audit row (D625). A D1 error is a 5xx.
 *   - `glance`  GET /api/admin/studio/glance — Approvals' `partner_profiles`
 *               lane: the waiting count and the oldest one's age, the same
 *               figure lane 7 shows.
 *
 * NO DRAFT STATE YET. A row Eadwyn opened with only a name is `pending` like
 * any other (approvalSources.ts), so "Waiting" counts drafts until part 1
 * tells them apart, and the page says so.
 */

export const PP_PATH = '/admin/partner-profiles';
export const PP_ALL_PATH = '/admin/partner-profiles/all';
export const APPROVALS_PATH = '/admin/held/approvals';
export const PP_TITLE = 'Partner profiles';
export const PAGE_LINE = 'Check who each new member and partner says they are, then verify or reject, and send their first agreement.';
export const RAIL_NOTE = 'Eadwyn reads the profiles on this page. Nothing changes until you act.';
export const NOT_YET = 'Not read here yet';
export const NOT_GIVEN = 'Not given';
export const DRAFTS_COUNTED = 'Drafts are counted as waiting until part 1 tells them apart: a profile Eadwyn opened with only a name has nothing to review yet.';
export const LIST_FAILED = 'We could not load partner profiles. This is not a sign that there are none.';
export const PAGE_SIZE = 25;

/** The old address's sentence (#2375's "moved" form). */
export const MOVED_NOTICES = {
  profiles: 'The Admin Console has moved: Partner profiles now lives under Approvals.',
};

/** The tabs this integration draws (D989 §1). One profile's own address waits for a reference (part 1). */
export const TABS = [
  { key: 'review', label: 'To review', path: '' },
  { key: 'all', label: 'All profiles', path: '/all' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === PP_PATH) return 'review';
  if (p === PP_ALL_PATH) return 'all';
  return null;
}

/** The canvas's status words. A value the Worker should never store is not drawn as one of them. */
const STATUS_WORD = { pending: 'Waiting', verified: 'Verified', rejected: 'Rejected' };
export const statusWord = (s) => STATUS_WORD[s] || 'Not recorded';
export const STATUSES = ['pending', 'verified', 'rejected'];

/** Counts over every profile (the list has no limit, so these are whole). */
export function statusCounts(rows) {
  const list = rows || [];
  const n = (s) => list.filter((r) => r.admin_status === s).length;
  const known = n('pending') + n('verified') + n('rejected');
  return { all: list.length, pending: n('pending'), verified: n('verified'), rejected: n('rejected'), other: list.length - known };
}

/**
 * The queue: waiting profiles, oldest first. The list comes newest first by
 * `created_at`, so its reverse is oldest first; the date itself is not on the
 * list read, so no age is drawn per row.
 */
export function queueRows(rows) {
  return (rows || []).filter((r) => r.admin_status === 'pending').slice().reverse();
}

/** Founder track, in the canvas's words. */
export function trackWord(t) {
  if (t === 'Spin-Out (New)') return 'Spin-Out';
  if (t === 'Strategic Scale (Existing)') return 'Strategic Scale';
  return null;
}

/** Whether a founder's company exists yet: 1, 0, or not answered. */
export function incorporatedWord(v) {
  if (v === 1 || v === true) return 'Incorporated';
  if (v === 0 || v === false) return 'Not incorporated';
  return 'Not answered';
}

/** One row's person, category and entity, ready to draw. */
export function rowView(r) {
  const founder = r.persona === 'Founder';
  return {
    email: r.email,
    name: r.user_name || null,
    category: r.persona || null,
    track: founder ? trackWord(r.founder_track) || 'Track not given' : null,
    incorporated: founder ? incorporatedWord(r.company_established) : null,
    entity: r.legal_entity_name || NOT_GIVEN,
    agreement: r.agreement_type || 'Not sent',
    status: statusWord(r.admin_status),
    statusKey: STATUS_WORD[r.admin_status] ? r.admin_status : 'other',
  };
}

/**
 * "Onboarding categories" (PRF2): one bar per category, by count, Founder
 * split into its two tracks. Rows with no category are a separate line, never
 * a bar.
 */
export function categoryBars(rows) {
  const by = new Map();
  let none = 0;
  for (const r of rows || []) {
    if (!r.persona) { none += 1; continue; }
    const b = by.get(r.persona) || { category: r.persona, count: 0, spinout: 0, scale: 0, untracked: 0 };
    b.count += 1;
    if (r.persona === 'Founder') {
      const t = trackWord(r.founder_track);
      if (t === 'Spin-Out') b.spinout += 1;
      else if (t === 'Strategic Scale') b.scale += 1;
      else b.untracked += 1;
    }
    by.set(r.persona, b);
  }
  const bars = [...by.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return { bars, none, max: bars.reduce((m, b) => Math.max(m, b.count), 0) };
}

/** Search over name, email and entity. Under two characters it does not filter. */
export function searchRows(rows, q) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return rows || [];
  return (rows || []).filter((r) => [r.user_name, r.email, r.legal_entity_name].some((v) => String(v || '').toLowerCase().includes(s)));
}

/** One page of a list, with the canvas's "1–25 of 64". */
export function pageOf(rows, page, size = PAGE_SIZE) {
  const total = (rows || []).length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page || 1), pages);
  const from = total ? (p - 1) * size + 1 : 0;
  const to = Math.min(total, p * size);
  return { rows: (rows || []).slice(from ? from - 1 : 0, to), page: p, pages, label: total ? `${from}–${to} of ${total.toLocaleString('en-US')}` : '0 of 0' };
}
