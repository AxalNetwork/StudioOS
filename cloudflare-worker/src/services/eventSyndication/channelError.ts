// D1490 (#3904): a channel's refusal, in its own module so an adapter can import it without an import cycle.
/**
 * A platform's refusal. `status` is its HTTP status; `retryAfter` is the time
 * a 429 names, when it names one. The message is the platform's sentence and
 * is trimmed and cleaned of credentials before anything stores it.
 */
export class ChannelError extends Error {
  status: number | null;
  retryAfter: string | null;
  constructor(message: string, status: number | null = null, retryAfter: string | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
