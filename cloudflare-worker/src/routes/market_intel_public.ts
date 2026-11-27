/**
 * Public (no-auth) endpoints beside /api/market-intel: the published
 * insights, and what is left of the sector digest.
 *
 * Mounted at /api/market-intel-public so it sits OUTSIDE the auth wall
 * applied to /api/market-intel — a link in an email or a shared report must
 * work without an active session.
 *
 * D670 — THE SECTOR DIGEST IS RETIRED. Task #30's weekly and monthly email
 * (and Task #32's pause and remove page behind its unsubscribe link) went
 * with the /market-intel page. A digest already sitting in someone's inbox
 * still carries that link, so `/unsubscribe` answers, GET or POST, with one
 * page saying no more digests will be sent. It changes nothing and so needs
 * no token: there is nothing left to unsubscribe from.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { loadSectionAggregates, periodLabel, K_MIN, verifyPublicationToken } from '../services/publications';

const marketIntelPublic = new Hono<{ Bindings: Env }>();

const DIGEST_STOPPED = `<!doctype html><html><head><meta charset="utf-8"><title>Axal — Sector digests</title>
<style>body{font-family:'Space Grotesk',system-ui,sans-serif;max-width:540px;margin:80px auto;padding:0 24px;color:#111}</style>
</head><body><h1 style="font-weight:600">Axal StudioOS</h1>
<p>Axal no longer sends sector digests, so there is nothing to unsubscribe from. You will not receive another one.</p></body></html>`;

marketIntelPublic.get('/unsubscribe', (c) => c.html(DIGEST_STOPPED));
marketIntelPublic.post('/unsubscribe', (c) => c.html(DIGEST_STOPPED));

// Task #6 (ID) — Public index of published insights for the /insights
// landing page. Lists only published, non-internal publications with a
// minimal card shape; the heavy aggregate payload is loaded per-slug by
// the read endpoint below. Outside auth and /api/admin's gates, like the read.
marketIntelPublic.get('/publications', async (c) => {
  let rows: Array<{ slug: string; title: string; subtitle: string | null; section: string; published_at: string | null }> = [];
  try {
    const res = await c.env.DB.prepare(
      "SELECT slug, title, subtitle, section, published_at FROM admin_publications WHERE status = 'published' AND audience != 'internal' ORDER BY COALESCE(published_at, '') DESC, id DESC LIMIT 100",
    ).all<{ slug: string; title: string; subtitle: string | null; section: string; published_at: string | null }>();
    rows = res.results || [];
  } catch (e) {
    // Table may not exist yet (no publications drafted) — return empty list.
    console.warn('[mi public] publications list query failed:', (e as Error).message);
    rows = [];
  }
  return c.json({ publications: rows });
});

// Task #2 (AU) — Public read for an admin-published Axal-VC publication.
// Mounted under /api/market-intel-public, which sits OUTSIDE auth and
// /api/admin's gates, so anonymous visitors can read a
// published report at /insights/public/:slug without an Axal session.
marketIntelPublic.get('/publications/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!slug || !/^[a-z0-9-]{1,80}$/i.test(slug)) {
    return c.json({ error: 'invalid_slug' }, 400);
  }
  // Lazy schema bootstrap — the admin route also runs this; safe to skip
  // if the table doesn't exist (just returns 404).
  let pub;
  try {
    pub = await c.env.DB.prepare(
      "SELECT id, slug, title, subtitle, audience, section, filters_json, summary_text, status, published_at FROM admin_publications WHERE slug = ? AND status = 'published' LIMIT 1",
    ).bind(slug).first<{
      id: number; slug: string; title: string; subtitle: string | null;
      audience: string; section: string; filters_json: string;
      summary_text: string; status: string; published_at: string | null;
    }>();
  } catch (e) {
    console.warn('[mi public] publications query failed:', (e as Error).message);
    return c.json({ error: 'not_found' }, 404);
  }
  if (!pub) return c.json({ error: 'not_found' }, 404);
  let filters: Record<string, unknown> = {};
  try { filters = JSON.parse(pub.filters_json || '{}') as Record<string, unknown>; } catch { /* keep {} */ }
  const internalAggregates = await loadSectionAggregates(c.env, pub.section, filters);
  // Strict allow-list for the public read shape. The internal
  // AggregateRow includes `payload` (raw payload_json blobs that may
  // carry sample-row metadata, internal scoring labels, or partner
  // notes); per spec the public endpoint must expose ONLY the four
  // k-anonymized aggregate fields. Returning `payload` here would be a
  // PII / internal-data exposure on an endpoint that runs no auth at all
  // and is reachable by anyone with the slug.
  const aggregates = internalAggregates.map(r => ({
    dimension_key: r.dimension_key,
    period_key: r.period_key,
    n: r.n,
    value: r.value,
  }));
  return c.json({
    publication: {
      slug: pub.slug,
      title: pub.title,
      subtitle: pub.subtitle,
      audience: pub.audience,
      section: pub.section,
      filters,
      summary_text: pub.summary_text,
      published_at: pub.published_at,
      og: {
        title: `${pub.title} · Axal VC`,
        description: (pub.subtitle || pub.summary_text || '')
          .replace(/^-\s*\[[^\]]*\]\s*/, '')
          .replace(/\s*\(\d{4}-W?\d+\)\s*$/, '')
          .slice(0, 200),
        site_name: 'Axal Venture Studio',
      },
    },
    aggregates,
    period_label: periodLabel(internalAggregates),
    k_min: K_MIN,
  });
});

// Task #2 (AU) — HMAC-gated download for any publication render artifact
// in R2. The token (24h TTL, prefix-locked to "publications/") IS the
// authorisation, so this lives outside auth and /api/admin's gates to allow
// admins to forward render links by email to LPs/founders/media.
marketIntelPublic.get('/publications/download/:token', async (c) => {
  const v = await verifyPublicationToken(c.env, c.req.param('token'));
  if (!v) return c.json({ error: 'link_expired_or_invalid' }, 403);
  const bucket = c.env.PUBLICATIONS || c.env.FILES || null;
  if (!bucket) return c.json({ error: 'r2_unavailable' }, 503);
  const obj = await bucket.get(v.key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=0, no-store');
  headers.set('Content-Disposition', `attachment; filename="${v.key.split('/').pop()}"`);
  return new Response(obj.body, { headers });
});

export default marketIntelPublic;
