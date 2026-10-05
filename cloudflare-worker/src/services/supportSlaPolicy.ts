/**
 * HQ · Support — inherited SLA bands for tickets (D455, canvas Y1).
 *
 * Escalations carry `due_at` and use `slaBand()` in `rpc/hqOps.ts`. Tickets
 * carry priority (`urgent` | `high` | `medium` | `low`) and no due date, so
 * their band is derived from age against the tier HQ assigns from priority.
 * The hours are fixed here and inherited by every subsidiary — the canvas's
 * P1/P2/P3 table — not editable on this page.
 */
import { OPEN_TICKET_STATUSES } from './supportQueues';
import { bandForRemaining, dueSoonWindowHours, SLA_DUE_SOON_HOURS, type SlaBand } from './slaWindow';

export type { SlaBand };
export { SLA_DUE_SOON_HOURS };

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

/** The priorities a ticket is filed with, in the order the mapping line reads them. */
const TICKET_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

/**
 * "urgent → P1 · high → P2 · medium and low → P3", built from `ticketPriorityTier`
 * so the sentence the panel shows cannot drift from the rule the bands use.
 */
export function ticketMappingText(): string {
  const byTier = new Map<SupportSlaTier, string[]>();
  for (const p of TICKET_PRIORITIES) {
    const t = ticketPriorityTier(p);
    byTier.set(t, [...(byTier.get(t) || []), p]);
  }
  return [...byTier].map(([t, ps]) => `${ps.join(' and ')} → ${t}`).join(' · ');
}

/**
 * Band from age and a limit in hours (D459). Returns null when age is unknown.
 * The window and the boundary are `slaWindow.ts`'s, the same ones escalations use.
 */
export function ticketSlaBand(
  ageHours: number | null,
  limitHours: number,
  dueSoonHours = dueSoonWindowHours(limitHours),
): SlaBand | null {
  if (ageHours === null || !Number.isFinite(ageHours)) return null;
  return bandForRemaining(limitHours - ageHours, dueSoonHours);
}

export function ticketSlaBandForPriority(ageHours: number | null, priority: string): SlaBand | null {
  const tier = ticketPriorityTier(priority);
  return ticketSlaBand(ageHours, HQ_TICKET_SLA_HOURS[tier]);
}

/**
 * Tally a queue's bands. A ticket with no readable age has no band, and is
 * counted as `undated` rather than left out, so the four always sum to the queue.
 */
export function tallySlaBands(bands: Array<SlaBand | null>): { ok: number; due_soon: number; past: number; undated: number } {
  const out = { ok: 0, due_soon: 0, past: 0, undated: 0 };
  for (const b of bands) {
    if (b === 'ok') out.ok += 1;
    else if (b === 'due_soon') out.due_soon += 1;
    else if (b === 'past') out.past += 1;
    else out.undated += 1;
  }
  return out;
}

export type TicketTaxonomyRow = { type: string; open: number };

/**
 * Count open tickets by `type`. Unknown types are returned as their stored
 * string rather than folded into "other", so a new type is visible immediately.
 */
export async function readOpenTicketTaxonomy(
  env: { DB: import('../types').Env['DB'] },
): Promise<{ available: true; items: TicketTaxonomyRow[] } | { available: false; reason: string }> {
  try {
    // The `?` pair binds `OPEN_TICKET_STATUSES` itself, the one definition of
    // open; its tuple type makes a third status a compile error here. GROUP BY 1
    // groups by the folded type the row reports, not the raw column, so a blank
    // type and 'task' are one row.
    const res = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(type), ''), 'task') AS type, COUNT(*) AS n
         FROM tickets
        WHERE status IN (?, ?)
        GROUP BY 1
        ORDER BY n DESC, type ASC`,
    ).bind(...OPEN_TICKET_STATUSES).all<{ type: string; n: number }>();
    const items = (res.results || []).map((r) => ({
      type: String(r.type),
      open: Number(r.n),
    }));
    return { available: true, items };
  } catch {
    return {
      available: false,
      reason: 'The tickets table could not be read on this database, so open counts by type are unknown.',
    };
  }
}
