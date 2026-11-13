/**
 * Task #10 (LD) — Public team roster endpoint.
 *
 * Mounted at /api/public/team. NO AUTHENTICATION. Returns only published
 * members ordered by display_order. Consumed by:
 *   (a) Historical: the Jekyll marketing build (axalnetwork.github.io) used
 *       to curl this into `_data/team.json` at build time. That site is gone;
 *       the Worker serves axal.vc since 2026-09-01.
 *   (b) Direct browser fetches from the SPA's /team and /about on axal.vc
 *       (same origin, so CORS below is belt-and-braces).
 *
 * CORS: explicitly emits `Access-Control-Allow-Origin: https://axal.vc`
 * regardless of request origin. The global cors() middleware in index.ts
 * also allows axal.vc but is origin-echoing; the spec asks for a fixed
 * apex value so server-side curls (no Origin header) and browser fetches
 * both get a deterministic response.
 *
 * Photo URLs: only the R2 key is stored. The Worker proxies bytes via
 * the sibling `/api/public/team/:slug/photo` route so the bucket itself
 * stays private (matches the FILES-bucket privacy posture in r2.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureTeamMembersSchema } from '../services/teamSchema';

const teamPublic = new Hono<{ Bindings: Env }>();

const APEX_CORS = 'https://axal.vc';

function withCors(res: Response): Response {
  // Hono's c.json() returns an immutable Response; clone with merged headers
  // so the global cors() middleware doesn't strip what we set here.
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', APEX_CORS);
  headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return new Response(res.body, { status: res.status, headers });
}

type TeamRow = {
  slug: string;
  name: string;
  title: string;
  location: string | null;
  short_bio: string | null;
  long_bio: string | null;
  photo_r2_key: string | null;
  focus_areas_json: string;
  social_linkedin: string | null;
  social_x: string | null;
  social_website: string | null;
  social_email: string | null;
  display_order: number;
};

function shapeMember(row: TeamRow, photoBase: string) {
  let focus_areas: string[] = [];
  try {
    const parsed = JSON.parse(row.focus_areas_json || '[]');
    if (Array.isArray(parsed)) focus_areas = parsed.map((s) => String(s)).slice(0, 12);
  } catch { /* ignore malformed JSON */ }
  return {
    slug: row.slug,
    name: row.name,
    title: row.title,
    location: row.location || null,
    short_bio: row.short_bio || null,
    long_bio: row.long_bio || null,
    photo_url: row.photo_r2_key ? `${photoBase}/${encodeURIComponent(row.slug)}/photo` : null,
    focus_areas,
    socials: {
      linkedin: row.social_linkedin || null,
      x: row.social_x || null,
      website: row.social_website || null,
      email: row.social_email || null,
    },
    display_order: row.display_order,
  };
}

teamPublic.get('/team', async (c) => {
  await ensureTeamMembersSchema(c.env);
  const rows: TeamRow[] = (
    await c.env.DB.prepare(
      `SELECT slug, name, title, location, short_bio, long_bio, photo_r2_key,
              focus_areas_json, social_linkedin, social_x, social_website,
              social_email, display_order
         FROM team_members
        WHERE published = 1
        ORDER BY display_order ASC, name ASC`,
    ).all<TeamRow>()
  ).results || [];

  const url = new URL(c.req.url);
  const photoBase = `${url.protocol}//${url.host}/api/public/team`;
  const members = rows.map((r) => shapeMember(r, photoBase));
  return withCors(c.json({ members, count: members.length }));
});

// Photo proxy — keeps the FILES R2 bucket private. Returns 404 for
// unpublished members, members with no photo, or unknown slugs.
teamPublic.get('/team/:slug/photo', async (c) => {
  await ensureTeamMembersSchema(c.env);
  const slug = String(c.req.param('slug') || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{1,80}$/.test(slug)) return c.notFound();
  const row = await c.env.DB.prepare(
    `SELECT photo_r2_key FROM team_members WHERE slug = ? AND published = 1`,
  ).bind(slug).first<{ photo_r2_key: string | null }>();
  if (!row || !row.photo_r2_key) return c.notFound();
  if (!c.env.FILES) return c.notFound();
  // Hard guard: only serve keys under the team/ prefix even if the DB row
  // ever gets corrupted/repointed by an attacker.
  if (!row.photo_r2_key.startsWith('team/')) return c.notFound();
  const obj = await c.env.FILES.get(row.photo_r2_key);
  if (!obj) return c.notFound();
  const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': APEX_CORS,
      'Vary': 'Origin',
    },
  });
});

export default teamPublic;
