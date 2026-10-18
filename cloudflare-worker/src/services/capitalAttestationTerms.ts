/**
 * D752 (#1888) — the words and rules of an investor's proof of capital, pure:
 * no D1, no Hono, nothing from the bank code. `services/capitalAttestations.ts`
 * builds statements with it, and #1890's admin reads import the same words,
 * so the statement has one copy.
 *
 * A statement says "at least $X was available on <as_of>, held by <holder>".
 * $X is a floor the investor chose, in whole dollars, never a balance or a
 * range (a range would disclose an upper bound). It is labelled expired 30
 * days after its date; it stays true for that date.
 */

export const ATTESTATION_PURPOSES = Object.freeze(['deal_commitment', 'lp_application', 'lp_commitment'] as const);
export type AttestationPurpose = typeof ATTESTATION_PURPOSES[number];
export const ATTESTATION_STATES = Object.freeze(['active', 'superseded', 'revoked'] as const);
export type AttestationState = typeof ATTESTATION_STATES[number];

/** $1,000, the smallest floor (migration 491 refuses less). */
export const MIN_FLOOR_CENTS = 100_000;
export const VALID_DAYS = 30;
export const MAX_ACCOUNTS = 20;

/**
 * The words the investor agrees to. A change to the template is a new
 * version: `capital_attestations_d752.test.ts` holds the two together.
 */
export const CONSENT_VERSION = 'd752-1';
export const CONSENT_TEMPLATE =
  'I ask StudioOS to read, now, the available balance of the {accounts} Mercury accounts I picked, and to share one statement with Axal\'s admins: ' +
  'at least {amount} was available on {as_of}, in accounts held by {holder}. StudioOS keeps and shows no balance. ' +
  'The statement is labelled expired after 30 days, and I can revoke it at any time.';

export const isPurpose = (v: unknown): v is AttestationPurpose => typeof v === 'string' && (ATTESTATION_PURPOSES as readonly string[]).includes(v);

/** Cents rounded down to whole dollars; null for null, a non-finite value or a value of 0 or less. */
export function wholeDollarCap(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents <= 0) return null;
  return Math.floor(cents / 100) * 100;
}

/** Computed, never stored: a statement past its `expires_on` reads expired, and keeps its state. */
export const isExpired = (expiresOn: string, today: string): boolean => expiresOn < today;

/** Whole dollars with thousands separators and no cents: 128456700 → "$1,284,567". */
export function dollars(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString('en-US')}`;
}

export interface AttestationRow {
  uid: string;
  purpose: AttestationPurpose;
  target_id: number;
  deal_id: number | null;
  fund_id: number | null;
  amount_floor_cents: number;
  as_of: string;
  expires_on: string;
  holder_name: string;
  accounts_counted: number;
  consent_version: string;
  consented_at: string;
  state: AttestationState;
  revoked_at: string | null;
  admin_view_count: number;
  last_admin_view_at: string | null;
  project_name?: string | null;
  fund_name?: string | null;
}

/** "At least $X available at Mercury on <as_of>, held by <holder>, across <n> accounts. Shared by the investor on <date>." */
export function statementSentence(row: Pick<AttestationRow, 'amount_floor_cents' | 'as_of' | 'holder_name' | 'accounts_counted' | 'consented_at'>): string {
  const n = Number(row.accounts_counted);
  return `At least ${dollars(Number(row.amount_floor_cents))} available at Mercury on ${row.as_of}, held by ${row.holder_name}, ` +
    `across ${n} ${n === 1 ? 'account' : 'accounts'}. Shared by the investor on ${String(row.consented_at).slice(0, 10)}.`;
}

/** "<project> · deal commitment", "Fund I application" or "<fund> commitment". */
export function targetLabel(purpose: AttestationPurpose, names: { project_name?: string | null; fund_name?: string | null } = {}): string {
  if (purpose === 'deal_commitment') return `${names.project_name || 'Deal'} · deal commitment`;
  if (purpose === 'lp_application') return 'Fund I application';
  return `${names.fund_name || 'Fund I'} commitment`;
}

/** What the investor reads about their own statement. Built field by field; the row is never spread. */
export function ownerDto(row: AttestationRow, today: string) {
  return {
    uid: row.uid,
    purpose: row.purpose,
    target_id: Number(row.target_id),
    deal_id: row.deal_id == null ? null : Number(row.deal_id),
    fund_id: row.fund_id == null ? null : Number(row.fund_id),
    target_label: targetLabel(row.purpose, { project_name: row.project_name, fund_name: row.fund_name }),
    amount_floor_cents: Number(row.amount_floor_cents),
    as_of: row.as_of,
    expires_on: row.expires_on,
    expired: isExpired(row.expires_on, today),
    holder_name: row.holder_name,
    accounts_counted: Number(row.accounts_counted),
    consent_version: row.consent_version,
    consented_at: row.consented_at,
    state: row.state,
    revoked_at: row.revoked_at ?? null,
    admin_view_count: Number(row.admin_view_count),
    last_admin_view_at: row.last_admin_view_at ?? null,
    statement: statementSentence(row),
  };
}
