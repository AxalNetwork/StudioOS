/**
 * Task #2 (AU) — Admin Publication Exports.
 *
 * Mounted at /api/admin/publications. All endpoints admin-only via
 * requireAdmin, except the public read at /api/admin/publications/public/:slug
 * and the HMAC-gated download at /api/admin/publications/download/:token.
 *
 * Endpoints:
 *   POST /draft               { title, subtitle?, audience, section, filters? }
 *   GET  /                    list (admin)
 *   GET  /:id                 detail (admin)
 *   PUT  /:id                 patch { title?, subtitle?, audience?, summary_text? }
 *   POST /:id/render          { format: 'pdf'|'csv'|'png' } → R2 + 24h signed URL
 *   POST /:id/publish         flips to status='published' + sets published_at
 *   GET  /public/:slug        public read (no auth, status='published' only)
 *   GET  /download/:token     HMAC-gated R2 fetch (24h)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import {
  ALLOWED_AUDIENCES, ALLOWED_SECTIONS,
  loadSectionAggregates, draftSummary, publicationHtml, sectionToCsv,
  signPublicationToken, verifyPublicationToken,
  uniqueSlug, periodLabel, K_MIN,
} from '../services/publications';

type AppCtx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

// ---------- ensure schema (idempotent self-healing) ----------
let _schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  // Only create the new admin_publications table — admin_audit_log is
  // owned by an earlier migration and must NOT be mutated from a request
  // path. The audit-write helper handles a missing actor column by
  // omitting that bind via a runtime check.
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS admin_publications (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT, audience TEXT NOT NULL DEFAULT 'internal', section TEXT NOT NULL, filters_json TEXT NOT NULL DEFAULT '{}', summary_text TEXT NOT NULL DEFAULT '', summary_human_edited INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), published_at TEXT)",
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_admin_publications_slug ON admin_publications(slug)");
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_admin_publications_status_created ON admin_publications(status, created_at DESC)");
    _schemaReady = true;
  } catch (e) {
    console.warn('[admin_publications] ensureSchema failed:', (e as Error).message);
  }
}

// Detect whether admin_audit_log carries an `actor` column. Cached for
// the lifetime of the isolate. Avoids any DDL from a request path while
// still letting us write the email_hash actor when the column exists.
let _auditHasActor: boolean | null = null;
async function auditHasActor(env: Env): Promise<boolean> {
  if (_auditHasActor !== null) return _auditHasActor;
  try {
    const r = await env.DB.prepare("PRAGMA table_info('admin_audit_log')").all<{ name: string }>();
    _auditHasActor = (r.results || []).some(c => String(c.name) === 'actor');
  } catch {
    _auditHasActor = false;
  }
  return _auditHasActor;
}

interface PubRow {
  id: number; slug: string; title: string; subtitle: string | null;
  audience: string; section: string; filters_json: string;
  summary_text: string; summary_human_edited: number;
  status: string; created_by: number; created_at: string;
  updated_at: string; published_at: string | null;
}

function shapePub(r: PubRow) {
  let filters: Record<string, unknown> = {};
  try { filters = JSON.parse(r.filters_json || '{}') as Record<string, unknown>; } catch { /* keep {} */ }
  return {
    id: r.id, slug: r.slug, title: r.title, subtitle: r.subtitle,
    audience: r.audience, section: r.section, filters,
    summary_text: r.summary_text,
    summary_human_edited: !!r.summary_human_edited,
    status: r.status, created_by: r.created_by,
    created_at: r.created_at, updated_at: r.updated_at,
    published_at: r.published_at,
  };
}

async function loadPub(env: Env, id: number): Promise<PubRow | null> {
  const row = await env.DB.prepare(
    'SELECT id, slug, title, subtitle, audience, section, filters_json, summary_text, summary_human_edited, status, created_by, created_at, updated_at, published_at FROM admin_publications WHERE id = ? LIMIT 1',
  ).bind(id).first<PubRow>();
  return row || null;
}

