/**
 * D1162 (#3069) — FND5 and FND6's words and arithmetic, kept out of the
 * screens so each can be tested on its own.
 *
 * Every figure comes from `GET /api/fund-admin/lps` (D1158, with D1162's
 * `?lp=` and `tally`), the fund's call ledger, its distributions, notices,
 * booklet and comms log. A figure no store holds is "Not recorded" with the
 * Worker's reason, and one the store could not read is "Unreadable": never a
 * zero.
 */
import { LP_TYPE_LABELS, LP_TYPES } from '../../investor/fundLpCommsModel';
import { parseDollarsToCents } from '../../investor/fundCallsModel';
import { money } from './fundAdminModel';

export { LP_TYPE_LABELS, LP_TYPES };

export const BASE = '/admin/fund-admin/lps';
import { NOT_RECORDED } from '../../../lib/absence';

export { NOT_RECORDED };

/** The type a row records, or "Not recorded" (the chart's dashed bar). */
export const lpTypeText = (t) => (t && LP_TYPE_LABELS[t]) || NOT_RECORDED;

export const IDENTITY_LABELS = {
  approved: 'Approved',
  pending: 'Waiting',
  not_started: 'Not started',
  needs_information: 'Needs information',
  rejected: 'Rejected',
};
export const identityText = (k) => (k ? IDENTITY_LABELS[k] || k.replace(/_/g, ' ') : NOT_RECORDED);

export const BOOKLET_LABELS = { not_started: 'Not started', open: 'Open', submitted: 'Submitted', withdrawn: 'Withdrawn' };
export const bookletText = (b) => (b ? BOOKLET_LABELS[b.state] || b.state : NOT_RECORDED);

/** The toolbar's filters (the Worker's own names and values). */
export const FILTERS = {
  lpa: [['', 'Any LPA'], ['signed', 'LPA signed'], ['unsigned', 'LPA pending']],
  identity: [['', 'Any identity'], ['approved', 'Approved'], ['pending', 'Waiting'], ['not_started', 'Not started'], ['rejected', 'Rejected'], ['not_recorded', 'Not recorded']],
  booklet: [['', 'Any booklet'], ['not_started', 'Not started'], ['open', 'Open'], ['submitted', 'Submitted'], ['withdrawn', 'Withdrawn'], ['not_recorded', 'Not recorded']],
};
export const SORTS = [
  ['name', 'Name'], ['fund', 'Fund'], ['commitment', 'Commitment'], ['called', 'Called'], ['received', 'Received'],
  ['outstanding', 'Outstanding'], ['distributed', 'Distributed'], ['last_notice', 'Last notice'],
];
export const PER_PAGE = 25;
const KEYS = ['lpa', 'identity', 'booklet', 'outstanding', 'overdue', 'q', 'sort', 'dir', 'page'];

const paramsOf = (search) => new URLSearchParams(String(search || '').replace(/^\?/, ''));

/**
 * The roster's query from the address: the header's fund filter (`?fund=`)
 * and the toolbar's own keys. Anything malformed is left out, so the Worker
 * never refuses a hand-edited address the page itself would not write.
 */
export function rosterQuery(search) {
  const p = paramsOf(search);
  const pick = (k, list) => (list.some(([v]) => v && v === p.get(k)) ? p.get(k) : undefined);
  const fund = p.get('fund');
  const page = Number(p.get('page'));
  return {
    fund: fund && /^[1-9]\d{0,8}$/.test(fund) ? fund : undefined,
    lpa: pick('lpa', FILTERS.lpa),
    identity: pick('identity', FILTERS.identity),
    booklet: pick('booklet', FILTERS.booklet),
    outstanding: p.get('outstanding') === '1' || undefined,
    overdue: p.get('overdue') === '1' || undefined,
    q: (p.get('q') || '').trim().slice(0, 100) || undefined,
    sort: SORTS.some(([k]) => k === p.get('sort')) ? p.get('sort') : 'commitment',
    dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    per_page: PER_PAGE,
  };
}

