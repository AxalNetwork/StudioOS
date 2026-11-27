/**
 * D893 (#2661) — POST /api/admin/insights/export: the Insights figures as a
 * logged, counts-only CSV or PDF.
 *
 *   body  { what: 'page' | 'group', format: 'csv' | 'pdf', range, profile, country, group, scope }
 *   200   { download_url, expires_in_seconds, format, what, range }
 *
 * - `requireAdmin`. The figures come from the Insights read (#2660), called
 *   with the caller's own session and the same filters. Its refusals (403
 *   `hq_only`, 400 on a bad filter) are answered as it answers them, so the
 *   export can never show what the page would not.
 * - Counts only: `services/insightsExport.ts` names every figure, and a file
 *   that still carries an email is refused (500 `export_not_counts_only`).
 * - Logged: one `admin_audit_log` row per export (`action 'insights_export'`,
 *   with `what`, `format`, the range and the filters, never a figure). If the
 *   row cannot be written, the stored file is deleted and no link is handed
 *   out (503 `export_not_logged`): the dialog promises every export is logged.
 * - Delivery: R2 under `insights-exports/<admin>/…`, behind the analytics
 *   export's signed 24-hour link (`/api/monitoring/analytics/download/:token`).
 *   A PDF goes through Browser Run, and falls back to the HTML when it is
 *   unavailable, as the analytics export does; `format` says which shipped.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import adminInsightsRead from './admin_insights';
import { ensureAdminAuditLogTable } from './admin';
import { signDownloadToken } from '../services/analyticsReports';
import {
  INSIGHTS_FORMATS, INSIGHTS_RANGES, INSIGHTS_WHAT, groupRows, metaOf, pageRows, refusesCountsOnly, toCsv, toHtml,
  type InsightsFormat, type InsightsWhat,
} from '../services/insightsExport';

type C = Context<{ Bindings: Env }>;

/** The Insights read for these filters, as `GET /api/admin/insights` answers it to this caller. */
export type InsightsReader = (c: C, query: URLSearchParams) => Promise<{ status: number; body: unknown }>;

interface BrowserBinding { fetch(url: string, init?: RequestInit): Promise<Response> }

const LINK_TTL_SECONDS = 86_400;
const FILTER = /^[\p{L}\p{N} ._'()&-]{1,64}$/u;

const bad = (c: C, code: string, message: string) => c.json({ code: code, detail: message }, 400);

/**
 * The page's own read (#2660), called in-process with the caller's own
 * headers: the same session, the same gates and the same filter rules, so an
 * export can never show what `GET /api/admin/insights` would not.
 */
export const pageRead: InsightsReader = async (c, query) => {
  let ctx: typeof c.executionCtx | undefined;
  try { ctx = c.executionCtx; } catch { /* no execution context outside a live request */ }
  const res = await adminInsightsRead.request(`/?${query.toString()}`, { headers: c.req.raw.headers }, c.env, ctx);
  return { status: res.status, body: await res.json().catch(() => ({ code: 'insights_unreadable', detail: 'The figures could not be read. Try again.' })) };
};

export function insightsExportRoutes(read: InsightsReader = pageRead) {
  const r = new Hono<{ Bindings: Env }>();

  r.post('/', async (c) => {
    const admin = await requireAdmin(c);
    let body: Record<string, unknown> = {};
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* an empty body is the defaults */ }

    const what = String(body.what ?? 'page') as InsightsWhat;
    if (!INSIGHTS_WHAT.includes(what)) return bad(c, 'invalid_what', 'Choose the figures on this page, or this group only.');
    const format = String(body.format ?? 'csv') as InsightsFormat;
    if (!INSIGHTS_FORMATS.includes(format)) return bad(c, 'invalid_format', 'Choose CSV or PDF.');
    const range = String(body.range ?? '8w');
    if (!(INSIGHTS_RANGES as readonly string[]).includes(range)) return bad(c, 'invalid_range', 'Choose 8 weeks, a quarter or a year.');
    const filters: Record<string, string | null> = { range, profile: null, country: null, group: null };
    for (const k of ['profile', 'country', 'group', 'scope'] as const) {
      const v = body[k];
      if (v == null || v === '') continue;
      if (typeof v !== 'string' || !FILTER.test(v)) return bad(c, 'invalid_filter', `That ${k} cannot be read.`);
      filters[k] = v;
    }
    if (what === 'group' && !filters.group) return bad(c, 'group_required', 'Open a group to export that group only.');

    // The page's own read, with the same filters, as this caller.
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
    const answer = await read(c, query);
    if (answer.status !== 200) return c.json(answer.body as object, answer.status as 400);

    const rows = what === 'group' ? groupRows(answer.body) : pageRows(answer.body);
    if (!rows) return c.json({ code: 'group_unreadable', detail: 'That group could not be read. Try again.' }, 409);
    const meta = metaOf(answer.body, what, filters);

    let payload: ArrayBuffer | string;
    let contentType: string;
    let ext: 'csv' | 'pdf' | 'html';
    if (format === 'csv') {
      payload = toCsv(rows, meta); contentType = 'text/csv; charset=utf-8'; ext = 'csv';
    } else {
      const html = toHtml(rows, meta);
      payload = html; contentType = 'text/html; charset=utf-8'; ext = 'html';
      const browser = (c.env as unknown as { BROWSER?: BrowserBinding }).BROWSER;
      if (browser && typeof browser.fetch === 'function') {
        try {
          const res = await browser.fetch('https://browser.local/pdf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html }) });
          if (!res.ok) throw new Error(`browser rendering returned ${res.status}`);
          payload = await res.arrayBuffer(); contentType = 'application/pdf'; ext = 'pdf';
        } catch (e) {
          console.warn('[insights export] PDF render failed, serving HTML:', (e as Error).message);
        }
      }
    }
    // The scan reads the text the file was made from; a PDF is rendered from that HTML.
    if (refusesCountsOnly(typeof payload === 'string' ? payload : toHtml(rows, meta))) {
      return c.json({ code: 'export_not_counts_only', detail: 'This export was stopped: it would have carried more than counts.' }, 500);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const key = `insights-exports/${admin.id}/${stamp}-${what}-${rand}.${ext}`;
    const r2 = c.env.FILES;
    let downloadUrl: string;
    if (r2) {
      await r2.put(key, payload, { httpMetadata: { contentType } });
      downloadUrl = `${new URL(c.req.url).origin}/api/monitoring/analytics/download/${await signDownloadToken(c.env, key, LINK_TTL_SECONDS)}`;
    } else {
      // No R2 binding (local development): the file inline. Still logged.
      const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : new Uint8Array(payload);
      downloadUrl = `data:${contentType};base64,${btoa(String.fromCharCode(...bytes))}`;
    }

    try {
      await ensureAdminAuditLogTable(c.env);
      await c.env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
         VALUES (?, 'insights_export', ?, ?, ?, ?, ?)`,
      ).bind(admin.id, what, ext, JSON.stringify(filters), r2 ? key : null, r2 ? downloadUrl : null).run();
    } catch (e) {
      console.warn('[insights export] audit write failed:', (e as Error).message);
      if (r2) await r2.delete(key).catch(() => {});
      return c.json({ code: 'export_not_logged', detail: 'The export could not be logged, so it was not made. Try again.' }, 503);
    }

    return c.json({ download_url: downloadUrl, expires_in_seconds: r2 ? LINK_TTL_SECONDS : null, format: ext, what, range });
  });

  return r;
}

/** The mounted instance, on the page's own read (built here so the drift guard can follow it, as D690's factories are). */
const adminInsightsExport = insightsExportRoutes();
export default adminInsightsExport;
