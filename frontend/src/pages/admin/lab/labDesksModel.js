/**
 * D970 (#2755) — the Spin-Out Lab's Hosts (SL9), Formation (SL10, SL10d) and
 * Graduation (SL11, SL11r) tabs: their words and rules. Pure: no React, no
 * fetch, so the tests read them without a browser.
 *
 * WHAT IS READ (no new Worker route; each read answers alone):
 *   hosts       `GET /api/admin/lab-hosts?status=`, newest 500 in a status,
 *               with every status's count (uncapped);
 *   83(b)       `GET /api/admin/83b-review`, every startup with a tracker and
 *               the admins an operator is chosen from;
 *   orders      `GET /api/admin/incorporations`, the newest 200 paid orders,
 *               each with its project's documents (50);
 *   graduation  `GET /api/spinout-lab/certificates`, the newest 500
 *               certificates, the graduates with none (`awaiting`, null when
 *               that read failed) and `eligible_total`.
 *
 * Both Formation desks serve every startup, not only the Lab's. The "Lab
 * ventures · All startups" switch waits for part 4 (#2751); nothing here
 * filters by venture in the browser meanwhile.
 *
 * A failed read says so with Try again and never draws a zero or "none yet";
 * a figure no store holds says "Not recorded" with its reason. Every write
 * opens an in-page dialog that says what it changes, with nothing
 * preselected. Days are the Lab's clock: ET (America/New_York); D1's
 * zone-less stamps are UTC (`ui/parseStamp.js`).
 */

import { parseStamp } from '../../../ui/parseStamp.js';

export { parseStamp };

const nf = (n) => Number(n).toLocaleString('en-US');
export const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ *
 * Days, on the Lab's clock
 * ------------------------------------------------------------------ */

export const LAB_ZONE = 'America/New_York';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored time's day in ET: "8 Nov", with the year when it is not this year's. */
export function etDay(value, now = Date.now()) {
  const ms = typeof value === 'number' ? value : parseStamp(value);
  if (ms === null || !Number.isFinite(ms)) return null;
  const parts = (t) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: LAB_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const d = parts(ms);
  const y = parts(now).year;
  return `${d.day} ${MONTHS[Number(d.month) - 1]}${d.year === y ? '' : ` ${d.year}`}`;
}

