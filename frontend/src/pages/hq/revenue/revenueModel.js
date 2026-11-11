/**
 * D5039 (#5039, Revenue v2 part 1) — the read-only cockpit's rules, pure so a
 * Node test can hold every one of them without a browser.
 *
 * Nothing here fetches and nothing here invents a figure. Each function takes
 * the reads the page made — every one of them `null` while it is out,
 * `UNAVAILABLE` when it failed, or the endpoint's own payload — and says what
 * can honestly be drawn from them:
 *
 *   VALUE_STATES     the eight states a figure can be in, each a word and a
 *                    shape (canvas RV03), so no state is colour alone;
 *   TEMPORAL         the labels that say what a figure is measured over;
 *   periods          the `YYYY-Qn` keys the Period selector offers;
 *   coverageSources  every source the page reads, its state and the ONE
 *                    sentence that explains it (RV11) — the page says each
 *                    "why" once, here, and links to it from everywhere else;
 *   attentionItems   only what the reads can show needs action, most urgent
 *                    first, and nothing at all when nothing does;
 *   receivables, subsidiaries, promotions, streams, executive summary.
 *
 * Money is minor units in the row's own currency, formatted by `lib/money.js`
 * (D5029) and never summed across currencies.
 */
import { currencyCode, formatMicro, formatMinor } from '../../../lib/money.js';
import { bpsPercent } from '../../../lib/bps';

/** A read that failed. One symbol, shared by the page and every part. */
export const UNAVAILABLE = Symbol('unavailable');

/** D5029: the bucket for a statement whose currency is missing or not a listed one. It is never read as euros. */
export const UNRECORDED_CURRENCY = 'UNRECORDED';

/**
 * Minor units to a readable amount, in the currency the row is denominated in, at that currency's own number of
 * decimals (D5029: `lib/money.js`; nothing here divides by 100). A row with no usable currency is NOT shown in a
 * guessed one: the count of minor units is shown with the missing currency named, so a real amount is not dropped
 * and not mistaken for euros.
 */
export function money(cents, currency) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  const shown = formatMinor(Number(cents), currency);
  if (shown !== null) return shown;
  return `${Number(cents).toLocaleString()} minor units (currency ${currency ? `"${currency}" is not one we can price in` : 'not recorded'})`;
}

/** A finite number or null. Never a default. */
export const finite = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** A read's three cases, named. */
export const isLoading = (read) => read === null || read === undefined;
export const isFailed = (read) => read === UNAVAILABLE;
export const isReady = (read) => !isLoading(read) && !isFailed(read);

/* ── value states (RV03) ─────────────────────────────────────────────── */

/**
 * The eight financial value states. The word is always drawn; the shape is the
 * second signal (it differs in greyscale); the tone is a hint for colour only.
 * Shapes are `security/StatusBadge.jsx`'s glyphs, reused rather than redrawn.
 */
export const VALUE_STATES = Object.freeze({
  recorded: { word: 'Recorded', shape: 'check', tone: 'positive', description: 'A measured value.' },
  zero: { word: 'Zero', shape: 'zero', tone: 'neutral', description: 'Measured, and it is zero.' },
  incomplete: { word: 'Incomplete', shape: 'triangle', tone: 'attention', description: 'Part of it is missing; a money floor carries a “+”, and the gap is named.' },
  not_recorded: { word: 'Not recorded', shape: 'dash', tone: 'neutral', description: 'Nothing in StudioOS holds it.' },
  not_reported: { word: 'Not reported', shape: 'dotted-ring', tone: 'neutral', description: 'The source should send it and has not.' },
  stale: { word: 'Stale', shape: 'dashed-ring', tone: 'attention-soft', description: 'Shown with its age; older than it should be.' },
  unavailable: { word: 'Unavailable', shape: 'struck-square', tone: 'negative', description: 'Normally readable; this read failed.' },
  loading: { word: 'Loading', shape: 'clock', tone: 'progress', description: 'Being read now; not a zero.' },
});
export const VALUE_STATE_KEYS = Object.freeze(Object.keys(VALUE_STATES));

/** One state by key. An unknown key throws: a figure that quietly read "Recorded" for a typo is the failure. */
export function valueState(key) {
  const s = VALUE_STATES[key];
  if (!s) throw new Error(`Unknown value state: ${String(key)}`);
  return { key, ...s };
}

/**
 * A money figure and its state. `cents` null is never drawn as zero: it takes
 * `absent` (Not recorded unless said otherwise). A real 0 is `zero`.
 */
export function moneyFigure(cents, currency, { absent = 'not_recorded', incomplete = false } = {}) {
  const n = finite(cents);
  if (n === null) return { state: absent, text: null };
  const text = money(n, currency);
  if (incomplete) return { state: 'incomplete', text: `${text}+` };
  return { state: n === 0 ? 'zero' : 'recorded', text };
}

/** A count and its state, on the same rule. */
export function countFigure(n, { absent = 'not_recorded' } = {}) {
  const v = finite(n);
  if (v === null) return { state: absent, text: null };
  return { state: v === 0 ? 'zero' : 'recorded', text: v.toLocaleString() };
}

/** The state a figure takes from a read that has not produced it: loading, or unavailable. */
export const pendingState = (read) => (isFailed(read) ? 'unavailable' : 'loading');

/* ── temporal labels ─────────────────────────────────────────────────── */

/**
 * What each figure is measured over. `period` takes the selected quarter's
 * label; the rest ignore the Period selector, and say so, so a Q4 filter never
 * implies disputes or refunds are Q4-scoped.
 */
export const TEMPORAL = Object.freeze({
  period: { word: null, description: 'The selected period.' },
  live: { word: 'Live', description: 'Read now; ignores the period.' },
  d30: { word: 'Last 30 days', description: 'Rolling; ignores the period.' },
  now: { word: 'As of now', description: 'A point in time; ignores the period.' },
  month: { word: 'This month', description: 'The calendar month.' },
});

