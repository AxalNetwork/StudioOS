/**
 * T14 — Portfolio Health (snapshots).
 * Mounted at /api/portfolio.
 *
 * Visibility:
 *   admin                    -> every project
 *   partner                  -> ventures where they hold an accepted seat
 *                               (D4636 part 3; the seat rule of D889/D4636's
 *                               update reads, `getMemberProjectIds`)
 *   investor                 -> explicitly related projects only
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
import { investorProjectIds, investorActiveCompany } from './_investorProjectScope';
import { projectInActiveCompany } from '../services/tenancyScope';
import { requireFundGp } from '../services/fundGpAccess';
import { getMemberProjectIds } from '../services/projectAccess';
import { type Scored, healthOf, scorable } from '../services/portfolioHealthSources';

const r = new Hono<{ Bindings: Env }>();

type SnapRow = {
  id: number; uid: string; project_id: number; snapshot_date: string;
  score: number; badge: string; intervention: number;
  drivers_json: string; notes: string | null; created_at: string;
};

function canViewDashboard(u: User): boolean {
  return isAdmin(u) || isFounder(u) || isInvestor(u) || isPartner(u);
}

/**
 * Company scoping, stage 5. Both narrowed branches take the company from
 * `investorActiveCompany`, which verifies the header against
 * `user_company_links` once per request.
 *
 * The FOUNDER branch is narrowed too, and that is not incidental. It inlines
 * its own ownership query, so leaving it alone would mean portfolio health
 * listed projects that the project picker, Validate, Raise and everything else
 * had already stopped showing — an overview disagreeing with every view
 * beneath it. Filtered with `projectInActiveCompany`, the same predicate the
 * five loaders use, so it cannot drift from them.
 *
 * An admin returns null ("portfolio-wide"). D4636 part 3: a partner licence
 * reads the ventures where the caller holds an accepted seat — the rule the
 * update reads use for a partner (`getMemberProjectIds`) — together with what
 * any other licence they hold already shows them. A partner with no seat reads
 * an empty portfolio, as their update list is empty.
 */
async function visibleProjectIds(c: any, user: User): Promise<number[] | null> {
  if (isAdmin(user)) return null;
  const other = await licenceProjectIds(c, user);
  if (!isPartner(user)) return other;
  return [...new Set([...(await getMemberProjectIds(c.env, user.id)), ...other])];
}

/** The investor and founder arms, unchanged by D4636 part 3. */
async function licenceProjectIds(c: any, user: User): Promise<number[]> {
  const env: Env = c.env;
  if (isInvestor(user)) return (await investorProjectIds(env, user, await investorActiveCompany(c, user))) || [];
  if (isFounder(user)) {
    if (!user.founder_id) return [];
    const companyId = await investorActiveCompany(c, user);
    const rows = await env.DB.prepare('SELECT id, company_id FROM projects WHERE founder_id = ? AND deleted_at IS NULL')
      .bind(user.founder_id).all<{ id: number; company_id: number | null }>();
    return (rows.results || []).filter((r) => projectInActiveCompany(companyId, r)).map((r) => r.id);
  }
  return [];
}

/**
 * #4645: a snapshot's age, and whether it is stale.
 *
 * Health is a measurement with a date on it. The list answered with
 * yesterday's row and today's in the same shape, so a company last scored
 * weeks ago read as current. `stale` is one documented threshold, reported
 * with the response so a reader is not left to guess it.
 */
const STALE_AFTER_DAYS = 7;
function staleness(snapshotDate: string, now = Date.now()): { age_days: number | null; stale: boolean | null } {
  const at = Date.parse(`${snapshotDate}T00:00:00Z`);
  if (!Number.isFinite(at)) return { age_days: null, stale: null };
  const age = Math.floor((now - at) / 86_400_000);
  return { age_days: age, stale: age > STALE_AFTER_DAYS };
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

/**
 * #4645 (D4645): a snapshot is written only for a score that was measured.
 *
 * `score` and `badge` are NOT NULL on this table, so an unmeasurable health
 * score has no row to be written to — and inventing one is exactly what the
 * old `: 50` did. A project whose inputs could not be read keeps whatever
 * snapshot it already had (yesterday's measurement stays true of yesterday)
 * and the caller is told why today's is missing, rather than being handed a
 * fabricated one that reads like a measurement.
 *
 * Returns the snapshot row when one was written, and otherwise the scoring's
 * own account of why not.
 */
async function upsertSnapshot(env: Env, project: any): Promise<{ row: SnapRow | null; scored: Scored }> {
  const scored = await healthOf(env, project.id);
  if (!scorable(scored)) return { row: null, scored };
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
  ).bind(uid, project.id, today, scored.score, scored.badge, scored.intervention ? 1 : 0,
         JSON.stringify(scored.drivers), nowIso()).run();
  const row = await env.DB.prepare(
    'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? AND snapshot_date = ?'
  ).bind(project.id, today).first<SnapRow>();
  return { row: row!, scored };
}

