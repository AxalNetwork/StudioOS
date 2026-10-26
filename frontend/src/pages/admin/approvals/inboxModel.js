/**
 * D1045 (#2893) — Approvals part 7 as pure functions: the Inbox on HQ's inbox
 * read (D1040, D1132), the item at its own address, Assign and History, the
 * Decided log and the weekly series (D1044), HQ's lanes' counts and each
 * lane's Notifies (D1041), and Waiting on HQ (D799's requests). No React, so
 * `node --test` loads it alone.
 *
 * The reads (each answers alone):
 *   - `inbox`    GET /api/admin/approvals?page=&q=&lane=&group=&age=&assigned=&sort=
 *                items oldest first, 25 a page, `total` (null with a reason),
 *                `unreadable`, each lane's band split, the tiles, `reviewers`.
 *   - `item`     GET /api/admin/approvals/items/:lane/:id — the row, its lane,
 *                its history; 404 `item_not_waiting` / `item_not_found`,
 *                503 `lane_unreadable`.
 *   - `decided`  GET /api/admin/approvals/decided?lane=&outcome=&from=&to=&page=
 *   - `weekly`   GET /api/admin/approvals/decided/weekly
 *   - `requests` GET /api/licence/mine/requests — what this studio asked HQ;
 *                404 `no_licence` for an account that administers none.
 *
 * A count is a number, "Could not be read" or "Not read here yet", never a 0
 * for a gap (D1038 §2). Nothing here decides: every decision stays on the
 * lane's own page (`decides: false`).
 */
import { GROUPS, HQ_LANES, LANES, PATH, ageText, dayText } from './approvalsModel';

const nf = (n) => Number(n).toLocaleString('en-US');

/** The groups the inbox filters by: the canvas's four, and HQ's for a Super Admin. */
export const HQ_GROUP = { key: 'hq', label: 'HQ decides' };
export const inboxGroups = (superAdmin) => (superAdmin ? [...GROUPS, HQ_GROUP] : GROUPS);

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

const LANE_BY_KEY = Object.fromEntries([...LANES.map((l) => [l.key, l]), ...HQ_LANES.map((l) => [l.key, { ...l, group: 'hq' }])]);
const groupLabel = (g) => (g === 'hq' ? HQ_GROUP.label : GROUPS.find((x) => x.key === g)?.label || null);
export const laneLabelOf = (key, fallback) => LANE_BY_KEY[key]?.label || fallback || key;

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
    who: it.who || 'Not recorded',
    what: it.what || 'Not recorded',
    age: ageText(it.age_hours) || 'Age not recorded',
    band: slaBand(it.sla),
    assignee: assigneeOf(it),
    href: itemPath(it.lane, it.id),
  }));
}

/** "1–25 of 133", "1–25 of 123 +" when a lane failed, "1–25 of —" when the total is not known. */
export function pageLine(reply) {
  const n = Array.isArray(reply?.items) ? reply.items.length : 0;
  const size = Number(reply?.page_size) || 25;
  const from = (Math.max(1, Number(reply?.page) || 1) - 1) * size;
  if (!n) return null;
  const range = `${nf(from + 1)}–${nf(from + n)}`;
  if (reply.total === null || reply.total === undefined) return `${range} of —`;
  return `${range} of ${nf(reply.total)}${reply.unreadable?.length ? ' +' : ''}`;
}

/** Whether there is a page after this one; an unknown total allows one while this page is full. */
export function hasNextPage(reply) {
  const size = Number(reply?.page_size) || 25;
  const n = Array.isArray(reply?.items) ? reply.items.length : 0;
  const page = Number(reply?.page) || 1;
  if (reply?.total === null || reply?.total === undefined) return n === size;
  return page * size < reply.total;
}

const lanesSub = (lanes) => {
  const hq = lanes.filter((l) => l.group === 'hq');
  const base = `across ${nf(lanes.length)} lanes`;
  if (!hq.length) return base;
  const hqCount = hq.some((l) => l.count == null) ? null : hq.reduce((t, l) => t + l.count, 0);
  return hqCount == null ? base : `${base} · ${nf(hqCount)} for HQ`;
};

/**
 * APR1's four tiles from the inbox and the weekly series. Each is
 * `{ state: 'loading' | 'ready' | 'unreadable', value?, sub?, reason? }`; a
 * tile the Worker withheld is "Could not be read" with its reason, never 0.
 */
