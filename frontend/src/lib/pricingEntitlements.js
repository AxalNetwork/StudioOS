/** D4653 (#4653): reviewed licence and usage explanations shared by Pricing, Checkout and Help; quantitative defaults come only from the public catalogue read. */
export const LICENCE_CHARGE = 'The licence plans shown here are charged per member licence.';
export const LICENCE_PRICE_UNIT = 'per licence';
export const LICENCE_SCOPE = 'Each held licence uses its own plan. A licence without a paid plan stays on its free tier; another paid licence does not upgrade it. An Institutional colleague seat uses the primary account’s Investor plan, rather than a separately purchased personal plan. Other project collaborators and data-room guests use their granted permissions; each member’s paid features still follow their own licence. No additional Institutional colleague seats are offered for purchase. Other collaborator limits follow the permissions of the project or room.';
export const ADDITIONAL_LICENCE = 'To add another individually billed licence, Contact Axal VC: an Admin grants it. Each licence is billed separately at its own list price, without a bundle. Appointed Admins keep the paid licences and plans they already hold.';
export const USAGE_SCOPE = 'Unlimited startups does not mean unlimited storage, AI or introductions. Company files count to the company’s primary admin (or venture founder); personal files count to their owner. Storage allowances are not added across licences. A lower storage allowance can stop new uploads; the storage guard does not delete or hide existing files. Permissions, expiry, NDA conditions and plan access still govern reads and sharing. Eligible paid-plan AI allowances contribute to the member’s AI budget; purchased AI tokens remain separate.';
export const SERVICE_SCOPE = 'Plans include the software workflows, templates and booking access listed for that plan. Human sessions, filing services and external fees require a separate agreed quote specifying the service, supported jurisdictions and charges.';
export const SUPPORT_SCOPE = 'Public Help and the Contact form are available; signed-in members can use Help → Your tickets. Ordinary tickets reach a public tracker, so exclude confidential information. Plans include no guaranteed response-time SLA or onboarding bundle.';
export const AVAILABILITY_SCOPE = 'Axal VC is in alpha. Only verified live capabilities are described as included; planned or unverified capabilities are not guaranteed by a plan.';
export const INTRODUCTION_SCOPE = 'Introduction credits belong to the member, not each startup; their acceptances share that balance. Accepting uses the monthly acceptance allowance first, then referral-earned and legacy purchased credits. A successful acceptance is charged once; failed or repeated acceptance does not debit it again. Monthly allowance resets by UTC calendar month and does not roll over. Investor introduction requests use a separate UTC calendar-quarter counter. Capacity does not guarantee introductions, funding or sales.';
export const RESEARCH_SCOPE = 'Deal-room and introduction-request defaults are not search or export allowances. The plan descriptions do not specify research source coverage, freshness, search/export limits or permitted reuse; confirm them before relying on a research subscription.';
export const MATCHING_SCOPE = 'Paid visibility is not evidence of suitability and does not guarantee introductions, funding, sales or client demand. Access, eligibility and consent still apply.';
export const STAFF_SCOPE = 'Staff access is appointed and has no subscription. Any paid licences you already hold keep their own plans.';

/** Missing or malformed reads cannot turn an unknown allowance into zero or unlimited. */
export function investorCapacityLine(catalogue) {
  if (!Array.isArray(catalogue)) return 'Investor capacity is unreadable. Try again before relying on a limit.';
  const rows = ['investor:free', 'investor:plus', 'investor:professional'].map(key => catalogue.find(row => row?.key === key));
  if (rows.some(row => !row || typeof row.label !== 'string' || !row.label.trim() || !row.entitlements?.investor_defaults
    || ['active_deal_rooms', 'introduction_requests_per_quarter', 'colleague_seats'].some(field =>
      !Number.isSafeInteger(row.entitlements.investor_defaults[field]) || row.entitlements.investor_defaults[field] < 0))) {
    return 'Investor capacity is unreadable. Try again before relying on a limit.';
  }
  return rows.map(row => {
    const q = row.entitlements.investor_defaults;
    return `${row.label}: ${q.active_deal_rooms} active deal rooms, ${q.introduction_requests_per_quarter} introduction requests per quarter, ${q.colleague_seats} colleague seats`;
  }).join('; ') + '. These are account defaults; access permissions still apply. '
    + (planCapacityLine(catalogue.find(row => row?.key === 'investor:institutional')) || 'Institutional capacity and seat terms are agreed with Axal VC.');
}

export function entitlementQuestions(tab, catalogue) {
  return [
    ['Who pays for a licence?', `${LICENCE_CHARGE} ${LICENCE_SCOPE} ${ADDITIONAL_LICENCE}`],
    ['How are usage and introductions shared?', `${USAGE_SCOPE} ${INTRODUCTION_SCOPE}`],
    ['Does the plan include human services and other charges?', SERVICE_SCOPE],
    ['What support and onboarding are included?', SUPPORT_SCOPE],
    ['Which capabilities are available during alpha?', AVAILABILITY_SCOPE],
    ['Does paid visibility guarantee a match or client demand?', MATCHING_SCOPE],
    ...(tab === 'investor' ? [['What capacity differs between Investor plans?', `${investorCapacityLine(catalogue)} ${RESEARCH_SCOPE}`]] : []),
  ];
}

/** Comparison cells use the same published defaults; negotiated or missing data is never a guessed number. */
export function investorCapacityGroup(tab, catalogue) {
  if (tab !== 'investor') return null;
  const entries = Array.isArray(catalogue) ? catalogue : [];
  const keys = ['investor:free', 'investor:plus', 'investor:professional', 'investor:institutional'];
  const cells = field => keys.map(key => {
    const defaults = entries.find(row => row?.key === key)?.entitlements?.investor_defaults;
    if (defaults?.negotiated === true && field === 'active_deal_rooms') return 'Agreed with Axal VC';
    const value = defaults?.[field];
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Not recorded';
  });
  return ['Account capacity', [
    ['Active deal rooms (default)', ...cells('active_deal_rooms')],
    ['Introduction requests per UTC quarter', ...cells('introduction_requests_per_quarter')],
    ['Colleague seats (default)', ...cells('colleague_seats')],
  ]];
}

export function planCapacityLine(entry) {
  if (typeof entry?.key !== 'string' || !entry.key.startsWith('investor:')) return null;
  const quota = entry.entitlements?.investor_defaults;
  if (!quota || ['active_deal_rooms', 'introduction_requests_per_quarter', 'colleague_seats']
    .some(field => !Number.isSafeInteger(quota[field]) || quota[field] < 0)) return 'Plan capacity is unavailable. Confirm it with Axal VC before paying.';
  if (quota.negotiated === true) return `Institutional capacity and seat terms are agreed with Axal VC. Current software defaults: ${quota.introduction_requests_per_quarter} introduction requests per UTC quarter and ${quota.colleague_seats} colleague seats; confirm room capacity and service terms before purchase.`;
  return `Default account capacity: ${quota.active_deal_rooms} active deal rooms, ${quota.introduction_requests_per_quarter} introduction requests per UTC quarter, ${quota.colleague_seats} colleague seats. Access permissions still apply.`;
}
