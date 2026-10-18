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

// ─────────────────────────────────────────────────────────── D752 §4 (#1890): what Axal's admins read

/** The most statements one admin read returns, and the most other active statements beside each. */
export const ADMIN_READ_LIMIT = 500;
export const OTHER_ACTIVE_MAX = 10;

/** Today in UTC, `YYYY-MM-DD`. */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** The label from the purpose and ids alone; the screen around it already names the deal, applicant or LP. */
export function adminTargetLabel(purpose: AttestationPurpose, dealId: number | null): string {
  if (purpose === 'deal_commitment') return `Commitment on deal #${dealId ?? '?'}`;
  if (purpose === 'lp_application') return 'Fund I application';
  return 'Fund I commitment';
}

export const REVOKED_SENTENCE = (date: string): string => `Revoked by the investor on ${date}.`;

export interface AdminAttestationRow {
  id: number;
  uid: string;
  user_id: number;
  purpose: AttestationPurpose;
  target_id: number;
  deal_id: number | null;
  fund_id: number | null;
  amount_floor_cents: number;
  as_of: string;
  expires_on: string;
  holder_name: string;
  accounts_counted: number;
  consented_at: string;
  state: AttestationState;
  revoked_at: string | null;
  investor_name: string | null;
}

/**
 * One statement per (investor, purpose, target): the active one, else the
 * newest revoked one. A superseded statement is never kept.
 */
export function currentPerTarget<T extends Pick<AdminAttestationRow, 'id' | 'user_id' | 'purpose' | 'target_id' | 'state' | 'revoked_at'>>(rows: T[]): T[] {
  const by = new Map<string, T>();
  for (const r of rows) {
    if (r.state === 'superseded') continue;
    const k = `${r.user_id}:${r.purpose}:${r.target_id}`;
    const have = by.get(k);
    if (!have) { by.set(k, r); continue; }
    if (have.state === 'active') continue;
    if (r.state === 'active') { by.set(k, r); continue; }
    const newer = String(r.revoked_at ?? '') > String(have.revoked_at ?? '')
      || (String(r.revoked_at ?? '') === String(have.revoked_at ?? '') && Number(r.id) > Number(have.id));
    if (newer) by.set(k, r);
  }
  return [...by.values()];
}

export type ProofState = 'active' | 'expired' | 'revoked' | 'none';

/** One application's state for the queue: no amount, no holder, no date. */
export function proofState(rows: Array<Pick<AdminAttestationRow, 'state' | 'expires_on'>>, today: string): ProofState {
  const active = rows.find((r) => r.state === 'active');
  if (active) return isExpired(active.expires_on, today) ? 'expired' : 'active';
  return rows.some((r) => r.state === 'revoked') ? 'revoked' : 'none';
}

export type OtherActive = Pick<AdminAttestationRow, 'uid' | 'purpose' | 'deal_id' | 'amount_floor_cents' | 'as_of' | 'expires_on'>;

/**
 * What an admin reads about one statement, built field by field. A revoked
 * statement carries its date and nothing it once said: no amount, holder,
 * date read, account count or other statements.
 */
export function adminDto(row: AdminAttestationRow, today: string, others: OtherActive[] = []) {
  const base = {
    uid: row.uid,
    purpose: row.purpose,
    target_id: Number(row.target_id),
    deal_id: row.deal_id == null ? null : Number(row.deal_id),
    fund_id: row.fund_id == null ? null : Number(row.fund_id),
    investor_user_id: Number(row.user_id),
    investor_name: row.investor_name ?? null,
    target_label: adminTargetLabel(row.purpose, row.deal_id == null ? null : Number(row.deal_id)),
  };
  if (row.state === 'revoked') {
    const on = String(row.revoked_at ?? '').slice(0, 10);
    return { ...base, state: 'revoked' as const, label: 'Revoked' as const, revoked_on: on, statement: REVOKED_SENTENCE(on) };
  }
  const expired = isExpired(row.expires_on, today);
  const sorted = [...others].sort((a, b) => String(b.as_of).localeCompare(String(a.as_of)));
  return {
    ...base,
    state: 'active' as const,
    label: expired ? 'Expired' as const : 'Active' as const,
    expired,
    amount_floor_cents: Number(row.amount_floor_cents),
    as_of: row.as_of,
    expires_on: row.expires_on,
    holder_name: row.holder_name,
    accounts_counted: Number(row.accounts_counted),
    shared_on: String(row.consented_at).slice(0, 10),
    statement: statementSentence(row),
    other_active: sorted.slice(0, OTHER_ACTIVE_MAX).map((o) => ({
      purpose: o.purpose,
      target_label: adminTargetLabel(o.purpose, o.deal_id == null ? null : Number(o.deal_id)),
      amount_floor_cents: Number(o.amount_floor_cents),
      as_of: o.as_of,
      expired: isExpired(o.expires_on, today),
    })),
    other_active_count: others.length,
  };
}