/** The address with one toolbar key changed; any change but the page goes back to page 1. */
export function withQuery(search, key, value) {
  const p = paramsOf(search);
  p.delete('moved');
  if (value === undefined || value === null || value === '' || value === false) p.delete(key);
  else p.set(key, value === true ? '1' : String(value));
  if (key !== 'page') p.delete('page');
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** What the drawer keeps of the address: the header's fund and the toolbar. */
export function keepRoster(search) {
  const p = paramsOf(search);
  const out = new URLSearchParams();
  for (const k of ['fund', ...KEYS]) if (p.get(k)) out.set(k, p.get(k));
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** One LP's address: the drawer over the roster. */
export const lpHref = (id, search = '') => `${BASE}/${id}${keepRoster(search)}`;

/** The LP id an address under `/lps/` names, or null. */
export function lpIdFrom(pathname) {
  const m = String(pathname || '').match(/^\/admin\/fund-admin\/lps\/([1-9]\d{0,8})\/?$/);
  return m ? Number(m[1]) : null;
}

/** `Unreadable` when the Worker says the store could not be read, else `Not recorded`. */
export const absence = (reason) => (typeof reason === 'string' && reason.startsWith('Unreadable') ? 'Unreadable' : NOT_RECORDED);

/** One money figure of a row: its amount, or the absence with the Worker's reason. Never 0 for a missing value. */
export function cell(row, key) {
  const v = row?.[key];
  if (v !== null && v !== undefined) return { text: money(v) ?? NOT_RECORDED, reason: null };
  const reason = row?.unavailable?.[key] ?? null;
  return { text: absence(reason), reason };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** FND5's tiles, over every row the filters keep. */
export function lpTiles(roster) {
  const t = roster?.totals || {};
  const tally = roster?.tally || {};
  const missing = (k) => (t.not_recorded?.[k] ? `${plural(t.not_recorded[k], 'LP')} not recorded` : null);
  const sum = (k) => (t[k] == null ? NOT_RECORDED : money(t[k]) ?? NOT_RECORDED);
  const funds = roster?.funds?.length ?? 0;
  return [
    { k: 'LPs', v: String(roster?.total_rows ?? 0), note: `in ${plural(funds, 'fund')}`, testId: 'lps-tile-count' },
    { k: 'Total committed', v: sum('commitment_cents'), note: missing('commitment_cents'), testId: 'lps-tile-committed' },
    { k: 'Called', v: sum('called_cents'), note: missing('called_cents'), testId: 'lps-tile-called' },
    {
      k: 'Outstanding', v: sum('outstanding_cents'), testId: 'lps-tile-outstanding',
      tone: tally.overdue_lines > 0 ? 'warn' : null,
      note: tally.overdue_lines > 0 ? `${plural(tally.overdue_lines, 'line')} overdue` : missing('outstanding_cents'),
    },
    { k: 'LPAs pending', v: String(tally.lpa_pending ?? NOT_RECORDED), note: 'LPA not signed', testId: 'lps-tile-lpa' },
    {
      k: 'Identity checks pending', v: String(tally.identity_pending ?? NOT_RECORDED), testId: 'lps-tile-identity',
      note: tally.identity_not_recorded ? `${plural(tally.identity_not_recorded, 'LP')} with no check recorded` : 'Recorded and not approved',
    },
  ];
}

/**
 * The chart by LP type (FND5): one bar per type the rows hold, its width
 * against the largest commitment. A type no row records is the dashed bar
 * "Not recorded"; a type whose rows hold no commitment draws no bar and says so.
 */
export function typeBars(tally) {
  const rows = Array.isArray(tally?.by_type) ? tally.by_type : [];
  const max = Math.max(0, ...rows.map((r) => Number(r.commitment_cents) || 0));
  return rows.map((r) => ({
    key: r.lp_type || 'not_recorded',
    label: lpTypeText(r.lp_type),
    lps: r.lps,
    cents: r.commitment_cents,
    text: r.commitment_cents == null ? 'No commitment recorded' : money(r.commitment_cents),
    width: r.commitment_cents == null || max <= 0 ? 0 : Math.max(1, Math.round((r.commitment_cents / max) * 1000) / 10),
    dashed: r.lp_type == null,
  }));
}

/** The chart's one-line reading, and its screen-reader summary. */
export function typeNote(bars) {
  const top = bars.filter((b) => !b.dashed && b.cents != null).sort((a, b) => b.cents - a.cents)[0];
  if (!top) return 'No LP type with a commitment is recorded.';
  return `${top.label} LPs hold the most: ${top.text} across ${plural(top.lps, 'LP')}.`;
}
export function typeSummary(bars) {
  return `Commitment by LP type: ${bars.map((b) => (b.dashed
    ? `type not recorded for ${plural(b.lps, 'LP')} holding ${b.text}`
    : `${b.label.toLowerCase()} ${b.text} across ${plural(b.lps, 'LP')}`)).join('; ')}.`;
}

/** The row menu (FND5). Set LP type and Log a contact are `fund.write`, an Admin's act. */
export const ROW_MENU = [['open', 'Open'], ['type', 'Set LP type'], ['contact', 'Log a contact']];

// ───────────────────────────────────────────────────── Add LP (FND5a, FND5s)

export const ADD_LP_NOTE = 'The LP joins the fund’s LP list. Nothing reaches them until a notice is issued.';
export const FIRST_CALL_NOTE = 'Adding a first call issues it to this LP. You will confirm with your authenticator code.';
/** Said under the act table's sentence when a viewer may not issue a call. */
export const ADD_WITHOUT_CALL = 'Add the LP without a first call; the Super Admin calls it later.';

/**
 * The body `POST /api/funds/:id/lps` takes, or the sentence that says what to
 * fix. A first call is sent only when the viewer may issue one (`canIssue`):
 * an Admin adds the LP without it.
 */
export function addLpBody(form, { canIssue }) {
  const name = String(form.name || '').trim();
  const email = String(form.email || '').trim();
  if (!form.fundId) return { error: 'Choose the fund the LP joins.' };
  if (!name && !email) return { error: 'Give the LP a name or an email, so the list can say who it is.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'The email is not an email address.' };
  const commitment = parseDollarsToCents(form.commitment);
  if (commitment == null) return { error: 'Enter the commitment in dollars, above zero, with at most two decimals.' };
  if (form.lpType && !LP_TYPES.includes(form.lpType)) return { error: 'Choose one of the LP types, or leave it not recorded.' };
  const body = { name: name || undefined, email: email || undefined, commitment_amount: commitment / 100 };
  if (canIssue && String(form.firstCall || '').trim()) {
    const first = parseDollarsToCents(form.firstCall);
    if (first == null) return { error: 'Enter the first call in dollars, above zero, or leave it empty.' };
    if (first > commitment) return { error: 'The first call cannot be more than the commitment.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.firstDue || ''))) return { error: 'A first call needs its due date. It is never filled in for you.' };
    body.first_call_cents = first;
    body.first_call_due_date = form.firstDue;
  }
  return { body, lpType: form.lpType || null };
}

// ───────────────────────────────────────────────────── The drawer (FND6)

export const DRAWER_TABS = [
  ['summary', 'Summary'], ['calls', 'Calls & receipts'], ['distributions', 'Distributions'],
  ['notices', 'Notices'], ['booklet', 'Booklet'], ['contacts', 'Contact log'],
];

export const RECEIPT_NOTE = 'Record receipt records money already received. It moves no money.';
export const BOOKLET_VIEW_NOTE = 'Opening a booklet’s answers is recorded in the audit log.';
export const BOOKLET_VIEW_RECORDED = 'This view is recorded in the audit log.';
export const ACCEPT_SENTENCE = 'A Super Admin sends a booklet to the General Partner for acceptance.';
export const WITHDRAW_MIN = 10;
export const WITHDRAW_MAX = 200;
export const withdrawReady = (reason) => {
  const n = String(reason || '').trim().length;
  return n >= WITHDRAW_MIN && n <= WITHDRAW_MAX;
};

export const LINE_STATE = {
  paid: ['Paid', 'ok'], overdue: ['Overdue', 'warn'], part_received: ['Part received', 'neutral'], pending: ['Pending', 'neutral'],
};

/**
 * One LP's lines on the fund's call ledger (`GET /api/funds/:id/capital-calls`),
 * newest call first: what each owed, received and still owes, its state, and
 * whether Record receipt applies (anything still outstanding).
 */
export function lpCallLines(ledger, lpId) {
  const mine = (l) => Number(l.limited_partner_id) === Number(lpId);
  const lines = [];
  for (const c of ledger?.calls || []) {
    for (const l of (c.lines || []).filter(mine)) lines.push({ ...l, label: `Call ${c.call_number}`, due: l.due_date || c.due_date || null });
  }
  for (const l of (ledger?.unnumbered || []).filter(mine)) lines.push({ ...l, label: `Call line ${l.id}`, due: l.due_date || null });
  return lines.map((l) => ({
    id: l.id,
    label: l.label,
    due: l.due,
    owed: money(l.owed_cents) ?? NOT_RECORDED,
    received: money(l.received_cents) ?? NOT_RECORDED,
    outstanding: money(l.outstanding_cents) ?? NOT_RECORDED,
    outstanding_cents: Number(l.outstanding_cents) || 0,
    state: l.state,
    days_overdue: l.days_overdue ?? null,
    open: Number(l.outstanding_cents) > 0,
  }));
}

/**
 * Record receipt's body: the full outstanding or another amount, the date the
 * wire landed and its reference. The Worker refuses more than is outstanding.
 */
export function receiptBody(form, line) {
  const cents = form.full ? line.outstanding_cents : parseDollarsToCents(form.amount);
  if (!cents || cents <= 0) return { error: 'Enter the amount received in dollars, above zero, with at most two decimals.' };
  if (cents > line.outstanding_cents) return { error: `That is more than this line still owes (${line.outstanding}).` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.receivedOn || ''))) return { error: 'Give the date the wire landed.' };
  const reference = String(form.reference || '').trim().slice(0, 120);
  return { body: { amount_cents: cents, received_on: form.receivedOn, ...(reference ? { reference } : {}) } };
}

export const day = (v) => (v ? String(v).slice(0, 10) : null);
