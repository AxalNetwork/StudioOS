/**
 * Task #1 — Admin CRUD for mentor & partner network profiles.
 *
 * Mounted at /api/admin/network-profiles BEFORE the catch-all
 * /api/admin so the nested routes resolve here (same precedence trick
 * as /api/admin/telegram, /api/admin/team).
 *
 * Endpoints:
 *   GET    /                    — the roster: `?state=shown|hidden|archived`
 *                                 (default: shown and hidden), `?q=` (name,
 *                                 role, company), `?limit=` (1–500, default
 *                                 200). Each row carries its deck reach.
 *   POST   /                    — create (records `created_by`)
 *   PUT    /:id                 — partial update (name, kind, role, company,
 *                                 bio, linkedin_url, skills, display_order,
 *                                 is_active = show / hide, linked_user_id)
 *   POST   /:id/archive         — archive (D974): off the deck and out of the
 *                                 working list, the row and its photo kept
 *   POST   /:id/restore         — restore an archived row, as hidden
 *   DELETE /:id                 — archive, kept for the console that calls it
 *   GET    /:id/photo           — the photo, for an admin, in any state
 *   POST   /:id/photo           — upload square photo (data URI body)
 *   POST   /reorder             — { order: [id, ...] }
 *
 * D974 (#2760) — three states, not two. Hide (`is_active = 0`) keeps a row on
 * the roster and off the deck; Archive also sets `archived_at`. Every write
 * goes through `logAdminAction`, so it reaches HQ's governance feed; archive,
 * restore, hide and show are each their own act.
 *
 * R2 layout: FILES bucket under `network/<uuid>.{jpg,png,webp}`, ≤2MB.
 * Public photo proxy lives in routes/network_public.ts so the bucket
 * stays private.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { deckRosterReach } from '../services/decks/deckRoster';
import {
  ensureNetworkProfilesSchema,
  NETWORK_KIND_DEFAULT,
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

/** D974: every roster write reaches `admin_audit_log` (HQ's governance feed), not `activity_logs` alone. */
async function logAdmin(env: Env, adminId: number, email: string, action: string, details: Record<string, unknown>) {
  await logAdminAction(env, adminId, email, action, details);
}

export const ROSTER_STATES = ['shown', 'hidden', 'archived'] as const;
export type RosterState = typeof ROSTER_STATES[number];
export type DeckReachLabel = 'on_slide' | 'name_only' | 'counted' | 'not_on_deck';

export function stateOf(row: { is_active?: unknown; archived_at?: unknown }): RosterState {
  if (row.archived_at) return 'archived';
  return Number(row.is_active) === 1 ? 'shown' : 'hidden';
}

/**
 * What the Demo Day deck does with each row (D214's rule, `deckRoster.ts`),
 * over the rows the deck itself reads: `is_active = 1` in the deck's order
 * (`loadNetworkProfiles`, axalSpinoutDemoDay.ts). A row the deck does not
 * read is `not_on_deck`. Read over the whole roster, so a filter or a limit
 * never changes a row's reach.
 */
async function deckReachById(env: Env): Promise<Map<number, DeckReachLabel>> {
  const rows = (await env.DB.prepare(
    `SELECT id, name FROM network_profiles WHERE is_active = 1 ORDER BY display_order ASC, name ASC, id ASC`,
  ).all<{ id: number; name: string | null }>()).results || [];
  const reach = deckRosterReach(rows.map((r) => String(r.name || '')));
  const label: Record<string, DeckReachLabel> = { profile: 'on_slide', named: 'name_only', counted: 'counted' };
  return new Map(rows.map((r, i) => [Number(r.id), label[reach[i]]]));
}

/**
 * A row as HQ reads it. The R2 key stays in the Worker: the photo is read
 * through `GET /:id/photo` (any state, admins only) or, while the row is
 * shown, the public proxy.
 */
