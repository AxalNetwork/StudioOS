/**
 * D5305 (#5305; canvas `HQ Advisory Refunds`, boards RV16 to RV21) — the pure
 * rules for Billing exceptions' advisory refunds due: a charge that landed on a
 * cancelled or missed advisor booking, owed back. Refunds stay manual (D4703):
 * nothing here moves money, and "Mark refunded…" only records that an operator
 * refunded it in Stripe, with who, when and why.
 *
 * The read is `GET /api/admin/platform/advisory-refunds-due` (Super Admin),
 * the write `POST …/:id/resolve` (the Super Admin write bar). The page holds
 * the read as null (loading), UNAVAILABLE (it failed), HIDDEN (the viewer is not
 * a Super Admin, so the block is not drawn at all) or the payload.
 */
import { REFUND_REASON_MIN } from '../../../lib/refundReason.js';
import { UNAVAILABLE, isReady, money } from './revenueModel.js';

/** The viewer may not read this record: the block and its tile are not drawn, and nothing says "none owed". */
export const HIDDEN = Symbol('hidden');

/** The most rows the route reads (open first). An all-open read of this many is a floor, not a count. */
export const REFUNDS_DUE_READ_CAP = 200;

/** The longest reason the resolve accepts (`routes/admin_platform.ts`); the shortest is the D224 refund floor. */
export const RESOLVE_REASON_MAX = 500;

/** The blank a drafted reason leaves for what only Stripe knows. A reason still holding one is not sent. */
export const DRAFT_BLANK = '____';

/** `cancelled` and `no_show` as the operator reads them, glyph and word. Any other status is shown as stored. */
export function whyOwed(status) {
  if (status === 'cancelled') return { glyph: '⊘', word: 'Cancelled' };
  if (status === 'no_show') return { glyph: '◌', word: 'Missed' };
  const s = String(status ?? '').trim();
  return s ? { glyph: '·', word: s.replace(/_/g, ' ') } : null;
}

/** The row's own amount in its own currency, or null (Not recorded). Never 0 for a missing amount, never summed. */
export function amountOf(row) {
  if (row?.amount_cents == null || !row?.currency) return null;
  return money(row.amount_cents, String(row.currency).toUpperCase());
}

/** A stored UTC timestamp's date, `YYYY-MM-DD`, or null. */
export const dayUtc = (ts) => (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : null);

/** A stored UTC timestamp to the minute, `YYYY-MM-DD HH:MM`, or null. */
export const minuteUtc = (ts) => {
  const m = typeof ts === 'string' ? ts.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/) : null;
  return m ? `${m[1]} ${m[2]}` : null;
};

/**
 * The read, split for the block: open rows (newest recorded first, as the
 * route orders them), resolved rows (most recently resolved first), the open
 * count as a figure, and the oldest open row's recorded date. The count is a
 * floor ("200+") when the read hit its cap with every row open.
 */
export function refundsDueView(read) {
  if (!isReady(read) || read === HIDDEN) return null;
  const items = Array.isArray(read.items) ? read.items : [];
  const open = items.filter((r) => r.resolved_at == null);
  const resolved = items.filter((r) => r.resolved_at != null);
  const capped = items.length >= REFUNDS_DUE_READ_CAP && resolved.length === 0;
  const n = Number.isFinite(Number(read.open)) ? Number(read.open) : open.length;
  const oldest = open.map((r) => dayUtc(r.created_at)).filter(Boolean).sort()[0] || null;
  return {
    open,
    resolved,
    figure: capped ? { state: 'incomplete', text: `${n.toLocaleString()}+` } : { state: n ? 'recorded' : 'zero', text: n.toLocaleString() },
    count: n,
    capped,
    oldest,
  };
}

/** The tile's figure for any state of the read. */
export function refundsDueFigure(read) {
  if (read === UNAVAILABLE) return { state: 'unavailable', text: null };
  const v = refundsDueView(read);
  return v ? v.figure : { state: 'loading', text: null };
}

