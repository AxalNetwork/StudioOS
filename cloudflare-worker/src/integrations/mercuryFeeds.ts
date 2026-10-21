/**
 * D840 (#2346) — what a member's own Mercury feeds, as the code builds it.
 *
 * ONE LIST, HELD BY A TEST. Each entry is one use of a member's Mercury: the
 * role it serves, the module it lands in (null when it lands in no module),
 * the MCP tools its sign-in calls, and the decision that built it. The
 * registry's personal `feeds` (`PERSONAL_MERCURY`) and the connector page's
 * tools (`connectorPages.ts`) are held to this list by
 * `mercury_feeds_d840.test.ts`, as `github_code_system_d782.test.ts` holds
 * GitHub's page to `githubFeeds.ts`, so the page never claims a feed the code
 * does not build.
 *
 * Part 1 adds no landing: the entries below are D713's and D752's uses, which
 * now read either way the member connected. D840's parts 2–4 (#2347 Raise,
 * #2348 Grow, #2349 investor sections) each add theirs here, with the tools
 * they call from `MERCURY_READ_TOOLS`.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export type MercuryFeedRole = 'founder' | 'partner' | 'investor';

export interface MercuryFeed {
  /** `PersonalUse` in `services/mercuryPersonal.ts`, or a D840 part's own key. */
  key: string;
  role: MercuryFeedRole;
  what: string;
  /** A `moduleLabels.ts` key, or null when the use lands in no module. */
  module: string | null;
  /** The `MERCURY_READ_TOOLS` names a sign-in calls for this use. */
  tools: readonly string[];
  decision: string;
}

const BANK_LINES = ['getOrganization', 'getAccounts', 'listTransactions', 'getTransactionById'] as const;

export const MERCURY_FEEDS: readonly MercuryFeed[] = Object.freeze([
  { key: 'venture_revenue', role: 'founder', what: 'Credits you import as venture revenue', module: 'revenue_and_traction', tools: BANK_LINES, decision: 'D713' },
  { key: 'venture_spend', role: 'founder', what: 'Each month’s spending, burn, cash on hand and runway', module: 'revenue_and_traction', tools: ['getOrganization', 'getAccounts', 'listTransactions'], decision: 'D752' },
  { key: 'raise_receipts', role: 'founder', what: 'A wire matched to a raise prospect or a commitment', module: null, tools: BANK_LINES, decision: 'D752' },
  { key: 'practice_income', role: 'partner', what: 'An invoice matched to the credit that paid it', module: null, tools: BANK_LINES, decision: 'D713' },
  { key: 'partner_deals', role: 'partner', what: 'A payout or settlement matched to its line', module: null, tools: BANK_LINES, decision: 'D713' },
  // D840 part 3 (#2348): the founder's Grow modules, landed by `services/mercury/growFeeds.ts`.
  { key: 'grow_revenue', role: 'founder', what: 'Each month’s money in and net burn, invoices paid, open and overdue, and the credits that match a paid invoice', module: 'revenue_and_traction', tools: ['getAccounts', 'listTransactions', 'listInvoices', 'listCustomers'], decision: 'D840' },
  { key: 'grow_durable', role: 'founder', what: 'Cash, treasury and runway, for your team only', module: 'durable_company_building', tools: ['getAccounts', 'listTransactions', 'getTreasury'], decision: 'D840' },
  { key: 'grow_team', role: 'founder', what: 'Payroll by month, for your team only', module: 'team_expansion', tools: ['listTransactions'], decision: 'D840' },
  { key: 'grow_distribution', role: 'founder', what: 'Marketing and advertising spend by month and by channel, for your team only', module: 'distribution', tools: ['listTransactions'], decision: 'D840' },
  { key: 'grow_partners', role: 'founder', what: 'Payments to an Axal partner, proposed for you to link', module: 'partner_network', tools: ['listTransactions'], decision: 'D840' },
  { key: 'capital_attestation', role: 'investor', what: 'A dated proof of funds of at least an amount you choose', module: null, tools: ['getOrganization', 'getAccounts'], decision: 'D752' },
] as const);

/** D840 part 3: the Grow landings, by module (the keys `growFeeds.ts` writes to the ledger). */
export const GROW_FEED_KINDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  revenue_and_traction: ['metric_month', 'credit', 'invoices_paid', 'invoices_open', 'invoices_overdue'],
  durable_company_building: ['cash', 'treasury', 'runway'],
  team_expansion: ['payroll'],
  distribution: ['marketing_spend', 'channel_spend'],
  partner_network: ['partner_payment'],
});

/** The modules a role's Mercury feeds, in the list's order. */
export function mercuryFedModules(role: string | null | undefined): string[] {
  const r = String(role || '').toLowerCase();
  return [...new Set(MERCURY_FEEDS.filter((f) => f.role === r && f.module !== null).map((f) => f.module as string))];
}

/** The MCP tools a role's sign-in calls, in `MERCURY_FEEDS`' order. */
export function mercuryFeedTools(role: string | null | undefined): string[] {
  const r = String(role || '').toLowerCase();
  return [...new Set(MERCURY_FEEDS.filter((f) => f.role === r).flatMap((f) => [...f.tools]))];
}
