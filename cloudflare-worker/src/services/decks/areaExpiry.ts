/**
 * D1512 (#3764, deck v2 A3): A15's daily cleanup for area proposals. A
 * proposal nobody decided (running, ready or failed) expires 14 days after
 * it was made; its images go with D1508's sweep. A decided row is never
 * touched: its outcome stays for the accept rate.
 *
 * Its own module, importing nothing but types, because `models/jobs.ts`
 * (the cleanup) is imported almost everywhere: `areas.ts` reaches the readers
 * of a venture's records, and member bank data must stay out of every cron
 * and admin path (`mercury_member_privacy_d752.test.mjs`).
 */
import type { Env } from '../../types';

const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export async function expireAreaProposals(env: Pick<Env, 'DB'>, now: Date = new Date()): Promise<number> {
  const r = await env.DB.prepare(`UPDATE deck_area_proposals SET state = 'expired', outcome = 'expired', decided_at = ?1
    WHERE state IN ('running', 'ready', 'failed') AND expires_at < ?1`).bind(sqlTime(now.getTime())).run();
  return Number(r.meta?.changes ?? 0);
}
