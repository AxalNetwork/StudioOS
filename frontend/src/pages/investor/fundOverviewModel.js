/**
 * #6234 (D6234) — the Fund overview's tiles, quarterly series and gap list,
 * and the quarterly history's rows and CSV. Pure: no React, no fetch, no clock
 * (the caller passes `today`), so a Node test holds every rule.
 *
 * Sources, both on main: `GET /api/funds/analytics` (one rollup row per fund,
 * integer cents) for the four live tiles, and `GET /api/funds/:id/report-periods`
 * for the series. A period row carries `status` (draft | issued), `issued_at`,
 * `narrative` (the parsed notes) and `snapshot` (the parsed `snapshot_json`,
 * which the Worker returns raw beside it). The snapshot is one of two shapes:
 *
 *   · issued by the GP of record (`saveFundPeriod`): `readFundPage`'s answer,
 *     whose `totals` hold `committed_cents` and `invested_cents`, each with a
 *     reason when null. It carries no called, collected or NAV figure.
 *   · issued through the reporting queue: the pack's `lp_quarterly_report/1`
 *     figures, whose `totals` are `{ cents }` lines (commitments,
 *     called_to_date, receipts_to_date, …) and whose `fund_figures.nav` is a
 *     line or a reason. It carries no deployed figure.
 *
 * A figure a snapshot does not carry is null with the reason, never 0: the
 * chart hatches it and the history table says Not recorded.
 */
import { formatMinor, toMajorString } from '../../lib/money';
import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };

/** The four series the chart draws per issued quarter, in IF0's order. */
export const SERIES = Object.freeze([
  { key: 'committed', label: 'Committed', tone: 'c1' },
  { key: 'called', label: 'Called', tone: 'c2' },
  { key: 'collected', label: 'Collected', tone: 'c3' },
  { key: 'deployed', label: 'Deployed', tone: 'c4' },
]);

export const FILTERS = Object.freeze([
  { value: 'overview', label: 'Overview' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'gaps', label: 'Gaps' },
]);

/** Exact dollars and cents, or null when the amount is not a whole number of cents. */
export const money = (cents) => (cents == null ? null : formatMinor(cents, 'USD'));

const isCents = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const cents = (v) => (isCents(v) ? v : null);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/* ------------------------------------------------------------------ tiles */

/**
 * The four tiles: Committed, Called, Deployed and Dry powder (collected less
 * deployed). Each is `{ key, label, cents, reason, basis }`; a tile whose
 * source is absent has `cents: null` and the reason it is absent.
 */
export function overviewTiles(fund) {
  const f = fund || {};
  const unreadable = f.capital_state === 'unreadable';
  const capitalReason = text(f.capital_reason);
  const committed = cents(f.committed_cents);
  const called = cents(f.called_cents);
  const deployed = cents(f.deployed_cents);
  const collected = cents(f.collected_cents);
  const calledReason = unreadable
    ? (capitalReason || 'The capital-call ledger could not be read.')
    : 'No capital call is recorded on this fund.';
  let dryReason = null;
  if (collected == null) {
    dryReason = `Needs Collected: ${capitalReason || 'no dated capital-call receipt is recorded.'}`;
  } else if (deployed == null) {
    dryReason = 'Needs Deployed: no deployed capital is recorded on the fund.';
  }
  return [
    { key: 'committed', label: 'Committed', cents: committed, basis: 'fund size, or the LP register total',
      reason: committed == null ? 'No commitment is recorded on this fund.' : null },
    { key: 'called', label: 'Called', cents: called, basis: 'sum of capital-call lines',
      reason: called == null ? calledReason : null },
    { key: 'deployed', label: 'Deployed', cents: deployed, basis: 'deployed capital on the fund record',
      reason: deployed == null ? 'No deployed capital is recorded on the fund.' : null },
    { key: 'dry', label: 'Dry powder', cents: dryReason ? null : collected - deployed, basis: 'collected less deployed',
      reason: dryReason },
  ];
}

/* ---------------------------------------------------------------- periods */

const isIssued = (p) => String(p?.status || '').toLowerCase() === 'issued';
const endOf = (p) => (typeof p?.period_end === 'string' ? p.period_end.slice(0, 10) : '');

/** The parsed snapshot object of a period row, `null` when none, or `undefined` when it could not be read. */
export function snapshotOf(period) {
  if (period?.snapshot && typeof period.snapshot === 'object' && !Array.isArray(period.snapshot)) return period.snapshot;
  const raw = period?.snapshot_json;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch { return undefined; }
}

const line = (l, missing) => (l && isCents(l.cents) ? { cents: l.cents, reason: null } : { cents: null, reason: text(l?.reason) || missing });

/**
 * One period's figures: `{ committed, called, collected, deployed, nav }`, each
 * `{ cents, reason }`, plus `source` ('report_pack' | 'issue_snapshot' | null).
 */
