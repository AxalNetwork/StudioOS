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
  if (p === PAY_PATH || productIdOf(p)) return 'catalogue';
  if (p === PAY_STRIPE_PATH) return 'stripe';
  if (p === PAY_LOG_PATH) return 'log';
  return null;
}

/** D1012: one product's address (PAY2's lightbox over Catalogue). */
export const PAY_PRODUCTS_PATH = '/admin/platform/payments/products';
export const productPath = (id) => `${PAY_PRODUCTS_PATH}/${encodeURIComponent(id)}`;
/** The product ID in a product's address, or null for any other address. */
export function productIdOf(pathname) {
  const m = /^\/admin\/platform\/payments\/products\/([^/]+)\/?$/.exec(String(pathname || ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
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
/** D1012: the table's groups (PAY1). Archived products sit in their own group, last. */
export const TABLE_GROUPS = [
  { key: 'plans', label: 'Plans' },
  { key: 'oneTime', label: 'One-time · Incorporation, Sessions, Add-ons' },
  { key: 'packs', label: 'Token packs', readOnly: true },
  { key: 'archived', label: 'Archived' },
];
/** The Kind column's word: a plan, a one-time product or a token pack. */
export const kindGroupWord = (p) => ({ plans: 'Plan', oneTime: 'One-time', packs: 'Token pack' })[groupOf(p)];
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
  if (!price.interval) return `${amount} · one time`;
  const n = Number(price.interval_count) || 1;
  return n === 1 ? `${amount} / ${price.interval}` : `${amount} every ${n} ${price.interval}s`;
}

/** The catalogue in its three groups and the canvas's order: active by name, then archived. */
export function catalogueGroups(products) {
  const list = (products || []).slice().sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name)));
  return GROUPS.map((g) => ({ ...g, rows: list.filter((p) => groupOf(p) === g.key) }));
}

/**
 * D1012: the table's groups, in the order already sorted: active plans,
 * one-time and token packs, then every archived product in its own group.
 * `list` is the sorted, filtered rows; each keeps its place in that order.
 */
