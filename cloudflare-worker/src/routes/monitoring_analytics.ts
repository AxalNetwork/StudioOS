/**
 * Task #3 — Admin analytics endpoints, mounted at /api/monitoring/analytics.
 * Every route is admin-only via requireAdmin.
 *
 * Routes:
 *   GET  /overview?from=&to=
 *   GET  /cohorts?metric=&granularity=
 *   GET  /users?role=&tier=&search=&limit=&offset=
 *   GET  /user/:id
 *   GET  /financial?from=&to=
 *   GET  /technical?from=&to=
 *   POST /export                        body { report, format, from, to, filters }
 *   GET  /audit?limit=&offset=          (Recent Exports panel)
 *   GET  /download/:token               (HMAC-gated R2 fetch)
 *
 * Storage key: `analytics-exports/<admin_id>/<isoTs>-<rand>.<ext>`
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin } from '../auth';
import {
  parseRange, BadRangeError, loadOverview, loadCohorts, loadUsers, loadUser,
  loadFinancial, loadTechnical,
  reportToCsv, reportToHtml,
  signDownloadToken, verifyDownloadToken,
  planAuditToCsv, type PlanAuditRow,
  backfillSnapshots,
} from '../services/analyticsReports';
import { ensureSubscriptionPlansSchema, listPlansFull, updatePlan, createPlan, deletePlan, PlanCreateError } from '../services/subscriptionPlans';

type AppCtx = Context<{ Bindings: Env }>;
type ExportReport = 'overview' | 'users' | 'financial' | 'technical' | 'management';

interface BrowserBinding {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}
interface AuditInsert {
  adminId: number;
  report: ExportReport;
  format: string;
  filtersJson: string;
  storageKey: string | null;
  downloadUrl: string;
}

const r = new Hono<{ Bindings: Env }>();

const clampInt = (raw: string | undefined | null, def: number, min: number, max: number) => {
  const n = parseInt(raw || String(def), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
};

// ---------- ensure schema (idempotent) ----------
let _schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT, exported_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_admin_audit_user_ts ON admin_audit_log(admin_user_id, exported_at DESC)");
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_admin_audit_action_ts ON admin_audit_log(action, exported_at DESC)");
    _schemaReady = true;
  } catch (e) {
    console.warn('[analytics] ensureSchema failed:', (e as Error).message);
  }
}

async function writeAudit(env: Env, a: AuditInsert): Promise<void> {
  try {
    const sql = getSQL(env);
    await sql`
      INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
      VALUES (${a.adminId}, 'analytics_export', ${a.report}, ${a.format}, ${a.filtersJson}, ${a.storageKey}, ${a.downloadUrl})
    `;
  } catch (e) {
    console.warn('[analytics] audit insert failed:', (e as Error).message);
  }
}

// ---------- read endpoints ----------
function tryParseRange(c: AppCtx) {
  try { return { range: parseRange(c.req.query('from'), c.req.query('to')) }; }
  catch (e) {
    if (e instanceof BadRangeError) return { err: c.json({ detail: e.message }, 400) };
    throw e;
  }
}

r.get('/overview', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const p = tryParseRange(c); if ('err' in p) return p.err;
  return c.json(await loadOverview(c.env, p.range, c.req.query('currency')));
});

// Task #14 — list of currencies the analytics layer can display in. Drives
// the dropdown on the Admin Analytics tab. Sourced from `fx_rates`.
r.get('/currencies', async (c) => {
  await requireAdmin(c);
  // Self-heal in case migration 005 hasn't been applied yet — matches the
  // pattern used by /overview and /financial.
  await ensureSubscriptionPlansSchema(c.env);
  const sql = getSQL(c.env);
  const rowsRaw = await sql`SELECT currency, usd_rate, updated_at FROM fx_rates ORDER BY currency ASC`;
  const arr = Array.isArray(rowsRaw) ? rowsRaw : [];
  return c.json({ currencies: arr });
});

r.get('/cohorts', async (c) => {
  await requireAdmin(c);
  const metric = (c.req.query('metric') === 'revenue' ? 'revenue' : 'retention') as 'retention' | 'revenue';
  const granularity = (c.req.query('granularity') === 'month' ? 'month' : 'week') as 'week' | 'month';
  return c.json(await loadCohorts(c.env, granularity, metric));
});

r.get('/users', async (c) => {
  await requireAdmin(c);
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 100000);
  const role = c.req.query('role') || null;
  const tier = c.req.query('tier') || null;
  const search = c.req.query('search') || null;
  return c.json(await loadUsers(c.env, { role, tier, search, limit, offset }));
});

r.get('/user/:id', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const out = await loadUser(c.env, id);
  if (!out) return c.json({ detail: 'Not found' }, 404);
  return c.json(out);
});

r.get('/financial', async (c) => {
  await requireAdmin(c);
  const p = tryParseRange(c); if ('err' in p) return p.err;
  return c.json(await loadFinancial(c.env, p.range, c.req.query('currency')));
});

r.get('/technical', async (c) => {
  await requireAdmin(c);
  const p = tryParseRange(c); if ('err' in p) return p.err;
  return c.json(await loadTechnical(c.env, p.range));
});

// Task #13 — server-composed Management view: a single fetch returns
// overview + financial + technical, so the Management sub-tab on the
// frontend doesn't compose three round-trips client-side.
r.get('/management', async (c) => {
  await requireAdmin(c);
  const p = tryParseRange(c); if ('err' in p) return p.err;
  const ccy = c.req.query('currency');
  const [overview, financial, technical] = await Promise.all([
    loadOverview(c.env, p.range, ccy),
    loadFinancial(c.env, p.range, ccy),
    loadTechnical(c.env, p.range),
  ]);
  return c.json({ overview, financial, technical });
});

// Task #13 — admin-gated rebuild of the daily snapshot rollups. Useful
// after a deploy that fixed a metric, or to backfill the table on first
// rollout. `days` is clamped to 1..90 (max 90 ≈ 3 months in one call).
r.post('/snapshots/backfill', async (c) => {
  await requireAdmin(c);
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {}
  const days = clampInt(String(body.days ?? '7'), 7, 1, 90);
  const result = await backfillSnapshots(c.env, days);
  return c.json({ ok: true, days_requested: days, ...result });
});

// ---------- recent exports ----------
// Parse YYYY-MM-DD into a 'YYYY-MM-DD HH:MM:SS' bound (start-of-day for `from`,
// end-of-day for `to`). Returns null for empty/invalid input so callers can
// silently drop the predicate rather than 400.
function parseDateBound(raw: string | undefined, end: boolean): string | null {
  if (!raw) return null;
  const s = raw.toString().trim();
  if (!s) return null;
  // Accept YYYY-MM-DD only — no times, no tz; matches HTML <input type=date>.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${end ? '23:59:59' : '00:00:00'}`;
}

function buildAuditWhere(opts: {
  action: string;
  planId: string | null;
  adminUserId: number | null;
  adminQ: string | null;
  fromBound: string | null;
  toBound: string | null;
}): { where: string; params: any[] } {
  const clauses: string[] = ['a.action = ?'];
  const params: any[] = [opts.action];
  if (opts.planId) { clauses.push('a.report_type = ?'); params.push(opts.planId); }
  if (opts.adminUserId !== null) { clauses.push('a.admin_user_id = ?'); params.push(opts.adminUserId); }
  if (opts.adminQ) {
    clauses.push('(LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)');
    params.push(opts.adminQ, opts.adminQ);
  }
  if (opts.fromBound) { clauses.push('a.exported_at >= ?'); params.push(opts.fromBound); }
  if (opts.toBound) { clauses.push('a.exported_at <= ?'); params.push(opts.toBound); }
  return { where: clauses.join(' AND '), params };
}

// Task #4 (AJ) — spec alias. The richer `/audit` endpoint backs the
// "Recent Exports" panel and supports filtering by action, admin, plan,
// date range, etc. `/exports/recent` is the contract-named convenience
// shape: most-recent N analytics exports for the current admin's view,
// no extra filters. Defers entirely to the same handler logic by
// pre-seeding query defaults so we never duplicate the audit SQL.
r.get('/exports/recent', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  // Spec default for /exports/recent is the last 20 entries; /audit uses 25.
  const limit = clampInt(c.req.query('limit'), 20, 1, 100);
  const offset = clampInt(c.req.query('offset'), 0, 0, 100000);
  const { where, params } = buildAuditWhere({
    action: 'analytics_export',
    planId: null, adminUserId: null, adminQ: null,
    fromBound: null, toBound: null,
  });
  const items = await sql.unsafe(
    `SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
            a.action, a.report_type, a.format, a.filters_json,
            a.download_url, a.exported_at
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     WHERE ${where}
     ORDER BY a.exported_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const totalRow = await sql.unsafe(
    `SELECT COUNT(*) AS c FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE ${where}`,
    params,
  );
  return c.json({
    items,
    total: Number((totalRow as Array<{ c: number }>)[0]?.c ?? 0),
    limit, offset,
  });
});

r.get('/audit', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const limit = clampInt(c.req.query('limit'), 25, 1, 100);
  const offset = clampInt(c.req.query('offset'), 0, 0, 100000);
  const ALLOWED_ACTIONS = ['analytics_export', 'subscription_plan_update'] as const;
  const requested = (c.req.query('action') || 'analytics_export').toString();
  const action = (ALLOWED_ACTIONS as readonly string[]).includes(requested) ? requested : 'analytics_export';
  const planIdRaw = (c.req.query('plan_id') || '').toString().trim();
  const adminIdRaw = (c.req.query('admin_user_id') || '').toString().trim();
  const adminQRaw = (c.req.query('admin_q') || '').toString().trim();
  const fromRaw = (c.req.query('from') || '').toString().trim();
  const toRaw = (c.req.query('to') || '').toString().trim();
  const planId = planIdRaw.slice(0, 100) || null;
  const adminUserId = adminIdRaw && /^\d+$/.test(adminIdRaw) ? Number(adminIdRaw) : null;
  const adminQ = adminQRaw ? `%${adminQRaw.slice(0, 100).toLowerCase()}%` : null;
  const fromBound = parseDateBound(fromRaw, false);
  const toBound = parseDateBound(toRaw, true);

  const { where, params } = buildAuditWhere({ action, planId, adminUserId, adminQ, fromBound, toBound });
  const items = await sql.unsafe(
    `SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
            a.action, a.report_type, a.format, a.filters_json,
            a.download_url, a.exported_at
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     WHERE ${where}
     ORDER BY a.exported_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRow = await sql.unsafe(
    `SELECT COUNT(*) AS c FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     WHERE ${where}`,
    params
  );
  const itemsArr = Array.isArray(items) ? items : [];
  const totalArr = Array.isArray(totalRow) ? totalRow : [];
  const total = Number((totalArr[0] as { c?: number } | undefined)?.c || 0);
  return c.json({
    items: itemsArr,
    total,
    limit,
    offset,
    has_more: offset + itemsArr.length < total,
    filters: {
      action,
      plan_id: planId,
      admin_user_id: adminUserId,
      admin_q: adminQRaw || null,
      from: fromBound ? fromRaw : null,
      to: toBound ? toRaw : null,
    },
  });
});

// ---------- Task #20: CSV export of the Plan change history panel ----------
// Mirrors the /audit filters (plan_id, admin_user_id, admin_q) for action=
// 'subscription_plan_update'. Hard-capped at 10k rows so a single bad request
// can't pull the whole table; finance reviews are batched by date elsewhere.
r.get('/audit/export.csv', async (c) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const planIdRaw = (c.req.query('plan_id') || '').toString().trim();
  const adminIdRaw = (c.req.query('admin_user_id') || '').toString().trim();
  const adminQRaw = (c.req.query('admin_q') || '').toString().trim();
  const fromRaw = (c.req.query('from') || '').toString().trim();
  const toRaw = (c.req.query('to') || '').toString().trim();
  const planId = planIdRaw.slice(0, 100) || null;
  const adminUserId = adminIdRaw && /^\d+$/.test(adminIdRaw) ? Number(adminIdRaw) : null;
  const adminQ = adminQRaw ? `%${adminQRaw.slice(0, 100).toLowerCase()}%` : null;
  const fromBound = parseDateBound(fromRaw, false);
  const toBound = parseDateBound(toRaw, true);
  const action = 'subscription_plan_update';
  const MAX_ROWS = 10000;

  const { where, params } = buildAuditWhere({ action, planId, adminUserId, adminQ, fromBound, toBound });
  const rows = await sql.unsafe(
    `SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
            a.report_type, a.format, a.filters_json, a.exported_at
     FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
     WHERE ${where}
     ORDER BY a.exported_at DESC LIMIT ?`,
    [...params, MAX_ROWS]
  );
  const arr = (Array.isArray(rows) ? rows : []) as PlanAuditRow[];
  const csv = planAuditToCsv(arr);

  // Audit row so finance can see who pulled what + when.
  const filtersJson = JSON.stringify({
    plan_id: planId,
    admin_user_id: adminUserId,
    admin_q: adminQRaw || null,
    from: fromBound ? fromRaw : null,
    to: toBound ? toRaw : null,
    row_count: arr.length,
  });
  await writeAudit(c.env, {
    adminId: admin.id,
    report: 'subscription_plan_audit' as ExportReport,
    format: 'csv',
    filtersJson,
    storageKey: null,
    downloadUrl: '',
  });

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const planTag = planId ? `-${planId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)}` : '';
  const filename = `plan-change-history${planTag}-${ts}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});

// ---------- plan catalog (Task #13) ----------
r.get('/plans', async (c) => {
  await requireAdmin(c);
  const plans = await listPlansFull(c.env);
  return c.json({ plans });
});

r.post('/plans', async (c) => {
  const admin = await requireAdmin(c);
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {}
  let plan;
  try {
    plan = await createPlan(c.env, {
      plan_id: String(body.plan_id ?? ''),
      monthly_price_usd: body.monthly_price_usd === undefined || body.monthly_price_usd === null || body.monthly_price_usd === ''
        ? undefined
        : Number(body.monthly_price_usd),
      display_name: body.display_name === undefined ? null : (body.display_name as string | null),
      stripe_price_id: body.stripe_price_id === undefined ? null : (body.stripe_price_id as string | null),
      currency: body.currency === undefined ? null : (body.currency as string | null),
      native_amount: body.native_amount === undefined || body.native_amount === null || body.native_amount === ''
        ? null
        : Number(body.native_amount),
    });
  } catch (e) {
    if (e instanceof PlanCreateError) return c.json({ detail: e.message }, e.status as 400 | 409 | 500);
    console.warn('[analytics] createPlan unexpected error:', (e as Error).message);
    return c.json({ detail: (e as Error).message || 'Create failed' }, 500);
  }
  await ensureSchema(c.env);
  try {
    const sql = getSQL(c.env);
    const filtersJson = JSON.stringify({
      plan_id: plan.plan_id,
      created: true,
      monthly_price_usd: plan.monthly_price_usd,
      display_name: plan.display_name,
      stripe_price_id: plan.stripe_price_id,
      currency: plan.currency,
      native_amount: plan.native_amount,
    });
    await sql`
      INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
      VALUES (${admin.id}, 'subscription_plan_update', ${plan.plan_id}, 'create', ${filtersJson}, NULL, '')
    `;
  } catch (e) {
    console.warn('[analytics] plan create audit failed:', (e as Error).message);
  }
  return c.json({ plan }, 201);
});

r.patch('/plans/:planId', async (c) => {
  const admin = await requireAdmin(c);
  const planId = c.req.param('planId');
  if (!planId) return c.json({ detail: 'Missing planId' }, 400);
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {}
  const patch: { monthly_price_usd?: number; display_name?: string | null; is_active?: boolean; native_amount?: number; currency?: string } = {};
  if (body.monthly_price_usd !== undefined) {
    const n = Number(body.monthly_price_usd);
    if (!Number.isFinite(n) || n < 0) return c.json({ detail: 'monthly_price_usd must be ≥ 0' }, 400);
    patch.monthly_price_usd = n;
  }
  // Task #25 — non-USD plans edit by native amount; service derives USD via fx_rates.
  if (body.native_amount !== undefined && body.native_amount !== null && body.native_amount !== '') {
    const n = Number(body.native_amount);
    if (!Number.isFinite(n) || n < 0) return c.json({ detail: 'native_amount must be ≥ 0' }, 400);
    patch.native_amount = n;
  }
  // Task #22 — allow currency change; service re-derives USD from fx_rates
  // using the new currency + (patched or existing) native_amount.
  if (body.currency !== undefined && body.currency !== null && body.currency !== '') {
    const code = String(body.currency).toUpperCase().trim();
    if (!/^[A-Z]{3}$/.test(code)) return c.json({ detail: 'currency must be a 3-letter ISO 4217 code' }, 400);
    patch.currency = code;
  }
  if (body.display_name !== undefined) {
    patch.display_name = body.display_name == null ? null : String(body.display_name);
  }
  if (body.is_active !== undefined) {
    patch.is_active = !!body.is_active;
  }
  let updated;
  try { updated = await updatePlan(c.env, planId, patch); }
  catch (e) { return c.json({ detail: (e as Error).message }, 400); }
  if (!updated) return c.json({ detail: 'Plan not found' }, 404);
  await ensureSchema(c.env);
  try {
    const sql = getSQL(c.env);
    const filtersJson = JSON.stringify({ plan_id: planId, ...patch });
    await sql`
      INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
      VALUES (${admin.id}, 'subscription_plan_update', ${planId}, 'patch', ${filtersJson}, NULL, '')
    `;
  } catch (e) {
    console.warn('[analytics] plan update audit failed:', (e as Error).message);
  }
  return c.json({ plan: updated });
});

r.delete('/plans/:planId', async (c) => {
  const admin = await requireAdmin(c);
  const planId = c.req.param('planId');
  if (!planId) return c.json({ detail: 'Missing planId' }, 400);
  let deleted;
  try {
    deleted = await deletePlan(c.env, planId);
  } catch (e) {
    if (e instanceof PlanCreateError) return c.json({ detail: e.message }, e.status as 400 | 409 | 500);
    console.warn('[analytics] deletePlan unexpected error:', (e as Error).message);
    return c.json({ detail: (e as Error).message || 'Delete failed' }, 500);
  }
  if (!deleted) return c.json({ detail: 'Plan not found' }, 404);
  await ensureSchema(c.env);
  try {
    const sql = getSQL(c.env);
    const filtersJson = JSON.stringify({
      plan_id: planId,
      deleted: true,
      display_name: deleted.display_name,
      monthly_price_usd: deleted.monthly_price_usd,
      currency: deleted.currency,
    });
    await sql`
      INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
      VALUES (${admin.id}, 'subscription_plan_update', ${planId}, 'delete', ${filtersJson}, NULL, '')
    `;
  } catch (e) {
    console.warn('[analytics] plan delete audit failed:', (e as Error).message);
  }
  return c.json({ ok: true, plan: deleted });
});

// ---------- export ----------
r.post('/export', async (c) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {}
  const reportRaw = String(body.report || 'overview').toLowerCase();
  const allowedReports = new Set<ExportReport>(['overview', 'users', 'financial', 'technical', 'management']);
  if (!allowedReports.has(reportRaw as ExportReport)) return c.json({ detail: 'Invalid report' }, 400);
  const report = reportRaw as ExportReport;
  const format = (String(body.format || 'csv').toLowerCase() === 'pdf' ? 'pdf' : 'csv') as 'csv' | 'pdf';
  let range;
  try { range = parseRange(typeof body.from === 'string' ? body.from : null, typeof body.to === 'string' ? body.to : null); }
  catch (e) {
    if (e instanceof BadRangeError) return c.json({ detail: e.message }, 400);
    throw e;
  }
  const filters = (body.filters && typeof body.filters === 'object') ? body.filters as Record<string, unknown> : {};
  const filtersJson = JSON.stringify({ from: range.from, to: range.to, ...filters });

  // Task #14 — caller can pin the export to a specific display currency.
  const ccy = (typeof body.currency === 'string' ? body.currency : null) ?? (typeof filters.currency === 'string' ? filters.currency : null);

  // Gather data
  let data: unknown;
  if (report === 'overview') data = await loadOverview(c.env, range, ccy);
  else if (report === 'financial') data = await loadFinancial(c.env, range, ccy);
  else if (report === 'technical') data = await loadTechnical(c.env, range);
  else if (report === 'users') data = await loadUsers(c.env, {
    role: (filters.role as string) || null,
    tier: (filters.tier as string) || null,
    search: (filters.search as string) || null,
    limit: clampInt(String(filters.limit ?? ''), 200, 1, 1000),
    offset: 0,
  });
  else /* management */ data = {
    overview: await loadOverview(c.env, range, ccy),
    financial: await loadFinancial(c.env, range, ccy),
    technical: await loadTechnical(c.env, range),
  };

  // Render
  let bodyStr = '';
  let pdfBytes: ArrayBuffer | null = null;
  let contentType = 'application/octet-stream';
  let ext = 'bin';

  if (format === 'csv') {
    bodyStr = reportToCsv(report, data);
    contentType = 'text/csv; charset=utf-8';
    ext = 'csv';
  } else {
    // Task #13 — PDF requested. Try Browser Rendering first; on missing
    // binding OR render failure, fall back to a styled HTML artifact (so
    // the export NEVER errors). The response's `format` field reflects
    // the actual artifact served — the caller's UI shows whatever shipped.
    const html = reportToHtml(report, data, range);
    const browser = (c.env as unknown as { BROWSER?: BrowserBinding }).BROWSER;
    let renderedAsPdf = false;
    if (browser && typeof browser.fetch === 'function') {
      try {
        const res = await browser.fetch('https://browser.local/pdf', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ html }),
        });
        if (!res.ok) throw new Error(`browser rendering returned ${res.status}`);
        pdfBytes = await res.arrayBuffer();
        contentType = 'application/pdf';
        ext = 'pdf';
        renderedAsPdf = true;
      } catch (e) {
        console.warn('[analytics] PDF render failed, falling back to HTML:', (e as Error).message);
      }
    }
    if (!renderedAsPdf) {
      bodyStr = html;
      contentType = 'text/html; charset=utf-8';
      ext = 'html';
    }
  }

  // Build storage key + token
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const randHex = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `analytics-exports/${admin.id}/${ts}-${report}-${randHex}.${ext}`;

  const r2 = c.env.FILES;
  if (!r2) {
    // No R2 binding (dev). Inline data: URL fallback. Audit row still recorded.
    const inline = pdfBytes
      ? `data:${contentType};base64,${btoa(String.fromCharCode(...new Uint8Array(pdfBytes)))}`
      : `data:${contentType};base64,${btoa(bodyStr)}`;
    await writeAudit(c.env, {
      adminId: admin.id, report, format: ext,
      filtersJson, storageKey: null, downloadUrl: inline,
    });
    return c.json({
      download_url: inline,
      storage: 'inline',
      report, format: ext, range: { from: range.from, to: range.to },
    });
  }

  const r2Body: ArrayBuffer | string = pdfBytes ?? bodyStr;
  await r2.put(key, r2Body, { httpMetadata: { contentType } });

  const token = await signDownloadToken(c.env, key, 86400);
  const origin = new URL(c.req.url).origin;
  const downloadUrl = `${origin}/api/monitoring/analytics/download/${token}`;

  await writeAudit(c.env, {
    adminId: admin.id, report, format: ext,
    filtersJson, storageKey: key, downloadUrl,
  });

  return c.json({
    download_url: downloadUrl,
    storage_key: key,
    expires_in_seconds: 86400,
    report, format: ext, range: { from: range.from, to: range.to },
  });
});

// ---------- download (HMAC-gated R2 fetch) ----------
r.get('/download/:token', async (c) => {
  const token = c.req.param('token');
  const v = await verifyDownloadToken(c.env, token);
  if (!v) return c.json({ detail: 'Link expired or invalid' }, 403);
  const r2 = c.env.FILES;
  if (!r2) return c.json({ detail: 'Storage unavailable' }, 503);
  const obj = await r2.get(v.key);
  if (!obj) return c.json({ detail: 'Not found' }, 404);
  const headers = new Headers();
  headers.set('content-type', obj.httpMetadata?.contentType || 'application/octet-stream');
  const filename = v.key.split('/').pop() || 'export';
  headers.set('content-disposition', `attachment; filename="${filename}"`);
  return new Response(obj.body, { status: 200, headers });
});

export default r;
