// #9194 — what a page says when its read fails, in one place.
//
// A public page used to print `e.message` for any failure, so a 503 showed the
// Worker's own text ("D1_ERROR: …", "upstream timed out") as the page's only
// content, and /circles turned a failed read into "No circles are published
// yet". This maps the error a read threw to the page's words:
//
//   404 with a `notFound` sentence   → that sentence, unchanged (`not_found`)
//   any other 4xx except 429         → the server's sentence for a person, when
//                                      it wrote one (`refused`)
//   5xx, 429, a timeout, a network   → the page's own "could not be read"
//   failure or no status at all        sentence (`unreadable`)
//
// A 4xx whose only text is a machine code (`not_found`, `rate_limited`) is not
// a sentence for a person, so it reads as `unreadable` too. `retry` is true for
// every kind but `not_found`: the page draws Try again and repeats the read.
//
// Pure, and free of any one page's words, so /verify/:token (#9178) can use it.

const MACHINE_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * @param {unknown} err  what the read threw (`request()` and `refusalError()`
 *                       put the HTTP status on `.status`)
 * @param {{ unreadable: string, notFound?: string | null }} words
 * @returns {{ kind: 'not_found' | 'refused' | 'unreadable', message: string, retry: boolean }}
 */
export function pageReadFailure(err, { unreadable, notFound = null }) {
  const status = Number(err?.status) || 0;
  if (status === 404 && notFound) return { kind: 'not_found', message: notFound, retry: false };
  if (status >= 400 && status < 500 && status !== 429) {
    const said = typeof err?.message === 'string' ? err.message.trim() : '';
    if (said && !MACHINE_CODE.test(said)) return { kind: 'refused', message: said, retry: true };
  }
  return { kind: 'unreadable', message: unreadable, retry: true };
}
