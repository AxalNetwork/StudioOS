/**
 * D4825 (#4825) — what one proof claim says about itself on the Proof list
 * (EX-08), the request flow (EX-09) and the attester's page (EX-10). Pure:
 * no React and no fetch. `ProofZone.jsx` and `AttestConsentPage.jsx` draw it.
 *
 * THE CARD'S STATE COMES FROM THE WORKER. `row.attested` and each consent's
 * `state` are computed by `routes/advisors_proof.ts` (`consentState`), never
 * here. This file only chooses which of those facts the card leads with, in
 * one fixed order: Confirmed, Awaiting, Needs reconfirmation, Declined or
 * Withdrawn, Self-stated.
 *
 * NEVER "VERIFIED". Axal does not verify anyone's identity. A confirmation is
 * a named person answering with a code emailed to the address the advisor
 * gave, so the card says "Confirmed by <name>", and nothing stronger.
 *
 * NOTHING PUBLISHES ON ITS OWN. A confirmed claim stays private until the
 * advisor presses Publish (`PATCH /me/proof/:id/publication`), and the Worker
 * refuses that unless a confirmation of the claim as it now reads exists.
 */

/** The five card states, in the order the card checks them. */
export const PROOF_CARD_STATES = Object.freeze({
  confirmed: { label: 'Confirmed', tone: 'ok' },
  awaiting: { label: 'Awaiting confirmation', tone: 'info' },
  needs_reconfirmation: { label: 'Needs reconfirmation', tone: 'warn' },
  declined: { label: 'Declined', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'danger' },
  self_stated: { label: 'Self-stated', tone: 'neutral' },
});

const KIND_LABELS = Object.freeze({ engagement: 'Engagement', outcome: 'Outcome', role: 'Role', credential: 'Credential' });
export const proofKindLabel = (kind) => KIND_LABELS[kind] || 'Claim';

const latest = (list, key) => [...list].sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')))[0] || null;

/**
 * The card's one state and the consent it is about. `consent` is null for a
 * self-stated claim nobody has been asked about.
 */
export function proofCardState(row) {
  const consents = row?.consents || [];
  const of = (s) => consents.filter((c) => c.state === s);
  if (row?.attested) return { state: 'confirmed', consent: latest(of('confirmed'), 'consent_given_at'), confirmed: of('confirmed') };
  if (of('pending').length) return { state: 'awaiting', consent: latest(of('pending'), 'requested_at') };
  if (of('needs_reconfirmation').length) return { state: 'needs_reconfirmation', consent: latest(of('needs_reconfirmation'), 'consent_given_at') };
  const answered = consents.filter((c) => c.state === 'declined' || c.state === 'withdrawn');
  if (answered.length) {
    const last = latest(answered, 'withdrawn_at');
    return { state: last.state, consent: last };
  }
  return { state: 'self_stated', consent: null };
}

/** "5 Nov 2026", read in UTC so a test and a reader agree; null when absent or unreadable. */
export function proofDate(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The attester as the card names them: "Jane Smith · Partner, Acme". */
export const attesterLine = (c) => [c?.attester_name, c?.attester_role].filter(Boolean).join(' · ');

/** Who the card names, and how: "Confirmed by" for a live confirmation, "Asked" otherwise. */
export function proofWhoLine(card) {
  if (card.state === 'confirmed') {
    const names = (card.confirmed || []).map((c) => c.attester_name).filter(Boolean);
    return { lead: 'Confirmed by', who: names.length > 1 ? names.join(', ') : attesterLine(card.consent) };
  }
  if (!card.consent) return null;
  return { lead: 'Asked', who: attesterLine(card.consent) };
}

/** The card's dated line: when it was asked, answered or confirmed. Never a date the Worker did not send. */
export function proofWhenLine(card) {
  const c = card.consent;
  switch (card.state) {
    case 'confirmed': {
      const d = proofDate(c?.consent_given_at);
      return d ? `Confirmed ${d} with an emailed code` : 'Confirmed with an emailed code · date not recorded';
    }
    case 'awaiting': {
      const d = proofDate(c?.requested_at);
      return d ? `Asked ${d} · no answer yet` : 'Asked · no answer yet';
    }
    case 'needs_reconfirmation': {
      const d = proofDate(c?.consent_given_at);
      return `${d ? `Confirmed ${d}` : 'Confirmed earlier'}, before emailed codes or about an earlier wording. It no longer counts.`;
    }
    case 'declined':
    case 'withdrawn': {
      const d = proofDate(c?.withdrawn_at);
      const verb = card.state === 'declined' ? 'Declined' : 'Withdrawn';
      return d ? `${verb} ${d}` : verb;
    }
    default:
      return 'No one has been asked';
  }
}

/** Whether a reader of the advisor's public profile sees it. */
export const proofPublicLine = (row) => (row?.published
  ? 'Public: shown on your profile as confirmed'
  : 'Private: only you see it');

export const PROOF_PRIVATE_NOTE = 'Proof is private until you publish it. Only a claim with a current confirmation can be published, and nothing publishes on its own. Eadwyn never creates or confirms proof on someone’s behalf.';

/** Fixed sentences for the publish and cancel refusals (never the raw error text). */
export const PROOF_ACTION_REFUSALS = Object.freeze({
  proof_confirmation_required: 'Only a claim with a current confirmation can be published. Ask again, then publish.',
  proof_not_found: 'This claim no longer exists. Reload the list.',
  consent_not_found: 'This request no longer exists. Reload the list.',
  consent_not_pending: 'This request was already answered, so it cannot be cancelled.',
});
export const proofActionText = (err, fallback) => PROOF_ACTION_REFUSALS[err?.code] || fallback;

/** The four steps the request flow walks through (EX-09). */
export const ASK_STEPS = Object.freeze(['Claim', 'Attester', 'Request', 'Confirmation']);

/** The claim as one sentence, exactly as the attester will read it. */
export function claimSentence(claim) {
  const where = [claim?.organization, claim?.period_note].filter(Boolean).join(' · ');
  return [claim?.title, where].filter(Boolean).join(' — ');
}
