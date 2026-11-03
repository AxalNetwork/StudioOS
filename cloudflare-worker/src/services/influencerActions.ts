/**
 * D4289 P1 (#4290) — HQ's Influencer program writes, as `admin_audit_log.action`,
 * and the trigger an influencer's terms pay on. Dependency-free, so the program
 * Activity read (`programActivity.ts`) and the terms check
 * (`routes/admin_referral_partners.ts`) name them without importing the
 * membership service.
 */

/** A referred member's paid subscription invoice: the trigger influencer terms pay a share of. P3 (#4292) fires it. */
export const INFLUENCER_RULE = 'influencer_subscription_invoice_paid';
export const INFLUENCER_ACTIONS = {
  admitted: 'influencer.application_admitted',
  declined: 'influencer.application_declined',
  more: 'influencer.application_more_requested',
  tier: 'influencer.tier_changed',
  paused: 'influencer.paused',
  resumed: 'influencer.resumed',
  ended: 'influencer.ended',
  defaults: 'influencer.tier_defaults_updated',
} as const;
