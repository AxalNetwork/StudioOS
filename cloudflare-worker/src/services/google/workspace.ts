import type { Env } from '../../types';
import { loadRefreshTokenExport, refreshGoogleAccessToken, reencryptRefreshTokenExport } from '../calendar';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Every provider request in this reader is GET. Tokens never leave this service. */
export const GOOGLE_WORKSPACE_READS = Object.freeze({
  'files.get': Object.freeze({ origin: 'https://www.googleapis.com', path: '/drive/v3/files/' }),
  'files.export': Object.freeze({ origin: 'https://www.googleapis.com', path: '/drive/v3/files/' }),
  'alt=media': Object.freeze({ origin: 'https://www.googleapis.com', path: '/drive/v3/files/' }),
  'documents.get': Object.freeze({ origin: 'https://docs.googleapis.com', path: '/v1/documents/' }),
  'spreadsheets.values.get': Object.freeze({ origin: 'https://sheets.googleapis.com', path: '/v4/spreadsheets/' }),
  'presentations.get': Object.freeze({ origin: 'https://slides.googleapis.com', path: '/v1/presentations/' }),
  'forms.get': Object.freeze({ origin: 'https://forms.googleapis.com', path: '/v1/forms/' }),
  'forms.responses.list': Object.freeze({ origin: 'https://forms.googleapis.com', path: '/v1/forms/' }),
});
export type WorkspaceRead = keyof typeof GOOGLE_WORKSPACE_READS;
export class WorkspaceError extends Error {
  code: string; status: number;
  constructor(code: string, status = 503) { super(code); this.code = code; this.status = status; }
}
export function validFileId(id: unknown): id is string { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id); }
export async function workspaceConnection(env: Env, userId: number): Promise<'google_not_connected' | 'workspace_not_allowed' | 'ready'> {
  try {
  const row = await env.DB.prepare('SELECT scope FROM google_oauth_tokens WHERE user_id = ?').bind(userId).first<{ scope: string }>();
  if (!row) return 'google_not_connected';
  return String(row.scope || '').split(/[\s,]+/).includes(DRIVE_FILE_SCOPE) ? 'ready' : 'workspace_not_allowed';
  } catch { throw new WorkspaceError('workspace_unreadable'); }
}
/** Bounded response, no redirects, error codes only; never include a provider's body in an exception. */
export async function workspaceRead(env: Env, userId: number, call: WorkspaceRead, id: string,
  options: { range?: string; mimeType?: string; pageToken?: string } = {}, fetcher: typeof fetch = fetch): Promise<any> {
  if (!validFileId(id) || !Object.hasOwn(GOOGLE_WORKSPACE_READS, call)) throw new WorkspaceError('invalid_workspace_read', 400);
  const state = await workspaceConnection(env, userId);
  if (state !== 'ready') throw new WorkspaceError(state, 409);
  const spec = GOOGLE_WORKSPACE_READS[call];
  const url = new URL(spec.path + encodeURIComponent(id), spec.origin);
  if (call === 'files.get') url.search = new URLSearchParams({ fields: 'id,name,mimeType,modifiedTime,trashed', supportsAllDrives: 'true' }).toString();
  if (call === 'files.export') {
    if (options.mimeType !== 'application/pdf') throw new WorkspaceError('invalid_export_kind', 400);
    url.pathname += '/export'; url.searchParams.set('mimeType', options.mimeType);
  }
  if (call === 'alt=media') url.searchParams.set('alt', 'media');
  if (call === 'spreadsheets.values.get') {
    const range = options.range || 'A1:Z5';
    if (range.length > 200 || /[\x00-\x1f]/.test(range)) throw new WorkspaceError('invalid_range', 400);
    url.pathname += '/values/' + encodeURIComponent(range);
  }
  if (call === 'forms.responses.list') {
    url.pathname += '/responses'; url.searchParams.set('pageSize', '5');
    if (options.pageToken) {
      if (options.pageToken.length > 2048) throw new WorkspaceError('invalid_page_token', 400);
      url.searchParams.set('pageToken', options.pageToken);
    }
  }
  try {
    const stored = await loadRefreshTokenExport(env, 'google_oauth_tokens', userId);
    if (!stored?.raw) throw new WorkspaceError('google_not_connected', 409);
    const token = await refreshGoogleAccessToken(env, stored.raw);
    if (stored.wasPlaintext) await reencryptRefreshTokenExport(env, 'google_oauth_tokens', userId, stored.raw);
    const res = await fetcher(url.toString(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new WorkspaceError(res.status === 429 ? 'google_rate_limited' : res.status === 403 || res.status === 404 ? 'file_not_shared' : 'google_unreadable', res.status === 403 || res.status === 404 ? 403 : 503);
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 2 * 1024 * 1024) throw new WorkspaceError('google_file_too_large', 413); chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return call === 'files.export' || call === 'alt=media' ? bytes : JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError('google_unreadable');
  }
}

/** One ledger row, never a second Google credential store. */
export async function ensureWorkspaceIntegration(env: Env, userId: number): Promise<{ id: number; uid: string }> {
  await env.DB.prepare("INSERT INTO integrations (uid,user_id,provider_key,display_name,status,auth_type,credentials_enc) VALUES (?,?,'google_workspace','Google Workspace','active','oauth2',NULL) ON CONFLICT(user_id,provider_key) DO UPDATE SET status = 'active', updated_at = CURRENT_TIMESTAMP")
    .bind(crypto.randomUUID(), userId).run();
  const row = await env.DB.prepare("SELECT id,uid FROM integrations WHERE user_id = ? AND provider_key = 'google_workspace'").bind(userId).first<{ id: number; uid: string }>();
  if (!row) throw new WorkspaceError('workspace_unreadable');
  return row;
}
/** Disconnect unlinks facts and deletes sources/proposals, never the member's accepted facts. */
export async function clearWorkspaceConnection(env: Env, userId: number): Promise<void> {
  let row: { id: number } | null;
  try { row = await env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'google_workspace'").bind(userId).first<{ id: number }>(); }
  catch (error) { if (/no such table.*integrations/i.test(String((error as Error).message))) return; throw error; }
  if (!row) return;
  await env.DB.batch([
    env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM google_workspace_files WHERE integration_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM google_workspace_proposals WHERE integration_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM integration_companies WHERE integration_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM integrations WHERE id = ? AND user_id = ?').bind(row.id, userId),
  ]);
}
