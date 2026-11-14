/**
 * D716 (#1860) — the LP's notices on the LP workspace: what each list row and
 * detail says, which tables they draw, and when the phone check is offered.
 * Pure: no React, no DOM, no fetch, so a Node test can hold it.
 *
 * The notice is the record as issued. Its figures are frozen, already
 * formatted strings ("$250.00"), and are never re-parsed or re-added here.
 * The payment block is drawn through `paymentRows`, a whitelist of its lines
 * and its reference: no other key the record holds, or may gain, is drawn.
 * `notices.js` beside this file is the compliance ladder's vocabulary, not this.
 */
import { formatCents } from '../pages/investor/fundCallsModel.js';

/** S1's named defaults for the gaps the canvas leaves (#1860 decisions 3 to 8). */
export const NOTICE_COPY = {
  listLabel: 'My notices',
  listNote: 'Notices addressed to you',
  empty: 'No notice has been issued to you yet.',
  opening: 'Opening…',
  supersededPill: 'Superseded',
  changed: 'The payment instructions on this notice have changed since it was issued. Before you send money, call Axal on a number you already hold.',
  superseded: 'A later notice replaced this one. Use the newest notice for this call.',
  paid: 'The general partner has recorded this call as paid.',
  noDueDate: 'No due date set',
  amountDue: 'Amount due',
  wireLabel: 'Wire instructions',
  asIssued: (date) => `As issued on ${date}.`,
  noticeDate: (date) => `Notice date ${date}`,
  pdfLine: 'The PDF is the notice as issued, with its full text.',
  goToCommitment: 'Go to My commitment',
  hide: 'Hide wire instructions',
  pdf: 'PDF',
  pdfBusy: 'PDF…',
  back: 'Back to my notices',
  downloadPdf: 'Download the notice PDF',
};

const CALL = 'capital_call_notice';
const DEFAULT = 'default_notice';

/** One list row: the title, the sub-line and the amount (decision 3). */
export function rowText(n) {
  const title = n?.type === CALL && n.call_number ? `Capital Call No. ${n.call_number}` : (n?.title || 'Notice');
  const dated = `Dated ${n?.notice_date || 'not recorded'}`;
  let sub = dated;
  if (n?.type === CALL) sub = `${n.due_date ? `Due ${n.due_date}` : NOTICE_COPY.noDueDate} · ${dated}`;
  else if (n?.type === DEFAULT && n.due_date) sub = `Cure by ${n.due_date} · ${dated}`;
  return { title, sub, amount: formatCents(n?.amount_cents) };
}

const lpLine = (n) => (n?.limited_partner_id != null ? `LP no. L${n.limited_partner_id}` : null);

/** A capital-call notice's head: the top bar, the amount and the due line (decision 4). */
export function callHead(n) {
  const lp = lpLine(n);
  const due = n?.due_date ? `Due ${n.due_date}` : NOTICE_COPY.noDueDate;
  return {
    topLabel: n?.call_number ? `Capital Call No. ${n.call_number}` : (n?.title || 'Capital Call Notice'),
    amount: formatCents(n?.amount_cents),
    dueLine: lp ? `${due} · ${lp}` : due,
  };
}

/** Any other notice's head (decision 5). */
export function genericHead(n) {
  return { topLabel: n?.title || 'Notice', lpLine: lpLine(n) };
}

/**
 * A frozen table as rows (decision 6): every cell but the last is the label,
 * joined by " · "; the last is the value. A `total` table bolds its last row.
 */
export function tableRows(table) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  return rows.map((cells, i) => {
    const list = Array.isArray(cells) ? cells.map((c) => (c == null ? '' : String(c))) : [];
    return {
      label: list.slice(0, -1).join(' · '),
      value: list.length ? list[list.length - 1] : '',
      total: !!table?.total && i === rows.length - 1,
    };
  });
}

/** The key figures as rows (decision 5). */
export function keyFigureRows(figures) {
  const list = Array.isArray(figures?.key_figures) ? figures.key_figures : [];
  return list.map((k) => ({ label: String(k?.label ?? ''), value: String(k?.value ?? ''), mono: !!k?.mono }));
}

/**
 * The frozen payment block, by whitelist (decision 7): its `lines` and its
 * `reference`, nothing else — not `account_uid`, not `account_last4` alone.
 */
export function paymentRows(payment) {
  if (!payment || typeof payment !== 'object' || !Array.isArray(payment.lines)) return [];
  const rows = payment.lines
    .filter((l) => l && typeof l.label === 'string' && typeof l.value === 'string')
    .map((l) => ({ label: l.label, value: l.value, mono: !!l.mono }));
  if (typeof payment.reference === 'string' && payment.reference) rows.push({ label: 'Reference', value: payment.reference, mono: true });
  return rows;
}

/** The call line a notice was issued from, or null. */
export function callLineId(figures) {
  const m = /^call_line:(\d+)$/.exec(String(figures?.source_ref || ''));
  return m ? Number(m[1]) : null;
}

/** True only when that line is on the portal and the GP recorded it paid. */
export function lineSettled(portal, figures) {
  const id = callLineId(figures);
  if (id == null || !Array.isArray(portal?.capital_calls)) return false;
  return portal.capital_calls.some((c) => Number(c?.id) === id && c?.status === 'paid');
}

/**
 * Whether the phone check is offered (decision 8), in this order: no payment
 * block; a refused block; superseded; changed instructions; a paid line.
 * The PDF stays available in every case.
 */
export function instructionsOffer(notice, portal) {
  const payment = notice?.figures?.payment;
  if (!payment) return { offer: false, reason: 'no_payment', sentence: null };
  if (payment.refusal) return { offer: false, reason: 'refused', sentence: String(payment.refusal) };
  if (notice.superseded) return { offer: false, reason: 'superseded', sentence: NOTICE_COPY.superseded };
  if (notice.instructions_changed) return { offer: false, reason: 'changed', sentence: NOTICE_COPY.changed };
  if (lineSettled(portal, notice.figures)) return { offer: false, reason: 'paid', sentence: NOTICE_COPY.paid };
  return { offer: true };
}

export function initialGate() {
  return { ticked: false, shown: false };
}

/** The gate: `show` only once ticked; unticking also closes the block. */
export function gateReducer(state, action) {
  switch (action?.type) {
    case 'tick':
      if (action.value === true) return state.ticked ? state : { ...state, ticked: true };
      if (action.value === false) return state.ticked || state.shown ? { ticked: false, shown: false } : state;
      return state;
    case 'show':
      return state.ticked && !state.shown ? { ...state, shown: true } : state;
    case 'hide':
      return state.shown ? { ...state, shown: false } : state;
    case 'reset':
      return state.ticked || state.shown ? initialGate() : state;
    default:
      return state;
  }
}
