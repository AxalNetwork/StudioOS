/**
 * D634 (#1392) — the words of three HQ review screens, from the Ops canvas
 * (`design/canvases/integrated/ops-data.js`: `hq-comments`, `hq-dispute`,
 * `hq-sensitive`). Written once here; the components and the tests read them.
 *
 * Pure: no React, no I/O.
 */

export const COMMENT_DELETE_CONFIRM = {
  title: 'Delete this comment?',
  body: 'The author loses it too. This cannot be undone. To keep it on record, resolve it instead.',
};

export const COMMENTS = {
  empty: 'No comments on this article.',
  unread: 'Comments could not be read just now.',
  nrSection: 'Not recorded: this comment is not anchored to a section.',
};

export const DISPUTE = {
  sub: 'Read live from Stripe each time this page opens. Nothing here is stored on the platform.',
  notConfigured: { title: 'Stripe is not configured', body: 'No Stripe key is set for this tenant. Disputes cannot be read until one is.' },
  unreadable: { title: 'Stripe could not be read', body: 'The request failed or timed out. Nothing is cached; try again.' },
  nrDue: 'Not recorded: Stripe returned no due date for this dispute.',
  noEvidence: 'No evidence has been sent for this dispute.',
};

export const SENSITIVE = {
  line: 'Sensitive fields are masked by default. Each showing is logged with your name and the time.',
  nrTaxIdKyc: 'Not recorded: the KYC form does not ask for a tax ID.',
  nrNotSubmitted: 'Not recorded: the member did not submit this.',
  nrEin: 'Not recorded: the partner did not give a tax ID.',
};

/** Stripe's dispute statuses, as words. An unknown one is printed as Stripe sent it. */
export const DISPUTE_STATUS = {
  warning_needs_response: 'Needs response (inquiry)',
  warning_under_review: 'Under review (inquiry)',
  warning_closed: 'Closed (inquiry)',
  needs_response: 'Needs response',
  under_review: 'Under review',
  won: 'Won',
  lost: 'Lost',
};

/** Minor units as money, to the cent, with the ISO code beside it: "€1,200.00 EUR". */
export function disputeMoney(amount, currency) {
  // A missing amount is not zero.
  if (amount === null || amount === undefined || amount === '') return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const code = String(currency || '').toUpperCase();
  try {
    const f = new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, minimumFractionDigits: 2 }).format(n / 100);
    // A code Intl has no symbol for comes back printed as the code: say it once.
    return f.includes(code) ? f : `${f} ${code}`;
  } catch {
    return `${(n / 100).toFixed(2)} ${code}`;
  }
}

/** A Stripe epoch (seconds) as "19 Oct 2026", in UTC; null when absent. */
export function stripeDate(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** An ISO time as "12 Oct 2026, 09:41" (UTC). */
export function shownWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`;
}

/** Which dispute state a failed read is: not configured, or could not be read. */
export function disputeReadFailure(e) {
  return e?.code === 'stripe_not_configured' ? 'not_configured' : 'unreadable';
}
