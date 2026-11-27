/** D592: the owner-controlled global profile blend. No user preference or seed. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import { PROFILE_EVIDENCE_BLEND_WEIGHT } from '../services/archetypeScoring';
import { evidenceBlendEnabled, profileEngineVersion, PROFILE_EVIDENCE_BLEND_KEY } from '../services/profileEvidenceBlend';

const r = new Hono<{ Bindings: Env }>();
const reading = (enabled: boolean) => ({ enabled, weight: PROFILE_EVIDENCE_BLEND_WEIGHT, engine_version: profileEngineVersion(enabled) });

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  try {
    return c.json(reading(await evidenceBlendEnabled(c.env)));
  } catch (error) {
    return refuse(c, 503, { code: 'profile_blend_unreadable', message: 'The evidence blend setting could not be read.', raw: error });
  }
});

r.put('/', async (c) => {
  const actor = await requireSuperAdmin(c);
  const body = await c.req.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return refuse(c, 400, { code: 'invalid_blend_enabled', message: '`enabled` is true or false.' });
  }
  try {
    const before = await evidenceBlendEnabled(c.env);
    await c.env.DB.prepare(
      `INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(PROFILE_EVIDENCE_BLEND_KEY, body.enabled ? '1' : '0', new Date().toISOString(), String(actor.id)).run();
    await logAdminAction(c.env, actor.id, actor.email, 'profile_evidence_blend_changed', {
      setting_key: PROFILE_EVIDENCE_BLEND_KEY, before, enabled: body.enabled, engine_version: profileEngineVersion(body.enabled),
    });
    return c.json(reading(body.enabled));
  } catch (error) {
    return refuse(c, 503, { code: 'profile_blend_not_saved', message: 'The evidence blend setting was not saved.', raw: error });
  }
});

export default r;
