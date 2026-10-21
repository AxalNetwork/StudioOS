/**
 * D840 part 2 (#2347) — the founder's own Mercury sign-in, for the Raise feeds.
 *
 * The connection is the founder's own `integrations` row (`user_id` is the
 * caller, `provider_key = 'mercury'`, active), signed in through Mercury's MCP
 * (`auth_type = 'oauth_mcp'`, part 1, #2346) and opened by part 1's
 * `mercuryAccessFor`. A pasted API token reaches no
 * Raise feed: the cashflow summary, the statements and the SAFE requests are
 * MCP tools only.
 *
 * Every read goes through part 1's `openMercuryReads`, so only the tools on
 * `MERCURY_READ_TOOLS` are ever called. A read's log row holds counts only.
 */
import type { Env, User } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { MercuryClientError } from './client';
import { mercuryAccessFor, MERCURY_AUTH_TYPE } from './oauth';
import { openMercuryReads, scopePermission } from './reads';
import { raiseReadsOf, type RaiseReads } from './raiseFeeds';

/** The caller's own active Mercury connection, or null. */
export async function founderMercuryConnection(env: Env, user: User): Promise<IntegrationRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury' AND status = 'active' ORDER BY id LIMIT 1`,
  ).bind(user.id).first<IntegrationRow>();
}

export type FounderReads =
  | { ok: true; reads: RaiseReads; log: (event: string, counts: Record<string, unknown>) => Promise<void> }
  | { ok: false; status: number; code: string; message: string };

/** Opens the founder's MCP reads, or says why it cannot. */
export async function founderRaiseReads(env: Env, user: User): Promise<FounderReads> {
  const row = await founderMercuryConnection(env, user);
  if (!row) return { ok: false, status: 409, code: 'mercury_not_connected', message: 'Sign in with Mercury first.' };
  if (row.auth_type !== MERCURY_AUTH_TYPE) {
    return { ok: false, status: 409, code: 'mercury_sign_in_required', message: 'Sign in with Mercury to fill your Raise modules; a pasted token does not reach them.' };
  }
  let access;
  try { access = await mercuryAccessFor(env, Number(user.id)); } catch { access = null; }
  if (!access) return { ok: false, status: 503, code: 'credentials_unreadable', message: 'Your Mercury sign-in could not be read. Sign in with Mercury again.' };
  // Read-only, checked again on every use: a sign-in holding more than `read` is not read.
  if (scopePermission(access.scopes ?? []) !== 'read_only') {
    return { ok: false, status: 403, code: 'write_scope_refused', message: 'Your Mercury sign-in holds more than read access. Sign in with Mercury again.' };
  }
  let reads;
  try {
    reads = await openMercuryReads(access);
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
      // Counts only: a value that is not a number or a flag keeps its letters and underscores, never a figure.
      const summary = Object.entries(counts).map(([k, v]) => `${k}=${typeof v === 'number' || typeof v === 'boolean' ? v : String(v).replace(/[^a-z_]/g, '')}`).join(' ');
      await env.DB.prepare(
        `INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary)
         VALUES (?, ?, 'mercury', 'outbound', ?, 'ok', ?)`,
      ).bind(row.id, user.id, event, summary.slice(0, 500)).run().catch(() => {});
    },
  };
}
