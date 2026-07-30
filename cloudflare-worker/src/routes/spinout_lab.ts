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
// Catalog moved to a pure module so non-route consumers (advisor
// state machine) can import it without dragging in Hono / db / auth.
// The route's original public surface is preserved by re-export.
import {
  MILESTONES,
  VALID_MILESTONE_KEYS,
  weekForKey,
  weekMet,
  unlockedFeaturesThrough,
} from '../services/spinoutLabCatalog';
// Re-export so existing external imports of these names from this
// module keep working unchanged.
export { MILESTONES, VALID_MILESTONE_KEYS, weekMet, unlockedFeaturesThrough };

const spinoutLab = new Hono<{ Bindings: Env }>();

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

// Concrete row shapes for every SELECT this module issues. Keeps the Sql
// helper's call sites typed without falling back to `any`.
type UserStateRow = {
  spinout_lab_active: number | null;
  spinout_lab_week: number | null;
  spinout_lab_started_at: string | null;
  is_incorporated: number | null;
};
type UserActiveWeekRow = {
  spinout_lab_active: number | null;
  spinout_lab_week: number | null;
};
type IsIncorporatedRow = { is_incorporated: number | null };
type MilestoneRow = { key: string; week: number; completed_at: string };
type MilestoneKeyRow = { milestone_key: string };

// Generic-tagged sql helper: each call site chooses the row type it expects.
// Mirrors the shape of `getSQL(c.env)` from `db.ts` (postgres-style template
// literal) without leaking `any` into the rest of the module.
type SqlValue = string | number | boolean | null;
type Sql = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: SqlValue[]
) => Promise<T[]>;

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
  const rows = await sql<UserStateRow>`
    SELECT spinout_lab_active, spinout_lab_week, spinout_lab_started_at, is_incorporated
    FROM users WHERE id = ${userId}
  `;
  const row: Partial<UserStateRow> = rows[0] ?? {};
  const milestones = await sql<MilestoneRow>`
    SELECT milestone_key AS key, week, completed_at
    FROM spinout_lab_milestones
    WHERE user_id = ${userId}
    ORDER BY week ASC, completed_at ASC
  `;

  const week = Number(row.spinout_lab_week ?? 1);
  return {
    active: Number(row.spinout_lab_active ?? 0) === 1,
    week,
    days_remaining: Math.max(0, SPRINT_DAYS - daysSince(row.spinout_lab_started_at ?? null)),
    started_at: row.spinout_lab_started_at ?? null,
    is_incorporated: Number(row.is_incorporated ?? 0) === 1,
    milestones,
    unlocked_features: unlockedFeaturesThrough(week),
  };
}

