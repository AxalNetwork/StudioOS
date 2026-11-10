/**
 * D4676 (#4676) — which open Pipeline socket may receive an event, decided at
 * the moment the event is sent rather than once at connect.
 *
 * WHY AT SEND TIME. A WebSocket outlives the request that opened it. The
 * upgrade already asks `sessionStanding` (D4669), but the room then kept every
 * socket for as long as the browser held it: an account signed out, a session
 * revoked, a support session ended or a membership removed after connect went
 * on receiving the board. And board events went to any partner or investor
 * socket, whatever that account could read.
 *
 * THE ANSWER FOR EACH SOCKET, in order:
 *   1. its account must still be active and its session must still stand, by
 *      the same `sessionStanding` the HTTP path and the upgrade use, from the
 *      token facts the upgrade attached (`x-auth-session`). A socket that fails
 *      is CLOSED, not merely skipped, so it stops holding a channel it no
 *      longer has. A socket opened before these facts existed carries none:
 *      it is closed once, the client reconnects, and the new socket carries
 *      them (a reconnect with a session that no longer stands is refused at
 *      the upgrade).
 *   2. a personal `notification` frame goes to its recipient only (unchanged);
 *   3. a `vote_updated` tally goes where it always went (admin, partner,
 *      investor): a tally is the public aggregate `GET /votes/:deal_id` answers
 *      to any signed-in account;
 *   4. every other board event names a deal, and goes only to a socket whose
 *      account may READ that deal (`services/pipelineAccess.ts`), the rule the
 *      list, the detail and the per-deal door use. An event that names no
 *      deal goes to admins only.
 *
 * Everything is read once per account per event (`AudienceCache`), so a busy
 * room costs one standing check per viewer, not one per socket.
 */
import type { Env, JWTPayload } from '../types';
import { sessionStanding } from '../auth';
import { heldLicences, holdsLicence } from './accountLicences';
import { pipelineCan, pipelineProject, type PipelinePrincipal, type PipelineProject } from './pipelineAccess';

export type SocketSession = { iat: number | null; jti: string | null; sid: number | null; impersonated_by: number | null };
export type SocketAttachment = { userId?: string; role?: string; connectedAt?: number; session?: SocketSession | null };
export type Delivery = 'send' | 'skip' | 'close';

type Account = PipelinePrincipal & { is_active: number; jwt_min_iat: number | null };

export type AudienceCache = {
  accounts: Map<number, Promise<Account | null>>;
  standing: Map<string, Promise<boolean>>;
  projects: Map<number, Promise<PipelineProject | null>>;
  reads: Map<string, Promise<boolean>>;
};
export const newAudienceCache = (): AudienceCache => ({ accounts: new Map(), standing: new Map(), projects: new Map(), reads: new Map() });

const memo = <K, V>(m: Map<K, Promise<V>>, k: K, f: () => Promise<V>): Promise<V> => {
  let p = m.get(k);
  if (!p) { p = f(); m.set(k, p); }
  return p;
};

async function account(env: Env, userId: number): Promise<Account | null> {
  const row = await env.DB.prepare('SELECT id, role, is_active, jwt_min_iat, founder_id FROM users WHERE id = ?')
    .bind(userId).first<{ id: number; role: string; is_active: number; jwt_min_iat: number | null; founder_id: number | null }>();
  if (!row) return null;
  return { ...row, role: row.role as Account['role'], licences: await heldLicences(env.DB, row) };
}

/** Whether this socket's session still stands. Never throws: an unreadable store is a refusal. */
async function stands(env: Env, att: SocketAttachment, user: Account): Promise<boolean> {
  if (!Number(user.is_active)) return false;
  const s = att.session;
  if (!s) return false; // a socket from before the facts existed: closed once, reconnects with them
  try {
    const standing = await sessionStanding(env, {
      user_id: user.id, email: '', role: user.role,
      ...(s.iat !== null ? { iat: s.iat } : {}),
      ...(s.jti ? { jti: s.jti } : {}),
      ...(s.sid !== null ? { sid: s.sid } : {}),
      ...(s.impersonated_by !== null ? { impersonated_by: s.impersonated_by } : {}),
    } as JWTPayload, user);
    if (!standing.ok) return false;
    if (standing.stepUpDue && new Date(standing.stepUpDue).getTime() < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export async function socketDelivery(
  env: Env, att: SocketAttachment | null, event: unknown, cache: AudienceCache = newAudienceCache(),
): Promise<Delivery> {
  const userId = Number(att?.userId);
  if (!att || !Number.isInteger(userId) || userId <= 0) return 'close';
  let user: Account | null;
  try { user = await memo(cache.accounts, userId, () => account(env, userId)); } catch { return 'close'; }
  if (!user) return 'close';
  const standingKey = `${userId}:${JSON.stringify(att.session ?? null)}`;
  if (!(await memo(cache.standing, standingKey, () => stands(env, att, user!)))) return 'close';

  const e = (event && typeof event === 'object' ? event : {}) as Record<string, unknown>;
  if (e.type === 'notification') {
    return e.user_id !== undefined && e.user_id !== null && String(e.user_id) === String(userId) ? 'send' : 'skip';
  }
  if (user.role === 'admin') return 'send';
  if (e.type === 'vote_updated') {
    return holdsLicence(user, 'partner') || holdsLicence(user, 'investor') ? 'send' : 'skip';
  }
  const dealId = Number(e.deal_id);
  if (!Number.isInteger(dealId) || dealId <= 0) return 'skip';
  const project = await memo(cache.projects, dealId, () => pipelineProject(env, dealId).catch(() => null));
  if (!project) return 'skip';
  const may = await memo(cache.reads, `${userId}:${dealId}`, () => pipelineCan(env, user!, project, 'read').catch(() => false));
  return may ? 'send' : 'skip';
}
