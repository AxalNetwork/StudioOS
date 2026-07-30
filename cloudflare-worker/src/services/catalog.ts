/**
 * Task — Stripe-backed Product Catalog.
 *
 * Single source of truth for SKUs across the payments overhaul. Stripe
 * Products + Prices are the authority; this service:
 *   1. Lists the live catalog from Stripe (via the shared `stripeCall`
 *      wrapper) with a short-lived (~60s) KV cache.
 *   2. Mirrors that catalog into the D1 `stripe_products` table
 *      (migration 097) so reads are cheap and survive Stripe outages.
 *   3. Exposes a price lookup helper (price-for-product-and-interval).
 *
 * No `STRIPE_PRICE_*` env vars are read here — the catalog path is purely
 * Stripe-driven. Callers that still need a specific tier resolve it by
 * product/price metadata via the read endpoint, not hardcoded ids.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';

export type ProductKind = 'subscription' | 'incorporation' | 'session' | 'alacarte';

export const PRODUCT_KINDS: ReadonlySet<ProductKind> = new Set<ProductKind>([
  'subscription',
  'incorporation',
  'session',
  'alacarte',
]);

export function isProductKind(v: unknown): v is ProductKind {
  return typeof v === 'string' && PRODUCT_KINDS.has(v as ProductKind);
}

// ---------------------------------------------------------------------------
// Audience categories — who a product is "for". Independent of `kind`
// (a product can be both incorporation + legal services, e.g.).
// ---------------------------------------------------------------------------
export type AudienceCategory =
  | 'founders'
  | 'investors_lps'
  | 'service_partners'
  | 'advisors'
  | 'legal_services';

export const AUDIENCE_CATEGORIES: ReadonlyArray<{ value: AudienceCategory; label: string }> = [
  { value: 'founders', label: 'For Founders' },
  { value: 'investors_lps', label: 'For Investors / LPs' },
  { value: 'service_partners', label: 'For Service Partners' },
  { value: 'advisors', label: 'For Advisors' },
  { value: 'legal_services', label: 'Legal Services' },
];

const AUDIENCE_SET: ReadonlySet<string> = new Set(AUDIENCE_CATEGORIES.map((a) => a.value));

export function isAudienceCategory(v: unknown): v is AudienceCategory {
  return typeof v === 'string' && AUDIENCE_SET.has(v);
}

/**
 * Resolve a product's audience categories. Priority:
 *   1. Explicit `metadata.audience` — comma-separated category slugs, set by
 *      an admin. Unknown slugs are dropped rather than rejected, so a typo
 *      degrades to "uncategorised" instead of breaking the read.
 *   2. Heuristic fallback from `kind` + tier/plan metadata + a keyword scan
 *      of the product name, so existing catalog entries (created before this
 *      taxonomy existed) still land somewhere sensible without a manual edit.
 * A product may belong to more than one category (e.g. incorporation is
 * both founders + legal_services).
 */
export function deriveCategories(
  name: string,
  kind: ProductKind,
  metadata: Record<string, string>,
): AudienceCategory[] {
  if (metadata.audience) {
    const explicit = metadata.audience
      .split(',')
      .map((s) => s.trim())
      .filter(isAudienceCategory);
    if (explicit.length > 0) return [...new Set(explicit)];
  }

  const cats = new Set<AudienceCategory>();
  const n = name.toLowerCase();

  if (kind === 'incorporation') {
    cats.add('founders');
    cats.add('legal_services');
  }
  if (kind === 'subscription') {
    if (metadata.tier === 'growth' || metadata.tier === 'studio') cats.add('founders');
    if (metadata.investor_tier === 'professional' || metadata.investor_tier === 'institutional') {
      cats.add('investors_lps');
    }
    if (metadata.plan === 'mi_pro') cats.add('investors_lps');
  }

  // Keyword fallback — covers alacarte/session products and anything the
  // structured metadata above didn't already classify. Tokenize on
  // non-alphanumerics so plurals/punctuation ("LP's", "Founders,") and
  // standalone abbreviations ("LP") match without false-positiving on
  // substrings inside unrelated words.
  const tokens = new Set(n.split(/[^a-z0-9]+/).filter(Boolean));
  if (tokens.has('founder') || tokens.has('founders')) cats.add('founders');
  if (
    tokens.has('investor') ||
    tokens.has('investors') ||
    tokens.has('lp') ||
    tokens.has('lps')
  ) {
    cats.add('investors_lps');
  }
  if (tokens.has('advisor') || tokens.has('advisors')) cats.add('advisors');
  if (tokens.has('partner') || tokens.has('partners')) cats.add('service_partners');
  if (
    n.includes('registered agent') ||
    tokens.has('legal') ||
    tokens.has('incorporation')
  ) {
    cats.add('legal_services');
  }

  return [...cats];
}

