/**
 * Task #1 — Admin CRUD for mentor & partner network profiles.
 *
 * Mounted at /api/admin/network-profiles BEFORE the catch-all
 * /api/admin so the nested routes resolve here (same precedence trick
 * as /api/admin/telegram, /api/admin/team).
 *
 * Endpoints:
 *   GET    /                    — list all profiles (active + archived)
 *   POST   /                    — create
 *   PUT    /:id                 — partial update (name, kind, role,
 *                                 bio, linkedin_url, skills,
 *                                 display_order, is_active)
 *   DELETE /:id                 — hard delete (also removes R2 photo)
 *   POST   /:id/photo           — upload square photo (data URI body)
 *   POST   /reorder             — { order: [id, ...] }
 *
 * R2 layout: FILES bucket under `network/<uuid>.{jpg,png,webp}`, ≤2MB.
 * Public photo proxy lives in routes/network_public.ts so the bucket
 * stays private.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import {
  ensureNetworkProfilesSchema,
  NETWORK_KINDS,
  SKILL_CATALOG,
  type NetworkKind,
} from '../services/networkProfilesSchema';

const r = new Hono<{ Bindings: Env }>();

const URL_RE = /^https?:\/\/[^\s]{4,500}$/i;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const PHOTO_MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
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
      if (bytes.length < 12) return false;
      const tag = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (tag !== 'WEBP') return false;
    }
    return true;
  }
  return false;
}

function sanitizeKind(raw: unknown): NetworkKind | null {
  const s = String(raw || '').trim().toLowerCase();
  return (NETWORK_KINDS as readonly string[]).includes(s) ? (s as NetworkKind) : null;
}

function sanitizeSkills(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(SKILL_CATALOG as readonly string[]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const s = String(v || '').trim();
    if (!s) continue;
    // Case-insensitive match against catalog; canonical form wins.
    const canon = (SKILL_CATALOG as readonly string[]).find((a) => a.toLowerCase() === s.toLowerCase());
    if (!canon || !allowed.has(canon) || seen.has(canon)) continue;
    seen.add(canon);
    out.push(canon);
  }
  return out;
}

function sanitizeOptUrl(raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  return URL_RE.test(s) ? s : null;
}

async function logAdmin(env: Env, adminId: number, email: string, action: string, details: Record<string, unknown>) {
  try {
    const actorHash = await hashEmail(email);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), actorHash, adminId).run();
  } catch (e) {
    console.warn('[admin_network_profiles] activity log failed', e);
  }
}

function shape(row: any) {
  let skills: string[] = [];
  try { const arr = JSON.parse(row.skills_json || '[]'); if (Array.isArray(arr)) skills = arr.map(String); }
  catch { /* noop */ }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    role: row.role || null,
    company: row.company || null,
    bio: row.bio || null,
    linkedin_url: row.linkedin_url || null,
    photo_r2_key: row.photo_r2_key || null,
    has_photo: !!row.photo_r2_key,
    photo_url: row.photo_r2_key ? `/api/public/network/${row.id}/photo` : null,
    skills,
    display_order: row.display_order,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------- LIST ----------------

r.get('/', async (c) => {
  await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const rows = (await c.env.DB.prepare(
    `SELECT id, name, kind, role, company, bio, linkedin_url, photo_r2_key,
            skills_json, display_order, is_active, created_at, updated_at
       FROM network_profiles
       ORDER BY is_active DESC, display_order ASC, name ASC`,
  ).all()).results || [];
  return c.json({
    profiles: rows.map(shape),
    count: rows.length,
    catalog: { kinds: NETWORK_KINDS, skills: SKILL_CATALOG },
  });
});

// ---------------- CREATE ----------------

r.post('/', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));

  const name = String(body.name || '').trim().slice(0, 200);
  if (!name) return c.json({ error: 'name_required' }, 400);
  const kind = sanitizeKind(body.kind) || 'mentor';
  const role = String(body.role || '').trim().slice(0, 200) || null;
  const company = String(body.company || '').trim().slice(0, 200) || null;
  const bio = String(body.bio || '').trim().slice(0, 2000) || null;
  const linkedin = sanitizeOptUrl(body.linkedin_url);
  const skills = sanitizeSkills(body.skills);

  const next: any = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM network_profiles`,
  ).first();

  try {
    const row: any = await c.env.DB.prepare(
      `INSERT INTO network_profiles
         (name, kind, role, company, bio, linkedin_url, skills_json, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).bind(
      name, kind, role, company, bio, linkedin,
      JSON.stringify(skills),
      Number(next?.next ?? 0),
      body.is_active === false ? 0 : 1,
    ).first();

    await logAdmin(c.env, admin.id, admin.email, 'network_profile_created', { id: row?.id, name, kind });
    return c.json({ id: row?.id }, 201);
  } catch (err: any) {
    console.error('[admin_network_profiles] create failed', err);
    return c.json({ error: 'create_failed' }, 500);
  }
});

