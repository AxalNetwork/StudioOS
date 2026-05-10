/**
 * Task #3 (2026-05-10) — Crunchbase project-enrichment routes.
 *
 * Read-only surface that wraps the user's per-account Crunchbase Basic
 * API key (stored on their `integrations` row) and exposes:
 *   GET  /api/crunchbase/search?q=…              — debounced lookup picker
 *   POST /api/crunchbase/projects/:id/apply      — persist snapshot to project
 *   GET  /api/crunchbase/projects/:id/competitors — sector-heuristic peers
 *
 * Tier-gated to growth (founders); admin/partner/investor/mentor bypass.
 * Mutating routes additionally require admin OR the owning founder.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureTier } from '../middleware/requireTier';
import { hashEmail } from '../util/hashEmail';
import {
  CrunchbaseRateLimited,
  CrunchbaseUnauthorized,
  searchOrganizations,
  lookupOrganization,
  findCompetitors,
  loadCrunchbaseKeyForUser,
  markCrunchbaseRateLimited,
  type CrunchbaseSnapshot,
} from '../integrations/providers/crunchbase';

const crunchbase = new Hono<{ Bindings: Env }>();

function gateTier(user: User): void {
  // ensureTier short-circuits non-founder roles (admin/partner/investor/mentor).
  ensureTier(user, 'growth');
}

async function withConn<T>(c: Context<{ Bindings: Env }>, user: User, fn: (apiKey: string, row: { id: number; uid: string }) => Promise<T>): Promise<Response> {
  const conn = await loadCrunchbaseKeyForUser(c.env, user.id);
  if (!conn) {
    return c.json({
      error: 'crunchbase_not_connected',
      message: 'Connect Crunchbase from Settings → Integrations to enable enrichment.',
      connect_path: '/settings/integrations',
    }, 412);
  }
  try {
    const out = await fn(conn.apiKey, { id: conn.row.id, uid: conn.row.uid });
    return c.json(out);
  } catch (e) {
    if (e instanceof CrunchbaseRateLimited) {
      await markCrunchbaseRateLimited(c.env, conn.row, e.resetHint);
      return c.json({
        error: 'crunchbase_rate_limited',
        message: 'Crunchbase Basic daily limit reached for this API key. Try again tomorrow.',
        reset_hint: e.resetHint || null,
      }, 429);
    }
    if (e instanceof CrunchbaseUnauthorized) {
      await c.env.DB.prepare('UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind('unauthorized', conn.row.id).run();
      // Returned as 412 (not 401) so the SPA's global session-expiry
      // handler doesn't force-logout the user on a domain credential
      // failure — the UI distinguishes via the error code and prompts
      // the user to reconnect from Settings → Integrations.
      return c.json({
        error: 'crunchbase_unauthorized',
        message: 'Crunchbase rejected the stored API key — reconnect from Settings → Integrations.',
        connect_path: '/settings/integrations',
      }, 412);
    }
    const msg = (e as Error).message || 'crunchbase_failed';
    return c.json({ error: 'crunchbase_failed', message: msg }, 502);
  }
}

async function loadProjectForWrite(c: Context<{ Bindings: Env }>, user: User, projectId: string): Promise<{ id: number; founder_id: number | null } | null> {
  const row = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? OR uid = ? LIMIT 1')
    .bind(Number(projectId) || 0, projectId).first<{ id: number; founder_id: number | null }>();
  if (!row) return null;
  const role = (user.role || '').toLowerCase();
  if (role === 'admin') return row;
  // Founder owner check
  const founderId = (user as User & { founder_id?: number | null }).founder_id || null;
  if (founderId && row.founder_id === founderId) return row;
  return null;
}

// ───────────────────────────────────────────────── routes

crunchbase.get('/search', async (c) => {
  const user = await requireAuth(c);
  gateTier(user);
  const q = (c.req.query('q') || '').trim();
  if (!q || q.length < 2) return c.json({ results: [] });
  const limit = Math.max(1, Math.min(25, Number(c.req.query('limit') || 10)));
  return await withConn(c, user, async (apiKey) => ({ results: await searchOrganizations(apiKey, q, limit) }));
});

crunchbase.post('/projects/:id/apply', async (c) => {
  const user = await requireAuth(c);
  gateTier(user);
  const projectId = c.req.param('id') || '';
  const project = await loadProjectForWrite(c, user, projectId);
  if (!project) return c.json({ error: 'not_found_or_forbidden' }, 404);

  const body = await c.req.json().catch(() => ({})) as { uuid?: string; permalink?: string; snapshot?: CrunchbaseSnapshot };
  const lookupKey = String(body.uuid || body.permalink || '').trim();
  if (!lookupKey && !body.snapshot) return c.json({ error: 'uuid_required' }, 400);

  return await withConn(c, user, async (apiKey) => {
    let snap: CrunchbaseSnapshot | null = body.snapshot && body.snapshot.uuid ? body.snapshot : null;
    if (!snap) snap = await lookupOrganization(apiKey, lookupKey);
    if (!snap) throw new Error('crunchbase_org_not_found');
    await c.env.DB.prepare(
      'UPDATE projects SET crunchbase_uuid = ?, crunchbase_data_json = ?, crunchbase_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(snap.uuid, JSON.stringify(snap), project.id).run();

    const actor = await hashEmail(user.email || '');
    try {
      await c.env.DB.prepare(
        'INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)',
      ).bind(user.id, actor, 'crunchbase_enrichment_applied',
        JSON.stringify({ project_id: project.id, crunchbase_uuid: snap.uuid, name: snap.name })).run();
    } catch {}

    return { ok: true, snapshot: snap };
  });
});

crunchbase.get('/projects/:id/competitors', async (c) => {
  const user = await requireAuth(c);
  gateTier(user);
  const projectId = c.req.param('id') || '';
  // Authz parity with /apply: admin OR owning founder only. Admin/partner/
  // investor/mentor roles get blanket read here only via admin; the rest
  // of the elevated roles do NOT get to enumerate arbitrary projects'
  // enrichment context (IDOR guard).
  const owned = await loadProjectForWrite(c, user, projectId);
  if (!owned) return c.json({ error: 'not_found_or_forbidden' }, 404);
  const row = await c.env.DB.prepare('SELECT id, crunchbase_uuid, crunchbase_data_json FROM projects WHERE id = ?')
    .bind(owned.id)
    .first<{ id: number; crunchbase_uuid: string | null; crunchbase_data_json: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!row.crunchbase_uuid) return c.json({ error: 'crunchbase_not_applied', message: 'Apply a Crunchbase company to this project first.' }, 412);

  const limit = Math.max(1, Math.min(25, Number(c.req.query('limit') || 10)));
  return await withConn(c, user, async (apiKey) => {
    let source: CrunchbaseSnapshot | null = null;
    if (row.crunchbase_data_json) {
      try { source = JSON.parse(row.crunchbase_data_json) as CrunchbaseSnapshot; } catch {}
    }
    if (!source) source = await lookupOrganization(apiKey, row.crunchbase_uuid!);
    if (!source) return { competitors: [] };
    return { source, competitors: await findCompetitors(apiKey, source, limit) };
  });
});

export default crunchbase;
