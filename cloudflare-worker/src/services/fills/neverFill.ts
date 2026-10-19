/**
 * The fields Eadwyn never fills — the Worker's copy of
 * `frontend/src/lib/neverFill.js` (D777). Read that file's header for the four
 * kinds and how a rule matches; this one carries the same rules and the same
 * matcher, and `test/never_fill.test.ts` fails when the two disagree.
 *
 * WHY A COPY AND NOT AN IMPORT. The Worker bundle does not reach into
 * `frontend/`, and the SPA does not reach into the Worker. Two copies kept equal
 * by a test is how this repo already holds its other client/server pairs.
 *
 * WHERE IT IS ENFORCED. The propose route refuses to store a proposal whose
 * target is one of these fields, the accept route refuses to apply one before
 * anything is written, and `recordFill` refuses to file provenance against one —
 * the last because every fill path ends there, so a path added later that forgets
 * the first two still cannot record Eadwyn as the author of a signature.
 */

export type NeverFillCategory = 'signature_consent' | 'payment_amount' | 'identity_number' | 'legal_attestation';
export interface NeverFillRule {
  category: NeverFillCategory;
  label: string;
  tables: readonly string[];
  columns: readonly string[];
}

export const NEVER_FILL_RULES: readonly NeverFillRule[] = Object.freeze([
  {
    category: 'signature_consent',
    label: 'Signatures and consents',
    tables: [
      'advisor_proof_consents',
      'channel_consents',
      'partner_proof_consents',
      'user_promotion_consent',
    ],
    columns: [
      'consent', 'consents', 'consented',
      'e_sign', 'esign', 'esignature',
      'initials',
      'signature', 'signatures', 'signed', 'signer', 'signatory',
    ],
  },
  {
    category: 'payment_amount',
    label: 'Money amounts on a payment',
    tables: [
      'account_subscriptions',
      'advisor_payout_accounts',
      'advisor_payouts',
      'capital_call_receipts',
      'deal_transfers',
      'engagement_invoices',
      'entity_bank_accounts',
      'fund_capital_calls',
      'fund_distributions',
      'payout_commissions',
      'payouts',
      'portfolio_distributions',
      'promo_codes',
      'promo_redemptions',
      'referral_payouts',
    ],
    columns: [
      'amount_cents', 'amount_due', 'amount_paid',
      'call_amount', 'charge', 'charge_amount',
      'distribution_amount', 'payment_amount', 'payout', 'payout_amount',
      'refund', 'refund_amount', 'wire_amount',
    ],
  },
  {
    category: 'identity_number',
    label: 'Identity numbers',
    tables: [
      'kyc_partner_imports',
    ],
    columns: [
      'account_number', 'bic', 'driver_licence', 'driver_license',
      'ein', 'iban', 'id_number', 'licence_number', 'license_number',
      'national_id', 'passport', 'routing_number', 'sin', 'sort_code',
      'ssn', 'swift', 'tax_id', 'tin', 'vat_number',
    ],
  },
  {
    category: 'legal_attestation',
    label: 'Legal attestations',
    tables: [
      'capital_attestations',
    ],
    columns: [
      'accreditation', 'accredited', 'affirmed',
      'attest', 'attestation', 'attestations', 'attested', 'attests',
      'certified', 'certify', 'sworn',
    ],
  },
]);

/** `signatureName`, `Signature-Name` and `signature_name` all fold to `signature_name`. */
export function foldFieldName(name: unknown): string {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Does `words` contain `token`'s words, contiguously and in order? */
function hasWords(words: readonly string[], token: string): boolean {
  const want = token.split('_');
  for (let i = 0; i + want.length <= words.length; i += 1) {
    if (want.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/**
 * Why this field is never filled — `{ category, label }` — or null when it may be.
 *
 * `field` is `table.column` or a bare field name. Anything that is not a string
 * with a name in it is null: there is nothing to refuse, and the caller's own
 * checks decide whether a nameless fill is a fill at all.
 */
export function neverFillReason(field: unknown): { category: NeverFillCategory; label: string } | null {
  const folded = foldFieldName(field);
  if (!folded) return null;
  const dot = folded.lastIndexOf('.');
  const table = dot >= 0 ? folded.slice(0, dot) : '';
  const column = dot >= 0 ? folded.slice(dot + 1) : folded;
  const words = column.split('_').filter(Boolean);
  for (const rule of NEVER_FILL_RULES) {
    if ((table && rule.tables.includes(table)) || rule.columns.some((t) => hasWords(words, t))) {
      return { category: rule.category, label: rule.label };
    }
  }
  return null;
}

export const isNeverFill = (field: unknown): boolean => neverFillReason(field) !== null;

/** The sentence a refusal shows. The SPA's refusal says the same. */
export function neverFillMessage(field: unknown): string {
  const why = neverFillReason(field);
  return why ? `Eadwyn never fills this field (${why.label.toLowerCase()}). Enter it yourself.` : '';
}