function shape(row: any, reach?: Map<number, DeckReachLabel>) {
  let skills: string[] = [];
  try { const arr = JSON.parse(row.skills_json || '[]'); if (Array.isArray(arr)) skills = arr.map(String); }
  catch { /* noop */ }
  const state = stateOf(row);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    role: row.role || null,
    company: row.company || null,
    bio: row.bio || null,
    linkedin_url: row.linkedin_url || null,
    has_photo: !!row.photo_r2_key,
    photo_url: row.photo_r2_key ? `/api/admin/network-profiles/${row.id}/photo` : null,
    public_photo_url: row.photo_r2_key && state === 'shown' ? `/api/public/network/${row.id}/photo` : null,
    skills,
    display_order: row.display_order,
    is_active: !!row.is_active,
    state,
    archived_at: row.archived_at || null,
    deck_reach: reach?.get(Number(row.id)) ?? 'not_on_deck',
    linked_user: row.linked_user_id != null ? {
      id: Number(row.linked_user_id), name: row.linked_user_name ?? null,
      // D1125 (AP8b): what the account itself says, read only. Null is not recorded on the account.
      // `has_photo` is null when the read did not carry the account's columns.
      account: {
        name: textOf(row.linked_display_name) ?? textOf(row.linked_user_name),
        headline: textOf(row.linked_headline),
        company: textOf(row.linked_firm),
        has_photo: row.linked_has_photo == null ? null : Number(row.linked_has_photo) === 1,
      },
    } : null,
    created_by: row.created_by != null ? { id: Number(row.created_by), name: row.created_by_name ?? null } : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const textOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A member account to link, or a sentence saying why not. */
async function linkedUserOf(env: Env, raw: unknown): Promise<number | null | string> {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return 'linked_user_id must be a member account';
  const u = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').bind(id).first<any>();
  return u ? id : 'linked_user_id must be a member account';
}


// ---------------- LIST ----------------

r.get('/', async (c) => {
  await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const rawState = c.req.query('state');
  if (rawState != null && rawState !== '' && !(ROSTER_STATES as readonly string[]).includes(rawState)) {
    return c.json({ error: 'invalid_state', allowed: ROSTER_STATES }, 400);
  }
  const states: RosterState[] = rawState ? [rawState as RosterState] : ['shown', 'hidden'];
  const rawLimit = c.req.query('limit');
  const limit = rawLimit == null || rawLimit === '' ? 200 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return c.json({ error: 'invalid_limit', min: 1, max: 500 }, 400);
  const q = String(c.req.query('q') || '').trim().slice(0, 100);
  // `q` is bound, with LIKE's own wildcards escaped, so "50%" finds "50%".
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const want = (st: RosterState) => (states.includes(st) ? 1 : 0);
  // One written-out query: the three states are disjoint and cover every row,
  // and each is switched on by a bound flag rather than spliced in.
  const rows = (await c.env.DB.prepare(
    `SELECT p.id, p.name, p.kind, p.role, p.company, p.bio, p.linkedin_url, p.photo_r2_key,
            p.skills_json, p.display_order, p.is_active, p.archived_at, p.linked_user_id, p.created_by,
            p.created_at, p.updated_at, lu.name AS linked_user_name, cb.name AS created_by_name,
            lu.display_name AS linked_display_name, lu.headline AS linked_headline, lf.name AS linked_firm,
            CASE WHEN lu.headshot_r2_key IS NOT NULL AND lu.headshot_r2_key <> '' THEN 1 ELSE 0 END AS linked_has_photo
       FROM network_profiles p
       LEFT JOIN users lu ON lu.id = p.linked_user_id
       LEFT JOIN partners lf ON lf.id = lu.partner_id
       LEFT JOIN users cb ON cb.id = p.created_by
      WHERE ((? = 1 AND p.archived_at IS NULL AND p.is_active = 1)
          OR (? = 1 AND p.archived_at IS NULL AND p.is_active = 0)
          OR (? = 1 AND p.archived_at IS NOT NULL))
        AND (? = '' OR p.name LIKE ? ESCAPE '\\' OR p.role LIKE ? ESCAPE '\\' OR p.company LIKE ? ESCAPE '\\')
      ORDER BY p.is_active DESC, p.display_order ASC, p.name ASC, p.id ASC
      LIMIT ?`,
  ).bind(want('shown'), want('hidden'), want('archived'), q, like, like, like, limit + 1).all()).results || [];
  const counts = (await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN archived_at IS NULL AND is_active = 1 THEN 1 ELSE 0 END) AS shown,
            SUM(CASE WHEN archived_at IS NULL AND is_active = 0 THEN 1 ELSE 0 END) AS hidden,
            SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
       FROM network_profiles`,
  ).first<any>()) || {};
  const reach = await deckReachById(c.env);
  const listed = rows.slice(0, limit);
  return c.json({
    profiles: listed.map((row) => shape(row, reach)),
    count: listed.length,
    truncated: rows.length > limit,
    counts: { shown: Number(counts.shown) || 0, hidden: Number(counts.hidden) || 0, archived: Number(counts.archived) || 0 },
    filter: { state: rawState || null, q: q || null, limit },
    catalog: { kinds: NETWORK_KINDS, skills: SKILL_CATALOG, states: ROSTER_STATES },
  });
});

// ---------------- CREATE ----------------

r.post('/', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));

  const name = String(body.name || '').trim().slice(0, 200);
  if (!name) return c.json({ error: 'name_required' }, 400);
  // D229 — this used to silently rewrite an unknown kind to 'mentor'
  // (`sanitizeKind(body.kind) || 'mentor'`), so a typo or a client sending a
  // retired value read back as if the operator had chosen 'mentor'. PUT
  // already refused the same case with 400 invalid_kind (below); POST now
  // matches it: an explicitly-given, unrecognized kind is refused, not
  // rewritten. Only a genuinely OMITTED kind gets a default, and that
  // default is 'advisor' — the canonical value the role was renamed to
  // (NETWORK_KIND_DEFAULT, networkProfilesSchema.ts) — not the retired
  // 'mentor'.
  let kind: NetworkKind;
  if (body.kind === undefined || body.kind === null || String(body.kind).trim() === '') {
    kind = NETWORK_KIND_DEFAULT;
  } else {
    const k = sanitizeKind(body.kind);
    if (!k) return c.json({ error: 'invalid_kind', allowed: NETWORK_KINDS }, 400);
    kind = k;
  }
  const role = String(body.role || '').trim().slice(0, 200) || null;
  const company = String(body.company || '').trim().slice(0, 200) || null;
  const bio = String(body.bio || '').trim().slice(0, 2000) || null;
  const linkedin = sanitizeOptUrl(body.linkedin_url);
  const skills = sanitizeSkills(body.skills);
  const linked = await linkedUserOf(c.env, body.linked_user_id);
  if (typeof linked === 'string') return c.json({ error: 'invalid_linked_user', message: linked }, 400);

  const next: any = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM network_profiles`,
  ).first();

  try {
    const row: any = await c.env.DB.prepare(
      `INSERT INTO network_profiles
         (name, kind, role, company, bio, linkedin_url, skills_json, display_order, is_active, linked_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).bind(
      name, kind, role, company, bio, linkedin,
      JSON.stringify(skills),
      Number(next?.next ?? 0),
      body.is_active === false ? 0 : 1,
      linked, Number(admin.id) || null,
    ).first();

    await logAdmin(c.env, admin.id, admin.email, 'network_profile_created', {
      id: row?.id, name, kind, ...(linked != null ? { target_user_id: linked } : {}),
    });
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
    `SELECT id, is_active, archived_at, linked_user_id FROM network_profiles WHERE id = ?`,
  ).bind(id).first();
  if (!existing) return c.json({ error: 'not_found' }, 404);
  // An archived row is shown or hidden only after it is restored, so a stray
  // `is_active` can never put an archived row back on the deck.
  if ('is_active' in body && existing.archived_at) {
    return c.json({ error: 'archived', message: 'Restore this profile before you show or hide it.' }, 409);
  }

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
  let linked: number | null | undefined;
  if ('linked_user_id' in body) {
    const l = await linkedUserOf(c.env, body.linked_user_id);
    if (typeof l === 'string') return c.json({ error: 'invalid_linked_user', message: l }, 400);
    linked = l;
    sets.push('linked_user_id = ?'); args.push(l);
  }

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

  const fields = Object.keys(body).filter((k) => k !== 'is_active');
  if (fields.length) {
    const target = linked ?? (existing.linked_user_id != null ? Number(existing.linked_user_id) : null);
    await logAdmin(c.env, admin.id, admin.email, 'network_profile_updated', {
      id, fields, ...(target != null ? { target_user_id: target } : {}),
    });
  }
  // Showing and hiding are their own acts, logged only when the state changes.
  if ('is_active' in body && (body.is_active ? 1 : 0) !== Number(existing.is_active)) {
    await logAdmin(c.env, admin.id, admin.email, body.is_active ? 'network_profile_shown' : 'network_profile_hidden', { id });
  }
  return c.json({ ok: true });
});

// ---------------- ARCHIVE (soft delete) ----------------
//
// Task #1 acceptance: profiles can be disabled / archived but history
// is preserved (so a Demo Day deck rendered last quarter still shows
// the same roster if regenerated against an old snapshot). DELETE
// flips `is_active=0` instead of dropping the row, and the R2 photo
// stays in place so re-activation is lossless.

// D974: archiving also sets `archived_at`, so a hidden row and an archived
// one are told apart; it keeps `is_active = 0`, so the deck and the public
// photo proxy, which read `is_active = 1`, drop it exactly as before.
async function archive(c: any) {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);

  const row: any = await c.env.DB.prepare(
    `SELECT name, archived_at FROM network_profiles WHERE id = ?`,
  ).bind(id).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.archived_at) return c.json({ error: 'already_archived' }, 409);

  await c.env.DB.prepare(
    `UPDATE network_profiles SET is_active = 0, archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();

  await logAdmin(c.env, admin.id, admin.email, 'network_profile_archived', { id });
  return c.json({ ok: true, archived: true, state: 'archived' });
}

r.post('/:id/archive', archive);
r.delete('/:id', archive);

// Restore puts an archived row back as hidden: it returns to the roster, and
// reaching the deck again is the separate act of showing it.
r.post('/:id/restore', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const row: any = await c.env.DB.prepare(`SELECT archived_at FROM network_profiles WHERE id = ?`).bind(id).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!row.archived_at) return c.json({ error: 'not_archived' }, 409);
  await c.env.DB.prepare(
    `UPDATE network_profiles SET archived_at = NULL, is_active = 0, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  await logAdmin(c.env, admin.id, admin.email, 'network_profile_restored', { id });
  return c.json({ ok: true, state: 'hidden' });
});

// ---------------- PHOTO READ (admins, any state) ----------------
//
// The public proxy (`network_public.ts`) serves shown rows only, so HQ could
// not see the photo of a hidden or archived row. This read serves every state
// to an admin, and is never cached by a shared cache.
r.get('/:id/photo', async (c) => {
  await requireAdmin(c);
  await ensureNetworkProfilesSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const row = await c.env.DB.prepare(`SELECT photo_r2_key FROM network_profiles WHERE id = ?`).bind(id).first<{ photo_r2_key: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!row.photo_r2_key || !row.photo_r2_key.startsWith('network/')) return c.json({ error: 'no_photo' }, 404);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const obj = await c.env.FILES.get(row.photo_r2_key);
  if (!obj) return c.json({ error: 'no_photo' }, 404);
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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
  return c.json({ ok: true, has_photo: true, photo_url: `/api/admin/network-profiles/${id}/photo`, size: bytes.byteLength });
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
