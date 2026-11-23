/**
 * D6908 part 2 (#6908): the Pro rata row's "What you can do" on Ownership & rights (D6868, PRM18), and the founder's
 * offer inputs on the round manager's Pro-rata panel, as pure rules.
 *
 * The investor's read is `GET /api/portfolio-pro-rata/:projectUid` (`portfolioProRataApi.get`):
 *   { live_round: { name, href, href_not_recorded } | null, offer: { amount_cents, currency, respond_by } | null, offer_not_recorded }
 * Nothing is computed: an offer is what the founder recorded, never a share of the ownership.
 */
import { day } from './portfolioModel';
import { formatMinor, toMajorString } from '../../lib/money';

export const OFFER_NOT_RECORDED = 'Offer not recorded';
export const NO_LIVE_ROUND = 'No live round';
export const ROUND_UNREADABLE = 'The live round could not be read. That is not a claim there is none.';

/** The read's shape: a live round (or null), and the caller's offer (or null). */
export const PRO_RATA_SHAPE = (v) => !!v && typeof v === 'object' && 'live_round' in v && (v.live_round === null || typeof v.live_round === 'object')
  && (v.offer === null || v.offer === undefined || typeof v.offer === 'object');

/** Cents in the offer's currency, whole units unless cents are recorded: 31000000, 'USD' → $310,000. */
export function offerMoney(cents, currency) {
  const n = Number(cents);
  if (cents === null || cents === undefined || cents === '' || !Number.isSafeInteger(n) || n <= 0) return null;
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? String(currency) : 'USD';
  return formatMinor(n, code, { locale: 'en-US', trimWhole: true });
}

/**
 * The row's action, from the read:
 *   loading      { kind: 'loading' }
 *   unreadable   { kind: 'unreadable', line }
 *   no round     { kind: 'none', line: 'No live round' }  (a held company with no live round reads no action)
 *   live round   { kind: 'round', line, href|null, hrefNote|null, offerRecorded }
 * The line reads "Series A is live · offer to you: up to $310,000 · respond by 30 Nov 2026", or
 * "Series A is live · Offer not recorded" when the founder has recorded none.
 */
export function proRataAction(read) {
  if (!read || read.state === 'loading') return { kind: 'loading' };
  if (read.state !== 'ok') return { kind: 'unreadable', line: ROUND_UNREADABLE };
  const round = read.value.live_round;
  if (!round) return { kind: 'none', line: NO_LIVE_ROUND };
  const name = String(round.name || '').trim() || 'The round';
  const amount = read.value.offer ? offerMoney(read.value.offer.amount_cents, read.value.offer.currency) : null;
  const by = read.value.offer ? day(read.value.offer.respond_by) : null;
  const parts = [`${name} is live`];
  if (amount) parts.push(`offer to you: up to ${amount}`);
  else parts.push(read.value.offer_not_recorded || OFFER_NOT_RECORDED);
  if (amount && by) parts.push(`respond by ${by}`);
  const href = typeof round.href === 'string' && round.href.startsWith('/') ? round.href : null;
  return { kind: 'round', line: parts.join(' · '), href, hrefNote: href ? null : (round.href_not_recorded || null), offerRecorded: !!amount };
}

// ── The founder's side: the offer to one holder and the day to answer by ────────────────────────────────────

/** A holder's recorded offer as the input's value, in the round's units ('' when none). */
export const offerInputValue = (cents, currency = 'USD') => {
  const n = Number(cents);
  if (cents === null || cents === undefined || !Number.isSafeInteger(n) || n <= 0) return '';
  return (toMajorString(n, String(currency || 'USD').toUpperCase()) || '').replace(/\.0+$/, '');
};

/**
 * The PUT body for an edited offer, or null when nothing changed, or { problem } for a value the Worker refuses.
 * Blank clears the offer; anything else must be a positive amount.
 */
export function offerPatch(raw, cents, currency = 'USD') {
  const text = String(raw ?? '').trim();
  if (text === offerInputValue(cents, currency)) return null;
  if (text === '') return { offer_amount: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return { problem: 'An offer is a positive amount, or blank for none.' };
  return { offer_amount: n };
}

/** The PUT body for an edited respond-by day, or null when nothing changed. Blank clears it. */
export function respondByPatch(raw, current) {
  const text = String(raw ?? '').trim();
  const was = /^\d{4}-\d{2}-\d{2}/.test(String(current || '')) ? String(current).slice(0, 10) : '';
  if (text === was) return null;
  if (text === '') return { respond_by: null };
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { respond_by: text } : { problem: 'Pick a day to respond by, or leave it blank.' };
}