/** The Worker's own temporal word for a summary block (D5039 `temporal`), as one of ours. */
export function summaryTemporal(summary, block) {
  const t = isReady(summary) && summary.temporal ? summary.temporal[block] : null;
  if (t === 'period') return 'period';
  if (t === 'as_of_now') return 'now';
  return t ? 'now' : 'period';
}

/* ── periods ─────────────────────────────────────────────────────────── */

/** The Worker's own rule (`SUMMARY_PERIOD_RE`): a calendar quarter written `2026-Q4`. */
export const PERIOD_KEY_RE = /^(2\d{3})-Q([1-4])$/;

export function periodLabel(key) {
  const m = PERIOD_KEY_RE.exec(String(key || ''));
  return m ? `Q${m[2]} ${m[1]}` : null;
}

/** The quarter `steps` before (negative) or after `key`. */
export function shiftPeriod(key, steps) {
  const m = PERIOD_KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const idx = Number(m[1]) * 4 + (Number(m[2]) - 1) + steps;
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
}

/** The quarter a date falls in. */
export function periodOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** The selector's options: the current quarter and the seven before it, newest first. */
export function periodOptions(currentKey, count = 8) {
  if (!PERIOD_KEY_RE.test(String(currentKey || ''))) return [];
  return Array.from({ length: count }, (_, i) => {
    const key = shiftPeriod(currentKey, -i);
    return { key, label: periodLabel(key), current: i === 0 };
  });
}

/* ── dates and age ───────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/** An ISO-ish stamp as milliseconds, or null. SQLite's `YYYY-MM-DD HH:MM:SS` is read as UTC. */
export function stampMs(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v.replace(' ', 'T') : `${v.replace(' ', 'T')}${v.length > 10 ? 'Z' : 'T00:00:00Z'}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Whole days between a stamp and now, or null. */
export function ageDays(v, nowMs) {
  const ms = stampMs(v);
  return ms === null || !Number.isFinite(nowMs) ? null : Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
}

/**
 * A branch reports its quarter every morning (D266), so a report on the
 * current quarter older than a week has missed seven runs. That threshold is
 * this page's (D5039), and it applies to the current quarter only: a closed
 * quarter's last report is not stale for being old.
 */
export const STALE_REPORT_DAYS = 7;

/** "4 min ago" style, from the read time. */
export function readAgo(readAt, nowMs) {
  const ms = stampMs(readAt);
  if (ms === null) return null;
  const mins = Math.max(0, Math.round((nowMs - ms) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} h ago`;
}

/** The read time as `14:26 UTC`. */
export function readClock(readAt) {
  const ms = stampMs(readAt);
  if (ms === null) return null;
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

/* ── the ledger the cockpit does not have yet ────────────────────────── */

/**
 * The four positions no store backs yet. Each is drawn Not recorded, never
 * €0, and this one sentence (in the coverage drawer) is why.
 */
export const LEDGER_FIGURES = Object.freeze(['Invoiced', 'Collected', 'Outstanding', 'Overdue']);
export const LEDGER_REASON =
  'No ledger reconciles licence invoices and payments yet, so Invoiced, Collected, Outstanding, Overdue and the '
  + 'monthly trend are not recorded. They need invoice-backed licence revenue and a reconciled revenue ledger, '
  + 'which are separate work. This is not a claim that nothing was invoiced.';

/**
 * D5082 (#5082) — the four ledger positions once the Worker sends `licence_invoices` (D5036, #5132): licence-fee
 * invoices per native currency, never summed. Invoiced and Collected are the invoices issued in the period;
 * Outstanding and Overdue are the receivable as at today, whatever period issued it. Before that field exists the
 * positions stay Not recorded; an unreadable ledger is Unavailable. Neither is ever 0. A currency the readable
 * ledger has no invoice in, beside one it has, is a measured zero.
 */
export function ledgerPosition(summary) {
  if (!isReady(summary)) return { state: pendingState(summary), currencies: [] };
  const inv = summary.licence_invoices;
  if (!inv || typeof inv !== 'object') return { state: 'not_recorded', currencies: [] };
  if (!inv.available) return { state: 'unavailable', reason: inv.reason || 'The licence-fee invoice ledger could not be read.', currencies: [] };
  const period = Array.isArray(inv.by_currency) ? inv.by_currency : [];
  const open = Array.isArray(inv.receivable_by_currency) ? inv.receivable_by_currency : [];
  const set = new Set();
  for (const r of [...period, ...open]) set.add(currencyCode(r.currency) || UNRECORDED_CURRENCY);
  const zero = (cur) => ({ state: 'zero', text: money(0, cur) });
  const currencies = [...set].sort().map((cur) => {
    const p = period.find((r) => (currencyCode(r.currency) || UNRECORDED_CURRENCY) === cur);
    const o = open.find((r) => (currencyCode(r.currency) || UNRECORDED_CURRENCY) === cur);
    return {
      currency: cur,
      invoiced: p ? moneyFigure(p.invoiced_cents, cur) : zero(cur),
      invoices: p ? finite(p.invoices) : 0,
      collected: p ? moneyFigure(p.collected_cents, cur) : zero(cur),
      outstanding: o ? moneyFigure(o.outstanding_cents, cur) : zero(cur),
      openInvoices: o ? finite(o.open_invoices) : 0,
      overdue: o ? moneyFigure(o.overdue_cents, cur) : zero(cur),
      overdueInvoices: o ? finite(o.overdue_invoices) : 0,
    };
  });
  return {
    state: 'recorded',
    currencies,
    asOf: dayOf(inv.as_of),
    expectedNotInvoiced: Array.isArray(inv.expected_not_invoiced) ? inv.expected_not_invoiced.length : 0,
    cannotInvoice: Array.isArray(inv.cannot_invoice) ? inv.cannot_invoice.length : 0,
  };
}

/** The ledger's one explanation once it is read: licence fees only, and what is still outside it. */
export function ledgerReason(position) {
  const gaps = [];
  if (position.expectedNotInvoiced) gaps.push(`${position.expectedNotInvoiced} licence ${position.expectedNotInvoiced === 1 ? 'year has' : 'years have'} started without an invoice`);
  if (position.cannotInvoice) gaps.push(`${position.cannotInvoice} billable ${position.cannotInvoice === 1 ? 'licence cannot' : 'licences cannot'} be invoiced (no fee or no start date)`);
  return 'Licence-fee invoices only (D5036). Invoiced and Collected are the invoices issued in the period; Outstanding '
    + 'and Overdue are every open invoice as at today, whatever period issued it. Collected is what HQ recorded, not '
    + 'reconciled against a bank. Subscription revenue and revenue-share statements are not in this ledger, and no '
    + 'monthly series is recorded.' + (gaps.length ? ` ${gaps.join('; ')}.` : '');
}

export const TREND_REASON =
  'No monthly revenue series is recorded: the trend needs the reconciled revenue ledger. Nothing is drawn rather '
  + 'than a line of zeros.';

/** D514, as the policy state the canvas draws (RV05): no action, and what still works. */
export const STATEMENT_DRAW_HELD =
  'Drawing new revenue-share statements is held for the owner\'s decision on whether a statement counts as revenue '
  + 'per subsidiary (D514). Recording payments and disputes on statements already drawn still works.';

/* ── the token P&L (D5027), unchanged in substance ───────────────────── */

const usd = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
  ? null
  : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(v)));

