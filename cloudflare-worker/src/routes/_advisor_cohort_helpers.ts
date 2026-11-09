/**
 * The derived halves of Cohorts · Guidance and · Calendar.
 *
 * Pure, and separate from the route, for the reason `_founder_validate_helpers`
 * gives: these are the parts that produce a NUMBER, and a wrong number does not
 * throw. It renders, in the right font, beside numbers that are correct.
 *
 * Both functions here refuse rather than guess when the rows cannot answer.
 */

/** Guidance as stored. `answer === null` is open; there is no status column. */
export type GuidanceRow = {
  id: number;
  asked_by_user_id: number | null;
  answer: string | null;
  posted_at: string;
  answered_at: string | null;
  retired_at: string | null;
};

export type GuidanceCounts = {
  /** Founder questions with no answer yet. */
  open: number;
  /** Answered questions. */
  answered: number;
  /** Advisor-posted guidance — no question, so never open or answered. */
  broadcast: number;
  /**
   * Median hours from question to answer, or `null`.
   *
   * NULL WHEN NOTHING HAS BEEN ANSWERED, which is not the same as zero. A
   * median over an empty set is undefined, and rendering "0h" would claim an
   * instant reply to questions nobody has answered. The canvas draws this as
   * "Median response · last 30 days"; with no answered question the tile shows
   * "Not recorded" rather than a flattering number.
   */
  medianResponseHours: number | null;
};

const hoursBetween = (from: string, to: string): number | null => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 3_600_000;
};

export function guidanceCounts(rows: GuidanceRow[]): GuidanceCounts {
  const live = rows.filter((r) => !r.retired_at);
  const questions = live.filter((r) => r.asked_by_user_id != null);
  const answered = questions.filter((r) => r.answer != null && r.answered_at);
  const spans = answered
    .map((r) => hoursBetween(r.posted_at, r.answered_at as string))
    .filter((h): h is number => h != null && h >= 0)
    .sort((x, y) => x - y);
  let median: number | null = null;
  if (spans.length) {
    const mid = Math.floor(spans.length / 2);
    median = spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
    median = Math.round(median * 10) / 10;
  }
  return {
    open: questions.length - answered.length,
    answered: answered.length,
    broadcast: live.length - questions.length,
    medianResponseHours: median,
  };
}

/**
 * OVERDUE IS NOT COMPUTED HERE, and its absence is the point.
 *
 * The canvas draws "Overdue · past your 24h commitment". Nothing in the product
 * stores a commitment: no advisor has ever been asked for one, and there is no
 * settings row to hold it. Picking 24 hours because the canvas printed it would
 * turn a designer's example into a promise the advisor never made, and then
 * report them as having broken it.
 *
 * So the zone shows how long the oldest open question has waited — a fact — and
 * says the commitment is not recorded. If a commitment ever becomes a stored
 * setting, `overdue` becomes one comparison against this same number.
 */
export function oldestOpenHours(rows: GuidanceRow[], nowIso: string): number | null {
  const open = rows.filter((r) => !r.retired_at && r.asked_by_user_id != null && r.answer == null);
  const ages = open
    .map((r) => hoursBetween(r.posted_at, nowIso))
    .filter((h): h is number => h != null && h >= 0);
  if (!ages.length) return null;
  return Math.round(Math.max(...ages) * 10) / 10;
}

// ---------------------------------------------------------------------------

export type CalendarItem = {
  kind: 'cohort' | 'client' | 'demo_day';
  title: string;
  starts_at: string;
  /** NULL for an instant — a deadline or Demo Day has no duration recorded. */
  ends_at: string | null;
  ref: string;
  /**
   * D4813 package 3: what the event is, finer than `kind` (which the Overview
   * and older readers still key on). A group session is ONE event.
   */
  type?: 'week_opens' | 'deadline' | 'demo_day' | 'session' | 'group_session';
  /**
   * The identity an export writes as its UID. Lab dates carry the cycle id, so
   * week 2 of one cohort is never the same calendar entry as week 2 of
   * another; a session carries its slot, so the same session exported from two
   * cohorts' calendars is one entry, not two.
   */
  uid?: string;
  week_number?: number | null;
  /** A session's founders, by name only — never an email. */
  participants?: Array<{ name: string | null; status: string }>;
  capacity?: number | null;
  /** A session's booking state: `confirmed` only when every booking is. */
  status?: string | null;
  /** Started before now and not yet ended. */
  ongoing?: boolean;
};

