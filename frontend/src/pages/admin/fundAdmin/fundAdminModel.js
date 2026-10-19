/**
 * D714 (#1779) PR 4a — the fund administration console's tabs and words.
 *
 * The console draws every control from the Worker's act table
 * (`GET /api/fund-admin/access`); this file holds only what does not come
 * from a read: the tab order, the sentences the console says itself, and the
 * money and state helpers its tabs share.
 */
import { formatCents } from '../../investor/fundCallsModel.js';

/** Decision 7's tabs, in order. `?tab=` picks one; anything else is Overview. */
export const TABS = Object.freeze([
  { key: 'overview', label: 'Overview' },
  { key: 'banking', label: 'Banking' },
  { key: 'reconciliation', label: 'Reconciliation' },
  { key: 'calls', label: 'Capital calls' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'fees', label: 'Management fees' },
  { key: 'reports', label: 'Reports' },
]);

export function tabFrom(value) {
  return TABS.some((t) => t.key === value) ? value : 'overview';
}

/**
 * The canvas's amber count flags on the tabs, from the overview only: overdue
 * call lines on Capital calls, matches to review on Reconciliation, prepared
 * drafts on Reports. A block that is not `ok` flags nothing, never a zero it
 * did not read.
 */
export function tabFlags(overview) {
  const sum = (block, f) => (block?.state === 'ok' && Array.isArray(block.items)
    ? block.items.reduce((n, x) => n + (Number.isSafeInteger(Number(f(x))) ? Number(f(x)) : 0), 0) : 0);
  return {
    calls: sum(overview?.funds, (f) => f.overdue_lines),
    reconciliation: sum(overview?.matches, (m) => Number(m.proposed || 0) + Number(m.needs_review || 0)),
    reports: sum(overview?.drafts, (d) => d.prepared),
  };
}

export const HQ_ONLY = 'Fund administration runs on HQ. Axal’s funds and entity accounts are not administered from a branch.';
export const PAYMENT_INSTRUCTIONS_ADMIN = 'Only the Super Admin can see or change payment instructions.';
export const PAYMENT_INSTRUCTIONS_LINK = { text: 'Payment instructions', href: '/admin?tab=bank-accounts' };
export const NO_FUND = 'No administered fund is recorded. A fund whose general partner of record is an outside GP is run from its own fund page.';
export const REJECT_REASON_MIN = 10;

/** Integer cents as dollars, or null for a value that is not a whole number of cents. */
export const money = (cents) => formatCents(cents);

/**
 * `{ cents, reason }` from `/api/admin/mercury/accounts` as a phrase: the
 * amount, "Unreadable" for a read that failed, else "Not recorded". Never 0.
 */
export function balanceText(value) {
  if (value && value.cents != null) return money(value.cents) ?? 'Not recorded';
  return value?.reason === 'unreadable' ? 'Unreadable' : 'Not recorded';
}

/** An account by its last four only. */
export const ending = (lastFour) => (lastFour ? `ending ${lastFour}` : 'ending not recorded');

/** The act table's row for `act`, or null. */
export function actRow(access, act) {
  return Array.isArray(access?.acts) ? access.acts.find((a) => a?.act === act) || null : null;
}

/** The administered funds the overview's funds block lists, as `{ id, name }`. */
export function administeredFunds(overview) {
  const items = overview?.funds?.state === 'ok' && Array.isArray(overview.funds.items) ? overview.funds.items : [];
  return items.map((f) => ({ id: Number(f.fund_id), name: f.name || `Fund #${f.fund_id}` }));
}

/** The fund `?fund=` names among `funds`, else the first. */
export function pickFund(funds, wanted) {
  if (!Array.isArray(funds) || funds.length === 0) return null;
  return funds.find((f) => String(f.id) === String(wanted ?? '')) || funds[0];
}

/** A quarter as #1774 writes it: `2026Q3`. */
export const QUARTER_RE = /^\d{4}Q[1-4]$/;

/**
 * D749 (#1838): why a credit is not ours, as `[key, label]` in the Worker's
 * order (`services/mercury/notOurs.ts`). The canvas may rename a label; the
 * keys stay.
 */
export const NOT_OURS_REASONS = Object.freeze([
  ['not_fund_transaction', 'Not a fund transaction'],
  ['other_entity', 'Belongs to another entity'],
  ['duplicate', 'Duplicate'],
  ['other', 'Other'],
]);
export const NOT_OURS_NOTE_MAX = 500;

/** A mark as a pill: "Not ours · Duplicate", or "Not ours · needs review" after the line changed. */
export function notOursText(mark) {
  if (!mark) return null;
  if (mark.state === 'needs_review') return 'Not ours · needs review';
  const label = NOT_OURS_REASONS.find(([k]) => k === mark.reason)?.[1];
  return label ? `Not ours · ${label}` : 'Not ours';
}

/** A refusal's own sentence, else the fallback. */
export function refusalText(e, fallback) {
  const msg = typeof e?.message === 'string' ? e.message.trim() : '';
  return msg || fallback;
}
