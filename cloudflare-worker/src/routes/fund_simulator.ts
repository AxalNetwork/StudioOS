/**
 * T3 — Reserve allocation + waterfall simulator (port of FastAPI Task #46).
 *
 * Mounted at `/api/fund-sim`. RBAC: admin or investor (mirrors
 * `canViewLpData` — same gate as `/api/capital` / `/api/funds`).
 *
 * Routes:
 *   GET    /funds/:fund_id/reserves
 *   PUT    /funds/:fund_id/reserves
 *   POST   /funds/:fund_id/reserves/simulate
 *   POST   /funds/:fund_id/waterfall/simulate
 *   GET    /funds/:fund_id/scenarios?kind=
 *   POST   /funds/:fund_id/scenarios
 *   GET    /scenarios/:uid
 *   DELETE /scenarios/:uid
 *
 * Engines (`simulateReserves`, `simulateWaterfall`) are 1:1 ports of
 * `backend/app/services/fund_simulator.py` — keep the two in sync.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canViewLpData } from '../auth';
import { isAdmin, mapError, newUid, nowIso, jload } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Engines (port of backend/app/services/fund_simulator.py)
// ---------------------------------------------------------------------------
type Allocation = {
  project_id: number;
  project_name?: string | null;
  initial_check: number;
  reserve_amount: number;
  target_ownership_pct?: number | null;
  confidence?: string | null;
  expected_moic?: number | null;
};

export function simulateReserves(opts: {
  total_commitment: number;
  allocations: Allocation[];
  expected_moic_per_company?: number | null;
  years_to_exit?: number;
  fund_expense_pct?: number;
}): any {
  const default_moic = Number(opts.expected_moic_per_company || 3.0);
  const years = Math.max(0.25, Number(opts.years_to_exit ?? 5.0));
  const commitment = Math.max(0, Number(opts.total_commitment || 0));
  const expense_pct = Math.max(0, Math.min(0.95, Number(opts.fund_expense_pct ?? 0.20)));
  const expense_drag = expense_pct * commitment;
  const investable = Math.max(0, commitment - expense_drag);

  let initial_total = 0, reserve_total = 0, proceeds_total = 0;
  const rows: any[] = [];
  for (const a of opts.allocations) {
    const initial = Math.max(0, Number(a.initial_check || 0));
    const reserve = Math.max(0, Number(a.reserve_amount || 0));
    const moic = Number(a.expected_moic || default_moic);
    const invested = initial + reserve;
    const proceeds = invested * moic;
    rows.push({
      project_id: a.project_id,
      project_name: a.project_name ?? null,
      initial_check: round2(initial),
      reserve_amount: round2(reserve),
      total_invested: round2(invested),
      expected_moic: round3(moic),
      projected_proceeds: round2(proceeds),
      target_ownership_pct: a.target_ownership_pct ?? null,
      confidence: a.confidence || 'medium',
    });
    initial_total += initial;
    reserve_total += reserve;
    proceeds_total += proceeds;
  }

  const deployed_total = initial_total + reserve_total;
  const over_allocated = deployed_total > investable;
  const uncalled = Math.max(0, investable - deployed_total);

  const lp_outlay = commitment > 0 ? commitment : deployed_total;
  const distributions = proceeds_total + uncalled;
  let gross_multiple = 0, irr = 0;
  if (lp_outlay > 0 && distributions > 0) {
    gross_multiple = distributions / lp_outlay;
    irr = Math.pow(gross_multiple, 1.0 / years) - 1.0;
  }

  return {
    summary: {
      total_commitment: round2(commitment),
      investable_capital: round2(investable),
      expense_drag: round2(expense_drag),
      initial_deployed: round2(initial_total),
      reserves_planned: round2(reserve_total),
      total_deployed: round2(deployed_total),
      uncalled_capital: round2(uncalled),
      deployment_pct: round2(investable > 0 ? (deployed_total / investable) * 100 : 0),
      reserve_ratio_pct: round2(deployed_total > 0 ? (reserve_total / deployed_total) * 100 : 0),
      over_allocated,
      projected_proceeds: round2(proceeds_total),
      projected_distributions: round2(distributions),
      projected_moic: round3(gross_multiple),
      projected_irr_pct: round2(irr * 100),
      years_to_exit: years,
      company_count: rows.length,
    },
    companies: rows,
    assumptions: [
      `Default MOIC per company: ${default_moic.toFixed(2)}× (override per-row).`,
      `Fund expense drag: ${(expense_pct * 100).toFixed(0)}% of commitment.`,
      `Single exit at year ${years.toFixed(1)}; IRR is gross-of-carry.`,
      'Uncalled capital returned to LPs at exit (no recycling).',
    ],
  };
}

export function simulateWaterfall(opts: {
  exit_value: number;
  total_committed: number;
  total_invested: number;
  carry_pct?: number;
  hurdle_rate?: number;
  years_held?: number;
  gp_catchup?: boolean;
  lps?: Array<{ name?: string | null; commitment_amount?: number | null; invested_amount?: number | null }>;
}): any {
  const exit_value = Math.max(0, Number(opts.exit_value || 0));
  const invested = Math.max(0, Number(opts.total_invested || 0));
  const committed = Math.max(invested, Number(opts.total_committed || 0));
  const carry = Math.max(0, Math.min(0.50, Number(opts.carry_pct ?? 0.20)));
  const hurdle = Math.max(0, Math.min(0.50, Number(opts.hurdle_rate ?? 0.08)));
  const years = Math.max(0, Number(opts.years_held ?? 5.0));
  const gp_catchup = opts.gp_catchup !== false;

  const tranches: any[] = [];
  let remaining = exit_value;

  const roc = Math.min(invested, remaining);
  remaining -= roc;
  tranches.push({ name: 'Return of capital', to: 'LPs', amount: round2(roc) });

  const hurdle_target = invested * (Math.pow(1 + hurdle, years) - 1);
  const pref = Math.min(hurdle_target, remaining);
  remaining -= pref;
  tranches.push({
    name: `Preferred return (hurdle ${(hurdle * 100).toFixed(1)}%)`,
    to: 'LPs',
    amount: round2(pref),
  });

  let gp_catchup_amt = 0;
  if (gp_catchup && carry > 0 && pref > 0) {
    const target = (1 - carry) > 0 ? (pref * carry) / (1 - carry) : 0;
    gp_catchup_amt = Math.min(target, remaining);
    remaining -= gp_catchup_amt;
  }
  tranches.push({ name: 'GP catch-up', to: 'GP', amount: round2(gp_catchup_amt) });

  const lp_split = remaining * (1 - carry);
  const gp_split = remaining * carry;
  tranches.push({
    name: `Profit split — LP ${((1 - carry) * 100).toFixed(0)}%`,
    to: 'LPs',
    amount: round2(lp_split),
  });
  tranches.push({
    name: `Profit split — GP carry ${(carry * 100).toFixed(0)}%`,
    to: 'GP',
    amount: round2(gp_split),
  });

  const lp_total = roc + pref + lp_split;
  const gp_total = gp_catchup_amt + gp_split;
  const total_distributed = lp_total + gp_total;

  const lp_rows: any[] = [];
  const lps_list = opts.lps || [];
  const sum_commitments = lps_list.reduce(
    (s, lp) => s + Math.max(0, Number(lp.commitment_amount || 0)),
    0,
  );
  for (const lp of lps_list) {
    const lp_committed = Math.max(0, Number(lp.commitment_amount || 0));
    const share = sum_commitments > 0 ? lp_committed / sum_commitments : 0;
    const lp_invested = Math.max(
      0,
      Number(lp.invested_amount || (lp_committed * (committed > 0 ? invested / committed : 1))),
    );
    const lp_payout = lp_total * share;
    const lp_profit = lp_payout - lp_invested;
    lp_rows.push({
      name: lp.name || '—',
      commitment_amount: round2(lp_committed),
      invested_amount: round2(lp_invested),
      share_pct: round3(share * 100),
      payout: round2(lp_payout),
      profit: round2(lp_profit),
      moic: lp_invested > 0 ? round3(lp_payout / lp_invested) : 0,
    });
  }

  const moic = invested > 0 ? lp_total / invested : 0;
  const irr =
    invested > 0 && lp_total > 0 && years > 0
      ? Math.pow(lp_total / invested, 1 / years) - 1
      : 0;

  return {
    exit_value: round2(exit_value),
    tranches,
    totals: {
      to_lps: round2(lp_total),
      to_gp: round2(gp_total),
      total_distributed: round2(total_distributed),
      lp_moic: round3(moic),
      lp_irr_pct: round2(irr * 100),
      total_invested: round2(invested),
      total_committed: round2(committed),
      carry_pct: carry,
      hurdle_rate: hurdle,
      years_held: years,
    },
    lp_rows,
    assumptions: [
      'European waterfall — whole-of-fund, not deal-by-deal.',
      `1× return of capital, then ${(hurdle * 100).toFixed(1)}% preferred return compounded over ${years.toFixed(1)} years.`,
      gp_catchup ? '100% GP catch-up to carry rate.' : 'No GP catch-up.',
      `Profit split above hurdle: LP ${((1 - carry) * 100).toFixed(0)}% / GP ${(carry * 100).toFixed(0)}%.`,
      'GP commit not modeled. Per-LP rows pro-rated by commitment share.',
    ],
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function requireFundOps(c: any): Promise<User> {
  const user = await requireAuth(c);
  if (!canViewLpData(user)) throw new Error('Forbidden');
  return user;
}

async function loadFund(env: Env, fund_id: number): Promise<any> {
  const f = await env.DB.prepare('SELECT * FROM vc_funds WHERE id = ?').bind(fund_id).first<any>();
  if (!f) throw new Error('Fund not found');
  return f;
}

async function portfolioProjects(env: Env): Promise<any[]> {
  const rs = await env.DB.prepare(
    "SELECT id, name FROM projects WHERE status IN ('spinout','active','tier_1','tier_2')"
  ).all<any>();
  return rs.results || [];
}

function allocDto(a: any, project_name: string | null = null): any {
  return {
    uid: a.uid,
    project_id: a.project_id,
    project_name,
    reserve_amount: a.reserve_amount,
    initial_check: a.initial_check,
    next_round_label: a.next_round_label,
    target_ownership_pct: a.target_ownership_pct,
    confidence: a.confidence,
    notes: a.notes,
    updated_at: a.updated_at || null,
  };
}

function scenarioDto(s: any): any {
  return {
    uid: s.uid,
    fund_id: s.fund_id,
    kind: s.kind,
    name: s.name,
    description: s.description,
    inputs: jload(s.inputs_json, {}),
    result: jload(s.result_json, {}),
    created_by_user_id: s.created_by_user_id,
    created_at: s.created_at || null,
    updated_at: s.updated_at || null,
  };
}

function fundDto(f: any): any {
  return {
    id: f.id,
    uid: String(f.id), // vc_funds has no uid column; expose id as a stable string
    name: f.name,
    vintage_year: f.vintage_year,
    total_commitment: f.total_commitment,
    deployed_capital: f.deployed_capital,
    status: f.status,
  };
}

function clampStr(v: any, max: number): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function clampAlloc(it: any): Allocation & { next_round_label: string | null; notes: string | null } {
  const reserve = Math.max(0, Number(it?.reserve_amount || 0));
  const initial = Math.max(0, Number(it?.initial_check || 0));
  const target =
    it?.target_ownership_pct == null
      ? null
      : Math.max(0, Math.min(100, Number(it.target_ownership_pct)));
  const confidence = String(it?.confidence || 'medium');
  return {
    project_id: Number(it?.project_id),
    reserve_amount: reserve,
    initial_check: initial,
    next_round_label: clampStr(it?.next_round_label, 64),
    target_ownership_pct: target,
    confidence,
    notes: clampStr(it?.notes, 2000),
  };
}

// ---------------------------------------------------------------------------
// Reserves — list / replace
// ---------------------------------------------------------------------------
async function buildReservesResponse(env: Env, fund: any) {
  const projects = await portfolioProjects(env);
  const allocsRs = await env.DB.prepare(
    'SELECT * FROM fund_reserve_allocations WHERE fund_id = ?'
  ).bind(fund.id).all<any>();
  const byProject = new Map<number, any>();
  for (const a of allocsRs.results || []) byProject.set(a.project_id, a);
  const rows = projects.map((p) => {
    const a = byProject.get(p.id);
    if (a) return allocDto(a, p.name);
    return {
      uid: null,
      project_id: p.id,
      project_name: p.name,
      reserve_amount: 0.0,
      initial_check: 0.0,
      next_round_label: null,
      target_ownership_pct: null,
      confidence: 'medium',
      notes: null,
      updated_at: null,
    };
  });
  const sim = simulateReserves({
    total_commitment: Number(fund.total_commitment || 0),
    allocations: rows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      initial_check: r.initial_check,
      reserve_amount: r.reserve_amount,
      target_ownership_pct: r.target_ownership_pct,
      confidence: r.confidence,
    })),
  });
  return { fund: fundDto(fund), items: rows, summary: sim.summary };
}

r.get('/funds/:fund_id/reserves', async (c) => {
  try {
    await requireFundOps(c);
    const fund = await loadFund(c.env, Number(c.req.param('fund_id')));
    return c.json(await buildReservesResponse(c.env, fund));
  } catch (e) { return mapError(c, e); }
});

r.put('/funds/:fund_id/reserves', async (c) => {
  try {
    await requireFundOps(c);
    const fund = await loadFund(c.env, Number(c.req.param('fund_id')));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    const projects = await portfolioProjects(c.env);
    const validIds = new Set<number>(projects.map((p) => p.id));

    const cleaned = items.map(clampAlloc);
    for (const it of cleaned) {
      if (!validIds.has(it.project_id)) {
        return c.json({ detail: `Project ${it.project_id} not in active portfolio` }, 400);
      }
    }

    const existingRs = await c.env.DB.prepare(
      'SELECT * FROM fund_reserve_allocations WHERE fund_id = ?'
    ).bind(fund.id).all<any>();
    const existingByPid = new Map<number, any>();
    for (const row of existingRs.results || []) existingByPid.set(row.project_id, row);

    const seen = new Set<number>();
    const now = nowIso();
    for (const it of cleaned) {
      seen.add(it.project_id);
      const ex = existingByPid.get(it.project_id);
      if (ex) {
        await c.env.DB.prepare(
          `UPDATE fund_reserve_allocations
              SET reserve_amount = ?, initial_check = ?, next_round_label = ?,
                  target_ownership_pct = ?, confidence = ?, notes = ?, updated_at = ?
            WHERE id = ?`
        ).bind(
          it.reserve_amount, it.initial_check, it.next_round_label,
          it.target_ownership_pct, it.confidence, it.notes, now, ex.id,
        ).run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO fund_reserve_allocations
            (uid, fund_id, project_id, reserve_amount, initial_check, next_round_label,
             target_ownership_pct, confidence, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          newUid(), fund.id, it.project_id, it.reserve_amount, it.initial_check,
          it.next_round_label, it.target_ownership_pct, it.confidence, it.notes, now, now,
        ).run();
      }
    }
    // Zero-out rows not present in the bulk PUT.
    for (const [pid, ex] of existingByPid.entries()) {
      if (!seen.has(pid)) {
        await c.env.DB.prepare(
          `UPDATE fund_reserve_allocations
              SET reserve_amount = 0, initial_check = 0, updated_at = ?
            WHERE id = ?`
        ).bind(now, ex.id).run();
      }
    }
    return c.json(await buildReservesResponse(c.env, fund));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Reserves — simulate (no persistence; pure preview)
// ---------------------------------------------------------------------------
r.post('/funds/:fund_id/reserves/simulate', async (c) => {
  try {
    await requireFundOps(c);
    const fund = await loadFund(c.env, Number(c.req.param('fund_id')));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const projects = await portfolioProjects(c.env);
    const nameById = new Map<number, string>();
    for (const p of projects) nameById.set(p.id, p.name);

    const allocs: any[] = Array.isArray(body?.allocations) ? body.allocations : [];
    const cleaned = allocs.map(clampAlloc);
    const expected_moic =
      body?.expected_moic_per_company == null
        ? null
        : Math.max(0, Math.min(50, Number(body.expected_moic_per_company)));
    const years_to_exit = Math.max(0.25, Math.min(15, Number(body?.years_to_exit ?? 5.0)));
    const fund_expense_pct = Math.max(0, Math.min(0.95, Number(body?.fund_expense_pct ?? 0.20)));

    const payload: Allocation[] = cleaned.map((a) => ({
      project_id: a.project_id,
      project_name: nameById.get(a.project_id) ?? null,
      initial_check: a.initial_check,
      reserve_amount: a.reserve_amount,
      target_ownership_pct: a.target_ownership_pct,
      confidence: a.confidence,
    }));
    return c.json(
      simulateReserves({
        total_commitment: Number(fund.total_commitment || 0),
        allocations: payload,
        expected_moic_per_company: expected_moic,
        years_to_exit,
        fund_expense_pct,
      }),
    );
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Waterfall — simulate exit at $X
// ---------------------------------------------------------------------------
r.post('/funds/:fund_id/waterfall/simulate', async (c) => {
  try {
    await requireFundOps(c);
    const fund = await loadFund(c.env, Number(c.req.param('fund_id')));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const exit_value = Math.max(0, Number(body?.exit_value || 0));
    const carry_pct = Math.max(0, Math.min(0.50, Number(body?.carry_pct ?? 0.20)));
    const hurdle_rate = Math.max(0, Math.min(0.50, Number(body?.hurdle_rate ?? 0.08)));
    const years_held = Math.max(0, Math.min(20, Number(body?.years_held ?? 5.0)));
    const gp_catchup = body?.gp_catchup !== false;

    const lpsRs = await c.env.DB.prepare(
      `SELECT lp.commitment_amount, lp.invested_amount, COALESCE(u.name, u.email, '—') AS name
         FROM limited_partners lp
         LEFT JOIN users u ON u.id = lp.user_id
        WHERE lp.fund_id = ?`
    ).bind(fund.id).all<any>();
    const lps = lpsRs.results || [];

    const sumCommit = lps.reduce((s: number, lp: any) => s + Number(lp.commitment_amount || 0), 0);
    const sumInvested = lps.reduce((s: number, lp: any) => s + Number(lp.invested_amount || 0), 0);
    const total_committed =
      body?.total_committed != null
        ? Math.max(0, Number(body.total_committed))
        : (sumCommit || Number(fund.total_commitment || 0));
    const total_invested =
      body?.total_invested != null
        ? Math.max(0, Number(body.total_invested))
        : (sumInvested || Number(fund.deployed_capital || 0));

    return c.json(
      simulateWaterfall({
        exit_value,
        total_committed,
        total_invested,
        carry_pct,
        hurdle_rate,
        years_held,
        gp_catchup,
        lps: lps.map((lp: any) => ({
          name: lp.name,
          commitment_amount: lp.commitment_amount,
          invested_amount: lp.invested_amount,
        })),
      }),
    );
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Scenarios — save / list / load / delete
// ---------------------------------------------------------------------------
r.get('/funds/:fund_id/scenarios', async (c) => {
  try {
    const user = await requireFundOps(c);
    const fund = await loadFund(c.env, Number(c.req.param('fund_id')));
    const kind = c.req.query('kind');
    const parts = ['SELECT * FROM fund_scenarios WHERE fund_id = ?'];
    const binds: any[] = [fund.id];
    if (kind === 'reserves' || kind === 'waterfall') {
      parts.push('AND kind = ?');
      binds.push(kind);
    }
    if (!isAdmin(user)) {
      parts.push('AND created_by_user_id = ?');
      binds.push(user.id);
    }
    parts.push('ORDER BY created_at DESC');
    const rs = await c.env.DB.prepare(parts.join(' ')).bind(...binds).all<any>();
    return c.json({ items: (rs.results || []).map(scenarioDto) });
  } catch (e) { return mapError(c, e); }
});

r.post('/funds/:fund_id/scenarios', async (c) => {
  try {
    const user = await requireFundOps(c);
    const fund = await loadFund(c.env, Number(c.req.param('fund_id')));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const kind = String(body?.kind || '');
    if (kind !== 'reserves' && kind !== 'waterfall') {
      return c.json({ detail: 'kind must be reserves or waterfall' }, 400);
    }
    const name = String(body?.name || '').trim();
    if (!name) return c.json({ detail: 'name required' }, 400);
    if (name.length > 120) return c.json({ detail: 'name too long' }, 400);
    const description = clampStr(body?.description, 2000);
    const inputs_json = JSON.stringify(body?.inputs ?? {});
    const result_json = JSON.stringify(body?.result ?? {});
    const uid = newUid();
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO fund_scenarios
        (uid, fund_id, kind, name, description, inputs_json, result_json,
         created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, fund.id, kind, name, description, inputs_json, result_json, user.id, now, now).run();
    const s = await c.env.DB.prepare('SELECT * FROM fund_scenarios WHERE uid = ?').bind(uid).first<any>();
    return c.json(scenarioDto(s), 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/scenarios/:uid', async (c) => {
  try {
    const user = await requireFundOps(c);
    const s = await c.env.DB.prepare('SELECT * FROM fund_scenarios WHERE uid = ?')
      .bind(c.req.param('uid')).first<any>();
    if (!s) return c.json({ detail: 'Scenario not found' }, 404);
    if (!isAdmin(user) && s.created_by_user_id !== user.id) {
      return c.json({ detail: 'Not your scenario' }, 403);
    }
    return c.json(scenarioDto(s));
  } catch (e) { return mapError(c, e); }
});

r.delete('/scenarios/:uid', async (c) => {
  try {
    const user = await requireFundOps(c);
    const s = await c.env.DB.prepare('SELECT * FROM fund_scenarios WHERE uid = ?')
      .bind(c.req.param('uid')).first<any>();
    if (!s) return c.json({ detail: 'Scenario not found' }, 404);
    if (!isAdmin(user) && s.created_by_user_id !== user.id) {
      return c.json({ detail: 'Not your scenario' }, 403);
    }
    await c.env.DB.prepare('DELETE FROM fund_scenarios WHERE id = ?').bind(s.id).run();
    return new Response(null, { status: 204 });
  } catch (e) { return mapError(c, e); }
});

export default r;
