/**
 * D633 (#1391, Q3) — the pure half of HQ · Security → trust obligations by
 * role (`hq-obligations` in design/canvases/integrated/ops-data.js). The
 * defaults come from `GET /trust/matrix?role=` (services/trust.ts
 * ROLE_MATRIX); nothing here invents an obligation.
 */

export const ROLES = [
  { id: 'founder', label: 'Founder' },
  { id: 'investor', label: 'Investor' },
  { id: 'advisor', label: 'Advisor' },
  { id: 'partner', label: 'Partner' },
  { id: 'admin', label: 'Admin' },
];

const TITLES = {
  tos_v1: 'Terms of service',
  privacy_v1: 'Privacy',
  founder_nda_v1: 'Founder NDA',
  investor_nda_v1: 'Investor NDA',
  mentor_nda_v1: 'Advisor NDA',
  mentor_disclaimer_v1: 'Advisor disclaimer',
  kyc_v1: 'Identity check',
  kyb_v1: 'Company verification',
  accreditation_v1: 'Accreditation',
  partner_msa_v1: 'Partner agreement',
};
/** What lasts until the document itself changes, not for a period. */
const UNTIL_CHANGED = { tos_v1: 'Until the terms change', privacy_v1: 'Until the policy changes' };

export const obligationTitle = (key) => TITLES[key] || key;

const MONTH_MS = 365 * 24 * 60 * 60 * 1000 / 12;

/** How long an obligation stays valid once met: a period, "until X changes", or why none is recorded. */
export function validity(o) {
  const ms = o?.ttlMs;
  if (ms == null) {
    return UNTIL_CHANGED[o?.key]
      ? { text: UNTIL_CHANGED[o.key] }
      : { nr: true, reason: 'This obligation does not expire, so no period is recorded.' };
  }
  const months = Math.round(Number(ms) / MONTH_MS);
  return { text: `${months} month${months === 1 ? '' : 's'}` };
}

/** One role's rows, in the matrix's own order. */
export function rowsFor(obligations) {
  return (obligations || []).map((o) => ({
    key: o.key,
    title: obligationTitle(o.key),
    required: Number(o.required) === 1,
    validity: validity(o),
  }));
}
