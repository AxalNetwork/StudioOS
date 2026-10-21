export const MODULE_LABELS: Record<string, string> = {
  product_roadmap: 'Product roadmap',
  prototype_mvp: 'Prototype / MVP',
  solution_design: 'Solution design',
  capital_relationships: 'Capital relationships',
  network: 'Network',
  customer_research: 'Customer research',
  founding_team: 'Founding team',
  company_creation: 'Company creation',
  market_intelligence: 'Market intelligence',
  revenue_and_traction: 'Revenue and traction',
  customers: 'Customers',
  operating_systems: 'Operating systems',
  // D757 §2.12: the Validate modules a Zoom transcript suggests into; names as `cycleValidate.ts` MODULES.
  problem_discovery: 'Problem discovery',
  ideal_customer_profile: 'Ideal customer profile',
  demand_signals: 'Demand and urgency signals',
  experiments: 'Experiments and evidence',
  verdict: 'Verdict',
  // D840 part 2 (#2347): the Raise modules the founder's own Mercury feeds; names as `raiseCycle.ts` MODULES.
  fundraising_readiness: 'Fundraising readiness',
  use_of_funds: 'Use of funds',
  data_room: 'Data room',
  cap_table: 'Cap table',
  investor_narrative: 'Investor narrative',
  pitch_deck: 'Pitch deck',
  // D840 part 4 (#2349): the investor's sections a signed-in Mercury feeds.
  deals_commit: 'Deals · Commit',
  deals_closing: 'Deals · Closing',
  fund_calls: 'Fund · Calls',
  fund_ledger: 'Fund · Accounting',
  fund_reporting: 'Fund · Reporting',
};


/** D686: module doors for recorded connector deliveries. Unknown keys have no door. */
export const MODULE_HREFS: Record<string, string> = {
  product_roadmap: '/build/product-roadmap',
  prototype_mvp: '/build/prototype-mvp',
  solution_design: '/build/solution-design',
  founding_team: '/build/founding-team',
  company_creation: '/build/company-creation',
  operating_systems: '/build/operating-systems',
  capital_relationships: '/raise/capital-relationships',
  customer_research: '/validate/customer-research',
  market_intelligence: '/validate/market-intelligence',
  problem_discovery: '/validate/problem-discovery',
  ideal_customer_profile: '/validate/ideal-customer-profile',
  demand_signals: '/validate/demand-signals',
  experiments: '/validate/experiments',
  verdict: '/validate/verdict',
  revenue_and_traction: '/grow/revenue-and-traction',
  customers: '/grow/customers',
  network: '/network',
  fundraising_readiness: '/raise/fundraising-readiness',
  use_of_funds: '/raise/use-of-funds',
  data_room: '/raise/data-room',
  cap_table: '/raise/cap-table',
  investor_narrative: '/raise/investor-narrative',
  pitch_deck: '/raise/pitch-deck',
  deals_commit: '/deals/commit',
  deals_closing: '/deals/closing',
  fund_calls: '/funds/calls',
  fund_ledger: '/funds/ledger',
  fund_reporting: '/funds/reporting',
};

export function moduleHref(key: string): string | null {
  return Object.hasOwn(MODULE_HREFS, key) ? MODULE_HREFS[key] : null;
}
