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
    return {
      id: prod.id,
      name: prod.name,
      kind: deriveKind(metadata, productPrices),
      active: prod.active,
      metadata,
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
  return {
    id: row.id,
    name: row.name,
    kind: isProductKind(row.kind) ? row.kind : 'alacarte',
    active: row.active === 1,
    metadata,
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
export async function getCatalog(env: Env, kind?: ProductKind): Promise<CatalogProduct[]> {
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
  return (res.results ?? []).map(rowToProduct);
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
