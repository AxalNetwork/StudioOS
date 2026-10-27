import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject, getProjectMembershipRole } from '../services/projectAccess';
import { canHoldValidateSource } from './_founder_validate_helpers';
import { projectEnabled } from '../integrations/companyScope';
import { ensureIntegrationsSchema } from '../integrations/registry';
import { googleCalClientId } from '../services/calendar';
import { DRIVE_FILE_SCOPE, WorkspaceError, ensureWorkspaceIntegration, validFileId, workspaceConnection, workspaceRead } from '../services/google/workspace';

const workspace = new Hono<{ Bindings: Env }>();
const MODULE_KINDS: Record<string, readonly string[]> = Object.freeze({
  customer_research: ['doc'], demand_signals: ['form'], experiments: ['form'], solution_design: ['doc'],
  product_roadmap: ['sheet'], pitch_deck: ['slides'], data_room: ['doc','sheet','slides','file'],
  revenue_traction: ['sheet'], grow_updates: ['sheet'],
});
const MIME_KINDS: Record<string, string> = Object.freeze({
  'application/vnd.google-apps.document': 'doc', 'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.presentation': 'slides', 'application/vnd.google-apps.form': 'form',
});
const fileView = (row: any) => ({ uid: row.uid, project_id: row.project_id, module: row.module, kind: row.kind, name: row.name,
  mime_type: row.mime_type, mapping: row.mapping_json ? JSON.parse(row.mapping_json) : null, modified_time: row.modified_time,
  last_synced_at: row.last_synced_at, status: row.status, last_error: row.last_error });
