/**
 * D417 — F2's obligation store (migration 374): the filings calendar of a
 * fund-fabric entity, and the one rule for what is due next.
 *
 * WHAT IS REAL. An obligation an admin entered, or one seeded from a pack the
 * backend already holds. The Funds · Fabric canvas: "The US obligation pack
 * ships real because the backend holds it; every other jurisdiction inherits a
 * pack HQ defines once — which is F9, not a second hardcoded ruleset here." So
 * the US packs are read from `compliance.ts`'s STANDARD_EVENTS — the rules the
 * founder-company calendar already runs on — rather than retyped, and no other
 * jurisdiction gets a pack until F9 exists.
 *
 * A ROW IS NEVER DELETED. It is filed or waived. Filing a recurring one opens
 * its next occurrence as a new row and links the two, so the calendar keeps
 * every year it has run.
 */
import type { Env } from '../types';
import { STANDARD_EVENTS } from '../routes/compliance';

export const OBLIGATION_KINDS = [
  'franchise_tax', 'registered_agent', 'annual_report', 'board_meeting', 'regulatory_filing', 'other',
] as const;
export const OBLIGATION_CADENCES = ['annual', 'quarterly', 'monthly', 'one_time', 'event'] as const;
export type ObligationKind = typeof OBLIGATION_KINDS[number];
export type ObligationCadence = typeof OBLIGATION_CADENCES[number];

/**
 * The packs F2 ships: the US ones, because the backend holds them. Keyed by
 * the same ids `compliance.ts` uses, so one ruleset serves both calendars.
 */
export const US_PACKS = ['us_de_llc', 'us_de_ccorp'] as const;
export type UsPack = typeof US_PACKS[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date as 'YYYY-MM-DD', or null. Rejects 2026-02-30. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Whole days from `today` to `due`; negative when overdue. */
export function daysUntil(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * The next occurrence after `due` for a recurring cadence, or null for one
 * that does not recur. Month arithmetic clamps to the month's last day, so a
 * 31 January monthly obligation next falls on 28 or 29 February, not 3 March.
 */
export function nextDue(due: string, cadence: ObligationCadence): string | null {
  const months = cadence === 'annual' ? 12 : cadence === 'quarterly' ? 3 : cadence === 'monthly' ? 1 : 0;
  if (!months) return null;
  const [y, m, d] = due.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export type PackRow = { kind: ObligationKind; title: string; cadence: ObligationCadence; due_date: string; pack_key: string; note: string | null };
export type PackSkip = { title: string; reason: string };

/**
 * A US pack's obligations for one entity, dated from `today` (a fixed date
 * takes its next occurrence) or from the entity's formation date (a rule
 * stated as "N days after formation"). A rule that needs a formation date the
 * entity does not record is SKIPPED with its reason, never dated from today:
 * a registered-agent renewal a year from the day someone pressed a button is
 * a date nobody owes.
 */
export function packObligations(pack: UsPack, today: string, formationDate: string | null): { rows: PackRow[]; skipped: PackSkip[] } {
  const rows: PackRow[] = [];
  const skipped: PackSkip[] = [];
  for (const spec of STANDARD_EVENTS[pack] || []) {
    const kind = (OBLIGATION_KINDS as readonly string[]).includes(spec.event_type) ? spec.event_type as ObligationKind : 'other';
    const cadence = spec.recurrence as ObligationCadence;
    let due: string | null = null;
    if (spec.due_month != null && spec.due_day != null) {
      const [ty] = today.split('-').map(Number);
      const mm = String(spec.due_month).padStart(2, '0');
      const dd = String(spec.due_day).padStart(2, '0');
      const thisYear = isoDate(`${ty}-${mm}-${dd}`);
      due = thisYear && thisYear >= today ? thisYear : isoDate(`${ty + 1}-${mm}-${dd}`);
    } else if (formationDate) {
      const offset = spec.offset_days ?? 365;
      let d = new Date(Date.parse(`${formationDate}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
      // The first occurrence on or after today, stepping by the cadence.
      for (let i = 0; d < today && i < 200; i++) {
        const n = nextDue(d, cadence);
        if (!n) break;
        d = n;
      }
      due = d;
    } else {
      skipped.push({ title: spec.title, reason: 'dated from the entity\'s formation date, which is not recorded' });
      continue;
    }
    if (!due) continue;
    rows.push({ kind, title: spec.title, cadence, due_date: due, pack_key: `${pack}:${spec.event_type}`, note: spec.description ?? null });
  }
  return { rows, skipped };
}

export type NextObligation = { kind: string; due_date: string; days_left: number };

/**
 * For each fund, the earliest OPEN obligation across its linked GP entity and
 * vehicle entity, with days left from `today`. A fund with no linked entity,
 * or whose entities have nothing open with a date, maps to null. Throws when
 * the store cannot be read; the caller reports that as unreadable.
 *
 * Only the kind and the date leave this function: no title, entity name or
 * note, because the registry crosses an unauthenticated RPC (D375).
 */
export async function nextObligationsByFund(env: Env, today: string): Promise<Map<number, NextObligation | null>> {
  const res = await env.DB.prepare(
    `SELECT f.id AS fund_id, o.kind, o.due_date
       FROM vc_funds f
       JOIN entity_obligations o
         ON o.entity_id IN (f.gp_entity_id, f.vehicle_entity_id)
      WHERE o.status = 'open' AND o.due_date IS NOT NULL
      ORDER BY f.id, o.due_date, o.id`,
  ).all<{ fund_id: number; kind: string; due_date: string }>();
  const out = new Map<number, NextObligation | null>();
  for (const r of res.results || []) {
    const id = Number(r.fund_id);
    if (out.has(id)) continue;
    out.set(id, { kind: String(r.kind), due_date: String(r.due_date), days_left: daysUntil(String(r.due_date), today) });
  }
  return out;
}
