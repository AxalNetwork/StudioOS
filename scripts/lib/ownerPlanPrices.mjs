/** D1430 (#3702): the owner's price targets, for offline planning and drift checks.
 * Runtime prices remain Stripe's catalogue mirrored in D1, never this table. */
export const OWNER_PLAN_PRICES = Object.freeze([
  { licence_key: 'founder:growth', metadata_key: 'tier', metadata_value: 'growth', name: 'Validate + Build', month: 2000, year: 20400 },
  { licence_key: 'founder:studio', metadata_key: 'tier', metadata_value: 'studio', name: 'Raise + Grow', month: 10000, year: 102000 },
  { licence_key: 'investor:plus', metadata_key: 'investor_tier', metadata_value: 'plus', name: 'Investor Plus', month: 5000, year: 51000 },
  { licence_key: 'investor:professional', metadata_key: 'investor_tier', metadata_value: 'professional', name: 'Investor Pro', month: 15000, year: 153000 },
  { licence_key: 'advisor', metadata_key: 'plan_group', metadata_value: 'advisor', name: 'Advisor Pro', month: 2000, year: 20400 },
  { licence_key: 'partner', metadata_key: 'plan_group', metadata_value: 'partner', name: 'Operating Partner Pro', month: 2000, year: 20400 },
].map(Object.freeze));
export const OWNER_UNPRICED = Object.freeze({ 'investor:institutional': 'custom', lp_access: 'free', admin: 'staff' });
export const pricesForMetadata = (key) => Object.freeze(OWNER_PLAN_PRICES.filter(p => p.metadata_key === key)
  .map(p => Object.freeze({ tier: p.metadata_value, name: p.name, month: p.month, year: p.year })));
