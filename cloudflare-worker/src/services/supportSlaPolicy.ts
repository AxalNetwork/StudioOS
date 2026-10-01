/**
 * HQ · Support — inherited SLA bands for tickets (D455, canvas Y1).
 *
 * Escalations carry `due_at` and use `slaBand()` in `rpc/hqOps.ts`. Tickets
 * carry priority (`urgent` | `high` | `medium` | `low`) and no due date, so
 * their band is derived from age against the tier HQ assigns from priority.
 * The hours are fixed here and inherited by every subsidiary — the canvas's
 * P1/P2/P3 table — not editable on this page.
 */
export type SlaBand = 'ok' | 'due_soon' | 'past';

export const HQ_TICKET_SLA_HOURS = { P1: 24, P2: 48, P3: 96 } as const;

export type SupportSlaTier = keyof typeof HQ_TICKET_SLA_HOURS;

export const HQ_SUPPORT_SLA_POLICY: ReadonlyArray<{
  id: SupportSlaTier;
  hours: number;
  description: string;
}> = [
  { id: 'P1', hours: HQ_TICKET_SLA_HOURS.P1, description: 'Money, access, or data at risk' },
  { id: 'P2', hours: HQ_TICKET_SLA_HOURS.P2, description: 'A workflow is blocked, a workaround exists' },
  { id: 'P3', hours: HQ_TICKET_SLA_HOURS.P3, description: 'Wrong, but nobody is stopped' },
];

/** Map filing priority to the inherited response tier. */
export function ticketPriorityTier(priority: string): SupportSlaTier {
  const p = String(priority || '').trim().toLowerCase();
  if (p === 'urgent') return 'P1';
  if (p === 'high') return 'P2';
  return 'P3';
}

/** Same due-soon window escalations use: within 24h of the limit. */
export const SLA_DUE_SOON_HOURS = 24;

/**
 * Band from age and a limit in hours. Returns null when age is unknown.
 */
export function ticketSlaBand(
  ageHours: number | null,
  limitHours: number,
  dueSoonHours = SLA_DUE_SOON_HOURS,
): SlaBand | null {
  if (ageHours === null || !Number.isFinite(ageHours)) return null;
  if (ageHours > limitHours) return 'past';
  if (ageHours > limitHours - dueSoonHours) return 'due_soon';
  return 'ok';
}

export function ticketSlaBandForPriority(ageHours: number | null, priority: string): SlaBand | null {
  const tier = ticketPriorityTier(priority);
  return ticketSlaBand(ageHours, HQ_TICKET_SLA_HOURS[tier]);
}

export function tallySlaBands(bands: Array<SlaBand | null>): { ok: number; due_soon: number; past: number } {
  const out = { ok: 0, due_soon: 0, past: 0 };
  for (const b of bands) {
    if (b === 'ok') out.ok += 1;
    else if (b === 'due_soon') out.due_soon += 1;
    else if (b === 'past') out.past += 1;
  }
  return out;
}

/** Ticket types the product stores today (`tickets.type`). */
export const TICKET_TAXONOMY_TYPES = ['bug', 'feature', 'task'] as const;

export type TicketTaxonomyRow = { type: string; open: number };

/**
 * Count open tickets by `type`. Unknown types are returned as their stored
 * string rather than folded into "other", so a new type is visible immediately.
 */
export async function readOpenTicketTaxonomy(
  env: { DB: import('../types').Env['DB'] },
): Promise<{ available: true; items: TicketTaxonomyRow[] } | { available: false; reason: string }> {
  try {
    // Literal `?` pair — same open statuses as `OPEN_TICKET_STATUSES` in supportQueues.ts.
    const res = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(type), ''), 'task') AS type, COUNT(*) AS n
         FROM tickets
        WHERE status IN (?, ?)
        GROUP BY type
        ORDER BY n DESC, type ASC`,
    ).bind('open', 'in_progress').all<{ type: string; n: number }>();
    const items = (res.results || []).map((r) => ({
      type: String(r.type),
      open: Number(r.n) || 0,
    }));
    return { available: true, items };
  } catch {
    return {
      available: false,
      reason: 'The tickets table could not be read on this database, so open counts by type are unknown.',
    };
  }
}
