/** Inbox filters, queue rows, urgency bands, summary figures and work views. */
import { LANE_BY_KEY, groupLabel, inboxGroups, laneLabelOf } from './approvalsLanesModel.js';
import { PATH } from './approvalsModel.js';
import { ageText, dayText, nf } from './approvalsFormat.js';

/** APR1's age chips: the Worker's band keys in the canvas's words. */
export const AGE_FILTERS = [
  { key: null, label: 'Any' },
  { key: 'ok', label: 'Under 24 hours' },
  { key: 'due_soon', label: '24 to 72 hours' },
  { key: 'past', label: 'Over 72 hours' },
];

/** The four orders the Worker reads (D1132). */
export const SORTS = [
  { key: 'oldest', label: 'Waiting longest' },
  { key: 'newest', label: 'Newest' },
  { key: 'lane', label: 'Lane' },
  { key: 'who', label: 'Who' },
];

export const SEARCH_MIN = 2;

/**
 * The inbox's query from the address, as the client sends it. Search is sent
 * from two characters (one does not filter, as the Worker reads it); a value
 * the Worker would refuse is dropped here rather than sent.
 */
export function inboxQueryOf(search, superAdmin = false) {
  const p = new URLSearchParams(search || '');
  const page = Number(p.get('page'));
  const q = String(p.get('q') || '').trim();
  const group = inboxGroups(superAdmin).some((g) => g.key === p.get('group')) ? p.get('group') : null;
  const age = AGE_FILTERS.some((a) => a.key && a.key === p.get('age')) ? p.get('age') : null;
  const raw = p.get('assigned');
  const assigned = raw === 'me' || raw === 'none' || /^[1-9]\d*$/.test(raw || '') ? raw : null;
  const sort = SORTS.some((s) => s.key === p.get('sort')) ? p.get('sort') : 'oldest';
  const lane = p.get('lane') || null;
  const filters = {};
  if (q.length >= SEARCH_MIN) filters.q = q;
  if (lane) filters.lane = lane;
  if (group) filters.group = group;
  if (age) filters.age = age;
  if (assigned) filters.assigned = assigned;
  if (sort !== 'oldest') filters.sort = sort;
  return { page: Number.isSafeInteger(page) && page >= 1 ? page : 1, filters, typed: p.get('q') || '' };
}

/** The age band an item carries (`sla`), as its pill; under 24 hours has none. */
export function slaBand(sla) {
  if (sla === 'past') return { key: 'past', label: 'Over 72 hours', tone: 'bad' };
  if (sla === 'due_soon') return { key: 'due', label: '24 to 72 hours', tone: 'warn' };
  if (sla === 'unknown') return { key: 'unknown', label: 'Age not recorded', tone: null };
  return { key: 'ok', label: 'Under 24 hours', tone: null };
}

/**
 * One item's address: `/admin/approvals/items/<lane>-<id>`, one segment, so a
 * row's literal link (`items/${lane}-${id}`) resolves for the reachability
 * walk. Lane keys never hold a hyphen; the id is the part after the last one.
 */
export const itemPath = (lane, id) => `${PATH}/items/${encodeURIComponent(lane)}-${encodeURIComponent(id)}`;

export function itemOfPath(pathname) {
  const m = /^\/admin\/approvals\/items\/([a-z_]+)-([1-9]\d*)\/?$/.exec(String(pathname || ''));
  if (!m) return null;
  const id = Number(m[2]);
  return Number.isSafeInteger(id) ? { lane: m[1], id } : null;
}

/**
 * Who holds an item. The inbox leaves `assignee` out entirely when the
 * assignment record could not be read: that is "not read", never "nobody".
 */
export function assigneeOf(item) {
  if (!item || !('assignee' in item) || item.assignee === undefined) return { kind: 'unread', text: 'Not read' };
  if (item.assignee === null) return { kind: 'none', text: 'Unassigned' };
  return { kind: 'person', text: item.assignee.name || 'Not recorded', id: item.assignee.user_id };
}

