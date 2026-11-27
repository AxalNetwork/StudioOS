// D752 §4 (#1988) — "Spending from Mercury": the words and rules of the
// founder's spending sheet, pure, so every state renders in node --test.
//
// The figures are the Worker's (GET /api/revenue/projects/:id/mercury-spend,
// services/mercurySpend.ts): integer cents per month, built per request from
// the founder's own Mercury. Nothing here adds, rounds into, or invents a
// figure. A month with no posted line has no figures and reads Not recorded,
// never $0. Financing in (a credit from an Axal entity or a confirmed raise
// receipt) is printed beside operating money in and is never counted in burn;
// the Worker's net burn already leaves it out. At the 1,000-line read cap the
// sheet is Partial and draws no runway.
//
// A saved snapshot is a `project_metrics` row with source `mercury`: its date
// and figures are locked by the Worker (409 `mercury_figure_locked`), so it is
// badged "From Mercury" and offers delete only.

export { mercuryReadOutcome as spendReadOutcome } from './revenueLedger.js';

/** The read cap the Worker applies (`services/mercuryPersonal.ts` MAX_LINES). */
export const SPEND_LINE_CAP = 1000;
export const SPEND_MONTH_CHOICES = Object.freeze([3, 6, 12]);
export const SPEND_MONTHS_DEFAULT = 6;

export const FINANCING_NOTE = 'not counted in burn';
export const NOT_BURNING = 'Not burning';
export const NO_LINES = 'No posted lines this month, so it has no figures.';
export const PARTIAL_NOTE = `Partial: your Mercury holds more lines than one read covers (${SPEND_LINE_CAP.toLocaleString('en-US')}), so these months may be missing lines. Runway is not shown.`;
export const SHOWN_ONLY_TO_YOU = 'Shown only to you. Saved only when you choose.';
export const INCLUDE_CASH_LABEL = 'Also save my cash on hand';
export const CONFIRM_LABEL = 'I have read who will see the saved figures.';
export const LOCKED_BADGE = 'From Mercury';
export const LOCKED_TITLE = 'Read from your Mercury: its date and figures cannot be edited. Delete it and save a new one.';

const RUNWAY_REASONS = {
  needs_three_months: 'Runway needs three full months of posted lines before this one.',
  cash_not_read: 'Mercury did not give an available balance for your accounts.',
};

/** Integer cents as whole or exact dollars, with a minus sign for a negative figure; null for anything else. */
export function fmtSpendCents(cents) {
  if (!Number.isInteger(cents)) return null;
  const abs = Math.abs(cents);
  const s = (abs / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: abs % 100 ? 2 : 0 });
  return cents < 0 ? `−${s}` : s;
}

/** "2026-09" → "Sep 2026". */
export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return String(key || '');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2 pending, 1 failed, 3 internal": the lines counted but never summed; null when there are none. */
export function skippedLine(lines) {
  const parts = [['pending', 'pending'], ['failed', 'failed'], ['internal', 'internal transfers']]
    .filter(([k]) => Number.isInteger(lines?.[k]) && lines[k] > 0)
    .map(([k, w]) => `${lines[k]} ${w}`);
  return parts.length ? `Not counted: ${parts.join(', ')}.` : null;
}

/**
 * One row per month the Worker listed, newest first. A month without posted
 * lines carries `noLines` and no figures; financing stays its own figure.
 */
export function spendMonthRows(res) {
  const months = Array.isArray(res?.months) ? res.months : [];
  return [...months].reverse().map((m) => {
    const noLines = m?.reason === 'no_lines' || m?.net_burn_cents == null;
    return {
      month: m.month,
      label: `${monthLabel(m.month)}${m.partial ? ' (so far)' : ''}`,
      noLines,
      operatingIn: noLines ? null : fmtSpendCents(m.operating_in_cents),
      financingIn: noLines ? null : fmtSpendCents(m.financing_in_cents),
      out: noLines ? null : fmtSpendCents(m.out_cents),
      netBurn: noLines ? null : fmtSpendCents(m.net_burn_cents),
      skipped: skippedLine(m.lines),
      payees: (Array.isArray(m.top_counterparties) ? m.top_counterparties : []).map((p) => ({
        name: p?.name || null, out: fmtSpendCents(p?.out_cents), lines: Number.isInteger(p?.lines) ? p.lines : null,
      })),
    };
  });
}

