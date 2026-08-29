/**
 * T14 — Portfolio Health (snapshots).
 * Mounted at /api/portfolio.
 *
 * Visibility:
 *   admin/investor/partner   -> every project
 *   founder                  -> only projects they own
 *   advisor                   -> 403
 *
 * The recompute endpoints write a fresh snapshot using a lightweight scoring
 * model: traction (deals + tickets + recent activity) + score_snapshots
 * average. The full FastAPI service (`services/portfolio_health.py`) has more
 * signals; this worker port focuses on producing a deterministic score so the
 * dashboard can render — operators can call /recompute to refresh.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isInvestor, isPartner, isFounder, mapError, nowIso, todayIso, newUid, jload } from './_t13t14t15_helpers';
import { computeRadar } from '../services/radar';
import { RADAR_AXES, ensureSkillsTaxonomySchema } from '../services/skillsTaxonomySchema';
import { ensureSkillProfileSchema } from '../services/skillProfileSchema';

const r = new Hono<{ Bindings: Env }>();

type SnapRow = {
  id: number; uid: string; project_id: number; snapshot_date: string;
  score: number; badge: string; intervention: number;
  drivers_json: string; notes: string | null; created_at: string;
};

function canViewDashboard(u: User): boolean {
  return isAdmin(u) || isFounder(u) || isInvestor(u) || isPartner(u);
}

async function visibleProjectIds(env: Env, user: User): Promise<number[] | null> {
  if (isAdmin(user) || isInvestor(user) || isPartner(user)) return null;
  if (isFounder(user)) {
    if (!user.founder_id) return [];
    const rows = await env.DB.prepare('SELECT id FROM projects WHERE founder_id = ? AND deleted_at IS NULL')
      .bind(user.founder_id).all<{ id: number }>();
    return (rows.results || []).map((r) => r.id);
  }
  return [];
}

async function computeScore(env: Env, projectId: number): Promise<{ score: number; drivers: any }> {
  const drivers: any = {};
  // Latest score snapshot
  // `total_score` is the column; `score` is not one. The catch turned that
  // into a null driver on every portfolio row rather than an error.
  const sc = await env.DB.prepare(
    'SELECT total_score FROM score_snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(projectId).first<{ total_score: number }>().catch(() => null);
  drivers.scoring = sc ? Number(sc.total_score) : null;
  // Open vs total tickets
  const t = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open,
       COUNT(*) AS total
     FROM tickets WHERE project_id = ?`
  ).bind(projectId).first<{ open: number; total: number }>().catch(() => null);
  drivers.tickets_open = Number(t?.open || 0);
  drivers.tickets_total = Number(t?.total || 0);
  // Recent activity (last 30 days)
  const thirty = new Date(Date.now() - 30 * 86400000).toISOString();
  const a = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM activity_logs
     WHERE created_at >= ? AND (
       details LIKE ('%project=' || ? || '%') OR details LIKE ('%project_id=' || ? || '%')
     )`
  ).bind(thirty, projectId, projectId).first<{ c: number }>().catch(() => null);
  drivers.activity_30d = Number(a?.c || 0);

  // Compose: scoring 60%, recent activity 30% (capped at 30 events = 100), ticket pressure -10
  const scoringPart = drivers.scoring != null ? Math.max(0, Math.min(100, drivers.scoring)) : 50;
  const activityPart = Math.min(100, drivers.activity_30d * 100 / 30);
  const ticketPressure = drivers.tickets_total > 0
    ? (drivers.tickets_open / drivers.tickets_total) * 100
    : 0;
  let score = Math.round(scoringPart * 0.6 + activityPart * 0.3 - ticketPressure * 0.1);
  if (score < 0) score = 0; if (score > 100) score = 100;
  return { score, drivers };
}

function badgeFor(score: number): { badge: string; intervention: boolean } {
  if (score >= 70) return { badge: 'green', intervention: false };
  if (score >= 40) return { badge: 'yellow', intervention: false };
  return { badge: 'red', intervention: true };
}

function snapDto(s: SnapRow, project?: any): any {
  return {
    id: s.id, uid: s.uid,
    project_id: s.project_id,
    project: project ? {
      id: project.id, uid: project.uid, name: project.name,
      sector: project.sector, stage: project.stage, status: project.status,
    } : undefined,
    snapshot_date: s.snapshot_date,
    score: s.score, badge: s.badge,
    intervention: !!s.intervention,
    drivers: jload(s.drivers_json, {} as any),
    notes: s.notes, created_at: s.created_at,
  };
}

async function upsertSnapshot(env: Env, project: any) {
  const { score, drivers } = await computeScore(env, project.id);
  const { badge, intervention } = badgeFor(score);
  const today = todayIso();
  const uid = newUid();
  // UPSERT on (project_id, snapshot_date)
  await env.DB.prepare(
    `INSERT INTO portfolio_health_snapshots
       (uid, project_id, snapshot_date, score, badge, intervention, drivers_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, snapshot_date) DO UPDATE SET
       score = excluded.score, badge = excluded.badge,
       intervention = excluded.intervention, drivers_json = excluded.drivers_json`
  ).bind(uid, project.id, today, score, badge, intervention ? 1 : 0,
         JSON.stringify(drivers), nowIso()).run();
  const row = await env.DB.prepare(
    'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? AND snapshot_date = ?'
  ).bind(project.id, today).first<SnapRow>();
  return row!;
}

r.get('/health', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewDashboard(user)) return c.json({ detail: 'Forbidden' }, 403);
    const badge = c.req.query('badge');
    const interventionOnly = (c.req.query('intervention_only') || '').toLowerCase() === 'true';
    const visible = await visibleProjectIds(c.env, user);
    let projects: any[];
    if (visible == null) {
      projects = ((await c.env.DB.prepare('SELECT * FROM projects WHERE deleted_at IS NULL').all<any>()).results || []) as any[];
    } else if (visible.length === 0) {
      return c.json({ items: [], as_of: null, totals: { green: 0, yellow: 0, red: 0, intervention: 0 } });
    } else {
      const ph = visible.map(() => '?').join(',');
      projects = ((await c.env.DB.prepare(`SELECT * FROM projects WHERE id IN (${ph}) AND deleted_at IS NULL`).bind(...visible).all<any>()).results || []) as any[];
    }
    const items: any[] = [];
    let asOf: string | null = null;
    for (const p of projects) {
      const row = await c.env.DB.prepare(
        'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 1'
      ).bind(p.id).first<SnapRow>();
      if (!row) continue;
      if (badge && row.badge !== badge) continue;
      if (interventionOnly && !row.intervention) continue;
      items.push(snapDto(row, p));
      if (!asOf || row.snapshot_date > asOf) asOf = row.snapshot_date;
    }
    items.sort((a, b) => (Number(b.intervention) - Number(a.intervention)) || (a.score - b.score));
    return c.json({
      items, as_of: asOf,
      totals: {
        green: items.filter((i) => i.badge === 'green').length,
        yellow: items.filter((i) => i.badge === 'yellow').length,
        red: items.filter((i) => i.badge === 'red').length,
        intervention: items.filter((i) => i.intervention).length,
      },
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/health/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewDashboard(user)) return c.json({ detail: 'Forbidden' }, 403);
    const projectUid = c.req.param('uid');
    const days = Math.max(1, Math.min(365, Number(c.req.query('history_days') || 30)));
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE uid = ? AND deleted_at IS NULL').bind(projectUid).first<any>();
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const visible = await visibleProjectIds(c.env, user);
    if (visible != null && !visible.includes(project.id)) return c.json({ detail: 'Forbidden' }, 403);
    const rows = await c.env.DB.prepare(
      'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT ?'
    ).bind(project.id, days).all<SnapRow>();
    const history = (rows.results || []).map((r) => snapDto(r));
    return c.json({
      project: { uid: project.uid, name: project.name, sector: project.sector, stage: project.stage, status: project.status },
      latest: history[0] || null,
      history,
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/health/recompute', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin only' }, 403);
    const projects = ((await c.env.DB.prepare('SELECT * FROM projects').all<any>()).results || []) as any[];
    let n = 0;
    for (const p of projects) { await upsertSnapshot(c.env, p); n++; }
    return c.json({ ok: true, summary: { projects_scored: n, snapshot_date: todayIso() } });
  } catch (e) { return mapError(c, e); }
});

r.post('/health/recompute/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user) && !isInvestor(user) && !isPartner(user)) {
      return c.json({ detail: 'Admin/partner/investor only' }, 403);
    }
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE uid = ? AND deleted_at IS NULL').bind(c.req.param('uid')).first<any>();
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const row = await upsertSnapshot(c.env, project);
    return c.json(snapDto(row, project));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Task #18 — Partner Coverage Analytics.
//
// GET /coverage[?fund_id=N]
//   Admin/partner-only portfolio-wide skill-gap dashboard. Composes a per-
//   company 8-axis radar (from the radar service, built on each company's
//   founding team) plus a portfolio-level aggregate.
//
//   - Each company's per-axis value is the radar axis `score` (0–100). This is
//     uniform across solo founders and multi-member teams so the aggregate is
//     a clean mean of per-company values.
//   - A "gap axis" is any axis whose score < GAP_THRESHOLD (60), matching the
//     radar service's own coverage-gap cutoff. Companies with ≥3 gap axes are
//     flagged.
//   - The portfolio aggregate per axis = mean of all companies' axis scores
//     (sanity check: aggregate[axis] === mean(companies[].axes[axis])).
// ---------------------------------------------------------------------------
export const GAP_THRESHOLD = 60;
export const MIN_GAP_AXES_TO_FLAG = 3;

// ---------------------------------------------------------------------------
// Pure scoring helpers (exported for unit tests in test/portfolio_coverage.test.ts).
// These encode the heatmap's regression-sensitive rules so a change to the
// radar service, thresholds, or aggregate math is caught pre-merge by the
// drift gate rather than silently breaking the dashboard.
// ---------------------------------------------------------------------------

/** A "gap axis" is any axis whose score is strictly below `threshold`.
 *  Iterates the axes object in insertion order so callers building `axes`
 *  in canonical RADAR_AXES order get a canonically-ordered gap list. */
