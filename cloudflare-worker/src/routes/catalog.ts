/**
 * Task — Stripe-backed Product Catalog.
 *
 * Read + admin-sync surface over the D1 mirror of the Stripe catalog. The
 * mirror is repopulated from Stripe (the source of truth) by the sync route;
 * the read route serves cheaply from D1.
 *
 * Public endpoints (auth-required, user-facing):
 *   GET  /api/catalog/products[?kind=]   read mirrored catalog
 *
 * Admin endpoints (requireAdmin, admin perimeter):
 *   POST /api/admin/catalog/sync                        re-pull from Stripe → D1
 *   GET  /api/admin/catalog/mode                        Stripe Test vs Live flag
 *   GET  /api/admin/catalog/products                    list all products (admin view)
 *   POST /api/admin/catalog/products                    create product + re-sync
 *   PATCH /api/admin/catalog/products/:id               update name/metadata + re-sync
 *   POST /api/admin/catalog/products/:id/archive        set active=false + re-sync
 *   POST /api/admin/catalog/products/:id/prices         add price + re-sync
 *   PATCH /api/admin/catalog/prices/:priceId            update price nickname/metadata
 *   POST /api/admin/catalog/prices/:priceId/archive     set price active=false + re-sync
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import {
  getCatalog,
  syncCatalog,
  isProductKind,
  isAudienceCategory,
  PRODUCT_KINDS,
  AUDIENCE_CATEGORIES,
  stripeMode,
  validateProductMetadata,
  createProduct,
  updateProduct,
  archiveProduct,
  createPrice,
  updatePrice,
  archivePrice,
  type ProductKind,
  type UpdateProductBody,
  type CreatePriceBody,
} from '../services/catalog';
import { ensureAdminAuditLogTable } from './admin';

// ---------- public read ----------
const catalog = new Hono<{ Bindings: Env }>();

catalog.get('/products', async (c) => {
  await requireAuth(c);
  const kindParam = c.req.query('kind');
  let kind: ProductKind | undefined;
  if (kindParam !== undefined) {
    if (!isProductKind(kindParam)) return c.json({ error: 'invalid_kind' }, 400);
    kind = kindParam;
  }
  const audienceParam = c.req.query('audience');
  if (audienceParam !== undefined && !isAudienceCategory(audienceParam)) {
    return c.json({ error: 'invalid_audience', allowed: AUDIENCE_CATEGORIES.map((a) => a.value) }, 400);
  }
  try {
    const products = await getCatalog(c.env, kind, audienceParam || undefined);
    return c.json({ products, audience_categories: AUDIENCE_CATEGORIES });
  } catch (e) {
    return c.json({ error: 'catalog_read_failed', detail: (e as Error).message }, 502);
  }
});

// ---------- shared audit helper ----------
async function writeAdminAudit(
  env: Env,
  adminId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await ensureAdminAuditLogTable(env);
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
       VALUES (?, ?, 'billing', NULL, ?)`,
    )
      .bind(adminId, action, JSON.stringify(payload))
      .run();
  } catch (e) {
    console.error('[admin/catalog] audit insert failed', action, (e as Error).message);
  }
}

// ---------- admin routes ----------
const adminCatalog = new Hono<{ Bindings: Env }>();

adminCatalog.post('/sync', async (c) => {
  const admin = await requireAdmin(c);
  try {
    const result = await syncCatalog(c.env);
    await writeAdminAudit(c.env, admin.id, 'catalog_sync', {
      synced: (result as { synced?: number }).synced ?? 0,
    });
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: 'catalog_sync_failed', detail: (e as Error).message }, 502);
  }
});

// GET /mode — Stripe Test vs Live flag (never returns the secret key value).
adminCatalog.get('/mode', async (c) => {
  await requireAdmin(c);
  return c.json({ mode: stripeMode(c.env) });
});

// GET /products — full catalog list (admin view: all kinds, active + inactive).
adminCatalog.get('/products', async (c) => {
  await requireAdmin(c);
  try {
    const products = await getCatalog(c.env);
    return c.json({ products, mode: stripeMode(c.env), audience_categories: AUDIENCE_CATEGORIES });
  } catch (e) {
    return c.json({ error: 'catalog_read_failed', detail: (e as Error).message }, 502);
  }
});

// POST /products — create a Stripe Product + mirror. Validates metadata taxonomy.
adminCatalog.post('/products', async (c) => {
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → 400 below */
  }

  const name = String(body.name || '').trim();
  if (!name) return c.json({ error: 'name_required' }, 400);
  if (!isProductKind(body.kind)) {
    return c.json({ error: 'invalid_kind', allowed: [...PRODUCT_KINDS] }, 400);
  }
  const kind = body.kind as ProductKind;

  const metadata: Record<string, string> = {};
  if (body.metadata && typeof body.metadata === 'object') {
    for (const [k, v] of Object.entries(body.metadata as Record<string, unknown>)) {
      if (typeof v === 'string') metadata[k] = v;
    }
  }

  const metaErrors = validateProductMetadata(kind, metadata);
  if (metaErrors.length) {
    return c.json({ error: 'invalid_metadata', details: metaErrors }, 400);
  }

  const description =
    typeof body.description === 'string' ? body.description.trim() : undefined;

  try {
    const product = await createProduct(c.env, { name, kind, metadata, description });
    await writeAdminAudit(c.env, admin.id, 'catalog_product_create', {
      product_id: product.id,
      name,
      kind,
    });
    return c.json({ ok: true, product });
  } catch (e) {
    return c.json({ error: 'create_failed', detail: (e as Error).message }, 502);
  }
});