/**
 * The token P&L the Worker computes (D762, `routes/admin_revenue.ts`), as display strings. Pure over the
 * `token_cost` payload so every state is drawn in a test. Two failure domains, never one:
 *   - the COST (`available`, `cost_usd`) is the usage log;
 *   - the MARGIN and its parts (`billed_available`) are the charge ledger. A margin that cannot be read leaves the cost
 *     on screen, and a cost that cannot be read leaves nothing to show.
 * A figure is `null` (Not recorded) when it is not known, and a real zero or negative figure is drawn as itself.
 * When every member run this quarter predates migration 493 (`margin_microusd` null) there is no charge to total, so
 * the top-up spend and cost are Not recorded rather than $0.00; what is counted without it (tokens given, included in
 * plans) stays. Included-plan usage is its own figure and is never added to the spend.
 */
export function tokenMarginView(token) {
  if (!token || token.available !== true) {
    return { state: 'unreadable', reason: token?.reason || 'The AI usage log could not be read.', cost: null, margin: null };
  }
  const micro = (v) => (v === null || v === undefined ? null : formatMicro(Number(v), 'USD'));
  const cost = Number.isFinite(Number(token.cost_usd)) && token.cost_usd !== null && token.cost_usd !== undefined ? usd(token.cost_usd) : null;
  if (token.billed_available !== true) {
    return {
      state: 'margin_unreadable',
      reason: token.billed_reason || 'The AI holds and token ledger could not be read, so the margin is not shown.',
      cost, margin: null,
    };
  }
  const marginKnown = token.margin_microusd !== null && token.margin_microusd !== undefined;
  const runs = Number(token.member_runs);
  const notRecorded = Number(token.runs_not_recorded);
  const sign = marginKnown ? Math.sign(Number(token.margin_microusd)) : null;
  return {
    state: marginKnown ? 'ok' : 'predates',
    reason: marginKnown ? null : 'Every member run this quarter was settled before the charge ledger (migration 493), so there is no charge to total. This is not a margin of zero.',
    cost,
    topupSpend: marginKnown ? micro(token.topup_spend_microusd) : null,
    topupCost: marginKnown ? micro(token.topup_cost_microusd) : null,
    given: micro(token.tokens_given_microusd),
    included: micro(token.included_in_plans_microusd),
    margin: marginKnown ? micro(token.margin_microusd) : null,
    tone: sign === null ? null : (sign < 0 ? 'negative' : (sign > 0 ? 'positive' : 'zero')),
    partial: marginKnown && Number.isFinite(notRecorded) && notRecorded > 0,
    coverage: Number.isFinite(runs) && Number.isFinite(notRecorded)
      ? `${runs.toLocaleString()} member run${runs === 1 ? '' : 's'} settled; ${notRecorded.toLocaleString()} before the charge ledger (migration 493) and outside the margin`
      : null,
  };
}

/* ── disputes ────────────────────────────────────────────────────────── */

/** Open means Stripe has not closed it: not won, not lost. */
export const isOpenDispute = (d) => d && d.status !== 'won' && d.status !== 'lost';

/** Stripe's evidence deadline has passed and no evidence is on file. */
export const evidenceOverdue = (d, nowSec) =>
  Number.isFinite(Number(d?.due_by)) && Number(d.due_by) > 0 && Number(d.due_by) < nowSec && !d.has_evidence;

/** Evidence is due inside three days and none is on file. */
export const evidenceDueSoon = (d, nowSec) =>
  Number.isFinite(Number(d?.due_by)) && Number(d.due_by) >= nowSec && Number(d.due_by) - nowSec <= 3 * 86400 && !d.has_evidence;

/** The open disputes, or null while the read is out or failed. */
export const openDisputes = (disputes) => (isReady(disputes) ? (disputes.disputes || []).filter(isOpenDispute) : null);

/* ── statements → receivables ────────────────────────────────────────── */

/** Paid-in-full is refused server-side when the owed figure is still a floor. */
export function statementAllowsPaidInFull(statement) {
  if (!statement) return false;
  if (statement.complete === false) return false;
  if (statement.unreported_streams > 0 || statement.estimated_streams > 0) return false;
  return true;
}

/** A statement's receivable status. A dispute on an open claim outranks its stored status. */
export function receivableStatus(s) {
  if (!s) return 'draft';
  if (s.status === 'void') return 'void';
  if (finite(s.disputed_cents) > 0 && s.status !== 'paid') return 'disputed';
  if (s.status === 'paid') return 'paid';
  if (s.status === 'issued') return 'issued';
  return 'draft';
}