/** The table's rows, in the Worker's order (it sorts; an unknown age is last). */
export function inboxRows(reply) {
  return (Array.isArray(reply?.items) ? reply.items : []).map((it) => ({
    key: `${it.lane}:${it.id}`,
    lane: it.lane,
    id: it.id,
    laneLabel: laneLabelOf(it.lane, it.lane_label),
    group: groupLabel(LANE_BY_KEY[it.lane]?.group),
    hq: LANE_BY_KEY[it.lane]?.group === 'hq',
    who: it.who || 'Profile name not recorded',
    what: humanWhat(it.what),
    age: ageText(it.age_hours) || 'Age not recorded',
    ageHours: Number.isFinite(Number(it.age_hours)) && it.age_hours !== null ? Number(it.age_hours) : null,
    sla: it.sla || 'unknown',
    band: slaBand(it.sla),
    assignee: assigneeOf(it),
    href: itemPath(it.lane, it.id),
  }));
}

/**
 * D1047 (APR15): a row as a phone card's pill: the age with its band. An
 * unknown age is the row's "Age not recorded", whose band has no tone, so no
 * band is drawn for it.
 */
export function cardAge(row) {
  if (!row) return { text: 'Age not recorded', tone: null };
  return { text: row.band?.tone ? `${row.age} · ${row.band.label}` : row.age, tone: row.band?.tone || null };
}

/**
 * D1047 (APR15): what "Filters · [n]" counts: every filter the panel sets, not
 * the order. D4814: nor the work view — `assigned=me|none` is Assigned to me
 * or Unassigned; only a named owner is a filter.
 */
export function filterCount(filters = {}) {
  return ['q', 'group', 'lane', 'age'].filter((k) => filters[k] != null && filters[k] !== '').length
    + (/^[1-9]\d*$/.test(filters.assigned || '') ? 1 : 0);
}

/** The order's words for the phone's Sort button. */
export const sortLabel = (key) => (SORTS.find((s) => s.key === (key || 'oldest')) || SORTS[0]).label;

/** "1–25 of 133", "1–25 of 123 +" when a lane failed, "1–25 of —" when the total is not known. */
export function pageLine(reply) {
  const n = Array.isArray(reply?.items) ? reply.items.length : 0;
  const size = Number(reply?.page_size) || 25;
  const from = (Math.max(1, Number(reply?.page) || 1) - 1) * size;
  if (!n) return null;
  const range = `${nf(from + 1)}–${nf(from + n)}`;
  if (reply.total === null || reply.total === undefined) return `${range} of —`;
  return `${range} of ${plusFigure(reply.total, reply.unreadable?.length > 0)}`;
}

/** Whether there is a page after this one; an unknown total allows one while this page is full. */
export function hasNextPage(reply) {
  const size = Number(reply?.page_size) || 25;
  const n = Array.isArray(reply?.items) ? reply.items.length : 0;
  const page = Number(reply?.page) || 1;
  if (reply?.total === null || reply?.total === undefined) return n === size;
  return page * size < reply.total;
}

/**
 * D4814: the HQ share of the Waiting figure, said explicitly. A Super Admin's
 * inbox holds HQ's own lanes, so the number includes them; "· 1 for HQ" says
 * how many, and the Inbox tab, Waiting and All all show the one number.
 */
const lanesSub = (lanes) => {
  const hq = lanes.filter((l) => l.group === 'hq');
  const base = `across ${nf(lanes.length)} lanes`;
  if (!hq.length) return base;
  const hqCount = hq.some((l) => l.count == null) ? null : hq.reduce((t, l) => t + l.count, 0);
  return hqCount == null ? base : `${base} · ${nf(hqCount)} of them for HQ`;
};

/** D4814: a figure that is a floor (a lane failed or was cut) reads "127+", never short and never 0. */
export const plusFigure = (n, partial) => `${nf(n)}${partial ? '+' : ''}`;

