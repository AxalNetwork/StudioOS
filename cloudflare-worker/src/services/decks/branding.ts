/**
 * Task #16 (DE) — Deck branding + paywall helpers.
 *
 * - Free tier always renders the Axal footer (cannot be removed).
 * - Growth tier removes the footer.
 * - Studio tier may upload a custom brand watermark (per-user setting).
 * - Premium templates require Growth tier; free tier sees a paywall card.
 */
import type { Env, User } from '../../types';
import { tierCovers } from '../../middleware/requireTier';

export type DeckBrand = {
  /** Render a footer? (false on Growth+ unless studio uploaded one). */
  show_footer: boolean;
  footer_text: string;
  /** Studio-tier custom watermark URL, or null. */
  watermark_url: string | null;
  /** True if this user has paid for branding-removal. */
  can_remove_footer: boolean;
};

const AXAL_FOOTER = 'Built with Axal VC · axal.vc';

let _schemaReady = false;
async function ensureWatermarkSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS deck_brand_watermarks (
         user_id INTEGER PRIMARY KEY,
         watermark_url TEXT,
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    ).run();
  } catch (e: any) { console.error('deck_brand_watermarks:', e?.message); }
  _schemaReady = true;
}

export async function getDeckBrand(env: Env, user: User & { id: number }): Promise<DeckBrand> {
  const tier = String((user as any).subscription_tier || 'free').toLowerCase();
  const canRemove = tierCovers(tier, 'growth');
  const isStudio = tierCovers(tier, 'studio');

  let watermark: string | null = null;
  if (isStudio) {
    await ensureWatermarkSchema(env);
    try {
      const row = await env.DB.prepare(
        `SELECT watermark_url FROM deck_brand_watermarks WHERE user_id = ?`,
      ).bind(user.id).first<{ watermark_url: string | null }>();
      watermark = row?.watermark_url || null;
    } catch { /* ignore */ }
  }

  return {
    show_footer: !canRemove,
    footer_text: AXAL_FOOTER,
    watermark_url: watermark,
    can_remove_footer: canRemove,
  };
}

export async function setStudioWatermark(
  env: Env, user: User & { id: number }, url: string | null,
): Promise<void> {
  const tier = String((user as any).subscription_tier || 'free').toLowerCase();
  if (!tierCovers(tier, 'studio')) {
    throw new Error('STUDIO_TIER_REQUIRED');
  }
  await ensureWatermarkSchema(env);
  if (url == null || url === '') {
    await env.DB.prepare(`DELETE FROM deck_brand_watermarks WHERE user_id = ?`).bind(user.id).run();
    return;
  }
  if (!/^https?:\/\//i.test(url) || url.length > 1000) {
    throw new Error('INVALID_WATERMARK_URL');
  }
  await env.DB.prepare(
    `INSERT INTO deck_brand_watermarks (user_id, watermark_url, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET watermark_url = excluded.watermark_url, updated_at = datetime('now')`,
  ).bind(user.id, url).run();
}

/** Throws PAYWALL_PREMIUM_METHOD if a free-tier user picks a premium template. */
export function ensureMethodAllowed(user: User | null, methodId: string, premiumIds: string[]): void {
  if (!premiumIds.includes(methodId)) return;
  const tier = String((user as any)?.subscription_tier || 'free').toLowerCase();
  if (tierCovers(tier, 'growth')) return;
  // Bypass roles (admin, partner, investor, mentor) — these never hit a paywall.
  if (user && ['admin', 'partner', 'investor', 'mentor'].includes(String(user.role))) return;
  const err: any = new Error('PAYWALL_PREMIUM_METHOD');
  err.method_id = methodId;
  err.required_tier = 'growth';
  throw err;
}
