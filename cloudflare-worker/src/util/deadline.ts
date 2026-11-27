/**
 * `withDeadline` — an await that cannot hang for ever.
 *
 * WHY THIS EXISTS, and it is not a hypothetical. On 2026-09-12 sign-in stopped
 * working with "The server did not respond within 30s" — the browser's own
 * message, because the worker never answered at all. The production D1 showed
 * the request had not even reached its first INSERT, and nothing in the log
 * named a failure: every candidate on that path awaits something remote with no
 * bound on how long it may take.
 *
 * A REMOTE CALL HAS THREE OUTCOMES, NOT TWO. It can succeed, it can fail, and it
 * can simply never answer. Code written for the first two treats the third as
 * success-that-is-taking-a-while, and a carefully written failure policy — a
 * fail-open, a 503, a cached fallback — is unreachable the whole time. That is
 * the shape of the bug this helper closes: not a missing error path, an
 * unreachable one.
 *
 * WHY A RACE RATHER THAN A CANCEL. `fetch` takes an `AbortSignal` and should use
 * one directly (`AbortSignal.timeout(ms)`), so this helper is for the calls that
 * cannot be cancelled — KV reads and writes, D1 statements. Their promise keeps
 * running after we stop waiting on it, which is exactly right for a counter
 * bump: the write may still land, and we simply stop letting it hold a person's
 * sign-in hostage. The rejection it may produce later is swallowed so it cannot
 * surface as an unhandled rejection long after the response has gone out.
 *
 * THE CALLER DECIDES WHAT A TIMEOUT MEANS. This throws `DeadlineExceeded` rather
 * than returning a sentinel, so a `catch` that already implements the failure
 * policy — "KV is down, fail open" / "this bucket fails closed" — covers the
 * timeout too, with no second branch to keep in step with the first.
 */

export class DeadlineExceeded extends Error {
  readonly ms: number;
  constructor(label: string, ms: number) {
    super(`${label} did not answer within ${ms}ms`);
    this.name = 'DeadlineExceeded';
    this.ms = ms;
  }
}

export async function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  // The straggler must not become an unhandled rejection once we have stopped
  // awaiting it: the response is long gone by then and the isolate would log a
  // failure nobody can act on.
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineExceeded(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