async function writeAudit(env: Env, opts: {
  adminId: number; adminEmail: string; action: string;
  pub: PubRow; format?: string; storageKey?: string | null; downloadUrl?: string | null;
}) {
  try {
    const filtersBlob = JSON.stringify({
      publication_id: opts.pub.id,
      slug: opts.pub.slug,
      title: opts.pub.title,
      audience: opts.pub.audience,
      section: opts.pub.section,
      filters: safeParse(opts.pub.filters_json),
      published_at: opts.pub.published_at,
    });
    const reportType = `publication:${opts.pub.section}`;
    if (await auditHasActor(env)) {
      const actor = await hashEmail(opts.adminEmail);
      await env.DB.prepare(
        `INSERT INTO admin_audit_log
           (admin_user_id, action, report_type, format, filters_json, storage_key, download_url, actor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        opts.adminId, opts.action, reportType, opts.format || null,
        filtersBlob, opts.storageKey || null, opts.downloadUrl || null, actor,
      ).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_audit_log
           (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        opts.adminId, opts.action, reportType, opts.format || null,
        filtersBlob, opts.storageKey || null, opts.downloadUrl || null,
      ).run();
    }
  } catch (e) {
    console.warn('[admin_publications] audit write failed:', (e as Error).message);
  }
}

function safeParse(s: string | null): unknown {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function bucketFor(env: Env): R2Bucket | null {
  return env.PUBLICATIONS || env.FILES || null;
}

// ---------- POST /draft ----------
r.post('/draft', async (c: AppCtx) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  let body: Record<string, unknown> = {};
  try { body = await c.req.json() as Record<string, unknown>; } catch { /* ignore */ }
  const title = String(body.title || '').trim();
  const subtitle = body.subtitle ? String(body.subtitle).trim().slice(0, 200) : null;
  const audience = String(body.audience || 'internal');
  const section = String(body.section || '');
  const filters = (body.filters && typeof body.filters === 'object')
    ? body.filters as Record<string, unknown> : {};
  if (!title || title.length < 3) return c.json({ error: 'title required (min 3 chars)' }, 400);
  if (!ALLOWED_SECTIONS.includes(section as never))
    return c.json({ error: `section must be one of ${ALLOWED_SECTIONS.join(', ')}` }, 400);
  if (!ALLOWED_AUDIENCES.includes(audience as never))
    return c.json({ error: `audience must be one of ${ALLOWED_AUDIENCES.join(', ')}` }, 400);

  const aggregates = await loadSectionAggregates(c.env, section, filters);
  const ai = await draftSummary(c.env, admin.id, {
    title, section, audience, filters, aggregates,
  });
  // Per spec the public slug is finalized at PUBLISH time so a draft's
  // title can still be edited without burning a stale public URL. We
  // only need a column-satisfying placeholder here (the `slug` column
  // is NOT NULL UNIQUE on the live D1 schema). The `draft-` prefix is
  // never exposed publicly because public reads filter
  // `WHERE status='published'`.
  const draftSlug = `draft-${randHexLocal(8)}`;

  const ins = await c.env.DB.prepare(
    `INSERT INTO admin_publications
       (slug, title, subtitle, audience, section, filters_json, summary_text, summary_human_edited, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?)`,
  ).bind(
    draftSlug, title.slice(0, 200), subtitle, audience, section,
    JSON.stringify(filters), ai.summary_text, admin.id,
  ).run();

  const id = Number((ins.meta as { last_row_id?: number })?.last_row_id || 0);
  const pub = await loadPub(c.env, id);
  if (!pub) return c.json({ error: 'create_failed' }, 500);
  return c.json({
    publication: shapePub(pub),
    aggregate_count: aggregates.length,
    ai_ok: ai.ok,
    ai_error: ai.error || null,
  });
});

// ---------- GET / (list) ----------
r.get('/', async (c: AppCtx) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const status = c.req.query('status');
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const where = status ? 'WHERE status = ?' : '';
  const params: Array<string | number> = status ? [status, limit] : [limit];
  const res = await c.env.DB.prepare(
    `SELECT id, slug, title, subtitle, audience, section, filters_json, summary_text, summary_human_edited, status, created_by, created_at, updated_at, published_at
       FROM admin_publications ${where}
       ORDER BY created_at DESC LIMIT ?`,
  ).bind(...params).all<PubRow>();
  return c.json({ publications: (res.results || []).map(shapePub) });
});

// ---------- GET /:id ----------
r.get('/:id{[0-9]+}', async (c: AppCtx) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const pub = await loadPub(c.env, id);
  if (!pub) return c.json({ error: 'not_found' }, 404);
  const aggregates = await loadSectionAggregates(c.env, pub.section, safeParse(pub.filters_json) as Record<string, unknown>);
  // Last persisted render audit row — surfaced so the detail view can
  // show "last rendered as <format> on <ts>" without relying on local
  // session state.
  let lastRender: { format: string | null; storage_key: string | null;
                    download_url: string | null; exported_at: string } | null = null;
  try {
    const ar = await c.env.DB.prepare(
      `SELECT format, storage_key, download_url, exported_at
         FROM admin_audit_log
         WHERE action = 'publication_render'
           AND report_type = ?
           AND filters_json LIKE ?
         ORDER BY id DESC LIMIT 1`,
    ).bind(`publication:${pub.section}`, `%"publication_id":${pub.id}%`)
     .first<{ format: string | null; storage_key: string | null;
              download_url: string | null; exported_at: string }>();
    if (ar) lastRender = ar;
  } catch (e) {
    console.warn('[admin_publications] last render lookup failed:', (e as Error).message);
  }
  return c.json({
    publication: shapePub(pub),
    aggregates,
    period_label: periodLabel(aggregates),
    k_min: K_MIN,
    last_render: lastRender,
  });
});

// ---------- PUT /:id ----------
r.put('/:id{[0-9]+}', async (c: AppCtx) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const pub = await loadPub(c.env, id);
  if (!pub) return c.json({ error: 'not_found' }, 404);
  if (pub.status === 'published')
    return c.json({ error: 'cannot_edit_published' }, 409);
  let body: Record<string, unknown> = {};
  try { body = await c.req.json() as Record<string, unknown>; } catch { /* ignore */ }

  const set: string[] = [];
  const params: Array<string | number | null> = [];
  if (typeof body.title === 'string' && body.title.trim().length >= 3) {
    set.push('title = ?'); params.push(body.title.trim().slice(0, 200));
  }
  if (typeof body.subtitle === 'string') {
    set.push('subtitle = ?'); params.push(body.subtitle.trim().slice(0, 200) || null);
  }
  if (typeof body.audience === 'string' && ALLOWED_AUDIENCES.includes(body.audience as never)) {
    set.push('audience = ?'); params.push(body.audience);
  }
  if (typeof body.summary_text === 'string') {
    set.push('summary_text = ?'); params.push(body.summary_text.slice(0, 4000));
    if (body.summary_text !== pub.summary_text) set.push('summary_human_edited = 1');
  }
  if (set.length === 0) return c.json({ publication: shapePub(pub) });
  set.push("updated_at = datetime('now')");
  params.push(id);
  await c.env.DB.prepare(
    `UPDATE admin_publications SET ${set.join(', ')} WHERE id = ?`,
  ).bind(...params).run();
  const updated = await loadPub(c.env, id);
  // Lightweight audit on edit so we know who tweaked the summary.
  if (updated) {
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'publication_edit', pub: updated,
    });
  }
  return c.json({ publication: updated ? shapePub(updated) : null });
});

// ---------- POST /:id/render ----------
//
// Contract: returns the rendered artifact directly in the response
// body with the correct Content-Type + Content-Disposition headers.
// The shareable 24h HMAC link (when R2 is available) is surfaced via
// the `X-Download-URL` and `X-Download-Expires-In` response headers
// so the admin UI can show a copy-link affordance without a second
// round-trip. Strict semantics:
//   - csv:  always works; bytes generated in-isolate.
//   - pdf:  REQUIRES env.BROWSER. On failure → 502 (no HTML downgrade).
//   - png:  REQUIRES env.BROWSER. On failure → 502.
r.post('/:id{[0-9]+}/render', async (c: AppCtx) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const pub = await loadPub(c.env, id);
  if (!pub) return c.json({ error: 'not_found' }, 404);
  let body: Record<string, unknown> = {};
  try { body = await c.req.json() as Record<string, unknown>; } catch { /* ignore */ }
  const format = String(body.format || 'pdf').toLowerCase();
  if (!['pdf', 'csv', 'png'].includes(format)) return c.json({ error: 'invalid_format' }, 400);

  const filters = safeParse(pub.filters_json) as Record<string, unknown>;
  const aggregates = await loadSectionAggregates(c.env, pub.section, filters);
  const generatedAt = new Date().toISOString();

  let bytes: ArrayBuffer | Uint8Array | null = null;
  let contentType = 'application/octet-stream';

  if (format === 'csv') {
    const csv = sectionToCsv(pub.section, aggregates);
    bytes = new TextEncoder().encode(csv);
    contentType = 'text/csv; charset=utf-8';
  } else {
    // PDF or PNG via Browser Rendering — STRICT: no HTML fallback.
    const browser = c.env.BROWSER;
    if (!browser || typeof browser.fetch !== 'function') {
      return c.json({
        error: 'browser_rendering_unavailable',
        message: `${format.toUpperCase()} render requires the BROWSER binding (Cloudflare Browser Rendering); not configured for this environment.`,
      }, 503);
    }
    const html = publicationHtml({
      id: pub.id, slug: pub.slug, title: pub.title, subtitle: pub.subtitle,
      audience: pub.audience, section: pub.section, filters,
      summary_text: pub.summary_text, aggregates,
      generated_at: generatedAt, period_label: periodLabel(aggregates),
    });
    const endpoint = format === 'png' ? 'screenshot' : 'pdf';
    try {
      const res = await browser.fetch(`https://browser.local/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return c.json({
          error: 'browser_rendering_failed',
          status: res.status,
          message: txt.slice(0, 240),
        }, 502);
      }
      bytes = await res.arrayBuffer();
      contentType = format === 'png' ? 'image/png' : 'application/pdf';
    } catch (e) {
      return c.json({
        error: 'browser_rendering_failed',
        message: (e as Error).message,
      }, 502);
    }
  }

  const ts = generatedAt.replace(/[:.]/g, '-');
  const rand = randHexLocal(6);
  const storageKey = `publications/${pub.id}/${ts}-${rand}.${format}`;
  const bucket = bucketFor(c.env);

  // Persist a copy to R2 (audit retention + shareable HMAC link). Best-
  // effort: a missing bucket doesn't fail the render — we still stream
  // the bytes back.
  let downloadUrl: string | null = null;
  let storedKey: string | null = null;
  if (bucket && bytes) {
    try {
      await bucket.put(storageKey, bytes, { httpMetadata: { contentType } });
      const token = await signPublicationToken(c.env, storageKey, 86400);
      const origin = new URL(c.req.url).origin;
      downloadUrl = `${origin}/api/market-intel-public/publications/download/${token}`;
      storedKey = storageKey;
    } catch (e) {
      console.warn('[admin_publications] r2 put failed:', (e as Error).message);
    }
  }

  await writeAudit(c.env, {
    adminId: admin.id, adminEmail: admin.email,
    action: 'publication_render', pub, format,
    storageKey: storedKey, downloadUrl,
  });

  const filename = `${pub.slug || `publication-${pub.id}`}.${format}`;
  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, max-age=0, no-store',
    'X-Publication-Id': String(pub.id),
    'X-Render-Format': format,
  });
  if (downloadUrl) {
    headers.set('X-Download-URL', downloadUrl);
    headers.set('X-Download-Expires-In', '86400');
    // Expose custom headers so the browser can read them via fetch().
    headers.set('Access-Control-Expose-Headers',
      'X-Download-URL, X-Download-Expires-In, X-Publication-Id, X-Render-Format, Content-Disposition');
  }
  return new Response(bytes, { status: 200, headers });
});