// ---------------- UPDATE ----------------

r.put('/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));

  const existing: any = await c.env.DB.prepare(
    `SELECT id FROM network_profiles WHERE id = ?`,
  ).bind(id).first();
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const sets: string[] = [];
  const args: unknown[] = [];

  if (typeof body.name === 'string') {
    const v = body.name.trim().slice(0, 200);
    if (!v) return c.json({ error: 'name_required' }, 400);
    sets.push('name = ?'); args.push(v);
  }
  if ('kind' in body) {
    const k = sanitizeKind(body.kind);
    if (!k) return c.json({ error: 'invalid_kind', allowed: NETWORK_KINDS }, 400);
    sets.push('kind = ?'); args.push(k);
  }
  if ('role' in body)         { sets.push('role = ?');         args.push(String(body.role || '').trim().slice(0, 200) || null); }
  if ('company' in body)      { sets.push('company = ?');      args.push(String(body.company || '').trim().slice(0, 200) || null); }
  if ('bio' in body)          { sets.push('bio = ?');          args.push(String(body.bio || '').trim().slice(0, 2000) || null); }
  if ('linkedin_url' in body) { sets.push('linkedin_url = ?'); args.push(sanitizeOptUrl(body.linkedin_url)); }
  if ('skills' in body)       { sets.push('skills_json = ?');  args.push(JSON.stringify(sanitizeSkills(body.skills))); }
  if ('display_order' in body){ sets.push('display_order = ?'); args.push(Number(body.display_order) || 0); }
  if ('is_active' in body)    { sets.push('is_active = ?');    args.push(body.is_active ? 1 : 0); }

  if (sets.length === 0) return c.json({ error: 'no_fields' }, 400);
  sets.push("updated_at = datetime('now')");

  try {
    await c.env.DB.prepare(
      `UPDATE network_profiles SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...args, id).run();
  } catch (err: any) {
    console.error('[admin_network_profiles] update failed', err);
    return c.json({ error: 'update_failed' }, 500);
  }

  await logAdmin(c.env, admin.id, admin.email, 'network_profile_updated', { id, fields: Object.keys(body) });
  return c.json({ ok: true });
});

// ---------------- ARCHIVE (soft delete) ----------------
//
// Task #1 acceptance: profiles can be disabled / archived but history
// is preserved (so a Demo Day deck rendered last quarter still shows
// the same roster if regenerated against an old snapshot). DELETE
// flips `is_active=0` instead of dropping the row, and the R2 photo
// stays in place so re-activation is lossless.

r.delete('/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);

  const row: any = await c.env.DB.prepare(
    `SELECT name, is_active FROM network_profiles WHERE id = ?`,
  ).bind(id).first();
  if (!row) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare(
    `UPDATE network_profiles SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();

  await logAdmin(c.env, admin.id, admin.email, 'network_profile_archived', { id, name: row.name });
  return c.json({ ok: true, archived: true });
});

// ---------------- PHOTO UPLOAD ----------------

r.post('/:id/photo', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);

  const profile: any = await c.env.DB.prepare(
    `SELECT id, photo_r2_key FROM network_profiles WHERE id = ?`,
  ).bind(id).first();
  if (!profile) return c.json({ error: 'not_found' }, 404);

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
  const key = `network/${uuid}.${ext}`;
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: declaredMime },
    customMetadata: { network_profile_id: String(id), uploaded_by: String(admin.id) },
  });

  const oldKey = profile.photo_r2_key;
  await c.env.DB.prepare(
    `UPDATE network_profiles SET photo_r2_key = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(key, id).run();
  if (oldKey && oldKey.startsWith('network/') && oldKey !== key) {
    try { await c.env.FILES.delete(oldKey); }
    catch (e) { console.warn('[admin_network_profiles] old photo cleanup failed', e); }
  }

  await logAdmin(c.env, admin.id, admin.email, 'network_profile_photo_uploaded', { id, size: bytes.byteLength });
  return c.json({ ok: true, photo_r2_key: key, photo_url: `/api/public/network/${id}/photo`, size: bytes.byteLength });
});

// ---------------- REORDER ----------------

r.post('/reorder', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const order = Array.isArray(body.order) ? body.order.map((n: unknown) => Number(n)).filter(Number.isFinite) : [];
  if (order.length === 0) return c.json({ error: 'order_required' }, 400);

  const stmts = order.map((id: number, idx: number) =>
    c.env.DB.prepare(
      `UPDATE network_profiles SET display_order = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(idx, id),
  );
  await c.env.DB.batch(stmts);

  await logAdmin(c.env, admin.id, admin.email, 'network_profiles_reordered', { count: order.length });
  return c.json({ ok: true, count: order.length });
});

export default r;
