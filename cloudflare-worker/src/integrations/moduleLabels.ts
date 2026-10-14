export const MODULE_LABELS: Record<string, string> = {
  product_roadmap: 'Product roadmap',
  prototype_mvp: 'Prototype / MVP',
  capital_relationships: 'Capital relationships',
  network: 'Network',
  customer_research: 'Customer research',
  founding_team: 'Founding team',
  company_creation: 'Company creation',
  market_intelligence: 'Market intelligence',
  revenue_and_traction: 'Revenue and traction',
  customers: 'Customers',
  operating_systems: 'Operating systems',
};


/** D686: module doors for recorded connector deliveries. Unknown keys have no door. */
export const MODULE_HREFS: Record<string, string> = {
  product_roadmap: '/build/product-roadmap',
  prototype_mvp: '/build/prototype-mvp',
  founding_team: '/build/founding-team',
  company_creation: '/build/company-creation',
  operating_systems: '/build/operating-systems',
  capital_relationships: '/raise/capital-relationships',
  customer_research: '/validate/customer-research',
  market_intelligence: '/validate/market-intelligence',
  revenue_and_traction: '/grow/revenue-and-traction',
  customers: '/grow/customers',
  network: '/network',
};

export function moduleHref(key: string): string | null {
  return Object.hasOwn(MODULE_HREFS, key) ? MODULE_HREFS[key] : null;
}
