/**
 * D5840 part 2 (#5840) — the one way a Search Console sync starts: the approval flag, the venture's selected
 * property (`search_console_selections`, written by D5839's picker), the binding member's own connection still
 * switched on for the venture's company, then `syncSearchConsole` with that member's token.
 *
 * `routes/search_console.ts` calls it for the manual Sync. A later scheduled or on-connect caller (not built: no
 * cron entry, no activation) calls the same function as the binding member, so every start passes the same checks.
 */
import type { Env, User } from '../types';
import { projectEnabled } from '../integrations/companyScope';
import { SEARCH_CONSOLE_KEY, searchConsoleAccessTokenForUser } from '../integrations/providers/google_search_console';
import { SearchConsoleError as GrantError } from '../integrations/searchConsoleOAuth';
import {
  SearchConsoleError, SearchConsoleRefusal, searchConsoleVenture, syncSearchConsole, type SearchConsoleDeps, type SyncResult,
} from './searchConsoleSync';

/** The OAuth layer's codes that mean the member must sign in again: the sync records `revoked` for them. */
const REVOKED = new Set([
  'search_console_grant_revoked', 'search_console_grant_changed', 'search_console_not_connected', 'search_console_connection_unreadable',
]);

/**
 * `deps.accessToken` for the sync: D5839's `searchConsoleAccessTokenForUser`, its refusals translated to the
 * sync's codes. Only a revoked or changed grant is `grant_revoked` (which marks the selection `revoked`); a busy
 * refresh lease is `token_busy`, Google's token endpoint failing is `google_unavailable`, anything else is
 * `token_unavailable`. Neither of those last three marks the selection, so a transient fault never unbinds it.
 */
export async function searchConsoleSyncAccessToken(env: Env, userId: number): Promise<string> {
  try {
    return await searchConsoleAccessTokenForUser(env, userId);
  } catch (e) {
    if (e instanceof GrantError) {
      if (REVOKED.has(e.code)) throw new SearchConsoleError('grant_revoked');
      if (e.code === 'search_console_refresh_busy') throw new SearchConsoleError('token_busy');
      if (e.code === 'search_console_token_failed') throw new SearchConsoleError('google_unavailable');
      if (e.code === 'search_console_token_invalid') throw new SearchConsoleError('malformed_response');
    }
    throw new SearchConsoleError('token_unavailable');
  }
}

export type SyncTrigger = 'manual' | 'connect' | 'cron';

/**
 * Start one sync of the venture's selected property, as `user`, who must be a writer of the venture and the
 * member whose connection serves the selection. Refusals come before any Google request:
 *
 * - 503 `search_console_unavailable`: the owner has not set `GOOGLE_SEARCH_CONSOLE_APPROVED=1` (D5839);
 * - 400 `project_required`, 404 `project_not_found`, 403 `forbidden`: the venture and its write gate;
 * - 409 `no_property_selected`; 403 `not_your_binding`: another member's connection serves it;
 * - 409 `not_connected`, `company_not_enabled`: the member's connection is gone or switched off for the company;
 * - 409 `property_malformed`, `property_denied`, `property_revoked`: the sync's own refusals.
 *
 * A started run always answers with its `SyncResult` (`ok`, `partial`, `failed`, `denied`, `revoked`, `busy`).
 */
export async function triggerSearchConsoleSync(env: Env, user: Pick<User, 'id' | 'role' | 'founder_id' | 'licences'>, projectId: unknown,
  trigger: SyncTrigger, deps: Omit<SearchConsoleDeps, 'accessToken'> = {}): Promise<SyncResult> {
  if (env.GOOGLE_SEARCH_CONSOLE_APPROVED !== '1') throw new SearchConsoleRefusal(503, 'search_console_unavailable');
  const pid = await searchConsoleVenture(env, user, projectId, true);
  const sel = await env.DB.prepare('SELECT user_id FROM search_console_selections WHERE project_id = ?').bind(pid).first<{ user_id: number }>();
  if (!sel) throw new SearchConsoleRefusal(409, 'no_property_selected');
  if (Number(sel.user_id) !== Number(user.id)) throw new SearchConsoleRefusal(403, 'not_your_binding');
  const row = await env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' AND auth_type = 'oauth2' LIMIT 1")
    .bind(user.id, SEARCH_CONSOLE_KEY).first<{ id: number }>();
  if (!row) throw new SearchConsoleRefusal(409, 'not_connected');
  if (!(await projectEnabled(env, Number(row.id), pid))) throw new SearchConsoleRefusal(409, 'company_not_enabled');
  return syncSearchConsole(env, user, pid, { ...deps, accessToken: searchConsoleSyncAccessToken }, { trigger });
}
