/**
 * T11 — Financial Model Builder (port of backend/app/api/routes/financials.py).
 *
 * Endpoints (mounted at /api/financials in index.ts):
 *   GET    /:projectId               — fetch model (or default scaffold)
 *   PUT    /:projectId               — upsert assumptions + recompute
 *   POST   /:projectId/recompute     — recompute from stored assumptions
 *   GET    /:projectId/export.xlsx   — CSV fallback (worker has no XLSX lib)
 *
 * Authorization mirrors the Python helpers:
 *   admin / partner              — read-only on any project
 *   admin / founder (own project) — may PUT
 *   anyone else                  — 403
 *
 * Response shapes match the FastAPI source EXACTLY so FinancialsPage
 * needs no changes (modulo the .xlsx → .csv export tweak documented in
 * the export handler below).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { projectInActiveCompany } from '../services/tenancyScope';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import type { Env } from '../types';
import { requireAuth, canAccessFounderResource } from '../auth';

const financials = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Task #3 (DF) — runtime schema bootstrap. The schema.sql checked into the
// repo carries an older `financial_models` shape (uid/name/inputs_json), and
// migration 034 (which would rebuild it) failed to apply on prod per the
// notes in replit.md. To stop the page 5xx-ing on either a fresh DB or a
// stale-schema prod, lazily PRAGMA-check the table on first request and
// CREATE / ADD COLUMN whatever's missing. Idempotent + single-flight.
// ---------------------------------------------------------------------------
let _financialsSchemaReady = false;
// Legacy `schema.sql` shape includes `name TEXT NOT NULL` and
// `inputs_json TEXT NOT NULL DEFAULT '{}'` (Task #36 marketplace
// placeholder). Track which legacy NOT-NULL columns exist so the PUT
// handler can supply deterministic values for them on INSERT.
let _financialsLegacyCols: Set<string> = new Set();
function getFinancialsLegacyCols(): Set<string> { return _financialsLegacyCols; }
async function ensureFinancialsModelSchema(env: Env): Promise<void> {
  if (_financialsSchemaReady) return;
  try {
    const cols = await env.DB
      .prepare(`PRAGMA table_info(financial_models)`)
      .all<{ name: string; notnull: number; dflt_value: unknown }>();
    const rows = cols.results || [];
    const have = new Set(rows.map((r) => r.name));
    // Detect legacy NOT-NULL-without-default columns we need to satisfy.
    _financialsLegacyCols = new Set(
      rows
        .filter((r) => r.notnull === 1 && r.dflt_value == null && (r.name === 'name' || r.name === 'inputs_json'))
        .map((r) => r.name),
    );
    if (have.size === 0) {
      await env.DB.exec(
        `CREATE TABLE IF NOT EXISTS financial_models (`
          + ` id INTEGER PRIMARY KEY AUTOINCREMENT,`
          + ` project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,`
          + ` assumptions_json TEXT NOT NULL DEFAULT '{}',`
          + ` computed_json TEXT,`
          + ` sensitivity_json TEXT,`
          + ` capital_recompute_json TEXT,`
          + ` updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,`
          + ` updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
          + `)`,
      );
      try { await env.DB.exec(
        `CREATE INDEX IF NOT EXISTS idx_financial_models_project ON financial_models(project_id)`,
      ); } catch (e) { void e; }
    } else {
      const required: Array<[string, string]> = [
        ['assumptions_json', `TEXT NOT NULL DEFAULT '{}'`],
        ['computed_json', `TEXT`],
        ['sensitivity_json', `TEXT`],
        ['capital_recompute_json', `TEXT`],
        ['updated_by', `INTEGER`],
        ['updated_at', `TEXT`],
      ];
      for (const [col, decl] of required) {
        if (!have.has(col)) {
          try { await env.DB.exec(`ALTER TABLE financial_models ADD COLUMN ${col} ${decl}`); }
          catch (e) { void e; }
        }
      }
    }
    // PUT uses `INSERT ... ON CONFLICT(project_id) DO UPDATE` — that
    // requires `project_id` to be UNIQUE. The legacy schema.sql shape
    // does NOT mark it unique, so without this index a stale-schema prod
    // would 500 on every save. Idempotent.
    try { await env.DB.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_models_project_unique ON financial_models(project_id)`,
    ); } catch (e) { void e; }
    _financialsSchemaReady = true;
  } catch (e) {
    console.error('[financials] ensureFinancialsModelSchema:', (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Assumption defaults + bounds (mirror Pydantic field validators).
// ---------------------------------------------------------------------------
type Assumptions = {
  starting_cash: number;
  price_per_unit: number;
  units_month_0: number;
  monthly_growth_pct: number;
  cac: number;
  monthly_churn_pct: number;
  salaries_monthly: number;
  opex_monthly: number;
  gross_margin_pct: number;
  horizon_months: number;
};

const DEFAULTS: Assumptions = {
  starting_cash: 250_000,
  price_per_unit: 99,
  units_month_0: 50,
  monthly_growth_pct: 12,
  cac: 80,
  monthly_churn_pct: 4,
  salaries_monthly: 18_000,
  opex_monthly: 4_500,
  gross_margin_pct: 70,
  horizon_months: 24,
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// Strict validator used on PUT — mirrors the FastAPI Pydantic model.
// Returns either a typed Assumptions or a list of field errors so the
// handler can reject the request with 400 instead of silently overwriting
// the saved model with defaults.
function validateAssumptionsStrict(input: unknown):
  | { ok: true; value: Assumptions }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (input == null || typeof input !== 'object') {
    return { ok: false, errors: ['assumptions: required object'] };
  }
  const src = input as Record<string, unknown>;
  const bounds: Record<keyof Assumptions, [number, number]> = {
    starting_cash: [0, Number.MAX_SAFE_INTEGER],
    price_per_unit: [0, Number.MAX_SAFE_INTEGER],
    units_month_0: [0, Number.MAX_SAFE_INTEGER],
    monthly_growth_pct: [-100, 200],
    cac: [0, Number.MAX_SAFE_INTEGER],
    monthly_churn_pct: [0, 100],
    salaries_monthly: [0, Number.MAX_SAFE_INTEGER],
    opex_monthly: [0, Number.MAX_SAFE_INTEGER],
    gross_margin_pct: [0, 100],
    horizon_months: [3, 60],
  };
  const out = {} as Record<keyof Assumptions, number>;
  (Object.keys(bounds) as Array<keyof Assumptions>).forEach((k) => {
    const raw = src[k];
    // Allow missing → use default (matches Pydantic field defaults).
    if (raw === undefined || raw === null || raw === '') {
      out[k] = DEFAULTS[k];
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      errors.push(`${k}: must be a number`);
      return;
    }
    const [lo, hi] = bounds[k];
    if (v < lo || v > hi) {
      errors.push(`${k}: must be between ${lo} and ${hi}`);
      return;
    }
    out[k] = k === 'horizon_months' ? Math.round(v) : v;
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out as Assumptions };
}

function normalizeAssumptions(input: Partial<Assumptions> | null | undefined): Assumptions {
  const src = (input ?? {}) as Record<string, unknown>;
  const num = (k: keyof Assumptions, def: number) => {
    const v = Number(src[k]);
    return Number.isFinite(v) ? v : def;
  };
  return {
    starting_cash: clamp(num('starting_cash', DEFAULTS.starting_cash), 0, Number.MAX_SAFE_INTEGER),
    price_per_unit: clamp(num('price_per_unit', DEFAULTS.price_per_unit), 0, Number.MAX_SAFE_INTEGER),
    units_month_0: clamp(num('units_month_0', DEFAULTS.units_month_0), 0, Number.MAX_SAFE_INTEGER),
    monthly_growth_pct: clamp(num('monthly_growth_pct', DEFAULTS.monthly_growth_pct), -100, 200),
    cac: clamp(num('cac', DEFAULTS.cac), 0, Number.MAX_SAFE_INTEGER),
    monthly_churn_pct: clamp(num('monthly_churn_pct', DEFAULTS.monthly_churn_pct), 0, 100),
    salaries_monthly: clamp(num('salaries_monthly', DEFAULTS.salaries_monthly), 0, Number.MAX_SAFE_INTEGER),
    opex_monthly: clamp(num('opex_monthly', DEFAULTS.opex_monthly), 0, Number.MAX_SAFE_INTEGER),
    gross_margin_pct: clamp(num('gross_margin_pct', DEFAULTS.gross_margin_pct), 0, 100),
    horizon_months: Math.round(clamp(num('horizon_months', DEFAULTS.horizon_months), 3, 60)),
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Computation core (1-to-1 port of _project_financials).
// ---------------------------------------------------------------------------
type Computed = {
  months: Array<{
    month: number; units: number; revenue: number; gross_profit: number;
    marketing: number; fixed_cost: number; net: number; cash: number;
  }>;
  runway_months: number;
  runway_capped: boolean;
  avg_monthly_burn: number;
  breakeven_month: number | null;
  ending_cash: number;
  total_revenue_horizon: number;
  ltv: number;
  ltv_cac_ratio: number | null;
};

function projectFinancials(a: Assumptions): Computed {
  const months: Computed['months'] = [];
  let cash = a.starting_cash;
  let units = a.units_month_0;
  const growth = a.monthly_growth_pct / 100;
  const churn = a.monthly_churn_pct / 100;
  const gm = a.gross_margin_pct / 100;

  let breakevenMonth: number | null = null;
  let runwayMonths: number | null = null;
  const burns: number[] = [];
  const revenues: number[] = [];

  for (let m = 1; m <= a.horizon_months; m++) {
    const newUnits = units * Math.max(growth, 0);
    units = Math.max(units * (1 - churn) + newUnits, 0);
    const revenue = units * a.price_per_unit;
    const grossProfit = revenue * gm;
    const marketing = newUnits * a.cac;
    const fixed = a.salaries_monthly + a.opex_monthly;
    const totalCost = marketing + fixed;
    const net = grossProfit - totalCost;
    cash += net;
    burns.push(r2(totalCost - grossProfit));
    revenues.push(r2(revenue));

    if (breakevenMonth == null && net >= 0) breakevenMonth = m;
    if (runwayMonths == null && cash <= 0) runwayMonths = m;

    months.push({
      month: m,
      units: r2(units),
      revenue: r2(revenue),
      gross_profit: r2(grossProfit),
      marketing: r2(marketing),
      fixed_cost: r2(fixed),
      net: r2(net),
      cash: r2(cash),
    });
  }

  const positiveBurns = burns.filter((b) => b > 0);
  const avgBurn = r2(
    positiveBurns.length ? positiveBurns.reduce((s, b) => s + b, 0) / positiveBurns.length : 0,
  );
  const lastCash = months.length ? months[months.length - 1].cash : a.starting_cash;

  let runwayValue: number;
  let runwayCapped: boolean;
  if (runwayMonths == null) {
    const est = avgBurn > 0 ? a.starting_cash / avgBurn : a.horizon_months;
    runwayValue = Math.max(est, a.horizon_months);
    runwayCapped = false;
  } else {
    runwayValue = runwayMonths;
    runwayCapped = true;
  }

  const ltv = churn > 0 ? (a.price_per_unit * gm) / churn : a.price_per_unit * gm * a.horizon_months;
  const ltvCac = a.cac > 0 ? r2(ltv / a.cac) : null;

  return {
    months,
    runway_months: r1(runwayValue),
    runway_capped: runwayCapped,
    avg_monthly_burn: avgBurn,
    breakeven_month: breakevenMonth,
    ending_cash: r2(lastCash),
    total_revenue_horizon: r2(revenues.reduce((s, v) => s + v, 0)),
    ltv: r2(ltv),
    ltv_cac_ratio: ltvCac,
  };
}

type Sensitivity = {
  deltas_pct: number[];
  rows: Array<{
    driver: string;
    label: string;
    cells: Array<{ delta_pct: number; runway_months: number; breakeven_month: number | null; ending_cash: number }>;
  }>;
};

function sensitivity(a: Assumptions): Sensitivity {
  const drivers: Array<[keyof Assumptions, string]> = [
    ['price_per_unit', 'Price per unit'],
    ['units_month_0', 'Starting units'],
    ['cac', 'CAC'],
  ];
  const deltas = [-0.20, -0.10, 0.0, 0.10, 0.20];
  const rows = drivers.map(([key, label]) => {
    const cells = deltas.map((d) => {
      const payload: Assumptions = { ...a, [key]: Math.max(0, (a[key] as number) * (1 + d)) };
      const r = projectFinancials(payload);
      return {
        delta_pct: Math.round(d * 100),
        runway_months: r.runway_months,
        breakeven_month: r.breakeven_month,
        ending_cash: r.ending_cash,
      };
    });
    return { driver: String(key), label, cells };
  });
  return { deltas_pct: deltas.map((d) => Math.round(d * 100)), rows };
}

type CapitalRecompute = {
  category: 'capital';
  max: 10;
  total: number;
  factors: {
    burn_efficiency: { raw: number; points: number; max: 5; label: string; source: string };
    runway: { raw: number; points: number; max: 5; label: string; source: string };
  };
};

function capitalRecompute(_a: Assumptions, computed: Computed): CapitalRecompute {
  const runway = computed.runway_months || 0;
  const runwaySlider = clamp(runway / 2.4, 0, 10);
  const ratio = computed.ltv_cac_ratio;
  const burnSlider = ratio == null ? 5.0 : clamp(ratio * 3.0, 0, 10);
  const burnPts = r2((burnSlider / 10) * 5);
  const runwayPts = r2((runwaySlider / 10) * 5);
  const total = r2(Math.min(burnPts + runwayPts, 10));
  return {
    category: 'capital',
    max: 10,
    total,
    factors: {
      burn_efficiency: {
        raw: r2(burnSlider), points: burnPts, max: 5,
        label: 'Burn efficiency', source: 'ltv_cac_ratio',
      },
      runway: {
        raw: r2(runwaySlider), points: runwayPts, max: 5,
        label: 'Runway / unit econ.', source: 'runway_months',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Authorization helpers — port of _ensure_can_view / _ensure_can_edit.
// ---------------------------------------------------------------------------
type Project = { id: number; name: string; founder_id: number | null; company_id?: number | null };

/**
 * Load a project, narrowed to the caller's active company — stage 2 of company
 * scoping, the same shape progress.ts took in stage 1.
 *
 * Returns null rather than throwing because every call site below already
 * reads `if (!project) return 404`, which is exactly what a `companyScope`
 * query would produce: the row is not there. 404 is also the honest status —
 * the project is the caller's own, it is just not in the workspace they have
 * selected.
 *
 * Privileged callers are exempt because `projects.company_id` is the FOUNDER's
 * company; a partner's active company is their agency, an id this column never
 * carries, and narrowing them by it would erase their access rather than
 * restrict it. `projectInActiveCompany` takes no actor for this reason — the
 * decision that this is the ownership path is made here, once.
 *
 * `submitted_by` is deliberately not selected: `projects` does not have that
 * column on prod (it lives on `issues` — schema.sql:418) and selecting it
 * 500'd the GET handler once already.
 */