/** A calendar date ("2026-11-17"), which has no zone: "17 Nov". */
export function calendarDay(value, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const y = new Intl.DateTimeFormat('en-US', { timeZone: LAB_ZONE, year: 'numeric' }).format(new Date(now));
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${m[1] === y ? '' : ` ${m[1]}`}`;
}

/** A calendar date as itself, a stored time as its ET day. */
export const dayOf = (value, now = Date.now()) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? calendarDay(value, now) : etDay(value, now));

/** Today in ET, as a calendar date: the latest a filing date may be. */
export function etToday(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: LAB_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/* ------------------------------------------------------------------ *
 * Reads and their states
 * ------------------------------------------------------------------ */

/** A read as the tabs hold it: `{ status: 'loading' | 'ready' | 'error', data, error }`. */
export const dataOf = (read) => (read && read.data !== undefined && read.data !== null ? read.data : null);
export const isLoading = (read) => !read || (read.status === 'loading' && dataOf(read) === null);
export const isFailed = (read) => Boolean(read) && read.status === 'error' && dataOf(read) === null;
export const isStale = (read) => Boolean(read) && read.status === 'error' && dataOf(read) !== null;

/** The Worker's sentence for a refused write, else the error's own, else a plain one. Never a code. */
export function refusalText(e, known = {}) {
  const code = e?.code || e?.data?.error || e?.data?.code || null;
  if (code && known[code]) return known[code];
  const said = e?.data?.message || e?.data?.detail || e?.message;
  return said && !/^[a-z_]+$/.test(said) ? said : 'The change was not saved. Nothing changed.';
}

export const ROWS_PER_PAGE = 25;

export function pageOf(rows, page, size = ROWS_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, page), pages);
  const from = rows.length ? (at - 1) * size + 1 : 0;
  const to = Math.min(at * size, rows.length);
  return { rows: rows.slice(from ? from - 1 : 0, to), page: at, pages, from, to, total: rows.length };
}

/** "1–6 of 13". */
export const rangeText = ({ from, to, total }) => (total ? `${nf(from)}–${nf(to)} of ${nf(total)}` : 'None');

const has = (s, needle) => String(s || '').toLowerCase().includes(needle);

/* ------------------------------------------------------------------ *
 * Hosts (SL9)
 * ------------------------------------------------------------------ */

/** The five stored statuses, in the canvas's words and order. */
export const HOST_STATUSES = [
  { key: 'pending', word: 'Waiting', glyph: '◷', tone: 'amber' },
  { key: 'approved', word: 'Approved', glyph: '✓', tone: 'green' },
  { key: 'rejected', word: 'Declined', glyph: '✕', tone: 'red' },
  { key: 'withdrawn', word: 'Withdrawn', glyph: '–', tone: 'muted' },
  { key: 'revoked', word: 'Removed', glyph: '–', tone: 'muted' },
];
export const hostStatus = (key) => HOST_STATUSES.find((s) => s.key === key) || { key, word: key ? 'Another status' : 'Status not recorded', glyph: '·', tone: 'muted' };

export const CAPACITIES = [
  { key: 'investor', word: 'Investor' },
  { key: 'advisor', word: 'Advisor' },
  { key: 'partner', word: 'Partner' },
];
export const capacityWord = (key) => CAPACITIES.find((c) => c.key === key)?.word || 'Not recorded';

/** The read's cap per status (`LIMIT 500`). */
export const HOSTS_CAP = 500;
export const HOSTS_NOTE = 'Only approved hosts appear to Lab founders on Office Hours.';
export const HOSTS_FOOT = 'Approve, Decline and Remove each open a dialog with an optional note to the host.';

/** Which decisions a host in this status can take: the Worker's own (`lab_hosts.ts` DECISIONS). */
export function hostDecisions(status) {
  if (status === 'pending') return ['approve', 'reject'];
  if (status === 'approved') return ['revoke'];
  return [];
}

const REVIEWED_VERB = { approved: 'Approved', rejected: 'Declined', revoked: 'Removed' };

/** One table row from one application. */
export function hostRow(a, now = Date.now()) {
  const status = hostStatus(a?.status);
  let reviewed;
  if (a?.status === 'pending') reviewed = { text: 'Not reviewed yet', muted: true };
  else if (a?.status === 'withdrawn') reviewed = { text: 'Withdrawn by the applicant', muted: true };
  else if (REVIEWED_VERB[a?.status]) {
    const day = etDay(a?.reviewed_at, now);
    reviewed = { text: day ? `${REVIEWED_VERB[a.status]} by an admin ${day}` : `${REVIEWED_VERB[a.status]} by an admin` };
  } else reviewed = { text: 'Not recorded', muted: true };
  return {
    uid: a?.uid,
    name: String(a?.profile_name || a?.applicant_name || '').trim() || 'No name given',
    company: String(a?.profile_company || '').trim() || null,
    email: String(a?.applicant_email || '').trim() || null,
    capacity: a?.capacity || null,
    appliedAs: capacityWord(a?.capacity),
    statement: String(a?.statement || '').trim() || null,
    applied: etDay(a?.created_at, now) || 'Not recorded',
    appliedAt: parseStamp(a?.created_at),
    status,
    reviewed,
    note: String(a?.review_note || '').trim() || null,
    decisions: hostDecisions(a?.status),
  };
}

export const HOST_SORTS = [
  { key: 'waiting', label: 'Waiting longest' },
  { key: 'newest', label: 'Newest first' },
  { key: 'name', label: 'Name A–Z' },
];

/** Search (name, company or email), Applied as, and the sort, over the loaded status. */
export function filterHosts(rows, { q = '', appliedAs = '', sort = 'waiting' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = rows.filter((r) => (!needle || [r.name, r.company, r.email].some((v) => has(v, needle))) && (!appliedAs || r.capacity === appliedAs));
  const at = (r) => r.appliedAt ?? Infinity;
  const sorters = {
    waiting: (a, b) => at(a) - at(b),
    newest: (a, b) => (b.appliedAt ?? -Infinity) - (a.appliedAt ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  };
  return [...out].sort(sorters[sort] || sorters.waiting);
}

/** The status chips' counts: the Worker's, which no cap touches; none while the read is unread. */
export function hostCounts(read) {
  const counts = dataOf(read)?.counts;
  if (!counts || typeof counts !== 'object') return null;
  return Object.fromEntries(HOST_STATUSES.map((s) => [s.key, Number.isFinite(Number(counts[s.key])) ? Number(counts[s.key]) : null]));
}

export const HOST_REFUSALS = Object.freeze({
  decision_invalid: 'That is not a decision this page can record.',
  application_not_found: 'That application no longer exists.',
});

/** Each decision's dialog: what it changes, and that the note reaches the host. */
export function hostDialog(decision, row) {
  const who = row?.name || 'this host';
  if (decision === 'approve') {
    const as = { Investor: 'an investor', Advisor: 'an advisor', Partner: 'a partner' }[row?.appliedAs] || 'a host';
    return { title: `Approve ${who} as a host?`, body: `${who} will appear to Lab founders on Office Hours, as ${as}.`, action: 'Approve', tone: 'primary', done: `${who} is approved and now appears on Office Hours.` };
  }
  if (decision === 'reject') {
    return { title: `Decline ${who}’s application?`, body: `${who} will not appear on Office Hours. The application stays on record as Declined.`, action: 'Decline', tone: 'danger', done: `${who}’s application is declined.` };
  }
  return { title: `Remove ${who} as a host?`, body: `${who} stops appearing to Lab founders on Office Hours. Sessions already booked are not cancelled here.`, action: 'Remove', tone: 'danger', done: `${who} is removed and no longer appears on Office Hours.` };
}
export const HOST_NOTE_MAX = 1000;
export const HOST_NOTE_LABEL = 'Note to the host · optional · they see it';

/* ------------------------------------------------------------------ *
 * Formation (SL10): 83(b) operator review
 * ------------------------------------------------------------------ */

export const FORMATION_NOTE = 'These two desks also serve startups outside the Lab.';
export const REVIEW_FOOT = 'A review checks the filing record is complete. It does not replace a tax or legal professional, and it does not hold back graduation.';
export const ORDERS_FOOT = 'Nothing here files with a state. It records what an admin did.';

export const REVIEW_OUTCOMES = [
  { key: 'complete', word: 'Complete', tone: 'green' },
  { key: 'incomplete', word: 'Incomplete', tone: 'amber' },
];
export const outcomeOf = (key) => REVIEW_OUTCOMES.find((o) => o.key === key) || null;

/** One 83(b) row: the operator, the last review, the next follow-up. */
export function reviewRow(s, now = Date.now()) {
  const last = s?.last_review || null;
  return {
    id: s?.project_id,
    name: String(s?.project_name || '').trim() || 'No name on record',
    operator: s?.operator ? { id: s.operator.user_id, name: String(s.operator.name || '').trim() || 'An admin with no name' } : null,
    last: last ? { outcome: outcomeOf(last.outcome), day: etDay(last.reviewed_at, now), note: String(last.note || '').trim() || null } : null,
    lastKey: last ? (outcomeOf(last.outcome)?.key || 'other') : 'none',
    followUp: calendarDay(s?.next_follow_up, now),
    followUpRaw: s?.next_follow_up || null,
    followUpReason: last ? 'The last review set no follow-up date.' : 'No review yet.',
  };
}

export const REVIEW_SORTS = [
  { key: 'follow', label: 'Next follow-up' },
  { key: 'name', label: 'Startup A–Z' },
];
export const LAST_REVIEW_FILTERS = [
  { key: 'complete', word: 'Complete' },
  { key: 'incomplete', word: 'Incomplete' },
  { key: 'none', word: 'No review yet' },
];

/** Search (startup), Operator (an id or `unassigned`), Last review, and the sort. */
export function filterReviews(rows, { q = '', operator = '', last = '', sort = 'follow' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = rows.filter((r) => {
    if (needle && !has(r.name, needle)) return false;
    if (operator === 'unassigned' && r.operator) return false;
    if (operator && operator !== 'unassigned' && String(r.operator?.id) !== String(operator)) return false;
    if (last && r.lastKey !== last) return false;
    return true;
  });
  const sorters = {
    follow: (a, b) => String(a.followUpRaw || '9999').localeCompare(String(b.followUpRaw || '9999')) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  };
  return [...out].sort(sorters[sort] || sorters.follow);
}

/** The Worker's codes for the two 83(b) writes, in words (`admin_83b_review.ts`). */
export const REVIEW_REFUSALS = Object.freeze({
  no_operator_assigned: 'Assign an operator before recording a review.',
  operator_not_an_admin: 'The operator must be an active Axal admin.',
  operator_user_id_invalid: 'Choose an admin from the list.',
  outcome_invalid: 'Choose whether the record is complete.',
  follow_up_date_invalid: 'The follow-up date is not a calendar date.',
  follow_up_date_past: 'The follow-up date is in the past.',
  tracker_not_on_project: 'That tracker belongs to another startup.',
  project_not_found: 'That startup no longer exists.',
});

/** A review can be recorded once an outcome is chosen, and only for a startup with an operator. */
export const canRecordReview = ({ busy, outcome, operator }) => !busy && Boolean(outcome) && Boolean(operator);

/* ------------------------------------------------------------------ *
 * Formation (SL10): formation orders
 * ------------------------------------------------------------------ */

export const ORDERS_CAP = 200;
export const DOCS_CAP = 50;

export const ORDER_STATUSES = [
  { key: 'paid', word: 'Paid', tone: 'amber' },
  { key: 'packet_processing', word: 'Packet in progress', tone: 'amber' },
  { key: 'packet_ready', word: 'Packet ready', tone: 'violet' },
  { key: 'filed', word: 'Filed', tone: 'green' },
];
export const orderStatus = (key) => ORDER_STATUSES.find((s) => s.key === key) || { key, word: 'Another status', tone: 'muted' };

/** "delaware" → "Delaware", "new_york" → "New York". */
export function jurisdictionWord(id) {
  const s = String(id || '').trim();
  if (!s) return 'Not recorded';
  return s.split(/[_\s-]+/).map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

/** Which step an order waits on: the packet, the filing, or nothing (the Worker's order, `incorporationFiling.ts`). */
export function orderStep(status) {
  if (status === 'paid' || status === 'packet_processing') return 'packet';
  if (status === 'packet_ready') return 'filed';
  return null;
}

/** One order row. */
export function orderRow(o, now = Date.now()) {
  const docs = Array.isArray(o?.documents) ? o.documents : [];
  const packet = o?.packet_document_id != null ? (docs.find((d) => String(d?.id) === String(o.packet_document_id)) || { id: o.packet_document_id, title: null }) : null;
  return {
    id: o?.id,
    company: String(o?.company_name || '').trim() || 'No company name on record',
    project: String(o?.project_name || '').trim() || null,
    jurisdiction: jurisdictionWord(o?.jurisdiction_id),
    jurisdictionKey: String(o?.jurisdiction_id || ''),
    status: orderStatus(o?.status),
    paid: etDay(o?.paid_at, now) || 'Not recorded',
    paidAt: parseStamp(o?.paid_at),
    // The Worker compares the filing date with the stored stamp's own day (UTC), so the page does too.
    paidDay: /^\d{4}-\d{2}-\d{2}/.test(String(o?.paid_at || '')) ? String(o.paid_at).slice(0, 10) : null,
    packet: packet ? { id: packet.id, title: String(packet.title || '').trim() || `Document ${packet.id}` } : null,
    filedOn: calendarDay(o?.filed_on, now),
    step: orderStep(o?.status),
    documents: docs.map((d) => ({ id: d?.id, title: String(d?.title || '').trim() || `Document ${d?.id}` })),
    docsCapped: docs.length >= DOCS_CAP,
  };
}

export const ORDER_SORTS = [
  { key: 'paid', label: 'Paid, newest first' },
  { key: 'oldest', label: 'Paid, oldest first' },
  { key: 'company', label: 'Company A–Z' },
];

/** Search (company or project), Status, Jurisdiction, and the sort. */
export function filterOrders(rows, { q = '', status = '', jurisdiction = '', sort = 'paid' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = rows.filter((r) => (!needle || has(r.company, needle) || has(r.project, needle))
    && (!status || r.status.key === status) && (!jurisdiction || r.jurisdictionKey === jurisdiction));
  const sorters = {
    paid: (a, b) => (b.paidAt ?? -Infinity) - (a.paidAt ?? -Infinity),
    oldest: (a, b) => (a.paidAt ?? Infinity) - (b.paidAt ?? Infinity),
    company: (a, b) => a.company.localeCompare(b.company, 'en', { sensitivity: 'base' }),
  };
  return [...out].sort(sorters[sort] || sorters.paid);
}

/** The Worker's codes for the two order steps, in words (`admin_incorporations.ts`). */
export const ORDER_REFUSALS = Object.freeze({
  order_not_found: 'That order no longer exists.',
  order_not_awaiting_packet: 'This order is not waiting for its packet any more.',
  document_id_required: 'Choose the document that is the packet.',
  document_not_on_project: 'That document belongs to another project.',
  packet_not_ready: 'Mark the packet ready before recording the filing.',
  filed_on_invalid: 'The filing date is not a calendar date.',
  filed_on_future: 'The filing date is in the future.',
  filed_on_before_payment: 'The filing date is before the order was paid.',
});

/** A filing date the Worker would take: a calendar date, not after today (ET) and not before payment. */
export function filedOnProblem(value, { paidDay = null, now = Date.now() } = {}) {
  if (!value) return 'Choose the date the filing was submitted.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ORDER_REFUSALS.filed_on_invalid;
  if (value > etToday(now)) return ORDER_REFUSALS.filed_on_future;
  if (paidDay && value < paidDay) return ORDER_REFUSALS.filed_on_before_payment;
  return null;
}

/* ------------------------------------------------------------------ *
 * Graduation (SL11, SL11r)
 * ------------------------------------------------------------------ */

export const CERTS_CAP = 500;
export const NOT_EMAILED = 'No email is sent for a certificate yet.';
export const NOT_DOWNLOADED = 'The certificate is built in the graduate’s browser.';
export const REVOKE_BODY = 'Its public verification page will say it was revoked. A same-date reissue is not possible.';
export const NO_REISSUE = 'A revoked certificate cannot be reissued on the same date: its credential ID is taken.';
export const REVOKE_REASON_MAX = 500;
export const BACKFILL_LIMIT = 100;

export const CERT_STATUSES = [
  { key: 'awaiting', word: 'Awaiting issue', tone: 'amber' },
  { key: 'issued', word: 'Issued', tone: 'green' },
  { key: 'revoked', word: 'Revoked', tone: 'red' },
];
export const certStatus = (key) => CERT_STATUSES.find((s) => s.key === key);

/** The graduates with no certificate first (they are the work), then the registry, newest first as read. */
export function gradRows(data, now = Date.now()) {
  const awaiting = Array.isArray(data?.awaiting) ? data.awaiting : [];
  const certs = Array.isArray(data?.certificates) ? data.certificates : [];
  return [
    ...awaiting.map((a) => ({
      key: `awaiting-${a?.user_id}`, userId: a?.user_id, id: null,
      name: String(a?.name || '').trim() || 'No name on record', company: null,
      credentialId: null, status: certStatus('awaiting'), publicPage: null, token: null,
      graduated: dayOf(a?.conferred_at, now), graduatedAt: parseStamp(a?.conferred_at), action: 'issue',
    })),
    ...certs.map((c) => {
      const issued = c?.status === 'issued';
      return {
        key: `cert-${c?.id}`, userId: c?.user_id, id: c?.id,
        name: String(c?.public_name || '').trim() || 'No name on record', company: String(c?.public_company || '').trim() || null,
        credentialId: String(c?.credential_id || '').trim() || null, status: certStatus(issued ? 'issued' : 'revoked'),
        publicPage: issued ? (Number(c?.public_share_enabled) === 1 ? 'on' : 'off') : 'off', token: c?.public_token || null,
        graduated: dayOf(c?.public_issued_on || c?.issued_at, now), graduatedAt: parseStamp(c?.public_issued_on || c?.issued_at),
        action: issued ? 'revoke' : null,
      };
    }),
  ];
}

/** The four tiles: Eligible and Issued from the read; Emailed and Downloaded Not recorded, with their lines. */
export function gradTiles(read) {
  const data = dataOf(read);
  const tiles = [];
  if (!data) {
    const state = isLoading(read) ? { state: 'loading' } : { state: 'unreadable', reason: 'The certificates could not be read. That is not a claim that there are none.' };
    tiles.push({ key: 'eligible', label: 'Eligible', ...state }, { key: 'issued', label: 'Issued', ...state });
  } else {
    const certs = Array.isArray(data.certificates) ? data.certificates : [];
    const capped = certs.length >= CERTS_CAP;
    const eligible = Number(data.eligible_total);
    tiles.push(Array.isArray(data.awaiting) && Number.isFinite(eligible) && data.eligible_total !== null
      ? { key: 'eligible', label: 'Eligible', state: 'ready', value: nf(eligible), sub: 'graduated: incorporation completed' }
      : { key: 'eligible', label: 'Eligible', state: 'unreadable', reason: data.unavailable?.awaiting || 'The graduate list could not be read.' });
    const issued = certs.filter((c) => c?.status === 'issued').length;
    const revoked = certs.length - issued;
    tiles.push({
      key: 'issued', label: 'Issued', state: 'ready', value: `${nf(issued)}${capped ? '+' : ''}`,
      sub: revoked ? `${nf(revoked)} revoked since` : null, cover: capped ? 'Counted over the newest 500 certificates.' : null,
    });
  }
  tiles.push({ key: 'emailed', label: 'Emailed', state: 'unrecorded', reason: NOT_EMAILED });
  tiles.push({ key: 'downloaded', label: 'Downloaded', state: 'unrecorded', reason: NOT_DOWNLOADED });
  return tiles;
}

/** How many graduates wait, when that read answered; null when it did not. */
export function awaitingCount(read) {
  const a = dataOf(read)?.awaiting;
  return Array.isArray(a) ? a.length : null;
}

/** "After Issue all eligible: 3 issued · 1 could not be issued: no name or date on record." */
export function backfillLine(r) {
  if (!r || !Number.isFinite(Number(r.issued))) return null;
  const parts = [`After Issue all eligible: ${nf(r.issued)} issued`];
  if (Number(r.skipped) > 0) parts.push(`${nf(r.skipped)} could not be issued: no name or date on record, or a revoked certificate holds the ID`);
  if (Number(r.remaining) > 0) parts.push(`${nf(r.remaining)} still waiting; run it again`);
  return `${parts.join(' · ')}.`;
}

export const GRAD_SORTS = [
  { key: 'graduated', label: 'Graduated, newest first' },
  { key: 'name', label: 'Graduate A–Z' },
];
export const PUBLIC_PAGE_FILTERS = [
  { key: 'on', word: 'On' },
  { key: 'off', word: 'Off' },
];

/** Search (graduate or company), Status, Public page, and the sort; awaiting rows stay first under the default. */
export function filterGrads(rows, { q = '', status = '', publicPage = '', sort = 'graduated' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = rows.filter((r) => (!needle || has(r.name, needle) || has(r.company, needle))
    && (!status || r.status.key === status) && (!publicPage || r.publicPage === publicPage));
  const sorters = {
    graduated: (a, b) => ((a.status.key === 'awaiting') === (b.status.key === 'awaiting') ? (b.graduatedAt ?? -Infinity) - (a.graduatedAt ?? -Infinity) : a.status.key === 'awaiting' ? -1 : 1),
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  };
  return [...out].sort(sorters[sort] || sorters.graduated);
}

/** The Worker's codes for issue and revoke, in words (`spinout_certificates.ts`). */
export const CERT_REFUSALS = Object.freeze({
  reason_required: 'Write why the certificate is revoked.',
  reissue_blocked: NO_REISSUE,
});

export const verifyHref = (token) => `/verify/${encodeURIComponent(token)}`;