export function periodFigures(period) {
  const snap = snapshotOf(period);
  const none = (reason) => ({ cents: null, reason });
  const all = (reason) => ({ source: null, committed: none(reason), called: none(reason), collected: none(reason), deployed: none(reason), nav: none(reason) });
  if (snap === undefined) return all('The frozen snapshot could not be read.');
  if (snap === null) return all(isIssued(period) ? 'No figures were frozen when this period was issued.' : 'A draft freezes no figures until it is issued.');
  const t = snap.totals && typeof snap.totals === 'object' ? snap.totals : {};
  if (snap.schema === 'lp_quarterly_report/1') {
    return {
      source: 'report_pack',
      committed: line(t.commitments, 'The issued pack carries no commitments total.'),
      called: line(t.called_to_date, 'The issued pack carries no called-to-date total.'),
      collected: line(t.receipts_to_date, 'The issued pack carries no receipts total.'),
      deployed: none('The issued pack does not carry deployed capital.'),
      nav: line(snap.fund_figures?.nav, 'The issued pack carries no NAV.'),
    };
  }
  const own = (key, missing) => (isCents(t[`${key}_cents`]) ? { cents: t[`${key}_cents`], reason: null } : none(text(t[`${key}_reason`]) || missing));
  return {
    source: 'issue_snapshot',
    committed: own('committed', 'The snapshot carries no committed total.'),
    called: none('The snapshot frozen at issue does not carry called capital.'),
    collected: none('The snapshot frozen at issue does not carry collected capital.'),
    deployed: own('invested', 'The snapshot carries no invested total.'),
    nav: none('The snapshot frozen at issue does not carry a NAV.'),
  };
}

/** Dry powder of one period: collected less deployed, or null with the reason. */
export function periodDryPowder(fig) {
  if (fig.collected.cents == null) return { cents: null, reason: 'Needs Collected in the snapshot.' };
  if (fig.deployed.cents == null) return { cents: null, reason: 'Needs Deployed in the snapshot.' };
  return { cents: fig.collected.cents - fig.deployed.cents, reason: null };
}

const label = (p) => text(p?.period) || text(p?.label) || `Period ${p?.id ?? ''}`.trim();
const byEnd = (a, b) => endOf(a).localeCompare(endOf(b)) || String(a?.issued_at || '').localeCompare(String(b?.issued_at || '')) || Number(a?.id || 0) - Number(b?.id || 0);

/**
 * The chart's groups: ISSUED periods only, oldest first. A draft never plots.
 * Each bar is `{ key, label, cents, hatched, reason }`; a figure the snapshot
 * lacks is `hatched` with `cents: null` — never a zero-height bar.
 */
export function chartGroups(periods) {
  return (Array.isArray(periods) ? periods : [])
    .filter(isIssued)
    .slice()
    .sort(byEnd)
    .map((p) => {
      const fig = periodFigures(p);
      return {
        id: p.id,
        label: label(p),
        issuedOn: typeof p.issued_at === 'string' ? p.issued_at.slice(0, 10) : null,
        bars: SERIES.map((s) => ({ key: s.key, label: s.label, cents: fig[s.key].cents, hatched: fig[s.key].cents == null, reason: fig[s.key].reason })),
      };
    });
}

/** Every period, drafts included, newest first, with its figures. */
export function historyRows(periods) {
  return (Array.isArray(periods) ? periods : [])
    .slice()
    .sort((a, b) => byEnd(b, a))
    .map((p) => {
      const fig = periodFigures(p);
      return {
        id: p.id,
        label: label(p),
        status: isIssued(p) ? 'issued' : 'draft',
        periodStart: typeof p.period_start === 'string' ? p.period_start.slice(0, 10) : null,
        periodEnd: endOf(p) || null,
        issuedOn: isIssued(p) && typeof p.issued_at === 'string' ? p.issued_at.slice(0, 10) : null,
        figures: fig,
        dry: periodDryPowder(fig),
      };
    });
}

export const CSV_HEADER = Object.freeze(['period', 'period_start', 'period_end', 'status', 'issued_on', 'snapshot_source',
  'committed_usd', 'called_usd', 'collected_usd', 'deployed_usd', 'dry_powder_usd', 'nav_usd']);

/** The series as CSV rows: exact dollars from integer cents; a figure not recorded is an empty cell, never 0. */
export function historyCsvRows(rows) {
  const usd = (c) => (c == null ? null : toMajorString(c, 'USD'));
  return (Array.isArray(rows) ? rows : []).map((r) => [
    r.label, r.periodStart, r.periodEnd, r.status, r.issuedOn, r.figures.source,
    usd(r.figures.committed.cents), usd(r.figures.called.cents), usd(r.figures.collected.cents),
    usd(r.figures.deployed.cents), usd(r.dry.cents), usd(r.figures.nav.cents),
  ]);
}

/* ------------------------------------------------------------------- gaps */

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * The quarter the next pack reports on: the last calendar quarter that has
 * ended on or before `today` (a quarter's pack cannot be issued before it
 * closes). `{ label, start, end }`, dates as YYYY-MM-DD in UTC.
 */
