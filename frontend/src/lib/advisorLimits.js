/**
 * How much an advisor may write, and the currencies a price list supports
 * (D4674). The same numbers as `cloudflare-worker/src/services/advisorLimits.ts`,
 * which refuses a value over its limit instead of cutting it;
 * `test/advisor_expertise_d4674.test.mjs` holds the two equal.
 */
export const SERVICE_LIMITS = { title: 200, duration_note: 200, scope: 2000 };
export const PROFILE_LIMITS = {
  display_name: 200, bio: 4000, linkedin_url: 500, headline: 200, country: 100,
  timezone: 100, availability_note: 500, headshot_url: 1000,
};
export const LIST_MAX_ITEMS = 32;
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD'];
