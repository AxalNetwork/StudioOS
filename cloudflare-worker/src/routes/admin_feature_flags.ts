/**
 * D1509 (#3760, deck v2 A16) — HQ's switches for The Grid.
 *
 *   GET /api/admin/feature-flags
 *       → { flags: [{ key, scope, scope_id, enabled, updated_by, updated_at }], keys, cache_s }
 *   PUT /api/admin/feature-flags   { key, scope: 'global'|'role'|'user', scope_id?, enabled: true|false|null }
 *       → { ok, key, scope, scope_id, enabled }      null deletes the row (back to the default, on)
 *
 * `keys` lists what a row may name: `grid_generate`, `element:<id>` for each
 * grid element (`elementModels.ELEMENTS`) and `model:<id>` for each model the
 * catalogue knows (`catalogue.ts`, D760: no second model list). Any other key
 * is refused 400 `invalid_key` before anything is written.
 *
 * Who: an admin (`requireAdmin`, so a frozen admin cannot write). The write
 * deletes the 60 s KV copy, so it applies at once in this isolate and within
 * a minute everywhere (services/featureFlags.ts). Bound SQL only; the row
 * records who wrote it (`updated_by`, an id), and the reply names them.
 *
 * #4189 (K2 of #4155, D4155):
 *   - `PUT` takes a `reason` of at least 10 characters (400 `reason_required`)
 *     and writes one admin audit row (`feature_flag_set`) with the reason and
 *     the row before and after, through `logAdminAction`.
 *   - `GET` answers `updated_by: { uid, name } | null` (never an email or a bare
 *     id), `affected` (how many active members the row's scope reaches, or null
 *     when it cannot be counted), and `labels` for the deck keys
 *     (`DECK_FEATURES`: only keys whose feature reads them).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { CATALOGUE } from '../services/ai/catalogue';
import { ELEMENTS } from '../services/decks/elementModels';
import { CACHE_TTL_S, DECK_FEATURES, GRID_GENERATE, SCOPES, elementKey, forgetFlags, keyShape, modelKey, type Scope } from '../services/featureFlags';
import { logAdminAction } from '../services/adminAudit';

const adminFeatureFlags = new Hono<{ Bindings: Env }>();

/** Every key a row may be written under. */
export function knownKeys(): string[] {
  return [GRID_GENERATE, ...ELEMENTS.map((e) => elementKey(e.id)), ...DECK_FEATURES.map((d) => d.key), ...CATALOGUE.map((m) => modelKey(m.id))];
}

const KNOWN = new Set(knownKeys());

export const REASON_MIN = 10;

/** How many active members a row's scope reaches: everyone, a role, or one member. Null when it cannot be counted. */
async function affectedBy(env: Env, scope: string, scopeId: string): Promise<number | null> {
  try {
    const r = scope === 'global'
      ? await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_active = 1').first<{ n: number }>()
      : scope === 'role'
        ? await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND lower(role) = ?').bind(scopeId).first<{ n: number }>()
        : await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND id = ?').bind(Number(scopeId)).first<{ n: number }>();
    return r && Number.isFinite(Number(r.n)) ? Number(r.n) : null;
  } catch { return null; }
}

type Row = { key: string; scope: string; scope_id: string; enabled: number; updated_by: number | null; updated_at: string };

adminFeatureFlags.get('/', async (c) => {
  await requireAdmin(c);
  let rows: Row[] = [];
  try {
    rows = (await c.env.DB.prepare(
      'SELECT key, scope, scope_id, enabled, updated_by, updated_at FROM feature_flags ORDER BY key, scope, scope_id',
    ).all<Row>()).results ?? [];
  } catch {
    return refuse(c, 503, { code: 'flags_unreadable', message: 'The feature flags could not be read. Every flag is at its default (on) until they can.' });
  }
  const ids = [...new Set(rows.map((r) => Number(r.updated_by)).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const names = new Map<number, { uid: string; name: string }>();
  if (ids.length) {
    try {
      const people = (await c.env.DB.prepare('SELECT id, uid, name FROM users WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids))
        .all<{ id: number; uid: string; name: string | null }>()).results ?? [];
      for (const u of people) names.set(Number(u.id), { uid: u.uid, name: u.name || 'A former admin' });
    } catch { /* names unread: updated_by reads null, never an id */ }
  }
  const flags = [];
  for (const r of rows) {
    flags.push({
      key: r.key, scope: r.scope, scope_id: r.scope_id, enabled: Boolean(Number(r.enabled)), updated_at: r.updated_at,
      updated_by: r.updated_by ? names.get(Number(r.updated_by)) ?? null : null,
      affected: await affectedBy(c.env, r.scope, r.scope_id),
    });
  }
  const labels = Object.fromEntries(DECK_FEATURES.map((d) => [d.key, { label: d.label, description: d.description }]));
  return c.json({ flags, keys: knownKeys(), labels, cache_s: CACHE_TTL_S });
});

adminFeatureFlags.put('/', async (c) => {
  const user = await requireAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));
  const key = body?.key;
  if (!keyShape(key) || !KNOWN.has(key)) {
    return refuse(c, 400, { code: 'invalid_key', message: 'The key is grid_generate, element:<a grid element>, a deck feature or model:<a catalogue model>.' });
  }
  const scope = body?.scope as Scope;
  if (!(SCOPES as readonly string[]).includes(scope)) {
    return refuse(c, 400, { code: 'invalid_scope', message: 'The scope is global, role or user.' });
  }
  const raw = body?.scope_id;
  const scopeId = scope === 'global' ? '' : scope === 'role'
    ? (typeof raw === 'string' && /^[a-z_]{1,40}$/.test(raw) ? raw : null)
    : (Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? String(Number(raw)) : null);
  if (scopeId === null) {
    return refuse(c, 400, { code: 'invalid_scope_id', message: scope === 'role' ? 'A role is a lowercase name, such as admin.' : 'A user is their numeric id.' });
  }
  const enabled = body?.enabled;
  if (enabled !== null && typeof enabled !== 'boolean') {
    return refuse(c, 400, { code: 'invalid_enabled', message: 'enabled is true, false, or null to go back to the default.' });
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > 500) {
    return refuse(c, 400, { code: 'reason_required', message: `Say why, in at least ${REASON_MIN} characters. It is kept in the admin audit.` });
  }
  const was = await c.env.DB.prepare('SELECT enabled FROM feature_flags WHERE key = ?1 AND scope = ?2 AND scope_id = ?3').bind(key, scope, scopeId)
    .first<{ enabled: number }>().catch(() => null);
  const before = was ? Boolean(Number(was.enabled)) : null;
  if (enabled === null) {
    await c.env.DB.prepare('DELETE FROM feature_flags WHERE key = ?1 AND scope = ?2 AND scope_id = ?3').bind(key, scope, scopeId).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO feature_flags (key, scope, scope_id, enabled, updated_by, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT (key, scope, scope_id) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(key, scope, scopeId, enabled ? 1 : 0, Number(user.id) || null).run();
  }
  await forgetFlags(c.env);
  // One audit row per write: the admin (by id; HQ's governance feed names them), the reason, before and after.
  await logAdminAction(c.env, Number(user.id), String((user as any).email ?? ''), 'feature_flag_set', {
    key, scope, scope_id: scopeId, before, after: enabled, reason,
    ...(scope === 'user' ? { target_user_id: Number(scopeId) } : {}),
  });
  console.log('[feature_flags] written', { key_kind: keyShape(key), scope, enabled });
  return c.json({ ok: true, key, scope, scope_id: scopeId, enabled });
});

export default adminFeatureFlags;
