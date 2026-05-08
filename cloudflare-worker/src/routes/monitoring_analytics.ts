/**
 * Task #3 — Admin analytics endpoints, mounted at /api/monitoring/analytics.
 * Every route is admin-only via requireAdmin (Cloudflare Access perimeter
 * additionally restricts the whole worker in production, see deploy docs).
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
 * R2 storage key: `analytics-exports/<admin_id>/<isoTs>-<rand>.<ext>`
 * Download URL: `${APP_URL or origin}/api/monitoring/analytics/download/<token>`
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin } from '../auth';
import {
  parseRange, BadRangeError, loadOverview, loadCohorts, loadUsers, loadUser,
  loadFinancial, loadTechnical,
  reportToCsv, reportToHtml,
  signDownloadToken, verifyDownloadToken,
} from '../services/analyticsReports';

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

// ---------- read endpoints ----------
function tryParseRange(c: any): { range: ReturnType<typeof parseRange> } | { err: Response } {
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
  return c.json(await loadOverview(c.env, p.range));
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
  return c.json(await loadFinancial(c.env, p.range));
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
  const rows = await sql`
    SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
           a.action, a.report_type, a.format, a.filters_json,
           a.download_url, a.exported_at
    FROM admin_audit_log a
    LEFT JOIN users u ON u.id = a.admin_user_id
    WHERE a.action = 'analytics_export'
    ORDER BY a.exported_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const totalRow = await sql`SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = 'analytics_export'`;
  const total = Number((totalRow as any[])[0]?.c || 0);
  return c.json({ items: rows, total, limit, offset, has_more: offset + (rows as any[]).length < total });
});

// ---------- export ----------
r.post('/export', async (c) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const report = String(body.report || 'overview').toLowerCase();
  const format = (String(body.format || 'csv').toLowerCase() === 'pdf' ? 'pdf' : 'csv') as 'csv' | 'pdf';
  const allowedReports = new Set(['overview', 'users', 'financial', 'technical', 'management']);
  if (!allowedReports.has(report)) return c.json({ detail: 'Invalid report' }, 400);
  let range: ReturnType<typeof parseRange>;
  try { range = parseRange(body.from || null, body.to || null); }
  catch (e) {
    if (e instanceof BadRangeError) return c.json({ detail: e.message }, 400);
    throw e;
  }
  const filters = body.filters || {};

  // Gather data
  let data: any;
  if (report === 'overview') data = await loadOverview(c.env, range);
  else if (report === 'financial') data = await loadFinancial(c.env, range);
  else if (report === 'technical') data = await loadTechnical(c.env, range);
  else if (report === 'users') data = await loadUsers(c.env, {
    role: filters.role || null, tier: filters.tier || null, search: filters.search || null,
    limit: clampInt(filters.limit, 200, 1, 1000), offset: 0,
  });
  else /* management */ data = {
    overview: await loadOverview(c.env, range),
    financial: await loadFinancial(c.env, range),
    technical: await loadTechnical(c.env, range),
  };

  // Render
  let bodyStr: string;
  let contentType: string;
  let ext: string;
  if (format === 'csv') {
    bodyStr = reportToCsv(report, data);
    contentType = 'text/csv; charset=utf-8';
    ext = 'csv';
  } else {
    // PDF: render styled HTML. If a Browser Rendering binding (`BROWSER`) is
    // configured, use it to convert HTML→PDF; otherwise fall back to HTML
    // (browsers can print-to-PDF). The download URL/extension reflects the
    // actual artifact so the user is never misled about the format.
    const html = reportToHtml(report, data, range);
    const browser = (c.env as any).BROWSER;
    if (browser && typeof browser.fetch === 'function') {
      try {
        // Cloudflare Browser Rendering REST contract — POST { html } returns PDF bytes.
        const res = await browser.fetch('https://browser.local/pdf', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ html }),
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          bodyStr = '';
          // store as binary below
          (data as any).__pdfBuf = buf;
          contentType = 'application/pdf';
          ext = 'pdf';
        } else {
          bodyStr = html; contentType = 'text/html; charset=utf-8'; ext = 'html';
        }
      } catch {
        bodyStr = html; contentType = 'text/html; charset=utf-8'; ext = 'html';
      }
    } else {
      bodyStr = html; contentType = 'text/html; charset=utf-8'; ext = 'html';
    }
  }

  // Upload to R2
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const randHex = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `analytics-exports/${admin.id}/${ts}-${report}-${randHex}.${ext}`;

  const r2 = c.env.FILES;
  if (!r2) {
    // No R2 binding — fall back to inline base64 download. This keeps dev
    // working without R2 wiring.
    const inline = `data:${contentType};base64,${btoa(bodyStr)}`;
    return c.json({
      download_url: inline,
      storage: 'inline',
      report, format: ext, range: { from: range.from, to: range.to },
    });
  }
  const r2Body: ArrayBuffer | string = (data as any).__pdfBuf ? (data as any).__pdfBuf as ArrayBuffer : bodyStr;
  await r2.put(key, r2Body, { httpMetadata: { contentType } });

  const token = await signDownloadToken(c.env, key, 86400);
  const origin = new URL(c.req.url).origin;
  const downloadUrl = `${origin}/api/monitoring/analytics/download/${token}`;

  // Audit log
  try {
    const sql = getSQL(c.env);
    await sql`
      INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
      VALUES (${admin.id}, 'analytics_export', ${report}, ${ext},
              ${JSON.stringify({ from: range.from, to: range.to, ...filters })},
              ${key}, ${downloadUrl})
    `;
  } catch (e) {
    console.warn('[analytics] audit insert failed:', (e as Error).message);
  }

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
  // Encourage download with the original filename.
  const filename = v.key.split('/').pop() || 'export';
  headers.set('content-disposition', `attachment; filename="${filename}"`);
  return new Response(obj.body, { status: 200, headers });
});

export default r;
