/**
 * D5203 (#5203) — the bounded pool the calendar aggregator reads its sources through.
 *
 * `gather` in `../calendar.ts` used to await every reader in a row, so the
 * page took as long as all of its sources added together, and every source
 * #3723 adds made it slower. This runs a lane of sources with at most `limit`
 * reads in flight, never more: no D1 or provider burst. Each read settles on
 * its own (allSettled semantics): a reader that throws, even synchronously,
 * becomes `{ ok: false }` for that source alone and never stops the others.
 *
 * Outcomes come back in the order the sources were given, whatever order they
 * finished in, so the caller's merge and sort are the same as a serial read's.
 * Each outcome carries how long its read took, in milliseconds, and nothing
 * else about the read: timings are logged, payloads never are.
 */

export type PoolOutcome<T> =
  | { kind: string; ok: true; value: T; ms: number }
  | { kind: string; ok: false; error: unknown; ms: number };

/**
 * Read every kind in `kinds` with `read`, at most `limit` at once.
 * `now` is the clock the timings use (injectable for tests).
 */
export async function runBounded<T>(
  kinds: readonly string[], limit: number, read: (kind: string) => Promise<T>,
  now: () => number = Date.now,
): Promise<PoolOutcome<T>[]> {
  const out: PoolOutcome<T>[] = new Array(kinds.length);
  if (!kinds.length) return out;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, kinds.length));
  let next = 0;
  const worker = async () => {
    while (next < kinds.length) {
      const i = next++;
      const kind = kinds[i];
      const started = now();
      try {
        const value = await read(kind);
        out[i] = { kind, ok: true, value, ms: now() - started };
      } catch (error) {
        out[i] = { kind, ok: false, error, ms: now() - started };
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}
