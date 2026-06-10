/**
 * Task #30 — Public (no-auth) endpoints for the Market-Intel watchlist
 * digest. Currently exposes a single GET /unsubscribe?u=<id>&t=<sig>
 * that verifies an HMAC token tied to the user id and removes ALL of
 * that user's watchlist rows.
 *
 * Mounted at /api/market-intel-public so it sits OUTSIDE the auth wall
 * applied to /api/market-intel — links in the digest email must work
 * without an active session.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureMarketIntelSchema } from '../services/market_intel/schema';
import { verifyUnsubscribeToken } from '../services/market_intel/digest';
import { loadSectionAggregates, periodLabel, K_MIN, verifyPublicationToken } from '../services/publications';

const marketIntelPublic = new Hono<{ Bindings: Env }>();

// Task #32 — the digest "unsubscribe" link now lands on a confirmation
// page that offers PAUSE as the primary action and REMOVE ALL SECTORS
// as the secondary destructive action. Both are POSTed back to this
// router with the same HMAC token so the user never has to log in.
//
// Routes:
//   GET  /unsubscribe?u=&t=          → confirmation landing page
//   POST /unsubscribe?u=&t=&action=  → action handler (pause | remove)
//                                      action=pause accepts ?weeks=1|4
//                                      or omitted (defaults to 4 weeks)
marketIntelPublic.get('/unsubscribe', async (c) => {
  const { userId, ok } = await verifyParams(c);
  if (!ok) return c.html(unsubscribePage('Invalid unsubscribe link.'), 400);
  return c.html(confirmationPage(userId, c.req.query('t') || ''));
});

marketIntelPublic.post('/unsubscribe', async (c) => {
  const { userId, ok } = await verifyParams(c);
  if (!ok) return c.html(unsubscribePage('Invalid unsubscribe link.'), 400);
  await ensureMarketIntelSchema(c.env);
  const action = String(c.req.query('action') || 'pause').toLowerCase();

  if (action === 'remove') {
    try {
      await c.env.DB.prepare(
        `DELETE FROM market_intel_watchlist WHERE user_id = ?`,
      ).bind(userId).run();
    } catch (e) {
      console.warn('[mi unsubscribe] delete failed', e);
      return c.html(unsubscribePage('Could not process your request — please try again later.'), 500);
    }
    return c.html(unsubscribePage(
      "You've been unsubscribed and your pinned sectors were removed. Re-pin sectors any time from /market-intelligence.",
    ));
  }

  // Default action is "pause" so a stray POST never deletes the user's
  // watchlist. Window options: 1 week, 4 weeks, indefinitely.
  const weeksRaw = c.req.query('weeks');
  let until: string;
  let humanWindow: string;
  if (weeksRaw === 'indefinite') {
    until = '9999-12-31T00:00:00.000Z';
    humanWindow = 'indefinitely';
  } else {
    const weeks = weeksRaw === '1' ? 1 : 4;
    until = new Date(Date.now() + weeks * 7 * 86_400_000).toISOString();
    humanWindow = weeks === 1 ? 'for one week' : 'for four weeks';
  }
  try {
    await c.env.DB.prepare(
      `UPDATE users SET mi_digest_paused_until = ? WHERE id = ?`,
    ).bind(until, userId).run();
  } catch (e) {
    console.warn('[mi unsubscribe] pause update failed', e);
    return c.html(unsubscribePage('Could not process your request — please try again later.'), 500);
  }
  return c.html(unsubscribePage(
    `Your sector digests are paused ${humanWindow}. Your pinned sectors are still saved — manage them any time from /market-intelligence.`,
  ));
});

async function verifyParams(c: { req: { query: (k: string) => string | undefined }; env: Env }): Promise<{ userId: number; ok: boolean }> {
  const userIdRaw = c.req.query('u') || '';
  const token = c.req.query('t') || '';
  const userId = parseInt(userIdRaw, 10);
  if (!Number.isFinite(userId) || userId <= 0 || !token) {
    return { userId: 0, ok: false };
  }
  const ok = await verifyUnsubscribeToken(c.env, userId, token);
  return { userId, ok };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function confirmationPage(userId: number, token: string): string {
  // The confirmation page POSTs back to /unsubscribe with the same
  // token. PAUSE is primary so the destructive REMOVE action requires
  // a deliberate second click.
  const t = escapeAttr(token);
  const u = String(userId);
  const action = (qs: string) => `?u=${u}&t=${t}&${qs}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Axal — Manage sector digests</title>
<style>
  body{font-family:'Space Grotesk',system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 24px;color:#111;line-height:1.5}
  h1{font-weight:600;margin-bottom:.25rem}
  .lede{color:#555;margin-bottom:2rem}
  form{display:inline}
  button{font:inherit;cursor:pointer;border-radius:.5rem;padding:.6rem 1rem;border:1px solid transparent;margin-right:.5rem;margin-bottom:.5rem}
  .primary{background:#7c3aed;color:#fff;border-color:#7c3aed}
  .primary:hover{background:#6d28d9}
  .secondary{background:#fff;color:#111;border-color:#d1d5db}
  .secondary:hover{background:#f9fafb}
  .danger{background:#fff;color:#b91c1c;border-color:#fecaca}
  .danger:hover{background:#fef2f2}
  hr{border:0;border-top:1px solid #e5e7eb;margin:2rem 0}
  small{color:#6b7280}
</style></head><body>
<h1>Axal StudioOS</h1>
<p class="lede">Pause the sector digest while keeping every sector you've pinned, or remove all of your pinned sectors entirely.</p>

<form method="POST" action="${action('action=pause&weeks=1')}"><button class="primary" type="submit">Pause for 1 week</button></form>
<form method="POST" action="${action('action=pause&weeks=4')}"><button class="primary" type="submit">Pause for 1 month</button></form>
<form method="POST" action="${action('action=pause&weeks=indefinite')}"><button class="secondary" type="submit">Pause indefinitely</button></form>

<hr/>

<form method="POST" action="${action('action=remove')}" onsubmit="return confirm('This deletes every sector you have pinned. Are you sure?')"><button class="danger" type="submit">Remove all pinned sectors</button></form>

<p><small>You can also manage cadence and pause from inside the app at <a href="/market-intelligence">/market-intelligence</a>.</small></p>
</body></html>`;
}

function unsubscribePage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Axal — Sector digests</title>
<style>body{font-family:'Space Grotesk',system-ui,sans-serif;max-width:540px;margin:80px auto;padding:0 24px;color:#111}</style>
</head><body><h1 style="font-weight:600">Axal StudioOS</h1>
<p>${message.replace(/</g, '&lt;')}</p></body></html>`;
}

// Task #6 (ID) — Public index of published insights for the /insights
// landing page. Lists only published, non-internal publications with a
// minimal card shape; the heavy aggregate payload is loaded per-slug by
// the read endpoint below. Outside the CF Access perimeter like the read.
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
// Mounted under /api/market-intel-public, which sits OUTSIDE the
// /api/admin/* CF Access perimeter, so anonymous visitors can read a
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
  // PII / internal-data exposure on an endpoint that sits outside the
  // CF Access perimeter and is reachable by anyone with the slug.
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
// authorisation, so this lives outside the CF Access perimeter to allow
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