/**
 * A reason built only from the row's own values, with blanks for the Stripe
 * refund id and the date, which the operator fills in. It never says a refund
 * was made: the blanks are the operator's to fill, and a reason still holding
 * one is refused before it is sent.
 */
export function draftReason(row) {
  const amt = amountOf(row);
  const why = whyOwed(row?.booking_status)?.word?.toLowerCase();
  const parts = [
    `Refund${amt ? ` of ${amt}` : ''} for booking ${row?.booking_uid || DRAFT_BLANK}${why ? ` (${why})` : ''}`,
    row?.payment_intent_id ? `, Stripe payment ${row.payment_intent_id}` : '',
    `. Stripe refund id: ${DRAFT_BLANK}. Refunded on: ${DRAFT_BLANK}.`,
  ];
  return parts.join('');
}

/** Whether a reason may be sent, and if not the one sentence that says why. */
export function reasonCheck(text) {
  const t = String(text ?? '').trim();
  if (t.includes(DRAFT_BLANK)) return { ok: false, message: 'Fill the blanks from Stripe before you continue.' };
  if (t.length < REFUND_REASON_MIN || t.length > RESOLVE_REASON_MAX) {
    return { ok: false, message: `Say how this was refunded, in ${REFUND_REASON_MIN} to ${RESOLVE_REASON_MAX} characters.` };
  }
  return { ok: true, reason: t };
}

/**
 * What a failed resolve means for the sheet. Every end says nothing was
 * changed, except `unknown`: no answer arrived, so the row may or may not be
 * marked, and the list must be read again before another try.
 */
export function resolveOutcome(err) {
  const status = Number(err?.status);
  const code = err?.code || err?.data?.code || null;
  const msg = String(err?.message || '');
  if (code === 'already_resolved' || status === 409) return 'already_resolved';
  if (code === 'not_found' || status === 404) return 'not_found';
  if (code === 'reason_required' || status === 400) return 'reason';
  if (code === 'step_up_required') return 'step_up_cancelled';
  if (code === 'factor_required' || /TOTP required/i.test(msg)) return 'no_authenticator';
  if (status === 403) return 'refused';
  if (code === 'store_unavailable' || status === 503) return 'not_saved';
  return 'unknown';
}

/** The sentence each end of the sheet says. */
export const OUTCOME_TEXT = Object.freeze({
  already_resolved: 'Already resolved by someone else. Nothing was changed.',
  not_found: 'This refund due no longer exists. Nothing was changed.',
  reason: `Say how this was refunded, in ${REFUND_REASON_MIN} to ${RESOLVE_REASON_MAX} characters.`,
  step_up_cancelled: 'The authenticator check was not completed. Nothing was changed.',
  no_authenticator: 'Sign in again with your authenticator to record this. Nothing was changed.',
  refused: 'Only a Super Admin can record this. Nothing was changed.',
  not_saved: 'Could not be saved with its audit record, so nothing was changed.',
  unknown: 'No answer arrived, so this row may or may not be marked. Refresh the list before you try again.',
});

/** The Needs attention line (RV01): only when the read answered and a row is open. */
export function refundsDueAttention(read) {
  const v = refundsDueView(read);
  if (!v || v.count === 0) return null;
  const n = v.capped ? `${v.count}+` : String(v.count);
  return {
    key: 'advisory-refunds-due', severity: 'warning',
    title: `${n} advisory refund${v.count === 1 ? '' : 's'} due${v.oldest ? `, oldest recorded ${v.oldest}` : ''}`,
    detail: 'Refund each in Stripe, then mark it here · As of now', amount: null,
    action: { kind: 'anchor', href: '#revenue-advisory-refunds', label: 'Review refunds due' },
  };
}

/** Needs attention with the refunds-due line placed after the critical items and before the other warnings, as RV16 draws it. */
export function withRefundsDue(items, read) {
  const line = refundsDueAttention(read);
  if (!line) return items;
  const at = items.findIndex((a) => a.severity !== 'critical');
  const i = at < 0 ? items.length : at;
  return [...items.slice(0, i), line, ...items.slice(i)];
}