r.get('/health', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewDashboard(user)) return c.json({ detail: 'Forbidden' }, 403);
    const badge = c.req.query('badge');
    const interventionOnly = (c.req.query('intervention_only') || '').toLowerCase() === 'true';
    const visible = await visibleProjectIds(c, user);
    let projects: any[];
    if (visible == null) {
      projects = ((await c.env.DB.prepare('SELECT * FROM projects WHERE deleted_at IS NULL').all<any>()).results || []) as any[];
    } else if (visible.length === 0) {
      // #4645: the same shape as the answer below. A caller whose book is
      // empty must not get a response missing half its fields — a reader of
      // `population.projects_visible` or `not_measured` would find undefined
      // here and defined one request later, which is how a contract becomes
      // "whatever the last response happened to carry".
      return c.json({
        items: [], as_of: null, stale_after_days: STALE_AFTER_DAYS,
        totals: { green: 0, yellow: 0, red: 0, intervention: 0, stale: 0, not_measured: 0 },
        not_measured: [], population: { projects_visible: 0, filtered: false },
      });
    } else {
      const ph = visible.map(() => '?').join(',');
      projects = ((await c.env.DB.prepare(`SELECT * FROM projects WHERE id IN (${ph}) AND deleted_at IS NULL`).bind(...visible).all<any>()).results || []) as any[];
    }
    const items: any[] = [];
    let asOf: string | null = null;
    // #4645: a project with no snapshot used to be dropped silently, so the
    // overview's population was "the projects that happen to have been
    // scored" while reading as the portfolio. They are reported apart, by
    // name, with the state the snapshot store is actually in for them.
    const notMeasured: Array<{ uid: string; name: string; state: string; reason: string }> = [];
    const filtered = Boolean(badge) || interventionOnly;
    for (const p of projects) {
      // Find the last different badge, then the first snapshot after it.
      // A single snapshot, or a history with one badge, proves no transition.
      const row = await c.env.DB.prepare(
        `WITH latest AS (
           SELECT * FROM portfolio_health_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 1
         ), previous AS (
           SELECT h.badge, h.snapshot_date FROM portfolio_health_snapshots h
           JOIN latest l ON h.project_id = l.project_id
           WHERE h.badge <> l.badge AND h.snapshot_date < l.snapshot_date
           ORDER BY h.snapshot_date DESC LIMIT 1
         )
         SELECT l.*, p.badge AS previous_status,
           (SELECT MIN(h.snapshot_date) FROM portfolio_health_snapshots h
            WHERE h.project_id = l.project_id AND h.snapshot_date > p.snapshot_date) AS status_changed_at
         FROM latest l LEFT JOIN previous p ON 1 = 1`
      ).bind(p.id).first<SnapRow & { previous_status: string | null; status_changed_at: string | null }>();
      if (!row) {
        // Only when the caller asked for the whole portfolio: a badge filter
        // is a request for a subset, and an unscored project is in no subset.
        if (!filtered) {
          notMeasured.push({
            uid: p.uid, name: p.name, state: 'not_recorded',
            reason: 'Not recorded — this company has no health snapshot yet',
          });
        }
        continue;
      }
      if (badge && row.badge !== badge) continue;
      if (interventionOnly && !row.intervention) continue;
      items.push({ ...snapDto(row, p), ...staleness(row.snapshot_date),
        previous_status: row.previous_status, status_changed_at: row.status_changed_at });
      if (!asOf || row.snapshot_date > asOf) asOf = row.snapshot_date;
    }
    items.sort((a, b) => (Number(b.intervention) - Number(a.intervention)) || (a.score - b.score));
    return c.json({
      items, as_of: asOf,
      // Each item carries its own `snapshot_date` and age, because `as_of` is
      // the NEWEST snapshot in the list and says nothing about the oldest: a
      // forty-day-old row read as current under it.
      stale_after_days: STALE_AFTER_DAYS,
      totals: {
        green: items.filter((i) => i.badge === 'green').length,
        yellow: items.filter((i) => i.badge === 'yellow').length,
        red: items.filter((i) => i.badge === 'red').length,
        intervention: items.filter((i) => i.intervention).length,
        stale: items.filter((i) => i.stale).length,
        not_measured: filtered ? null : notMeasured.length,
      },
      not_measured: filtered ? null : notMeasured,
      /** The population these totals are over: every project the caller may see. */
      population: { projects_visible: projects.length, filtered },
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
    const visible = await visibleProjectIds(c, user);
    if (visible != null && !visible.includes(project.id)) return c.json({ detail: 'Forbidden' }, 403);
    const rows = await c.env.DB.prepare(
      'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT ?'
    ).bind(project.id, days).all<SnapRow>();
    const history = (rows.results || []).map((r) => ({ ...snapDto(r), ...staleness(r.snapshot_date) }));
    return c.json({
      project: { uid: project.uid, name: project.name, sector: project.sector, stage: project.stage, status: project.status },
      latest: history[0] || null,
      history,
      // #4645: `latest: null` meant two different things — this company has
      // never been scored, or its history window holds nothing. The window is
      // stated, so the reader can tell which.
      window: { history_days: days, rows: history.length },
      stale_after_days: STALE_AFTER_DAYS,
      latest_state: history.length
        ? 'recorded'
        : 'not_recorded',
      latest_reason: history.length ? null : 'Not recorded — this company has no health snapshot in this window',
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/health/recompute', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin only' }, 403);
    const projects = ((await c.env.DB.prepare('SELECT * FROM projects').all<any>()).results || []) as any[];
    // #4645: `projects_scored` used to be the number of projects WALKED, not
    // the number scored, so a run in which every read failed reported full
    // success. The two are now counted apart, and each project that could not
    // be scored says which source was at fault.
    let scored = 0;
    const not_scored: Array<{ project_id: number; reason: string }> = [];
    for (const p of projects) {
      const { row, scored: s } = await upsertSnapshot(c.env, p);
      if (row) scored += 1;
      else not_scored.push({ project_id: Number(p.id), reason: s.reason || 'Unreadable' });
    }
    return c.json({
      ok: true,
      summary: {
        projects_seen: projects.length, projects_scored: scored,
        projects_not_scored: not_scored.length, snapshot_date: todayIso(),
      },
      not_scored: not_scored.slice(0, 200),
      not_scored_complete: not_scored.length <= 200,
    });
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
    const visible = await visibleProjectIds(c, user);
    if (visible != null && !visible.includes(Number(project.id))) return c.json({ detail: 'Forbidden' }, 403);
    const { row, scored } = await upsertSnapshot(c.env, project);
    // #4645: a recompute that could not measure says so, with the source that
    // failed and the state of each input, rather than answering with a score
    // nothing measured. 409: the request was understood and nothing is wrong
    // with it — there is simply nothing to state yet.
    if (!row) {
      return c.json({
        detail: scored.reason, code: 'health_not_measurable',
        project: { uid: project.uid, name: project.name },
        sources: (scored.drivers as any).sources,
      }, 409);
    }
    return c.json({ ...snapDto(row, project), sources: (scored.drivers as any).sources });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Task #18 — Partner Coverage Analytics.
//
// GET /coverage[?fund_id=N]
//   Admin/partner-only skill-gap dashboard: an admin reads every venture, a
//   partner the ventures where they hold an accepted seat (D4636 part 3); `fund_id` narrows
//   to one fund only through the fund operating gate (D4636 part 2). Composes a per-
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

// ---------------------------------------------------------------------------
// D464 — the chase (canvas IP2's "Chase all overdue", and the Portfolio
// canvas's per-company Nudge — the same act). An investor asks a silent
// company for its update; the chase is LOGGED (migration 337) and the founder
// is notified. The notification type's settings row is Session 4's to add;
// notify() delivers without it (channels default on, Slack falls through).
// ---------------------------------------------------------------------------

r.get('/chases', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user) && !isInvestor(user)) return c.json({ detail: 'Forbidden' }, 403);
    const visible = await visibleProjectIds(c, user);
    if (visible != null && visible.length === 0) return c.json({ items: [] });
    // An investor reads their own chases; an admin reads the log. Either way
    // the project scope still applies — a chase names a company.
    const rows = await c.env.DB.prepare(
      `SELECT ch.uid, ch.project_id, ch.chased_by, ch.created_at,
              p.name AS project_name, u.name AS chased_by_name
         FROM portfolio_update_chases ch
         LEFT JOIN projects p ON p.id = ch.project_id
         LEFT JOIN users u ON u.id = ch.chased_by
        WHERE (? IS NULL OR ch.chased_by = ?)
        ORDER BY ch.created_at DESC LIMIT 500`
    ).bind(isAdmin(user) ? null : user.id, user.id).all<any>();
    const items = (rows.results || []).filter((r: any) => visible == null || visible.includes(Number(r.project_id)));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.post('/chase', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user) && !isInvestor(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const ids: number[] = Array.isArray(body?.project_ids)
      ? [...new Set<number>((body.project_ids as any[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
      : [];
    if (!ids.length) {
      return c.json({ error: 'chase_targets_required', message: 'Name the companies to chase.' }, 400);
    }
    const visible = await visibleProjectIds(c, user);
    const chased: any[] = [];
    const skipped: number[] = [];
    for (const pid of ids.slice(0, 100)) {
      // The tenancy gate is on the project, not on the page's overdue list.
      if (visible != null && !visible.includes(pid)) { skipped.push(pid); continue; }
      const project = await c.env.DB.prepare('SELECT id, uid, name, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
        .bind(pid).first<any>();
      if (!project) { skipped.push(pid); continue; }
      // A repeat chase inside the hour answers the existing row rather than
      // re-notifying the founder — a double-click is not a second ask.
      const recent = await c.env.DB.prepare(
        `SELECT uid, created_at FROM portfolio_update_chases
          WHERE project_id = ? AND chased_by = ? AND created_at > datetime('now', '-1 hour')
          ORDER BY created_at DESC LIMIT 1`
      ).bind(pid, user.id).first<any>();
      if (recent) {
        chased.push({ project_id: pid, uid: recent.uid, created_at: recent.created_at, already: true });
        continue;
      }
      const uid = newUid();
      const at = nowIso();
      await c.env.DB.prepare(
        'INSERT INTO portfolio_update_chases (uid, project_id, chased_by, created_at) VALUES (?, ?, ?, ?)'
      ).bind(uid, pid, user.id, at).run();
      chased.push({ project_id: pid, uid, created_at: at, already: false });
      // The founder behind the project is notified. Best-effort: the chase
      // row is the record, and a failed notify must not unwrite it.
      try {
        const founders = await c.env.DB.prepare('SELECT id FROM users WHERE founder_id = ? AND is_active = 1')
          .bind(project.founder_id).all<any>();
        const { notify } = await import('../services/notify');
        for (const f of (founders.results || [])) {
          await notify(c.env, {
            userId: f.id,
            type: 'portfolio_update_chase',
            title: `Update requested${project.name ? ` for ${project.name}` : ''}`,
            body: 'Your investor is asking for this period’s update.',
            // D1057 (#2427 finding 6): the founder answers from Grow's Reporting desk (D1056), not the KPI board.
            link: '/grow/reporting',
            payload: { project_id: pid },
            channels: ['in_app', 'email'],
            category: 'portfolio',
          });
        }
      } catch (e) { console.warn('[portfolio] chase notify failed', (e as any)?.message); }
    }
    return c.json({ chased, skipped });
  } catch (e) { return mapError(c, e); }
});

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
      // D4636 part 2: narrowing to one fund reads that fund's reserve plan,
      // which is the fund's own data. It goes through the fund operating gate
      // (`requireFundGp`): an admin, or the fund's GP of record at the
      // institutional tier under the active company; otherwise 402 below the
      // tier, else 404, the same answers as `GET /api/funds/:id`.
      const { fund: f } = await requireFundGp(c, fundId);
      fund = { id: Number(f.id), name: String(f.name) };
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
    // D4636 part 3: a partner reads the ventures where they hold an accepted
    // seat (`getMemberProjectIds`, the update reads' partner rule), with or
    // without a fund filter. No seat, no companies.
    if (!isAdmin(user)) {
      const seats = new Set(await getMemberProjectIds(c.env, user.id));
      projects = projects.filter((p) => seats.has(Number(p.id)));
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
