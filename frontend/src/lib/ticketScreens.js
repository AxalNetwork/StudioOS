// D604 (#1280 step 4) — the Help Center's ticket screens, as plain functions.
//
// `design/canvases/integrated/Help Ticket Screen.dc.html` draws five screens:
// H3 a member's tickets, H4 the form, H5 one ticket (H5b a reviewed feature
// request), H6 the admin queue and H7 one ticket as an admin sees it. The
// wording, the chips and the filters live here, with no JSX, so
// `ticket_screens_d604.test.mjs` runs them rather than reads them.
//
// The chips use one palette, the canvas's: grey, violet, green, amber, red.
import { toUtcInstant } from './notices';
import { TICKET_CATEGORIES } from './ticketCategories';

export const PILL = 'whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';

export const TONE = {
  grey: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
};

// H4: the three types, each a choice with what it means. No default (D544).
export const TICKET_TYPES = [
  { id: 'task', label: 'Task', note: 'Something to do', tone: 'grey' },
  { id: 'bug', label: 'Bug', note: 'Something broken', tone: 'red' },
  { id: 'feature', label: 'Feature', note: 'Something new', tone: 'violet' },
];

// H4: the four priorities, each with the situation it is for. The SLA tier
// each maps to is HQ's (`supportSlaPolicy.ts`): urgent P1, high P2, the rest P3.
export const TICKET_PRIORITIES = [
  { id: 'low', label: 'Low', note: 'No one is blocked. Fix when convenient.', tone: 'grey' },
  { id: 'medium', label: 'Medium', note: 'Slows work down; a workaround exists.', tone: 'violet' },
  { id: 'high', label: 'High', note: 'Blocks a task today.', tone: 'amber' },
  { id: 'urgent', label: 'Urgent', note: 'Money, signatures or access are stuck.', tone: 'red' },
];

export const TICKET_STATUSES = [
  { id: 'open', label: 'Open', tone: 'violet' },
  { id: 'in_progress', label: 'In progress', tone: 'amber' },
  { id: 'resolved', label: 'Resolved', tone: 'green' },
  { id: 'closed', label: 'Closed', tone: 'grey' },
];

/** The list's tabs: the four statuses, then everything. */
export const STATUS_TABS = [...TICKET_STATUSES.map(({ id, label }) => ({ id, label })), { id: 'all', label: 'All' }];

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const TYPES = byId(TICKET_TYPES);
const PRIORITIES = byId(TICKET_PRIORITIES);
const STATUSES = byId(TICKET_STATUSES);
const CATEGORIES = byId(TICKET_CATEGORIES);

/** A chip: its words and its classes. Null when there is nothing to say. */
const chip = (text, tone) => ({ text, className: `${PILL} ${TONE[tone] || TONE.grey}` });

export const typeChip = (type) => {
  const t = TYPES[type];
  return t ? chip(t.label, t.tone) : null;
};
export const priorityChip = (priority) => {
  const p = PRIORITIES[priority];
  return p ? chip(p.label, p.tone) : null;
};
export const statusChip = (status) => {
  const s = STATUSES[status];
  return s ? chip(s.label, s.tone) : null;
};
/** A ticket filed with no category says so; it is never counted as Other (D482). */
export const categoryLabel = (category) => CATEGORIES[category]?.label || 'No category';
export const categoryChip = (category) => chip(categoryLabel(category), 'grey');

// ---------------------------------------------------------------------------
// The SLA (admin only: the Worker sends it to no one else)
// ---------------------------------------------------------------------------

const SLA_BANDS = { ok: ['On time', 'green'], due_soon: ['Due soon', 'amber'], past: ['Overdue', 'red'] };

/**
 * The SLA chip. Null once the clock has stopped (resolved or closed) or when
 * the row has no SLA. Unknown hours say so rather than reading as on time.
 */
export function slaChip(sla) {
  if (!sla || typeof sla !== 'object') return null;
  if (sla.clock === 'unreadable') return chip('SLA hours unknown', 'grey');
  if (sla.clock !== 'running') return null;
  const band = SLA_BANDS[sla.band];
  return band ? chip(band[0], band[1]) : chip('No date to time from', 'grey');
}

/** "P2 · 48 h", or the tier alone when the hours could not be read. */
export function tierLine(sla) {
  if (!sla || !sla.tier) return '';
  return Number.isFinite(sla.hours) ? `${sla.tier} · ${sla.hours} h` : sla.tier;
}

// ---------------------------------------------------------------------------
// The review of a feature request (D544's queue)
// ---------------------------------------------------------------------------

/**
 * A feature request's review as the screens word it. Null for anything that
 * is not a feature request. A review that could not be read says so, and is
 * never shown as awaiting.
 */
export function reviewLine(review) {
  if (!review || typeof review !== 'object') return null;
  switch (review.state) {
    case 'awaiting': return { text: 'Awaiting review', tone: 'amber', note: 'Waiting for the Super Admin. Approved or Declined, with the reason, appears here.' };
    case 'approved': return { text: 'Approved', tone: 'green', note: 'It is going to the build queue. Approval is not a promise of a date.' };
    case 'declined': return {
      text: 'Declined',
      tone: 'red',
      note: review.reason ? `Reason, as the Super Admin typed it: ${review.reason}` : 'It will not be built. No reason was recorded.',
    };
    case 'unreadable': return { text: 'Review could not be read', tone: 'red', note: 'The review could not be read just now. This is not a sign that it was decided.' };
    default: return null;
  }
}

