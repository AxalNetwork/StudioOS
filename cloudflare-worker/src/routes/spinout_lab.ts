/**
 * Spin-Out Lab — 4-week guided sprint for pre-incorporation founders.
 *
 * Mounted at /api/spinout-lab. JWT-auth-gated for every route (no admin
 * escape hatch). The lab is detected from `users.spinout_lab_active`.
 *
 *   GET  /state      → current week, days remaining, milestones, unlocked
 *                       features for the caller
 *   POST /start      → flip the lab on for the caller (idempotent; 409 if
 *                       the caller is already incorporated)
 *   POST /milestone  → mark a milestone done; auto-advances week when the
 *                       current week's bar is fully met. When week 4 is
 *                       met (i.e. `incorporation_completed` is recorded),
 *                       also flips `is_incorporated=1` and turns the lab
 *                       off in the same DB round-trip.
 *   POST /exit       → mark the user incorporated and turn the lab off
 *                       (idempotent; the explicit user-driven escape hatch)
 *
 * The MILESTONES catalog is the single source of truth for what counts
 * toward week advancement and what features the sidebar/dashboard unlocks.
 *
 * Pure-logic functions (`getLabState`, `startLab`, `recordMilestone`,
 * `exitLab`) are exported so the smoke test can drive the full flow
 * against a mocked sql() helper without standing up Hono + JWT.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const spinoutLab = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Catalog — week → required milestone keys + unlocked features.
// `requiredAll` lists keys that MUST all be completed; `requiredAny` (when
// present) is an additional set of which AT LEAST ONE must be completed.
// Week 4's `incorporation_completed` milestone advances the week pointer
// AND triggers the auto-exit branch in `recordMilestone` (flips
// `is_incorporated=1` + lab off). The explicit /exit route remains as a
// user-driven escape hatch with the same effect.
// ---------------------------------------------------------------------------
type WeekDef = {
  week: 1 | 2 | 3 | 4;
  requiredAll: string[];
  requiredAny?: string[];
  unlockedFeatures: string[];
};

export const MILESTONES: WeekDef[] = [
  {
    week: 1,
    requiredAll: [
      'project_created',
      'customer_interview_logged_1',
      'customer_interview_logged_2',
      'customer_interview_logged_3',
    ],
    unlockedFeatures: [
      'spinout-lab',
      'projects',
      'customer-discovery',
      'market-intelligence',
    ],
  },
  {
    week: 2,
    requiredAll: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'],
    unlockedFeatures: ['roadmap', 'brand-builder', 'pitch-deck'],
  },
  {
    week: 3,
    requiredAll: ['scoring_run_completed'],
    requiredAny: ['mentor_meeting_booked', 'cofounder_request_sent'],
    unlockedFeatures: [
      'cofounder-match',
      'mentors',
      'office-hours',
      'scoring',
    ],
  },
  {
    week: 4,
    requiredAll: ['incorporation_completed'],
    unlockedFeatures: [
      'incorporate',
      'captable',
      'section-83b',
      'cofounder-agreement',
      'capital',
      'compliance',
      'kyc',
    ],
  },
];

// Flat allow-list of every milestone key the API will accept, derived from
// the catalog. Anything else is rejected as a client error so a typo can't
// silently land in the DB.
export const VALID_MILESTONE_KEYS = new Set<string>(
  MILESTONES.flatMap((w) => [...w.requiredAll, ...(w.requiredAny ?? [])]),
);

function weekForKey(key: string): number | null {
  for (const w of MILESTONES) {
    if (w.requiredAll.includes(key) || (w.requiredAny ?? []).includes(key)) {
      return w.week;
    }
  }
  return null;
}

/**
 * Decide whether the user has met every requirement for `week`. Pure
 * function over the set of completed keys — used both by the in-handler
 * auto-advance loop and by the tests.
 */
export function weekMet(week: number, completed: Set<string>): boolean {
  const def = MILESTONES.find((w) => w.week === week);
  if (!def) return false;
  if (!def.requiredAll.every((k) => completed.has(k))) return false;
  if (def.requiredAny && def.requiredAny.length > 0) {
    if (!def.requiredAny.some((k) => completed.has(k))) return false;
  }
  return true;
}

/** Cumulative unlocked features through `currentWeek` (inclusive). */
export function unlockedFeaturesThrough(currentWeek: number): string[] {
  const out: string[] = [];
  for (const w of MILESTONES) {
    if (w.week <= currentWeek) out.push(...w.unlockedFeatures);
  }
  return out;
}

/** Days elapsed since `started_at` (UTC). Returns 0 when started_at is null. */
function daysSince(startedAt: string | null | undefined, nowMs = Date.now()): number {
  if (!startedAt) return 0;
  const startMs = Date.parse(
    startedAt.replace(' ', 'T') + (startedAt.includes('Z') ? '' : 'Z'),
  );
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 86_400_000));
}

const SPRINT_DAYS = 28;

// ---------------------------------------------------------------------------
// Pure logic — exported so the test harness can drive the full flow against
// a mocked sql() helper. The wire handlers below are thin wrappers.
// ---------------------------------------------------------------------------

export type LabState = {
  active: boolean;
  week: number;
  days_remaining: number;
  started_at: string | null;
  is_incorporated: boolean;
  milestones: Array<{ key: string; week: number; completed_at: string }>;
  unlocked_features: string[];
};

type Sql = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

// Named union return types — keep these as type aliases (not inline in the
// function signature) so the test harness's brace balancer can slice each
// logic function cleanly. See `cloudflare-worker/test/spinout_lab.test.mjs`.
export type StartResult =
  | { ok: true; state: LabState }
  | { ok: false; status: 409; error: string };