/**
 * Items whose times overlap, as index pairs.
 *
 * WHAT COUNTS AS A COLLISION, stated because the honest answer is narrower than
 * it looks. A Lab week window spans seven days; every client slot in that month
 * falls inside one, so overlapping a WINDOW is not a clash and treating it as
 * one would report four collisions a week, every week, forever. What clashes is
 * an obligation at a moment: a deadline or Demo Day landing inside a booked
 * slot, or two booked slots overlapping each other.
 *
 * So an instant (`ends_at === null`) collides when it falls strictly inside a
 * ranged item, and two ranged items collide when their spans intersect.
 *
 * TWO INSTANTS NEVER COLLIDE, AND NO SPECIAL CASE ENFORCES THAT. The strict
 * `<` on both sides already does it: an instant is `[s, s]`, so `x[0] < y[1] &&
 * y[0] < x[1]` is false for any pair of them, identical times included. An
 * earlier draft carried an explicit `if (xInstant && yInstant) continue` — it
 * could never change an outcome, and the test for the behaviour passed with it
 * removed, which is how it was found. Being due at the same minute is not a
 * scheduling conflict, and the comparison says so without help.
 *
 * The same strictness is what makes back-to-back sessions legal: a slot ending
 * at 11:00 and one starting at 11:00 do not overlap.
 */
export function collisions(items: CalendarItem[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const span = (i: CalendarItem): [number, number] | null => {
    const s = Date.parse(i.starts_at);
    if (!Number.isFinite(s)) return null;
    if (i.ends_at == null) return [s, s];
    const e = Date.parse(i.ends_at);
    return [s, Number.isFinite(e) ? e : s];
  };
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const x = span(items[a]);
      const y = span(items[b]);
      if (!x || !y) continue;
      if (x[0] < y[1] && y[0] < x[1]) out.push([a, b]);
    }
  }
  return out;
}