const idOf = (v: unknown) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new WorkspaceError('invalid_project', 400); return n; };
async function member(c: any) {
  const user = await requireAuth(c);
  if ((await selectJwt(c))?.payload.impersonated_by) throw new WorkspaceError('support_session_refused', 403);
  return user;
}
async function venture(c: any, user: any, project: unknown) {
  const id = idOf(project);
  const role = await getProjectMembershipRole(c.env, id, user.id);
  const row = await c.env.DB.prepare('SELECT id, company_id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  if ((user.role === 'admin' || (!canHoldValidateSource(user) && role !== 'cofounder')) || (!row || !await canAccessProject(c.env, user, row, { write: true }))) throw new WorkspaceError('project_not_available', 403);
  if (!row?.company_id) throw new WorkspaceError('company_not_enabled', 409);
  return row as { id: number; company_id: number };
}
/** D1093: the Build feeds' routes share this scope check (member, venture write, company enabled). */
export async function context(c: any, user: any, project: unknown) {
  const p = await venture(c, user, project);
  const row = await c.env.DB.prepare("SELECT id,uid FROM integrations WHERE user_id = ? AND provider_key = 'google_workspace' AND status = 'active'").bind(user.id).first();
  if (!row || !await projectEnabled(c.env, row.id, p.id)) throw new WorkspaceError('company_not_enabled', 409);
  return { project: p, integration: row };
}
/** Enabling a company is explicit in the consent dialog, never inferred from joining it. */
export async function prepareWorkspaceConnect(c: any) {
  const user = await member(c);
  const body = await c.req.json().catch(() => ({}));
  const project = await venture(c, user, body.project);
  const linked = await c.env.DB.prepare('SELECT 1 AS linked FROM user_company_links WHERE user_id = ? AND company_id = ?').bind(user.id, project.company_id).first();
  if (!linked) throw new WorkspaceError('company_not_enabled', 409);
  if (await workspaceConnection(c.env, user.id) === 'google_not_connected') throw new WorkspaceError('google_not_connected', 409);
  await ensureIntegrationsSchema(c.env);
  const old = await c.env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'google_workspace'").bind(user.id).first();
  if (!old || !await projectEnabled(c.env, old.id, project.id)) {
    if (body.enable_company !== true) throw new WorkspaceError('company_not_enabled', 409);
  }
  const row = await ensureWorkspaceIntegration(c.env, user.id);
  if (body.enable_company === true) await c.env.DB.prepare('INSERT INTO integration_companies (integration_id,company_id,enabled) VALUES (?,?,1) ON CONFLICT(integration_id,company_id) DO UPDATE SET enabled = 1').bind(row.id, project.company_id).run();
  if (await workspaceConnection(c.env, user.id) !== 'ready') await c.env.DB.prepare("UPDATE integrations SET status = 'pending' WHERE id = ?").bind(row.id).run();
  return user;
}
export function safe(handler: (c: any, user: any) => Promise<any>) {
  return async (c: any) => {
    try { return await handler(c, await member(c)); }
    catch (error) {
      if (error instanceof Error && ['Unauthorized','Forbidden'].includes(error.message)) throw error;
      const e = error instanceof WorkspaceError ? error : new WorkspaceError('workspace_unreadable');
      return c.json({ error: e.code }, e.status);
    }
  };
}
workspace.get('/picker-config', safe(async (c, user) => {
  await venture(c, user, c.req.query('project'));
  const state = await workspaceConnection(c.env, user.id);
  const apiKey = c.env.GOOGLE_PICKER_API_KEY, appId = c.env.GOOGLE_PICKER_APP_ID, clientId = googleCalClientId(c.env);
  return c.json({ state, configured: !!(apiKey && appId && clientId), api_key: apiKey || null, app_id: appId || null, client_id: clientId || null, scope: DRIVE_FILE_SCOPE });
}));
workspace.get('/files', safe(async (c, user) => {
  const { project, integration } = await context(c, user, c.req.query('project'));
  const rows = await c.env.DB.prepare("SELECT * FROM google_workspace_files WHERE integration_id = ? AND user_id = ? AND project_id = ? AND status <> 'stopped' ORDER BY id").bind(integration.id, user.id, project.id).all();
  return c.json({ items: (rows.results || []).map(fileView) });
}));
workspace.post('/files', safe(async (c, user) => {
  const body = await c.req.json().catch(() => ({}));
  const { project, integration } = await context(c, user, body.project);
  if (!Object.hasOwn(MODULE_KINDS, body.module) || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 20 || !body.ids.every(validFileId)) throw new WorkspaceError('invalid_files', 400);
  // Confirm all files before writing any, and trust no metadata sent by the Picker.
  const files = [];
  for (const id of new Set<string>(body.ids)) {
    const metadata = await workspaceRead(c.env, user.id, 'files.get', id);
    if (metadata.id !== id || metadata.trashed === true) throw new WorkspaceError('file_not_shared', 403);
    const kind = MIME_KINDS[metadata.mimeType] || 'file';
    if (String(metadata.mimeType || '').startsWith('application/vnd.google-apps.') && !MIME_KINDS[metadata.mimeType]) throw new WorkspaceError('wrong_file_kind', 400);
    if (!MODULE_KINDS[body.module].includes(kind)) throw new WorkspaceError('wrong_file_kind', 400);
    if (typeof metadata.name !== 'string' || !metadata.name.trim()) throw new WorkspaceError('google_unreadable');
    files.push({ id, kind, metadata });
  }
  await c.env.DB.batch(files.map(({ id, kind, metadata }) => c.env.DB.prepare(
    "INSERT INTO google_workspace_files (uid,integration_id,user_id,project_id,module,drive_file_id,mime_type,kind,name,modified_time) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(integration_id,project_id,module,drive_file_id) DO UPDATE SET name = excluded.name, mime_type = excluded.mime_type, modified_time = excluded.modified_time, status = 'active', last_error = NULL, updated_at = CURRENT_TIMESTAMP"
  ).bind(crypto.randomUUID(), integration.id, user.id, project.id, body.module, id, metadata.mimeType, kind, metadata.name.slice(0,500), typeof metadata.modifiedTime === 'string' ? metadata.modifiedTime : null)));
  return c.json({ added: files.length }, 201);
}));
async function picked(c: any, user: any) {
  const row = await c.env.DB.prepare("SELECT * FROM google_workspace_files WHERE uid = ? AND user_id = ? AND status <> 'stopped'").bind(c.req.param('uid'), user.id).first();
  if (!row) throw new WorkspaceError('file_not_found', 404);
  const ctx = await context(c, user, row.project_id);
  if (ctx.integration.id !== row.integration_id) throw new WorkspaceError('file_not_found', 404);
  return row;
}
workspace.put('/files/:uid/mapping', safe(async (c, user) => {
  const row = await picked(c, user);
  if (!['sheet','form'].includes(row.kind)) throw new WorkspaceError('mapping_not_supported', 400);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.mapping !== 'object' || body.mapping === null || Array.isArray(body.mapping) || JSON.stringify(body.mapping).length > 10000) throw new WorkspaceError('invalid_mapping', 400);
  // This stores a draft mapping only. Each feed validates its allowed fields before syncing.
  await c.env.DB.prepare('UPDATE google_workspace_files SET mapping_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').bind(JSON.stringify(body.mapping), row.id, user.id).run();
  return c.json({ saved: true });
}));
workspace.delete('/files/:uid', safe(async (c, user) => {
  const row = await picked(c, user);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE google_workspace_files SET status = 'stopped', mapping_json = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").bind(row.id, user.id),
    c.env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ? AND project_id = ? AND module = ? AND (external_id = ? OR substr(external_id,1,length(?) + 1) = ? || ?)').bind(row.integration_id,row.project_id,row.module,row.drive_file_id,row.drive_file_id,row.drive_file_id,':'),
    // D1093: a Doc no longer used proposes nothing; an accepted note stays.
    c.env.DB.prepare("DELETE FROM google_workspace_proposals WHERE integration_id = ? AND project_id = ? AND module = ? AND source_key = ? AND status = 'pending'").bind(row.integration_id,row.project_id,row.module,row.drive_file_id),
  ]);
  return c.json({ stopped: true, facts_kept: true });
}));
workspace.post('/files/:uid/preview', safe(async (c, user) => {
  const row = await picked(c, user);
  if (row.kind === 'sheet') {
    const reply = await workspaceRead(c.env, user.id, 'spreadsheets.values.get', row.drive_file_id);
    return c.json({ rows: Array.isArray(reply.values) ? reply.values.slice(0,5) : [], stored: false });
  }
  // Forms preview deliberately contains questions only, never respondent identity or raw answers.
  if (row.kind === 'form') {
    const reply = await workspaceRead(c.env, user.id, 'forms.get', row.drive_file_id);
    return c.json({ rows: (Array.isArray(reply.items) ? reply.items : []).slice(0,5).map((item: any) => ({ question_id: item.questionItem?.question?.questionId || null, title: String(item.title || '').slice(0,500) })), stored: false });
  }
  throw new WorkspaceError('preview_not_supported', 400);
}));
export default workspace;
