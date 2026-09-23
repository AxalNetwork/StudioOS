/**
 * The dead-letter backlog, counted once.
 *
 * TWO TABLES HOLD IT, and a count of one of them is a smaller number than the
 * backlog rather than a different view of it:
 *
 *   dead_letter_queue   jobs the D1 queue gave up on (`models/jobs.ts`
 *                       moves a row here when its attempts are spent)
 *   cf_dlq_mirror       messages the Cloudflare Queue dead-lettered, mirrored
 *                       into D1 by `queue-consumer.ts` so they can be read
 *
 * `GET /api/infra/dlq` already sums the two when it is asked for no filter
 * (routes/infra.ts). This is the same total for readers that want the number
 * and not the rows — HQ Platform's Monitoring console first (D202).
 *
 * UNREADABLE IS NOT ZERO. Either table failing makes the whole answer
 * unreadable: half of a sum reported as the sum would understate the backlog
 * by exactly the half nobody could see. The reason names the table that
 * failed, because "could not be read" without a name sends someone to check
 * both.
 *
 * READ-ONLY. It does not create either table. `/infra/dlq` bootstraps them
 * because it is the console that works the rows; a summary that created a
 * table in order to count it would report 0 for a database that had never
 * been set up, which is the claim this module exists not to make.
 */
import type { Env } from '../types';

export type DlqDepth =
  | { available: true; legacy: number; mirror: number; total: number }
  | { available: false; reason: string };

async function countRows(env: Env, table: 'dead_letter_queue' | 'cf_dlq_mirror'): Promise<number | null> {
  try {
    const row = table === 'dead_letter_queue'
      ? await env.DB.prepare('SELECT COUNT(*) AS c FROM dead_letter_queue').first<{ c: number }>()
      : await env.DB.prepare('SELECT COUNT(*) AS c FROM cf_dlq_mirror').first<{ c: number }>();
    const n = Number(row?.c);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function dlqDepth(env: Env): Promise<DlqDepth> {
  const [legacy, mirror] = await Promise.all([
    countRows(env, 'dead_letter_queue'),
    countRows(env, 'cf_dlq_mirror'),
  ]);
  if (legacy === null) {
    return {
      available: false,
      reason: 'The D1 dead-letter table (dead_letter_queue) could not be read, so the backlog is '
        + 'unknown rather than empty.',
    };
  }
  if (mirror === null) {
    return {
      available: false,
      reason: 'The Cloudflare Queue dead-letter mirror (cf_dlq_mirror) could not be read, so the '
        + 'backlog is unknown rather than empty.',
    };
  }
  return { available: true, legacy, mirror, total: legacy + mirror };
}
