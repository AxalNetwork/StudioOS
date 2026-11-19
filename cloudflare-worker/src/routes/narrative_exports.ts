/**
 * D6070 (#6070): the Investor narrative's export log — each PDF a founder takes of a saved version, and each copy an
 * admin makes under a read reason, recorded before the file or the text is handed out (canvas RAN22, RAN27d).
 *
 *   GET  /api/narrative-exports?project=   → { exports: [{ id, version, format, by, created_at }] }, newest first (20)
 *   POST /api/narrative-exports?project=   { version, format: 'pdf' | 'text' } → 201 { export: { id, version, format, by, created_at } }
 *
 * WHO. The venture's founder (or another writer `canWrite` admits) and an admin, the narrative read's own rule: an
 * admin needs an unexpired read reason (`narrativeAdminGate`, D914). An admin may copy the text only (owner pick A on
 * #6067), and the copy is logged with the read it was made under; their PDF is refused (403 `admin_copy_only`).
 * Version 0, the live deck, is not a saved version and is not exported (409 `live_deck_not_exported`).
 *
 * WHAT IS RECORDED. One `activity_logs` row (`raise.investor-narrative`, the version as `entity_id`) naming the
 * version and the format, never the words, a figure or the read reason's text. The page makes the file only after
 * this answers 201; a log that cannot be written is a 503, and no file is made.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { canWrite, type ProjectRef } from './_founder_validate_helpers';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { activeReason, isAdmin, narrativeAdminGate } from '../services/narrative/adminRead';
import { readableVersion } from '../services/narrative/store';
import { WriterError } from '../services/validateWriters';

const narrativeExports = new Hono<{ Bindings: Env }>();

export const EXPORT_FORMATS = ['pdf', 'text'] as const;
type Format = typeof EXPORT_FORMATS[number];
const ACTION: Record<Format, string> = { pdf: 'narrative_exported_pdf', text: 'narrative_copied_text' };
const FORMAT_OF: Record<string, Format> = { narrative_exported_pdf: 'pdf', narrative_copied_text: 'text' };
export const LOG_MAX = 20;

export const ADMIN_COPY_ONLY = 'An admin copies the narrative’s text only. Only the venture’s founder exports a file.';
export const LIVE_DECK = 'Version 0 is the live deck’s wording. Export a saved version.';
export const NOT_RECORDED = 'The export could not be recorded, so nothing was made. Try again in a moment.';
export const LOG_UNREADABLE = 'The export log could not be read. This is not a claim that nothing was exported.';

type Scope = { user: User; projectId: number; admin: boolean };

async function scope(c: any): Promise<Scope | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in first.' }); }
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return refuse(c, 400, { code: 'project_required', message: 'Name the venture.' });
  const projectId = Number(raw);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first() as ProjectRef | null;
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'Venture not found.' });
  if (!canWrite(project, user)) return refuse(c, 403, { code: 'forbidden', message: 'The investor narrative is for the venture’s founders.' });
  const gate = await narrativeAdminGate(c, user, projectId, 'read');
  if (gate) return gate;
  return { user, projectId, admin: isAdmin(user) };
}

type Row = { id: number; entity_id: string | null; action: string; actor_kind: string; created_at: string };
const view = (r: Row) => ({
  id: Number(r.id), version: r.entity_id == null ? null : Number(r.entity_id), format: FORMAT_OF[r.action] ?? null,
  by: r.actor_kind === 'admin' ? 'admin' : 'founder', created_at: r.created_at,
});

narrativeExports.get('/', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  try {
    const { results } = await c.env.DB.prepare(`SELECT l.id, l.entity_id, l.action, l.created_at,
        CASE WHEN lower(COALESCE(u.role, '')) = 'admin' THEN 'admin' ELSE 'founder' END AS actor_kind
      FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.project_id = ? AND l.entity_type = 'raise.investor-narrative' AND l.action IN ('narrative_exported_pdf', 'narrative_copied_text')
      ORDER BY l.id DESC LIMIT ?`).bind(s.projectId, LOG_MAX).all<Row>();
    return c.json({ exports: (results || []).map(view) });
  } catch (e) {
    return refuse(c, 503, { code: 'export_log_unreadable', message: LOG_UNREADABLE, raw: e });
  }
});

narrativeExports.post('/', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const body = await c.req.json().catch(() => null) as { version?: unknown; format?: unknown } | null;
  const format = body?.format;
  if (!body || typeof format !== 'string' || !(EXPORT_FORMATS as readonly string[]).includes(format)) {
    return refuse(c, 400, { code: 'invalid_export', message: 'Name a saved version and a format: pdf or text.' });
  }
  if (s.admin && format !== 'text') return refuse(c, 403, { code: 'admin_copy_only', message: ADMIN_COPY_ONLY });
  let version: number;
  try {
    version = await readableVersion(c.env, s.projectId, body.version);
  } catch (e) {
    if (e instanceof WriterError) return refuse(c, e.status === 404 ? 404 : 400, { code: 'version_not_found', message: 'That version is not one of this venture’s saved versions.', raw: e });
    return refuse(c, 503, { code: 'export_not_recorded', message: NOT_RECORDED, raw: e });
  }
  if (version === 0) return refuse(c, 409, { code: 'live_deck_not_exported', message: LIVE_DECK });
  try {
    // The admin's copy names the read it was made under, by id: the founder reads the reason itself in Who read this.
    const reason = s.admin ? await activeReason(c.env, s.projectId, Number(s.user.id)) : null;
    const summary = format === 'pdf' ? `Exported v${version} as PDF`
      : s.admin ? `An admin copied v${version} as text under read ${reason?.id ?? 'unknown'}` : `Copied v${version} as text`;
    const [insert] = await c.env.DB.batch([
      logCycleWriteStatement(c.env, {
        projectId: s.projectId, userId: Number(s.user.id), cycle: 'raise', module: 'investor-narrative', entityId: version,
        action: ACTION[format as Format], summary,
      }),
    ]);
    const row = await c.env.DB.prepare(`SELECT l.id, l.entity_id, l.action, l.created_at,
        CASE WHEN lower(COALESCE(u.role, '')) = 'admin' THEN 'admin' ELSE 'founder' END AS actor_kind
      FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.id = ? AND l.project_id = ?`)
      .bind(Number(insert?.meta?.last_row_id), s.projectId).first<Row>();
    if (!row) throw new Error('export row written but unreadable');
    return c.json({ export: view(row) }, 201);
  } catch (e) {
    return refuse(c, 503, { code: 'export_not_recorded', message: NOT_RECORDED, raw: e });
  }
});

export default narrativeExports;
export const mount: RouteMount = { path: '/api/narrative-exports', router: narrativeExports };
