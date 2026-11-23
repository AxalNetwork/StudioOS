/**
 * The founder's QuickBooks Online reads (D5834 part 2, #5834): the caller's
 * own QuickBooks connection, and a sync of its P&L and balance sheets into the
 * D5833 revision store for the venture the connection is bound to. Signing
 * in, reconnecting and disconnecting go through `/api/integrations`
 * (provider `quickbooks`); this router writes only statement revisions.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { StatementRefusal } from '../services/financialStatements/contract';
import { QuickBooksFailure } from '../services/financialStatements/quickbooksClient';
import { syncQuickBooks } from '../services/financialStatements/quickbooksSync';
import { QUICKBOOKS_KEY, quickbooksAccessToken } from '../integrations/providers/quickbooks';
import { QuickBooksAuthError } from '../integrations/quickbooksOAuth';

const r = new Hono<{ Bindings: Env }>();

/** One sentence per code a member can meet here. Every code is the sync's, the token source's or this router's. */
export const QUICKBOOKS_SENTENCES: Record<string, string> = {
  connection_not_found: 'No QuickBooks connection of yours has that id.',
  realm_not_bound: 'This connection names no QuickBooks company. Connect QuickBooks again.',
  realm_not_bound_to_venture: 'This QuickBooks company is connected to a different company of yours.',
  environment_not_bound: 'This connection does not say whether it reads the sandbox or production. Connect QuickBooks again.',
  project_not_found: 'You can sync statements only into a company you can edit.',
  statements_invalid: 'Ask for one to six statements.',
  basis_invalid: 'The basis must be cash, accrual or unknown.',
  report_not_allowed: 'Only the profit and loss and the balance sheet can be read.',
  project_required: 'Say which company the statements are for.',
  invalid_body: 'Send a JSON object.',
  quickbooks_not_connected: 'This QuickBooks connection is no longer active. Connect QuickBooks again.',
  quickbooks_connection_unreadable: 'This QuickBooks connection could not be read. Connect QuickBooks again.',
  quickbooks_refresh_busy: 'Another sync is renewing this connection. Try again in a minute.',
  quickbooks_grant_revoked: 'QuickBooks no longer accepts this connection. Connect QuickBooks again.',
  quickbooks_token_failed: 'Intuit did not renew the connection. Try again later.',
  quickbooks_token_invalid: 'Intuit answered the renewal in a form Axal VC cannot read. Try again later.',
  quickbooks_unavailable: 'QuickBooks did not answer. Try again later.',
  quickbooks_unauthorized: 'QuickBooks refused the connection. Connect QuickBooks again.',
  quickbooks_scope_denied: 'QuickBooks refused access to this company’s reports.',
  quickbooks_rate_limited: 'QuickBooks asked Axal VC to wait. Try again after the time it gave.',
  quickbooks_refused: 'QuickBooks refused the report request.',
  quickbooks_fault: 'QuickBooks answered with an error instead of the report.',
  report_invalid: 'QuickBooks answered in a form Axal VC cannot read.',
  report_too_large: 'The report is larger than Axal VC reads. Ask for a shorter period.',
  report_mismatch: 'QuickBooks answered with a different report than the one asked for.',
  period_invalid: 'Give a real start and end date for a profit and loss, and a real date for a balance sheet.',
  quickbooks_unreachable: 'QuickBooks could not be reached. Try again later.',
  environment_invalid: 'This connection does not say whether it reads the sandbox or production. Connect QuickBooks again.',
  realm_invalid: 'This connection names no QuickBooks company. Connect QuickBooks again.',
  sync_failed: 'The statement could not be saved. The ones before it are kept; try again.',
};

const sentence = (code: string) => QUICKBOOKS_SENTENCES[code] ?? 'The QuickBooks request could not be completed.';

r.get('/connection', async (c) => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare(`SELECT id, uid, status, external_account_id, config_json, last_synced_at, last_error, created_at
      FROM integrations WHERE user_id = ? AND provider_key = ?`).bind(user.id, QUICKBOOKS_KEY)
    .first<{ id: number; uid: string; status: string; external_account_id: string | null; config_json: string | null; last_synced_at: string | null; last_error: string | null; created_at: string }>();
  c.header('Cache-Control', 'no-store');
  if (!row) return c.json({ connection: null });
  let config: Record<string, unknown> = {};
  try { config = row.config_json ? JSON.parse(row.config_json) : {}; } catch { config = {}; }
  const projectId = Number(config.project_id);
  return c.json({
    connection: {
      id: row.id,
      status: row.status,
      // The realm id stays on the server: the member sees that one is bound, not the identifier.
      realm_bound: !!row.external_account_id,
      project_id: Number.isSafeInteger(projectId) && projectId > 0 ? projectId : null,
      environment: config.environment === 'production' || config.environment === 'sandbox' ? config.environment : null,
      last_complete_sync_at: row.last_synced_at,
      last_error: row.last_error,
      connected_at: row.created_at,
    },
  });
});

r.post('/connection/:id/sync', async (c) => {
  const user = await requireAuth(c);
  const integrationId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null) as Record<string, any> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(c, 400, { code: 'invalid_body', message: sentence('invalid_body') });
  const projectId = Number(body.project_id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return refuse(c, 400, { code: 'project_required', message: sentence('project_required') });
  if (!Number.isSafeInteger(integrationId) || integrationId <= 0) return refuse(c, 404, { code: 'connection_not_found', message: sentence('connection_not_found') });
  const uid = await c.env.DB.prepare('SELECT uid FROM integrations WHERE id = ? AND user_id = ? AND provider_key = ?')
    .bind(integrationId, user.id, QUICKBOOKS_KEY).first<{ uid: string }>();
  if (!uid) return refuse(c, 404, { code: 'connection_not_found', message: sentence('connection_not_found') });
  try {
    const result = await syncQuickBooks(c.env, { user, projectId }, integrationId, { statements: body.statements, basis: body.basis }, {
      fetch,
      accessToken: async (id) => {
        try { return await quickbooksAccessToken(c.env, { id, uid: uid.uid }); }
        // The sync records a failure's code alone; a token failure keeps its own code.
        catch (e) { throw new QuickBooksFailure(e instanceof QuickBooksAuthError ? e.code : 'quickbooks_token_failed'); }
      },
    });
    c.header('Cache-Control', 'no-store');
    if (result.state === 'incomplete') {
      return c.json({ ...result, failed: { ...result.failed, message: sentence(result.failed.code) } });
    }
    return c.json(result);
  } catch (e) {
    if (e instanceof StatementRefusal) return refuse(c, e.status, { code: e.code, message: sentence(e.code) });
    throw e;
  }
});

export const mount: RouteMount = { path: '/api/quickbooks', router: r };
export default r;
