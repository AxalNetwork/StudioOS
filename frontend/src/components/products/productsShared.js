// Shared helpers for the Products storefront (catalog-driven, cart, checkout).
// Prices ALWAYS come from GET /catalog/products — never hardcoded, never
// client-computed. VAT is a display estimate; the server is authoritative.

// UAE / Dubai billing country ⇒ 5% VAT, else 0%. Mirrors the pinned contract.
const UAE_VALUES = new Set(['ae', 'uae', 'united arab emirates', 'dubai']);
export function vatRate(billingCountry) {
  const v = (billingCountry || '').trim().toLowerCase();
  return UAE_VALUES.has(v) ? 0.05 : 0;
}

export function formatMoney(cents, currency) {
  const amt = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: (currency || 'usd').toUpperCase(),
    }).format(amt);
  } catch {
    return `${amt.toFixed(2)} ${(currency || 'USD').toUpperCase()}`;
  }
}

export function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// Billing cycle helpers. A catalog price is either recurring (interval month|year)
// or one_time. We expose a normalized "cycle" per price for the toggle.
//   'monthly' | 'yearly' | 'onetime'
export function priceCycle(price) {
  if (!price) return null;
  if (price.type === 'one_time' || (!price.interval && price.type !== 'recurring')) return 'onetime';
  const interval = price.interval || price.recurring?.interval;
  if (interval === 'year') return 'yearly';
  if (interval === 'month') return 'monthly';
  // Recurring without a recognized interval — treat as monthly for display.
  return price.type === 'recurring' ? 'monthly' : 'onetime';
}

// Active prices only, grouped by cycle. Returns { monthly, yearly, onetime } →
// each is the first matching active price (or null).
export function pricesByCycle(product) {
  const out = { monthly: null, yearly: null, onetime: null };
  const prices = Array.isArray(product?.prices) ? product.prices : [];
  for (const p of prices) {
    if (!p || p.active === false) continue;
    const c = priceCycle(p);
    if (c && !out[c]) out[c] = p;
  }
  return out;
}

// The set of cycles this product actually sells (has a real Stripe price for).
export function availableCycles(product) {
  const by = pricesByCycle(product);
  return ['monthly', 'yearly', 'onetime'].filter((c) => by[c]);
}

export function isOneTimeProduct(product) {
  const cycles = availableCycles(product);
  return cycles.length > 0 && cycles.every((c) => c === 'onetime');
}

export function isSubscriptionProduct(product) {
  return availableCycles(product).some((c) => c === 'monthly' || c === 'yearly');
}

export function cycleUnitLabel(cycle) {
  if (cycle === 'monthly') return '/mo';
  if (cycle === 'yearly') return '/yr';
  return 'one-time';
}

export function cycleCadenceLabel(cycle) {
  if (cycle === 'monthly') return 'Billed monthly';
  if (cycle === 'yearly') return 'Billed annually';
  return 'One-time purchase';
}

// Pick the price to feature for a product given the global page toggle.
// Falls back to any available cycle when the requested one is missing.
export function pickPriceForCycle(product, globalCycle) {
  const by = pricesByCycle(product);
  if (by[globalCycle]) return { price: by[globalCycle], cycle: globalCycle };
  // Preference order when the requested cycle isn't sold.
  for (const c of ['onetime', 'monthly', 'yearly']) {
    if (by[c]) return { price: by[c], cycle: c };
  }
  return { price: null, cycle: null };
}

export function productDescription(product) {
  return product?.metadata?.description || product?.description || '';
}

// Audience filter chips — local fallback so the bar renders before the
// catalog response (which also carries `audience_categories`).
export const AUDIENCE_FILTERS = [
  { value: 'founders', label: 'For Founders' },
  { value: 'investors_lps', label: 'For Investors / LPs' },
  { value: 'service_partners', label: 'For Service Partners' },
  { value: 'advisors', label: 'For Advisors' },
  { value: 'legal_services', label: 'Legal Services' },
];

