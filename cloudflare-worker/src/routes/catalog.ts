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
 * HQ endpoints (D1009: Super Admin reads/sync; fresh TOTP step-up and reason for product/price writes):
 *   POST /api/admin/catalog/sync                        re-pull from Stripe → D1
 *   GET  /api/admin/catalog/mode                        Stripe Test vs Live flag
 *   GET  /api/admin/catalog/products                    list all products (admin view)
 *   POST /api/admin/catalog/products                    create product + re-sync
 *   PATCH /api/admin/catalog/products/:id               update name/metadata + re-sync
 *   POST /api/admin/catalog/products/:id/archive        set active=false + re-sync
 *   POST /api/admin/catalog/products/:id/prices         add price + re-sync
 *   PATCH /api/admin/catalog/prices/:priceId            update price nickname/metadata
 *   POST /api/admin/catalog/prices/:priceId/archive     set price active=false + re-sync
 *
 * D755 token packs (requireSuperAdmin, #1919):
 *   POST  /api/admin/catalog/token-packs                {amount_usd, idempotency_key}  create product + price + row
 *   POST  /api/admin/catalog/token-packs/adopt          {price_id}                      record an existing price
 *   PATCH /api/admin/catalog/token-packs/:uid           {on_sale?, bonus_usd?, sort?, offer_starts_at?, offer_ends_at?, first_purchase_only?}
 *   POST  /api/admin/catalog/token-packs/:uid/archive   on_sale=0, archived_at, archive the Stripe price
 * The generic writes above refuse a pack, its product or its price with 409
 * `token_pack_managed_on_hq`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import {
  getCatalog,
  syncCatalog,
  isProductKind,
  isAudienceCategory,
  PRODUCT_KINDS,
  AUDIENCE_CATEGORIES,
  stripeMode,
  validateProductMetadata,
  paymentChangeReason,
  createProduct,
  updateProduct,
  archiveProduct,
  createPrice,
  updatePrice,
  archivePrice,
  findCatalogProductByPriceId,
  fetchAndMirrorPrice,
  type ProductKind,
  type UpdateProductBody,
  type CreatePriceBody,
} from '../services/catalog';
import { ensureAdminAuditLogTable } from './admin';
import { isTokenPackPrice, isTokenPackProduct, packLabel, TOKEN_PACK_LIMITS } from '../services/aiCredits';
import { refuse } from '../util/refusal';
import { StripeApiError } from '../util/stripeError';

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
    return refuse(c, 502, { code: 'catalog_read_failed', message: 'The catalogue could not be read. Try again in a moment.', raw: e, audience: 'member' });
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

/**
 * D755 §4: a token pack is made, adopted, changed and archived only on HQ's
 * token-pack routes below. The generic writes refuse a pack's product or price,
 * and a product of kind `token_pack`, so no Admin can mint or reprice one.
 */
const PACK_MANAGED = { error: 'token_pack_managed_on_hq', message: 'Token packs are managed on HQ › AI allowances › Token packs.' } as const;
async function productIsPack(env: Env, productId: string): Promise<boolean> {
  if (await isTokenPackProduct(env, productId)) return true;
  const mirrored = await getCatalog(env).then((ps) => ps.find((p) => p.id === productId));
  return mirrored?.kind === 'token_pack';
}

/** What a failed sync records (D1011): Stripe's HTTP status and error code when Stripe refused, else that it was not Stripe. */
export function syncFailureOf(e: unknown): Record<string, unknown> {
  if (e instanceof StripeApiError) return { failure: 'stripe', stripe_status: e.status, stripe_code: e.code };
  return { failure: 'other' };
}

adminCatalog.post('/sync', async (c) => {
  const admin = await requireSuperAdmin(c);
  try {
    const result = await syncCatalog(c.env);
    await writeAdminAudit(c.env, admin.id, 'catalog_sync', {
      synced: (result as { synced?: number }).synced ?? 0,
    });
    return c.json({ ok: true, ...result });
  } catch (e) {
    // D1011 (PAY6 C): a failed sync is recorded too, with who started it and
    // what kind of failure it was. Stripe's status and code only, never its
    // text, so nothing the call carried can reach the log.
    await writeAdminAudit(c.env, admin.id, 'catalog_sync_failed', syncFailureOf(e));
    return refuse(c, 502, { code: 'catalog_sync_failed', message: 'The catalogue could not be synced with Stripe. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// GET /mode — Stripe Test vs Live flag (never returns the secret key value).
adminCatalog.get('/mode', async (c) => {
  await requireSuperAdmin(c);
  return c.json({ mode: stripeMode(c.env) });
});

// GET /products — full catalog list (admin view: all kinds, active + inactive).
adminCatalog.get('/products', async (c) => {
  await requireSuperAdmin(c);
  try {
    const products = await getCatalog(c.env);
    return c.json({ products, mode: stripeMode(c.env), audience_categories: AUDIENCE_CATEGORIES });
  } catch (e) {
    return refuse(c, 502, { code: 'catalog_read_failed', message: 'The catalogue could not be read. Try again in a moment.', raw: e, audience: 'admin' });
  }
});

// POST /products — create a Stripe Product + mirror. Validates metadata taxonomy.
adminCatalog.post('/products', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const reason = paymentChangeReason(await c.req.json().catch(() => null));
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
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
  if (kind === 'token_pack') return c.json(PACK_MANAGED, 409);

  const metadata: Record<string, string> = {};
  if (body.metadata && typeof body.metadata === 'object') {
    for (const [k, v] of Object.entries(body.metadata as Record<string, unknown>)) {
      if (typeof v === 'string') metadata[k] = v;
    }
  }

  if (metadata.kind === 'token_pack') return c.json(PACK_MANAGED, 409);
  const metaErrors = validateProductMetadata(kind, metadata);
  if (metaErrors.length) {
    return c.json({ error: 'invalid_metadata', details: metaErrors }, 400);
  }

  const description =
    typeof body.description === 'string' ? body.description.trim() : undefined;

  try {
    const product = await createProduct(c.env, { name, kind, metadata, description });
    await writeAdminAudit(c.env, admin.id, 'catalog_product_create', {
      reason,
      product_id: product.id,
      name,
      kind,
    });
    return c.json({ ok: true, product });
  } catch (e) {
    return refuse(c, 502, { code: 'create_failed', message: 'The product could not be created in Stripe. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// PATCH /products/:id — update name/metadata/description.
adminCatalog.patch('/products/:id', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const reason = paymentChangeReason(await c.req.json().catch(() => null));
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const id = c.req.param('id');
  if (await productIsPack(c.env, id)) return c.json(PACK_MANAGED, 409);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → no-op */
  }
  if (body.kind === 'token_pack' || (body.metadata && typeof body.metadata === 'object' && (body.metadata as Record<string, unknown>).kind === 'token_pack')) {
    return c.json(PACK_MANAGED, 409);
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
      reason,
      product_id: id,
      update,
    });
    return c.json({ ok: true });
  } catch (e) {
    return refuse(c, 502, { code: 'update_failed', message: 'The product could not be updated in Stripe. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// POST /products/:id/archive — set active=false on the Stripe Product.
adminCatalog.post('/products/:id/archive', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const reason = paymentChangeReason(await c.req.json().catch(() => null));
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const id = c.req.param('id');
  if (await productIsPack(c.env, id)) return c.json(PACK_MANAGED, 409);
  try {
    await archiveProduct(c.env, id);
    await writeAdminAudit(c.env, admin.id, 'catalog_product_archive', { reason, product_id: id });
    return c.json({ ok: true });
  } catch (e) {
    return refuse(c, 502, { code: 'archive_failed', message: 'The product could not be archived in Stripe. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// POST /products/:id/prices — add a Price to an existing Product.
adminCatalog.post('/products/:id/prices', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const reason = paymentChangeReason(await c.req.json().catch(() => null));
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const productId = c.req.param('id');
  if (await productIsPack(c.env, productId)) return c.json(PACK_MANAGED, 409);

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
      reason,
      product_id: productId,
      price_id: price.id,
    });
    return c.json({ ok: true, price });
  } catch (e) {
    return refuse(c, 502, { code: 'create_price_failed', message: 'The price could not be created in Stripe. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// PATCH /prices/:priceId — update a price's mutable fields (nickname, metadata).
// Stripe Prices are mostly immutable; only nickname and metadata can change.
adminCatalog.patch('/prices/:priceId', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const reason = paymentChangeReason(await c.req.json().catch(() => null));
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const priceId = c.req.param('priceId');
  if (await isTokenPackPrice(c.env, priceId)) return c.json(PACK_MANAGED, 409);

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
    await writeAdminAudit(c.env, admin.id, 'catalog_price_update', { reason, price_id: priceId, patch });
    return c.json({ ok: true });
  } catch (e) {
    return refuse(c, 502, { code: 'update_price_failed', message: 'The price could not be updated in Stripe. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// POST /prices/:priceId/archive — set Stripe Price active=false.
adminCatalog.post('/prices/:priceId/archive', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const reason = paymentChangeReason(await c.req.json().catch(() => null));
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const priceId = c.req.param('priceId');
  if (await isTokenPackPrice(c.env, priceId)) return c.json(PACK_MANAGED, 409);
  try {
    await archivePrice(c.env, priceId);
    await writeAdminAudit(c.env, admin.id, 'catalog_price_archive', { reason, price_id: priceId });
    return c.json({ ok: true });
  } catch (e) {
    return refuse(c, 502, { code: 'archive_price_failed', message: 'The price could not be archived in Stripe. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// ---------- D755 token packs (Super Admin only; #1919) ----------
const IDEM_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const PRICE_ID = /^price_[A-Za-z0-9]+$/;
async function packRowByUid(env: Env, uid: string) {
  return env.DB.prepare('SELECT * FROM ai_token_packs WHERE uid = ?').bind(uid).first<any>();
}
function packView(row: any) {
  return { uid: row.uid, label: packLabel(row.face_cents), price_id: row.price_id, product_id: row.product_id, face_cents: row.face_cents,
    bonus_microusd: row.bonus_microusd, on_sale: row.on_sale === 1, sort: row.sort, origin: row.origin, archived_at: row.archived_at,
    offer_starts_at: row.offer_starts_at ?? null, offer_ends_at: row.offer_ends_at ?? null, first_purchase_only: row.first_purchase_only === 1 };
}
/** D790: an offer window's end as stored (ISO 8601 UTC, `toISOString`), null for an open end, or undefined when unreadable. */
function offerTime(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}
const wholeDollarsInRange = (cents: number) =>
  Number.isSafeInteger(cents) && cents % 100 === 0 && cents >= TOKEN_PACK_LIMITS.minFaceCents && cents <= TOKEN_PACK_LIMITS.maxFaceCents;
const PACK_AMOUNT = { error: 'token_pack_amount_invalid', message: 'A pack is whole dollars from $5 to $500.' } as const;

// POST /token-packs — §4: the Worker creates the product and its one-time USD
// price with its own key, each with an Idempotency-Key, so a retried press
// gives one product, one price and one row.
adminCatalog.post('/token-packs', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { amount_usd?: unknown; idempotency_key?: unknown };
  const amount = body.amount_usd;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || !wholeDollarsInRange(amount * 100)) return c.json(PACK_AMOUNT, 400);
  const key = body.idempotency_key;
  if (typeof key !== 'string' || !IDEM_KEY.test(key)) return c.json({ error: 'idempotency_key_required', message: 'Send an idempotency key of 8 to 64 letters, digits, - or _.' }, 400);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const faceCents = amount * 100;
  try {
    const product = await createProduct(c.env, { name: packLabel(faceCents), kind: 'token_pack',
      metadata: { kind: 'token_pack', decision: 'D755', seller: 'management' } }, { idempotencyKey: `token_pack:${key}:product` });
    const price = await createPrice(c.env, product.id, { currency: 'usd', unit_amount: faceCents, type: 'one_time' }, { idempotencyKey: `token_pack:${key}:price` });
    if (price.type !== 'one_time' || price.currency !== 'usd' || price.unit_amount !== faceCents) throw new Error('stripe price does not match the pack');
    await c.env.DB.prepare(`INSERT OR IGNORE INTO ai_token_packs(price_id, product_id, face_cents, on_sale, origin, created_by)
      VALUES (?, ?, ?, 0, 'created', ?)`).bind(price.id, product.id, faceCents, admin.id).run();
    const row = await c.env.DB.prepare('SELECT * FROM ai_token_packs WHERE price_id = ?').bind(price.id).first<any>();
    if (!row || row.product_id !== product.id || row.face_cents !== faceCents) throw new Error('token pack row unreadable');
    await writeAdminAudit(c.env, admin.id, 'token_pack_create', { uid: row.uid, price_id: price.id, product_id: product.id, face_cents: faceCents, idempotency_key: key });
    return c.json({ ok: true, pack: packView(row) });
  } catch (e) {
    return refuse(c, 502, { code: 'token_pack_create_failed', message: 'The token pack could not be created in Stripe. Pressing Create again with the same key is safe.', raw: e, audience: 'admin' });
  }
});

// POST /token-packs/adopt — record an existing one-time USD price of whole dollars from $5 to $500, after D750's judge.
adminCatalog.post('/token-packs/adopt', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { price_id?: unknown };
  const priceId = body.price_id;
  if (typeof priceId !== 'string' || !PRICE_ID.test(priceId)) return c.json({ error: 'invalid_price', message: 'Give a Stripe price ID (price_…).' }, 400);
  try {
    const existing = await c.env.DB.prepare('SELECT * FROM ai_token_packs WHERE price_id = ?').bind(priceId).first<any>();
    if (existing) return c.json({ ok: true, already: true, pack: packView(existing) });
    const { judge } = await import('../services/aiTopups');
    let found = await findCatalogProductByPriceId(c.env, priceId);
    if (!found) {
      const fetched = await fetchAndMirrorPrice(c.env, priceId);
      if (fetched.state !== 'mirrored') return c.json({ error: 'token_pack_not_adoptable', reason: fetched.state === 'mode_mismatch' ? 'mode_mismatch' : 'missing_from_catalog' }, 400);
      found = { product: fetched.product, price: fetched.price };
    }
    const r = judge(priceId, found as any);
    if (!r.configured || r.state !== 'ready') return c.json({ error: 'token_pack_not_adoptable', reason: r.configured && r.state === 'not_ready' ? r.reason : 'bad_config' }, 400);
    if (!wholeDollarsInRange(r.product.unit_amount)) return c.json({ error: 'token_pack_not_adoptable', reason: 'bad_amount', message: PACK_AMOUNT.message }, 400);
    await c.env.DB.prepare(`INSERT OR IGNORE INTO ai_token_packs(price_id, product_id, face_cents, on_sale, origin, created_by)
      VALUES (?, ?, ?, 0, 'adopted', ?)`).bind(priceId, r.product.product_id, r.product.unit_amount, admin.id).run();
    const row = await c.env.DB.prepare('SELECT * FROM ai_token_packs WHERE price_id = ?').bind(priceId).first<any>();
    if (!row) throw new Error('token pack row unreadable');
    await writeAdminAudit(c.env, admin.id, 'token_pack_adopt', { uid: row.uid, price_id: priceId, face_cents: row.face_cents });
    return c.json({ ok: true, already: false, pack: packView(row) });
  } catch (e) {
    return refuse(c, 502, { code: 'token_pack_adopt_failed', message: 'The price could not be adopted. Nothing changed; try again in a moment.', raw: e, audience: 'admin' });
  }
});

// PATCH /token-packs/:uid — on sale, bonus (0–10% of face), sort, and D790's offer window and first purchase only.
// An amount never changes: a new amount is a new pack.
adminCatalog.patch('/token-packs/:uid', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_request' }, 400);
  if ('amount_usd' in body || 'face_cents' in body || 'unit_amount' in body || 'price_id' in body)
    return c.json({ error: 'token_pack_amount_fixed', message: 'A pack\'s amount never changes. Create a new pack for a new amount.' }, 400);
  try {
    const row = await packRowByUid(c.env, c.req.param('uid'));
    if (!row) return c.json({ error: 'token_pack_not_found' }, 404);
    if (row.archived_at) return c.json({ error: 'token_pack_archived', message: 'This pack is archived.' }, 409);
    let onSale = row.on_sale, bonus = row.bonus_microusd, sort = row.sort;
    let starts: string | null = row.offer_starts_at ?? null, ends: string | null = row.offer_ends_at ?? null, first = row.first_purchase_only === 1 ? 1 : 0;
    if ('on_sale' in body) { if (typeof body.on_sale !== 'boolean') return c.json({ error: 'invalid_on_sale' }, 400); onSale = body.on_sale ? 1 : 0; }
    if ('bonus_usd' in body) {
      const b = body.bonus_usd;
      const micro = typeof b === 'number' && Number.isFinite(b) ? Math.round(b * 1_000_000) : NaN;
      if (!Number.isSafeInteger(micro) || micro < 0 || micro > row.face_cents * 100 * TOKEN_PACK_LIMITS.maxBonusPercent)
        return c.json({ error: 'token_pack_bonus_invalid', message: 'A bonus is 0 to 10% of the pack\'s face value.' }, 400);
      bonus = micro;
    }
    if ('sort' in body) { if (typeof body.sort !== 'number' || !Number.isSafeInteger(body.sort)) return c.json({ error: 'invalid_sort' }, 400); sort = body.sort; }
    // D790: the bonus's offer window, either end open (null), and first purchase only.
    const OFFER_TIME = { error: 'token_pack_offer_invalid', message: 'An offer starts and ends at a date and time, or is left open.' } as const;
    if ('offer_starts_at' in body) { const t = offerTime(body.offer_starts_at); if (t === undefined) return c.json(OFFER_TIME, 400); starts = t; }
    if ('offer_ends_at' in body) { const t = offerTime(body.offer_ends_at); if (t === undefined) return c.json(OFFER_TIME, 400); ends = t; }
    if (starts !== null && ends !== null && Date.parse(ends) <= Date.parse(starts))
      return c.json({ error: 'token_pack_offer_window_invalid', message: 'An offer must end after it starts.' }, 400);
    if ('first_purchase_only' in body) {
      if (typeof body.first_purchase_only !== 'boolean') return c.json({ error: 'invalid_first_purchase_only' }, 400);
      first = body.first_purchase_only ? 1 : 0;
    }
    await c.env.DB.prepare(`UPDATE ai_token_packs SET on_sale = ?, bonus_microusd = ?, sort = ?, offer_starts_at = ?, offer_ends_at = ?,
      first_purchase_only = ?, updated_at = datetime('now') WHERE uid = ? AND archived_at IS NULL`)
      .bind(onSale, bonus, sort, starts, ends, first, row.uid).run();
    const next = await packRowByUid(c.env, row.uid);
    await writeAdminAudit(c.env, admin.id, 'token_pack_update', { uid: row.uid, on_sale: onSale === 1, bonus_microusd: bonus, sort,
      offer_starts_at: starts, offer_ends_at: ends, first_purchase_only: first === 1,
      was: { on_sale: row.on_sale === 1, bonus_microusd: row.bonus_microusd, sort: row.sort,
        offer_starts_at: row.offer_starts_at ?? null, offer_ends_at: row.offer_ends_at ?? null, first_purchase_only: row.first_purchase_only === 1 } });
    return c.json({ ok: true, pack: packView(next) });
  } catch (e) {
    return refuse(c, 503, { code: 'token_pack_update_failed', message: 'The token pack was not changed.', raw: e, audience: 'admin' });
  }
});

// POST /token-packs/:uid/archive — off sale for good, and the Stripe price archived.
adminCatalog.post('/token-packs/:uid/archive', async (c) => {
  const admin = await requireSuperAdmin(c);
  try {
    const row = await packRowByUid(c.env, c.req.param('uid'));
    if (!row) return c.json({ error: 'token_pack_not_found' }, 404);
    if (row.archived_at) return c.json({ ok: true, already: true, pack: packView(row) });
    if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
    // Off sale first, so a Stripe failure below leaves the pack unsellable rather than half archived.
    await c.env.DB.prepare(`UPDATE ai_token_packs SET on_sale = 0, updated_at = datetime('now') WHERE uid = ?`).bind(row.uid).run();
    await archivePrice(c.env, row.price_id);
    await c.env.DB.prepare(`UPDATE ai_token_packs SET archived_at = datetime('now'), updated_at = datetime('now') WHERE uid = ? AND archived_at IS NULL`).bind(row.uid).run();
    const next = await packRowByUid(c.env, row.uid);
    await writeAdminAudit(c.env, admin.id, 'token_pack_archive', { uid: row.uid, price_id: row.price_id });
    return c.json({ ok: true, already: false, pack: packView(next) });
  } catch (e) {
    return refuse(c, 502, { code: 'token_pack_archive_failed', message: 'The token pack is off sale, but its Stripe price could not be archived. Try Archive again.', raw: e, audience: 'admin' });
  }
});

export default catalog;
export { adminCatalog };