// ---------------------------------------------------------------------------
// Normalised shapes (what we mirror + return to the API).
// ---------------------------------------------------------------------------
export interface CatalogPrice {
  id: string;
  currency: string;
  unit_amount: number | null;     // smallest currency unit (cents); null for metered/free
  interval: string | null;        // 'month' | 'year' | ... ; null for one-time
  interval_count: number | null;
  nickname: string | null;
  type: string;                   // 'recurring' | 'one_time'
  active: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  kind: ProductKind;
  active: boolean;
  metadata: Record<string, string>;
  categories: AudienceCategory[];
  prices: CatalogPrice[];
  synced_at: string;
}

// ---------------------------------------------------------------------------
// Raw Stripe shapes (only the fields we read).
// ---------------------------------------------------------------------------
interface StripeListResponse<T> {
  data: T[];
  has_more: boolean;
}
interface StripeProductRaw {
  id: string;
  name: string;
  active: boolean;
  metadata?: Record<string, string>;
}
interface StripePriceRaw {
  id: string;
  product: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  nickname: string | null;
  type: string;
  recurring: { interval: string; interval_count: number } | null;
}

const KV_KEY = 'cache:catalog:live';
const KV_TTL_SECONDS = 60;

// ---------------------------------------------------------------------------
// Schema bootstrap (idempotent; mirrors migration 097).
// ---------------------------------------------------------------------------
let _schemaReady = false;
export async function ensureCatalogSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS stripe_products (' +
        'id TEXT PRIMARY KEY, ' +
        'name TEXT NOT NULL, ' +
        "kind TEXT NOT NULL DEFAULT 'alacarte', " +
        'active INTEGER NOT NULL DEFAULT 1, ' +
        "metadata_json TEXT NOT NULL DEFAULT '{}', " +
        "prices_json TEXT NOT NULL DEFAULT '[]', " +
        "synced_at TEXT NOT NULL DEFAULT (datetime('now'))" +
        ')',
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_stripe_products_kind ON stripe_products(kind)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_stripe_products_active ON stripe_products(active)');
    _schemaReady = true;
  } catch (e) {
    console.warn('[catalog] ensureCatalogSchema failed:', (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Stripe fetch (paginated) → normalised catalog.
// ---------------------------------------------------------------------------
async function listAll<T>(env: Env, path: string): Promise<T[]> {
  const out: T[] = [];
  let startingAfter: string | undefined;
  // Guard against runaway pagination; 10 pages * 100 = 1000 records is ample.
  for (let page = 0; page < 10; page++) {
    const query: Record<string, string> = { limit: '100' };
    if (startingAfter) query.starting_after = startingAfter;
    const res = await stripeCall<StripeListResponse<T & { id: string }>>(env, path, query, {
      method: 'GET',
    });
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return out;
}

/**
 * Derive a product kind. Honours an explicit `metadata.kind` when valid;
 * otherwise infers: recurring prices → subscription, else alacarte.
 */
function deriveKind(metadata: Record<string, string>, prices: CatalogPrice[]): ProductKind {
  if (isProductKind(metadata.kind)) return metadata.kind;
  return prices.some((p) => p.type === 'recurring') ? 'subscription' : 'alacarte';
}

/** Fetch the live catalog from Stripe (no caching). Returns [] if Stripe unconfigured. */
export async function fetchStripeCatalog(env: Env): Promise<CatalogProduct[]> {
  if (!env.STRIPE_SECRET_KEY) return [];
  const [products, prices] = await Promise.all([
    listAll<StripeProductRaw>(env, '/products'),
    listAll<StripePriceRaw>(env, '/prices'),
  ]);

  const pricesByProduct = new Map<string, CatalogPrice[]>();
  for (const p of prices) {
    const norm: CatalogPrice = {
      id: p.id,
      currency: p.currency,
      unit_amount: p.unit_amount,
      interval: p.recurring?.interval ?? null,
      interval_count: p.recurring?.interval_count ?? null,
      nickname: p.nickname,
      type: p.type,
      active: p.active,
    };
    const arr = pricesByProduct.get(p.product) ?? [];
    arr.push(norm);
    pricesByProduct.set(p.product, arr);
  }

  const now = new Date().toISOString();
  return products.map((prod) => {
    const metadata = prod.metadata ?? {};
    const productPrices = pricesByProduct.get(prod.id) ?? [];
    const kind = deriveKind(metadata, productPrices);
    return {
      id: prod.id,
      name: prod.name,
      kind,
      active: prod.active,
      metadata,
      categories: deriveCategories(prod.name, kind, metadata),
      prices: productPrices,
      synced_at: now,
    };
  });
}

// ---------------------------------------------------------------------------
// KV-cached live catalog (~60s).
// ---------------------------------------------------------------------------
export async function getLiveCatalog(
  env: Env,
  opts?: { forceRefresh?: boolean },
): Promise<CatalogProduct[]> {
  if (!opts?.forceRefresh) {
    try {
      const raw = await env.RATE_LIMITS.get(KV_KEY);
      if (raw) return JSON.parse(raw) as CatalogProduct[];
    } catch {
      /* cache miss / parse error → fall through to live fetch */
    }
  }
  const fresh = await fetchStripeCatalog(env);
  try {
    await env.RATE_LIMITS.put(KV_KEY, JSON.stringify(fresh), { expirationTtl: KV_TTL_SECONDS });
  } catch {
    /* best-effort cache write */
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// D1 mirror.
// ---------------------------------------------------------------------------
interface CatalogRow {
  id: string;
  name: string;
  kind: string;
  active: number;
  metadata_json: string;
  prices_json: string;
  synced_at: string;
}

function rowToProduct(row: CatalogRow): CatalogProduct {
  let metadata: Record<string, string> = {};
  let prices: CatalogPrice[] = [];
  try {
    metadata = JSON.parse(row.metadata_json) as Record<string, string>;
  } catch {
    /* corrupt row → empty metadata */
  }
  try {
    prices = JSON.parse(row.prices_json) as CatalogPrice[];
  } catch {
    /* corrupt row → empty prices */
  }
  const kind = isProductKind(row.kind) ? row.kind : 'alacarte';
  return {
    id: row.id,
    name: row.name,
    kind,
    active: row.active === 1,
    metadata,
    categories: deriveCategories(row.name, kind, metadata),
    prices,
    synced_at: row.synced_at,
  };
}

/**
 * Re-pull from Stripe and repopulate the D1 mirror cleanly + idempotently:
 * upsert every current product, then delete mirror rows no longer in Stripe.
 * Returns the number of products mirrored.
 */
export async function syncCatalog(env: Env): Promise<{ synced: number }> {
  await ensureCatalogSchema(env);
  const catalog = await getLiveCatalog(env, { forceRefresh: true });

  for (const p of catalog) {
    await env.DB.prepare(
      `INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         active = excluded.active,
         metadata_json = excluded.metadata_json,
         prices_json = excluded.prices_json,
         synced_at = excluded.synced_at`,
    )
      .bind(
        p.id,
        p.name,
        p.kind,
        p.active ? 1 : 0,
        JSON.stringify(p.metadata),
        JSON.stringify(p.prices),
        p.synced_at,
      )
      .run();
  }

  // Drop rows that no longer exist in Stripe so the mirror stays clean.
  const ids = catalog.map((p) => p.id);
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM stripe_products WHERE id NOT IN (${placeholders})`)
      .bind(...ids)
      .run();
  } else {
    // Stripe returned nothing (or is unconfigured) — leave the mirror intact
    // rather than wiping it, so a transient empty fetch can't nuke the catalog.
  }

  return { synced: catalog.length };
}

/**
 * Read the mirrored catalog from D1, optionally filtered by kind. Self-heals:
 * if the mirror is empty and Stripe is configured, runs a sync first.
 */
export async function getCatalog(
  env: Env,
  kind?: ProductKind,
  audience?: AudienceCategory,
): Promise<CatalogProduct[]> {
  await ensureCatalogSchema(env);

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM stripe_products')
    .first<{ n: number }>();
  if ((countRow?.n ?? 0) === 0 && env.STRIPE_SECRET_KEY) {
    try {
      await syncCatalog(env);
    } catch (e) {
      console.warn('[catalog] lazy sync failed:', (e as Error).message);
    }
  }

  const stmt = kind
    ? env.DB.prepare(
        'SELECT * FROM stripe_products WHERE kind = ? ORDER BY name COLLATE NOCASE ASC',
      ).bind(kind)
    : env.DB.prepare('SELECT * FROM stripe_products ORDER BY name COLLATE NOCASE ASC');
  const res = await stmt.all<CatalogRow>();
  const products = (res.results ?? []).map(rowToProduct);
  // Category derivation depends on name/kind/metadata, not a stored column,
  // so the audience filter is applied in-memory after the row → product map.
  return audience ? products.filter((p) => p.categories.includes(audience)) : products;
}

/**
 * Lookup helper: the price for a given product + recurring interval (e.g.
 * 'month' | 'year'). Pass `interval: null` to match a one-time price. Reads
 * the mirror (falling back to a sync on an empty mirror via getCatalog).
 */
export async function priceForProductAndInterval(
  env: Env,
  productId: string,
  interval: string | null,
): Promise<CatalogPrice | null> {
  const products = await getCatalog(env);
  const product = products.find((p) => p.id === productId);
  if (!product) return null;
  const match = product.prices.find(
    (pr) => pr.active && (interval === null ? pr.interval === null : pr.interval === interval),
  );
  return match ?? null;
}

/**
 * Lookup a single price by its Stripe price id across the mirrored catalog.
 * Returns the normalised `CatalogPrice` (carrying `type`/`interval`/
 * `unit_amount`/`currency`) so callers can branch one-time vs recurring and
 * read the amount without a second Stripe round-trip. Returns `null` when the
 * id isn't present in the mirror.
 */
export async function findCatalogPriceById(
  env: Env,
  priceId: string,
): Promise<CatalogPrice | null> {
  const products = await getCatalog(env);
  for (const product of products) {
    const match = product.prices.find((pr) => pr.id === priceId);
    if (match) return match;
  }
  return null;
}

/**
 * Lookup the product (carrying `kind` + `metadata`) that owns a given Stripe
 * price id, alongside the matched price. Used by the à la carte purchase path
 * to read `metadata.feature_key` / `metadata.unlock_days` and assert the SKU is
 * actually an `alacarte` product. Returns `null` when the price isn't mirrored.
 */
export async function findCatalogProductByPriceId(
  env: Env,
  priceId: string,
): Promise<{ product: CatalogProduct; price: CatalogPrice } | null> {
  const products = await getCatalog(env);
  for (const product of products) {
    const price = product.prices.find((pr) => pr.id === priceId);
    if (price) return { product, price };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stripe mode detection.
// ---------------------------------------------------------------------------

export type StripeMode = 'test' | 'live' | 'unconfigured';

/** Infer Test vs Live from the STRIPE_SECRET_KEY prefix. Never returns the key itself. */
export function stripeMode(env: Env): StripeMode {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return 'unconfigured';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  return 'test';
}

// ---------------------------------------------------------------------------
// Publishable key store (KV-backed runtime config).
// ---------------------------------------------------------------------------

const PK_KV_KEY = 'config:stripe:pk';

/**
 * Read the Stripe publishable key at runtime. Priority:
 *   1. KV (admin-set via PUT /api/admin/stripe/config)
 *   2. STRIPE_PUBLISHABLE_KEY env var (if deployed with it)
 *   3. null (unconfigured)
 */
export async function getPublishableKey(env: Env): Promise<string | null> {
  try {
    const kv = await env.RATE_LIMITS.get(PK_KV_KEY);
    if (kv) return kv;
  } catch {
    /* fall through on KV miss / error */
  }
  const envKey = (env as unknown as Record<string, string | undefined>).STRIPE_PUBLISHABLE_KEY;
  return envKey || null;
}

/** Persist the publishable key in KV so the runtime config endpoint serves it immediately. */
export async function setPublishableKey(env: Env, key: string): Promise<void> {
  await env.RATE_LIMITS.put(PK_KV_KEY, key);
}

// ---------------------------------------------------------------------------
// Metadata taxonomy validation.
// ---------------------------------------------------------------------------

/**
 * Validate the required metadata keys for a product kind.
 * Returns an array of human-readable error strings (empty = valid).
 *
 * Taxonomy (from the product catalog spec):
 *   subscription  → plan=mi_pro OR tier=growth|studio OR investor_tier=professional|institutional
 *   incorporation → kind=incorporation
 *   session       → kind=session
 *   alacarte      → kind=alacarte + feature_key (non-empty) + unlock_days (positive integer)
 */
export function validateProductMetadata(
  kind: ProductKind,
  metadata: Record<string, string>,
): string[] {
  const errs: string[] = [];
  if (kind === 'subscription') {
    const hasPlan = metadata.plan === 'mi_pro';
    const hasTier = metadata.tier === 'growth' || metadata.tier === 'studio';
    const hasInv =
      metadata.investor_tier === 'professional' || metadata.investor_tier === 'institutional';
    if (!hasPlan && !hasTier && !hasInv) {
      errs.push(
        'subscription requires metadata.plan=mi_pro, metadata.tier=growth|studio, ' +
          'or metadata.investor_tier=professional|institutional',
      );
    }
  } else if (kind === 'incorporation') {
    if (metadata.kind !== 'incorporation')
      errs.push('incorporation products require metadata.kind=incorporation');
  } else if (kind === 'session') {
    if (metadata.kind !== 'session')
      errs.push('session products require metadata.kind=session');
  } else if (kind === 'alacarte') {
    if (metadata.kind !== 'alacarte')
      errs.push('alacarte products require metadata.kind=alacarte');
    if (!metadata.feature_key?.trim())
      errs.push('alacarte products require metadata.feature_key (non-empty)');
    const days = Number(metadata.unlock_days);
    if (!Number.isInteger(days) || days <= 0)
      errs.push('alacarte products require metadata.unlock_days (positive integer string)');
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Catalog write helpers — each mutation re-syncs the D1 mirror.
// ---------------------------------------------------------------------------

export interface CreateProductBody {
  name: string;
  kind: ProductKind;
  metadata: Record<string, string>;
  description?: string;
}

export interface UpdateProductBody {
  name?: string;
  metadata?: Record<string, string>;
  description?: string;
}

export interface CreatePriceBody {
  currency: string;
  unit_amount: number; // smallest currency unit (e.g. cents)
  type: 'recurring' | 'one_time';
  interval?: 'month' | 'year' | 'week' | 'day'; // required when type=recurring
  interval_count?: number;
  nickname?: string;
}

/** Flatten a metadata object into Stripe's nested form-encoding (`metadata[key]=value`). */
function metadataParams(meta: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) out[`metadata[${k}]`] = v;
  return out;
}

interface StripeProductRawResp {
  id: string;
  name: string;
  active: boolean;
  metadata: Record<string, string>;
}

/** Create a Stripe Product, then re-sync the D1 mirror. */
export async function createProduct(env: Env, body: CreateProductBody): Promise<CatalogProduct> {
  const form: Record<string, string> = {
    name: body.name.trim(),
    ...metadataParams(body.metadata),
  };
  if (body.description) form.description = body.description;

  const prod = await stripeCall<StripeProductRawResp>(env, '/products', form);
  await syncCatalog(env);

  // Return the freshly synced mirror row (carries derived prices = [] initially).
  const all = await getCatalog(env);
  return (
    all.find((p) => p.id === prod.id) ?? {
      id: prod.id,
      name: prod.name,
      kind: body.kind,
      active: prod.active,
      metadata: prod.metadata ?? body.metadata,
      categories: deriveCategories(prod.name, body.kind, prod.metadata ?? body.metadata),
      prices: [],
      synced_at: new Date().toISOString(),
    }
  );
}

/** Update a Stripe Product's name / metadata / description, then re-sync. */
export async function updateProduct(env: Env, id: string, body: UpdateProductBody): Promise<void> {
  const form: Record<string, string> = {};
  if (body.name) form.name = body.name.trim();
  if (body.description) form.description = body.description;
  if (body.metadata) Object.assign(form, metadataParams(body.metadata));
  if (Object.keys(form).length === 0) return; // nothing to update
  await stripeCall(env, `/products/${encodeURIComponent(id)}`, form);
  await syncCatalog(env);
}

/** Set a Stripe Product to `active=false` (Stripe doesn't support hard deletion). */
export async function archiveProduct(env: Env, id: string): Promise<void> {
  await stripeCall(env, `/products/${encodeURIComponent(id)}`, { active: 'false' });
  await syncCatalog(env);
}

/** Create a Stripe Price on an existing Product, then re-sync. */
export async function createPrice(
  env: Env,
  productId: string,
  body: CreatePriceBody,
): Promise<CatalogPrice> {
  const form: Record<string, string> = {
    product: productId,
    currency: body.currency.toLowerCase(),
    unit_amount: String(body.unit_amount),
  };
  if (body.nickname) form.nickname = body.nickname;
  if (body.type === 'recurring') {
    form['recurring[interval]'] = body.interval ?? 'month';
    if (body.interval_count && body.interval_count > 1)
      form['recurring[interval_count]'] = String(body.interval_count);
  }

  interface StripePriceResp {
    id: string;
    currency: string;
    unit_amount: number | null;
    type: string;
    recurring: { interval: string; interval_count: number } | null;
    nickname: string | null;
    active: boolean;
  }
  const price = await stripeCall<StripePriceResp>(env, '/prices', form);
  await syncCatalog(env);
  return {
    id: price.id,
    currency: price.currency,
    unit_amount: price.unit_amount,
    interval: price.recurring?.interval ?? null,
    interval_count: price.recurring?.interval_count ?? null,
    nickname: price.nickname,
    type: price.type,
    active: price.active,
  };
}

/**
 * Update a Stripe Price's mutable fields (nickname, metadata).
 * Amount, currency, and interval are immutable on Stripe Prices — only nickname
 * and metadata can be changed post-creation.  Re-syncs D1 mirror after the call.
 */
export async function updatePrice(
  env: Env,
  priceId: string,
  body: { nickname?: string; metadata?: Record<string, string> },
): Promise<void> {
  const form: Record<string, string> = {};
  if (body.nickname !== undefined) form.nickname = body.nickname;
  if (body.metadata) Object.assign(form, metadataParams(body.metadata));
  if (Object.keys(form).length === 0) return; // nothing to update
  await stripeCall(env, `/prices/${encodeURIComponent(priceId)}`, form);
  await syncCatalog(env);
}

/** Set a Stripe Price to `active=false` (Stripe Prices cannot be hard-deleted). */
export async function archivePrice(env: Env, priceId: string): Promise<void> {
  await stripeCall(env, `/prices/${encodeURIComponent(priceId)}`, { active: 'false' });
  await syncCatalog(env);
}

/**
 * Plan-keyed price lookup. Resolves the active product whose Stripe metadata
 * carries `metaKey === metaValue`, then returns its price for the requested
 * recurring `interval` ('month' | 'year' | ...). This is how the subscription
 * checkout routes map their plan/tier strings onto a SKU without any hardcoded
 * `STRIPE_PRICE_*` env var — the catalog (mirrored from Stripe) is the source
 * of truth.
 *
 * `interval`:
 *   - a string ('month' | 'year') → match that recurring interval exactly
 *   - `null`                       → match a one-time price
 *   - omitted (`undefined`)        → match the product's single recurring price
 *     (used by single-price tiers whose plan key doesn't encode an interval)
 *
 * Returns `null` when no product/price matches (callers treat that the same as
 * an unconfigured price: they fall back to the dev-upgrade path).
 */
export async function priceForPlanMetadata(
  env: Env,
  metaKey: string,
  metaValue: string,
  interval?: string | null,
): Promise<CatalogPrice | null> {
  const products = await getCatalog(env);
  const product = products.find((p) => p.active && p.metadata[metaKey] === metaValue);
  if (!product) return null;
  const active = product.prices.filter((pr) => pr.active);
  if (interval === undefined) {
    return active.find((pr) => pr.type === 'recurring') ?? active[0] ?? null;
  }
  return (
    active.find((pr) => (interval === null ? pr.interval === null : pr.interval === interval)) ??
    null
  );
}