/**
 * D4814 (P0): THE Waiting number — the Inbox tab, the Waiting cell and the All
 * view all read this one function, so they cannot disagree. It is every item
 * the caller's inbox holds (HQ's lanes included for a Super Admin), before any
 * filter: `unfiltered_total` when the read was filtered, else `total`.
 * `{ state: 'ready', n, partial, value } | { state: 'unreadable', reason } | { state: 'loading' }`.
 */
export function waitingFigure(inbox) {
  if (!inbox || inbox.status === 'loading') return { state: 'loading' };
  if (inbox.status !== 'ready') return { state: 'unreadable', reason: 'The inbox could not be read.' };
  const r = inbox.reply || {};
  const whole = r.unfiltered_total !== undefined ? r.unfiltered_total : r.total;
  if (whole === null || whole === undefined) return { state: 'unreadable', reason: r.total_reason || 'The total could not be read.' };
  const partial = Array.isArray(r.unreadable) && r.unreadable.length > 0;
  return { state: 'ready', n: Number(whole), partial, value: plusFigure(whole, partial) };
}

/**
 * D4814: one of the strip's tile figures — the exact count, or, when the Worker
 * withheld it because a lane failed or was cut at the cap, the floor it read
 * ("68+"), or "Could not be read" with why. Never a 0 for a gap.
 */
function tileFigure(r, key) {
  const exact = r.tiles?.[key];
  if (exact !== null && exact !== undefined) return { state: 'ready', n: Number(exact), partial: false, value: nf(exact) };
  const floor = r.tiles?.at_least?.[key];
  if (floor !== null && floor !== undefined) return { state: 'ready', n: Number(floor), partial: true, value: plusFigure(floor, true) };
  return { state: 'unreadable', reason: r.tiles?.reason || 'This count could not be read.' };
}

/**
 * D4814 (AP-01): the one compact urgency strip — Waiting · Overdue ·
 * Unassigned · Oldest. Each cell is `{ state, value?, sub?, reason? }`.
 */
export function summaryStrip(inbox) {
  const loading = { state: 'loading' };
  if (!inbox || inbox.status === 'loading') return { waiting: loading, overdue: loading, unassigned: loading, oldest: loading };
  const waiting = waitingFigure(inbox);
  if (inbox.status !== 'ready') return { waiting, overdue: waiting, unassigned: waiting, oldest: waiting };
  const r = inbox.reply || {};
  const lanes = Array.isArray(r.lanes) ? r.lanes : [];
  const unread = Array.isArray(r.unreadable) ? r.unreadable : [];
  const notRead = unread.length ? `${unread.join(', ')} not read` : null;
  if (waiting.state === 'ready') waiting.sub = unread.length ? `${unread.join(', ')} could not be read` : lanesSub(lanes);

  const overdue = tileFigure(r, 'over_72h');
  if (overdue.state === 'ready') {
    const nobody = r.tiles?.overdue_unassigned;
    overdue.sub = (overdue.partial && notRead) || ['over 72 hours', nobody ? `${nf(nobody)} ${nobody === 1 ? 'has' : 'have'} no owner` : null].filter(Boolean).join(' · ');
  }
  const unassigned = tileFigure(r, 'unassigned');
  if (unassigned.state === 'ready') {
    unassigned.sub = (unassigned.partial && notRead) || (waiting.state === 'ready' ? `of ${waiting.value} have no owner` : 'have no owner');
    unassigned.show = unassigned.n > 0;
  }
  const o = r.tiles?.oldest;
  const oldest = o === undefined ? { state: 'unreadable', reason: 'The oldest item was not on this read.' }
    : o === null ? { state: 'ready', value: '—', sub: unread.length ? 'of lanes read' : 'nothing waiting' }
      : { state: 'ready', value: ageText(o.age_hours) || '—', sub: unread.length ? 'of lanes read · may be older' : `waiting · ${laneLabelOf(o.lane, o.label)}` };
  return { waiting, overdue, unassigned, oldest };
}

