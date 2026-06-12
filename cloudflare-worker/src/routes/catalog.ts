/**
 * Task — Stripe-backed Product Catalog.
 *
 * Read + admin-sync surface over the D1 mirror of the Stripe catalog. The
 * mirror is repopulated from Stripe (the source of truth) by the sync route;
 * the read route serves cheaply from D1.
 *
 * Endpoints:
 *   GET  /api/catalog/products[?kind=]   public-ish read of mirrored catalog
 *   POST /api/admin/catalog/sync         admin-only re-pull from Stripe → D1
 *
 * The two prefixes are exported as separate routers so each mounts under the
 * correct base (`/api/catalog` is auth-light; `/api/admin/catalog` is gated by
 * requireAdmin + the admin perimeter).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { getCatalog, syncCatalog, isProductKind, type ProductKind } from '../services/catalog';

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
  try {
    const products = await getCatalog(c.env, kind);
    return c.json({ products });
  } catch (e) {
    return c.json({ error: 'catalog_read_failed', detail: (e as Error).message }, 502);
  }
});

// ---------- admin sync ----------
const adminCatalog = new Hono<{ Bindings: Env }>();

adminCatalog.post('/sync', async (c) => {
  await requireAdmin(c);
  try {
    const result = await syncCatalog(c.env);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: 'catalog_sync_failed', detail: (e as Error).message }, 502);
  }
});

export default catalog;
export { adminCatalog };
