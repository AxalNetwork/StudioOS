/**
 * D666 (#1496) — what an AI assistant's grant may reach, checked on every
 * call, and the grant bookkeeping the founder sees on Connectors.
 *
 * A GRANT IS NEVER TRUSTED ON ITS OWN. Its props say which user and which
 * companies the founder ticked, but every tool call re-reads the user and
 * re-checks write access to the company, so a grant outlives neither the
 * account, nor a "sign out everywhere", nor the founder's place on the venture.
 *
 * "Company" here is a project the founder can write to: Validate is per
 * project. Staff roles see every project through `canAccessProject`, so the
 * consent page offers only the projects the person owns or co-founds.
 */
import type { Env, User } from '../types';
import { canReadBoard, canWrite } from '../routes/_founder_validate_helpers';
import { logActorAct } from '../services/actorLog';

/** What the founder approved, stored (encrypted) on the grant by the provider. */
export interface GrantProps {
  userId: number;
  /** OAuth client id; required by interview attribution and limits. */
  clientId: string;
  companies: number[];
  clientName: string | null;
  redirectHost: string | null;
  redirectUri: string | null;
  /** Seconds since the epoch: a session floor (`jwt_min_iat`) raised after this ends the grant. */
  grantedAt: number;
}

export class ToolRefused extends Error {
  sentence: string;
  constructor(sentence: string) { super(sentence); this.sentence = sentence; }
}

type UserRow = Pick<User, 'id' | 'role' | 'founder_id' | 'spinout_lab_active'> & { email: string | null; is_active: number | null; jwt_min_iat: number | null; deletion_requested_at: string | null };

export async function loadUser(env: Env, userId: number): Promise<UserRow | null> {
  return env.DB.prepare('SELECT id, role, founder_id, spinout_lab_active, email, is_active, jwt_min_iat, deletion_requested_at FROM users WHERE id = ?')
    .bind(userId).first<UserRow>();
}

/** The user behind a grant, or a refusal when the grant no longer stands for them. */
export async function grantUser(env: Env, props: GrantProps): Promise<UserRow> {
  const user = await loadUser(env, Number(props.userId));
  if (!user || user.is_active === 0 || user.deletion_requested_at) throw new ToolRefused('This connection no longer has an active StudioOS account behind it.');
  if (user.jwt_min_iat != null && Number(user.jwt_min_iat) > Number(props.grantedAt)) {
    throw new ToolRefused('This connection was ended when the account signed out everywhere. Connect it again from your assistant.');
  }
  return user;
}

/** The company, if this grant covers it and the user can still write to it; otherwise a refusal. */
export async function grantCompany(env: Env, props: GrantProps, user: UserRow, raw: unknown, write = false): Promise<{ id: number; name: string }> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || !props.companies.map(Number).includes(id)) {
    throw new ToolRefused('That company is not one this connection was approved for.');
  }
  const p = await env.DB.prepare('SELECT id, name, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<{ id: number; name: string | null; founder_id: number | null }>();
  if (!p || !(write ? canWrite(p, user as User) : canReadBoard(p, user as User))) {
    throw new ToolRefused(`You can no longer ${write ? 'write to' : 'read'} that company, so this connection cannot use it.`);
  }
  return { id: p.id, name: p.name || `Company #${p.id}` };
}

/** Grant exactly the live projects the app's Validate board allows this user to read. */
export async function grantableCompanies(env: Env, user: User): Promise<Array<{ id: number; name: string }>> {
  const r = await env.DB.prepare(
    'SELECT id, name, founder_id FROM projects WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id',
  ).all<{ id: number; name: string | null; founder_id: number | null }>();
  return (r.results || []).filter((p) => canReadBoard(p, user))
    .map((p) => ({ id: p.id, name: p.name || `Company #${p.id}` }));
}

/** The grant id inside a provider access token (`userId:grantId:secret`), or null. */
export function grantIdOf(request: Request): string | null {
  const m = /^Bearer\s+([^:\s]+):([^:\s]+):\S+$/i.exec(request.headers.get('Authorization') || '');
  return m ? m[2] : null;
}

export const lastUsedKey = (grantId: string) => `mcp_used:${grantId}`;

/** Per-grant limit: calls a minute. */
export const GRANT_CALLS_PER_MINUTE = 60;

/** Count one call against the grant; false once it is over the minute's limit. */
export async function withinGrantLimit(env: Env, grantId: string, now = Date.now()): Promise<boolean> {
  const key = `mcp_rl:${grantId}:${Math.floor(now / 60_000)}`;
  try {
    const n = Number((await env.RATE_LIMITS.get(key)) || 0) + 1;
    await env.RATE_LIMITS.put(key, String(n), { expirationTtl: 120 });
    return n <= GRANT_CALLS_PER_MINUTE;
  } catch {
    return false; // fail closed: an assistant's calls are not worth an unmetered window
  }
}

/** One activity_logs line per call: tool, company, client, outcome. Never an argument or a result. */
export async function logToolCall(env: Env, user: { id: number; email?: string | null }, entry: { tool: string; company: number | null; client: string | null; outcome: 'ok' | 'refused' | 'error' | 'rate_limited' }) {
  await logActorAct(env, user, 'mcp_tool_call', { tool: entry.tool, company_id: entry.company, client: entry.client, outcome: entry.outcome }, entry.company);
}

/** Revoke every assistant grant a user holds: on "sign out everywhere", re-pairing, or a deletion request. Best effort. */
export async function revokeAllGrants(env: Env, userId: number): Promise<number> {
  if (!env.OAUTH_KV) return 0;
  try {
    const { oauthHelpers } = await import('./oauth');
    const helpers = oauthHelpers(env);
    let n = 0; let cursor: string | undefined;
    do {
      const page = await helpers.listUserGrants(String(userId), cursor ? { cursor } : undefined);
      for (const g of page.items) { await helpers.revokeGrant(g.id, String(userId)); n += 1; }
      cursor = page.cursor;
    } while (cursor);
    return n;
  } catch (e) {
    console.warn('[mcp] revoke all grants failed', (e as Error).message);
    return 0;
  }
}
