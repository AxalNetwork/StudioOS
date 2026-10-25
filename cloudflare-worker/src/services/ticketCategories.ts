/**
 * D482 (#1022) — a ticket's category: one of eight, fixed.
 *
 * The set is canvas Y1's (`Support Security · Super.dc.html`). Free-text
 * categories stop being comparable across tenants within a quarter, so a
 * ticket carries one of these slugs or none (NULL, "no category recorded"),
 * and migration 333's CHECK refuses anything else. A ticket filed without one
 * is never counted as Other.
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
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]['id'];

const IDS = new Set<string>(TICKET_CATEGORIES.map((c) => c.id));

/**
 * D1075 (#2967) — Help's "Security" category. It is not one of the eight and
 * never a ticket row: a ticket is mirrored to GitHub issues on a public
 * repository and read by every admin, so a security report goes to its own
 * store, which only HQ's Super Admins and the reporter read
 * (`services/securityReports.ts`). Help offers it beside the eight and sends
 * it to `route`.
 */
export const SECURITY_CATEGORY = Object.freeze({
  id: 'security',
  label: 'Security',
  route: '/api/help/security-reports',
  private: true,
} as const);

/**
 * The category a request body names. Absent, null or blank is `null` (none
 * recorded); one of the eight is itself; anything else is an error naming the set.
 */
export function parseTicketCategory(raw: unknown): { ok: true; value: TicketCategory | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null };
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (IDS.has(v)) return { ok: true, value: v as TicketCategory };
  if (v === SECURITY_CATEGORY.id) {
    return { ok: false, error: `A security issue is reported privately, not as a ticket: send it to ${SECURITY_CATEGORY.route}.` };
  }
  return { ok: false, error: `category must be one of: ${TICKET_CATEGORIES.map((c) => c.id).join(', ')}` };
}
