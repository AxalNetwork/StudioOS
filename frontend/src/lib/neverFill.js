/**
 * The fields Eadwyn never fills (D777, from D720 §9: "Eadwyn drafts; you send").
 *
 * FOUR KINDS OF FIELD, and a fill that names one is refused — in this file for
 * the SPA, and in `cloudflare-worker/src/services/fills/neverFill.ts` for the
 * Worker, which carries the same rules. `cloudflare-worker/test/never_fill.test.ts`
 * fails when the two disagree, so a field added here and not there (or the other
 * way round) cannot ship.
 *
 *   signature_consent  A signature or a consent is the member's own act. A value
 *                      Eadwyn wrote there would be an act nobody performed.
 *   payment_amount     Money on a payment — a capital call, a distribution, a
 *                      payout, a charge, a refund — and the account it moves
 *                      through. A wrong figure here moves money.
 *   identity_number    A number that identifies a person, a company or an
 *                      account: tax ids, passports, licences, bank numbers. A
 *                      model's likeliest output for one is a plausible fake.
 *   legal_attestation  A statement made under the law's weight — accreditation,
 *                      certification, a sworn or affirmed fact. Only the person
 *                      making it can make it.
 *
 * HOW A FIELD IS NAMED. Either `table.column` — what a fill kind's `target()`
 * and `fill_provenance` record — or a bare form-field name, for a form that
 * declares its fields by name. Names are folded to snake_case first, so
 * `signatureName` and `signature_name` are the same field.
 *
 * HOW A RULE MATCHES. A rule refuses every column of the tables it lists, and
 * any column, in any table, whose name contains one of its `columns` tokens as
 * whole words: `consent` matches `marketing_consent` and `consent_given`, never
 * `consentient`. Whole words keep `sin` from refusing `business` and `tin` from
 * refusing `tinted`.
 *
 * THE RULES ARE DATA, NOT CODE, so the Worker's copy can be compared with this
 * one value for value rather than by reading two functions and hoping.
 */

export const NEVER_FILL_RULES = Object.freeze([
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
export function foldFieldName(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Does `words` contain `token`'s words, contiguously and in order? */
function hasWords(words, token) {
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
export function neverFillReason(field) {
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

export const isNeverFill = (field) => neverFillReason(field) !== null;

/** The sentence a refusal shows. The Worker's refusal says the same. */
export function neverFillMessage(field) {
  const why = neverFillReason(field);
  return why ? `Eadwyn never fills this field (${why.label.toLowerCase()}). Enter it yourself.` : '';
}
