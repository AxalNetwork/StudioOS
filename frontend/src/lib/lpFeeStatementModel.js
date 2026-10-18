/**
 * D717 decision 13 (#1859) — an LP's issued management fee statement, as the
 * LP workspace draws it (L12, "Management fee statement · LP view").
 *
 * The rows come from `figures`, the frozen `mgmt_fee_statement/1` the Worker
 * builds from `statementFor` (`services/fundFees.ts`). Nothing here reads
 * `pay_to` beyond its sentence, `remittance`, `reference_code` or
 * `funding_call_line`: nothing on this statement is paid by the LP, so no
 * account is shown on it. An absent figure is `null`, never 0.
 *
 * Rates go through `bps.js` and cents through `formatCents`, so neither is
 * formatted a second time here.
 */
import { bpsPercent } from './bps.js';
import { formatCents } from '../pages/investor/fundCallsModel.js';

/** The Worker's `pay_to.sentence` and D716's `NOTICE_SENTENCES.nothingDue`; a test reads both back. */
export const NOTHING_DUE = 'Nothing is due from you against this statement.';

/** The two bases `statementFor` writes. `net_invested_share` takes the paper notice's label. */
export const BASIS_LABELS = {
  committed: 'Committed capital',
  net_invested_share: 'Share of net invested capital',
};

export function isReadableStatement(figures) {
  return !!figures && typeof figures === 'object' && typeof figures.schema === 'string'
    && figures.schema.startsWith('mgmt_fee_statement/');
}

const present = (v) => v != null && v !== '';

/** The header: eyebrow (the fund), title, and "Quarter · days · LP no." with absent parts left out. */
export function feeStatementHeader(statement, fundName) {
  const f = statement?.figures || {};
  const eyebrow = f.fund?.name || fundName || null;
  const lpId = f.lp?.id ?? statement?.limited_partner_id ?? null;
  const parts = [
    present(f.quarter) ? `Quarter ${f.quarter}` : null,
    present(f.window?.days) ? `${f.window.days} days` : null,
    present(lpId) ? `LP no. L${lpId}` : null,
  ].filter(Boolean);
  return { eyebrow, title: 'Management Fee Statement', line: parts.join(' · ') };
}

/**
 * The rows, in the canvas's order, each `{ key, label, value, strong }`.
 * `value` is null when the figure is absent; the view draws that as Not recorded.
 */
export function feeStatementRows(figures) {
  const f = figures || {};
  const basis = Array.isArray(f.basis) ? f.basis : [];
  const two = basis.length > 1;
  const rows = [];
  if (basis.length === 0) {
    rows.push({ key: 'basis', label: 'Basis', value: null, strong: false });
  }
  basis.forEach((b, i) => {
    const label = BASIS_LABELS[b?.basis] || null;
    rows.push({ key: `basis-${i}`, label: 'Basis', value: label && two ? `${label} · ${b.days} days` : label, strong: false });
  });
  const rate = bpsPercent(f.rate_bps);
  rows.push({ key: 'rate', label: 'Rate', value: rate ? `${rate} a year` : null, strong: false });
  if (basis.length === 0) {
    rows.push({ key: 'your-basis', label: 'Your basis', value: null, strong: false });
  }
  basis.forEach((b, i) => {
    rows.push({ key: `your-basis-${i}`, label: 'Your basis', value: formatCents(b?.cents), strong: false });
  });
  rows.push({ key: 'gross', label: 'Fee for the period', value: formatCents(f.gross_fee_cents), strong: false });
  if (Number.isSafeInteger(f.catch_up_cents) && f.catch_up_cents > 0) {
    rows.push({ key: 'catch-up', label: `Catch-up (${f.catch_up_days} days)`, value: formatCents(f.catch_up_cents), strong: false });
  }
  const offset = formatCents(f.offset_cents);
  rows.push({ key: 'offset', label: 'Offset for portfolio fees', value: offset == null ? null : `(${offset})`, strong: false });
  rows.push({ key: 'net', label: 'Your share', value: formatCents(f.net_fee_cents), strong: true });
  return rows;
}

/**
 * The statements section's list, newest first as the Worker orders it.
 * `unreadable` when the read failed; `none` when it succeeded with no rows.
 */
export function feeStatementList(portal) {
  if (!portal || portal.fee_statements_recorded === false || !Array.isArray(portal.fee_statements)) {
    return { state: 'unreadable', items: [] };
  }
  const items = portal.fee_statements.map((s) => ({
    uid: s.uid,
    label: `${s.period_label || s.figures?.quarter || 'Statement'} · issued ${String(s.issued_at || '').slice(0, 10) || 'date not recorded'}`,
    net: formatCents(s.figures?.net_fee_cents),
    corrects: s.corrects_draft_id != null,
    statement: s,
  }));
  return { state: items.length ? 'some' : 'none', items };
}
