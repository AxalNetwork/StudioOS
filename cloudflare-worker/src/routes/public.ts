/**
 * Task #1 (AG) — Public profile facade.
 *
 * Mounted at /api/public. NO AUTHENTICATION — only exposes fields that
 * are explicitly safe to share publicly (display name, headline, role,
 * uid). Sensitive PII columns (email, phone, ciphertext) are never
 * returned. The handle is the user's `uid` (already public).
 *
 *   GET /u/:handle           — public user card
 *   GET /p/:partner_slug     — public partner card (uid)
 */
import { Hono } from 'hono';
import type { Env } from '../types';

const publicRoutes = new Hono<{ Bindings: Env }>();

type PublicUserRow = {
  uid: string;
  name: string | null;
  role: string;
  display_name: string | null;
  headline: string | null;
};

publicRoutes.get('/u/:handle', async (c) => {
  const handle = String(c.req.param('handle') || '').trim().toLowerCase();
  if (!handle) return c.json({ detail: 'handle required' }, 400);
  let row: PublicUserRow | null = null;
  try {
    row = await c.env.DB.prepare(
      `SELECT uid, name, role, display_name, headline
         FROM users
        WHERE lower(uid) = ? AND is_active = 1`,
    ).bind(handle).first<PublicUserRow>();
  } catch {
    // display_name / headline columns may be missing on dev DBs.
    const fallback = await c.env.DB.prepare(
      `SELECT uid, name, role FROM users WHERE lower(uid) = ? AND is_active = 1`,
    ).bind(handle).first<{ uid: string; name: string | null; role: string }>();
    row = fallback ? { ...fallback, display_name: null, headline: null } : null;
  }
  if (!row) return c.json({ detail: 'Not found' }, 404);
  return c.json({
    uid: row.uid,
    handle: row.uid,
    display_name: row.display_name || row.name || null,
    headline: row.headline || null,
    role: row.role,
  });
});

publicRoutes.get('/p/:partner_slug', async (c) => {
  const slug = String(c.req.param('partner_slug') || '').trim().toLowerCase();
  if (!slug) return c.json({ detail: 'slug required' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT uid, name, company, specialization, status
       FROM partners WHERE lower(uid) = ? OR lower(referral_code) = ?`,
  ).bind(slug, slug).first<{
    uid: string; name: string; company: string | null;
    specialization: string | null; status: string;
  }>();
  if (!row || row.status !== 'active') return c.json({ detail: 'Not found' }, 404);
  return c.json({
    uid: row.uid,
    handle: row.uid,
    name: row.name,
    company: row.company,
    specialization: row.specialization,
  });
});

export default publicRoutes;
