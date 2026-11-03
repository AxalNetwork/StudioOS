/**
 * D4289 — who is an admitted influencer, in one place for every part.
 *
 * An admitted influencer has a `referral_partners` row in the `influencers`
 * segment (D-b): P1 (#4290) writes it on admission and rebuilds the segment
 * CHECK to allow it. A store from before migration 563 has no referral
 * partners, so no influencers; any other failure is thrown, never read as
 * "not an influencer".
 */
import type { Env } from '../../types';

export async function isInfluencer(env: Env, userId: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS yes FROM referral_partners WHERE user_id = ? AND segment = 'influencers'`,
    ).bind(userId).first<{ yes: number }>();
    return !!row;
  } catch (e) {
    if (/no such table: referral_partners/.test(String((e as Error)?.message))) return false;
    throw e;
  }
}