export function inboxTiles(inbox, weekly) {
  const loading = { state: 'loading' };
  if (!inbox || inbox.status === 'loading') return { waiting: loading, over72: loading, mine: loading, decided: weeklyTile(weekly) };
  if (inbox.status !== 'ready') {
    const failed = { state: 'unreadable', reason: 'The inbox could not be read.' };
    return { waiting: failed, over72: failed, mine: failed, decided: weeklyTile(weekly) };
  }
  const r = inbox.reply;
  const lanes = Array.isArray(r.lanes) ? r.lanes : [];
  const unread = Array.isArray(r.unreadable) ? r.unreadable : [];
  const whole = r.unfiltered_total !== undefined ? r.unfiltered_total : r.total;
  const waiting = whole === null || whole === undefined
    ? { state: 'unreadable', reason: r.total_reason || 'The total could not be read.' }
    : { state: 'ready', value: unread.length ? `${nf(whole)} +` : nf(whole), sub: unread.length ? `${unread.join(', ')} could not be read` : lanesSub(lanes) };
  const tile = (v) => (v === null || v === undefined
    ? { state: 'unreadable', reason: r.tiles?.reason || 'This count could not be read.' }
    : { state: 'ready', value: nf(v) });
  const over72 = tile(r.tiles?.over_72h);
  if (over72.state === 'ready') over72.sub = Number(r.tiles.over_72h) > 0 ? '● waiting' : 'nothing waits';
  return { waiting, over72, mine: tile(r.tiles?.assigned_to_me), decided: weeklyTile(weekly) };
}

/** "1 d 9 h"; the Decided tile's median wait. */
export function weeklyTile(weekly) {
  if (!weekly || weekly.status === 'loading') return { state: 'loading' };
  if (weekly.status !== 'ready') return { state: 'unreadable', reason: 'The weekly series could not be read.' };
  const t = weekly.reply?.tile || {};
  if (t.decided_this_week === null || t.decided_this_week === undefined) return { state: 'unreadable', reason: t.reason || 'This week’s decisions are not known.' };
  const median = ageText(t.median_wait_hours);
  return { state: 'ready', value: nf(t.decided_this_week), sub: median ? `median wait ${median}` : 'median wait not recorded', leavesOut: t.leaves_out || [] };
}

/** The group chips' counts, from each lane's count: null when a lane in the group failed. */
export function inboxGroupCounts(reply, superAdmin) {
  const lanes = Array.isArray(reply?.lanes) ? reply.lanes : [];
  const out = {};
  for (const g of inboxGroups(superAdmin)) {
    const inG = lanes.filter((l) => l.group === g.key);
    out[g.key] = inG.some((l) => l.count === null || l.count === undefined) ? null : inG.reduce((t, l) => t + l.count, 0);
  }
  const vals = Object.values(out);
  out.all = vals.some((n) => n === null) ? null : vals.reduce((t, n) => t + n, 0);
  return out;
}

/**
 * "Waiting by lane" (APR1): one stacked bar per lane that waits, split by age
 * band, worst first (most over 72 hours, then 24 to 72, then most items). A
 * lane that could not be read, or was cut at the read's cap, is a row that
 * says so, never an empty bar. `sum` is the chart's one sentence.
 */
export const BAND_PARTS = [
  { key: 'ok', label: 'Under 24 hours', tone: 'sky' },
  { key: 'due_soon', label: '24 to 72 hours', tone: 'amber' },
  { key: 'past', label: 'Over 72 hours', tone: 'violet' },
  { key: 'unknown', label: 'Age not recorded', tone: 'muted' },
];
export function laneAgeChart(reply) {
  const lanes = Array.isArray(reply?.lanes) ? reply.lanes : [];
  const waiting = lanes.filter((l) => l.bands && l.count > 0).sort((a, b) => (b.bands.past - a.bands.past) || (b.bands.due_soon - a.bands.due_soon) || (b.count - a.count));
  const missing = lanes.filter((l) => !l.bands && (l.count === null || l.count > 0));
  const rows = [
    ...waiting.map((l) => ({
      key: l.key, label: laneLabelOf(l.key, l.label), total: `${nf(l.count)} waiting`,
      parts: BAND_PARTS.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: l.bands[p.key] || 0 })),
    })),
    ...missing.map((l) => ({ key: l.key, label: laneLabelOf(l.key, l.label), total: l.count === null ? 'Could not be read' : 'Split not shown', parts: [], reason: l.bands_reason || null })),
  ];
  const top = waiting[0];
  const most = waiting.slice().sort((a, b) => b.count - a.count)[0];
  const parts = [];
  if (!waiting.length) parts.push('No lane has anything waiting.');
  else {
    parts.push(`Items waiting by lane in age bands. ${laneLabelOf(most.key, most.label)} holds the most, ${nf(most.count)}`);
    if (top.bands.past) parts[0] += `; ${laneLabelOf(top.key, top.label)} has ${nf(top.bands.past)} over 72 hours`;
    parts[0] += '.';
  }
  if (missing.length) parts.push(`${missing.map((l) => laneLabelOf(l.key, l.label)).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not split: ${missing.length === 1 ? 'it' : 'they'} could not be read in full.`);
  return { type: 'stackbars', head: 'Lane', rows, parts: BAND_PARTS, sum: parts.join(' ') };
}