export const RECEIVABLE_STATUSES = Object.freeze([
  { key: 'disputed', word: 'Disputed', shape: 'triangle', tone: 'negative' },
  { key: 'issued', word: 'Issued', shape: 'clock', tone: 'progress' },
  { key: 'draft', word: 'Draft', shape: 'ring', tone: 'neutral' },
  { key: 'paid', word: 'Paid', shape: 'check', tone: 'positive' },
  { key: 'void', word: 'Void', shape: 'dash', tone: 'neutral' },
]);
const STATUS_ORDER = Object.fromEntries(RECEIVABLE_STATUSES.map((s, i) => [s.key, i]));

/**
 * The receivables table: one row per drawn statement, disputed first, then
 * issued, draft, paid and void, newest period first inside each. No statement
 * records a due date, so Due is Not recorded and there is no Overdue status:
 * an overdue claim cannot be told from one not yet due.
 */
export function receivableRows(statements, { licenceUid = null } = {}) {
  const items = isReady(statements) && statements.available ? (statements.items || []) : [];
  return items
    .filter((s) => !licenceUid || s.licence_uid === licenceUid)
    .map((s) => {
      const status = receivableStatus(s);
      const floor = !statementAllowsPaidInFull(s);
      const cur = currencyCode(s.currency) || UNRECORDED_CURRENCY;
      return {
        uid: s.uid,
        statement: s,
        who: s.brand_name || s.licence_ref || s.licence_uid || s.uid,
        receivable: `Revenue share · ${periodLabel(s.period) || s.period || 'period not recorded'}`,
        period: s.period,
        currency: cur,
        status,
        floor,
        owed: moneyFigure(s.owed_cents, s.currency, { incomplete: floor && status !== 'void' }),
        paid: moneyFigure(s.paid_cents, s.currency),
        outstanding: status === 'void' ? { state: 'not_recorded', text: null } : moneyFigure(s.outstanding_cents, s.currency, { incomplete: floor }),
        disputed: finite(s.disputed_cents) > 0 ? money(s.disputed_cents, s.currency) : null,
      };
    })
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || String(b.period).localeCompare(String(a.period)));
}

/** How many receivables carry each status, for the chips. */
export function receivableCounts(rows) {
  const counts = { all: rows.length };
  for (const s of RECEIVABLE_STATUSES) counts[s.key] = rows.filter((r) => r.status === s.key).length;
  return counts;
}

/**
 * Outstanding per currency over the claims somebody has seen (issued or
 * disputed). Drafts are working figures and are left out; a floor makes the
 * line a floor. Never one figure across currencies.
 */
export function outstandingByCurrency(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.status !== 'issued' && r.status !== 'disputed') continue;
    const cents = finite(r.statement.outstanding_cents);
    if (cents === null) continue;
    const b = by.get(r.currency) || { currency: r.currency, cents: 0, floors: 0, count: 0 };
    b.cents += cents;
    b.count += 1;
    if (r.floor) b.floors += 1;
    by.set(r.currency, b);
  }
  return [...by.values()].map((b) => ({ ...b, figure: moneyFigure(b.cents, b.currency === UNRECORDED_CURRENCY ? null : b.currency, { incomplete: b.floors > 0 }) }));
}

/** The facts the statement drawer lists, each a recorded value or its absence. */
export function statementFacts(s) {
  if (!s) return null;
  const floor = !statementAllowsPaidInFull(s);
  return {
    gross: moneyFigure(s.gross_cents, s.currency, { incomplete: floor }),
    share: bpsPercent(s.revenue_share_bps),
    owed: moneyFigure(s.owed_cents, s.currency, { incomplete: floor }),
    paid: moneyFigure(s.paid_cents, s.currency),
    disputed: moneyFigure(s.disputed_cents, s.currency),
    outstanding: moneyFigure(s.outstanding_cents, s.currency, { incomplete: floor }),
    floorReason: !floor ? null
      : (s.unreported_streams > 0
        ? `${s.unreported_streams} stream${s.unreported_streams === 1 ? '' : 's'} unreported — this owed figure is a floor, not a total.`
        : 'Drawn over an estimated stream — not an invoiced figure.'),
    reportsAsOf: dayOf(s.reports_as_of),
    drawnAt: dayOf(s.created_at),
    paidAt: dayOf(s.paid_at),
    paidNote: s.paid_note || null,
    disputeNote: s.dispute_note || null,
    updatedAt: dayOf(s.updated_at),
  };
}

/* ── subsidiaries ────────────────────────────────────────────────────── */

/**
 * Reporting health first: per licence, whether its period report arrived and
 * how old it is, then what the period's statement claims. A branch's gross is
 * shown only from a drawn statement; every stream a branch reports today
 * arrives unmeasured (D266), so the usage report itself carries no amount.
 */
