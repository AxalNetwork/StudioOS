/**
 * Portfolio cap-table / ownership view (Support stage).
 *
 * Records the fund's round-by-round positions (dilution over time) in
 * `portfolio_positions`, and reuses the existing `cap_table_holders` snapshot
 * (Carta integration, migration 020) for the current holder breakdown. Founders
 * have /build/captable; investors had no equivalent — this closes that gap.
 *
 * Mounted at /api/positions. Added to STUDIO_PREFIXES so founders get a 402;
 * admin/investor bypass the studio gate and are narrowed here via canViewLpData.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireAdmin, canViewLpData } from '../auth';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';
import {
  computeFundMetrics, rollUpPosition, currentPeriod, daysSince,
  type CashFlow, type KpiCadence,
} from '../services/portfolioMetrics';
import { investorProjectIds } from './_investorProjectScope';

const r = new Hono<{ Bindings: Env }>();

type PositionRow = {
  id: number; uid: string; fund_id: number | null; project_id: number;
  round_name: string; invested_amount: number; shares: number | null;
  price_per_share: number | null; ownership_pct: number | null; position_date: string | null;
  created_by: number | null; created_at: string; updated_at: string;
};

function num(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD, validated. Dates drive IRR, so a malformed one is a 400. */
function isoDate(v: any): string | null {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) ? s : null;
}

const MARK_BASES = new Set(['round_price', 'secondary', 'gp_estimate', 'write_down', 'cost']);
const DIST_KINDS = new Set(['exit', 'secondary', 'dividend', 'recapitalization']);

/**
 * Latest mark per project (build queue #125). One grouped query rather
 * than per-project lookups — the old per-row pattern here was an N+1.
 */
async function latestMarksByProject(env: Env, projectIds: number[] | null = null): Promise<Map<number, { fmv: number; as_of_date: string; basis: string }>> {
  const scopeCsv = projectIds == null ? null : projectIds.join(',');
  const rows = await env.DB.prepare(
    `SELECT m.project_id, m.fmv, m.as_of_date, m.basis
       FROM portfolio_marks m
       JOIN (SELECT project_id, MAX(as_of_date) AS d FROM portfolio_marks GROUP BY project_id) latest
         ON latest.project_id = m.project_id AND latest.d = m.as_of_date
       WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(m.project_id AS TEXT) || ',') > 0)
       GROUP BY m.project_id`,
  ).bind(scopeCsv, scopeCsv).all<any>().catch(() => ({ results: [] as any[] }));
  const out = new Map<number, { fmv: number; as_of_date: string; basis: string }>();
  for (const row of (rows.results || [])) {
    out.set(Number(row.project_id), {
      fmv: Number(row.fmv) || 0,
      as_of_date: String(row.as_of_date),
      basis: String(row.basis || 'gp_estimate'),
    });
  }
  return out;
}

