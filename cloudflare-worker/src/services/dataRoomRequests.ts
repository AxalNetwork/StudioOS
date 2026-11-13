/**
 * D1104 (#2984, part 3 of Data room #2456) — investors' requests to see a
 * venture's room, in one queue (migration 595).
 *
 * Two places write a request, each through a statement here so the rule is
 * one: the round call's "Request the data room" (`roundCalls.ts`, in the same
 * batch as the response and under its claim) and, once DEAL #2421's DL9 is
 * built, the deal page (`dealPageRequestStatement`). Either way:
 *
 *   · one open request per investor and venture — a second ask is the same
 *     row (the partial unique index; `INSERT OR IGNORE`);
 *   · no request for an investor who already holds a live grant: they have
 *     the room, and a request would ask the founder a question already
 *     answered.
 *
 * The founder answers on the room (`routes/data_room.ts`): accepting writes
 * the grant, declining keeps the reason the investor was told.
 */
import type { Env } from '../types';

export const REQUEST_SOURCES = ['round_call', 'deal_page'] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];
export const REQUEST_MESSAGE_MAX = 2000;
export const DECLINE_REASON_MAX = 500;

const newUid = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');

// Both writers end with the same clause, written out in each (no SQL is
// interpolated into a statement): no live grant for this investor on this
// venture.

/**
 * The round call's request, for the response batch: written only when this
 * response's claim holds (the same guard the call's question insert uses), so
 * a refused response leaves no request behind.
 */
export function roundCallRequestStatement(env: Env, input: {
  callId: number; projectId: number; investorUserId: number; recipientId: number; claim: string; at: string;
}) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO data_room_access_requests (uid, project_id, investor_user_id, source, round_call_id, state, created_at)
     SELECT ?, ?, ?, 'round_call', ?, 'open', ?
      WHERE EXISTS (SELECT 1 FROM round_call_recipients r WHERE r.id = ? AND r.response_claim = ?)
        AND NOT EXISTS (SELECT 1 FROM data_room_grants g
                         WHERE g.project_id = ? AND g.investor_user_id = ? AND g.status = 'active'
                           AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now')))`,
  ).bind(newUid(), input.projectId, input.investorUserId, input.callId, input.at,
    input.recipientId, input.claim, input.projectId, input.investorUserId);
}

/**
 * The deal page's request (DEAL #2421, DL9), for its own route to run. The
 * message is the investor's own words to the founder, at most 2,000
 * characters, or null.
 */
export function dealPageRequestStatement(env: Env, input: { projectId: number; investorUserId: number; message?: string | null; at: string }) {
  const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim().slice(0, REQUEST_MESSAGE_MAX) : null;
  return env.DB.prepare(
    `INSERT OR IGNORE INTO data_room_access_requests (uid, project_id, investor_user_id, source, message, state, created_at)
     SELECT ?, ?, ?, 'deal_page', ?, 'open', ?
      WHERE NOT EXISTS (SELECT 1 FROM data_room_grants g
                         WHERE g.project_id = ? AND g.investor_user_id = ? AND g.status = 'active'
                           AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now')))`,
  ).bind(newUid(), input.projectId, input.investorUserId, message, input.at, input.projectId, input.investorUserId);
}

export type AccessRequest = {
  uid: string;
  investor: { id: number; name: string | null; email: string | null };
  source: RequestSource;
  round_call: { uid: string; name: string } | null;
  message: string | null;
  state: 'open' | 'accepted' | 'declined';
  created_at: string;
  decided_at: string | null;
  decided_by: { id: number; name: string | null } | null;
  decline_reason: string | null;
  /** The NDA between the venture's founder and this investor: what the founder can send next. */
  nda: 'active' | 'pending' | 'none';
  /** Whether the investor holds a live grant now. */
  has_access: boolean;
};

/**
 * The venture's queue, open first and then newest. Throws when the store
 * cannot be read, so the route answers 503 rather than an empty queue.
 */
export async function readRequests(env: Env, projectId: number): Promise<AccessRequest[]> {
  const rows = (await env.DB.prepare(
    `SELECT q.uid, q.investor_user_id, iu.name AS investor_name, iu.email AS investor_email,
            q.source, q.message, q.state, q.created_at, q.decided_at, q.decided_by, du.name AS decided_by_name,
            q.decline_reason, c.uid AS call_uid, c.name AS call_name,
            (SELECT n.status FROM pairwise_ndas n
               JOIN users owner ON owner.id = n.party_a_user_id
               JOIN projects p ON p.founder_id = owner.founder_id
              WHERE p.id = q.project_id AND n.party_b_user_id = q.investor_user_id
                AND (n.status <> 'active' OR n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))
              ORDER BY CASE n.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END LIMIT 1) AS nda_status,
            EXISTS (SELECT 1 FROM data_room_grants g
                     WHERE g.project_id = q.project_id AND g.investor_user_id = q.investor_user_id AND g.status = 'active'
                       AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))) AS has_access
       FROM data_room_access_requests q
       LEFT JOIN users iu ON iu.id = q.investor_user_id
       LEFT JOIN users du ON du.id = q.decided_by
       LEFT JOIN round_calls c ON c.id = q.round_call_id
      WHERE q.project_id = ?
      ORDER BY CASE q.state WHEN 'open' THEN 0 ELSE 1 END, q.created_at DESC, q.id DESC`,
  ).bind(projectId).all<any>()).results || [];
  return rows.map((r) => ({
    uid: String(r.uid),
    investor: { id: Number(r.investor_user_id), name: r.investor_name ?? null, email: r.investor_email ?? null },
    source: r.source,
    round_call: r.call_uid ? { uid: String(r.call_uid), name: String(r.call_name) } : null,
    message: r.message ?? null,
    state: r.state,
    created_at: String(r.created_at),
    decided_at: r.decided_at ?? null,
    decided_by: r.decided_by != null ? { id: Number(r.decided_by), name: r.decided_by_name ?? null } : null,
    decline_reason: r.decline_reason ?? null,
    nda: r.nda_status === 'active' ? 'active' : r.nda_status === 'pending' ? 'pending' : 'none',
    has_access: Boolean(Number(r.has_access)),
  }));
}