export function subsidiaryRows({ coverage, periodStatements, period, currentPeriod, nowMs, licenceUid = null }) {
  if (!isReady(coverage) || !coverage.available) return null;
  const stmts = isReady(periodStatements) && periodStatements.available ? (periodStatements.items || []) : null;
  return (coverage.by_licence || [])
    .filter((l) => !licenceUid || l.licence_uid === licenceUid)
    .map((l) => {
      const age = ageDays(l.reported_at, nowMs);
      let report;
      if (!l.reported) report = { state: 'not_reported', text: `Not received for ${periodLabel(period) || period}` };
      else if (period === currentPeriod && age !== null && age > STALE_REPORT_DAYS) report = { state: 'stale', text: `Stale · ${age} d ago` };
      else report = { state: 'recorded', text: age === null ? 'Received' : `Received ${age === 0 ? 'today' : `${age} d ago`}` };

      const s = stmts ? stmts.find((x) => x.licence_uid === l.licence_uid && x.period === period) : undefined;
      const floor = s ? !statementAllowsPaidInFull(s) : false;
      const statementState = stmts === null ? pendingState(periodStatements) : 'not_recorded';
      // An absent figure carries a `label` for its state's word, never a `text` that would read as a value.
      const absentLabel = stmts === null ? undefined : 'Not drawn';
      const absent = { state: statementState, text: null, label: absentLabel };
      const cell = (cents) => (s ? moneyFigure(cents, s.currency, { incomplete: floor }) : absent);
      let coverageState;
      if (report.state === 'not_reported') coverageState = 'not_reported';
      else if (report.state === 'stale') coverageState = 'stale';
      else if (!s || floor || !l.streams_measurable) coverageState = 'incomplete';
      else coverageState = 'recorded';
      return {
        licence_uid: l.licence_uid,
        name: l.brand_name || l.licence_ref || l.licence_uid,
        report,
        // A report with no measurable stream carries no amount: "Amounts not reported", never a zero gross.
        gross: s ? moneyFigure(s.gross_cents, s.currency, { incomplete: floor })
          : { state: 'not_reported', text: null, label: l.reported ? 'Amounts not reported' : undefined },
        share: s ? bpsPercent(s.revenue_share_bps) : null,
        owed: cell(s?.owed_cents),
        paid: s ? moneyFigure(s.paid_cents, s.currency) : absent,
        outstanding: s && s.status !== 'void' ? moneyFigure(s.outstanding_cents, s.currency, { incomplete: floor }) : absent,
        coverage: coverageState,
        statementUid: s?.uid || null,
      };
    });
}

/* ── promotions ──────────────────────────────────────────────────────── */

/**
 * The five facts about one ceiling row, kept apart (D5028). Never derived from each other:
 *   saved     the row exists at HQ (it is listed, so it is);
 *   pushed    the branch confirmed the LATEST saved figure (`pushed_at` not older than the last save);
 *   enforced  what the branch does with it at checkout: only a ceiling for the CURRENT quarter that the branch has
 *             received is enforced; an older one says nothing about this quarter; an earlier figure is what a branch
 *             enforces when the latest save did not reach it;
 *   issued    what the branch reported to HQ, or Not reported. HQ's copy is only what a branch reports;
 *   remaining known only when an issued figure was reported: no issued figure, no remaining, never the whole ceiling.
 */
export function ceilingFacts(row, currentPeriod) {
  const r = row || {};
  const current = Boolean(currentPeriod) && r.period === currentPeriod;
  const everPushed = typeof r.pushed_at === 'string' && r.pushed_at !== '';
  const latestPushed = everPushed && (!r.updated_at || String(r.pushed_at) >= String(r.updated_at));
  const issuedKnown = r.issued_available === true && r.issued_cents !== null && r.issued_cents !== undefined && Number.isFinite(Number(r.issued_cents));
  const remainingKnown = issuedKnown && r.remaining_cents !== null && r.remaining_cents !== undefined && Number.isFinite(Number(r.remaining_cents));
  let enforced;
  if (!current) enforced = { state: 'other_period', label: 'Not this quarter: it governs no checkout now' };
  else if (latestPushed) enforced = { state: 'enforced', label: 'Enforced by the branch at checkout' };
  else if (everPushed) enforced = { state: 'earlier_figure', label: 'The branch enforces the figure it last received, not this one' };
  else enforced = { state: 'not_received', label: 'Not enforced yet: the branch has not received it, so it allows discounts' };
  return {
    saved: { yes: true, label: 'Saved at HQ' },
    pushed: latestPushed
      ? { yes: true, label: `Pushed to the branch${dayOf(r.pushed_at) ? ` ${dayOf(r.pushed_at)}` : ''}` }
      : { yes: false, label: everPushed ? 'The latest figure was not pushed' : 'Not pushed to the branch' },
    enforced,
    issued: issuedKnown
      ? { known: true, label: `Reported${dayOf(r.issued_reported_at) ? ` ${dayOf(r.issued_reported_at)}` : ''}` }
      : { known: false, label: 'Not reported to HQ' },
    remaining: remainingKnown ? { known: true } : { known: false, label: 'Not known: no issued figure was reported' },
  };
}

/**
 * The Reporting column: when the branch last reported what it issued, and
 * whether that is stale (current quarter, older than a week).
 */
export function promoReporting(row, currentPeriod, nowMs) {
  const facts = ceilingFacts(row, currentPeriod);
  if (!facts.issued.known) return { state: 'not_reported', text: 'Missing' };
  const age = ageDays(row.issued_reported_at, nowMs);
  if (age === null) return { state: 'recorded', text: 'Reported' };
  if (row.period === currentPeriod && age > STALE_REPORT_DAYS) return { state: 'stale', text: `Stale · ${age} d` };
  return { state: 'recorded', text: `Current · ${age === 0 ? 'today' : `${age} d`}` };
}

/**
 * Licences that hold no ceiling for the period. For the current quarter that
 * means discounts are allowed (D4855, the owner's option B); for any other
 * period it only means none was set.
 */
export function licencesWithoutCeiling({ coverage, ceilings, period, licenceUid = null }) {
  if (!isReady(coverage) || !coverage.available || !isReady(ceilings) || !ceilings.available) return null;
  const held = new Set((ceilings.items || []).filter((x) => x.period === period).map((x) => x.licence_uid));
  return (coverage.by_licence || [])
    .filter((l) => !held.has(l.licence_uid) && (!licenceUid || l.licence_uid === licenceUid))
    .map((l) => ({ licence_uid: l.licence_uid, name: l.brand_name || l.licence_ref || l.licence_uid }));
}

/* ── streams and the executive summary ───────────────────────────────── */

/** The period's statements, per currency: owed (the claim) and paid (recorded by HQ), with floors named. */
export function statementTotals(periodStatements) {
  if (!isReady(periodStatements) || !periodStatements.available) return null;
  const by = new Map();
  for (const s of periodStatements.items || []) {
    if (s.status === 'void') continue;
    const cur = currencyCode(s.currency) || UNRECORDED_CURRENCY;
    const b = by.get(cur) || { currency: cur, owed: 0, paid: 0, count: 0, floors: 0 };
    b.owed += finite(s.owed_cents) ?? Number.NaN;
    b.paid += finite(s.paid_cents) ?? Number.NaN;
    b.count += 1;
    if (!statementAllowsPaidInFull(s)) b.floors += 1;
    by.set(cur, b);
  }
  return [...by.values()];
}

