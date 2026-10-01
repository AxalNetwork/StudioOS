/**
 * D278 — ONE WAY A REFUSAL BODY IS BUILT WHEN SOMETHING WE DID NOT WRITE FAILED.
 *
 * The coordinator's decision, quoted: "A refusal's `message` and `detail` are
 * sentences we wrote, and `error` is always a code. Provider and exception
 * text never reaches a member or the public: it goes to the log beside the
 * code. Where the caller is the owner of the connected account the call used,
 * or an admin on a console about one of Axal's own providers, the provider's
 * text may travel clipped in a separate `upstream` field — never in `message`,
 * `detail` or `error`."
 *
 * So there are three audiences, and they differ in exactly one respect:
 *
 *   member — our sentence only. Stripe's JSON, Google's codes, SQLite's
 *            internals and a stack's message go to the log and nowhere else.
 *   owner  — the caller owns the connected account the call used (their own
 *            Google Calendar, their own Stripe import). The provider's words
 *            are about THEIR account, so they may see them, clipped, on
 *            `upstream`.
 *   admin  — an admin on a console about one of Axal's own providers
 *            (Stripe, X, Telegram, GitHub, Cloudflare). Same as owner.
 *
 * Before D258 most of these bodies were invisible: `request()` preferred a
 * code-shaped `error` over the body's `message`. After it, `message` is what
 * the page prints, which is why the raw text had to leave `message` first.
 *
 * `scripts/check-refusal-bodies.mjs` holds the routes to this: a `message`,
 * `detail` or `error` key that takes an exception's text fails the guard.
 */
import type { Context } from 'hono';

export type RefusalAudience = 'member' | 'owner' | 'admin';

/** How much provider text an owner or admin sees. The log keeps more. */
export const UPSTREAM_MAX = 300;
const LOG_MAX = 2000;

/** The text of whatever was thrown or returned, or '' when there is none. */
export function rawText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (raw instanceof Error) return raw.message || raw.name || '';
  if (typeof raw === 'object') {
    const m = (raw as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    try { return JSON.stringify(raw); } catch { return ''; }
  }
  return String(raw);
}

export function clipUpstream(text: string): string {
  const t = text.trim();
  return t.length > UPSTREAM_MAX ? `${t.slice(0, UPSTREAM_MAX)}…` : t;
}

export type RefusalOptions = {
  /** A code: lower-case words joined by underscores. Travels on `error`. */
  code: string;
  /** Our sentence: what failed and what the person can do. `message` and `detail`. */
  message: string;
  /** What was thrown, or the provider's response text. Logged; never in `message`/`detail`/`error`. */
  raw?: unknown;
  /** Who is asking. Only `owner` and `admin` may see the raw text, clipped, on `upstream`. */
  audience?: RefusalAudience;
  /** Other keys the route already returned (ids, flags). Cannot override the four above. */
  extra?: Record<string, unknown>;
};

/** Log the raw text beside the code and return the body. */
export function refusalBody(opts: RefusalOptions): Record<string, unknown> {
  const text = rawText(opts.raw);
  if (text) console.error('[refusal]', opts.code, text.slice(0, LOG_MAX));
  const body: Record<string, unknown> = { ...(opts.extra || {}) };
  body.error = opts.code;
  body.message = opts.message;
  body.detail = opts.message;
  delete body.upstream;
  if (text && (opts.audience === 'owner' || opts.audience === 'admin')) {
    body.upstream = clipUpstream(text);
  }
  return body;
}

/** `c.json(refusalBody(opts), status)`. */
export function refuse(c: Context<any>, status: number, opts: RefusalOptions): Response {
  return c.json(refusalBody(opts), status as any);
}

/**
 * A ROW THAT FAILED INSIDE AN IMPORT. The import page prints each row's
 * `error` beside its row number, so it is a sentence, not a code — and it
 * used to be whatever the insert threw, SQLite's text included. The raw text
 * is logged; the row reads which kind of failure it was.
 */
export function rowFailureSentence(raw: unknown): string {
  const text = rawText(raw);
  if (text) console.error('[refusal] import_row_failed', text.slice(0, LOG_MAX));
  if (/UNIQUE constraint failed/i.test(text)) return 'This row duplicates one that already exists, so it was skipped.';
  if (/(FOREIGN KEY|NOT NULL|CHECK) constraint failed/i.test(text)) return 'This row is missing a value it needs or points at a record that does not exist, so it was skipped.';
  return 'This row could not be saved, so it was skipped.';
}
