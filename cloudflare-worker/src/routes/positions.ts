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
 *
 * Who reads which rows (D1057, D4636 parts 2 and 3), evaluated per request:
 *   admin       every recorded position
 *   holder      every round recorded in a company they hold through a
 *               confirmed commitment (`investorHeldProjectIds`), company-scoped
 *   GP of record  the rounds attributed to the funds they run
 *               (`managedFundIds`: institutional tier, GP of record, active
 *               company), with those funds' marks and distributions and the
 *               firm-level marks of the same companies
 * A company the caller both holds and reaches as GP reads as held.
 * Part 4: the five reads admit a GP of record without an investor licence to
 * their funds' companies only (no held rows); a caller with neither the
 * licence nor a fund is 403, as before. Writes stay admin-only.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin, canViewLpData } from '../auth';
import { assertAdminAct } from '../services/fundAdminAccess';
import { logAdminAction } from '../services/adminAudit';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';
import {
  computeFundMetrics, rollUpPosition, completedPeriod, currentPeriod, daysSince, periodBounds,
  periodComplete, periodCounts,
  type CashFlow, type KpiCadence,
} from '../services/portfolioMetrics';
import { latestProjectMarks, carryingValue, MARK_UNAVAILABLE_REASONS } from '../services/portfolioValuation';
import { HELD_SCOPE, investorHeldProjectIds, investorActiveCompany } from './_investorProjectScope';
import { managedFundIds } from '../services/fundGpAccess';

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
 *
 * D4644 (#4644): the selection itself moved to
 * `services/portfolioValuation.ts`, so this read, the fund board and the
 * fund's performance read all pick the same record. The old query here took
 * `MAX(as_of_date)` and then read bare columns, so a mark corrected for the
 * same effective date was resolved by SQLite's arbitrary choice of row; and it
 * ignored `fund_id`, so one fund's mark could price another fund's position.
 * Both are now decided by the documented rule. These two investor reads are
 * the project-level aggregate, hence the `firm` scope.
 */
async function latestMarksByProject(env: Env, projectIds: number[] | null = null, asOf: string | null = null) {
  return latestProjectMarks(env, { projectIds, asOf, scope: { kind: 'firm' } });
}

/**
 * D4636 part 3: what a caller of these reads may see.
 *
 * `held` is D1057's company scope, unchanged: null for an admin (every
 * position), else the companies the caller holds. `funds` is the GP arm: the
 * funds the fund operating gate lets this caller run, so a GP who is
 * reassigned, drops below the institutional tier or switches active company
 * loses the arm on the next read. `gpOnly` is the companies reached through
 * that arm alone, where the caller reads their funds' rows and not the whole
 * company. The CSVs feed the bound `instr` predicates below.
 *
 * D4636 part 4: the scope is also the licence gate of the five reads. A caller
 * who passes `canViewLpData` (admin or an investor licence) is scoped as in
 * part 3. A caller who fails it but runs at least one fund is admitted to
 * their funds' companies only: `held` is forced to [] rather than read, because
 * `investorHeldProjectIds` answers null ("every row") for a caller without the
 * investor licence. Anyone else gets null, which each read answers with 403.
 */
type PositionScope = {
  held: number[] | null;
  funds: number[];
  gpOnly: number[];
  heldCsv: string | null;
  fundCsv: string;
  gpOnlyCsv: string;
  /** Every company the caller sees, or null for every company. */
  visibleCsv: string | null;
};

async function positionScope(c: any, user: any): Promise<PositionScope | null> {
  const licensed = canViewLpData(user);
  // Never the held read without the licence: it is null, every row, for a non-investor.
  const held = licensed ? await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user)) : [];
  if (held == null) {
    return { held: null, funds: [], gpOnly: [], heldCsv: null, fundCsv: '', gpOnlyCsv: '', visibleCsv: null };
  }
  const funds = await managedFundIds(c, user);
  if (!licensed && funds.length === 0) return null;
  let gpOnly: number[] = [];
  if (funds.length > 0) {
    const fundCsv = funds.join(',');
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT project_id FROM portfolio_positions
        WHERE instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0`,
    ).bind(fundCsv).all();
    const heldSet = new Set(held);
    gpOnly = ((rows.results || []) as Array<{ project_id: number }>)
      .map((r) => Number(r.project_id)).filter((id) => Number.isFinite(id) && !heldSet.has(id));
  }
  return {
    held, funds, gpOnly,
    heldCsv: held.join(','),
    fundCsv: funds.join(','),
    gpOnlyCsv: gpOnly.join(','),
    visibleCsv: [...held, ...gpOnly].join(','),
  };
}

/**
 * The carrying-value mark per company under a position scope. A held company
 * (or every company, for an admin) keeps the firm scope these reads always
 * used. A company reached only as GP reads the marks of the funds the caller
 * runs and the firm-level ones (`latestProjectMarks`' fund scope, per fund),
 * merged by the same precedence: the newer effective date wins; on one date a
 * fund's own mark beats a firm-level one; two of the caller's funds with
 * marks on one date are a conflict, as in the firm scope.
 */
async function scopedLatestMarks(env: Env, scope: PositionScope, asOf: string | null) {
  const out = await latestMarksByProject(env, scope.held, asOf);
  if (scope.gpOnly.length === 0) return out;
  const gp = new Map<number, any>();
  for (const fundId of scope.funds) {
    const marks = await latestProjectMarks(env, { projectIds: scope.gpOnly, asOf, scope: { kind: 'fund', fundId } });
    for (const [pid, mark] of marks) {
      const held = gp.get(pid);
      if (!held || mark.as_of_date > held.as_of_date) { gp.set(pid, mark); continue; }
      if (mark.as_of_date < held.as_of_date || mark.fund_id == null) continue;
      if (held.fund_id == null) { gp.set(pid, mark); continue; }
      if (mark.fund_id !== held.fund_id) gp.set(pid, { ...held, conflict: 'fund_marks_conflict' });
    }
  }
  for (const [pid, mark] of gp) out.set(pid, mark);
  return out;
}

/** The fund-scope statement a list carries when the GP arm contributed rows. */
function gpScopeStatement(scope: PositionScope) {
  if (scope.funds.length === 0) return null;
  return {
    rule: 'gp_of_record',
    fund_ids: scope.funds,
    text: 'Positions attributed to the funds you run as general partner of record.',
  };
}

// GET /api/positions — portfolio ownership summary (one row per project)
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const scope = await positionScope(c, user);
    if (!scope) return c.json({ detail: 'Forbidden' }, 403);
    // D4644: this list honours `as_of` the way the metrics read below already
    // did. Before, the list always used the latest mark ever recorded while the
    // metrics beside it used the mark as of the requested date, so one page
    // could show a position and the totals priced on different days.
    const listAsOf = isoDate(c.req.query('as_of'));
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
        WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0
               OR instr(',' || ? || ',', ',' || CAST(p.fund_id AS TEXT) || ',') > 0)
        GROUP BY p.project_id`
    ).bind(scope.heldCsv, scope.heldCsv, scope.fundCsv).all<any>();
    // Latest ownership/round per project, also in one pass, over the same rows:
    // for a company read as GP, the latest of their funds' rounds.
    const latestRows = await c.env.DB.prepare(
      `SELECT p.project_id, p.ownership_pct, p.round_name
         FROM portfolio_positions p
         JOIN (SELECT q.project_id, MAX(COALESCE(q.position_date, q.created_at)) AS d
                 FROM portfolio_positions q
                WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(q.project_id AS TEXT) || ',') > 0
                       OR instr(',' || ? || ',', ',' || CAST(q.fund_id AS TEXT) || ',') > 0)
                GROUP BY q.project_id) l
           ON l.project_id = p.project_id AND l.d = COALESCE(p.position_date, p.created_at)
         WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0
                OR instr(',' || ? || ',', ',' || CAST(p.fund_id AS TEXT) || ',') > 0)
         GROUP BY p.project_id`
    ).bind(scope.heldCsv, scope.heldCsv, scope.fundCsv, scope.heldCsv, scope.heldCsv, scope.fundCsv).all<any>();
    const latestBy = new Map<number, any>();
    for (const l of (latestRows.results || [])) latestBy.set(Number(l.project_id), l);
    const marks = await scopedLatestMarks(c.env, scope, listAsOf);

    const items = (rows.results || []).map((row: any) => {
      const pid = Number(row.project_id);
      const latest = latestBy.get(pid);
      const mark = marks.get(pid) || null;
      const invested = Number(row.total_invested) || 0;
      // D4644: a mark the scope cannot choose between (two funds, one effective
      // date) is not a carrying value, so the position carries at cost and says
      // which of the two reasons applies.
      const carried = carryingValue(mark);
      const roll = rollUpPosition(invested, carried.fmv);
      const reason = carried.unavailable_reason ?? roll.unsupported;
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
        // Null unless the mark the scope found cannot be used as a value.
        mark_unavailable_reason: reason,
        mark_unavailable: reason ? MARK_UNAVAILABLE_REASONS[reason] : null,
        mark_as_of: carried.fmv == null ? null : mark?.as_of_date ?? null,
        mark_basis: carried.fmv == null ? null : mark?.basis ?? null,
        /** Which fund's mark answered, or null for a firm-level one (D4644 §3). */
        mark_fund_id: carried.fmv == null ? null : mark?.fund_id ?? null,
      };
    });
    // D1057: the read says which companies it lists. An investor sees the ones they hold a confirmed
    // commitment in (finding 8); an admin, every recorded position. D4636 part 3: a GP of record
    // is also told which funds' positions were added.
    return c.json({
      items,
      scope: scope.held == null ? { rule: 'all_positions', text: 'Every position the studio recorded.' } : HELD_SCOPE,
      fund_scope: gpScopeStatement(scope),
    });
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
/**
 * GET /api/positions/marks — canvas IP1's `Mark history`, book-wide.
 *
 * REGISTERED BEFORE `/:projectUid`. Hono matches in registration order, so a
 * literal that lands after a parameter is unreachable — `marks` would be read
 * as a project uid and 404.
 *
 * THE OPS ROW SAID THIS DID NOT EXIST, AND IT WAS WRONG TWICE.
 * `investorZoneActions` marked `Mark history` unbuilt because "only the current
 * mark is stored; there is no history to open". `portfolio_marks` is a HISTORY
 * table — one row per marking event, each carrying the `as_of_date` it speaks
 * for, the `event` that caused it, the `basis` it was arrived at on and free
 * text `source` provenance. And `GET /positions/:projectUid` was ALREADY
 * returning that history, to the same `canViewLpData` readers who were looking
 * at the disabled button.
 *
 * So this route adds no access and no store. It answers the one question the
 * per-project read cannot: what happened across the whole book, in one call,
 * ordered by when it happened. Fetching that by looping the per-project
 * endpoint would be an N+1 for a page whose first job is a list.
 *
 * THE BASIS COLUMN IS WHY THE HISTORY MATTERS. `portfolio_marks.basis` is
 * `round_price | secondary | gp_estimate | write_down | cost`, and the schema's
 * own comment says why it is there: "a round-priced mark and a GP estimate must
 * never look alike to an LP". A book that shows only the latest FMV hides
 * exactly that distinction.
 *
 * Scoped identically to every other read in this file — `canViewLpData` then
 * `investorProjectIds`, through the same CSV predicate `latestMarksByProject`
 * uses, with both sides bound.
 */