// ---------- POST /:id/publish ----------
r.post('/:id{[0-9]+}/publish', async (c: AppCtx) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const pub = await loadPub(c.env, id);
  if (!pub) return c.json({ error: 'not_found' }, 404);
  if (pub.status === 'published') {
    const origin = new URL(c.req.url).origin;
    return c.json({
      publication: shapePub(pub),
      public_url: `${origin}/insights/public/${pub.slug}`,
      already_published: true,
    });
  }
  // Per spec the public slug is finalized at PUBLISH time, derived from
  // the latest title with collision-resistant uniqueness checks. The
  // draft placeholder slug (`draft-XXXX`) is replaced here so admins
  // can freely rename the draft without burning a stale public URL.
  const finalSlug = await uniqueSlug(c.env, pub.title);
  await c.env.DB.prepare(
    "UPDATE admin_publications SET slug=?, status='published', published_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
  ).bind(finalSlug, id).run();
  const updated = await loadPub(c.env, id);
  if (!updated) return c.json({ error: 'publish_failed' }, 500);
  await writeAudit(c.env, {
    adminId: admin.id, adminEmail: admin.email,
    action: 'publication_publish', pub: updated,
  });
  const origin = new URL(c.req.url).origin;
  return c.json({
    publication: shapePub(updated),
    public_url: `${origin}/insights/public/${updated.slug}`,
  });
});

// NOTE: the public read endpoint and the HMAC-gated download endpoint
// both live under /api/market-intel-public (see
// routes/market_intel_public.ts) so they sit OUTSIDE the /api/admin/*
// CF Access perimeter applied in index.ts. The public read serves
// /insights/public/:slug for anonymous visitors; the download endpoint
// must also be reachable by anyone holding the 24h HMAC token (the
// token IS the authorisation), e.g. an LP receiving a render link by
// email.

function randHexLocal(n: number): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

export default r;