export async function startLab(sql: Sql, userId: number): Promise<StartResult> {
  // Refuse to re-open the Lab for users who have already incorporated —
  // the Lab is strictly a pre-incorporation sprint.
  const probe = await sql<IsIncorporatedRow>`
    SELECT is_incorporated FROM users WHERE id = ${userId}
  `;
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
  const userRows = await sql<UserActiveWeekRow>`
    SELECT spinout_lab_active, spinout_lab_week FROM users WHERE id = ${userId}
  `;
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
  const completedRows = await sql<MilestoneKeyRow>`
    SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ${userId}
  `;
  const completed = new Set<string>(completedRows.map((r) => r.milestone_key));

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

// Cohort applications — lazy table ensure (mirrors migration 155) so
// databases that haven't run the migration yet still answer.
let applicationsSchemaEnsured = false;
async function ensureApplicationsTable(env: Env): Promise<void> {
  if (applicationsSchemaEnsured) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS spinout_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        company_name TEXT NOT NULL,
        idea TEXT NOT NULL,
        incorporated TEXT NOT NULL DEFAULT 'no',
        stage TEXT,
        jurisdiction TEXT,
        cohort TEXT NOT NULL DEFAULT 'Cohort 4',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        decided_at TEXT
      )`,
    ).run();
  } catch { /* ignore */ }
  applicationsSchemaEnsured = true;
}

type ApplicationRow = {
  id: number;
  company_name: string;
  incorporated: string;
  stage: string | null;
  jurisdiction: string | null;
  cohort: string;
  status: string;
  created_at: string;
  decided_at: string | null;
};

async function latestApplication(env: Env, userId: number): Promise<ApplicationRow | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT id, company_name, incorporated, stage, jurisdiction, cohort, status, created_at, decided_at
       FROM spinout_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<ApplicationRow>();
    return row ?? null;
  } catch {
    return null; // table not yet migrated
  }
}

spinoutLab.get('/state', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const state = await getLabState(sql, user.id);
  // Task #7 — admission fields. Queried at the wire layer (not inside
  // getLabState) so the pure-logic test harness's exact-SELECT mocks stay
  // untouched, and try/caught so databases predating migration 154 still
  // answer (admitted=false).
  let admitted = false;
  let cohort: string | null = null;
  try {
    const rows = (await sql`
      SELECT spinout_lab_admitted, spinout_lab_cohort FROM users WHERE id = ${user.id}
    `) as Array<{ spinout_lab_admitted: number | null; spinout_lab_cohort: string | null }>;
    admitted = Number(rows[0]?.spinout_lab_admitted ?? 0) === 1;
    cohort = rows[0]?.spinout_lab_cohort ?? null;
  } catch { /* columns not yet migrated */ }
  await sql.end();
  const application = await latestApplication(c.env, user.id);
  return c.json({ ...state, admitted, cohort, application });
});

// POST /apply — submit a cohort application. Signed-in founders only, so no
// contact fields: name/email come from the account. Sends a confirmation
// email (failures logged, never block the submission). One pending
// application at a time; re-apply is allowed after a refusal.
type ApplyBody = {
  company_name?: unknown;
  idea?: unknown;
  incorporated?: unknown;
  stage?: unknown;
  jurisdiction?: unknown;
  cohort?: unknown;
};

spinoutLab.post('/apply', async (c) => {
  const user = await requireAuth(c);
  // Founder and Explorer accounts may apply — the Lab is exactly how an
  // explorer graduates into a founder-track company.
  if (!['founder', 'exploring'].includes((user.role || '').toLowerCase())) {
    return c.json({ error: 'Only founder and explorer accounts can apply to the Lab' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as ApplyBody;
  const company = (typeof body.company_name === 'string' ? body.company_name : '').trim().slice(0, 200);
  const idea = (typeof body.idea === 'string' ? body.idea : '').trim().slice(0, 4000);
  if (!company) return c.json({ error: 'Company / working name is required' }, 400);
  if (!idea) return c.json({ error: 'Please describe your idea or project' }, 400);
  const incorporated = (typeof body.incorporated === 'string' && body.incorporated.toLowerCase() === 'yes') ? 'yes' : 'no';
  const stage = (typeof body.stage === 'string' ? body.stage : '').trim().slice(0, 100) || null;
  const jurisdiction = (typeof body.jurisdiction === 'string' ? body.jurisdiction : '').trim().slice(0, 100) || null;
  const cohort = ((typeof body.cohort === 'string' && body.cohort.trim()) || 'Cohort 4').slice(0, 50);

  await ensureApplicationsTable(c.env);
  try {
    const u = await c.env.DB.prepare(
      `SELECT spinout_lab_admitted FROM users WHERE id = ?`,
    ).bind(user.id).first<{ spinout_lab_admitted: number | null }>();
    if (Number(u?.spinout_lab_admitted ?? 0) === 1) {
      return c.json({ error: 'You are already admitted to the Lab' }, 409);
    }
  } catch { /* admission columns not yet migrated */ }
  const existing = await latestApplication(c.env, user.id);
  if (existing && existing.status === 'pending') {
    return c.json({ error: 'You already have an application in review' }, 409);
  }

  // Conditional insert — the NOT EXISTS guard makes "one pending application
  // per user" atomic, so concurrent submissions can't both pass the pre-check.
  const ins = await c.env.DB.prepare(
    `INSERT INTO spinout_applications (user_id, company_name, idea, incorporated, stage, jurisdiction, cohort)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM spinout_applications WHERE user_id = ? AND status = 'pending'
     )`,
  ).bind(user.id, company, idea, incorporated, stage, jurisdiction, cohort, user.id).run();
  if ((ins.meta?.changes ?? 1) === 0) {
    return c.json({ error: 'You already have an application in review' }, 409);
  }

  let emailed = false;
  try {
    const { send } = await import('../services/email/send');
    const r = await send(c.env, 'spinout_application_received', user.email, {
      name: user.name || 'there',
      company_name: company,
      cohort_label: cohort,
    }, { userId: user.id });
    emailed = !!r?.ok;
  } catch (e) {
    console.error('[spinout-lab/apply] confirmation email failed', e);
  }

  return c.json({ ok: true, emailed, application: await latestApplication(c.env, user.id) });
});

spinoutLab.post('/start', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const r = await startLab(sql, user.id);
  await sql.end();
  if (!r.ok) return c.json({ error: r.error }, r.status);
  return c.json(r.state);
});

type MilestoneBody = { milestone_key?: unknown };

spinoutLab.post('/milestone', async (c) => {
  const user = await requireAuth(c);
  const body = (await c.req.json().catch(() => ({}))) as MilestoneBody;
  const key = typeof body.milestone_key === 'string' ? body.milestone_key : '';
  const sql = getSQL(c.env);
  const r = await recordMilestone(sql, user.id, key);
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

// GET /graduates — PUBLIC (deliberately no requireAuth): powers the
// "Graduate companies." section, which also renders on the logged-out
// marketing page. A graduate is a user with the week-4
// `incorporation_completed` milestone on record — the strongest completion
// signal (the /exit escape hatch flips is_incorporated without finishing
// the sprint, so it does NOT count). Company facts come from the founder's
// project; the cohort application's working name is the fallback. Never
// throws — answers [] when tables predate the Lab migrations. Exposes only
// company-level facts (no founder emails/ids).
type GraduateRow = {
  user_id: number;
  completed_at: string | null;
  cohort: string | null;
  uid: string | null;
  name: string | null;
  sector: string | null;
  stage: string | null;
  status: string | null;
  total_funding: number | null;
  last_funding_round: string | null;
};

spinoutLab.get('/graduates', async (c) => {
  let rows: GraduateRow[] = [];
  try {
    const res = await c.env.DB.prepare(
      `SELECT m.user_id, m.completed_at, u.spinout_lab_cohort AS cohort,
              p.uid, p.name, p.sector, p.stage, p.status, p.total_funding, p.last_funding_round
       FROM spinout_lab_milestones m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN projects p ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       WHERE m.milestone_key = 'incorporation_completed'
       ORDER BY m.completed_at DESC, p.id ASC`,
    ).all<GraduateRow>();
    rows = res.results ?? [];
  } catch {
    return c.json([]);
  }
  type GraduateCard = {
    name: string | null;
    sector: string | null;
    stage: string | null;
    cohort: string | null;
    uid: string | null;
    graduated_at: string | null;
    raised: number | null;
    last_round: string | null;
  };
  // One card per graduate. Founders can have several projects — prefer the
  // first one whose public profile will actually resolve
  // (public.ts GET /startup/:handle 404s archived/rejected/intake projects).
  const byUser = new Map<number, GraduateCard>();
  const order: number[] = [];
  for (const r of rows) {
    const linkable =
      !!r.uid && !['archived', 'rejected', 'intake'].includes(String(r.status || '').toLowerCase());
    const entry: GraduateCard = {
      name: r.name ?? null,
      sector: r.sector ?? null,
      stage: r.stage ?? null,
      cohort: r.cohort ?? null,
      uid: linkable ? r.uid : null,
      graduated_at: r.completed_at ?? null,
      raised: r.total_funding ?? null,
      last_round: r.last_funding_round ?? null,
    };
    const existing = byUser.get(r.user_id);
    if (!existing) {
      byUser.set(r.user_id, entry);
      order.push(r.user_id);
    } else if (existing.uid === null && entry.uid) {
      byUser.set(r.user_id, entry); // upgrade to the publicly linkable project
    }
  }
  const out: GraduateCard[] = [];
  for (const userId of order) {
    const entry = byUser.get(userId)!;
    if (!entry.name) {
      entry.name = (await latestApplication(c.env, userId))?.company_name ?? null;
    }
    if (!entry.name) continue; // nothing real to show for this graduate
    out.push(entry);
    if (out.length >= 12) break;
  }
  return c.json(out);
});

// GET /cohort — PUBLIC (deliberately no requireAuth): powers the "Active
// cohort." live tracker, which also renders on the logged-out marketing
// page. Returns company-level facts only (working name, sector, week, day)
// — never founder names, emails, or ids. Members are users currently in
// the sprint (`spinout_lab_active = 1`); recent graduates (week-4
// `incorporation_completed` within the last 45 days) fill the final
// column. Never throws — answers [] when tables predate the Lab
// migrations.
type CohortActiveRow = {
  user_id: number;
  week: number | null;
  started_at: string | null;
  cohort: string | null;
  name: string | null;
  sector: string | null;
};

type CohortGradRow = {
  user_id: number;
  completed_at: string | null;
  started_at: string | null;
  cohort: string | null;
  name: string | null;
  sector: string | null;
};

type CohortMember = {
  name: string;
  sector: string | null;
  cohort: string | null;
  status: 'active' | 'graduated';
  week: number;
  day: number | null;
  started_at: string | null;
};

spinoutLab.get('/cohort', async (c) => {
  const parseTs = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const ms = Date.parse(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
    return Number.isFinite(ms) ? ms : null;
  };
  const companyName = async (rowName: string | null, userId: number): Promise<string | null> =>
    rowName ?? ((await latestApplication(c.env, userId))?.company_name ?? null);

  const members: CohortMember[] = [];
  const seen = new Set<number>();

  let activeRows: CohortActiveRow[] = [];
  try {
    const res = await c.env.DB.prepare(
      `SELECT u.id AS user_id, u.spinout_lab_week AS week,
              u.spinout_lab_started_at AS started_at, u.spinout_lab_cohort AS cohort,
              p.name, p.sector
       FROM users u
       LEFT JOIN projects p ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       WHERE u.spinout_lab_active = 1
       ORDER BY u.spinout_lab_started_at ASC, p.id ASC`,
    ).all<CohortActiveRow>();
    activeRows = res.results ?? [];
  } catch {
    return c.json([]);
  }
  for (const r of activeRows) {
    if (seen.has(r.user_id)) continue; // several projects: keep the first
    seen.add(r.user_id);
    const name = await companyName(r.name, r.user_id);
    if (!name) continue;
    const week = Math.max(1, Math.min(4, Number(r.week ?? 1) || 1));
    members.push({
      name,
      sector: r.sector ?? null,
      cohort: r.cohort ?? null,
      status: 'active',
      week,
      day: Math.min(SPRINT_DAYS, daysSince(r.started_at) + 1),
      started_at: r.started_at ?? null,
    });
    if (members.length >= 24) break;
  }

  // Recent graduates fill the final ("Incorporated") column.
  let gradRows: CohortGradRow[] = [];
  try {
    const res = await c.env.DB.prepare(
      `SELECT m.user_id, m.completed_at, u.spinout_lab_started_at AS started_at,
              u.spinout_lab_cohort AS cohort, p.name, p.sector
       FROM spinout_lab_milestones m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN projects p ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       WHERE m.milestone_key = 'incorporation_completed'
         AND datetime(m.completed_at) >= datetime('now', '-45 days')
       ORDER BY m.completed_at DESC, p.id ASC`,
    ).all<CohortGradRow>();
    gradRows = res.results ?? [];
  } catch {
    gradRows = [];
  }
  const gradSeen = new Set<number>();
  for (const r of gradRows) {
    if (gradSeen.has(r.user_id) || seen.has(r.user_id)) continue;
    gradSeen.add(r.user_id);
    const name = await companyName(r.name, r.user_id);
    if (!name) continue;
    const startMs = parseTs(r.started_at);
    const doneMs = parseTs(r.completed_at);
    const day =
      startMs !== null && doneMs !== null && doneMs >= startMs
        ? Math.max(1, Math.floor((doneMs - startMs) / 86_400_000) + 1)
        : null;
    members.push({
      name,
      sector: r.sector ?? null,
      cohort: r.cohort ?? null,
      status: 'graduated',
      week: 5,
      day,
      started_at: r.started_at ?? null,
    });
    if (gradSeen.size >= 8) break;
  }
  return c.json(members);
});

export default spinoutLab;
