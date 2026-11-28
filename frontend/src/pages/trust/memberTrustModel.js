/** D1078: counts and requirement explanations; facts come from the caller's matrix. */
export const REQUIREMENTS = {
  tos_v1: ['Terms of Service', 'The terms for using StudioOS.', 'Asked of every member.', '/terms'],
  privacy_v1: ['Privacy Policy', 'How the platform handles personal data.', 'Asked of every member.', '/privacy'],
  founder_nda_v1: ['Founder NDA', 'The confidentiality agreement for founders.', 'Asked of founders before confidential information is shared.'],
  investor_nda_v1: ['Investor NDA', 'Keeps information shared by founders confidential.', 'Asked of investors before founders share a data room.'],
  mentor_nda_v1: ['Advisor NDA', 'The confidentiality agreement for advisors.', 'Asked of advisors before confidential work.'],
  mentor_disclaimer_v1: ['Advisor disclaimer', 'The disclosure required for your advisor role.', 'Asked of advisors.'],
  partner_msa_v1: ['Partner MSA', 'The agreement for your partner work.', 'Added when partner work requires an agreement.'],
  kyc_v1: ['Identity check', 'Verification of the investor’s identity.', 'Asked of investors. Identity documents are managed in the identity check.', '/kyc'],
  kyb_v1: ['Entity check', 'Verification of the company acting on the platform.', 'Required only when the platform asks for an entity check.', '/account'],
  accreditation_v1: ['Accreditation', 'Evidence that you are an accredited investor, reviewed by the fund team.', 'Asked of investors. A verification letter from a CPA, attorney, broker-dealer or registered adviser meets it.', '/trust/me?tab=verifications'],
};
export const requirementLabel = (row) => REQUIREMENTS[row.obligation_key]?.[0] || row.obligation_key;
export const met = (row) => row.status === 'satisfied' || row.status === 'waived';
export function requirementCounts(rows) {
  const required = rows.filter((r) => Number(r.required) === 1);
  return { total: required.length, done: required.filter(met).length };
}
export function memberRequirements(rows, role) {
  // A stale waived KYC row must not turn a non-investor into a KYC applicant.
  return rows.filter((r) => r.obligation_key !== 'kyc_v1' || role === 'investor');
}
export const profileName = (role) => ({ founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', exploring: 'Explorer', admin: 'Admin' }[role] || 'Member');
export function day(value) {
  if (!value) return 'Not recorded';
  const date = new Date(/^[0-9]{4}-[0-9]{2}-[0-9]{2} /.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

/** D1078: one signing decision for the list and the requirement lightbox. */
export function signingRequirement(row, requiredNdas) {
  const issued = (requiredNdas || []).find((entry) => entry.obligation_key === row.obligation_key);
  const evidence = issued || (row.evidence_envelope_uuid ? row : null);
  if (!evidence) return null;
  return { ...evidence, obligation_key: row.obligation_key, open: Number(row.required) === 1
    && !['satisfied', 'waived', 'in_review'].includes(row.status)
    && (issued ? issued.open === true : Boolean(row.evidence_envelope_uuid)) };
}

/** D6139: who may write the verification letter (owner answer A on #6139). Values are the Worker's `basis`. */
export const ACCREDITATION_BASES = [
  ['cpa_letter', 'A CPA'],
  ['attorney_letter', 'An attorney'],
  ['broker_dealer_letter', 'A broker-dealer'],
  ['registered_adviser_letter', 'A registered adviser'],
];

/**
 * D6139: the accreditation requirement's state, from one read of
 * GET /trust/accreditation/evidence/mine (letters newest first). One of
 * `not_asked`, `upload`, `in_review`, `accepted`, `sent_back`, `expired`; with
 * the letter it is about, the requirement's period when it is satisfied, and a
 * renewal letter that was sent back while the period still runs. Read by
 * /trust/me and by the LP workspace's onboarding row, so both say the same.
 */
export function accreditationState(read, now = Date.now()) {
  const obligation = read?.obligation || null;
  const items = Array.isArray(read?.items) ? read.items : [];
  const none = { letter: null, expiresAt: null, sentBack: null };
  if (!obligation || !obligation.required || obligation.status === 'waived') return { key: 'not_asked', ...none };
  const lapsed = (iso) => Boolean(iso) && Date.parse(iso) <= now;
  const open = items.find((i) => i.status === 'submitted' || i.status === 'in_review') || null;
  const decided = items.find((i) => i.status === 'accepted' || i.status === 'expired') || null;
  const latest = items[0] || null;
  const running = obligation.status === 'satisfied' && !lapsed(obligation.expires_at);
  const expiresAt = running ? obligation.expires_at || null : null;
  const sentBack = latest?.status === 'sent_back' ? latest : null;
  if (open) return { key: 'in_review', letter: open, expiresAt, sentBack: null };
  if (running) return { key: 'accepted', letter: decided, expiresAt, sentBack };
  if (sentBack) return { key: 'sent_back', letter: sentBack, expiresAt: null, sentBack };
  if (obligation.status === 'expired' || obligation.status === 'satisfied' || decided?.status === 'expired') return { key: 'expired', letter: decided, expiresAt: decided?.expires_at || obligation.expires_at || null, sentBack: null };
  return { key: 'upload', ...none };
}

/** D6139: whether a new letter may be sent in this state (never while one is with the fund team). */
export const accreditationUploadOpen = (state) => ['upload', 'sent_back', 'expired', 'accepted'].includes(state?.key);