// GET /api/positions — portfolio ownership summary (one row per project)
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const projectIds = await investorProjectIds(c.env, user);
    const scopeCsv = projectIds == null ? null : projectIds.join(',');
    // Single grouped query joined to projects, replacing the previous
    // two-queries-per-project loop (N+1) that would not scale past a
    // handful of holdings.
    const rows = await c.env.DB.prepare(
      `SELECT p.project_id,
              SUM(p.invested_amount) AS total_invested,
              COUNT(*) AS rounds,
              MAX(p.position_date) AS latest_date,
              MIN(COALESCE(p.position_date, p.created_at)) AS first_date,
              pr.id AS proj_id, pr.uid AS proj_uid, pr.name AS proj_name,
              pr.sector AS proj_sector, pr.stage AS proj_stage, pr.status AS proj_status
         FROM portfolio_positions p
         LEFT JOIN projects pr ON pr.id = p.project_id AND pr.deleted_at IS NULL
        WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0)
        GROUP BY p.project_id`
    ).bind(scopeCsv, scopeCsv).all<any>();
    // Latest ownership/round per project, also in one pass.
    const latestRows = await c.env.DB.prepare(
      `SELECT p.project_id, p.ownership_pct, p.round_name
         FROM portfolio_positions p
         JOIN (SELECT project_id, MAX(COALESCE(position_date, created_at)) AS d
                 FROM portfolio_positions GROUP BY project_id) l
           ON l.project_id = p.project_id AND l.d = COALESCE(p.position_date, p.created_at)
         WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0)
         GROUP BY p.project_id`
    ).bind(scopeCsv, scopeCsv).all<any>();
    const latestBy = new Map<number, any>();
    for (const l of (latestRows.results || [])) latestBy.set(Number(l.project_id), l);
    const marks = await latestMarksByProject(c.env, projectIds);

    const items = (rows.results || []).map((row: any) => {
      const pid = Number(row.project_id);
      const latest = latestBy.get(pid);
      const mark = marks.get(pid) || null;
      const invested = Number(row.total_invested) || 0;
      const roll = rollUpPosition(invested, mark ? mark.fmv : null);
      return {
        project_id: pid,
        project: row.proj_id
          ? { id: row.proj_id, uid: row.proj_uid, name: row.proj_name, sector: row.proj_sector, stage: row.proj_stage, status: row.proj_status }
          : null,
        total_invested: invested,
        rounds: Number(row.rounds) || 0,
        latest_ownership_pct: latest?.ownership_pct ?? null,
        latest_round: latest?.round_name ?? null,
        latest_date: row.latest_date || null,
        // Vintage = year of first cheque, so cohort analysis is derived
        // from real position dates rather than a hand-kept field.
        vintage: row.first_date ? Number(String(row.first_date).slice(0, 4)) || null : null,
        // #125 — carrying value. `unmarked: true` means we are showing
        // cost because no mark exists; the UI must say so rather than
        // presenting cost as a valuation.
        fmv: roll.fmv,
        multiple: roll.multiple,
        marked_down: roll.marked_down,
        unmarked: roll.unmarked,
        mark_as_of: mark?.as_of_date ?? null,
        mark_basis: mark?.basis ?? null,
      };
    });
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// GET /api/positions/analytics — accessible-book performance (build queue #125)
//
// Metrics computed from positions visible to this caller:
// holds: cost basis from portfolio_positions (dated by position_date),
// realisations from portfolio_distributions, carrying value from the
// latest portfolio_marks row per project. Everything is GROSS of fees
// and carry — `basis: 'gross'` rides along in the payload so the UI
// cannot silently present these as net-to-LP figures.
r.get('/analytics', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const projectIds = await investorProjectIds(c.env, user);
    const scopeCsv = projectIds == null ? null : projectIds.join(',');
    const today = isoDate(c.req.query('as_of')) || new Date().toISOString().slice(0, 10);

    const [positions, distributions, marks] = await Promise.all([
      c.env.DB.prepare(
        `SELECT project_id, invested_amount, position_date, created_at
           FROM portfolio_positions
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(project_id AS TEXT) || ',') > 0)`,
      ).bind(scopeCsv, scopeCsv).all<any>(),
      c.env.DB.prepare(
        `SELECT project_id, amount, distribution_date
           FROM portfolio_distributions
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(project_id AS TEXT) || ',') > 0)`,
      ).bind(scopeCsv, scopeCsv).all<any>().catch(() => ({ results: [] as any[] })),
      latestMarksByProject(c.env, projectIds),
    ]);

    const flows: CashFlow[] = [];
    const investedByProject = new Map<number, number>();
    for (const p of (positions.results || [])) {
      const amount = Number(p.invested_amount) || 0;
      if (amount <= 0) continue;
      const pid = Number(p.project_id);
      investedByProject.set(pid, (investedByProject.get(pid) || 0) + amount);
      const date = isoDate(p.position_date) || isoDate(p.created_at);
      if (date) flows.push({ date, amount, kind: 'contribution' });
    }
    for (const d of (distributions.results || [])) {
      const amount = Number(d.amount) || 0;
      const date = isoDate(d.distribution_date);
      if (amount > 0 && date) flows.push({ date, amount, kind: 'distribution' });
    }

    // NAV = Σ carrying value. Unmarked positions carry at cost.
    let nav = 0;
    let unmarkedCount = 0;
    for (const [pid, invested] of investedByProject) {
      const mark = marks.get(pid);
      const roll = rollUpPosition(invested, mark ? mark.fmv : null);
      nav += roll.fmv;
      if (roll.unmarked) unmarkedCount++;
    }

    const metrics = computeFundMetrics(flows, nav, today);
    return c.json({
      ...metrics,
      position_count: investedByProject.size,
      unmarked_position_count: unmarkedCount,
      // Coverage is the honesty dial on the whole payload: with a low
      // mark coverage, NAV is mostly cost and TVPI approaches 1.0 for
      // reasons that have nothing to do with performance.
      mark_coverage: investedByProject.size > 0
        ? Math.round(((investedByProject.size - unmarkedCount) / investedByProject.size) * 100) / 100
        : null,
    });
  } catch (e) { return mapError(c, e); }
});