export function tableGroups(list) {
  const rows = list || [];
  return TABLE_GROUPS.map((g) => ({
    ...g,
    rows: rows.filter((p) => (g.key === 'archived' ? !p.active : p.active && groupOf(p) === g.key)),
  }));
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

/** Part 5's dialogs (#2832) are not built yet; the buttons that open them say so. */
export const DIALOGS_WAIT = 'Opens with D1008 part 5 (#2832). Until then, use the editor on Catalogue.';
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

// ─────────────────────────────────────────────── D1012: Catalogue complete (PAY1, PAY2, PAY8–PAY11)

export const CHECKS_UNREAD = 'The catalogue’s checks could not be read, so they were not run. This is not a claim that nothing needs you.';

/**
 * Needs you (PAY1), each item with one action.
 *
 * When the catalogue answered, its checks (D1010) say everything about the
 * catalogue and the keys: each product check opens its product; a check
 * that names no product (the keys' four, D1010) opens Stripe connection. When it did not, the keys are judged from
 * the config and the summary as before (`needsYou`). The webhook items come
 * from the webhook read either way; part 2's checks do not judge the webhook.
 * Blockers come before warnings, then the webhook's.
 */
export function needsYouAll({ config, summary, webhook, catalog }) {
  const checks = Array.isArray(catalog?.checks) ? catalog.checks : null;
  const names = Object.fromEntries((catalog?.products || []).map((p) => [p.id, p.name]));
  const hookItems = needsYou({ config: null, summary: null, webhook })
    .map((it) => ({ ...it, action: 'Fix in Stripe connection', href: PAY_STRIPE_PATH }));
  if (!checks) {
    const keyItems = needsYou({ config, summary, webhook: null })
      .map((it) => ({ ...it, action: 'Open Stripe connection', href: PAY_STRIPE_PATH }));
    return [...keyItems, ...hookItems];
  }
  const rank = (c) => (c.severity === 'blocker' ? 0 : 1);
  const fromChecks = checks.slice().sort((a, b) => rank(a) - rank(b)).map((c, i) => {
    if (!c.product_id) {
      return { id: `check-${i}`, code: c.code, severity: c.severity, text: c.message, action: 'Open Stripe connection', href: PAY_STRIPE_PATH };
    }
    return { id: `check-${i}`, code: c.code, severity: c.severity, text: c.message, product: c.product_id, action: `Review ${names[c.product_id] || 'the product'}`, href: productPath(c.product_id) };
  });
  return [...fromChecks, ...hookItems];
}

/** The checks naming one product (PAY2's Checks). */
export const productChecks = (catalog, id) => (Array.isArray(catalog?.checks) ? catalog.checks.filter((c) => c.product_id === id) : null);

/** The product IDs any check names: the table's "Needs you" marker. */
export const flaggedProducts = (catalog) => new Set((Array.isArray(catalog?.checks) ? catalog.checks : []).map((c) => c.product_id).filter(Boolean));

const dollars = (microusd) => `$${(Math.floor(microusd / 10_000) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ALLOWANCE_REASONS = {
  not_a_plan: 'Only active plans include an AI allowance.',
  archived: 'An archived price gives no AI allowance.',
  not_usd: 'An AI allowance is counted in USD only.',
  not_monthly_or_yearly: 'Only monthly and yearly prices give an AI allowance.',
};
export const NO_ALLOWANCE = ALLOWANCE_REASONS.not_a_plan;
const isRecurringOne = (x, interval) => x.active && x.interval === interval && (Number(x.interval_count) || 1) === 1;

/**
 * One price's AI allowance a month, from the Worker's `allowance_microusd`
 * (D1010; D783's 25%, a yearly price's ÷ 12). Null with a reason when it gives
 * none; "Not recorded" when the read carried no allowance at all.
 */
export function allowanceOf(price) {
  if (!price) return { text: null, reason: 'Not recorded' };
  if (typeof price.allowance_microusd === 'number' && price.allowance_microusd > 0 && !price.allowance_reason) {
    return { text: dollars(price.allowance_microusd), reason: null };
  }
  if (price.allowance_reason) return { text: null, reason: ALLOWANCE_REASONS[price.allowance_reason] || 'Not recorded' };
  return { text: null, reason: 'Not recorded: the catalogue read carried no allowance.' };
}

/** The AI allowance column (PAY1): an active plan's monthly allowance, and "on yearly" under it. */
export function allowanceCell(product) {
  if (!product?.active || !product.plan) return { main: null, sub: null, reason: NO_ALLOWANCE };
  const prices = product.prices || [];
  const month = prices.find((x) => isRecurringOne(x, 'month'));
  const year = prices.find((x) => isRecurringOne(x, 'year'));
  const m = month ? allowanceOf(month) : null;
  const y = year ? allowanceOf(year) : null;
  if (!m?.text && !y?.text) return { main: null, sub: null, reason: (m || y)?.reason || 'No monthly or yearly price gives an allowance.' };
  return {
    main: m?.text ? `${m.text} / month` : `${y.text} / month on yearly`,
    sub: m?.text && y?.text ? `${y.text} on yearly` : null,
    reason: null,
  };
}

/** The Prices column's line above the amounts: a plan's yearly saving, or that it has no yearly price. */
export function yearlyLine(product) {
  if (!product?.plan || !product.active) return null;
  if (!(product.prices || []).some((x) => isRecurringOne(x, 'year'))) return { tone: 'muted', text: 'No yearly price' };
  const pct = product.plan.yearly_saving_percent;
  return typeof pct === 'number' && pct > 0 ? { tone: 'good', text: `Yearly saves ${pct}%` } : null;
}

/** "Shows on" (D1010 §2) in the canvas's words; the Worker's sentence is the second line. */
const SURFACE = {
  pricing: '/pricing',
  bundles: 'Products page · Profile bundles',
  addons: 'Products page',
  incorporate: '/incorporate',
  packs: '/pricing · token packs',
};
export const surfaceWord = (key) => SURFACE[key] || 'Not recorded';
export const SURFACE_KEYS = Object.keys(SURFACE);
/** The surfaces a product reaches, or null when the read did not say (an older Worker). */
export function showsOnRows(product) {
  if (!Array.isArray(product?.shows_on)) return null;
  return product.shows_on.map((s) => ({ key: s.key, label: surfaceWord(s.key), path: s.path || null, detail: s.detail || null }));
}

/** Filters (PAY1's "Filters ▾") and sort ("Sort: Name, A to Z ▾"). */
export const FILTERS_EMPTY = { status: 'all', needs: false, surface: '' };
export const STATUS_FILTERS = [['all', 'Active and archived'], ['active', 'Active only'], ['archived', 'Archived only']];
export const SORTS = [
  ['name', 'Name, A to Z'],
  ['name_desc', 'Name, Z to A'],
  ['needs', 'Needs you first'],
];
export const filterCount = (f) => (f.status !== 'all' ? 1 : 0) + (f.needs ? 1 : 0) + (f.surface ? 1 : 0);

/** The rows the toolbar leaves: the kind chip, search, then the filters. */
export function filterProducts(products, { group = 'all', q = '', filters = FILTERS_EMPTY, flagged = new Set() } = {}) {
  return searchProducts(products, q).filter((p) => {
    if (group !== 'all' && groupOf(p) !== group) return false;
    if (filters.status === 'active' && !p.active) return false;
    if (filters.status === 'archived' && p.active) return false;
    if (filters.needs && !flagged.has(p.id)) return false;
    if (filters.surface && !(Array.isArray(p.shows_on) && p.shows_on.some((s) => s.key === filters.surface))) return false;
    return true;
  });
}

/** The sort the table draws its rows in; every sort keeps archived rows in the Archived group. */
export function sortProducts(list, sort = 'name', flagged = new Set()) {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const out = (list || []).slice();
  if (sort === 'name_desc') out.sort((a, b) => -byName(a, b));
  else if (sort === 'needs') out.sort((a, b) => Number(flagged.has(b.id)) - Number(flagged.has(a.id)) || byName(a, b));
  else out.sort(byName);
  return out;
}

/** The pager (PAY1): rows per page, and which rows a page holds, over the groups' order. */
export const PER_PAGE = [25, 50, 100];
export function pageOf(groups, page, perPage) {
  const flat = groups.flatMap((g) => g.rows.map((p) => ({ g: g.key, p })));
  const total = flat.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const at = Math.min(Math.max(1, page), pages);
  const start = (at - 1) * perPage;
  const keep = new Set(flat.slice(start, start + perPage).map((x) => x.p.id));
  return {
    page: at, pages, total,
    range: total ? `${start + 1}–${Math.min(start + perPage, total)} of ${total}` : '0 of 0',
    groups: groups.map((g) => ({ ...g, count: g.rows.length, rows: g.rows.filter((p) => keep.has(p.id)) })),
  };
}

// ─────────────────────────────────────────────── D1012: the product lightbox (PAY2)

/** A price's interval in words: "Monthly", "Yearly", "Every 3 months", "One time". */
export function intervalWord(price) {
  if (!price?.interval) return 'One time';
  const n = Number(price.interval_count) || 1;
  if (n === 1) return ({ month: 'Monthly', year: 'Yearly', week: 'Weekly', day: 'Daily' })[price.interval] || 'Not recorded';
  return `Every ${n} ${price.interval}s`;
}

/** An amount alone, in its own currency: "20.00 USD". */
export function amountText(price) {
  if (typeof price?.unit_amount !== 'number') return 'No fixed amount';
  return `${(price.unit_amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(price.currency || '').toUpperCase()}`.trim();
}

/** The prices table's rows: active first, then archived, each in the order the read gave. */
export const priceRows = (product) => (product?.prices || []).slice().sort((a, b) => Number(b.active) - Number(a.active));

/**
 * Members on this plan (PAY2), from `GET /api/admin/catalog/members` (D1010
 * §3): the paid members on each of the product's prices, by interval, with
 * the other live statuses beside them. Rows recorded before prices were
 * stored count under their family, never under one price, so they are named
 * apart. Null when the product is not a plan.
 */
export function membersOn(product, members) {
  if (!product?.plan) return null;
  const byPrice = new Map((members?.by_price || []).map((r) => [r.price_id, r]));
  const out = { monthly: 0, yearly: 0, otherIntervals: 0, other: 0, withoutPrice: 0 };
  for (const x of product.prices || []) {
    const r = byPrice.get(x.id);
    if (!r) continue;
    const n = Number(r.active) || 0;
    if (isRecurringOne({ ...x, active: true }, 'month')) out.monthly += n;
    else if (isRecurringOne({ ...x, active: true }, 'year')) out.yearly += n;
    else out.otherIntervals += n;
    out.other += Number(r.other) || 0;
  }
  out.withoutPrice = (members?.by_plan || []).filter((r) => r.family === product.plan.family)
    .reduce((t, r) => t + (Number(r.without_price) || 0), 0);
  return out;
}

export function membersLine(m) {
  const parts = [`${m.monthly.toLocaleString('en-US')} monthly`, `${m.yearly.toLocaleString('en-US')} yearly`];
  if (m.otherIntervals) parts.push(`${m.otherIntervals.toLocaleString('en-US')} on other intervals`);
  return parts.join(' · ');
}

/**
 * Promo codes that apply to a product (PAY2), from `GET /api/admin/promos`:
 * the codes checkout would take now (on, not expired, not used up; the rule
 * of services/promos `promoState`) whose product list is empty (every
 * product) or names this one. A code whose product list could not be read
 * is counted apart, never as applying or not.
 */
export function promosFor(productId, promos, nowMs = Date.now()) {
  const usable = (promos || []).filter((x) => {
    if (!x.active) return false;
    if (x.max_redemptions != null && Number(x.times_redeemed) >= Number(x.max_redemptions)) return false;
    if (x.expires_at) {
      const raw = String(x.expires_at).trim();
      const t = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw).getTime();
      if (Number.isFinite(t) && t <= nowMs) return false;
    }
    return true;
  });
  return {
    apply: usable.filter((x) => x.product_ids_readable !== false && (!(x.product_ids || []).length || x.product_ids.includes(productId))).length,
    unreadable: usable.filter((x) => x.product_ids_readable === false).length,
  };
}

export const codesWord = (n) => `${n.toLocaleString('en-US')} code${n === 1 ? '' : 's'}`;

/** "18 Oct 2026" from a change-log row's stamp. */
export function dayText(s) {
  const t = stampText(s);
  return t ? t.split(',')[0] : 'Date not recorded';
}

/** Technical details (PAY2c): the product's codes, each a line, never on the face of the page. */
export function technicalLines(product) {
  if (!product) return [];
  const out = [['product', product.id]];
  if (product.plan?.key) out.push(['plan', product.plan.key]);
  for (const [k, v] of Object.entries(product.metadata || {})) out.push([k, String(v)]);
  for (const x of product.prices || []) out.push([`price ${intervalWord(x).toLowerCase()}`, x.id]);
  return out;
}

/** PAY8a: Stripe is not connected when the account answers so; a failed read never says it. */
export const notConnected = (config, catalog) => config?.mode === 'unconfigured' || catalog?.keys?.account_mode === 'unconfigured';
export const NOT_CONNECTED = 'Stripe is not connected on this platform yet.';
export const NOT_CONNECTED_SUB = 'HQ adds the account’s keys at deploy. Until then nothing can be sold, and this page shows no products.';
export const NO_PRODUCTS = 'No products yet.';
export const NO_PRODUCTS_SUB = 'Make the first one, or sync products you made in the Stripe dashboard.';
export const CATALOG_FAILED_TITLE = 'We could not load the catalogue.';
export const CATALOG_FAILED_SUB = 'The rest of Payments still works.';
export const PRODUCT_MISSING = 'No product with this ID is in the catalogue. It may have been deleted in Stripe, or the link is wrong.';
export const MEMBERS_UNREAD = 'Could not be read. That is not a claim that nobody is on this plan.';
export const PROMOS_UNREAD = 'Could not be read. That is not a claim that no code applies.';
export const CHANGES_UNREAD = 'Could not be read. Nothing is shown rather than an empty history.';
export const KEEP_PRICE = 'Archiving a price stops new sales. Members already on it keep their price.';

/** PAY11: the closed card a studio admin meets. */
export const CLOSED_TITLE = 'This page belongs to the Super Admin';
export const CLOSED_TEXT = 'HQ sets what members pay. You are signed in as a studio admin, so this page stays closed rather than opening and refusing each action.';
