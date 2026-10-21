/**
 * D840 part 2 (#2347) — the founder's own Mercury sign-in, for the Raise feeds.
 *
 * The connection is the founder's own `integrations` row (`user_id` is the
 * caller, `provider_key = 'mercury'`, active), signed in through Mercury's MCP
 * (`auth_type = 'oauth_mcp'`, part 1, #2346). A pasted API token reaches no
 * Raise feed: the cashflow summary, the statements and the SAFE requests are
 * MCP tools only.
 *
 * Every read goes through part 1's `openMercuryReads`, so only the tools on
 * `MERCURY_READ_TOOLS` are ever called. A read's log row holds counts only.
 */
import type { Env, User } from '../../types';
import { decryptCredentials } from '../../integrations/secrets';
import { MercuryClientError } from './client';
import { openMercuryReads } from './reads';
import { raiseReadsOf, type RaiseReads } from './raiseFeeds';

export interface FounderConnection { id: number; uid: string; auth_type: string | null; credentials_enc: string | null }

/** The caller's own active Mercury connection, or null. */
export async function founderMercuryConnection(env: Env, user: User): Promise<FounderConnection | null> {
  return await env.DB.prepare(
    `SELECT id, uid, auth_type, credentials_enc FROM integrations
      WHERE user_id = ? AND provider_key = 'mercury' AND status = 'active' ORDER BY id LIMIT 1`,
  ).bind(user.id).first<FounderConnection>();
}

export type FounderReads =
  | { ok: true; reads: RaiseReads; log: (event: string, counts: Record<string, unknown>) => Promise<void>; close: () => Promise<void> }
  | { ok: false; status: number; code: string; message: string };

/** Opens the founder's MCP reads, or says why it cannot. */
export async function founderRaiseReads(env: Env, user: User): Promise<FounderReads> {
  const conn = await founderMercuryConnection(env, user);
  if (!conn) return { ok: false, status: 409, code: 'mercury_not_connected', message: 'Sign in with Mercury first.' };
  if (conn.auth_type !== 'oauth_mcp') {
    return { ok: false, status: 409, code: 'mercury_sign_in_required', message: 'Sign in with Mercury to fill your Raise modules; a pasted token does not reach them.' };
  }
  let accessToken = '';
  try {
    const creds = await decryptCredentials(env, conn.uid, conn.credentials_enc);
    accessToken = typeof creds?.access_token === 'string' ? creds.access_token : '';
  } catch { accessToken = ''; }
  if (!accessToken) return { ok: false, status: 503, code: 'credentials_unreadable', message: 'Your Mercury sign-in could not be read. Sign in with Mercury again.' };
  let reads;
  try {
    reads = await openMercuryReads({ accessToken });
  } catch (e) {
    if (e instanceof MercuryClientError && e.code === 'unauthorized') {
      return { ok: false, status: 409, code: 'mercury_reconnect_required', message: 'Mercury no longer accepts your sign-in. Sign in with Mercury again.' };
    }
    return { ok: false, status: 502, code: 'mercury_unreadable', message: 'Mercury could not be read. Nothing changed; try again.' };
  }
  return {
    ok: true,
    reads: raiseReadsOf(reads),
    async log(event, counts) {
      const summary = Object.entries(counts).map(([k, v]) => `${k}=${typeof v === 'number' || typeof v === 'boolean' ? v : String(v).replace(/[^a-z_]/g, '')}`).join(' ');
      await env.DB.prepare(
        `INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary)
         VALUES (?, ?, 'mercury', 'outbound', ?, 'ok', ?)`,
      ).bind(conn.id, user.id, event, summary.slice(0, 500)).run().catch(() => {});
    },
    close: () => reads.close().catch(() => {}),
  };
}