// GET /api/positions/kpi-compliance — who has reported this period (#125)
//
// Compliance is DERIVED from portfolio_updates rather than tracked in a
// second table: a company is compliant for the period when it has a
// submitted update whose `period` matches. One reporting channel.
r.get('/kpi-compliance', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const projectIds = await investorProjectIds(c.env, user);
    const scopeCsv = projectIds == null ? null : projectIds.join(',');
    const cadence: KpiCadence = c.req.query('cadence') === 'monthly' ? 'monthly' : 'quarterly';
    const today = isoDate(c.req.query('as_of')) || new Date().toISOString().slice(0, 10);
    const period = currentPeriod(cadence, today);

    const [defs, held, updates] = await Promise.all([
      c.env.DB.prepare(
        `SELECT kpi_key, name, definition, unit, cadence, required, applies_to, sort_order
           FROM portfolio_kpi_definitions
          WHERE fund_id IS NULL AND cadence = ?
          ORDER BY sort_order`,
      ).bind(cadence).all<any>().catch(() => ({ results: [] as any[] })),
      c.env.DB.prepare(
        `SELECT DISTINCT p.project_id, pr.uid, pr.name
           FROM portfolio_positions p
           LEFT JOIN projects pr ON pr.id = p.project_id AND pr.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0)`,
      ).bind(scopeCsv, scopeCsv).all<any>(),
      c.env.DB.prepare(
        `SELECT project_id, period, MAX(COALESCE(submitted_at, updated_at)) AS last_at
           FROM portfolio_updates
          WHERE status = 'submitted'
            AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(project_id AS TEXT) || ',') > 0)
          GROUP BY project_id, period`,
      ).bind(scopeCsv, scopeCsv).all<any>().catch(() => ({ results: [] as any[] })),
    ]);

    const thisPeriod = new Set<number>();
    const lastSeen = new Map<number, string>();
    for (const u of (updates.results || [])) {
      const pid = Number(u.project_id);
      if (period && String(u.period || '') === period) thisPeriod.add(pid);
      const at = String(u.last_at || '').slice(0, 10);
      const prev = lastSeen.get(pid);
      if (at && (!prev || at > prev)) lastSeen.set(pid, at);
    }

    const companies = (held.results || []).map((h: any) => {
      const pid = Number(h.project_id);
      const last = lastSeen.get(pid) || null;
      return {
        project_id: pid,
        project_uid: h.uid || null,
        name: h.name || `Startup ${pid}`,
        reported: thisPeriod.has(pid),
        last_reported_at: last,
        days_since_report: daysSince(last, today),
      };
    });
    const reported = companies.filter(x => x.reported).length;

    return c.json({
      cadence,
      period,
      as_of: today,
      kpi_set: defs.results || [],
      companies,
      reported_count: reported,
      total_count: companies.length,
      compliance_pct: companies.length > 0 ? Math.round((reported / companies.length) * 100) : null,
    });
  } catch (e) { return mapError(c, e); }
});

