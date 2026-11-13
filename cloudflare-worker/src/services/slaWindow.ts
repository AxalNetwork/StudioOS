/**
 * The one definition of "due soon" (D459).
 *
 * Three files each defined the window (`rpc/hqOps.ts`, `services/approvalSources.ts`,
 * `services/supportSlaPolicy.ts`), and two of them compared at the boundary with
 * different operators, so a ticket and an escalation could band differently at
 * the same remaining time. Every band now goes through `bandForRemaining`.
 *
 * THE WINDOW IS PER LIMIT. A flat 24-hour window put a 24-hour P1 ticket, and a
 * 24-hour moderation escalation, into due-soon from their first hour: they could
 * never read on time. The window is now `min(24h, limit / 2)`, so a 24-hour
 * limit is due soon for its last 12 hours and anything of 48 hours or more keeps
 * the 24-hour window it had.
 */
export type SlaBand = 'ok' | 'due_soon' | 'past';

/** The widest due-soon window, in hours. */
export const SLA_DUE_SOON_HOURS = 24;

/** The due-soon window for a limit: 24 hours, or half the limit when that is shorter. */
export function dueSoonWindowHours(limitHours: number): number {
  return Math.min(SLA_DUE_SOON_HOURS, limitHours / 2);
}

/**
 * The band from the hours left before the limit. ONE boundary rule: past once
 * the limit is behind (remaining < 0); due soon while the time left is at most
 * the window (remaining <= window); on time otherwise.
 */
export function bandForRemaining(remainingHours: number, windowHours: number): SlaBand {
  if (remainingHours < 0) return 'past';
  if (remainingHours <= windowHours) return 'due_soon';
  return 'ok';
}
