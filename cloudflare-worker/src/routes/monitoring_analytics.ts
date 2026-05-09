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

// ---------- recent exports ----------
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
  const planId = planIdRaw.slice(0, 100) || null;
  const adminUserId = adminIdRaw && /^\d+$/.test(adminIdRaw) ? Number(adminIdRaw) : null;
  const adminQ = adminQRaw ? `%${adminQRaw.slice(0, 100).toLowerCase()}%` : null;

  let items, totalRow;
  if (planId && adminUserId !== null) {
    items = await sql`
      SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
             a.action, a.report_type, a.format, a.filters_json,
             a.download_url, a.exported_at
      FROM admin_audit_log a
      LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action} AND a.report_type = ${planId} AND a.admin_user_id = ${adminUserId}
      ORDER BY a.exported_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    totalRow = await sql`SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = ${action} AND report_type = ${planId} AND admin_user_id = ${adminUserId}`;
  } else if (planId && adminQ) {
    items = await sql`
      SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
             a.action, a.report_type, a.format, a.filters_json,
             a.download_url, a.exported_at
      FROM admin_audit_log a
      LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action} AND a.report_type = ${planId}
        AND (LOWER(u.email) LIKE ${adminQ} OR LOWER(u.name) LIKE ${adminQ})
      ORDER BY a.exported_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    totalRow = await sql`
      SELECT COUNT(*) AS c FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action} AND a.report_type = ${planId}
        AND (LOWER(u.email) LIKE ${adminQ} OR LOWER(u.name) LIKE ${adminQ})
    `;
  } else if (planId) {
    items = await sql`
      SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
             a.action, a.report_type, a.format, a.filters_json,
             a.download_url, a.exported_at
      FROM admin_audit_log a
      LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action} AND a.report_type = ${planId}
      ORDER BY a.exported_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    totalRow = await sql`SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = ${action} AND report_type = ${planId}`;
  } else if (adminUserId !== null) {
    items = await sql`
      SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
             a.action, a.report_type, a.format, a.filters_json,
             a.download_url, a.exported_at
      FROM admin_audit_log a
      LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action} AND a.admin_user_id = ${adminUserId}
      ORDER BY a.exported_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    totalRow = await sql`SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = ${action} AND admin_user_id = ${adminUserId}`;
  } else if (adminQ) {
    items = await sql`
      SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
             a.action, a.report_type, a.format, a.filters_json,
             a.download_url, a.exported_at
      FROM admin_audit_log a
      LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action}
        AND (LOWER(u.email) LIKE ${adminQ} OR LOWER(u.name) LIKE ${adminQ})
      ORDER BY a.exported_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    totalRow = await sql`
      SELECT COUNT(*) AS c FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action}
        AND (LOWER(u.email) LIKE ${adminQ} OR LOWER(u.name) LIKE ${adminQ})
    `;
  } else {
    items = await sql`
      SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
             a.action, a.report_type, a.format, a.filters_json,
             a.download_url, a.exported_at
      FROM admin_audit_log a
      LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action = ${action}
      ORDER BY a.exported_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    totalRow = await sql`SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = ${action}`;
  }
  const itemsArr = Array.isArray(items) ? items : [];
  const totalArr = Array.isArray(totalRow) ? totalRow : [];
  const total = Number((totalArr[0] as { c?: number } | undefined)?.c || 0);
  return c.json({
    items: itemsArr,
    total,
    limit,
    offset,
    has_more: offset + itemsArr.length < total,
    filters: { action, plan_id: planId, admin_user_id: adminUserId, admin_q: adminQRaw || null },
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
  const patch: { monthly_price_usd?: number; display_name?: string | null; is_active?: boolean } = {};
  if (body.monthly_price_usd !== undefined) {
    const n = Number(body.monthly_price_usd);
    if (!Number.isFinite(n) || n < 0) return c.json({ detail: 'monthly_price_usd must be ≥ 0' }, 400);
    patch.monthly_price_usd = n;
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
  let contentType: string;
  let ext: string;

  if (format === 'csv') {
    bodyStr = reportToCsv(report, data);
    contentType = 'text/csv; charset=utf-8';
    ext = 'csv';
  } else {
    // PDF requires a Browser Rendering binding. We do NOT silently downgrade
    // to HTML — return 503 so the caller can pick CSV instead and the audit
    // record reflects the failure.
    const html = reportToHtml(report, data, range);
    const browser = (c.env as unknown as { BROWSER?: BrowserBinding }).BROWSER;
    if (!browser || typeof browser.fetch !== 'function') {
      await writeAudit(c.env, {
        adminId: admin.id, report, format: 'pdf_unavailable',
        filtersJson, storageKey: null, downloadUrl: '',
      });
      return c.json({
        detail: 'PDF rendering not configured: bind Cloudflare Browser Rendering as BROWSER, or export as CSV.',
      }, 503);
    }
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
    } catch (e) {
      await writeAudit(c.env, {
        adminId: admin.id, report, format: 'pdf_failed',
        filtersJson, storageKey: null, downloadUrl: '',
      });
      return c.json({ detail: `PDF rendering failed: ${(e as Error).message}` }, 502);
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