/** Items starting within `days` of `nowIso`, in time order. */
export function withinDays(items: CalendarItem[], nowIso: string, days: number): CalendarItem[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return [];
  const until = now + days * 86_400_000;
  return items
    .filter((i) => {
      const s = Date.parse(i.starts_at);
      return Number.isFinite(s) && s >= now && s <= until;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

/**
 * D4813 package 3 — what the calendar shows: everything still RELEVANT within
 * `days` of now, in time order.
 *
 * NOT `withinDays`, and the difference is the ongoing session. `withinDays`
 * keeps items that START from now on, so a session that began at 09:30 and
 * runs to 11:00 vanished at 09:30 — and with it every collision it was part
 * of: a deadline at 10:00, or a second session booked for 10:30, overlapped
 * nothing the route could see. A ranged item stays while it has not ended; an
 * instant (a deadline, a week opening, Demo Day) stays while it is not past.
 */
export function activeOrUpcoming(items: CalendarItem[], nowIso: string, days: number): CalendarItem[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return [];
  const until = now + days * 86_400_000;
  return items
    .filter((i) => {
      const s = Date.parse(i.starts_at);
      if (!Number.isFinite(s) || s > until) return false;
      if (i.ends_at == null) return s >= now;
      const e = Date.parse(i.ends_at);
      return Number.isFinite(e) ? e > now : s >= now;
    })
    .map((i) => {
      const s = Date.parse(i.starts_at);
      const e = i.ends_at == null ? NaN : Date.parse(i.ends_at);
      return i.ends_at != null && s < now && e > now ? { ...i, ongoing: true } : i;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.ref.localeCompare(b.ref));
}

/** One booking row as the calendar reads it: one row per founder per slot. */
export type BookingRow = {
  slot_id: number;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  topic: string | null;
  founder_name: string | null;
  status: string;
};

/**
 * D4813 package 3 — one event per SLOT, not one per booking.
 *
 * The read joins bookings to slots, so a group session three founders booked
 * came back three times: three rows with the same time and the same `ref`,
 * three entries on the calendar, three "collisions" with itself, and React
 * keys that clashed. A slot is the event; its bookings are its participants.
 *
 * A slot is a GROUP session when it was offered to more than one founder
 * (`capacity > 1`) or more than one founder holds it. One founder in a
 * one-seat slot is an advisor session. Order is kept from the rows (the SQL
 * sorts by start).
 */
export function collapseSessions(rows: BookingRow[]): CalendarItem[] {
  const bySlot = new Map<number, BookingRow[]>();
  for (const r of rows) {
    const id = Number(r.slot_id);
    if (!bySlot.has(id)) bySlot.set(id, []);
    bySlot.get(id)!.push(r);
  }
  const out: CalendarItem[] = [];
  for (const [slotId, list] of bySlot) {
    const first = list[0];
    const capacity = first.capacity == null ? null : Number(first.capacity);
    const group = (capacity != null && capacity > 1) || list.length > 1;
    const topic = list.map((r) => r.topic).find((t) => t != null && String(t).trim() !== '') || null;
    const participants = list.map((r) => ({ name: r.founder_name ?? null, status: String(r.status) }));
    const title = topic
      || (group
        ? `Group session · ${list.length} founder${list.length === 1 ? '' : 's'}`
        : (first.founder_name ? `Session with ${first.founder_name}` : 'Booked session'));
    out.push({
      kind: 'client',
      type: group ? 'group_session' : 'session',
      title,
      starts_at: first.starts_at,
      ends_at: first.ends_at,
      ref: `slot:${slotId}`,
      uid: `advisor-slot-${slotId}`,
      participants,
      capacity,
      status: participants.every((p) => p.status === 'confirmed') ? 'confirmed' : 'pending',
    });
  }
  return out;
}

export type CollisionDetail = {
  a: string;
  b: string;
  /** An instant inside a session, or two sessions overlapping. */
  kind: 'instant_in_session' | 'sessions_overlap';
  overlap_start: string;
  overlap_end: string;
  overlap_minutes: number;
  /** The refs of whichever of the pair is in progress now. */
  ongoing: string[];
};

/**
 * `collisions`, with what the page needs to explain one in words: which kind
 * of clash, the overlapping span and its length, and which side is already
 * under way. The pairing rule is `collisions`' own — this adds no new one.
 */
export function collisionDetails(items: CalendarItem[], nowIso: string): CollisionDetail[] {
  const now = Date.parse(nowIso);
  const span = (i: CalendarItem): [number, number] => {
    const s = Date.parse(i.starts_at);
    const e = i.ends_at == null ? s : Date.parse(i.ends_at);
    return [s, Number.isFinite(e) ? e : s];
  };
  const live = (i: CalendarItem) => {
    const [s, e] = span(i);
    return i.ends_at != null && s <= now && e > now;
  };
  return collisions(items).map(([ia, ib]) => {
    const a = items[ia];
    const b = items[ib];
    const [as, ae] = span(a);
    const [bs, be] = span(b);
    const instant = a.ends_at == null || b.ends_at == null;
    const start = Math.max(as, bs);
    const end = instant ? start : Math.min(ae, be);
    return {
      a: a.ref,
      b: b.ref,
      kind: instant ? 'instant_in_session' as const : 'sessions_overlap' as const,
      overlap_start: new Date(start).toISOString(),
      overlap_end: new Date(end).toISOString(),
      overlap_minutes: Math.round((end - start) / 60_000),
      ongoing: [a, b].filter(live).map((i) => i.ref),
    };
  });
}
