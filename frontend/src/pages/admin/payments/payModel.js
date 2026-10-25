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
 *
 * D1014 (#2833, part 6) adds two reads of part 3's client (D1011,
 * `lib/api/payments.js`), each answering alone:
 *   - `deliveries` GET /api/admin/payments/webhook-deliveries — 24 clock hours,
 *                oldest first, the last one partial. An hour the request log
 *                holds nothing for is null: drawn as the dashed no-log hour,
 *                never as 0. 503 when the log does not answer.
 *   - the change log GET /api/admin/payments/change-log — newest first, paged,
 *                filtered by what, who, product and day; read by the Change
 *                log tab itself, since its filters drive it.
 */

export const PAY_PATH = '/admin/platform/payments';
export const PAY_STRIPE_PATH = '/admin/platform/payments/stripe';
export const PAY_LOG_PATH = '/admin/platform/payments/log';
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

/** The tabs (D1008 §1). The change log came with its read (D1011) and its page (D1014). */
export const TABS = [
  { key: 'catalogue', label: 'Catalogue', path: '' },
  { key: 'stripe', label: 'Stripe connection', path: '/stripe' },
  { key: 'log', label: 'Change log', path: '/log' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === PAY_PATH) return 'catalogue';
  if (p === PAY_STRIPE_PATH) return 'stripe';
  if (p === PAY_LOG_PATH) return 'log';
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

// ─────────────────────────────────────────────── D1014: deliveries per hour (PAY5)

export const DELIVERIES_UNREAD = 'Could not be read. The request log did not answer. This is not a claim that no delivery came.';

const hourOf = (iso) => {
  const m = /T(\d{2}):/.exec(String(iso || ''));
  return m ? `${m[1]}:00` : null;
};
const isCount = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The read's 24 hours as the page draws them, oldest first. An hour is
 * `logged` only when both of its counts are numbers: a null is the log's
 * silence, never a zero. The last hour is the one the read was made in.
 */
export function deliveryHours(hours) {
  const list = Array.isArray(hours) ? hours : [];
  return list.map((h, i) => {
    const logged = isCount(h?.deliveries) && isCount(h?.not_2xx);
    return {
      hour: h?.hour ?? null,
      label: hourOf(h?.hour) || '—',
      logged,
      deliveries: logged ? h.deliveries : null,
      accepted: logged ? Math.max(0, h.deliveries - h.not_2xx) : null,
      refused: logged ? h.not_2xx : null,
      current: i === list.length - 1,
    };
  });
}

/** The rows `Columns` draws: accepted in violet under not accepted in amber; a silent hour dashed. */
export function deliveryColumns(hours) {
  return deliveryHours(hours).map((h) => {
    const label = h.label.slice(0, 2);
    if (!h.logged) return { label, value: 0, open: true, text: '' };
    return {
      label,
      value: h.deliveries,
      text: h.deliveries ? String(h.deliveries) : '0',
      parts: [{ value: h.accepted, tone: 'violet' }, { value: h.refused, tone: 'amber' }],
    };
  });
}

/** "No log was kept for 03:00 to 05:00." — runs of silent hours, joined; null when every hour was logged. */
export function silentHoursText(hours) {
  const rows = deliveryHours(hours);
  const runs = [];
  rows.forEach((h, i) => {
    if (h.logged) return;
    const last = runs[runs.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else runs.push({ start: i, end: i });
  });
  if (!runs.length) return null;
  const until = (i) => {
    const m = /^(\d{2})/.exec(rows[i].label);
    return m ? `${String((Number(m[1]) + 1) % 24).padStart(2, '0')}:00` : '—';
  };
  const parts = runs.map((r) => `${rows[r.start].label} to ${until(r.end)}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `No log was kept for ${list}.`;
}

/** The table form (the phone's, and "Table" on a computer): newest first. */
export function deliveryTable(hours) {
  return deliveryHours(hours).slice().reverse().map((h) => ({
    key: h.hour || h.label,
    hour: h.current ? `${h.label} · so far` : h.label,
    accepted: h.logged ? String(h.accepted) : 'Not logged',
    refused: h.logged ? String(h.refused) : 'Not logged',
    logged: h.logged,
  }));
}

// ─────────────────────────────────────────────── D1014: the change log (PAY7)

export const LOG_PAGE = 25;
export const LOG_UNREAD = 'Could not be read. Nothing is shown rather than an empty log.';
export const EXPORT_REASON_MIN = 10;
export const EXPORT_REASON_MAX = 500;

/** What changed, as the filter names it. The Worker's `kinds` decide which appear. */
export const WHAT_WORDS = {
  product: 'Products',
  price: 'Prices',
  sync: 'Syncs',
  token_pack: 'Token packs',
  webhook: 'Webhook',
  key: 'Publishable key',
};
export const whatWord = (k) => WHAT_WORDS[k] || 'Not recorded';

/** Each recorded action in the canvas's words. An action not listed reads as its own code, never hidden. */
const ACTION_WORDS = {
  catalog_sync: 'Synced from Stripe',
  catalog_sync_failed: 'Sync failed',
  catalog_product_create: 'Created a product',
  catalog_product_update: 'Changed a product',
  catalog_product_archive: 'Archived a product',
  catalog_price_create: 'Added a price',
  catalog_price_update: 'Changed a price',
  catalog_price_archive: 'Archived a price',
  token_pack_create: 'Created a token pack',
  token_pack_adopt: 'Adopted a price as a token pack',
  token_pack_update: 'Changed a token pack',
  token_pack_archive: 'Archived a token pack',
  stripe_webhook_register: 'Registered the webhook endpoint',
  stripe_webhook_update: 'Changed the webhook endpoint',
  stripe_pk_update: 'Replaced the publishable key',
};
export const actionWord = (a) => ACTION_WORDS[a] || String(a || 'Not recorded');
export const isFailure = (a) => a === 'catalog_sync_failed';

/**
 * A row's detail, in words, from what its writer recorded. The reason is
 * shown on its own line; anything else stays under Technical details.
 */
export function detailText(entry) {
  const d = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  switch (entry?.action) {
    case 'catalog_sync':
      return isCount(d.synced) ? `${d.synced} product${d.synced === 1 ? '' : 's'} synced` : null;
    case 'catalog_sync_failed':
      if (d.failure === 'stripe') return isCount(d.stripe_status) ? `Stripe answered ${d.stripe_status}` : 'Stripe did not answer';
      return 'The platform could not finish the sync';
    case 'catalog_product_create':
      return typeof d.name === 'string' && d.name ? `${d.name}${d.kind ? ` · ${kindWord(d.kind)}` : ''}` : null;
    case 'token_pack_create':
    case 'token_pack_adopt':
      return isCount(d.face_cents) ? `${(d.face_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD pack` : null;
    case 'token_pack_update':
      return typeof d.on_sale === 'boolean' ? (d.on_sale ? 'On sale' : 'Off sale') : null;
    case 'stripe_pk_update':
      return d.mode ? `Now ${modeWord(d.mode)}` : null;
    case 'stripe_webhook_register':
      return d.secret_stored === false ? 'Signing secret not stored' : (typeof d.url === 'string' ? d.url : null);
    case 'stripe_webhook_update':
      return typeof d.url === 'string' ? d.url : null;
    default:
      return null;
  }
}
export const reasonOf = (entry) => (typeof entry?.details?.reason === 'string' && entry.details.reason.trim() ? entry.details.reason.trim() : null);

/** Who did it: the account's name, or its number when the name was not recorded. */
export const whoText = (who) => (who?.name ? who.name : who?.id != null ? `Account #${who.id} · name not recorded` : 'Not recorded');

/** "1–25 of 142", or "0 of 0". */
export function logRange(offset, shown, total) {
  if (!total || !shown) return `0 of ${Number(total || 0).toLocaleString('en-US')}`;
  return `${(offset + 1).toLocaleString('en-US')}–${(offset + shown).toLocaleString('en-US')} of ${Number(total).toLocaleString('en-US')}`;
}

/** The filters the read is sent, without the empty ones. */
export function logFilters({ what, who, product, from, to } = {}) {
  const out = {};
  if (what) out.what = what;
  if (who) out.who = who;
  if (product) out.product = product;
  if (from) out.from = from;
  if (to) out.to = to;
  return out;
}

/** The export's reason, as the Worker rules it: null when it will be accepted. */
export function reasonProblem(text) {
  const n = String(text || '').trim().length;
  if (n < EXPORT_REASON_MIN) return `Say why you are exporting, in at least ${EXPORT_REASON_MIN} characters.`;
  if (n > EXPORT_REASON_MAX) return `Keep the reason to ${EXPORT_REASON_MAX} characters.`;
  return null;
}

/** The people the log names on the rows read so far, by name: the Who filter's choices. */
export function peopleOf(entries, known = []) {
  const map = new Map(known.map((p) => [String(p.id), p]));
  for (const e of entries || []) if (e?.who?.id != null && !map.has(String(e.who.id))) map.set(String(e.who.id), { id: e.who.id, name: whoText(e.who) });
  return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