/** Cash now: the Worker's figure, or Not recorded with the reason; never $0 for an unread balance. */
export function cashTile(res) {
  const c = res?.cash;
  const unread = Number.isInteger(c?.accounts_unreadable) && c.accounts_unreadable > 0
    ? ` ${c.accounts_unreadable} account${c.accounts_unreadable === 1 ? '' : 's'} gave no balance and ${c.accounts_unreadable === 1 ? 'is' : 'are'} not counted.`
    : '';
  if (!Number.isInteger(c?.cents)) return { value: null, reason: RUNWAY_REASONS.cash_not_read, sub: unread.trim() || null };
  const n = Number.isInteger(c.accounts_counted) ? c.accounts_counted : null;
  return {
    value: fmtSpendCents(c.cents),
    reason: null,
    sub: `${c.as_of ? `On ${c.as_of}` : 'Now'}${n != null ? `, across ${n} account${n === 1 ? '' : 's'}` : ''}.${unread}`,
  };
}

/**
 * Runway: Partial at the read cap (never a figure then), else the Worker's
 * months, else "Not burning", else Not recorded with the reason.
 */
export function runwayTile(res) {
  const r = res?.runway;
  if (res?.partial === true || r?.reason === 'partial') return { kind: 'partial', value: null, reason: PARTIAL_NOTE };
  const from = Array.isArray(r?.from) && r.from.length ? `From ${r.from.map(monthLabel).join(', ')}.` : null;
  if (typeof r?.months === 'number' && Number.isFinite(r.months)) {
    return { kind: 'months', value: `${r.months} month${r.months === 1 ? '' : 's'}`, reason: null, sub: from };
  }
  if (r?.reason === 'not_burning') return { kind: 'not_burning', value: NOT_BURNING, reason: null, sub: from };
  return { kind: 'not_recorded', value: null, reason: RUNWAY_REASONS[r?.reason] || 'The runway could not be worked out from this read.' };
}

/** "3 lines could not be read and are not counted."; null when every line was read. */
export function unreadableLine(res) {
  const n = res?.unreadable_lines;
  return Number.isInteger(n) && n > 0 ? `${n} line${n === 1 ? '' : 's'} could not be read and ${n === 1 ? 'is' : 'are'} not counted.` : null;
}

/** The save form's starting state: cash off, nothing confirmed. */
export const SAVE_START = Object.freeze({ includeCash: false, confirmed: false });

/** The save's options, or null when the founder has not confirmed who reads saved figures: then nothing is sent. */
export function snapshotRequest(form) {
  if (form?.confirmed !== true) return null;
  return { include_cash: form.includeCash === true };
}

/** A refusal as the Worker wrote it (`visibility_confirm_required`, `mercury_figure_locked`, …), else our sentence. */
export function saveRefusal(err) {
  if (err && typeof err.message === 'string' && err.message && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return err.message;
  return 'The figures could not be saved. Nothing was saved. Try again.';
}

/** "Saved Sep 2026's net burn of $12,000 to Grow." with cash when it was saved. */
export function savedLine(res) {
  if (!res || typeof res !== 'object') return '';
  const dollars = (v) => (typeof v === 'number' && Number.isFinite(v) ? fmtSpendCents(Math.round(v * 100)) : null);
  const burn = dollars(res.net_burn);
  const cash = dollars(res.cash_balance);
  return `Saved ${monthLabel(res.month)}'s net burn${burn ? ` of ${burn}` : ''}${cash ? ` and cash on hand of ${cash}` : ''} to Grow, marked ${LOCKED_BADGE}.`;
}

/** Whether a metrics row was read from Mercury, so its figures are locked. */
export const isMercuryRow = (row) => String(row?.source ?? '').trim().toLowerCase() === 'mercury';

