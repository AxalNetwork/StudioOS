/** D1131: keep provider failures out of a successful local cancellation. */
import type { Context } from 'hono';
import type { Env } from '../types';
import { cancelEventCalendarCopies } from '../services/calendar/cancelEvents';

export async function scheduleCalendarCancellation(c: Context<{ Bindings: Env }>, kind: 'ticket' | 'event', id: number): Promise<void> {
  const work = cancelEventCalendarCopies(c.env, { kind, id }).catch(() => {
    console.warn('[events/calendar] cancellation_cleanup_failed');
  });
  try { c.executionCtx.waitUntil(work); }
  catch { await work; } // A local/test request without an execution context.
}
