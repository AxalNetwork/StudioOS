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
  accreditation_v1: ['Accreditation', 'The recorded accreditation requirement for your investment access.', 'The fund team tells you which evidence they need.', '/help'],
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
