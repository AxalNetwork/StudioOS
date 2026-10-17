/**
 * D707 (#1772) — each Axal entity's role, and each kind of money's payer,
 * payee and rail, as the owner gave them on 2026-10-17.
 *
 *   · Stripe, on Axal VC Management LLC's account, carries only Management's
 *     platform revenue.
 *   · Mercury carries every fund flow (contributions, distributions, fund
 *     expenses, the 2% management fee paid to Axal VC GP LLC, the GP's own
 *     commitment) and the two intercompany platform-licence fees to Axal VC
 *     Holdings LLC.
 *
 * `stripeCall` (`routes/billing.ts`) refuses a create with no kind, or with a
 * kind that is not on Stripe, before the key is read or any request leaves the
 * Worker. A kind this map does not name is refused, never guessed.
 *
 * Imports only `legalDocFormat.ts` (which imports nothing), so fund code
 * (#1773 to #1775) can import this without reaching Stripe code;
 * `test/fund_modules_no_stripe_d707.test.ts` walks `FUND_MODULES` to prove it.
 */
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';

const N = (key: AxalEntityKey) => AXAL_ENTITIES[key].name;

/** Decision 1: one role per entity. The LLC sentences are built from the entity names. */
export const ENTITY_ROLES: Readonly<Record<AxalEntityKey, string>> = Object.freeze({
  holdings: `${N('holdings')} licenses the software IP platform to ${N('management')} for management administration, and to ${N('gp')} for fund administration.`,
  management: `${N('management')} operates between the different partners as Managing Partner under the Spin-Out Lab, and manages the other operating partners across the platform.`,
  gp: `${N('gp')} is the General Partner that manages the Fund's investors, and the founders getting funding through ${N('fund')}.`,
  // `frontend/src/brand/gvpn.ts`'s Fund role, verbatim.
  fund: `Limited partnership pooling LP capital. Managed exclusively by ${N('gp')} as general partner.`,
});

export type MoneyParty = AxalEntityKey | 'customer' | 'lp' | 'vendor';
export type MoneyRail = 'stripe' | 'mercury';
export type MoneyGroup = 'platform' | 'fund' | 'intercompany';

export type MoneyKind =
  | 'platform_plan' | 'investor_tier' | 'partner_service' | 'marketplace'
  | 'capital_contribution' | 'distribution' | 'fund_expense' | 'management_fee' | 'gp_commitment'
  | 'licence_fee_management_admin' | 'licence_fee_fund_admin';

export type MoneyKindRow = Readonly<{
  kind: MoneyKind; label: string; payer: MoneyParty; payee: MoneyParty; rail: MoneyRail; group: MoneyGroup;
}>;

/** Decision 2: the rails map. */
export const MONEY_KINDS: readonly MoneyKindRow[] = Object.freeze([
  { kind: 'platform_plan', label: 'Plans and subscriptions', payer: 'customer', payee: 'management', rail: 'stripe', group: 'platform' },
  { kind: 'investor_tier', label: 'Investor tiers', payer: 'customer', payee: 'management', rail: 'stripe', group: 'platform' },
  { kind: 'partner_service', label: 'Partner and operating-partner services', payer: 'customer', payee: 'management', rail: 'stripe', group: 'platform' },
  { kind: 'marketplace', label: 'Marketplace and perks', payer: 'customer', payee: 'management', rail: 'stripe', group: 'platform' },
  { kind: 'capital_contribution', label: 'Capital contributions', payer: 'lp', payee: 'fund', rail: 'mercury', group: 'fund' },
  { kind: 'distribution', label: 'Distributions', payer: 'fund', payee: 'lp', rail: 'mercury', group: 'fund' },
  { kind: 'fund_expense', label: 'Fund expenses', payer: 'fund', payee: 'vendor', rail: 'mercury', group: 'fund' },
  { kind: 'management_fee', label: 'Management fee (2%)', payer: 'fund', payee: 'gp', rail: 'mercury', group: 'fund' },
  { kind: 'gp_commitment', label: 'GP commitment', payer: 'gp', payee: 'fund', rail: 'mercury', group: 'fund' },
  { kind: 'licence_fee_management_admin', label: 'Platform licence fee, management administration', payer: 'management', payee: 'holdings', rail: 'mercury', group: 'intercompany' },
  { kind: 'licence_fee_fund_admin', label: 'Platform licence fee, fund administration', payer: 'gp', payee: 'holdings', rail: 'mercury', group: 'intercompany' },
].map((row) => Object.freeze(row as MoneyKindRow)));