/**
 * The currencies the summary has something to say about, from the reads that
 * answered: licence fees, refunds and open disputes. Sorted, never merged.
 */
export function summaryCurrencies({ summary, refunds, disputes }) {
  const set = new Set();
  const fees = isReady(summary) ? summary.licence_fees : null;
  if (fees?.available) for (const r of fees.by_currency || []) { const c = currencyCode(r.currency); if (c) set.add(c); }
  if (isReady(refunds) && refunds.available) for (const r of refunds.by_currency || []) { const c = currencyCode(r.currency); if (c) set.add(c); }
  for (const d of openDisputes(disputes) || []) { const c = currencyCode(String(d.currency || '').toUpperCase()); if (c) set.add(c); }
  return [...set].sort();
}

/** One currency's row in the executive summary: run-rate (As of now), refunds (30 days), disputes (Live). */
export function currencyPosition(currency, { summary, refunds, disputes }) {
  const fees = isReady(summary) ? summary.licence_fees : null;
  let runRate;
  if (!isReady(summary)) runRate = { state: pendingState(summary), text: null };
  else if (!fees?.available) runRate = { state: 'unavailable', text: null };
  else {
    const row = (fees.by_currency || []).find((r) => currencyCode(r.currency) === currency);
    runRate = row
      ? { ...moneyFigure(row.quarter_cents, currency, { incomplete: finite(fees.active_without_fee) > 0 }), licences: row.licences }
      : { state: 'zero', text: money(0, currency), licences: 0 };
  }
  let refund;
  if (!isReady(refunds)) refund = { state: pendingState(refunds), text: null };
  else if (!refunds.available) refund = { state: 'unavailable', text: null };
  else {
    const b = (refunds.by_currency || []).find((x) => currencyCode(x.currency) === currency);
    refund = b ? { ...moneyFigure(b.amount_cents, currency), count: b.count } : { state: 'zero', text: money(0, currency), count: 0 };
    if (finite(refunds.unreadable_rows) > 0 && refund.text) refund = { ...refund, state: 'incomplete', text: `${refund.text}+` };
  }
  const open = openDisputes(disputes);
  let dispute;
  if (open === null) dispute = { state: pendingState(disputes), text: null };
  else {
    const mine = open.filter((d) => currencyCode(String(d.currency || '').toUpperCase()) === currency);
    // An amount Stripe sent unreadable leaves the at-risk figure a floor, never a smaller total that looks whole.
    const amounts = mine.map((d) => finite(d.amount));
    const known = amounts.filter((a) => a !== null);
    const atRisk = known.reduce((sum, a) => sum + a, 0);
    dispute = {
      ...countFigure(mine.length),
      atRisk: known.length ? `${money(atRisk, currency)}${known.length < amounts.length ? '+' : ''}` : null,
    };
  }
  return { currency, runRate, refund, dispute };
}

/* ── data coverage (RV11) ────────────────────────────────────────────── */

export const COVERAGE_STATES = Object.freeze({
  complete: { word: 'Complete', shape: 'check', tone: 'positive' },
  live: { word: 'Live', shape: 'check', tone: 'positive' },
  partial: { word: 'Partial', shape: 'triangle', tone: 'attention' },
  not_recorded: { word: 'Not recorded', shape: 'dash', tone: 'neutral' },
  not_reported: { word: 'Not reported', shape: 'dotted-ring', tone: 'neutral' },
  stale: { word: 'Stale', shape: 'dashed-ring', tone: 'attention-soft' },
  unavailable: { word: 'Unavailable', shape: 'struck-square', tone: 'negative' },
  loading: { word: 'Loading', shape: 'clock', tone: 'progress' },
});

const failed = (read, what) => (isFailed(read)
  ? { state: 'unavailable', reason: `${what} could not be read. This is not a claim that there is nothing to show.` }
  : { state: 'loading', reason: `Reading ${what.toLowerCase()}…` });

/**
 * Every source the page reads, with its state and one plain reason. Every
 * "why" on the page points here (`#coverage-<key>`), and nowhere else repeats
 * the sentence.
 */