const WEEK_DAY = (iso) => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : iso;
};

/**
 * "Arrived and decided, last 8 weeks" (APR1): the totals as two lines, the
 * current week to date. A total that leaves lanes out says which in `foot`;
 * no total at all is a chart that is not drawn, with why.
 */
export function weekChart(reply) {
  const weeks = Array.isArray(reply?.weeks) ? reply.weeks : [];
  const t = reply?.totals || {};
  if (!weeks.length || (!t.arrived && !t.decided)) {
    return { drawable: false, reason: reply?.unreadable?.length ? `${reply.unreadable.join(', ')} could not be read.` : 'No lane records its weeks yet.' };
  }
  const labels = weeks.map((w) => WEEK_DAY(w.week_start));
  const series = [
    { label: 'Arrived', tone: 'violet', values: t.arrived || weeks.map(() => null) },
    { label: 'Decided', tone: 'sky', values: t.decided || weeks.map(() => null) },
  ];
  const last = (v) => (Array.isArray(v) ? v[v.length - 1] : null);
  const first = (v) => (Array.isArray(v) ? v[0] : null);
  const sum = [
    'Items that arrived and were decided each week for eight weeks.',
    t.arrived ? `Arrivals went from ${nf(first(t.arrived))} to ${nf(last(t.arrived))} a week.` : 'Arrivals are not counted.',
    t.decided ? `Decisions went from ${nf(first(t.decided))} to ${nf(last(t.decided))}.` : 'Decisions are not counted.',
    'This week is not finished.',
  ].join(' ');
  const out = [...new Set([...(t.decided_leaves_out || [])])];
  const arrOut = (t.arrived_leaves_out || []).filter((l) => !out.includes(l));
  const foot = [
    out.length ? `${out.join(', ')} ${out.length === 1 ? 'does' : 'do'} not record when ${out.length === 1 ? 'it was' : 'they were'} decided, so ${out.length === 1 ? 'it is' : 'they are'} not in Decided.` : null,
    arrOut.length ? `${arrOut.join(', ')} ${arrOut.length === 1 ? 'is' : 'are'} not in Arrived.` : null,
  ].filter(Boolean).join(' ');
  return { drawable: true, chart: { type: 'lines', labels, series, currentIndex: labels.length - 1 }, sum, foot: foot || null };
}

/* ------------------------------------------------------------------ *
 * The item (APR3) and Assign
 * ------------------------------------------------------------------ */

/** "17 Oct 2026, 09:12" in UTC; null for no stamp. */
export function stampText(s) {
  if (!s) return null;
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${day}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The item read as the drawer draws it, or the refusal as its state:
 *   gone      404 `item_not_waiting` — decided, withdrawn or moved;
 *   missing   404 `item_not_found` — not on this inbox (an HQ lane for an Admin too);
 *   unread    503 or anything else — "Could not be read", with Try again.
 */
export function itemView(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') {
    const code = read.error?.code;
    if (code === 'item_not_waiting') return { state: 'gone', text: read.error.message || 'This item is not waiting any more.' };
    if (code === 'item_not_found' || read.error?.status === 404) return { state: 'missing', text: 'That item is not on this inbox.' };
    return { state: 'unread', text: read.error?.message || 'The item could not be read.', ref: errorRef(read.error) };
  }
  const r = read.reply || {};
  const it = r.item || {};
  const lane = r.lane || {};
  return {
    state: 'ready',
    lane: it.lane || lane.key,
    id: it.id,
    who: it.who || 'Not recorded',
    what: it.what || 'Not recorded',
    laneLabel: laneLabelOf(lane.key || it.lane, lane.label || it.lane_label),
    group: groupLabel(lane.group),
    hq: !!lane.hq,
    submitted: stampText(it.created_at) || 'Not recorded',
    age: ageText(it.age_hours) || 'Age not recorded',
    band: slaBand(it.sla),
    assignee: assigneeOf(it),
    assigneeReason: r.assignee_reason || null,
    notifies: lane.notifies || null,
    decidedOn: lane.decided_on || null,
    undecided: lane.undecided_reason || null,
    history: historyLines(r.history),
  };
}

