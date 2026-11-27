/** Exact, changed-field-only deal context edits using the existing money model (#6293). */
import { currencyCode, parseMinor, toMajorString } from '../../lib/money.js';

export function dealContextInitial(cs) {
  return { round: cs.round_label == null ? '' : String(cs.round_label), cheque: cs.cheque_cents == null ? '' : toMajorString(cs.cheque_cents, cs.cheque_currency) ?? '',
    currency: currencyCode(cs.cheque_currency) || '', deal: cs.deal_id == null ? '' : String(cs.deal_id), clearCheque: false };
}

/** Unknown stored currency is retained when untouched, never guessed as EUR or converted. */
export function dealContextPatch(form, baseline, dealIds = []) {
  const initial = dealContextInitial(baseline);
  const patch = {};
  const round = form.round.trim();
  if (round.length > 80) return { error: 'The round is at most 80 characters.' };
  if (round !== initial.round.trim()) patch.round_label = round || null;
  if (form.clearCheque || form.cheque !== initial.cheque || form.currency !== initial.currency) {
    if (form.clearCheque || !form.cheque.trim()) { patch.cheque_cents = null; patch.cheque_currency = null; }
    else {
      const parsed = parseMinor(form.cheque, form.currency);
      if (!parsed.ok) return { error: parsed.message };
      patch.cheque_cents = parsed.minor; patch.cheque_currency = form.currency;
    }
  }
  if (form.deal !== initial.deal) {
    if (!form.deal) patch.deal_id = null;
    else {
      const id = Number(form.deal);
      if (!Number.isSafeInteger(id) || id <= 0 || !dealIds.map(Number).includes(id)) return { error: 'Choose a deal recorded for this subject.' };
      patch.deal_id = id;
    }
  }
  return Object.keys(patch).length ? { body: patch } : { error: 'Change the round, cheque or linked deal before saving.' };
}

/** A missing count stays unknown; it is not a claim of zero prior reviews. */
export function priorReviewWords(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
  return Number.isSafeInteger(n) && n >= 0 ? `${n} prior ${n === 1 ? 'review' : 'reviews'}` : 'Prior reviews not recorded';
}
