/**
 * D1008 (#2386) — Payments at /admin/platform/payments, as pure functions: the
 * addresses and tabs, the moved notice, and the blocks built from the reads
 * that exist today. No React here, so `node --test` loads it alone.
 *
 * The reads (D1008 §2; the page is HQ only, `hqOnly`):
 *   - `catalog`  GET /api/admin/catalog/products — every product in the D1
 *                mirror with its prices, the account's `mode` (from the secret
 *                key's prefix) and the audience labels. A Stripe or D1 failure
 *                is a 502.
 *   - `config`   GET /api/admin/stripe/config — the masked publishable key,
 *                `configured`, and the account's `mode`.
 *   - `webhook`  GET /api/admin/stripe/webhook — Stripe's endpoints, each with
 *                `is_ours` and `missing_events` against `required_events`
 *                (#2393 made that list what the handler acts on); 503 when
 *                Stripe is not configured.
 *   - `summary`  GET /api/admin/platform/summary → `payments_catalog`
 *                (`requireSuperAdmin`): the publishable key's own mode, the
 *                mirror's counts and last write, and webhook deliveries in
 *                24 hours, each block with `available`.
 */

export const PAY_PATH = '/admin/platform/payments';
export const PAY_STRIPE_PATH = '/admin/platform/payments/stripe';
export const PLATFORM_PATH = '/admin/platform';
export const ALLOWANCES_PATH = '/admin/platform/allowances';
export const PAY_TITLE = 'Payments';
export const PAGE_LINE = 'What members can buy, at what price, and whether Stripe and the platform agree.';
export const RAIL_NOTE = 'Eadwyn reads the catalogue on this page. Nothing changes in Stripe until you act.';
export const NOT_YET = 'Not read here yet';
export const CATALOG_FAILED = 'We could not load the catalogue. The rest of Payments still works.';
export const STRIPE_UNREAD = 'Could not be read. The connection was not checked. This is not a claim that Stripe is off.';
export const WEBHOOK_UNREAD = 'Could not be read. Stripe did not answer.';

/** The old address's sentence (#2375's "moved" form). */
export const MOVED_NOTICES = {
  payments: 'The Admin Console has moved: Payments now lives under Platform.',
};

/** The tabs this integration draws (D1008 §1). The change log waits for its read (part 3). */
export const TABS = [
  { key: 'catalogue', label: 'Catalogue', path: '' },
  { key: 'stripe', label: 'Stripe connection', path: '/stripe' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === PAY_PATH) return 'catalogue';
  if (p === PAY_STRIPE_PATH) return 'stripe';
  return null;
}

/** The canvas's words for a product's kind, and the group it sits in. */
const KIND = {
  subscription: { word: 'Plan', group: 'plans' },
  incorporation: { word: 'Incorporation', group: 'oneTime' },
  session: { word: 'Session', group: 'oneTime' },
  alacarte: { word: 'Add-on', group: 'oneTime' },
  token_pack: { word: 'Token pack', group: 'packs' },
};
export const kindWord = (k) => KIND[k]?.word || 'Not recorded';
export const GROUPS = [
  { key: 'plans', label: 'Plans' },
  { key: 'oneTime', label: 'One-time' },
  { key: 'packs', label: 'Token packs' },
];
export const groupOf = (p) => KIND[p?.kind]?.group || 'oneTime';

/** The account's mode in plain words. */
export function modeWord(mode) {
  if (mode === 'live') return 'Live';
  if (mode === 'test') return 'Test';
  if (mode === 'unconfigured') return 'Not connected';
  return 'Not recorded';
}

/**
 * One price as the canvas writes it: "[$20.00] USD / month". The amount is in
 * the currency's smallest unit; a price with no amount is "No fixed amount".
 * Amounts in different currencies are never added.
 */
export function priceText(price) {
  if (!price) return 'Not recorded';
  const cur = String(price.currency || '').toUpperCase();
  const amount = typeof price.unit_amount === 'number'
    ? `${(price.unit_amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`.trim()
    : 'No fixed amount';
  if (!price.interval) return amount;
  const n = Number(price.interval_count) || 1;
  return n === 1 ? `${amount} / ${price.interval}` : `${amount} every ${n} ${price.interval}s`;
}

/** The catalogue in its three groups and the canvas's order: active by name, then archived. */
export function catalogueGroups(products) {
  const list = (products || []).slice().sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name)));
  return GROUPS.map((g) => ({ ...g, rows: list.filter((p) => groupOf(p) === g.key) }));
}

/** The counts the toolbar chips and the Active products tile read: over every product. */
export function catalogueCounts(products) {
  const list = products || [];
  const active = list.filter((p) => p.active);
  return {
    all: list.length,
    active: active.length,
    activePrices: active.reduce((t, p) => t + (p.prices || []).filter((x) => x.active).length, 0),
    byGroup: Object.fromEntries(GROUPS.map((g) => [g.key, list.filter((p) => groupOf(p) === g.key).length])),
  };
}

/** Search over name and product ID; under two characters it does not filter. */
export function searchProducts(products, q) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return products || [];
  return (products || []).filter((p) => [p.name, p.id].some((v) => String(v || '').toLowerCase().includes(s)));
}

/**
 * Whether the publishable key and the account are in the same mode: the
 * account's from the config read (the secret key), the key's own from the
 * Platform summary. Either read missing is "not checked", never "match".
 */
export function keysMatch(config, summary) {
  const account = config?.mode;
  const pub = summary?.publishable;
  if (!account || !pub) return { state: 'unchecked' };
  if (!pub.configured) return { state: 'nokey' };
  if (pub.mode === 'unknown') return { state: 'unknownkey' };
  if (account === 'unconfigured') return { state: 'noaccount' };
  return pub.mode === account ? { state: 'match', mode: account } : { state: 'differ', key: pub.mode, account };
}

/** The "Needs you" items the reads that exist can state (D1008 §3). The catalogue checks are part 2's. */
export function needsYou({ config, summary, webhook }) {
  const out = [];
  const k = keysMatch(config, summary);
  if (k.state === 'differ') out.push({ id: 'keys', text: `The publishable key is ${modeWord(k.key)}, the account is ${modeWord(k.account)}. Checkout and token packs fail until they match.`, to: 'stripe' });
  if (k.state === 'nokey') out.push({ id: 'nokey', text: 'No publishable key is set, so checkout cannot open.', to: 'stripe' });
  if (webhook && Array.isArray(webhook.endpoints)) {
    const ours = webhook.endpoints.filter((e) => e.is_ours);
    if (!ours.length) out.push({ id: 'noendpoint', text: 'Stripe has no endpoint for this platform\'s webhook, so no payment reaches it.', to: 'stripe' });
    for (const e of ours) {
      const n = (e.missing_events || []).length;
      if (n) out.push({ id: `missing-${e.id}`, text: `The webhook misses ${n} event${n === 1 ? '' : 's'} the platform acts on.`, to: 'stripe' });
      if (e.status && e.status !== 'enabled') out.push({ id: `disabled-${e.id}`, text: 'This platform\'s webhook endpoint is disabled in Stripe.', to: 'stripe' });
    }
  }
  return out;
}

/** "18 Oct 2026, 09:12" from D1's zone-less UTC stamp. */
export function stampText(s) {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