export function coverageSources({ summary, statements, disputes, refunds, ceilings, period }) {
  const label = periodLabel(period) || period;
  const fees = isReady(summary) ? summary.licence_fees : null;
  const token = isReady(summary) ? summary.token_cost : null;
  const usage = isReady(summary) ? summary.usage_coverage : null;
  const out = [];

  // Licence fees, as a contracted run-rate.
  if (!isReady(summary)) out.push({ key: 'licence_fees', name: 'Licence fees (contracted run-rate)', ...failed(summary, 'The revenue summary') });
  else if (!fees?.available) out.push({ key: 'licence_fees', name: 'Licence fees (contracted run-rate)', state: 'unavailable', reason: fees?.reason || 'The licence ledger could not be read.' });
  else {
    const missing = finite(fees.active_without_fee) > 0 ? finite(fees.active_without_fee) : null;
    out.push({
      key: 'licence_fees',
      name: 'Licence fees (contracted run-rate)',
      state: missing ? 'partial' : 'complete',
      reason: `${fees.basis} Computed from the licences active now, whatever the period: a run-rate, never invoiced or collected.`
        + (missing ? ` ${missing === 1 ? '1 active licence records' : `${missing} active licences record`} no annual fee and ${missing === 1 ? 'is' : 'are'} left out.` : ''),
    });
  }

  // D5082: the licence-fee invoice ledger once the Worker sends it. Before that, or while the summary is out, Not recorded.
  const ledger = ledgerPosition(summary);
  if (ledger.state === 'recorded') {
    out.push({ key: 'ledger', name: 'Invoices and payments ledger', state: 'partial', reason: ledgerReason(ledger) });
  } else if (ledger.state === 'unavailable' && isReady(summary)) {
    out.push({ key: 'ledger', name: 'Invoices and payments ledger', state: 'unavailable', reason: `${ledger.reason} This is not a claim that nothing was invoiced.` });
  } else {
    out.push({ key: 'ledger', name: 'Invoices and payments ledger', state: 'not_recorded', reason: LEDGER_REASON });
  }

  // Revenue-share statements.
  if (!isReady(statements)) out.push({ key: 'statements', name: 'Revenue-share statements', ...failed(statements, 'The statement ledger') });
  else if (!statements.available) out.push({ key: 'statements', name: 'Revenue-share statements', state: 'unavailable', reason: statements.reason });
  else {
    const floors = (statements.items || []).filter((s) => s.status !== 'void' && !statementAllowsPaidInFull(s)).length;
    out.push({
      key: 'statements',
      name: 'Revenue-share statements',
      state: floors ? 'partial' : 'complete',
      reason: `${(statements.items || []).length} drawn, newest first. Intercompany claims HQ recorded, not reconciled against a bank and not recognised revenue; no statement records a due date, so none can be called overdue.`
        + (floors ? ` ${floors} ${floors === 1 ? 'is a floor' : 'are floors'}: drawn over unreported or estimated streams.` : '')
        + ' Drawing new statements is held (D514).',
    });
  }

  // Disputes, live from Stripe.
  if (!isReady(disputes)) out.push({ key: 'disputes', name: 'Stripe disputes', ...failed(disputes, 'Open disputes') });
  else out.push({ key: 'disputes', name: 'Stripe disputes', state: 'live', reason: 'Read from Stripe when the page loads; not scoped to the period. Evidence is filed on the Billing tab.' });

  // Refunds HQ issued.
  if (!isReady(refunds)) out.push({ key: 'refunds', name: 'Refunds', ...failed(refunds, 'The refunds HQ issued') });
  else if (!refunds.available) out.push({ key: 'refunds', name: 'Refunds', state: 'unavailable', reason: refunds.reason });
  else {
    const bad = finite(refunds.unreadable_rows) > 0 ? finite(refunds.unreadable_rows) : null;
    out.push({
      key: 'refunds',
      name: 'Refunds',
      state: bad ? 'partial' : 'complete',
      reason: `${refunds.source} The last ${refunds.window_days} days, whatever the period.`
        + (bad ? ` ${bad} audit ${bad === 1 ? 'row' : 'rows'} could not be read and ${bad === 1 ? 'is' : 'are'} not in the total.` : ''),
    });
  }

  // AI cost and AI margin: two failure domains.
  if (!isReady(summary)) {
    out.push({ key: 'ai_cost', name: 'AI cost', ...failed(summary, 'The revenue summary') });
    out.push({ key: 'ai_margin', name: 'AI margin', ...failed(summary, 'The revenue summary') });
  } else {
    const v = tokenMarginView(token);
    out.push(token?.available
      ? { key: 'ai_cost', name: 'AI cost', state: 'complete', reason: `The AI usage log, at cost, for ${label}. USD.` }
      : { key: 'ai_cost', name: 'AI cost', state: 'unavailable', reason: v.reason });
    if (v.state === 'ok') {
      out.push({
        key: 'ai_margin', name: 'AI margin', state: v.partial ? 'partial' : 'complete',
        reason: `Top-up spend, less its share of the cost, less tokens HQ gave. Included-plan usage is not revenue here; admin-licence runs are left out.${v.coverage ? ` ${v.coverage}.` : ''}`,
      });
    } else if (v.state === 'predates') out.push({ key: 'ai_margin', name: 'AI margin', state: 'not_recorded', reason: v.reason });
    else out.push({ key: 'ai_margin', name: 'AI margin', state: 'unavailable', reason: v.reason });
  }

  // Subscriptions: a figure the platform cannot produce.
  if (!isReady(summary)) out.push({ key: 'subscriptions', name: 'Subscription revenue', ...failed(summary, 'The revenue summary') });
  else out.push({ key: 'subscriptions', name: 'Subscription revenue', state: 'not_recorded', reason: summary.subscriptions_reason });

  // Subsidiary reports.
  if (!isReady(summary)) out.push({ key: 'subsidiaries', name: 'Subsidiary reports', ...failed(summary, 'The revenue summary') });
  else if (!usage?.available) out.push({ key: 'subsidiaries', name: 'Subsidiary reports', state: 'unavailable', reason: usage?.reason || 'The subsidiary usage reports could not be read.' });
  else {
    const all = usage.by_licence || [];
    const got = all.filter((l) => l.reported).length;
    out.push({
      key: 'subsidiaries',
      name: 'Subsidiary reports',
      state: all.length && got === all.length ? 'complete' : (got ? 'partial' : 'not_reported'),
      reason: `${got} of ${all.length} ${all.length === 1 ? 'subsidiary' : 'subsidiaries'} reported ${periodLabel(usage.period) || usage.period}. ${usage.revenue_reason} Token P&L per subsidiary is not recorded either: ${summary.token_pl_per_subsidiary_reason}`,
    });
  }

  // Promotion issued amounts, for the period.
  if (!isReady(ceilings)) out.push({ key: 'promotions', name: 'Promotion issued amounts', ...failed(ceilings, 'The promotion ceilings') });
  else if (!ceilings.available) out.push({ key: 'promotions', name: 'Promotion issued amounts', state: 'unavailable', reason: ceilings.reason });
  else {
    const rows = (ceilings.items || []).filter((x) => x.period === period);
    const known = rows.filter((x) => ceilingFacts(x, ceilings.current_period).issued.known).length;
    out.push({
      key: 'promotions',
      name: 'Promotion issued amounts',
      state: !rows.length || known === rows.length ? 'complete' : (known ? 'partial' : 'not_reported'),
      reason: (rows.length ? `${known} of ${rows.length} ${rows.length === 1 ? 'branch' : 'branches'} reported what ${rows.length === 1 ? 'it' : 'they'} issued against ${label}'s ceiling.` : `No ceiling is set for ${label}.`)
        + ' The branch counts what it gives and enforces the ceiling itself; HQ\'s copy is only what a branch reports, so Remaining is shown only beside a reported Issued figure. "Enforced" is read from an accepted push: branches do not report enforcement back.'
        + (isReady(summary) && summary.promos?.available ? ` ${summary.promos.budget_reason}` : ''),
    });
  }

  return out;
}

