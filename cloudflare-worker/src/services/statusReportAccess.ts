/**
 * #4673 (Delivery audit 1/6) — who may read and write an engagement status
 * report, in one place.
 *
 * Every surface that reaches a report asks this: the Delivery routes
 * (`routes/partner_delivery.ts`), Fill with Eadwyn (`services/fills/scopes.ts`),
 * and any derivative read. The rule:
 *
 *   the partner on the engagement   reads every report of it; writes one until it is sent
 *   the engagement's client founder reads a report only once it is sent, never writes
 *   anyone else                     nothing
 *
 * AN UNSENT REPORT IS THE FIRM'S DRAFT. A client who could read it would be
 * reading work in progress the firm never handed over; Fill used to let them,
 * because its scope matched the founder and never looked at the state.
 *
 * IDENTITY IS THE FOUNDER PROFILE. `engagements.founder_id` is a `founders.id`
 * (copied from `projects.founder_id`), and an account belongs to a founder
 * through `users.founder_id`. A founder id is never compared with a user id.
 */

export type ReportAccess = { read: boolean; write: boolean };
const NONE: ReportAccess = { read: false, write: false };

export type ReportViewer = {
  /** The caller's partner profile id, or null when they have none. */
  partnerId: number | null;
  /** The caller's founder profile id (`users.founder_id`), or null. */
  founderId: number | null;
};

/** Whether a report row is the client's to read: it was sent. */
export const clientVisible = (row: { state?: unknown } | null | undefined) => !!row && row.state === 'sent';

/**
 * The caller's access to one report (`row`), or to a new one on the engagement
 * (`row` null). `engagement` is the report's engagement.
 */
export function statusReportAccess(
  row: { state?: unknown } | null,
  engagement: { partner_id: unknown; founder_id: unknown } | null,
  viewer: ReportViewer,
): ReportAccess {
  if (!engagement) return NONE;
  if (viewer.partnerId != null && Number(engagement.partner_id) === Number(viewer.partnerId)) {
    // A sent report is a record of what the client received: read, never written.
    return { read: true, write: !clientVisible(row) };
  }
  if (row && viewer.founderId != null && engagement.founder_id != null
    && Number(engagement.founder_id) === Number(viewer.founderId) && clientVisible(row)) {
    return { read: true, write: false };
  }
  return NONE;
}