async function loadProject(
  c: Context<{ Bindings: Env }>, projectId: number, user: { role: string },
): Promise<Project | null> {
  const row = await c.env.DB.prepare(
    'SELECT id, name, founder_id, company_id FROM projects WHERE id = ?',
  ).bind(projectId).first<Project>();
  if (!row) return null;
  if (isPrivileged(user.role)) return row;
  return projectInActiveCompany(await activeCompanyFor(c, user), row) ? row : null;
}

/** The caller's active company for this request, verified once and memoised. */
async function activeCompanyFor(c: Context<{ Bindings: Env }>, user: any): Promise<number | null> {
  const cached = (c as any).get?.(ACTIVE_COMPANY_KEY);
  if (cached !== undefined) return cached as number | null;
  const id = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  (c as any).set?.(ACTIVE_COMPANY_KEY, id);
  return id;
}
const ACTIVE_COMPANY_KEY = '__activeCompanyId';

function isPrivileged(role: string): boolean {
  // Task #3 (DF) — investor removed from read-allowlist per IDOR contract.
  return role === 'admin' || role === 'partner';
}

function ensureCanView(project: Project, user: { role: string; founder_id?: number | null }) {
  if (isPrivileged(user.role)) return;
  if (!canAccessFounderResource(user as any, project.founder_id)) {
    throw new Error('Forbidden');
  }
}