// PATCH /products/:id — update name/metadata/description.
adminCatalog.patch('/products/:id', async (c) => {
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const id = c.req.param('id');

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → no-op */
  }

  const update: UpdateProductBody = {};
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
  if (typeof body.description === 'string') update.description = body.description.trim();
  if (body.metadata && typeof body.metadata === 'object') {
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.metadata as Record<string, unknown>)) {
      if (typeof v === 'string') meta[k] = v;
    }
    // Resolve the kind for taxonomy validation: prefer the body's `kind` if
    // provided, otherwise look up the existing product from the D1 mirror so
    // we always validate against the actual product type.
    let kindForValidation: ProductKind | undefined;
    if (body.kind && isProductKind(body.kind)) {
      kindForValidation = body.kind as ProductKind;
    } else {
      const existing = await getCatalog(c.env).then((ps) => ps.find((p) => p.id === id));
      if (existing) kindForValidation = existing.kind;
    }
    if (kindForValidation) {
      const errs = validateProductMetadata(kindForValidation, meta);
      if (errs.length) return c.json({ error: 'invalid_metadata', details: errs }, 400);
    }
    update.metadata = meta;
  }

  try {
    await updateProduct(c.env, id, update);
    await writeAdminAudit(c.env, admin.id, 'catalog_product_update', {
      product_id: id,
      update,
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: 'update_failed', detail: (e as Error).message }, 502);
  }
});

// POST /products/:id/archive — set active=false on the Stripe Product.
adminCatalog.post('/products/:id/archive', async (c) => {
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const id = c.req.param('id');
  try {
    await archiveProduct(c.env, id);
    await writeAdminAudit(c.env, admin.id, 'catalog_product_archive', { product_id: id });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: 'archive_failed', detail: (e as Error).message }, 502);
  }
});

// POST /products/:id/prices — add a Price to an existing Product.
adminCatalog.post('/products/:id/prices', async (c) => {
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const productId = c.req.param('id');

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → 400 below */
  }

  const currency = String(body.currency || 'usd')
    .trim()
    .toLowerCase();
  const unitAmount = Number(body.unit_amount);
  if (!Number.isInteger(unitAmount) || unitAmount < 0) {
    return c.json({ error: 'unit_amount_invalid', detail: 'must be a non-negative integer (cents)' }, 400);
  }
  const type = body.type === 'one_time' ? 'one_time' : 'recurring';

  const priceBody: CreatePriceBody = { currency, unit_amount: unitAmount, type };
  if (type === 'recurring') {
    const interval = String(body.interval || 'month');
    if (!['month', 'year', 'week', 'day'].includes(interval)) {
      return c.json({ error: 'invalid_interval', allowed: ['month', 'year', 'week', 'day'] }, 400);
    }
    priceBody.interval = interval as 'month' | 'year' | 'week' | 'day';
    if (body.interval_count) priceBody.interval_count = Number(body.interval_count);
  }
  if (typeof body.nickname === 'string' && body.nickname.trim()) {
    priceBody.nickname = body.nickname.trim();
  }

  try {
    const price = await createPrice(c.env, productId, priceBody);
    await writeAdminAudit(c.env, admin.id, 'catalog_price_create', {
      product_id: productId,
      price_id: price.id,
    });
    return c.json({ ok: true, price });
  } catch (e) {
    return c.json({ error: 'create_price_failed', detail: (e as Error).message }, 502);
  }
});

// PATCH /prices/:priceId — update a price's mutable fields (nickname, metadata).
// Stripe Prices are mostly immutable; only nickname and metadata can change.
adminCatalog.patch('/prices/:priceId', async (c) => {
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const priceId = c.req.param('priceId');

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch { /* empty body → no-op */ }

  const patch: { nickname?: string; metadata?: Record<string, string> } = {};
  if (typeof body.nickname === 'string') patch.nickname = body.nickname.trim();
  if (body.metadata && typeof body.metadata === 'object') {
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.metadata as Record<string, unknown>)) {
      if (typeof v === 'string') meta[k] = v;
    }
    patch.metadata = meta;
  }

  try {
    await updatePrice(c.env, priceId, patch);
    await writeAdminAudit(c.env, admin.id, 'catalog_price_update', { price_id: priceId, patch });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: 'update_price_failed', detail: (e as Error).message }, 502);
  }
});

// POST /prices/:priceId/archive — set Stripe Price active=false.
adminCatalog.post('/prices/:priceId/archive', async (c) => {
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const priceId = c.req.param('priceId');
  try {
    await archivePrice(c.env, priceId);
    await writeAdminAudit(c.env, admin.id, 'catalog_price_archive', { price_id: priceId });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: 'archive_price_failed', detail: (e as Error).message }, 502);
  }
});

export default catalog;
export { adminCatalog };
