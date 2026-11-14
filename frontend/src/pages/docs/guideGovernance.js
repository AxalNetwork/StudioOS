// D4641 (#4641): source-truthful ownership and review status for priority Help guides.
// This is a review ledger keyed by the existing guide anchor, not a second route/permission catalogue.
// No guide may receive a last-verified date until its relevant product flow has actually been checked.
const PENDING = 'Verification pending';
export const PRIORITY_HELP_REVIEW = Object.freeze({
  'getting-started/help-and-shortcuts': { owner: 'Axal VC Product & Support', lastVerifiedAt: null, scope: 'Current Eadwyn and support permissions require source and browser review' },
  'account/tiers': { owner: 'Axal VC Product & Support', lastVerifiedAt: null, scope: 'Align with pricing/entitlement approval in #4652 and #4653' },
  'account/investor-billing': { owner: 'Axal VC Product & Support', lastVerifiedAt: null, scope: 'Align with pricing/entitlement approval in #4652 and #4653' },
  'account/paywalls': { owner: 'Axal VC Product & Support', lastVerifiedAt: null, scope: 'Check live billing and access outcomes' },
  'account/privacy': { owner: 'Axal VC Privacy & Support', lastVerifiedAt: null, scope: 'Check actual export payload, erasure policy and disclosure' },
  'account/auth-recovery': { owner: 'Axal VC Support', lastVerifiedAt: null, scope: 'Check signed-out recovery methods and account eligibility' },
  'troubleshooting/contact-support': { owner: 'Axal VC Support', lastVerifiedAt: null, scope: 'Check public/private ticket channels and support paths' },
  'integrations/overview': { owner: 'Axal VC Product & Support', lastVerifiedAt: null, scope: 'Check current provider configuration and revocation controls' },
  'changelog/release-notes': { owner: 'Axal VC Product & Support', lastVerifiedAt: null, scope: 'Check publication source and release discovery' },
});
const DEFAULT = Object.freeze({ owner: 'Unassigned', lastVerifiedAt: null, scope: 'Catalogue review not yet scheduled' });

export function guideReviewFor(anchor) {
  const key = typeof anchor === 'string' ? anchor : '';
  const record = PRIORITY_HELP_REVIEW[key] || DEFAULT;
  return { ...record, status: record.lastVerifiedAt ? 'Source and journey verified' : PENDING };
}

/** Derived from the existing HQ feedback read. Does not falsely claim a durable queue or search-gap store. */
export function contentReviewItems(view) {
  if (!view || !Array.isArray(view.guides)) return null;
  const missing = Array.isArray(view.missing) ? view.missing : [];
  const items = view.guides.filter((g) => Number(g.no) > 0 || missing.some((m) => m.anchor === g.anchor)).map((g) => ({
    anchor: g.anchor,
    title: g.title,
    negativeAnswers: Number(g.no) || 0,
    missingNotes: missing.filter((m) => m.anchor === g.anchor).length,
    ...guideReviewFor(g.anchor),
  }));
  return items.sort((a, b) => b.negativeAnswers - a.negativeAnswers || b.missingNotes - a.missingNotes);
}
