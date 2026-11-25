/**
 * D5834 part 2 (#5834) — QuickBooks Online, read only: a founder connects one
 * QuickBooks company (realm) to one venture, and the P&L and balance-sheet
 * sync of part 1 (`services/financialStatements/quickbooksSync.ts`) reads it.
 *
 * Ready only when the owner has set `QUICKBOOKS_APP_APPROVED=1` and the Intuit
 * app's client id and secret (env or HQ › Integration keys). The app is the
 * owner's to register, with the exact callback and Intuit's app assessment.
 *
 * What the connection binds, and where each comes from:
 *   · the realm: Intuit's `realmId` on the callback, numeric only. The code
 *     Intuit issues is good for that realm alone, so a realm that does not
 *     match the grant cannot read anything (Intuit answers 403);
 *   · the venture: `quickbooks_project_id`, chosen at the start and carried in
 *     the signed state, never the callback's query; the founder must be able
 *     to write to it;
 *   · sandbox or production: the deployment's `QUICKBOOKS_ENVIRONMENT`
 *     (`production`, else `sandbox`), never the request, because Intuit's
 *     development and production keys are separate apps.
 */
import type { Env } from '../../types';
import { oauthCallbackUrl } from '../../util/url';
import { loadOauthCreds, oauthCredsReady } from '../../services/providerOauthKeys';
import { canAccessProject } from '../../services/projectAccess';
import { isRealmId } from '../../services/financialStatements/quickbooksClient';
import { ConnectRefusal, registerProvider, type IntegrationRow, type ProviderImpl } from '../registry';
import { decryptCredentials, encryptCredentials } from '../secrets';
import { acquireRefreshLease } from '../refreshLease';
import {
  QUICKBOOKS_SCOPES, QuickBooksAuthError, exchangeQuickBooksCode, quickbooksAuthorizeUrl, refreshQuickBooksToken,
  revokeQuickBooksToken,
} from '../quickbooksOAuth';

export const QUICKBOOKS_KEY = 'quickbooks';

export function redirectUri(env: Env): string {
  return oauthCallbackUrl(env, QUICKBOOKS_KEY);
}

/** The deployment's Intuit environment. Anything but the exact word `production` is the sandbox. */
export const quickbooksEnvironment = (env: Pick<Env, 'QUICKBOOKS_ENVIRONMENT'>): 'sandbox' | 'production' =>
  env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

const unavailable = () => new ConnectRefusal(503, 'quickbooks_unavailable', 'QuickBooks is not available yet.');

async function appCredentials(env: Env) {
  const app = await loadOauthCreds(env, QUICKBOOKS_KEY);
  if (!app) throw unavailable();
  return app;
}

async function approvedApp(env: Env) {
  if (env.QUICKBOOKS_APP_APPROVED !== '1') throw unavailable();
  return appCredentials(env);
}

/**
 * A current access token for this connection. Intuit rotates the refresh
 * token, so a refresh runs behind the lease and re-reads the stored
 * credentials inside it: a second caller sees the rotated token, never the
 * spent one. A caller that does not get the lease is told to retry.
 */
