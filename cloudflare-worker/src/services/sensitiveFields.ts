/**
 * D634 (#1392) — the identity fields an admin review masks, and how.
 *
 * D612 logs each READ of a KYC record or a partner profile. Those reads
 * returned every sensitive value in clear, so a page that only hid them in the
 * browser would claim "each showing is logged" while the values had already
 * left the server. Now the record read returns each sensitive field masked,
 * and one value at a time comes back in clear from its own route, which logs
 * that showing (`kyc_field_shown`, `partner_field_shown`).
 *
 * The mask shows the shape and, for an ID number, a phone or a tax ID, the
 * last two characters, so a reviewer can match a document without reading
 * the whole value. A date of birth and an address show no characters.
 *
 * Pure: no I/O.
 */

/** KYC fields that are masked, keyed by the name the "Show" route takes. */
export const KYC_SENSITIVE = ['date_of_birth', 'id_number', 'address', 'phone'] as const;
export type KycSensitive = (typeof KYC_SENSITIVE)[number];

/** The `kyc_data` keys an address is made of. Country stays plain: it is coarse, and the review needs it. */
export const KYC_ADDRESS_KEYS = ['address_line1', 'address_line2', 'city', 'state_region', 'postal_code'] as const;

/** Partner-profile fields that are masked. */
export const PARTNER_SENSITIVE = ['ein'] as const;
export type PartnerSensitive = (typeof PARTNER_SENSITIVE)[number];

const DOT = '•';

/** Every character but spaces and separators becomes a dot, and the last `keep` stay. */
export function maskValue(value: string, keep = 0): string {
  const s = String(value);
  const tail = keep > 0 ? s.slice(-keep) : '';
  const head = keep > 0 ? s.slice(0, -keep) : s;
  return head.replace(/[^\s\-/.,+]/g, DOT) + tail;
}

/** The clear value of one KYC field, or null when the member did not submit it. */
export function kycFieldValue(data: Record<string, any> | null, field: KycSensitive): string | null {
  if (!data) return null;
  if (field === 'address') {
    const parts = KYC_ADDRESS_KEYS.map((k) => data[k]).filter((v) => typeof v === 'string' && v.trim());
    return parts.length ? parts.join(', ') : null;
  }
  const v = data[field];
  return typeof v === 'string' && v.trim() ? v : null;
}

const KEEP: Record<string, number> = { date_of_birth: 0, id_number: 2, address: 0, phone: 2, ein: 2 };

/** The masked form of a clear value, for the field it belongs to. */
export function maskFor(field: string, value: string | null): string | null {
  return value == null ? null : maskValue(value, KEEP[field] ?? 0);
}

/**
 * `kyc_data` with every sensitive value removed and a `masked` map in their
 * place: `{ field: '•••…12' | null }`. Null means the member did not submit it.
 */
export function maskKycData(data: Record<string, any> | null): Record<string, any> | null {
  if (!data) return null;
  const out: Record<string, any> = { ...data };
  const masked: Record<string, string | null> = {};
  for (const f of KYC_SENSITIVE) masked[f] = maskFor(f, kycFieldValue(data, f));
  delete out.date_of_birth;
  delete out.id_number;
  delete out.phone;
  for (const k of KYC_ADDRESS_KEYS) delete out[k];
  out.masked = masked;
  return out;
}

/**
 * A partner-profile row with `ein` masked, and `ein` dropped from the AI's
 * `extracted_data` JSON too, where the extraction keeps its own copy.
 */
export function maskPartnerProfile(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...row };
  const ein = typeof row.ein === 'string' && row.ein.trim() ? row.ein : null;
  delete out.ein;
  out.masked = { ein: maskFor('ein', ein) };
  if (typeof row.extracted_data === 'string' && row.extracted_data) {
    try {
      const parsed = JSON.parse(row.extracted_data);
      if (parsed && typeof parsed === 'object' && 'ein' in parsed) {
        delete parsed.ein;
        out.extracted_data = JSON.stringify(parsed);
      }
    } catch { /* not JSON: left as stored */ }
  }
  return out;
}
