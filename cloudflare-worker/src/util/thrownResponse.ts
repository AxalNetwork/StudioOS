/**
 * Let a thrown `Response` be the response.
 *
 * NINE SITES IN THIS WORKER REFUSE BY THROWING A RESPONSE rather than
 * returning one — the institutional-tier upsell in `requireInvestorTier`, the
 * MI and generic tier gates, `fundGpAccess`'s 404, the integrations role gate
 * and three billing refusals. That is a deliberate pattern: a gate that throws
 * cannot be forgotten by a handler that fails to check its return value, which
 * is exactly the argument `services/fundGpAccess.ts` makes for having one gate
 * instead of twelve inline ones.
 *
 * It did not work. Hono 4 re-throws anything that is not an `Error` WITHOUT
 * consulting `app.onError`, so none of those bodies ever reached a client:
 * `index.ts` returned `app.fetch(...)` directly, the rejection escaped to the
 * runtime, and the caller got an opaque worker exception instead of a 402
 * carrying the upsell or a 404 saying the fund is not there. Every one of
 * those handlers reads as though it works, and the app-level `onError` reads
 * as though it is the catch-all, so nothing about the code says otherwise.
 *
 * Why it went unnoticed: the refusals are asserted in SOURCE — funds_deadmin
 * checks gate order by reading the file, fundGpAccess.test.ts checks the shape
 * of `notFound()` the same way — and no test drove one through the router.
 * Source assertions cannot see a runtime that never returns.
 *
 * Fixing it at the entry point rather than at the nine throw sites is
 * deliberate: it restores the behaviour every one of those sites already
 * intends, needs no route to change, and adds no obligation a future gate
 * could forget. A thrown Response is a response — that is the whole rule.
 *
 * Anything that is not a Response is re-thrown untouched, so `app.onError`
 * keeps handling real errors exactly as before.
 */
export async function withThrownResponses(
  run: () => Response | Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