// ---------- Profile-bundle presentation (Products redesign) ----------
// Colored role badges per the design handoff (Products.dc).
export const PROFILE_BADGES = {
  founders: { label: 'Founder', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-600/10' },
  investors_lps: { label: 'Investor / LP', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-600/10' },
  advisors: { label: 'Advisor', text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-600/10' },
  service_partners: { label: 'Service Partner', text: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-600/10' },
  legal_services: { label: 'Legal Services', text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-600/10' },
};

export function profileForProduct(product) {
  const cats = Array.isArray(product?.categories) ? product.categories : [];
  const key = ['founders', 'investors_lps', 'advisors', 'service_partners', 'legal_services']
    .find((k) => cats.includes(k));
  return key ? { key, ...PROFILE_BADGES[key] } : null;
}

// Static design copy for the profile-bundle cards (feature bullets + persona,
// from the design handoff). Prices are NEVER taken from here — they always
// come from the live catalog. Keyed by exact product name; a catalog product
// without an entry falls back to its own description.
export const BUNDLE_CONTENT = {
  'Founder — Growth': {
    persona: 'Pre-seed and seed-stage founders building their first cap table and preparing for institutional outreach.',
    features: [
      'Build and share a live cap table with prospective investors',
      'Prepare institutional outreach with a guided data room',
      'Warm introductions to seed-stage funds',
      'Track every investor conversation in one pipeline',
      'Verified founder badge on your profile',
      'Portfolio profile surfaced to matched investors',
    ],
  },
  'Founder — Studio': {
    persona: 'Repeat founders and studio operators managing multiple portfolio companies and advisory relationships.',
    features: [
      'Manage multiple portfolio companies from one account',
      'Track advisory relationships with equity records',
      'Priority matching across the studio network',
      'Team seats for operators and analysts',
      'Consolidated deal flow across ventures',
      'Dedicated partnerships desk',
    ],
  },
  'Investor — Professional': {
    persona: 'Angels and emerging managers deploying $250K–$2M annually across direct deals and syndicates.',
    features: [
      'Verified investor badge',
      'Full deal flow access across sectors',
      'Portfolio tracking for up to 50 deals',
      'Direct messaging with founders',
      'Participate in SPV syndicates as a named LP',
      'Priority matching in introductions',
    ],
  },
  'Investor — Institutional': {
    persona: 'Family offices, fund managers, and institutional LPs managing multi-vehicle portfolios at scale.',
    features: [
      'Everything in Professional',
      'Multi-vehicle portfolio tracking, unlimited deals',
      'Dedicated coverage and onboarding',
      'Co-investment and syndicate lead tools',
      'Team seats with role permissions',
      'API access to portfolio data',
    ],
  },
  'Advisor': {
    persona: 'Operators and executives building a structured advisory portfolio with equity tracking and founder access.',
    features: [
      'Build a structured advisory portfolio with equity tracking',
      'Verified advisor badge',
      'Founder access and warm introductions',
      'Track vesting and advisory agreements',
      'Priority matching to relevant founders',
    ],
  },
  'Service Partner': {
    persona: 'Law firms, accountants, and service providers seeking deal-qualified referrals from verified founders and funds.',
    features: [
      'Deal-qualified referrals from verified founders and funds',
      'Verified service partner badge',
      'Listed in the Axal partner directory',
      'Direct inbound from matched clients',
      'Track your referral pipeline and outcomes',
    ],
  },
};

export const MOST_POPULAR_BUNDLE = 'Investor — Professional';

// A "profile bundle" is a role subscription (Founder/Investor/Advisor/Partner
// tiers). Detected from catalog metadata (tier markers) or by having design
// copy above; every other product renders in "Add-ons & services".
export function isBundleProduct(product) {
  const meta = product?.metadata || {};
  const kind = product?.kind || meta.kind;
  if (kind !== 'subscription') return false;
  return Boolean(meta.tier || meta.investor_tier || BUNDLE_CONTENT[product?.name]);
}