function ensureCanEdit(project: Project, user: { role: string; founder_id?: number | null }) {
  if (user.role === 'admin') return;
  if (user.role === 'founder') {
    if (!canAccessFounderResource(user as any, project.founder_id)) {
      throw new Error('Forbidden');
    }
    return;
  }
  throw new Error('Forbidden');
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
financials.get('/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c, projectId, user);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);

  await ensureFinancialsModelSchema(c.env);
  let fm: any = null;
  try {
    fm = await c.env.DB.prepare(
      'SELECT * FROM financial_models WHERE project_id = ?',
    ).bind(projectId).first<any>();
  } catch (e) {
    // Table missing or column drift — fall through to hydrated default
    // so the page still renders an editable scaffold.
    console.error('[financials] GET select failed:', (e as Error).message);
  }

  if (!fm) {
    const a = normalizeAssumptions(null);
    const computed = projectFinancials(a);
    return c.json({
      exists: false,
      project_id: projectId,
      project_name: project.name,
      assumptions: a,
      computed,
      sensitivity: sensitivity(a),
      capital_recompute: capitalRecompute(a, computed),
      updated_at: null,
    });
  }
  return c.json({
    exists: true,
    project_id: projectId,
    project_name: project.name,
    assumptions: safeJsonParse<Partial<Assumptions>>(fm.assumptions_json, {}),
    computed: safeJsonParse<Partial<Computed>>(fm.computed_json, {}),
    sensitivity: safeJsonParse<Partial<Sensitivity>>(fm.sensitivity_json, {}),
    capital_recompute: fm.capital_recompute_json
      ? safeJsonParse<Partial<CapitalRecompute>>(fm.capital_recompute_json, {} as any)
      : null,
    updated_at: fm.updated_at || null,
  });
});

