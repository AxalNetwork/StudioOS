/** D4704 part 3 (#4704): batched occupancy and the list's shared reservation eligibility rules. */
import type { Env } from '../types';
import { ruleRefusal, rulesFromRow, weekBounds } from './advisorBookingRules';

export type SlotRow = {
  id: number; uid: string; advisor_id: number;
  starts_at: string; ends_at: string; capacity: number;
  meeting_url: string | null; notes: string | null;
  is_cancelled: number; created_at: string;
  /** Migration 240: set when the advisor withdrew the hour. A blocked slot is not cancelled and is not bookable (D4695). */
  blocked_reason?: string | null;
};

export type BookedPricing = 'priced' | 'free' | 'unpriced' | 'mixed' | null;
/** One bounded grouped read, including every capacity-consuming status. */
export async function slotBookingFacts(env: Env, advisorId: number, slotIds: number[]) {
  const out = new Map<number, { taken: number; pricing: BookedPricing }>();
  if (!slotIds.length) return out;
  const rows = await env.DB.prepare(
    `SELECT slot_id, COUNT(*) AS taken,
            SUM(CASE WHEN amount_cents > 0 THEN 1 ELSE 0 END) AS priced,
            SUM(CASE WHEN amount_cents = 0 THEN 1 ELSE 0 END) AS free,
            SUM(CASE WHEN amount_cents IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM advisor_bookings
      WHERE advisor_id = ? AND status IN ('pending','confirmed','completed')
        AND slot_id IN (SELECT value FROM json_each(?))
      GROUP BY slot_id`,
  ).bind(advisorId, JSON.stringify(slotIds)).all<{ slot_id: number; taken: number; priced: number; free: number; unpriced: number }>();
  for (const r of rows.results || []) {
    const kinds = [r.priced > 0 && 'priced', r.free > 0 && 'free', r.unpriced > 0 && 'unpriced'].filter(Boolean) as Exclude<BookedPricing, null>[];
    out.set(Number(r.slot_id), { taken: Number(r.taken), pricing: kinds.length === 1 ? kinds[0] : kinds.length ? 'mixed' : null });
  }
  return out;
}

export async function slotVerdicts(env: Env, advisorId: number, slots: SlotRow[]): Promise<Map<number, { unavailable_code: string | null; paid_cap_reached: boolean }>> {
  const out = new Map<number, { unavailable_code: string | null; paid_cap_reached: boolean }>();
  if (!slots.length) return out;
  const rules = rulesFromRow(await env.DB.prepare('SELECT * FROM advisor_availability_rules WHERE advisor_id = ?')
    .bind(advisorId).first<Parameters<typeof rulesFromRow>[0]>());
  const starts = slots.map((s) => Date.parse(s.starts_at)).filter(Number.isFinite);
  const lo = new Date(Math.min(...starts) - 8 * 86_400_000).toISOString();
  const hi = new Date(Math.max(...starts) + 8 * 86_400_000).toISOString();
  const booked = (rules.buffer_minutes ?? 0) > 0 ? ((await env.DB.prepare(
    `SELECT s.id, s.starts_at, s.ends_at FROM advisor_office_hour_slots s
      WHERE s.advisor_id = ? AND s.is_cancelled = 0 AND s.starts_at >= ? AND s.starts_at < ?
        AND EXISTS (SELECT 1 FROM advisor_bookings b WHERE b.slot_id = s.id AND b.status IN ('pending','confirmed','completed'))`
  ).bind(advisorId, lo, hi).all<{ id: number; starts_at: string; ends_at: string }>()).results ?? []) : [];
  const paidStarts = rules.weekly_paid_cap != null ? ((await env.DB.prepare(
    `SELECT ps.starts_at FROM advisor_bookings pb
       JOIN advisor_office_hour_slots ps ON ps.id = pb.slot_id
       JOIN advisor_session_types pt ON pt.id = pb.session_type_id
      WHERE pb.advisor_id = ? AND pb.status IN ('pending','confirmed','completed')
        AND pt.price_cents > 0 AND pt.is_free_intro = 0 AND COALESCE(pt.is_included, 0) = 0
        AND ps.starts_at >= ? AND ps.starts_at < ?`
  ).bind(advisorId, lo, hi).all<{ starts_at: string }>()).results ?? []).map((r) => Date.parse(r.starts_at)) : [];
  const now = Date.now();
  for (const s of slots) {
    const start = Date.parse(s.starts_at);
    const week = Number.isFinite(start) ? weekBounds(start, rules.timezone) : null;
    const used = week ? paidStarts.filter((t) => t >= week.from && t < week.until).length : 0;
    const refused = ruleRefusal({
      slot: s, rules, now, paid: false, paidThisWeek: null,
      booked: booked.filter((o) => o.id !== s.id),
    });
    out.set(s.id, {
      unavailable_code: refused && refused.code !== 'slot_blocked' ? refused.code : null,
      paid_cap_reached: rules.weekly_paid_cap != null && used >= rules.weekly_paid_cap,
    });
  }
  return out;
}
