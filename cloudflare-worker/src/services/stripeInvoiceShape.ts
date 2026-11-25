/**
 * D8510 (#8510): the subscription an invoice belongs to, read from both Stripe
 * payload shapes. Before the Basil version (`2025-03-31.basil`) an invoice
 * carries `subscription`; from Basil on it moved to
 * `parent.subscription_details.subscription`. Either may be an id or an
 * expanded object. Pure: no Stripe call, no D1.
 */

/** An id, or an expanded object's id; null for anything else. */
function idOf(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' && (v as { id: string }).id) return (v as { id: string }).id;
  return null;
}

/** The invoice's subscription id, pre-Basil location first, then Basil's; null when it has none. */
export function invoiceSubscriptionId(invoice: unknown): string | null {
  if (!invoice || typeof invoice !== 'object') return null;
  const inv = invoice as { subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } | null } | null };
  return idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription);
}

/** True when the invoice names its subscription in either location (an absent field means "not in this payload"). */
export function invoiceNamesSubscriptionField(invoice: unknown): boolean {
  if (!invoice || typeof invoice !== 'object') return false;
  const inv = invoice as { subscription?: unknown; parent?: unknown };
  return inv.subscription !== undefined || inv.parent !== undefined;
}