export type StripeMoneyKind = 'platform_plan' | 'investor_tier' | 'partner_service' | 'marketplace';
/** The four platform kinds: the only money Stripe carries. */
export const STRIPE_MONEY_KINDS: readonly StripeMoneyKind[] = Object.freeze(
  MONEY_KINDS.filter((row) => row.rail === 'stripe').map((row) => row.kind as StripeMoneyKind),
);

const BY_KIND = new Map<string, MoneyKindRow>(MONEY_KINDS.map((row) => [row.kind, row]));

/** The rail a kind travels on, or null for a kind this map does not name. */
export function railFor(kind: unknown): MoneyRail | null {
  return typeof kind === 'string' ? BY_KIND.get(kind)?.rail ?? null : null;
}

export type MoneyRailErrorCode = 'money_kind_required' | 'money_kind_unknown' | 'money_kind_not_on_stripe';

export class MoneyRailError extends Error {
  code: MoneyRailErrorCode;
  constructor(code: MoneyRailErrorCode, message: string) {
    super(message);
    this.name = 'MoneyRailError';
    this.code = code;
  }
}

/** Throws unless `kind` is one of the four platform kinds Stripe carries. */
export function assertStripeMoneyKind(kind: unknown): asserts kind is StripeMoneyKind {
  if (kind === undefined || kind === null || kind === '') {
    throw new MoneyRailError('money_kind_required', 'A Stripe charge must name the kind of money it takes.');
  }
  const row = typeof kind === 'string' ? BY_KIND.get(kind) : undefined;
  if (!row) throw new MoneyRailError('money_kind_unknown', `Unknown money kind: ${String(kind)}.`);
  if (row.rail !== 'stripe') {
    throw new MoneyRailError('money_kind_not_on_stripe', `${row.label} travels on Mercury, never on Stripe.`);
  }
}

/** Decision 2: today's `metadata[kind]` values, each with its money kind. */
export const MONEY_KIND_FOR_STRIPE_METADATA: Readonly<Record<string, StripeMoneyKind>> = Object.freeze({
  mi: 'platform_plan',
  tier: 'platform_plan',
  plan: 'platform_plan',
  investor: 'investor_tier',
  advisor_session: 'partner_service',
  alacarte: 'marketplace',
  intro_credits: 'marketplace',
  cart_order: 'marketplace',
  incorporation: 'marketplace',
  event_ticket: 'marketplace',
  expert_booking: 'marketplace',
});

/**
 * A catalog price's kind: a recurring price is `investor_tier` when its
 * product is an investor tier (`metadata.investor_tier` professional or
 * institutional, as `services/catalog.ts` tests), else `platform_plan`; a
 * one-time price is `marketplace`.
 */
export function moneyKindForCatalogPrice(
  product: { metadata?: Record<string, string> | null },
  price: { type?: string | null },
): StripeMoneyKind {
  if (price?.type === 'recurring') {
    const tier = product?.metadata?.investor_tier;
    return tier === 'professional' || tier === 'institutional' ? 'investor_tier' : 'platform_plan';
  }
  return 'marketplace';
}

/**
 * Every fund module, relative to `cloudflare-worker/src`. No file reachable
 * from these imports Stripe code (`test/fund_modules_no_stripe_d707.test.ts`),
 * and the test fails if a `fund*`, `capital*`, `_capital*`, `lp_*` or
 * `distributions.ts` file under `routes/`, `services/` or `models/` is missing.
 */
export const FUND_MODULES: readonly string[] = Object.freeze([
  'models/distributions.ts',
  'models/funds.ts',
  'routes/_capital_call_writes.ts',
  'routes/capital.ts',
  'routes/fund_admin.ts',
  'routes/fund_fees.ts',
  'routes/fund_ledger.ts',
  'routes/fund_performance.ts',
  'routes/fund_reporting.ts',
  'routes/fund_simulator.ts',
  'routes/funds.ts',
  'routes/lp_reports.ts',
  'services/fundAdminAccess.ts',
  'services/fundCallLedger.ts',
  'services/fundCallSplit.ts',
  'services/fundDistributionSplit.ts',
  'services/fundFeeCalc.ts',
  'services/fundFees.ts',
  'services/fundGpAccess.ts',
  'services/fundGpSchema.ts',
  'services/fundLedger.ts',
  'services/fundLpComms.ts',
  'services/fundPerformance.ts',
  'services/fundReportBuild.ts',
  'services/fundReportDrafts.ts',
  'services/fundReports.ts',
  'services/fundRollup.ts',
  'services/fundSheets.ts',
]);