export type MilestoneResult =
  | { ok: true; state: LabState }
  | { ok: false; status: 400 | 409; error: string };

export async function getLabState(sql: Sql, userId: number): Promise<LabState> {
  const rows = await sql`
    SELECT spinout_lab_active, spinout_lab_week, spinout_lab_started_at, is_incorporated
    FROM users WHERE id = ${userId}
  ` as any[];
  const row = rows[0] || {};
  const milestones = await sql`
    SELECT milestone_key AS key, week, completed_at
    FROM spinout_lab_milestones
    WHERE user_id = ${userId}
    ORDER BY week ASC, completed_at ASC
  ` as any[];

  const week = Number(row.spinout_lab_week ?? 1);
  return {
    active: Number(row.spinout_lab_active ?? 0) === 1,
    week,
    days_remaining: Math.max(0, SPRINT_DAYS - daysSince(row.spinout_lab_started_at)),
    started_at: row.spinout_lab_started_at ?? null,
    is_incorporated: Number(row.is_incorporated ?? 0) === 1,
    milestones,
    unlocked_features: unlockedFeaturesThrough(week),
  };
}

export async function startLab(sql: Sql, userId: number): Promise<StartResult> {
  // Refuse to re-open the Lab for users who have already incorporated —
  // the Lab is strictly a pre-incorporation sprint.
  const probe = await sql`
    SELECT is_incorporated FROM users WHERE id = ${userId}
  ` as any[];
  if (probe[0] && Number(probe[0].is_incorporated) === 1) {
    return { ok: false, status: 409, error: 'User is already incorporated' };
  }
  // Idempotent: COALESCE preserves an existing started_at and a non-zero
  // week so re-calling start() doesn't reset progress.
  await sql`
    UPDATE users
    SET spinout_lab_active = 1,
        spinout_lab_week = COALESCE(NULLIF(spinout_lab_week, 0), 1),
        spinout_lab_started_at = COALESCE(spinout_lab_started_at, datetime('now'))
    WHERE id = ${userId}
  `;
  return { ok: true, state: await getLabState(sql, userId) };
}

export async function recordMilestone(
  sql: Sql,
  userId: number,
  rawKey: string,
): Promise<MilestoneResult> {
  const key = (rawKey ?? '').trim();
  if (!key) return { ok: false, status: 400, error: 'milestone_key is required' };
  if (!VALID_MILESTONE_KEYS.has(key)) {
    return { ok: false, status: 400, error: `Unknown milestone_key: ${key}` };
  }
  const week = weekForKey(key);
  if (!week) return { ok: false, status: 400, error: 'milestone_key has no week' };

  // Refuse to record milestones when the lab is off — prevents accidental
  // pollution from a feature page calling complete() after exit().
  const userRows = await sql`
    SELECT spinout_lab_active, spinout_lab_week FROM users WHERE id = ${userId}
  ` as any[];
  const u = userRows[0];
  if (!u || Number(u.spinout_lab_active) !== 1) {
    return { ok: false, status: 409, error: 'Spin-Out Lab is not active' };
  }

  // Idempotent — UNIQUE(user_id, milestone_key) prevents duplicates.
  await sql`
    INSERT OR IGNORE INTO spinout_lab_milestones (user_id, week, milestone_key)
    VALUES (${userId}, ${week}, ${key})
  `;

  // Auto-advance loop. Re-read the milestone set, then walk weeks from the
  // user's current week upward as long as each week is fully met. Cap at
  // week 4. When week 4 is met, also flip `is_incorporated=1` and turn
  // the lab off so the sidebar swaps without an extra round-trip.
  const completed = new Set<string>(
    ((await sql`
      SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ${userId}
    `) as any[]).map((r) => r.milestone_key),
  );

  let newWeek = Number(u.spinout_lab_week ?? 1);
  while (newWeek < 4 && weekMet(newWeek, completed)) {
    newWeek += 1;
  }
  if (newWeek !== Number(u.spinout_lab_week)) {
    await sql`UPDATE users SET spinout_lab_week = ${newWeek} WHERE id = ${userId}`;
  }
  if (newWeek === 4 && weekMet(4, completed)) {
    // Single statement so a partial failure can't half-incorporate the user.
    // SQLite/D1 statement execution is atomic; either both columns flip or
    // neither does. Mirrors the explicit /exit route's effect.
    await sql`
      UPDATE users SET spinout_lab_active = 0, is_incorporated = 1 WHERE id = ${userId}
    `;
  }

  return { ok: true, state: await getLabState(sql, userId) };
}

export async function exitLab(sql: Sql, userId: number): Promise<LabState> {
  // Single statement so a partial failure can't half-incorporate the user.
  await sql`
    UPDATE users
    SET spinout_lab_active = 0, is_incorporated = 1
    WHERE id = ${userId}
  `;
  return getLabState(sql, userId);
}

// ---------------------------------------------------------------------------
// Wire handlers — thin wrappers around the pure logic above.
// ---------------------------------------------------------------------------

spinoutLab.get('/state', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const state = await getLabState(sql, user.id);
  await sql.end();
  return c.json(state);
});

spinoutLab.post('/start', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const r = await startLab(sql, user.id);
  await sql.end();
  if (!r.ok) return c.json({ error: r.error }, r.status);
  return c.json(r.state);
});

spinoutLab.post('/milestone', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const sql = getSQL(c.env);
  const r = await recordMilestone(sql, user.id, body?.milestone_key);
  await sql.end();
  if (!r.ok) return c.json({ error: r.error }, r.status);
  return c.json(r.state);
});

spinoutLab.post('/exit', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const state = await exitLab(sql, user.id);
  await sql.end();
  return c.json(state);
});

export default spinoutLab;
