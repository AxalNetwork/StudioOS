/**
 * Products page backend — promo status + redemption.
 *
 * The Products page (frontend/src/pages/ProductsPage.jsx) is in-house UI on
 * a Stripe backend. The catalog + paid checkout reuse the existing surfaces:
 *   - GET  /api/catalog/products        — mirrored Stripe catalog (routes/catalog.ts)
 *   - POST /api/payments/intent          — embedded checkout (routes/payments.ts)
 *   - POST /api/payments/alacarte/intent — à-la-carte checkout
 *
 * This router adds only the explorer-promo surface that has no Stripe
 * counterpart (services/explorerPromo.ts — synthetic one-time codes that
 * redeem straight into a 30-day feature_unlocks row, $0, no Stripe call):
 *
 *   GET  /api/products/promo   — the caller's issued code + redemption state
 *   POST /api/products/redeem  — { code } → $0 billing confirmation
 *
 * Both endpoints operate strictly on the requireAuth-verified caller's own
 * rows: a code issued to another account returns `not_found` (never
 * "belongs to someone else"), so codes can't be used to probe accounts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import {
  getExplorerPromo,
  redeemExplorerPromo,
} from '../services/explorerPromo';

const products = new Hono<{ Bindings: Env }>();

// The caller's issued explorer promo (null when none). The Products page
// uses this to pre-render the redeem card without waiting for a code paste.
products.get('/promo', async (c) => {
  const user = await requireAuth(c);
  const promo = await getExplorerPromo(c.env, user.id);
  return c.json({
    promo: promo ? {
      code: promo.code,
      license_label: promo.license_label,
      unlock_days: promo.unlock_days,
      issued_at: promo.issued_at,
      expires_at: promo.expires_at,
      redeemed_at: promo.redeemed_at,
    } : null,
  });
});

// Redeem the caller's one-time code. Success returns a $0 billing
// confirmation the page renders as a receipt; failures return a stable
// `reason` the page maps to friendly copy.
products.post('/redeem', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as { code?: unknown }));
  const code = String(body?.code || '').trim();
  if (!code) return c.json({ ok: false, reason: 'not_found' }, 400);

  const result = await redeemExplorerPromo(c.env, user.id, code);
  if (!result.ok) {
    return c.json({ ok: false, reason: result.reason }, 400);
  }

  // Best-effort activity trail — mirrors the advisor_field_filled pattern;
  // failure must not undo the (already-committed) redemption.
  try {
    const { hashEmail } = await import('../util/hashEmail');
    const actorHash = await hashEmail(user.email || '');
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'explorer_promo_redeemed',
      JSON.stringify({
        license_label: result.confirmation?.license_label,
        feature_key: result.confirmation?.feature_key,
        unlock_days: result.confirmation?.unlock_days,
      }),
      actorHash,
      user.id,
    ).run();
  } catch { /* best-effort */ }

  return c.json({ ok: true, confirmation: result.confirmation });
});

export default products;