r.get('/marks', async (c) => {
  try {
    const user = await requireAuth(c);
    const scope = await positionScope(c, user);
    if (!scope) return c.json({ detail: 'Forbidden' }, 403);
    // A book with no accessible projects reads as empty rather than as
    // unscoped: `investorProjectIds` returning [] must not become "all rows".
    if (scope.held != null && scope.held.length === 0 && scope.gpOnly.length === 0) {
      return c.json({ items: [], projects: 0, basis_counts: {} });
    }
    const rows = await c.env.DB.prepare(
      `SELECT m.uid, m.project_id, m.as_of_date, m.fmv, m.post_money,
              m.event, m.basis, m.source, m.note, m.created_at,
              p.name AS project_name, p.uid AS project_uid
         FROM portfolio_marks m
         JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
        WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(m.project_id AS TEXT) || ',') > 0
               OR (instr(',' || ? || ',', ',' || CAST(m.project_id AS TEXT) || ',') > 0
                   AND (m.fund_id IS NULL OR instr(',' || ? || ',', ',' || CAST(m.fund_id AS TEXT) || ',') > 0)))
        ORDER BY m.as_of_date DESC, m.created_at DESC
        LIMIT 500`,
    ).bind(scope.heldCsv, scope.heldCsv, scope.gpOnlyCsv, scope.fundCsv).all<any>();
    const items = (rows.results || []).map((m: any) => ({
      uid: m.uid,
      project_id: Number(m.project_id),
      project_uid: m.project_uid ?? null,
      project_name: m.project_name ?? null,
      as_of_date: m.as_of_date ?? null,
      fmv: m.fmv === null || m.fmv === undefined ? null : Number(m.fmv),
      post_money: m.post_money === null || m.post_money === undefined ? null : Number(m.post_money),
      event: m.event ?? null,
      // Never defaulted. The column has a DEFAULT of 'gp_estimate', so a NULL
      // here means a row written before that default existed — reporting it as
      // a GP estimate would be inventing the provenance the column exists to
      // record.
      basis: m.basis ?? null,
      source: m.source ?? null,
      note: m.note ?? null,
    }));
    const basisCounts: Record<string, number> = {};
    for (const m of items) {
      const key = m.basis || 'unrecorded';
      basisCounts[key] = (basisCounts[key] || 0) + 1;
    }
    return c.json({
      items,
      projects: new Set(items.map((m) => m.project_id)).size,
      basis_counts: basisCounts,
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/analytics', async (c) => {
  try {
    const user = await requireAuth(c);
    const scope = await positionScope(c, user);
    if (!scope) return c.json({ detail: 'Forbidden' }, 403);
    const today = isoDate(c.req.query('as_of')) || new Date().toISOString().slice(0, 10);

    const [positions, distributions, marks] = await Promise.all([
      c.env.DB.prepare(
        `SELECT project_id, invested_amount, position_date, created_at
           FROM portfolio_positions
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(project_id AS TEXT) || ',') > 0
                 OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)`,
      ).bind(scope.heldCsv, scope.heldCsv, scope.fundCsv).all<any>(),
      c.env.DB.prepare(
        `SELECT project_id, amount, distribution_date
           FROM portfolio_distributions
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(project_id AS TEXT) || ',') > 0
                 OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)`,
      ).bind(scope.heldCsv, scope.heldCsv, scope.fundCsv).all<any>().catch(() => ({ results: [] as any[] })),
      scopedLatestMarks(c.env, scope, c.req.query('as_of') ? today : null),
    ]);

    // The quarter-end read (D463): with an explicit `as_of`, only flows ON OR
    // BEFORE the date count — a quarter-end export must not include a wire
    // that landed after it. Without one, every flow counts, as before.
    const asOf = c.req.query('as_of') ? today : null;
    const flows: CashFlow[] = [];
    const investedByProject = new Map<number, number>();
    for (const p of (positions.results || [])) {
      const amount = Number(p.invested_amount) || 0;
      if (amount <= 0) continue;
      const pid = Number(p.project_id);
      const date = isoDate(p.position_date) || isoDate(p.created_at);
      if (asOf && date && date > asOf) continue;
      investedByProject.set(pid, (investedByProject.get(pid) || 0) + amount);
      if (date) flows.push({ date, amount, kind: 'contribution' });
    }
    for (const d of (distributions.results || [])) {
      const amount = Number(d.amount) || 0;
      const date = isoDate(d.distribution_date);
      if (asOf && date && date > asOf) continue;
      if (amount > 0 && date) flows.push({ date, amount, kind: 'distribution' });
    }

    // NAV = Σ carrying value. Unmarked positions carry at cost.
    // D4644: a mark the scope cannot choose between, or one that is not a value
    // at all, carries at cost like an unmarked position and is counted apart, so
    // mark coverage never reports a disputed position as marked.
    let nav = 0;
    let unmarkedCount = 0;
    let unusableMarkCount = 0;
    for (const [pid, invested] of investedByProject) {
      const carried = carryingValue(marks.get(pid));
      const roll = rollUpPosition(invested, carried.fmv);
      nav += roll.fmv;
      if (roll.unmarked) unmarkedCount++;
      if (carried.unavailable_reason && carried.unavailable_reason !== 'no_mark') unusableMarkCount++;
    }

    const metrics = computeFundMetrics(flows, nav, today);
    return c.json({
      ...metrics,
      // The date the figures speak for, echoed so the page states it: with an
      // explicit `as_of`, the flows and the marks are both cut at that date.
      as_of: asOf,
      position_count: investedByProject.size,
      unmarked_position_count: unmarkedCount,
      /** D4644: positions whose recorded mark could not be used, and why not. */
      unusable_mark_count: unusableMarkCount,
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
// submitted update whose `period` counts for it (`periodCounts`, D1057: a
// month inside the quarter counts for the quarter). One reporting channel.
r.get('/kpi-compliance', async (c) => {
  try {
    const user = await requireAuth(c);
    const scope = await positionScope(c, user);
    if (!scope) return c.json({ detail: 'Forbidden' }, 403);
    const cadence: KpiCadence = c.req.query('cadence') === 'monthly' ? 'monthly' : 'quarterly';
    const today = isoDate(c.req.query('as_of')) || new Date().toISOString().slice(0, 10);
    // #4647 (D4647): THE DEFAULT IS THE LAST COMPLETED PERIOD.
    //
    // This measured `currentPeriod` — the period today falls inside. On 2
    // October, that is a Q4 one day old: nobody can have reported on it, so
    // the read said every company in the book was delinquent and
    // `compliance_pct` was near zero by construction. A reporting period is
    // measurable only once it has ended.
    //
    // An explicit `period=` still asks for whatever period the caller names,
    // including the one in progress, and the response says whether that period
    // has finished — so a partial figure can be read as partial instead of
    // looking like a final one.
    const asked = String(c.req.query('period') || '').trim();
    const period = asked || completedPeriod(cadence, today);
    const bounds = period ? periodBounds(cadence, period) : null;
    if (asked && !bounds) {
      return c.json({ detail: cadence === 'quarterly' ? 'period must look like 2026-Q3' : 'period must look like 2026-09' }, 400);
    }

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
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0
                 OR instr(',' || ? || ',', ',' || CAST(p.fund_id AS TEXT) || ',') > 0)`,
      ).bind(scope.heldCsv, scope.heldCsv, scope.fundCsv).all<any>(),
      c.env.DB.prepare(
        `SELECT project_id, period, MAX(COALESCE(submitted_at, updated_at)) AS last_at
           FROM portfolio_updates
          WHERE status = 'submitted'
            AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(project_id AS TEXT) || ',') > 0)
          GROUP BY project_id, period`,
      ).bind(scope.visibleCsv, scope.visibleCsv).all<any>().catch(() => ({ results: [] as any[] })),
    ]);

    const thisPeriod = new Set<number>();
    const lastSeen = new Map<number, string>();
    for (const u of (updates.results || [])) {
      const pid = Number(u.project_id);
      // D1057: a Grow update's `YYYY-MM` counts for the quarter it falls in (finding 3).
      if (periodCounts(cadence, period, u.period)) thisPeriod.add(pid);
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
      // #4647: the window measured, the zone it was resolved in, and whether
      // the period is over. The label alone left a reader to infer all three,
      // and `period_in_progress` is the difference between a final completion
      // figure and one that is still being earned.
      period_from: bounds?.from ?? null,
      period_until: bounds?.until ?? null,
      period_complete: period ? periodComplete(cadence, period, today) : null,
      period_in_progress: period ? periodComplete(cadence, period, today) === false : null,
      period_default: asked ? null : 'last_completed',
      period_now: currentPeriod(cadence, today),
      timezone: 'UTC',
      kpi_set: defs.results || [],
      companies,
      reported_count: reported,
      total_count: companies.length,
      // The numerator and the denominator are over the SAME population — the
      // companies held in this caller's book — and the same period. Both are
      // named here so the ratio can be checked rather than trusted.
      population: { basis: 'companies_held_in_book', period },
      compliance_pct: companies.length > 0 ? Math.round((reported / companies.length) * 100) : null,
    });
  } catch (e) { return mapError(c, e); }
});

// GET /api/positions/:projectUid — round history + current cap-table snapshot
r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    // D4636 part 4: gated before the lookup, so a caller with neither the licence nor a fund
    // still gets 403 whether or not the company exists, as before.
    const scope = await positionScope(c, user);
    if (!scope) return c.json({ detail: 'Forbidden' }, 403);
    const proj = await c.env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE uid = ? AND deleted_at IS NULL').bind(c.req.param('projectUid')).first<any>();
    if (!proj) return c.json({ detail: 'Not found' }, 404);
    const pid = Number(proj.id);
    const asHolder = scope.held == null || scope.held.includes(pid);
    if (!asHolder && !scope.gpOnly.includes(pid)) return c.json({ detail: 'Forbidden' }, 403);
    // D4636 part 3: a company reached only as GP of record reads the rounds,
    // marks and distributions of the funds the caller runs (and the firm-level
    // marks); a holder or an admin reads the company's (`fundOnly` null).
    const fundOnly = asHolder ? null : scope.fundCsv;
    // D4636 part 2: an admin, who records positions, reads the whole row. An
    // investor, and a GP of record (part 3), read the round as it bears on the
    // company: not the internal row id, the account that recorded it, or the
    // closing line it was reconciled against.
    const rounds = user.role === 'admin'
      ? await c.env.DB.prepare(
        'SELECT * FROM portfolio_positions WHERE project_id = ? ORDER BY COALESCE(position_date, created_at) ASC'
      ).bind(proj.id).all<PositionRow>()
      : await c.env.DB.prepare(
        `SELECT uid, fund_id, project_id, round_name, invested_amount, shares, price_per_share, ownership_pct,
                position_date, created_at, updated_at
           FROM portfolio_positions
          WHERE project_id = ?
            AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)
          ORDER BY COALESCE(position_date, created_at) ASC`
      ).bind(proj.id, fundOnly, fundOnly).all<PositionRow>();
    const holders = await c.env.DB.prepare(
      'SELECT name, security_type, shares, ownership_pct, source FROM cap_table_holders WHERE project_id = ? ORDER BY ownership_pct DESC'
    ).bind(proj.id).all<any>().catch(() => ({ results: [] }));
    // #125 — mark history + realisations for the position-detail view.
    const [markRows, distRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT uid, as_of_date, fmv, post_money, event, basis, source, note
           FROM portfolio_marks
          WHERE project_id = ?
            AND (? IS NULL OR fund_id IS NULL OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)
          ORDER BY as_of_date DESC`,
      ).bind(proj.id, fundOnly, fundOnly).all<any>().catch(() => ({ results: [] as any[] })),
      c.env.DB.prepare(
        `SELECT uid, distribution_date, amount, kind, note
           FROM portfolio_distributions
          WHERE project_id = ?
            AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)
          ORDER BY distribution_date DESC`,
      ).bind(proj.id, fundOnly, fundOnly).all<any>().catch(() => ({ results: [] as any[] })),
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
    // D4817 part 7 (#5311): an admin moves the figures every holder of this
    // company reads, so the act is audited in both stores (`logAdminAction`
    // never throws, so it cannot undo the mark).
    await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), 'portfolio.mark_recorded', {
      project_uid: c.req.param('projectUid'), mark_uid: uid, as_of_date: asOf, fmv, basis,
      fund_id: body.fund_id != null ? Number(body.fund_id) : null,
    });
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
    // D4817 part 7 (#5311): audited as the mark is, for the same reason.
    await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), 'portfolio.distribution_recorded', {
      project_uid: c.req.param('projectUid'), distribution_uid: uid, distribution_date: date, amount, kind,
      fund_id: body.fund_id != null ? Number(body.fund_id) : null,
    });
    return c.json(fresh, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /api/positions — record a round position: an Admin's act, `position.record` (D1215, #3212)
r.post('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    await assertAdminAct(c, user, 'position.record');
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    const roundName = body.round_name ? String(body.round_name).slice(0, 64) : null;
    if (!Number.isFinite(projectId) || !roundName) return c.json({ detail: 'project_id and round_name required' }, 400);
    const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ id: number }>();
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    // D1215: the closing line this position records, when one is named: a line of a closing on this venture.
    const lineUid = body.closing_line_uid == null || body.closing_line_uid === '' ? null : String(body.closing_line_uid);
    if (lineUid !== null) {
      const line = await c.env.DB.prepare(
        'SELECT 1 AS yes FROM closing_lines l JOIN closings cl ON cl.id = l.closing_id WHERE l.uid = ? AND cl.project_id = ?'
      ).bind(lineUid, projectId).first();
      if (!line) return c.json({ detail: 'No closing line of this venture has that id.', code: 'closing_line_not_found' }, 404);
    }
    const uid = newUid();
    const values = [
      uid, body.fund_id != null ? Number(body.fund_id) : null, projectId, roundName,
      num(body.invested_amount) ?? 0, num(body.shares), num(body.price_per_share), num(body.ownership_pct),
      body.position_date ? String(body.position_date).slice(0, 32) : null,
      user.id, nowIso(), nowIso(),
    ];
    const ins = lineUid === null
      ? await c.env.DB.prepare(
        `INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, shares, price_per_share, ownership_pct, position_date, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(...values).run()
      : await c.env.DB.prepare(
        `INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, shares, price_per_share, ownership_pct, position_date, created_by, created_at, updated_at, closing_line_uid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(...values, lineUid).run();
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
