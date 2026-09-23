/**
 * HQ · Support — the three queues as one read (D204, canvas H22 drawing Y1).
 *
 *   GET /    escalations from subsidiaries, HQ-held users, and subsidiary
 *            administrators about the Admin product; the tenant × queue matrix;
 *            and the ticket→GitHub mirror strip.
 *
 * SUPER ADMIN ONLY. A route that names another account's standing and which
 * licence it administers is a cross-admin read whatever it renders — the rule
 * D132 stated and D133 applied — and on a branch there is no elevation at all,
 * so it answers "HQ only" (D106).
 *
 * EVERY READ ANSWERS FOR ITSELF. Five reads, each with its own failure: an
 * unreadable escalation board costs the escalation queue and the matrix's
 * escalation cells, never the ticket queues beside them. A read that failed is
 * `available: false` with its reason; a read that hit its ceiling is
 * `complete: false`, and its count is null rather than the length of a cut list.
 *
 * THE TOTAL IS A SUM OF EVERY TERM OR IT IS NOT SHOWN. The band at the top of
 * the page reads "N open"; if any of the three queues could not be counted in
 * full, N is null with the reason — the `backlogOf` rule, one page over.
 *
 * Mounted at /api/admin/hq-support BEFORE the /api/admin catch-all in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { openEscalationSummary, type OpenEscalation } from '../rpc/hqOps';
import { ageHours } from '../services/approvalSources';
import {
  readOpenTickets, summariseTickets, readTicketSync, readSupportLicences,
  readSupportDeployments, buildTenantMatrix, SUPPORT_LIST_LIMIT,
  type TicketQueues,
} from '../services/supportQueues';

const r = new Hono<{ Bindings: Env }>();

export const ESCALATIONS_UNREADABLE =
  'The hq_escalations table could not be read on this database (migration 259), so what the branches have pushed up is unknown — not nothing.';

type EscalationsRead =
  | { available: true; complete: boolean; items: OpenEscalation[] }
  | { available: false; reason: string };

/** The escalation queue as the page draws it: count, SLA bands, the oldest few. */
function escalationQueue(read: EscalationsRead, nowMs: number) {
  if (!read.available) return { available: false as const, reason: read.reason };
  const bands = { ok: 0, due_soon: 0, past: 0 };
  for (const e of read.items) bands[e.sla] += 1;
  return {
    available: true as const,
    complete: read.complete,
    // A count and its bands are one measurement: past the ceiling both are cut,
    // so both are withheld rather than one of them being shown as whole.
    count: read.complete ? read.items.length : null,
    bands: read.complete ? bands : null,
    oldest_age_hours: read.items.length ? ageHours(read.items[0].created_at, nowMs) : null,
    items: read.items.slice(0, SUPPORT_LIST_LIMIT).map((e) => ({
      uid: e.uid,
      branch_code: e.branch_code,
      kind: e.kind,
      subject: e.subject,
      subject_ref: e.subject_ref,
      detail: e.detail,
      raised_by_name: e.raised_by_name,
      created_at: e.created_at,
      due_at: e.due_at,
      sla: e.sla,
      age_hours: ageHours(e.created_at, nowMs),
    })),
  };
}

type Queue = { count: number | null; oldest_age_hours: number | null };

/**
 * "All tenants · N open · oldest 96h". N is the three queues — H22's own sum —
 * and it exists only when all three were counted in full.
 */
function totalOf(
  escalations: ReturnType<typeof escalationQueue>,
  tickets: ({ available: true } & TicketQueues) | { available: false; reason: string },
) {
  if (!escalations.available) {
    return { value: null, reason: 'Escalations could not be read, so the three queues have no total.' };
  }
  if (!tickets.available) {
    return { value: null, reason: 'Tickets could not be read, so two of the three queues are uncounted and a total would be a part.' };
  }
  if (!escalations.complete || !tickets.complete) {
    return { value: null, reason: 'A queue holds more items than one read counts, so a total would be a cut count.' };
  }
  const parts: Array<[string, Queue]> = [
    ['escalations', { count: escalations.count, oldest_age_hours: escalations.oldest_age_hours }],
    ['hq_held', tickets.buckets.hq_held],
    ['admin_product', tickets.buckets.admin_product],
  ];
  let value = 0;
  let oldest: { age_hours: number; queue: string } | null = null;
  for (const [queue, q] of parts) {
    value += q.count || 0;
    if (q.oldest_age_hours !== null && (!oldest || q.oldest_age_hours > oldest.age_hours)) {
      oldest = { age_hours: q.oldest_age_hours, queue };
    }
  }
  return { value, oldest };
}

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const nowMs = Date.now();

  // Each of these catches its own failure and answers `available: false`, so
  // the parallel read cannot reject as a whole.
  const [ticketsRead, licences, deployments, sync] = await Promise.all([
    readOpenTickets(env),
    readSupportLicences(env),
    readSupportDeployments(env),
    readTicketSync(env),
  ]);

  let escalationsRead: EscalationsRead;
  try {
    escalationsRead = { available: true, ...(await openEscalationSummary(env, nowMs)) };
  } catch {
    escalationsRead = { available: false, reason: ESCALATIONS_UNREADABLE };
  }

  const escalations = escalationQueue(escalationsRead, nowMs);
  const tickets = ticketsRead.available
    ? { available: true as const, ...summariseTickets(ticketsRead, nowMs) }
    : { available: false as const, reason: ticketsRead.reason };

  const matrix = licences.available
    ? {
      available: true as const,
      ...buildTenantMatrix({
        licences: licences.rows,
        deployments,
        escalations: escalationsRead,
        tickets: ticketsRead,
        nowMs,
      }),
    }
    : { available: false as const, reason: licences.reason };

  return c.json({
    read_at: new Date(nowMs).toISOString(),
    list_limit: SUPPORT_LIST_LIMIT,
    total: totalOf(escalations, tickets),
    escalations,
    tickets,
    matrix,
    sync,
  });
});

export default r;
