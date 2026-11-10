/**
 * D4813 (#4813, package 4) — the pure halves of an advisor's founder detail and cohort outcomes: the four-week timeline (live status kept apart from the Lab's recorded decision), recorded activity, week completion and counted metrics that say when a read stopped at its cap.
 *
 * Nothing here reads D1. The routes in `routes/advisors_cohorts.ts`
 * (`GET /me/cohort/:cycleId/founders/:userId` and `GET /me/cohort/:cycleId/outcomes`)
 * read the rows behind the assignment and opt-out gate and hand them here, so
 * the rules are tested without a database and a handler cannot quietly
 * re-derive them.
 *
 * UNKNOWN IS NEVER ZERO. A read that failed is `value: null` with
 * `available: false`; a read that stopped at its cap is `truncated: true`, and
 * the page prints "n+". A zero is only ever a read that worked and found none.
 */

/** Where an outcomes read stops. A value at the cap is reported as "n+", never as the total. */
export const OUTCOME_ROW_CAP = 2000;
/** Where the founder detail's guidance, sessions and activity reads stop. */
export const DETAIL_ROW_CAP = 200;

export type WeekWindow = { week_number: number; unlock_at: string | null; deadline_at: string | null };
export type WeekStatusRow = {
  week_number: number; status: string | null;
  deliverables_done: number | null; deliverables_required: number | null;
  grace_until: string | null; grace_reason: string | null;
  decided_at: string | null; decision_reason: string | null;
};

const LAB_STATUSES = new Set(['pending', 'passed', 'failed', 'grace']);

function count(n: unknown): number | null {
  const v = Number(n);
  return Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * One row per week the Lab recorded a window or a status for, in order.
 *
 * `live` is what the Lab's status row says NOW (status and the deliverable
 * counts). `recorded` is the Lab's decision record for the week — when it was
 * decided and why, and any grace it granted — and is null when the Lab has not
 * decided, rather than a made-up decision. A deadline snapshot (what the row
 * said AT the deadline) is not stored anywhere, so `snapshot_recorded` is
 * false on every week and the page says so.
 */
export function milestoneTimeline(windows: WeekWindow[], rows: WeekStatusRow[]) {
  const byWeek = new Map<number, WeekStatusRow>();
  for (const r of rows || []) {
    const n = Number(r.week_number);
    if (Number.isInteger(n) && n >= 1) byWeek.set(n, r);
  }
  const winBy = new Map<number, WeekWindow>();
  for (const w of windows || []) {
    const n = Number(w.week_number);
    if (Number.isInteger(n) && n >= 1) winBy.set(n, w);
  }
  const weeks = [...new Set([...winBy.keys(), ...byWeek.keys()])].sort((a, b) => a - b);
  return weeks.map((n) => {
    const w = winBy.get(n) || null;
    const r = byWeek.get(n) || null;
    const status = r && typeof r.status === 'string' && LAB_STATUSES.has(r.status) ? r.status : null;
    const decided = Boolean(r && (r.decided_at || r.decision_reason));
    const graced = Boolean(r && (r.grace_until || r.grace_reason));
    return {
      week_number: n,
      unlock_at: w?.unlock_at ?? null,
      deadline_at: w?.deadline_at ?? null,
      live: r ? {
        status,
        deliverables_done: count(r.deliverables_done),
        deliverables_required: count(r.deliverables_required),
      } : null,
      recorded: decided || graced ? {
        decided_at: r!.decided_at ?? null,
        decision_reason: r!.decision_reason ?? null,
        grace_until: r!.grace_until ?? null,
        grace_reason: r!.grace_reason ?? null,
      } : null,
      snapshot_recorded: false,
    };
  });
}

export type ActivityInput = {
  questions: Array<{ uid: string; posted_at: string | null; answered_at: string | null }>;
  actions: Array<{ guidance_uid: string; acted_at: string | null }>;
  bookings: Array<{ uid: string; created_at: string | null; status: string | null }>;
};

/**
 * What the founder DID that something recorded, newest first: a question they
 * asked this advisor, an action recorded on this advisor's guidance, a session
 * they booked with this advisor. Nothing is inferred — submissions and Lab
 * decisions are not the founder's recorded actions on this advisor's side.
 */
export function founderActivity(input: ActivityInput, cap = DETAIL_ROW_CAP) {
  const out: Array<{ kind: 'question_asked' | 'guidance_acted_on' | 'session_booked'; at: string; ref: string }> = [];
  for (const q of input.questions || []) if (q.posted_at) out.push({ kind: 'question_asked', at: q.posted_at, ref: `guidance:${q.uid}` });
  for (const a of input.actions || []) if (a.acted_at) out.push({ kind: 'guidance_acted_on', at: a.acted_at, ref: `guidance:${a.guidance_uid}` });
  for (const b of input.bookings || []) if (b.created_at) out.push({ kind: 'session_booked', at: b.created_at, ref: `booking:${b.uid}` });
  const t = (s: string) => { const v = Date.parse(s); return Number.isFinite(v) ? v : 0; };
  out.sort((a, b) => t(b.at) - t(a.at));
  return { truncated: out.length > cap, items: out.slice(0, cap) };
}

/** A count, or not recorded. `truncated` means the read stopped at its cap: the page prints "n+". */
export function countMetric(value: number | null, opts: { truncated?: boolean } = {}) {
  if (value == null || !Number.isFinite(value)) return { value: null, available: false, truncated: false };
  return { value, available: true, truncated: Boolean(opts.truncated) };
}

/**
 * Week completion over the founders VISIBLE to this advisor: per week, how
 * many the Lab recorded passed, in grace, failed or still pending, and how
 * many visible founders have no row for it (not assessed — never counted as
 * not passed).
 */
export function weekCompletion(
  windows: WeekWindow[],
  rows: Array<{ user_id: number; week_number: number; status: string | null }>,
  visible: number[],
) {
  const vis = new Set(visible.map(Number));
  const weeks = new Set<number>();
  for (const w of windows || []) if (Number.isInteger(Number(w.week_number))) weeks.add(Number(w.week_number));
  const per = new Map<number, Map<number, string | null>>();
  for (const r of rows || []) {
    const uid = Number(r.user_id);
    if (!vis.has(uid)) continue;
    const n = Number(r.week_number);
    if (!Number.isInteger(n) || n < 1) continue;
    weeks.add(n);
    if (!per.has(n)) per.set(n, new Map());
    per.get(n)!.set(uid, r.status);
  }
  return [...weeks].sort((a, b) => a - b).map((n) => {
    const m = per.get(n) || new Map<number, string | null>();
    const c = { passed: 0, grace: 0, failed: 0, pending: 0 };
    for (const s of m.values()) if (s && s in c) c[s as keyof typeof c] += 1;
    // No row, or a status the Lab does not use, is not assessed.
    const counted = c.passed + c.grace + c.failed + c.pending;
    return { week_number: n, ...c, not_assessed: Math.max(0, vis.size - counted), founders: vis.size };
  });
}