/** "N of M sources complete": a live read counts as complete, a loading one does not. */
export function coverageCount(sources) {
  const total = sources.length;
  const complete = sources.filter((s) => s.state === 'complete' || s.state === 'live').length;
  const loading = sources.filter((s) => s.state === 'loading').length;
  const partial = sources.filter((s) => s.state === 'partial' || s.state === 'stale').length;
  const missing = total - complete - loading - partial;
  return { total, complete, loading, partial, missing, label: `${complete} of ${total} sources complete` };
}

/* ── needs attention ─────────────────────────────────────────────────── */

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/**
 * Only what the reads can show needs action. Nothing is a guess: a dispute's
 * deadline is Stripe's, a dispute on a statement is HQ's own entry, an unpushed
 * ceiling is the push record, a missing fee is the ledger and a missing or
 * stale report is the usage-report store. An empty list draws nothing.
 */
export function attentionItems({ summary, statements, disputes, ceilings, period, currentPeriod, nowMs, licenceUid = null }) {
  const items = [];
  const nowSec = Math.floor(nowMs / 1000);
  for (const d of openDisputes(disputes) || []) {
    const cur = String(d.currency || '').toUpperCase();
    if (evidenceOverdue(d, nowSec)) {
      items.push({
        key: `dispute-overdue:${d.id}`, severity: 'critical', title: 'Dispute evidence is past its deadline',
        detail: `${d.id}${d.reason ? ` · ${String(d.reason).replace(/_/g, ' ')}` : ''}`, amount: money(d.amount, cur),
        action: { kind: 'link', to: `/admin/revenue/disputes/${encodeURIComponent(d.id)}`, label: 'Review dispute' },
      });
    } else if (evidenceDueSoon(d, nowSec)) {
      items.push({
        key: `dispute-due:${d.id}`, severity: 'warning', title: `Dispute evidence due ${new Date(Number(d.due_by) * 1000).toISOString().slice(0, 10)}`,
        detail: `${d.id}${d.reason ? ` · ${String(d.reason).replace(/_/g, ' ')}` : ''}`, amount: money(d.amount, cur),
        action: { kind: 'link', to: `/admin/revenue/disputes/${encodeURIComponent(d.id)}`, label: 'Review dispute' },
      });
    }
  }
  if (isReady(statements) && statements.available) {
    for (const s of statements.items || []) {
      if (licenceUid && s.licence_uid !== licenceUid) continue;
      if (receivableStatus(s) !== 'disputed') continue;
      items.push({
        key: `statement-disputed:${s.uid}`, severity: 'warning',
        title: `${s.brand_name || s.licence_ref || s.licence_uid} disputes its ${periodLabel(s.period) || s.period} statement`,
        detail: s.dispute_note || 'The dispute carries no note.', amount: money(s.disputed_cents, s.currency),
        action: { kind: 'statement', uid: s.uid, label: 'Open statement' },
      });
    }
  }
  if (isReady(ceilings) && ceilings.available) {
    for (const x of ceilings.items || []) {
      if (x.period !== currentPeriod) continue;
      if (licenceUid && x.licence_uid !== licenceUid) continue;
      const facts = ceilingFacts(x, ceilings.current_period);
      if (facts.pushed.yes) continue;
      items.push({
        key: `ceiling-unpushed:${x.licence_uid}`, severity: 'warning',
        title: `${x.brand_name || x.licence_ref || x.licence_uid}: promotion ceiling not synced to the branch`,
        detail: `${facts.pushed.label} · ${facts.enforced.label}`, amount: money(x.ceiling_cents, x.currency),
        action: { kind: 'anchor', href: '#revenue-promotions', label: 'Review promotions' },
      });
    }
  }
  const fees = isReady(summary) ? summary.licence_fees : null;
  const missing = fees?.available ? finite(fees.active_without_fee) : null;
  if (missing) {
    items.push({
      key: 'fees-missing', severity: 'warning',
      title: `${missing === 1 ? '1 active licence records' : `${missing} active licences record`} no annual fee`,
      detail: 'Left out of the contracted run-rate until a fee is recorded.', amount: null,
      action: { kind: 'link', to: '/admin/licences', label: 'Open licences' },
    });
  }
  const usage = isReady(summary) ? summary.usage_coverage : null;
  if (usage?.available && period === currentPeriod) {
    for (const l of usage.by_licence || []) {
      if (licenceUid && l.licence_uid !== licenceUid) continue;
      const age = ageDays(l.reported_at, nowMs);
      if (!l.reported) {
        items.push({
          key: `report-missing:${l.licence_uid}`, severity: 'info', title: `${l.brand_name || l.licence_ref}: no report for ${periodLabel(period)}`,
          detail: 'The branch has not reported this quarter to HQ.', amount: null,
          action: { kind: 'anchor', href: '#revenue-subsidiaries', label: 'Review subsidiary' },
        });
      } else if (age !== null && age > STALE_REPORT_DAYS) {
        items.push({
          key: `report-stale:${l.licence_uid}`, severity: 'info', title: `${l.brand_name || l.licence_ref}: report is stale`,
          detail: `Last report ${age} days ago; branches report every morning.`, amount: null,
          action: { kind: 'anchor', href: '#revenue-subsidiaries', label: 'Review subsidiary' },
        });
      }
    }
  }
  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
