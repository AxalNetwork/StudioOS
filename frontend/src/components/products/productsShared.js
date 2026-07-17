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