export function coverageGapAxes(
  axes: Record<string, number>,
  threshold: number = GAP_THRESHOLD,
): string[] {
  const out: string[] = [];
  for (const [slug, score] of Object.entries(axes)) {
    if (score < threshold) out.push(slug);
  }
  return out;
}

/** A company is flagged when it has at least `minToFlag` gap axes. */
export function isFlagged(gapCount: number, minToFlag: number = MIN_GAP_AXES_TO_FLAG): boolean {
  return gapCount >= minToFlag;
}

/** Portfolio aggregate: per-axis mean across all companies, rounded to 2dp.
 *  Returns 0 per axis for an empty portfolio (no divide-by-zero). */
export function aggregateAxes(
  companyAxesList: Array<Record<string, number>>,
  slugs: string[],
): Record<string, number> {
  const n = companyAxesList.length;
  const out: Record<string, number> = {};
  for (const slug of slugs) {
    if (n === 0) { out[slug] = 0; continue; }
    let sum = 0;
    for (const axes of companyAxesList) sum += axes[slug] ?? 0;
    out[slug] = Math.round((sum / n) * 100) / 100;
  }
  return out;
}

/** Validate the optional `fund_id` query param. Empty/undefined means
 *  "all companies" (fundId 0). A non-numeric value is a client error. */
