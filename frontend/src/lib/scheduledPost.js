/**
 * D250 — what a scheduled Telegram or X post's controls say.
 *
 * The scheduler (the worker's scheduled handler) runs once a minute and sends a
 * post in the first tick at or after its time, so "within a minute of" is the
 * honest promise. A post it could not send becomes `failed` with its reason in
 * `send_error`; nothing retries it, and the console's own Send is the retry.
 */

/** `YYYY-MM-DDTHH:MM` in the viewer's local time, for a datetime-local input. */
export function toLocalInput(iso) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The sentence under a scheduled post, or null when its time cannot be read. */
export function scheduledNote(iso) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `Goes out within a minute of ${d.toLocaleString()} (${d.toISOString().slice(0, 16).replace('T', ' ')} UTC), sent by the scheduler.`;
}

/** The sentence for a post the scheduler could not send. */
export function failedNote(sendError) {
  const reason = String(sendError || '').trim();
  return reason
    ? `Not sent: ${reason}`
    : 'Not sent. No reason was recorded.';
}
