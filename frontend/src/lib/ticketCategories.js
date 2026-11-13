/**
 * D482 (#1022) — the eight ticket categories, canvas Y1's fixed set.
 *
 * The Worker's `cloudflare-worker/src/services/ticketCategories.ts` is the
 * rule (migration 333's CHECK holds the same slugs); this is the copy the
 * filing form offers, and `frontend/test/ticket_categories_d482.test.mjs`
 * fails if the two differ.
 */
export const TICKET_CATEGORIES = [
  { id: 'fund_administration', label: 'Fund administration' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'access_permissions', label: 'Access & permissions' },
  { id: 'licence_seats', label: 'Licence & seats' },
  { id: 'billing', label: 'Billing' },
  { id: 'data_reporting', label: 'Data & reporting' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'other', label: 'Other' },
];
