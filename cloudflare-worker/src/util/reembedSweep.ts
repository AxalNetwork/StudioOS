/**
 * Re-embed enqueue helper for the hourly axal-search sweep.
 *
 * Extracted from the scheduled handler's minute-7 re-embed loop so the
 * watermark-advance invariant is unit-testable: when batch-enqueuing
 * `embed_entity` jobs for a type, the watermark must advance ONLY to the
 * highest *successfully* enqueued id. If a chunk write fails (e.g. a transient
 * "D1 DB is overloaded" blip), we stop immediately and return that partial
 * watermark so the next tick re-tries the missed tail instead of silently
 * dropping rows past a watermark that jumped to the end.
 */
import type { Env } from '../types';
import { Jobs } from '../models/jobs';

export interface ReembedChunkResult {
  /** Highest id whose chunk was successfully enqueued (== `since` if none). */
  lastOk: number;
  /** Count of ids successfully enqueued. */
  okCount: number;
  /** Count of ids in the failed (and any subsequent, un-attempted) chunk. */
  failed: number;
}

/**
 * Enqueue `embed_entity` jobs for `ids` in batched chunks of `chunkSize`,
 * one D1 round-trip per chunk. Stops at the first failing chunk. Pure w.r.t.
 * the watermark: callers persist `lastOk`, never the input tail.
 */
export async function enqueueReembedChunks(
  env: Env,
  type: string,
  ids: number[],
  since: number,
  chunkSize: number,
): Promise<ReembedChunkResult> {
  let lastOk = since;
  let okCount = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    try {
      await Jobs.enqueueMany(env, 'embed_entity', chunk.map((id) => ({ type, id })));
      lastOk = chunk[chunk.length - 1];
      okCount += chunk.length;
    } catch (e) {
      failed += chunk.length;
      console.error('[cron] axal-search enqueue failed type=%s chunk@%d', type, i, (e as Error).message);
      break;
    }
  }
  return { lastOk, okCount, failed };
}