export function validateFundId(
  raw: string | undefined,
): { ok: true; fundId: number } | { ok: false } {
  if (raw === undefined || raw === '') return { ok: true, fundId: 0 };
  if (!/^\d+$/.test(raw)) return { ok: false };
  return { ok: true, fundId: parseInt(raw, 10) };
}

/**
 * Resolve the founding-team user ids for a project: the user(s) linked via
 * `users.founder_id` plus any active cofounder connections. Deterministic
 * (sorted, de-duped). May be empty when no user is linked to the project.
 */
async function projectTeamUserIds(env: Env, project: { id: number; founder_id: number | null }): Promise<number[]> {
  const ids = new Set<number>();
  if (project.founder_id != null) {
    const rows = await env.DB.prepare('SELECT id FROM users WHERE founder_id = ? AND is_active = 1')
      .bind(project.founder_id).all<{ id: number }>().catch(() => ({ results: [] as { id: number }[] }));
    for (const u of (rows.results || [])) ids.add(Number(u.id));
  }
  // Expand with active cofounder connections of the founding user(s).
  if (ids.size > 0) {
    const seed = [...ids];
    const ph = seed.map(() => '?').join(',');
    const conns = await env.DB.prepare(
      `SELECT user_a_id, user_b_id FROM cofounder_connections
       WHERE status = 'active' AND (user_a_id IN (${ph}) OR user_b_id IN (${ph}))`
    ).bind(...seed, ...seed).all<{ user_a_id: number; user_b_id: number }>().catch(() => ({ results: [] as any[] }));
    for (const cc of (conns.results || [])) {
      ids.add(Number(cc.user_a_id));
      ids.add(Number(cc.user_b_id));
    }
  }
  return [...ids].sort((a, b) => a - b);
}

