/** X token renewal behind the shared refresh lease (#5290). */
import type { Env } from '../types';
import { acquireRefreshLease } from '../integrations/refreshLease';
import { decryptString, encryptString } from './cryptoBox';
import { refreshAccessToken, XError, type XAppCredentials } from './xClient';

/**
 * Return a usable plaintext access token, refreshing + re-encrypting in
 * place when the cached one is within 60s of expiry (or already expired).
 * Throws XConfigMissing / x_unauthorized via the underlying refresh call.
 */
export async function refreshStoredXAccessToken(env: Env, app: XAppCredentials, account: any, loadAccount: (env: Env, id: number) => Promise<any>): Promise<string> {
  if (!account?.access_token_ct) throw new XError('x_account_not_linked', 'X account not linked yet.');
  const liveToken = async (row: any): Promise<string | null> => {
    const exp = row?.expires_at ? Date.parse(row.expires_at) : 0;
    if (!row?.access_token_ct || !exp || exp - Date.now() < 60_000) return null;
    const token = await decryptString(env, row.access_token_ct);
    if (!token) throw new XError('x_account_not_linked', 'Stored access token unreadable. Re-authorise the account.');
    return token;
  };
  const cached = await liveToken(account);
  if (cached) return cached;
  if (!account.refresh_token_ct) {
    throw new XError('x_refresh_missing', 'Access token expired and no refresh token stored. Re-authorise the account.');
  }

  // X rotates refresh tokens on use. Serialize callers per account, and
  // re-read D1 on both sides of the KV lease so a loser uses the winner's pair.
  const lease = await acquireRefreshLease(env, 'x', String(account.id));
  try {
    if (!lease.acquired) {
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const current = await loadAccount(env, account.id);
        const freshToken = await liveToken(current);
        if (freshToken) return freshToken;
      }
      throw new XError('x_refresh_busy', 'Another request is renewing this X account.');
    }
    const current = await loadAccount(env, account.id);
    if (!current) throw new XError('x_account_not_linked', 'X account not linked yet.');
    const freshToken = await liveToken(current);
    if (freshToken) return freshToken;
    account = current;
    if (!account?.refresh_token_ct) {
      throw new XError('x_refresh_missing', 'Access token expired and no refresh token stored. Re-authorise the account.');
    }
    const rt = await decryptString(env, account.refresh_token_ct);
    if (!rt) throw new XError('x_refresh_missing', 'Stored refresh token unreadable. Re-authorise the account.');
    const fresh = await refreshAccessToken(app, rt);
    const newAtCt = await encryptString(env, fresh.access_token);
    const newRtCt = fresh.refresh_token ? await encryptString(env, fresh.refresh_token) : account.refresh_token_ct;
    const expiresAt = new Date(Date.now() + (fresh.expires_in || 7200) * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE x_accounts
          SET access_token_ct = ?, refresh_token_ct = ?, expires_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(newAtCt, newRtCt, expiresAt, account.id).run();
    return fresh.access_token;
  } finally {
    await lease.release();
  }
}
