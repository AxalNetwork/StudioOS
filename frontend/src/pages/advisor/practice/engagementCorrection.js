/**
 * #4715 (D4715) — correcting the terms of a signed engagement.
 *
 * Once an engagement is signed, the Worker changes its terms only as a
 * recorded correction: a reason, and each changed field before and after,
 * kept in the engagement's history (`GET /me/engagements/:id/events`). This
 * module turns the correction form into that request and the history into
 * lines a person can read.
 */
import { dollarsToCents, money } from '../expertise/kit';

/** The terms the form edits, as the engagement holds them. */
export function correctionForm(e) {
  return {
    scope_label: e?.scope_label ?? '',
    scope_includes: e?.scope_includes ?? '',
    scope_excludes: e?.scope_excludes ?? '',
    amount: e?.amount_cents == null ? '' : String(Number(e.amount_cents) / 100),
    term_ends_at: e?.term_ends_at ?? '',
    reason: '',
  };
}

const blankToNull = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());

/**
 * `{ body }` for `updateMyAdvisorEngagement`, sending only the terms that
 * changed, the reason and the version the form was opened on; or `{ error }`.
 */
export function correctionBody(e, form) {
  const next = {
    scope_label: blankToNull(form.scope_label),
    scope_includes: blankToNull(form.scope_includes),
    scope_excludes: blankToNull(form.scope_excludes),
    term_ends_at: blankToNull(form.term_ends_at),
  };
  const amount = dollarsToCents(form.amount);
  if (amount.error) return { error: amount.error };
  next.amount_cents = amount.cents ?? null;
  const body = {};
  for (const [k, v] of Object.entries(next)) if ((e?.[k] ?? null) !== v) body[k] = v;
  if (Object.keys(body).length === 0) return { error: 'Nothing in the terms has changed.' };
  const reason = String(form.reason ?? '').trim();
  if (!reason) return { error: 'Say why the signed terms are being corrected. The reason is kept in the history.' };
  return { body: { ...body, correction_reason: reason, expected_updated_at: e.updated_at } };
}

export const TERM_LABEL = Object.freeze({
  client_name: 'Client', shape: 'Shape', scope_label: 'Scope line', scope_includes: 'In scope',
  scope_excludes: 'Not in scope', amount_cents: 'Amount', term_ends_at: 'Term ends',
});

const termValue = (field, v) => {
  if (v == null || v === '') return 'not recorded';
  return field === 'amount_cents' ? money(v) : String(v);
};

const KIND_LABEL = Object.freeze({ signed: 'Signed', renewed: 'Renewed', ended: 'Ended', corrected: 'Terms corrected' });

/** One history entry as a line: what happened, and for a correction what changed and why. */
export function historyLine(event) {
  const when = String(event?.created_at || '').slice(0, 10);
  const head = `${KIND_LABEL[event?.kind] || event?.kind || 'Recorded'}${when ? ` · ${when}` : ''}`;
  if (event?.kind !== 'corrected') return event?.note ? `${head} · ${event.note}` : head;
  const changes = (event.changes || [])
    .map((c) => `${TERM_LABEL[c.field] || c.field}: ${termValue(c.field, c.from)} → ${termValue(c.field, c.to)}`)
    .join('; ');
  return `${head} · ${changes}${event.note ? ` · Reason: ${event.note}` : ''}`;
}