financials.put('/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c, projectId, user);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);
  await ensureFinancialsModelSchema(c.env);

  const body = await c.req.json().catch(() => null);
  if (body == null || typeof body !== 'object' || !('assumptions' in body)) {
    return c.json({ detail: 'Body must be { assumptions: { ... } }' }, 400);
  }
  // Strict validation matches FastAPI's Pydantic 422 behaviour — a bad
  // client payload now returns 400 with the field errors rather than
  // silently overwriting the saved model with default values.
  const validated = validateAssumptionsStrict((body as any).assumptions);
  if (!validated.ok) {
    return c.json({ detail: 'Invalid assumptions', errors: validated.errors }, 400);
  }
  const a = validated.value;
  const computed = projectFinancials(a);
  const sens = sensitivity(a);
  const capital = capitalRecompute(a, computed);
  const now = new Date().toISOString();

  // INSERT … ON CONFLICT(project_id) DO UPDATE — atomic upsert keyed by
  // the project_id unique index. The legacy `schema.sql` shape carries
  // NOT-NULL `name` / `inputs_json` columns from a prior placeholder
  // table; if present we must supply deterministic values on INSERT or
  // SQLite raises a NOT NULL constraint error. The ensure() helper
  // populates `_financialsLegacyCols` so we can build the column list
  // dynamically here.
  const legacy = getFinancialsLegacyCols();
  const cols = ['project_id', 'assumptions_json', 'computed_json', 'sensitivity_json', 'capital_recompute_json', 'updated_by', 'updated_at'];
  const vals: unknown[] = [
    projectId,
    JSON.stringify(a),
    JSON.stringify(computed),
    JSON.stringify(sens),
    JSON.stringify(capital),
    user.id,
    now,
  ];
  if (legacy.has('name')) { cols.push('name'); vals.push(project.name); }
  if (legacy.has('inputs_json')) { cols.push('inputs_json'); vals.push(JSON.stringify(a)); }
  const placeholders = cols.map(() => '?').join(', ');
  try {
    await c.env.DB.prepare(
      `INSERT INTO financial_models (${cols.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(project_id) DO UPDATE SET
         assumptions_json       = excluded.assumptions_json,
         computed_json          = excluded.computed_json,
         sensitivity_json       = excluded.sensitivity_json,
         capital_recompute_json = excluded.capital_recompute_json,
         updated_by             = excluded.updated_by,
         updated_at             = excluded.updated_at`,
    ).bind(...vals).run();
  } catch (e) {
    const msg = (e as Error).message || '';
    console.error('[financials] PUT upsert:', msg);
    const drift = /no such (table|column)|constraint|unique/i.test(msg);
    return c.json(
      { detail: drift ? 'Financial model store not ready, please retry.' : 'Failed to save financial model', code: drift ? 'schema_drift' : 'write_failed' },
      drift ? 503 : 500,
    );
  }

  // Activity log — match the Python message shape (best-effort).
  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
    ).bind(
      'financial_model_saved',
      `Project ${project.name}: runway=${computed.runway_months}mo, breakeven=${computed.breakeven_month}, capital_score=${capital.total}/10`,
      String(user.id),
      user.id,
    ).run();
  } catch {
    // activity_logs schema drift — never fail the save on a log write.
  }

  return c.json({
    exists: true,
    project_id: projectId,
    project_name: project.name,
    assumptions: a,
    computed,
    sensitivity: sens,
    capital_recompute: capital,
    updated_at: now,
  });
});