// GET /api/positions/:projectUid — round history + current cap-table snapshot
r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const proj = await c.env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE uid = ? AND deleted_at IS NULL').bind(c.req.param('projectUid')).first<any>();
    if (!proj) return c.json({ detail: 'Not found' }, 404);
    const projectIds = await investorProjectIds(c.env, user);
    if (projectIds != null && !projectIds.includes(Number(proj.id))) return c.json({ detail: 'Forbidden' }, 403);
    const rounds = await c.env.DB.prepare(
      'SELECT * FROM portfolio_positions WHERE project_id = ? ORDER BY COALESCE(position_date, created_at) ASC'
    ).bind(proj.id).all<PositionRow>();
    const holders = await c.env.DB.prepare(
      'SELECT name, security_type, shares, ownership_pct, source FROM cap_table_holders WHERE project_id = ? ORDER BY ownership_pct DESC'
    ).bind(proj.id).all<any>().catch(() => ({ results: [] }));
    // #125 — mark history + realisations for the position-detail view.
    const [markRows, distRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT uid, as_of_date, fmv, post_money, event, basis, source, note
           FROM portfolio_marks WHERE project_id = ? ORDER BY as_of_date DESC`,
      ).bind(proj.id).all<any>().catch(() => ({ results: [] as any[] })),
      c.env.DB.prepare(
        `SELECT uid, distribution_date, amount, kind, note
           FROM portfolio_distributions WHERE project_id = ? ORDER BY distribution_date DESC`,
      ).bind(proj.id).all<any>().catch(() => ({ results: [] as any[] })),
    ]);
    const marks = markRows.results || [];
    const invested = (rounds.results || []).reduce((a: number, x: any) => a + (Number(x.invested_amount) || 0), 0);
    const roll = rollUpPosition(invested, marks.length > 0 ? Number(marks[0].fmv) : null);
    return c.json({
      project: proj,
      rounds: rounds.results || [],
      cap_table_snapshot: holders.results || [],
      marks,
      distributions: distRows.results || [],
      rollup: {
        ...roll,
        distributed: (distRows.results || []).reduce((a: number, d: any) => a + (Number(d.amount) || 0), 0),
        latest_mark_as_of: marks.length > 0 ? marks[0].as_of_date : null,
        latest_mark_basis: marks.length > 0 ? marks[0].basis : null,
      },
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/positions/:projectUid/marks — record a valuation mark (#125)
//
// Admin-only, matching the existing position write path: a mark moves
// every LP-facing number on the page, so it is not a self-serve write.
r.post('/:projectUid/marks', async (c) => {
  try {
    const user = await requireAdmin(c);
    const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number }>();
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const fmv = num(body.fmv);
    const asOf = isoDate(body.as_of_date);
    if (fmv == null || fmv < 0) return c.json({ detail: 'fmv is required and must be >= 0' }, 400);
    if (!asOf) return c.json({ detail: 'as_of_date is required (YYYY-MM-DD)' }, 400);
    const basis = String(body.basis || 'gp_estimate');
    if (!MARK_BASES.has(basis)) return c.json({ detail: `basis must be one of: ${[...MARK_BASES].join(', ')}` }, 400);

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, post_money, event, basis, source, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uid, body.fund_id != null ? Number(body.fund_id) : null, proj.id, asOf, fmv,
      num(body.post_money), body.event ? String(body.event).slice(0, 120) : null,
      basis, body.source ? String(body.source).slice(0, 200) : null,
      body.note ? String(body.note).slice(0, 2000) : null,
      user.id, nowIso(), nowIso(),
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_marks WHERE uid = ?').bind(uid).first<any>();
    return c.json(fresh, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /api/positions/:projectUid/distributions — record a realisation (#125)
r.post('/:projectUid/distributions', async (c) => {
  try {
    const user = await requireAdmin(c);
    const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number }>();
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const amount = num(body.amount);
    const date = isoDate(body.distribution_date);
    if (amount == null || amount <= 0) return c.json({ detail: 'amount is required and must be > 0' }, 400);
    if (!date) return c.json({ detail: 'distribution_date is required (YYYY-MM-DD)' }, 400);
    const kind = String(body.kind || 'exit');
    if (!DIST_KINDS.has(kind)) return c.json({ detail: `kind must be one of: ${[...DIST_KINDS].join(', ')}` }, 400);

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO portfolio_distributions (uid, fund_id, project_id, distribution_date, amount, kind, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uid, body.fund_id != null ? Number(body.fund_id) : null, proj.id, date, amount, kind,
      body.note ? String(body.note).slice(0, 2000) : null, user.id, nowIso(), nowIso(),
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_distributions WHERE uid = ?').bind(uid).first<any>();
    return c.json(fresh, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /api/positions — record a round position (admin only)
r.post('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    const roundName = body.round_name ? String(body.round_name).slice(0, 64) : null;
    if (!Number.isFinite(projectId) || !roundName) return c.json({ detail: 'project_id and round_name required' }, 400);
    const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ id: number }>();
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, shares, price_per_share, ownership_pct, position_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid, body.fund_id != null ? Number(body.fund_id) : null, projectId, roundName,
      num(body.invested_amount) ?? 0, num(body.shares), num(body.price_per_share), num(body.ownership_pct),
      body.position_date ? String(body.position_date).slice(0, 32) : null,
      user.id, nowIso(), nowIso(),
    ).run();
    const x = await c.env.DB.prepare('SELECT * FROM portfolio_positions WHERE id = ?').bind((ins as any).meta?.last_row_id).first<PositionRow>();
    return c.json(x, 201);
  } catch (e) { return mapError(c, e); }
});

// PUT /api/positions/:uid — edit a round position (admin only)
r.put('/:uid', async (c) => {
  try {
    await requireAdmin(c);
    const x = await c.env.DB.prepare('SELECT * FROM portfolio_positions WHERE uid = ?').bind(c.req.param('uid')).first<PositionRow>();
    if (!x) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    await c.env.DB.prepare(
      `UPDATE portfolio_positions SET fund_id=?, round_name=?, invested_amount=?, shares=?, price_per_share=?, ownership_pct=?, position_date=?, updated_at=? WHERE id=?`
    ).bind(
      body.fund_id !== undefined ? (body.fund_id != null ? Number(body.fund_id) : null) : x.fund_id,
      body.round_name !== undefined ? (body.round_name ? String(body.round_name).slice(0, 64) : x.round_name) : x.round_name,
      body.invested_amount !== undefined ? (num(body.invested_amount) ?? 0) : x.invested_amount,
      body.shares !== undefined ? num(body.shares) : x.shares,
      body.price_per_share !== undefined ? num(body.price_per_share) : x.price_per_share,
      body.ownership_pct !== undefined ? num(body.ownership_pct) : x.ownership_pct,
      body.position_date !== undefined ? (body.position_date ? String(body.position_date).slice(0, 32) : null) : x.position_date,
      nowIso(), x.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_positions WHERE id = ?').bind(x.id).first<PositionRow>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

export default r;
