/**
 * Task #10 (LD) — Admin endpoints for the public team roster.
 *
 * Mounted at /api/admin/team. All endpoints require admin auth + (in prod)
 * pass the /api/admin/* Cloudflare Access perimeter applied in index.ts.
 *
 * Endpoints:
 *   GET    /                   — list all members (published + drafts)
 *   POST   /                   — create
 *   PUT    /:id                — update fields (partial)
 *   DELETE /:id                — hard delete (also removes R2 photo)
 *   POST   /:id/photo          — upload square photo (data URI body)
 *   POST   /reorder            — drag-to-reorder; body { order: [id, id, ...] }
 *
 * Photo storage: FILES R2 bucket under `team/{slug}/{uuid}.{ext}`.
 * Mirrors the headshot pattern in services/r2.ts (3MB cap, jpg/png/webp).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { ensureTeamMembersSchema } from '../services/teamSchema';

const adminTeam = new Hono<{ Bindings: Env }>();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const URL_RE = /^https?:\/\/[^\s]{4,500}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
// Magic-byte signatures (matches the same defence pattern referenced
// throughout the worker's file-upload routes).
const PHOTO_MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF (full WEBP detection also needs 'WEBP' at offset 8)
];

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function matchesMagic(bytes: Uint8Array, declaredMime: string): boolean {
  for (const sig of PHOTO_MAGIC) {
    if (sig.mime !== declaredMime) continue;
    if (bytes.length < sig.bytes.length) return false;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (bytes[i] !== sig.bytes[i]) return false;
    }
    if (declaredMime === 'image/webp') {
      // Verify 'WEBP' at offset 8 for full WebP detection.
      if (bytes.length < 12) return false;
      const tag = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (tag !== 'WEBP') return false;
    }
    return true;
  }
  return false;
}

function sanitizeSlug(raw: unknown): string | null {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-');
  return SLUG_RE.test(s) ? s : null;
}

function sanitizeOptUrl(raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  return URL_RE.test(s) ? s : null;
}

function sanitizeOptEmail(raw: unknown): string | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  return EMAIL_RE.test(s) ? s : null;
}

function sanitizeFocusAreas(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v || '').trim())
    .filter((v) => v.length > 0 && v.length <= 60)
    .slice(0, 12);
}

async function logAdmin(env: Env, adminId: number, email: string, action: string, details: Record<string, unknown>) {
  try {
    const actorHash = await hashEmail(email);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), actorHash, adminId).run();
  } catch (e) {
    console.warn('[admin_team] activity log failed', e);
  }
}

// ---------------- LIST ----------------

adminTeam.get('/', async (c) => {
  await requireAdmin(c);
  await ensureTeamMembersSchema(c.env);
  const rows = (
    await c.env.DB.prepare(
      `SELECT id, slug, name, title, location, short_bio, long_bio, photo_r2_key,
              focus_areas_json, social_linkedin, social_x, social_website, social_email,
              display_order, published, created_at, updated_at
         FROM team_members
        ORDER BY display_order ASC, name ASC`,
    ).all()
  ).results || [];

  const members = rows.map((r: any) => ({
    ...r,
    focus_areas: (() => {
      try { return JSON.parse(r.focus_areas_json || '[]'); }
      catch { return []; }
    })(),
    has_photo: !!r.photo_r2_key,
    published: !!r.published,
  }));
  return c.json({ members, count: members.length });
});

// ---------------- CREATE ----------------

adminTeam.post('/', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTeamMembersSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));

  const slug = sanitizeSlug(body.slug);
  const name = String(body.name || '').trim().slice(0, 200);
  const title = String(body.title || '').trim().slice(0, 200);
  if (!slug) return c.json({ error: 'invalid_slug', message: 'Slug must be lowercase letters, numbers, and hyphens.' }, 400);
  if (!name) return c.json({ error: 'name_required' }, 400);
  if (!title) return c.json({ error: 'title_required' }, 400);

  const focusAreas = sanitizeFocusAreas(body.focus_areas);
  const nextOrder: any = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM team_members`,
  ).first();

  try {
    const row: any = await c.env.DB.prepare(
      `INSERT INTO team_members
         (slug, name, title, location, short_bio, long_bio, focus_areas_json,
          social_linkedin, social_x, social_website, social_email,
          display_order, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).bind(
      slug,
      name,
      title,
      String(body.location || '').trim().slice(0, 200) || null,
      String(body.short_bio || '').trim().slice(0, 500) || null,
      String(body.long_bio || '').trim().slice(0, 5000) || null,
      JSON.stringify(focusAreas),
      sanitizeOptUrl(body.social_linkedin),
      sanitizeOptUrl(body.social_x),
      sanitizeOptUrl(body.social_website),
      sanitizeOptEmail(body.social_email),
      Number(nextOrder?.next ?? 0),
      body.published === false ? 0 : 1,
    ).first();

    await logAdmin(c.env, admin.id, admin.email, 'team_member_created', { id: row?.id, slug });
    return c.json({ id: row?.id, slug }, 201);
  } catch (err: any) {
    if (String(err?.message || '').toLowerCase().includes('unique')) {
      return c.json({ error: 'slug_taken', message: `Slug "${slug}" already exists.` }, 409);
    }
    console.error('[admin_team] create failed', err);
    return c.json({ error: 'create_failed' }, 500);
  }
});

// ---------------- UPDATE ----------------

adminTeam.put('/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTeamMembersSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));

  const existing: any = await c.env.DB.prepare(
    `SELECT id, slug FROM team_members WHERE id = ?`,
  ).bind(id).first();
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // Build SET clause dynamically — partial update.
  const sets: string[] = [];
  const args: unknown[] = [];

  if (typeof body.slug === 'string') {
    const slug = sanitizeSlug(body.slug);
    if (!slug) return c.json({ error: 'invalid_slug' }, 400);
    sets.push('slug = ?'); args.push(slug);
  }
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 200);
    if (!name) return c.json({ error: 'name_required' }, 400);
    sets.push('name = ?'); args.push(name);
  }
  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, 200);
    if (!title) return c.json({ error: 'title_required' }, 400);
    sets.push('title = ?'); args.push(title);
  }
  if ('location' in body)        { sets.push('location = ?');        args.push(String(body.location || '').trim().slice(0, 200) || null); }
  if ('short_bio' in body)       { sets.push('short_bio = ?');       args.push(String(body.short_bio || '').trim().slice(0, 500) || null); }
  if ('long_bio' in body)        { sets.push('long_bio = ?');        args.push(String(body.long_bio || '').trim().slice(0, 5000) || null); }
  if ('focus_areas' in body)     { sets.push('focus_areas_json = ?'); args.push(JSON.stringify(sanitizeFocusAreas(body.focus_areas))); }
  if ('social_linkedin' in body) { sets.push('social_linkedin = ?');  args.push(sanitizeOptUrl(body.social_linkedin)); }
  if ('social_x' in body)        { sets.push('social_x = ?');         args.push(sanitizeOptUrl(body.social_x)); }
  if ('social_website' in body)  { sets.push('social_website = ?');   args.push(sanitizeOptUrl(body.social_website)); }
  if ('social_email' in body)    { sets.push('social_email = ?');     args.push(sanitizeOptEmail(body.social_email)); }
  if ('published' in body)       { sets.push('published = ?');        args.push(body.published ? 1 : 0); }
  if ('display_order' in body)   { sets.push('display_order = ?');    args.push(Number(body.display_order) || 0); }

  if (sets.length === 0) return c.json({ error: 'no_fields' }, 400);
  sets.push("updated_at = datetime('now')");

  try {
    await c.env.DB.prepare(
      `UPDATE team_members SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...args, id).run();
  } catch (err: any) {
    if (String(err?.message || '').toLowerCase().includes('unique')) {
      return c.json({ error: 'slug_taken' }, 409);
    }
    console.error('[admin_team] update failed', err);
    return c.json({ error: 'update_failed' }, 500);
  }

  await logAdmin(c.env, admin.id, admin.email, 'team_member_updated', { id, fields: Object.keys(body) });
  return c.json({ ok: true });
});

// ---------------- DELETE ----------------

adminTeam.delete('/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTeamMembersSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);

  const row: any = await c.env.DB.prepare(
    `SELECT photo_r2_key, slug FROM team_members WHERE id = ?`,
  ).bind(id).first();
  if (!row) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare(`DELETE FROM team_members WHERE id = ?`).bind(id).run();

  if (row.photo_r2_key && c.env.FILES && row.photo_r2_key.startsWith('team/')) {
    try { await c.env.FILES.delete(row.photo_r2_key); }
    catch (e) { console.warn('[admin_team] r2 delete failed', e); }
  }

  await logAdmin(c.env, admin.id, admin.email, 'team_member_deleted', { id, slug: row.slug });
  return c.json({ ok: true });
});

// ---------------- PHOTO UPLOAD ----------------

adminTeam.post('/:id/photo', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTeamMembersSchema(c.env);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);

  const member: any = await c.env.DB.prepare(
    `SELECT slug, photo_r2_key FROM team_members WHERE id = ?`,
  ).bind(id).first();
  if (!member) return c.json({ error: 'not_found' }, 404);

  const body: any = await c.req.json().catch(() => ({}));
  const dataUri = String(body.data_uri || '');
  if (!dataUri.startsWith('data:')) return c.json({ error: 'invalid_data_uri' }, 400);
  const commaIdx = dataUri.indexOf(',');
  if (commaIdx < 0) return c.json({ error: 'invalid_data_uri' }, 400);
  const meta = dataUri.slice(5, commaIdx);
  const declaredMime = meta.replace(';base64', '').trim();
  const ext = PHOTO_MIME[declaredMime];
  if (!ext) return c.json({ error: 'unsupported_mime', allowed: Object.keys(PHOTO_MIME) }, 400);

  let bytes: Uint8Array;
  try { bytes = bytesFromBase64(dataUri.slice(commaIdx + 1)); }
  catch { return c.json({ error: 'invalid_base64' }, 400); }
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return c.json({ error: 'too_large', max_bytes: MAX_PHOTO_BYTES }, 413);
  }
  if (!matchesMagic(bytes, declaredMime)) {
    return c.json({ error: 'magic_mismatch', message: 'File bytes do not match declared mime type.' }, 400);
  }

  const uuid = crypto.randomUUID();
  const key = `team/${member.slug}/${uuid}.${ext}`;
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: declaredMime },
    customMetadata: { team_member_id: String(id), uploaded_by: String(admin.id) },
  });

  // Delete the previous photo (best-effort) BEFORE we update the row, so a
  // crash mid-flight leaves the old (still-referenced) object intact.
  const oldKey = member.photo_r2_key;
  await c.env.DB.prepare(
    `UPDATE team_members SET photo_r2_key = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(key, id).run();
  if (oldKey && oldKey.startsWith('team/') && oldKey !== key) {
    try { await c.env.FILES.delete(oldKey); }
    catch (e) { console.warn('[admin_team] old photo cleanup failed', e); }
  }

  await logAdmin(c.env, admin.id, admin.email, 'team_member_photo_uploaded', { id, size: bytes.byteLength });
  return c.json({ ok: true, photo_r2_key: key, size: bytes.byteLength });
});

// ---------------- REORDER ----------------

adminTeam.post('/reorder', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTeamMembersSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const order = Array.isArray(body.order) ? body.order.map((n: unknown) => Number(n)).filter(Number.isFinite) : [];
  if (order.length === 0) return c.json({ error: 'order_required' }, 400);

  // Single transaction via batch() — atomic relative to other writers.
  const stmts = order.map((id: number, idx: number) =>
    c.env.DB.prepare(
      `UPDATE team_members SET display_order = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(idx, id),
  );
  await c.env.DB.batch(stmts);

  await logAdmin(c.env, admin.id, admin.email, 'team_members_reordered', { count: order.length });
  return c.json({ ok: true, count: order.length });
});

export default adminTeam;