financials.post('/:projectId/recompute', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c, projectId, user);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);
  await ensureFinancialsModelSchema(c.env);

  let fm: { assumptions_json: string } | null = null;
  try {
    fm = await c.env.DB.prepare(
      'SELECT assumptions_json FROM financial_models WHERE project_id = ?',
    ).bind(projectId).first<{ assumptions_json: string }>();
  } catch (e) { console.error('[financials] recompute select:', (e as Error).message); }
  if (!fm) return c.json({ detail: 'No financial model saved yet' }, 404);

  const a = normalizeAssumptions(safeJsonParse<Partial<Assumptions>>(fm.assumptions_json, {}));
  const computed = projectFinancials(a);
  const sens = sensitivity(a);
  const capital = capitalRecompute(a, computed);
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE financial_models
        SET computed_json = ?, sensitivity_json = ?, capital_recompute_json = ?, updated_at = ?
      WHERE project_id = ?`,
  ).bind(JSON.stringify(computed), JSON.stringify(sens), JSON.stringify(capital), now, projectId).run();

  return c.json({ computed, sensitivity: sens, capital_recompute: capital });
});

// CSV export — the worker has no openpyxl/SheetJS, so per the T11 spec we
// return CSV with the same column shape and adjust the frontend's
// download helper to detect content-type. The .xlsx path remains for
// back-compat URL stability; the response is `text/csv`.
function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

financials.get('/:projectId/export.xlsx', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c, projectId, user);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);
  await ensureFinancialsModelSchema(c.env);

  let fm: { assumptions_json: string } | null = null;
  try {
    fm = await c.env.DB.prepare(
      'SELECT assumptions_json FROM financial_models WHERE project_id = ?',
    ).bind(projectId).first<{ assumptions_json: string }>();
  } catch (e) { console.error('[financials] export select:', (e as Error).message); }
  const a = normalizeAssumptions(
    fm ? safeJsonParse<Partial<Assumptions>>(fm.assumptions_json, {}) : null,
  );
  const computed = projectFinancials(a);
  const sens = sensitivity(a);
  const capital = capitalRecompute(a, computed);

  const lines: string[] = [];
  lines.push(`# ${project.name} — Financial Model`);
  lines.push('');
  lines.push('## Assumptions');
  lines.push('Driver,Value');
  for (const [k, v] of Object.entries(a)) lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  lines.push('');
  lines.push('## Projection');
  lines.push('Month,Units,Revenue,Gross Profit,Marketing,Fixed Cost,Net,Cash');
  for (const m of computed.months) {
    lines.push([m.month, m.units, m.revenue, m.gross_profit, m.marketing, m.fixed_cost, m.net, m.cash].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('Metric,Value');
  const summary: Array<[string, unknown]> = [
    ['Runway (months)', computed.runway_months],
    ['Avg monthly burn', computed.avg_monthly_burn],
    ['Breakeven month', computed.breakeven_month ?? 'Not within horizon'],
    ['Ending cash', computed.ending_cash],
    ['Total revenue (horizon)', computed.total_revenue_horizon],
    ['LTV', computed.ltv],
    ['LTV / CAC', computed.ltv_cac_ratio],
    ['Capital score (recompute)', `${capital.total} / 10`],
  ];
  for (const [k, v] of summary) lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  lines.push('');
  lines.push('## Sensitivity');
  lines.push(['Driver', ...sens.deltas_pct.map((d) => `${d >= 0 ? '+' : ''}${d}% (runway mo)`)].map(csvEscape).join(','));
  for (const row of sens.rows) {
    lines.push([row.label, ...row.cells.map((c) => c.runway_months)].map(csvEscape).join(','));
  }

  const safeName = project.name.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}_financials.csv"`,
    },
  });
});

export default financials;
