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
  // Task #16 SSRF guard: must be a public https:// URL. Watermarks are
  // fetched by Cloudflare Browser Rendering during /export, so loopback /
  // RFC1918 hostnames are refused.
  const safe = sanitizeWatermarkUrl(url);
  if (!safe) throw new Error('INVALID_WATERMARK_URL');
  await env.DB.prepare(
    `INSERT INTO deck_brand_watermarks (user_id, watermark_url, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET watermark_url = excluded.watermark_url, updated_at = datetime('now')`,
  ).bind(user.id, safe).run();
}

function sanitizeWatermarkUrl(input: string): string | null {
  const raw = String(input).trim();
  if (!raw || raw.length > 1000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
    host.endsWith('.local') || host.endsWith('.internal') ||
    /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) return null;
  return u.toString();
}

export type BrandKitRow = {
  logo_url: string | null;
  logo_svg: string | null;
  logo_asset_id: string | null;
  theme_color: string | null;
  palette_bg: string | null;
  palette_ink: string | null;
  palette_secondary: string | null;
  palette_accent: string | null;
  font_pairing: string | null;
  name: string | null;
};

export async function fetchLandingPageForProject(env: Env, projectId: number): Promise<BrandKitRow | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT logo_url, logo_svg, logo_asset_id, theme_color, palette_bg, palette_ink,
              palette_secondary, palette_accent, font_pairing, name
       FROM landing_pages WHERE project_id = ?`
    ).bind(projectId).first<BrandKitRow>();
    return row || null;
  } catch {
    return null;
  }
}

export type BrandTheme = 'full' | 'accent_only' | 'off';

/**
 * Task #6 — Inject brand kit fields into the cover slide of any deck.
 *
 * - `full`:       overwrites bg, ink, accent, and fonts.
 * - `accent_only`: injects theme_color as accent; leaves bg neutral.
 * - `off`:         skips palette but still injects logo + project name.
 *
 * Brandkit fields are written as paragraph fields on the cover slide so
 * `buildTemplateData()` in the frontend flattens them into `data.brandkit_*`.
 */
export function applyBrandKitToSlides(
  slides: any[],
  landingPage: BrandKitRow | null,
  brandTheme: BrandTheme,
  projectName?: string | null,
): any[] {
  if (!slides || !slides.length) return slides;

  const hasKit = !!landingPage;
  const kit = {
    present: hasKit,
    logo_url: landingPage?.logo_url || null,
    logo_svg: landingPage?.logo_svg || null,
    logo_asset_id: landingPage?.logo_asset_id || null,
    theme_color: landingPage?.theme_color || null,
    bg: landingPage?.palette_bg || null,
    ink: landingPage?.palette_ink || null,
    secondary: landingPage?.palette_secondary || null,
    accent: landingPage?.palette_accent || null,
    fonts: landingPage?.font_pairing || null,
  };

  // Find the cover slide (first match of spec_id, id, or title heuristics)
  const coverIdx = slides.findIndex((s) =>
    s?.spec_id === 'cover' || s?.id === 'title' || s?.title === 'Title' || s?.title === 'Cover'
  );
  const coverIdxResolved = coverIdx >= 0 ? coverIdx : 0;

  const brandFields = [
    { kind: 'paragraph', key: 'brandkit_present', value: kit.present ? 'true' : 'false' },
    { kind: 'paragraph', key: 'brandkit_logo_url', value: kit.logo_url || '' },
    { kind: 'paragraph', key: 'brandkit_logo_svg', value: kit.logo_svg || '' },
    { kind: 'paragraph', key: 'brandkit_logo_asset_id', value: kit.logo_asset_id || '' },
    { kind: 'paragraph', key: 'brandkit_theme_color', value: kit.theme_color || '' },
    { kind: 'paragraph', key: 'brandkit_bg', value: kit.bg || '' },
    { kind: 'paragraph', key: 'brandkit_ink', value: kit.ink || '' },
    { kind: 'paragraph', key: 'brandkit_secondary', value: kit.secondary || '' },
    { kind: 'paragraph', key: 'brandkit_accent', value: (brandTheme === 'accent_only' ? kit.theme_color : kit.accent) || '' },
    { kind: 'paragraph', key: 'brandkit_fonts', value: kit.fonts || '' },
    { kind: 'paragraph', key: 'brandkit_theme', value: brandTheme },
    { kind: 'paragraph', key: 'brandkit_project_name', value: projectName || '' },
  ];

  const cover = slides[coverIdxResolved];
  const fields = Array.isArray(cover?.fields) ? [...cover.fields] : [];
  const filtered = fields.filter((f: any) => !f?.key?.startsWith('brandkit_'));
  filtered.push(...brandFields);

  const newSlides = [...slides];
  newSlides[coverIdxResolved] = { ...cover, fields: filtered };
  return newSlides;
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
