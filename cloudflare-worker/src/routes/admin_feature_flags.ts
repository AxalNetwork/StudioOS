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
 * records who wrote it (`updated_by`), never a name or an email.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { CATALOGUE } from '../services/ai/catalogue';
import { ELEMENTS } from '../services/decks/elementModels';
import { CACHE_TTL_S, GRID_GENERATE, SCOPES, elementKey, forgetFlags, keyShape, modelKey, type Scope } from '../services/featureFlags';

const adminFeatureFlags = new Hono<{ Bindings: Env }>();

/** Every key a row may be written under. */
export function knownKeys(): string[] {
  return [GRID_GENERATE, ...ELEMENTS.map((e) => elementKey(e.id)), ...CATALOGUE.map((m) => modelKey(m.id))];
}

const KNOWN = new Set(knownKeys());

adminFeatureFlags.get('/', async (c) => {
  await requireAdmin(c);
  let flags: unknown[] = [];
  try {
    flags = (await c.env.DB.prepare(
      'SELECT key, scope, scope_id, enabled, updated_by, updated_at FROM feature_flags ORDER BY key, scope, scope_id',
    ).all()).results ?? [];
  } catch {
    return refuse(c, 503, { code: 'flags_unreadable', message: 'The feature flags could not be read. Every flag is at its default (on) until they can.' });
  }
  return c.json({ flags, keys: knownKeys(), cache_s: CACHE_TTL_S });
});

adminFeatureFlags.put('/', async (c) => {
  const user = await requireAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));
  const key = body?.key;
  if (!keyShape(key) || !KNOWN.has(key)) {
    return refuse(c, 400, { code: 'invalid_key', message: 'The key is grid_generate, element:<a grid element> or model:<a catalogue model>.' });
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
  console.log('[feature_flags] written', { key_kind: keyShape(key), scope, enabled });
  return c.json({ ok: true, key, scope, scope_id: scopeId, enabled });
});

export default adminFeatureFlags;
