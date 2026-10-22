/**
 * D666 (#1496) — what an AI assistant's grant may reach, checked on every
 * call, and the grant bookkeeping the founder sees on Connectors.
 *
 * A GRANT IS NEVER TRUSTED ON ITS OWN. Its props say which user and which
 * companies the founder ticked, but every tool call re-reads the user and
 * re-checks the access each tool needs to the project, so a grant outlives neither the
 * account, nor a "sign out everywhere", nor the founder's place on the venture.
 *
 * "Company" means projects.id. Consent choices require venture ownership;
 * read tools still use canReadBoard and write tools require canWrite.
 */
import type { Env, User } from '../types';
import { canReadBoard, canWrite, ownsVenture } from '../routes/_founder_validate_helpers';
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
  /** D842 (#2470): set when the principal is a member API key (`clientId` is `apikey:<uid>`), never for an OAuth grant. */
  keyUid?: string;
}

export class ToolRefused extends Error {
  sentence: string;
  /** D842: the structured code a caller can branch on (plan §3); `refused` when none more exact applies. */
  code: string;
  constructor(sentence: string, code = 'refused') { super(sentence); this.sentence = sentence; this.code = code; }
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

/** The company, if this grant covers it and the user retains the access the tool needs; otherwise a refusal. */
export async function grantCompany(env: Env, props: GrantProps, user: UserRow, raw: unknown, write = false): Promise<{ id: number; name: string }> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || !props.companies.map(Number).includes(id)) {
    throw new ToolRefused('That company is not one this connection was approved for.');
  }
  const p = await env.DB.prepare('SELECT id, name, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<{ id: number; name: string | null; founder_id: number | null }>();
  if (!p || !(write ? canWrite(p, user as unknown as User) : canReadBoard(p, user as unknown as User))) {
    throw new ToolRefused(`You can no longer ${write ? 'write to' : 'read'} that company, so this connection cannot use it.`);
  }
  return { id: p.id, name: p.name || `Company #${p.id}` };
}

/** Grant exactly the live ventures this user owns. */
export async function grantableCompanies(env: Env, user: User): Promise<Array<{ id: number; name: string }>> {
  const r = await env.DB.prepare(
    'SELECT id, name, founder_id FROM projects WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id',
  ).all<{ id: number; name: string | null; founder_id: number | null }>();
  return (r.results || []).filter((p) => ownsVenture(p, user))
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
/**
 * D849 (#2472): per-member limit, calls a minute across EVERY grant and key the
 * member holds. Without it, ten connections are ten times one connection's limit.
 */
export const USER_CALLS_PER_MINUTE = 120;

/** Count one call in this minute's window under `prefix`; false once past `limit`, and on any KV failure. */
async function withinMinute(env: Env, prefix: string, limit: number, now: number): Promise<boolean> {
  const key = `${prefix}:${Math.floor(now / 60_000)}`;
  try {
    const n = Number((await env.RATE_LIMITS.get(key)) || 0) + 1;
    await env.RATE_LIMITS.put(key, String(n), { expirationTtl: 120 });
    return n <= limit;
  } catch {
    return false; // fail closed: an assistant's calls are not worth an unmetered window
  }
}

/** Count a grant at its default rate or an API key at its configured rate (D842). */
export async function withinGrantLimit(env: Env, limitId: string, now = Date.now(), perMinute = GRANT_CALLS_PER_MINUTE): Promise<boolean> {
  return withinMinute(env, `mcp_rl:${limitId}`, perMinute, now);
}

/** D849: count one call against the member, whichever grant or key made it; false once over the limit. */
export async function withinUserLimit(env: Env, userId: number, now = Date.now()): Promise<boolean> {
  return withinMinute(env, `mcp_rl:user:${Number(userId)}`, USER_CALLS_PER_MINUTE, now);
}

/** D842: the key a member API key's requests are counted under. */
export const keyLimitId = (uid: string) => `key:${uid}`;

/** D842: failed key lookups an IP may make in a minute before every key it sends is refused. */
export const KEY_FAILURES_PER_MINUTE = 10;
const keyFailureKey = (ip: string, now: number) => `mcp_keyfail:${ip}:${Math.floor(now / 60_000)}`;

/** True once this IP has failed `KEY_FAILURES_PER_MINUTE` key lookups this minute. Fails closed. */
export async function keyFailuresExceeded(env: Env, ip: string, now = Date.now()): Promise<boolean> {
  try { return Number((await env.RATE_LIMITS.get(keyFailureKey(ip, now))) || 0) >= KEY_FAILURES_PER_MINUTE; } catch { return true; }
}

/** Count one failed key lookup against the IP. Best effort: the check above fails closed. */
export async function recordKeyFailure(env: Env, ip: string, now = Date.now()): Promise<void> {
  const key = keyFailureKey(ip, now);
  try {
    const n = Number((await env.RATE_LIMITS.get(key)) || 0) + 1;
    await env.RATE_LIMITS.put(key, String(n), { expirationTtl: 120 });
  } catch { /* the check fails closed */ }
}

/** One activity_logs line per call: tool, company, client, outcome. Never an argument or a result. */
export type ToolOutcome = 'ok' | 'refused' | 'error' | 'rate_limited' | 'timeout';
export async function logToolCall(env: Env, user: { id: number; email?: string | null }, entry: { tool: string; company: number | null; client: string | null; outcome: ToolOutcome; keyUid?: string | null }) {
  await logActorAct(env, user, 'mcp_tool_call', {
    tool: entry.tool, company_id: entry.company, client: entry.client, outcome: entry.outcome,
    // D842: a key's call names the key's uid, never the key itself. The call's
    // execution id is in its result's `_meta`; #2465's usage row records it.
    ...(entry.keyUid ? { api_key_uid: entry.keyUid } : {}),
  }, entry.company);
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