export function reportingQuarter(today) {
  const d = today instanceof Date ? today : new Date(today);
  if (!Number.isFinite(d.getTime())) return null;
  let q = Math.floor(d.getUTCMonth() / 3) - 1;
  let y = d.getUTCFullYear();
  if (q < 0) { q = 3; y -= 1; }
  const start = new Date(Date.UTC(y, q * 3, 1));
  const end = new Date(Date.UTC(y, q * 3 + 3, 0));
  return { label: `Q${q + 1} ${y}`, start: iso(start), end: iso(end) };
}

const inQuarter = (p, q) => { const e = endOf(p); return !!e && e >= q.start && e <= q.end; };
const letterOf = (p) => {
  let n = p?.narrative;
  if (!n && typeof p?.notes === 'string') { try { n = JSON.parse(p.notes); } catch { n = null; } }
  const letter = n && typeof n === 'object' ? n.letter : null;
  return Array.isArray(letter) && letter.some((x) => typeof x === 'string' && x.trim());
};
// D6240: a reply that carries per-LP counts is recorded only when they are; a period issued before them is not.
const deliveryRecorded = (p) => (p?.lp_delivery && typeof p.lp_delivery === 'object'
  ? p.lp_delivery.state === 'recorded'
  : p?.delivery_count != null || p?.delivered_count != null || p?.delivery_status != null || p?.delivered_at != null);

/** `/funds/<zone>?fund=<id>`, or the period editor of one period. */
export const zoneHref = (zone, fundId) => (fundId == null || fundId === '' ? `/funds/${zone}` : `/funds/${zone}?fund=${encodeURIComponent(String(fundId))}`);
export const periodHref = (fundId, periodId) => `/funds/${encodeURIComponent(String(fundId))}/reporting/${encodeURIComponent(String(periodId))}`;

/**
 * What the next pack still lacks, computed from the period records. Four rows,
 * each `{ key, label, done, detail, href, action }`; an open row links to where
 * it is fixed. `periods` null means the archive could not be read: no row is
 * claimed done or open then, and the caller says Unreadable.
 */
export function packGaps({ fundId, periods, today }) {
  const q = reportingQuarter(today);
  if (!q || !Array.isArray(periods)) return { quarter: q, rows: null };
  const mine = periods.filter((p) => inQuarter(p, q)).sort(byEnd);
  const issued = mine.filter(isIssued);
  const latestIssued = issued[issued.length - 1] || null;
  const drafts = mine.filter((p) => !isIssued(p));
  const draft = drafts[drafts.length - 1] || null;
  const subject = latestIssued || draft;
  const reporting = zoneHref('reporting', fundId);

  const issuedRow = latestIssued
    ? { done: true, detail: `${q.label} issued${latestIssued.issued_at ? ` on ${String(latestIssued.issued_at).slice(0, 10)}` : ''}.` }
    : draft
      ? { done: false, detail: `${q.label} is drafted, not issued. LPs read issued periods only.`, href: periodHref(fundId, draft.id), action: `Open the ${q.label} draft` }
      : { done: false, detail: `No period is recorded for ${q.label}.`, href: reporting, action: 'Open Reporting' };

  const nav = latestIssued ? periodFigures(latestIssued).nav : null;
  const navRow = !latestIssued
    ? { done: false, detail: `No issued snapshot for ${q.label} carries a NAV.`, href: zoneHref('ledger', fundId), action: 'Open the Ledger' }
    : nav.cents != null
      ? { done: true, detail: `NAV ${money(nav.cents)} in the ${q.label} snapshot.` }
      : { done: false, detail: nav.reason, href: zoneHref('ledger', fundId), action: 'Open the Ledger' };

  const letterRow = subject && letterOf(subject)
    ? { done: true, detail: `The ${q.label} letter is written.` }
    : subject
      ? { done: false, detail: `The ${q.label} period has no letter. A pack stays a draft until it does.`, href: periodHref(fundId, subject.id), action: 'Write the letter' }
      : { done: false, detail: `No ${q.label} period to write a letter in.`, href: reporting, action: 'Open Reporting' };

  const deliveryRow = latestIssued && deliveryRecorded(latestIssued)
    ? { done: true, detail: `Delivery of ${q.label} is recorded.` }
    : latestIssued
      ? { done: false, detail: `Issued is not delivered: no delivery of ${q.label} is recorded.`, href: reporting, action: 'Open Reporting' }
      : { done: false, detail: `Nothing for ${q.label} is issued, so nothing is delivered.`, href: reporting, action: 'Open Reporting' };

  return {
    quarter: q,
    rows: [
      { key: 'issued', label: `An issued snapshot for ${q.label}`, ...issuedRow },
      { key: 'nav', label: 'NAV present', ...navRow },
      { key: 'letter', label: 'Letter written', ...letterRow },
      { key: 'delivery', label: 'Delivery recorded', ...deliveryRow },
    ],
  };
}

/** The reporting quarter's periods, newest first, for the This quarter view. */
export function quarterRows(periods, today) {
  const q = reportingQuarter(today);
  if (!q || !Array.isArray(periods)) return [];
  return historyRows(periods.filter((p) => inQuarter(p, q)));
}