/** History (APR3): "Assigned to [B] by [A]" with its day, oldest first; unreadable says so. */
export function historyLines(history) {
  if (!history) return { state: 'unread', text: 'History could not be read.' };
  if (history.available === false) return { state: 'unread', text: history.reason || 'History could not be read.' };
  const items = Array.isArray(history.items) ? history.items : [];
  return {
    state: 'ready',
    lines: items.map((h) => ({
      text: h.actor_user_id === h.assignee_user_id ? `${h.assignee_name} took it` : `Assigned to ${h.assignee_name} by ${h.actor_name}`,
      day: dayText(h.created_at) || 'Not recorded',
    })),
    capped: !!history.capped,
  };
}

/**
 * Assign's choices (APR3a): each active admin with how many they hold now,
 * the caller marked "you". With no reviewer list there is nobody to choose,
 * and the dialog says why rather than offering an empty list.
 */
export function assignChoices(reply, callerId) {
  if (!Array.isArray(reply?.reviewers)) return { state: 'unread', text: reply?.reviewers_reason || 'The admins could not be read, so nobody can be chosen.' };
  const counts = new Map((reply.tiles?.per_admin || []).map((p) => [p.id, p.count]));
  return {
    state: 'ready',
    choices: reply.reviewers.map((r) => {
      const n = counts.get(r.id);
      const bits = [r.name];
      if (Number(r.id) === Number(callerId)) bits.push('you');
      bits.push(n === undefined ? 'count not read' : `${nf(n)} now`);
      return { id: r.id, label: bits.join(' · ') };
    }),
  };
}

/** Assign's title: one item by who it is about, or "Assign 3 items". */
export function assignTitle(items) {
  if (items.length === 1) return `Assign ${items[0].who}’s ${items[0].laneLabel === 'KYC' ? 'identity check' : 'item'}`;
  return `Assign ${nf(items.length)} items`;
}

/** The body Assign sends: the Worker's `{ lane, item_id }` per item. */
export const assignItems = (rows) => rows.map((r) => ({ lane: r.lane, item_id: r.id }));

/**
 * A refusal as the toast says it (APR13c): the Worker's own sentence, and that
 * the list was read again. A stale item (it left the board) reads the same way.
 */
export function refusalToast(e) {
  const said = e?.message && e.message !== 'Request failed' ? e.message : 'That could not be done.';
  return `${said.replace(/\.?$/, '.')} The list is up to date now.`;
}

/** "Details": the status and the Worker's code, never a body or a stack. */
export function errorRef(e) {
  if (!e) return null;
  const bits = [];
  if (e.status) bits.push(`HTTP ${e.status}`);
  if (e.code) bits.push(e.code);
  return bits.length ? bits.join(' · ') : null;
}

/* ------------------------------------------------------------------ *
 * Lanes (APR2, APR9)
 * ------------------------------------------------------------------ */

/**
 * A lane's Notifies cell (APR2), from the glance's lane (`notifies`, D1041).
 * "Nobody yet" is a warning pill; a glance without it is not read here.
 */
export function notifiesOf(glanceLane) {
  if (!glanceLane || !glanceLane.notifies) return { state: 'unrecorded', text: 'Not read here yet' };
  return { state: 'ready', text: glanceLane.notifies, warn: glanceLane.notifies === 'Nobody yet' };
}

/**
 * HQ decides' counts (APR9), from the glance's `hq_decides` (D1041), which a
 * Super Admin's glance alone carries. Each HQ lane is a number, "Could not be
 * read", or not on the glance.
 */