export async function quickbooksAccessToken(env: Env, row: Pick<IntegrationRow, 'id' | 'uid'>, f: typeof fetch = fetch): Promise<string> {
  const read = async () => {
    const current = await env.DB.prepare("SELECT credentials_enc FROM integrations WHERE id = ? AND provider_key = 'quickbooks' AND status = 'active'")
      .bind(row.id).first<{ credentials_enc: string }>();
    if (!current) throw new QuickBooksAuthError('quickbooks_not_connected');
    const credentials = await decryptCredentials(env, row.uid, current.credentials_enc);
    if (!credentials?.access_token) throw new QuickBooksAuthError('quickbooks_connection_unreadable');
    return credentials;
  };
  const fresh = (cr: Record<string, unknown>) => typeof cr.expires_at === 'number' && cr.expires_at > Date.now() + 60_000;
  const first = await read();
  if (fresh(first)) return String(first.access_token);
  const lease = await acquireRefreshLease(env, QUICKBOOKS_KEY, row.uid);
  if (!lease.acquired) throw new QuickBooksAuthError('quickbooks_refresh_busy');
  try {
    const credentials = await read();
    // Another caller refreshed while this one waited for the lease.
    if (fresh(credentials)) return String(credentials.access_token);
    if (!credentials.refresh_token) throw new QuickBooksAuthError('quickbooks_grant_revoked');
    const tokens = await refreshQuickBooksToken(f, await appCredentials(env), String(credentials.refresh_token));
    const next = await encryptCredentials(env, row.uid, {
      ...credentials,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      refresh_expires_at: tokens.refresh_expires_in ? Date.now() + tokens.refresh_expires_in * 1000 : credentials.refresh_expires_at ?? null,
    });
    await env.DB.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').bind(next, row.id).run();
    return tokens.access_token;
  } catch (e) {
    if (e instanceof QuickBooksAuthError && e.code === 'quickbooks_grant_revoked') {
      await env.DB.prepare('UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(e.code, row.id).run();
    }
    throw e;
  } finally {
    await lease.release();
  }
}

const provider: ProviderImpl = {
  key: QUICKBOOKS_KEY,
  async ready(env) {
    return env.QUICKBOOKS_APP_APPROVED === '1' ? oauthCredsReady(env, QUICKBOOKS_KEY) : false;
  },
  async buildAuthorizeUrl(c, _user, state) {
    const app = await approvedApp(c.env);
    return quickbooksAuthorizeUrl(app.id, redirectUri(c.env), state);
  },
  async connect(c, user, input) {
    if (!input.oauth_code) throw new ConnectRefusal(400, 'quickbooks_code_required', 'Start the QuickBooks sign-in first.');
    // Never the callback's query string: the venture the start signed into the state.
    const projectId = Number(input.config?.quickbooks_project_id);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new ConnectRefusal(400, 'quickbooks_venture_required', 'Choose the company to connect QuickBooks to, then sign in again.');
    }
    const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first<{ id: number; founder_id: number | null }>();
    if (!project || !(await canAccessProject(c.env, user, project, { write: true }))) {
      throw new ConnectRefusal(403, 'quickbooks_venture_refused', 'You can connect QuickBooks only to a company you can edit.');
    }
    // Intuit names the company the member chose on the callback; it must be a realm id and nothing else.
    const realm = c.req.query('realmId');
    if (!isRealmId(realm)) throw new ConnectRefusal(400, 'quickbooks_realm_missing', 'QuickBooks did not say which company you chose. Sign in again and pick one.');
    const app = await approvedApp(c.env);
    const tokens = await exchangeQuickBooksCode(fetch, app, input.oauth_code, redirectUri(c.env));
    const environment = quickbooksEnvironment(c.env);
    return {
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
        refresh_expires_at: tokens.refresh_expires_in ? Date.now() + tokens.refresh_expires_in * 1000 : null,
      },
      // Intuit's token answer names no scope; the grant is the one scope requested.
      scopes: [...QUICKBOOKS_SCOPES],
      external_account_id: realm,
      external_account_name: environment === 'sandbox' ? 'QuickBooks company (sandbox)' : 'QuickBooks company',
      config: { project_id: projectId, environment },
    };
  },
  async disconnect(c, _user, row) {
    // Revoking the refresh token ends the grant at Intuit. A failure keeps the
    // row, so the member can try again rather than lose sight of a live grant.
    if (!row.credentials_enc) return;
    const credentials = await decryptCredentials(c.env, row.uid, row.credentials_enc);
    const token = credentials?.refresh_token ?? credentials?.access_token;
    if (!token) return;
    await revokeQuickBooksToken(fetch, await appCredentials(c.env), String(token));
  },
};

registerProvider(provider);
