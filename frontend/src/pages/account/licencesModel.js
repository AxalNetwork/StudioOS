/**
 * D4473 (#4473) — the words for Account › Licences, pure for the Node test.
 *
 * The page reads `GET /api/account/licences` (D4472): `held[]` with `label`, `is_primary`, `granted_at`, `source`
 * and `plan`, and `addable[]`, each `how: 'contact'` in this build. A value the Worker did not record is drawn as
 * "Not recorded", never as a guess, and a failed read is one fixed sentence, never the error text.
 */
export const NOT_RECORDED = 'Not recorded';
export const READ_FAILED = 'Your licences could not be read. Reload the page to try again.';
export const CONTACT_TO_ADD = 'Contact Axal VC to add this licence';

const SOURCE_WORDS = Object.freeze({
  primary: 'Your primary licence, from sign-up',
  admin: 'Granted by Axal VC',
  admin_appointment: 'Granted by Axal VC with an administrator appointment',
  super_admin: 'Granted by Axal VC',
});

/** How a held licence came to be held. */
export function sourceLabel(source) {
  return SOURCE_WORDS[source] || NOT_RECORDED;
}

/** The day a licence was granted, `5 Nov 2026`, or "Not recorded". The primary licence has no grant date. */
export function grantedLabel(at) {
  if (!at) return NOT_RECORDED;
  const d = new Date(String(at).includes('T') ? at : `${String(at).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return NOT_RECORDED;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The plan a held licence stands on, or "Not recorded" (D4729). */
export function planLabel(plan) {
  return plan?.name ? plan.name : NOT_RECORDED;
}

/** `{ held, addable }` as the page draws them; anything not an array is an empty list. */
export function licencesView(body) {
  return {
    held: Array.isArray(body?.held) ? body.held : [],
    addable: Array.isArray(body?.addable) ? body.addable : [],
  };
}
