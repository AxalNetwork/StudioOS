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
 * The category a request body names. Absent, null or blank is `null` (none
 * recorded); one of the eight is itself; anything else is an error naming the set.
 */
export function parseTicketCategory(raw: unknown): { ok: true; value: TicketCategory | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null };
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (IDS.has(v)) return { ok: true, value: v as TicketCategory };
  return { ok: false, error: `category must be one of: ${TICKET_CATEGORIES.map((c) => c.id).join(', ')}` };
}