/**
 * D4814: the work views (AP-01), each a place in the address so a view can be
 * shared. Needs attention is the default: overdue, then due soon (24–72 h),
 * then the rest, oldest first within each band, which is the Worker's
 * "oldest" order. Assigned to me and Unassigned are the Worker's own
 * `assigned=me` / `assigned=none`; All is `view=all`, with any order.
 */
export const WORK_VIEWS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'all', label: 'All' },
];

export const ATTENTION_LINE = 'Needs attention: overdue, then due soon, then everything else, oldest first in each band.';

/** The view the address names; an old `assigned=me|none` address lands on its view. */
export function workViewOf(search) {
  const p = new URLSearchParams(search || '');
  if (p.get('assigned') === 'me') return 'mine';
  if (p.get('assigned') === 'none') return 'unassigned';
  if (p.get('view') === 'all' || /^[1-9]\d*$/.test(p.get('assigned') || '')) return 'all';
  const sort = p.get('sort');
  if (sort && sort !== 'oldest' && SORTS.some((s) => s.key === sort)) return 'all';
  return 'attention';
}

/** What choosing a view writes to the address. Needs attention keeps its own order. */
export function viewPatch(key) {
  if (key === 'mine') return { assigned: 'me', view: null };
  if (key === 'unassigned') return { assigned: 'none', view: null };
  if (key === 'all') return { assigned: null, view: 'all' };
  return { assigned: null, view: null, sort: null };
}

/** Each view's figure. All is `waitingFigure`, the same number as the tab and Waiting. */
export function workViewCounts(inbox) {
  const waiting = waitingFigure(inbox);
  if (inbox?.status !== 'ready') return { attention: null, mine: null, unassigned: null, all: waiting.state === 'ready' ? waiting.value : null };
  const r = inbox.reply || {};
  const fig = (k) => { const f = tileFigure(r, k); return f.state === 'ready' ? f.value : null; };
  const over = fig('over_72h');
  return {
    attention: over === null ? null : `${over} overdue`,
    mine: fig('assigned_to_me'),
    unassigned: fig('unassigned'),
    all: waiting.state === 'ready' ? waiting.value : null,
  };
}

/** D4814 part 5: an item waiting this long is stale backlog (the issue's ">30d"), drawn in its own band. */
export const STALE_HOURS = 30 * 24;

/** The band a row sits in, as the queue's band row says it (AP-01). */
export const BAND_ROWS = {
  // D4814 part 5: the live audit's oldest item waited 204 days, so every item
  // read as one red band. Past 30 days an item is drawn apart, as backlog to
  // check is still actionable, and the 72-hour bands stay for live work.
  stale: { key: 'stale', text: '◌ Stale · waiting over 30 days · check each is still actionable', tone: 'bad' },
  past: { key: 'past', text: '! Overdue · over 72 hours', tone: 'bad' },
  due_soon: { key: 'due_soon', text: '◷ Due soon · 24–72 hours', tone: 'warn' },
  ok: { key: 'ok', text: 'Under 24 hours', tone: null },
  unknown: { key: 'unknown', text: 'Arrival time not recorded · not placed in a band', tone: null },
};

/**
 * The rows with a band row before each change of band, for the oldest-first
 * order (where bands run worst first). Another order has no band rows.
 */
export function bandedRows(rows, sort) {
  if (sort && sort !== 'oldest') return rows.map((row) => ({ kind: 'row', row }));
  const out = [];
  let last = null;
  for (const row of rows) {
    const b = row.sla === 'past' && row.ageHours != null && row.ageHours >= STALE_HOURS ? 'stale' : (row.sla || 'ok');
    if (b !== last) { out.push({ kind: 'band', band: BAND_ROWS[b] || BAND_ROWS.ok }); last = b; }
    out.push({ kind: 'row', row });
  }
  return out;
}

/** The Waiting column's pill: text, never colour alone. Under 24 hours and an unknown age have none. */
export function urgencyPill(sla) {
  if (sla === 'past') return { text: '! Overdue', tone: 'bad' };
  if (sla === 'due_soon') return { text: '◷ Due soon', tone: 'warn' };
  return null;
}

