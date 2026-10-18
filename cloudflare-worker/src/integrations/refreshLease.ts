/**
 * #1903 — the KV lease that serializes one connection's OAuth token refresh.
 *
 * HubSpot, Calendly, Carta, DocuSign and Salesforce each refresh behind a
 * lease on `<provider>:refresh:<uid>` in `RATE_LIMITS`. Each wrote it with
 * `expirationTtl: 30`, below Workers KV's 60-second minimum, so the `put`
 * threw, the `catch` swallowed it, and no caller ever held the lease: every
 * expired-token read polled D1 for ~3 s and then refreshed anyway, and
 * concurrent reads each refreshed. One helper now holds the logic so the five
 * copies cannot drift apart again.
 *
 * Best-effort, as before: KV is eventually consistent, so two isolates can
 * both believe they won. The providers' D1 re-checks around the lease stay.
 */
import type { Env } from '../types';

/**
 * KV's minimum TTL. The lease only has to outlive one token call; a holder
 * that dies mid-refresh costs the others the 3-second poll, as it always did.
 */
export const REFRESH_LEASE_TTL_S = 60;

export interface RefreshLease {
  /** Whether this caller holds the lease (its id was read back after the write). */
  acquired: boolean;
  /** Delete the key, only if this caller acquired it. Never throws. */
  release(): Promise<void>;
}

export async function acquireRefreshLease(env: Env, provider: string, uid: string): Promise<RefreshLease> {
  const key = `${provider}:refresh:${uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  try {
    const cur = await env.RATE_LIMITS.get(key);
    if (!cur) {
      await env.RATE_LIMITS.put(key, holder, { expirationTtl: REFRESH_LEASE_TTL_S });
      const verify = await env.RATE_LIMITS.get(key);
      acquired = verify === holder;
    }
  } catch { /* lease infra failure → fall through, single-flight not guaranteed */ }
  return {
    acquired,
    async release() {
      if (!acquired) return;
      try { await env.RATE_LIMITS.delete(key); } catch { /* the TTL clears it */ }
    },
  };
}