r.get('/coverage', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user) && !isPartner(user)) {
      return c.json({ detail: 'Admin/partner only' }, 403);
    }
    await ensureSkillsTaxonomySchema(c.env);
    await ensureSkillProfileSchema(c.env);

    // Optional fund scoping via fund_reserve_allocations(fund_id, project_id).
    // Validate explicitly rather than silently treating garbage as unscoped:
    // a malformed fund_id is a client error, not "all companies".
    const parsedFund = validateFundId(c.req.query('fund_id'));
    if (!parsedFund.ok) {
      return c.json({ detail: 'fund_id must be a positive integer' }, 400);
    }
    const fundId = parsedFund.fundId;
    let fund: { id: number; name: string } | null = null;
    let projects: { id: number; uid: string; name: string; sector: string | null; stage: string | null; founder_id: number | null }[];

    if (fundId) {
      const f = await c.env.DB.prepare('SELECT id, name FROM vc_funds WHERE id = ?')
        .bind(fundId).first<{ id: number; name: string }>();
      if (!f) return c.json({ detail: 'Fund not found' }, 404);
      fund = { id: f.id, name: f.name };
      const rows = await c.env.DB.prepare(
        `SELECT DISTINCT p.id, p.uid, p.name, p.sector, p.stage, p.founder_id
         FROM projects p
         JOIN fund_reserve_allocations fra ON fra.project_id = p.id
         WHERE fra.fund_id = ? AND p.deleted_at IS NULL
         ORDER BY p.name`
      ).bind(fundId).all<any>();
      projects = (rows.results || []) as any[];
    } else {
      const rows = await c.env.DB.prepare(
        `SELECT id, uid, name, sector, stage, founder_id
         FROM projects WHERE deleted_at IS NULL ORDER BY name`
      ).all<any>();
      projects = (rows.results || []) as any[];
    }

    const axisMeta = RADAR_AXES.map((a) => ({ slug: a.slug, label: a.label }));
    const axisSlugs = RADAR_AXES.map((a) => a.slug);
    const companies: any[] = [];

    for (const p of projects) {
      const teamIds = await projectTeamUserIds(c.env, p);
      const radar = await computeRadar(c.env, teamIds);
      // Map axis slug -> score (0–100), preserving canonical axis order.
      const bySlug = new Map(radar.axes.map((ax) => [ax.slug, ax.score]));
      const axes: Record<string, number> = {};
      for (const a of RADAR_AXES) {
        axes[a.slug] = Math.round(bySlug.get(a.slug) ?? 0);
      }
      const gapAxes = coverageGapAxes(axes, GAP_THRESHOLD);
      companies.push({
        project_id: p.id,
        uid: p.uid,
        name: p.name,
        sector: p.sector || null,
        stage: p.stage || null,
        team_size: teamIds.length,
        has_data: radar.has_data,
        axes,
        gap_axes: gapAxes,
        gap_count: gapAxes.length,
        flagged: isFlagged(gapAxes.length),
        overall: radar.overall,
      });
    }

    const n = companies.length;
    const aggregate = aggregateAxes(companies.map((x) => x.axes), axisSlugs);

    return c.json({
      axes: axisMeta,
      companies,
      aggregate,
      fund,
      company_count: n,
      flagged_count: companies.filter((x) => x.flagged).length,
      gap_threshold: GAP_THRESHOLD,
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
