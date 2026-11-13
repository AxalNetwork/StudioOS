/**
 * Bounded retry-with-backoff for transient D1 errors.
 *
 * D1 occasionally rejects a query for the whole tick under burst load with
 * `D1 DB is overloaded. Requests queued for too long.` These are transient —
 * a brief backoff usually clears them. Wrap a single best-effort write (e.g.
 * the end-of-cron `cron_run_history` INSERT) so the run summary still lands
 * after a blip instead of logging `cron history write failed`.
 *
 * Only transient overload/connection errors are retried; everything else
 * (e.g. a real SQL error) is rethrown immediately so we never mask bugs.
 */

export function isTransientD1Error(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)) || '';
  return /D1 DB is overloaded|Requests queued for too long|Network connection lost|storage caused object to be reset/i.test(
    msg,
  );
}

export async function withD1Retry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 100;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isTransientD1Error(e)) throw e;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