export function hqLaneViews(hqDecides) {
  const lanes = Array.isArray(hqDecides?.lanes) ? hqDecides.lanes : null;
  return HQ_LANES.map((l) => {
    if (!lanes) return { ...l, state: 'unrecorded', reason: 'HQ’s counts were not on the glance.' };
    const g = lanes.find((x) => x.key === l.key);
    if (!g) return { ...l, state: 'unrecorded', reason: 'This lane was not on the glance.' };
    if (g.count === null || g.count === undefined) return { ...l, state: 'unreadable', count: null, reason: g.reason || 'That is not the same as nothing waiting.' };
    return { ...l, state: 'ready', count: g.count, age: g.count > 0 ? ageText(g.oldest_age_hours) : null, notifies: notifiesOf(g) };
  });
}

/** "HQ decides · 22 waiting", or why there is no total. */
export function hqBandLine(hqDecides) {
  if (!hqDecides) return null;
  const t = hqDecides.pending_total;
  return t === null || t === undefined
    ? `HQ decides · ${(hqDecides.unreadable || []).join(', ') || 'a lane'} could not be read, so no total · only Super Admins see this group`
    : `HQ decides · ${nf(t)} waiting · only Super Admins see this group`;
}

/* ------------------------------------------------------------------ *
 * Decided (APR10)
 * ------------------------------------------------------------------ */

export const OUTCOME_FILTERS = [
  { key: null, label: 'Any outcome' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'other', label: 'Other' },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Decided's query from the address: the filters the Worker reads, a bad one dropped rather than sent. */
export function decidedQueryOf(search) {
  const p = new URLSearchParams(search || '');
  const out = {};
  const page = Number(p.get('page'));
  out.page = Number.isSafeInteger(page) && page >= 1 && page <= 40 ? page : 1;
  if (p.get('lane')) out.lane = p.get('lane');
  if (OUTCOME_FILTERS.some((o) => o.key && o.key === p.get('outcome'))) out.outcome = p.get('outcome');
  if (/^[1-9]\d*$/.test(p.get('decided_by') || '')) out.decided_by = p.get('decided_by');
  if (DAY.test(p.get('from') || '')) out.from = p.get('from');
  if (DAY.test(p.get('to') || '')) out.to = p.get('to');
  return out;
}

const OUTCOME_TONE = { approved: 'good', declined: 'bad', other: null };

/** Decided's rows: when, lane, who, the store's own outcome word, who decided, the wait, and whether they see the note. */
export function decidedRows(reply) {
  return (Array.isArray(reply?.items) ? reply.items : []).map((r) => ({
    key: `${r.lane}:${r.item_id}:${r.decided_at}`,
    when: stampText(r.decided_at) || 'Not recorded',
    lane: laneLabelOf(r.lane, r.lane_label),
    who: r.who || 'Not recorded',
    outcome: { word: r.outcome_word || 'Not recorded', tone: OUTCOME_TONE[r.outcome] ?? null },
    by: r.decided_by?.name || 'Not recorded',
    wait: ageText(r.wait_hours) || 'Not recorded',
    note: r.note || null,
    shown: !!r.note && !!r.note_shown,
  }));
}

/**
 * What the log cannot say, as the page prints it: each lane that records
 * only from a day ("decisions were not recorded before 25 Oct 2026"), each
 * lane that does not record, with why, and each lane's caveat.
 */
export function decidedNotes(reply) {
  const lanes = Array.isArray(reply?.lanes) ? reply.lanes : [];
  return {
    since: lanes.filter((l) => l.recorded && l.since).map((l) => `${laneLabelOf(l.key, l.label)}: decisions were not recorded before ${dayText(l.since) || l.since}.`),
    notRecorded: lanes.filter((l) => !l.recorded).map((l) => ({ label: laneLabelOf(l.key, l.label), reason: l.reason || 'It does not record its decisions.' })),
    caveats: lanes.filter((l) => l.recorded && l.caveat).map((l) => ({ label: laneLabelOf(l.key, l.label), text: l.caveat })),
    unreadable: Array.isArray(reply?.unreadable) ? reply.unreadable : [],
  };
}

/** "1–25 of 357", or "1–25 of —" with the reason when a lane failed. */
export function decidedPageLine(reply) {
  const n = Array.isArray(reply?.items) ? reply.items.length : 0;
  if (!n) return null;
  const size = Number(reply.page_size) || 25;
  const from = ((Number(reply.page) || 1) - 1) * size;
  return `${nf(from + 1)}–${nf(from + n)} of ${reply.total === null || reply.total === undefined ? '—' : nf(reply.total)}`;
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