/**
 * The bounty panel's tone and sentence (H5). The state's own words are
 * `bountyLine`'s (D542), shared with the chat; this adds what it means.
 * D540: one credit is US$1 of perk value.
 */
export function bountyPanel(bounty) {
  if (!bounty || typeof bounty !== 'object') return null;
  switch (bounty.state) {
    case 'under_review': return { tone: 'amber', text: 'The team is checking whether this is a bug. A confirmed bug earns credits when the fix ships.' };
    case 'confirmed': return { tone: 'green', text: 'The bug is confirmed and a fix is being made. Credits are granted when it ships.' };
    case 'fixed': {
      if (bounty.credits_unreadable) return { tone: 'red', text: 'The fix shipped. The credits could not be read just now; this is not a sign that none were granted.' };
      if (bounty.revoked) return { tone: 'red', text: 'The fix shipped, and the credits granted for it were taken back.' };
      const n = Number(bounty.credits);
      if (bounty.credits != null && Number.isFinite(n) && n > 0) {
        return { tone: 'green', text: `The fix shipped and ${n} credit${n === 1 ? ' was' : 's were'} granted. A credit is worth US$1 and is spent on Perks.` };
      }
      return { tone: 'amber', text: 'The fix shipped. No credits were granted for it.' };
    }
    case 'not_a_bug': return { tone: 'red', text: 'The team found this is not a bug. The reason is in the thread.' };
    case 'duplicate': return { tone: 'amber', text: 'Another report covers this. The original is named in the thread.' };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// The list: tabs, filters, search
// ---------------------------------------------------------------------------

export const NO_FILTERS = Object.freeze({ type: '', category: '', priority: '', sla: '', query: '' });

/** Does one row pass the filters? `category: 'none'` is the uncategorised rows. */
export function matchesFilters(t, f = NO_FILTERS) {
  if (f.type && t.type !== f.type) return false;
  if (f.category === 'none' ? !!t.category : (f.category && t.category !== f.category)) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.sla && !(t.sla && t.sla.clock === 'running' && t.sla.band === f.sla)) return false;
  const q = String(f.query || '').trim().toLowerCase();
  if (q && !String(t.title || '').toLowerCase().includes(q)) return false;
  return true;
}

/** Each tab's count, over the rows that pass the filters. */
export function tabCounts(rows, f = NO_FILTERS) {
  const counts = Object.fromEntries(STATUS_TABS.map((t) => [t.id, 0]));
  for (const t of rows || []) {
    if (!matchesFilters(t, f)) continue;
    counts.all += 1;
    if (t.status in counts) counts[t.status] += 1;
  }
  return counts;
}

/** The rows one tab shows, latest activity first. */
export function visibleTickets(rows, tab, f = NO_FILTERS) {
  const at = (t) => String(t?.updated_at || t?.created_at || '');
  return (rows || [])
    .filter((t) => matchesFilters(t, f) && (tab === 'all' || t.status === tab))
    .sort((a, b) => at(b).localeCompare(at(a)));
}

export const hasFilters = (f) => Object.values(f || {}).some((v) => String(v || '').trim() !== '');

// ---------------------------------------------------------------------------
// The form (H4)
// ---------------------------------------------------------------------------

export const EMPTY_FORM = Object.freeze({ title: '', description: '', priority: 'medium', type: '', category: '' });

/** Each error names its field. Title and Type are required; Type has no default. */
export function formErrors(form) {
  const errors = {};
  if (!String(form?.title || '').trim()) errors.title = 'Title is required.';
  else if (String(form.title).trim().length > 200) errors.title = 'Title is at most 200 characters.';
  if (!TYPES[form?.type]) errors.type = 'Type is required. Pick Task, Bug or Feature.';
  return errors;
}

/** Up to three guides for the title as typed, none for an empty one. */
export function guidesForTitle(fuse, title, sectionsById, readingMinutes) {
  const q = String(title || '').trim();
  if (q.length < 3 || !fuse) return [];
  return fuse.search(q, { limit: 3 }).map(({ item }) => {
    const sub = sectionsById?.[item.sectionId]?.subsections?.find((s) => s.id === item.subsectionId);
    return {
      anchor: item.anchor,
      title: item.subsectionTitle,
      area: item.sectionTitle,
      minutes: sub && readingMinutes ? readingMinutes(sub) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// One ticket (H5, H7)
// ---------------------------------------------------------------------------

/** A ticket the reader cannot open is "not found" whether it is missing or someone else's. */
export function detailFailure(err) {
  return err && (err.status === 404 || err.status === 403) ? 'not_found' : 'unreadable';
}

/** Who a thread entry is, for this reader. */
export function threadSpeaker(entry, { viewerIsOwner, submittedBy }) {
  if (entry?.from === 'member') {
    return { who: viewerIsOwner ? 'You' : (submittedBy || 'The member'), role: 'Member', tone: 'grey', initial: 'M' };
  }
  if (entry?.from === 'team') return { who: 'Axal team', role: 'Support', tone: 'violet', initial: 'A' };
  return {
    who: entry?.login ? `@${entry.login}` : 'Someone on GitHub',
    role: 'Outside the team',
    tone: 'amber',
    initial: '?',
  };
}

/** A date as a day, or null. SQL `YYYY-MM-DD HH:MM:SS` stamps are UTC. */
export function dayOf(value) {
  const iso = toUtcInstant(value);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A date with its time, or null. */
export function momentOf(value) {
  const iso = toUtcInstant(value);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
