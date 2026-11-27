/**
 * D4842 (#4842) — the Proof card, outcome first (Offers v2, boards OF-03 and OF03c).
 *
 * One consent label per card: an icon, a word and one line, never colour alone.
 * The card's state comes from the consent rows the Worker returns
 * (`GET /api/partner-offers/proof`, D4672), through `consentState` in
 * `ProofZone.jsx`, which decides published, awaiting, withdrawn, ask again and
 * not asked. This file names those states the way the canvas does and writes the
 * card's provenance lines. It holds no React, so a test reads it directly.
 *
 *   published  -> Client approved     (a confirmed consent about the claim as it reads now)
 *   awaiting   -> Approval requested  (an open ask about the current wording)
 *   withdrawn  -> Withdrawn, or Declined when nobody ever agreed
 *   ask_again  -> Superseded when an approval was for an earlier wording,
 *                 else Self-stated with the lapsed ask said in its line
 *   not_asked  -> Self-stated
 *
 * DECLINED IS NOT ON THE CANVAS, AND IS NOT A WITHDRAWAL. OF03c draws five states.
 * The store also records a client who said no without ever agreeing
 * (`withdrawn_at` set, `consent_given_at` null). Calling that "Withdrawn" would
 * say the client once approved, so it reads Declined.
 */

const day = (iso) => {
  if (!iso) return null;
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).length <= 19 ? 'Z' : ''));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** The six labels, each an icon, a word and one line (OF03c, plus Declined). */
export const PROOF_CONSENT = Object.freeze({
  approved: { icon: '✓', label: 'Client approved', line: 'The client agreed to this exact wording. Published.', tone: 'ok' },
  requested: { icon: '…', label: 'Approval requested', line: 'Sent to the client. Not published until they approve.', tone: 'warn' },
  self_stated: { icon: '–', label: 'Self-stated', line: 'Your firm’s own account. Not published.', tone: 'neutral' },
  withdrawn: { icon: '✕', label: 'Withdrawn', line: 'The client withdrew their approval. Not published; the history is kept.', tone: 'danger' },
  declined: { icon: '✕', label: 'Declined', line: 'The client said no. Not published; the history is kept.', tone: 'danger' },
  superseded: { icon: '↺', label: 'Superseded', line: 'An approval was for an earlier wording. Ask again to publish this one.', tone: 'neutral' },
});

/** The chip each card answers to. Declined sits under Withdrawn: neither is published, and the client ended both. */
export const PROOF_CHIP_OF = Object.freeze({
  approved: 'approved', requested: 'requested', self_stated: 'self_stated',
  withdrawn: 'withdrawn', declined: 'withdrawn', superseded: 'self_stated',
});

const rows = (item) => (Array.isArray(item?.consents) ? item.consents : []);
const latest = (list, field) => list.filter((k) => k[field]).sort((a, b) => String(b[field]).localeCompare(String(a[field])))[0] || null;
const by = (k) => (k?.consenter_name ? `${k.consenter_name}${k.consenter_role ? `, ${k.consenter_role}` : ''}` : null);

/** The card's label key, from `consentState`'s answer and the rows behind it. */
export function proofConsentKey(state, item) {
  const consents = rows(item);
  if (state === 'published') return 'approved';
  if (state === 'awaiting') return 'requested';
  if (state === 'withdrawn') return consents.some((k) => k.withdrawn_at && k.consent_given_at) ? 'withdrawn' : 'declined';
  if (state === 'ask_again') return consents.some((k) => k.state === 'superseded') ? 'superseded' : 'self_stated';
  return 'self_stated';
}

/**
 * The card's two provenance lines: who and when, then the engagement. Every
 * date is a stored one; a line with nothing behind it says so instead of
 * borrowing another row's date.
 */
export function proofProvenance(key, item) {
  const consents = rows(item);
  let when = null;
  if (key === 'approved') {
    const k = latest(consents.filter((c) => c.state === 'confirmed'), 'consent_given_at');
    when = k ? `Approved ${day(k.consent_given_at) || 'on a date not recorded'}${by(k) ? ` by ${by(k)}` : ''}` : 'Approved';
  } else if (key === 'requested') {
    const k = latest(consents.filter((c) => c.state === 'requested'), 'requested_at');
    when = k ? `Requested ${day(k.requested_at) || 'on a date not recorded'}${k.consenter_name ? ` from ${k.consenter_name}` : ''}` : 'Requested';
  } else if (key === 'withdrawn' || key === 'declined') {
    const k = latest(consents, 'withdrawn_at');
    when = `${key === 'withdrawn' ? 'Withdrawn' : 'Declined'} ${day(k?.withdrawn_at) || 'on a date not recorded'}${by(k) ? ` by ${by(k)}` : ''}`;
  } else if (key === 'superseded') {
    const k = latest(consents.filter((c) => c.state === 'superseded'), 'consent_given_at');
    when = k?.consent_given_at ? `Approved ${day(k.consent_given_at)} for an earlier wording` : 'Answered about an earlier wording';
  } else {
    when = consents.some((k) => k.state === 'expired')
      ? 'Your firm’s own account. An approval request lapsed without an answer.'
      : 'Your firm’s own account';
  }
  const engagement = item?.need_title ? `Linked to ${item.need_title}` : 'No engagement linked';
  return { when, engagement };
}

/**
 * What the card leads with: the result, then the client and the work. A card
 * whose result is not written leads with its title, which is still the firm's
 * own words about the work.
 */
export function proofHeadline(item) {
  const outcome = String(item?.outcome_note || '').trim();
  const title = String(item?.title || '').trim();
  return {
    outcome: outcome || title,
    client: item?.founder_name || null,
    context: outcome ? title : null,
  };
}

/** The card's second action, by state (OF03): a request where one helps, else the record. */
export function proofSecondAction(key) {
  if (key === 'approved') return { label: 'Manage consent', opens: 'record' };
  if (key === 'requested') return { label: 'Show request link', opens: 'record' };
  if (key === 'self_stated' || key === 'superseded') return { label: 'Request client approval', opens: 'ask' };
  return { label: 'View history', opens: 'record' };
}

/** Per-chip counts over the whole page of items, never over the narrowed list. */
export function proofChipCounts(keys) {
  const out = { all: keys.length, approved: 0, requested: 0, self_stated: 0, withdrawn: 0 };
  for (const k of keys) out[PROOF_CHIP_OF[k]] += 1;
  return out;
}