/**
 * D4814: a raw store value shown to an operator, in words. "TIER_2" is "Tier
 * 2", "REJECT" is "Reject", "service_provider" is "Service provider", and a
 * profile with no name ("unnamed") says so. Free text is left as written.
 */
const ENUM_WORDS = { unnamed: 'Profile name not recorded', REJECT: 'Reject', APPROVE: 'Approve', PASS: 'Pass', HOLD: 'Hold' };

export function humanToken(s) {
  const t = String(s ?? '').trim();
  if (!t) return t;
  if (ENUM_WORDS[t]) return ENUM_WORDS[t];
  const tier = /^TIER_(\w+)$/i.exec(t);
  if (tier) return `Tier ${tier[1].replace(/_/g, ' ')}`;
  if (/^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/.test(t) || /^[a-z]+$/.test(t)) {
    const words = t.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return t;
}

/** "Score sign-off · TIER_2" → "Score sign-off · Tier 2": each part after the first, in words. */
export function humanWhat(what) {
  if (!what) return 'Not recorded';
  const parts = String(what).split(' · ');
  return [parts[0], ...parts.slice(1).map(humanToken)].join(' · ');
}

/**
 * D4814: the chips for the filters in force (they render only when there are
 * any). The view and the order are not filters.
 */
export function filterChips(filters = {}, { superAdmin = false, reviewers = [] } = {}) {
  const chips = [];
  if (filters.q) chips.push({ key: 'q', text: `Search: ${filters.q}` });
  if (filters.group) chips.push({ key: 'group', text: `Group: ${inboxGroups(superAdmin).find((g) => g.key === filters.group)?.label || filters.group}` });
  if (filters.lane) chips.push({ key: 'lane', text: `Lane: ${laneLabelOf(filters.lane)}` });
  if (filters.age) chips.push({ key: 'age', text: `Age: ${AGE_FILTERS.find((a) => a.key === filters.age)?.label || filters.age}` });
  if (/^[1-9]\d*$/.test(filters.assigned || '')) {
    chips.push({ key: 'assigned', text: `Owner: ${reviewers.find((r) => String(r.id) === filters.assigned)?.name || 'Not recorded'}` });
  }
  return chips;
}

/* ------------------------------------------------------------------ *
 * Waiting on HQ (APR1)
 * ------------------------------------------------------------------ */
const REQUEST_WORDS = {
  renewal: 'Renewal', terms_change: 'Term change', seat_increase: 'Seat increase', delegate: 'Delegate admin',
  non_renewal: 'Notice of non-renewal', program_grant: 'Program grant', program_terms_change: 'Program terms change', program_end: 'Program end',
};

/**
 * What this studio asked HQ and is still waiting on: each open request with
 * when it was sent and how long ago. An account that administers no licence
 * (HQ's own admins) asks HQ nothing, and says so rather than "0".
 */
export function waitingOnHq(read, now = Date.now()) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') {
    if (read.error?.status === 404) return { state: 'none', text: 'This account administers no studio licence, so it asks HQ nothing here.' };
    return { state: 'unread', text: 'Your requests to HQ could not be read.' };
  }
  const open = (Array.isArray(read.reply?.items) ? read.reply.items : []).filter((it) => it.status === 'open');
  return {
    state: 'ready',
    rows: open.map((it) => {
      const sent = dayText(it.created_at);
      const t = Date.parse(/[zZ]$/.test(String(it.created_at)) ? it.created_at : `${String(it.created_at).replace(' ', 'T')}Z`);
      const age = Number.isFinite(t) ? ageText(Math.max(0, (now - t) / 3_600_000)) : null;
      return {
        key: it.uid,
        text: REQUEST_WORDS[it.kind] || it.subject || 'Request',
        sub: [sent ? `sent ${sent}` : 'sent: not recorded', age, it.sla === 'past' ? 'past HQ’s response time' : null].filter(Boolean).join(' · '),
      };
    }),
  };
}
