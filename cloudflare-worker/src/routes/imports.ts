/**
 * Task #8 (IH) — Data Import + Migration Tools.
 *
 * Endpoints (mounted at `/api/imports`):
 *   GET    /                       — list this user's past imports (paginated).
 *   GET    /:id                    — single import row (status + errors).
 *   GET    /quota                  — current month usage + cap for tier.
 *   POST   /universal/preview      — body={csv, target} → detected columns + 5-row preview.
 *   POST   /universal/commit       — body={csv, target, mapping} → batched commit.
 *   POST   /angellist/preview      — AngelList Stack CSV preview (tight schema).
 *   POST   /angellist/commit       — AngelList Stack CSV commit.
 *   POST   /portfolio/preview      — Investor portfolio CSV preview.
 *   POST   /portfolio/commit       — Investor portfolio CSV commit.
 *   POST   /carta                  — One-shot Carta import (triggers existing provider sync).
 *   POST   /hubspot/preview        — list HubSpot pipelines + stages for picker.
 *   POST   /hubspot/commit         — import a HubSpot pipeline into `deals`.
 *   POST   /deck                   — multipart upload PDF/PPTX → per-slide extracted text.
 *   GET    /angellist/template.csv — AngelList CSV template download.
 *
 * Tier limits: Free=1/mo, Growth=10/mo, Studio=unlimited. Admin/partner/
 * advisor/investor roles bypass the founder counter (investor tier still
 * enforced separately for the portfolio importer).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';

const imports = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────────────────── tier limits

const TIER_MONTHLY_CAP: Record<string, number> = {
  free: 1,
  growth: 10,
  studio: Number.POSITIVE_INFINITY,
};

// Only admin bypasses the per-tier cap — Free/Growth/Studio caps apply to
// every other role (founder, investor, partner, advisor). Per-tier caps are
// keyed off `subscription_tier`; investor/partner tiers without one of the
// three canonical values default to Free (1/mo).
const BYPASS_ROLES = new Set(['admin']);

async function getMonthlyUsage(env: Env, userId: number): Promise<number> {
  // Count ALL import attempts created in the current month (including
  // 'failed' rows) so users can't drive up their cap by triggering failures.
  // `started_at` is stored via `CURRENT_TIMESTAMP` which renders as
  // 'YYYY-MM-DD HH:MM:SS' — use SQLite's strftime() so the year/month
  // comparison is robust regardless of the literal text format (works for
  // both ISO-T variants and the space-separated SQLite default).
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM data_imports
      WHERE user_id = ?
        AND strftime('%Y-%m', started_at) = strftime('%Y-%m', 'now')`,
  ).bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}

function tierCapFor(user: User): number {
  if (BYPASS_ROLES.has(String(user.role))) return Number.POSITIVE_INFINITY;
  const t = String((user as any).subscription_tier || 'free').toLowerCase();
  return TIER_MONTHLY_CAP[t] ?? 1;
}

/**
 * Find or create a "placeholder" project for an imported CRM deal/list-entry.
 * `deals.project_id` is NOT NULL, so every imported deal needs a project.
 * For founders we link to their existing founder row; for investors/partners
 * we create a project with no founder_id (the column is nullable) tagged
 * status='intake' so it does not appear in the Spin-Out Lab pipeline.
 * Lookup is case-insensitive on (user.id, name) via the source-tag pattern.
 */
export async function ensureProjectForImport(
  env: Env,
  user: User,
  name: string,
  sourceTag: string,
): Promise<number> {
  const trimmed = (name || '').trim() || `Imported ${sourceTag} deal`;
  // Try to find an existing project the user already touched (founder path)
  // or a project we previously created for the same import source + name.
  const founderId = (user as any).founder_id || null;
  if (founderId) {
    const hit = await env.DB.prepare(
      `SELECT id FROM projects WHERE founder_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`,
    ).bind(founderId, trimmed).first<{ id: number }>();
    if (hit?.id) return Number(hit.id);
  } else {
    const hit = await env.DB.prepare(
      `SELECT id FROM projects WHERE LOWER(name) = LOWER(?)
         AND description = ? LIMIT 1`,
    ).bind(trimmed, `imported_from:${sourceTag}:user_${user.id}`).first<{ id: number }>();
    if (hit?.id) return Number(hit.id);
  }
  const ins = await env.DB.prepare(
    `INSERT INTO projects (name, description, founder_id, status, stage, created_at, updated_at)
     VALUES (?, ?, ?, 'intake', 'idea', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING id`,
  ).bind(
    trimmed,
    founderId ? null : `imported_from:${sourceTag}:user_${user.id}`,
    founderId,
  ).first<{ id: number }>();
  return Number(ins?.id || 0);
}

async function enforceQuota(c: Context<{ Bindings: Env }>, user: User): Promise<Response | null> {
  const cap = tierCapFor(user);
  if (!Number.isFinite(cap)) return null;
  const used = await getMonthlyUsage(c.env, user.id);
  if (used >= cap) {
    // Map current tier → next paid tier that unblocks more imports so the
    // shared `studioos:tier_required` paywall handler in `frontend/src/lib/api.js`
    // (which keys off `required`) opens the right upgrade modal.
    const currentTier = String((user as any).subscription_tier || 'free').toLowerCase();
    const required = currentTier === 'free' ? 'growth' : 'studio';
    return c.json(
      {
        error: 'tier_required',
        sub_error: 'import_quota_exceeded',
        required,
        message: `You've used ${used}/${cap} imports this month. Upgrade to ${required === 'studio' ? 'Studio' : 'Growth'} for more.`,
        used,
        cap,
        tier: currentTier,
      },
      402,
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── CSV helpers

/**
 * Tiny RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
 * doubled quotes, CRLF/LF, and a single header row. Adequate for the
 * ≤ 1000-row files this task targets; for >10k rows the user should split.
 */
export function parseCsv(input: string): { headers: string[]; rows: string[][] } {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Strip BOM
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); out.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  // Final field/row
  if (field.length > 0 || row.length > 0) { row.push(field); out.push(row); }
  if (out.length === 0) return { headers: [], rows: [] };
  const headers = (out.shift() || []).map((h) => h.trim());
  return { headers, rows: out.filter((r) => r.some((c) => String(c || '').trim() !== '')) };
}

function normalizeHeader(h: string): string {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function rowToObject(headers: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) obj[headers[i]] = (row[i] ?? '').trim();
  return obj;
}

// Field detectors for the universal importer. The user can override.
const TARGET_FIELDS: Record<string, { key: string; aliases: string[]; required?: boolean }[]> = {
  contacts: [
    { key: 'name', aliases: ['name', 'full_name', 'contact'], required: true },
    { key: 'email', aliases: ['email', 'e_mail', 'mail'] },
    { key: 'company', aliases: ['company', 'organization', 'org', 'employer'] },
    { key: 'title', aliases: ['title', 'role', 'position'] },
    { key: 'phone', aliases: ['phone', 'phone_number', 'mobile', 'tel'] },
    { key: 'notes', aliases: ['notes', 'note', 'comments'] },
  ],
  captable_holders: [
    { key: 'name', aliases: ['name', 'holder', 'stakeholder', 'shareholder'], required: true },
    { key: 'email', aliases: ['email'] },
    { key: 'security_type', aliases: ['security_type', 'class', 'share_class', 'type'] },
    { key: 'shares', aliases: ['shares', 'quantity', 'units'] },
    { key: 'ownership_pct', aliases: ['ownership_pct', 'percentage', 'pct', 'percent'] },
  ],
  kyc_partners: [
    { key: 'legal_name', aliases: ['legal_name', 'name', 'entity'], required: true },
    { key: 'jurisdiction', aliases: ['jurisdiction', 'country'] },
    { key: 'entity_type', aliases: ['entity_type', 'type'] },
    { key: 'contact_email', aliases: ['contact_email', 'email'] },
  ],
};

function autoMap(headers: string[], target: string): Record<string, string> {
  const fields = TARGET_FIELDS[target] || [];
  const norm = headers.map(normalizeHeader);
  const mapping: Record<string, string> = {};
  for (const f of fields) {
    for (const a of f.aliases) {
      const idx = norm.indexOf(a);
      if (idx >= 0) { mapping[f.key] = headers[idx]; break; }
    }
  }
  return mapping;
}

// ─────────────────────────────────────────────────────────────── R2 helpers

async function maybeStoreRaw(env: Env, userId: number, csv: string, prefix: string): Promise<string | null> {
  if (!env.FILES) return null;
  const key = `imports/${userId}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.csv`;
  try {
    await env.FILES.put(key, csv, { httpMetadata: { contentType: 'text/csv' } });
    return key;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────── import row helpers

async function startImport(
  env: Env,
  userId: number,
  source: string,
  target: string,
  rawKey: string | null,
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO data_imports (user_id, source, target, raw_file_r2_key, status, started_at)
     VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)`,
  ).bind(userId, source, target, rawKey).run();
  return (res.meta as any)?.last_row_id ?? 0;
}

async function finishImport(
  env: Env,
  importId: number,
  attempted: number,
  succeeded: number,
  failed: number,
  errors: Array<{ row: number; error: string }>,
): Promise<void> {
  const status = failed === 0 ? 'succeeded' : succeeded === 0 ? 'failed' : 'partial';
  await env.DB.prepare(
    `UPDATE data_imports
        SET rows_attempted = ?, rows_succeeded = ?, rows_failed = ?,
            errors_json = ?, status = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  ).bind(
    attempted,
    succeeded,
    failed,
    errors.length ? JSON.stringify(errors.slice(0, 200)) : null,
    status,
    importId,
  ).run();
}

// ─────────────────────────────────────────────────────────────── routes

imports.get('/', async (c) => {
  const user = await requireAuth(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') || '50') || 50, 1), 100);
  const rows = await c.env.DB.prepare(
    `SELECT id, source, target, rows_attempted, rows_succeeded, rows_failed,
            status, started_at, finished_at
       FROM data_imports
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT ?`,
  ).bind(user.id, limit).all<any>();
  return c.json({ imports: rows.results || [] });
});

imports.get('/quota', async (c) => {
  const user = await requireAuth(c);
  const cap = tierCapFor(user);
  const used = await getMonthlyUsage(c.env, user.id);
  return c.json({
    used,
    cap: Number.isFinite(cap) ? cap : null,
    unlimited: !Number.isFinite(cap),
    tier: String((user as any).subscription_tier || 'free').toLowerCase(),
  });
});

imports.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ error: 'bad_id' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT * FROM data_imports WHERE id = ? AND user_id = ?`,
  ).bind(id, user.id).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ import: row });
});

// ────────────────────────────── Universal CSV importer

imports.post('/universal/preview', async (c) => {
  await requireAuth(c);
  const body = await c.req.json<{ csv?: string; target?: string }>().catch(() => ({} as { csv?: string; target?: string }));
  const csv = String(body.csv || '');
  const target = String(body.target || 'contacts');
  if (!csv.trim()) return c.json({ error: 'empty_csv' }, 400);
  if (!TARGET_FIELDS[target]) return c.json({ error: 'unknown_target' }, 400);
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) return c.json({ error: 'no_headers' }, 400);
  const mapping = autoMap(headers, target);
  const previewRows = rows.slice(0, 5).map((r) => rowToObject(headers, r));
  return c.json({
    target,
    headers,
    row_count: rows.length,
    detected_mapping: mapping,
    available_fields: TARGET_FIELDS[target],
    preview: previewRows,
  });
});

imports.post('/universal/commit', async (c) => {
  const user = await requireAuth(c);
  const quotaResp = await enforceQuota(c, user);
  if (quotaResp) return quotaResp;
  const body = await c.req.json<{
    csv?: string;
    target?: string;
    mapping?: Record<string, string>;
  }>().catch(() => ({} as { csv?: string; target?: string; mapping?: Record<string, string> }));
  const csv = String(body.csv || '');
  const target = String(body.target || 'contacts');
  const mapping: Record<string, string> = body.mapping || {};
  if (!csv.trim()) return c.json({ error: 'empty_csv' }, 400);
  if (!TARGET_FIELDS[target]) return c.json({ error: 'unknown_target' }, 400);
  const { headers, rows } = parseCsv(csv);
  if (rows.length > 5000) return c.json({ error: 'too_many_rows', max: 5000 }, 413);

  const rawKey = await maybeStoreRaw(c.env, user.id, csv, `universal-${target}`);
  const importId = await startImport(c.env, user.id, 'spreadsheet', target, rawKey);

  const errors: Array<{ row: number; error: string }> = [];
  let succeeded = 0;
  const BATCH = 100;
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const obj = rowToObject(headers, r);
      const mapped: Record<string, string> = {};
      for (const [k, srcHdr] of Object.entries(mapping)) {
        if (srcHdr && srcHdr in obj) mapped[k] = obj[srcHdr];
      }
      // Required-field check
      const required = TARGET_FIELDS[target].filter((f) => f.required).map((f) => f.key);
      const missing = required.find((k) => !mapped[k] || mapped[k].trim() === '');
      if (missing) {
        errors.push({ row: start + j + 2, error: `missing required field: ${missing}` });
        continue;
      }
      try {
        await persistUniversalRow(c.env, user.id, target, mapped, importId);
        succeeded++;
      } catch (e: any) {
        errors.push({ row: start + j + 2, error: String(e?.message || e || 'insert_failed').slice(0, 240) });
      }
    }
  }

  await finishImport(c.env, importId, rows.length, succeeded, rows.length - succeeded, errors);
  return c.json({
    import_id: importId,
    rows_attempted: rows.length,
    rows_succeeded: succeeded,
    rows_failed: rows.length - succeeded,
    errors: errors.slice(0, 50),
  });
});

async function persistUniversalRow(
  env: Env,
  userId: number,
  target: string,
  mapped: Record<string, string>,
  importId: number,
): Promise<void> {
  switch (target) {
    case 'contacts':
      // Store as `notes` on the user's record collection — many apps have
      // a `contacts` table, but to avoid schema sprawl we route to
      // `network_connections` if present, else fallback to `notes` JSON
      // attached to the import row itself. For this slice we write to
      // `network_connections` (best-effort) and silently no-op on missing
      // table; row-error already captures real failures.
      try {
        await env.DB.prepare(
          `INSERT INTO network_connections (user_id, name, email, company, title, phone, notes, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'import', CURRENT_TIMESTAMP)`,
        ).bind(
          userId,
          mapped.name,
          mapped.email || null,
          mapped.company || null,
          mapped.title || null,
          mapped.phone || null,
          mapped.notes || null,
        ).run();
      } catch {
        // Fallback: persist as JSON inside data_imports.errors_json is too
        // crude; for now just rethrow so the per-row error path captures it.
        throw new Error('contacts target unavailable on this deployment');
      }
      return;
    case 'captable_holders':
      await env.DB.prepare(
        `INSERT INTO cap_table_holders (user_id, name, email, security_type, shares, ownership_pct, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'import', CURRENT_TIMESTAMP)`,
      ).bind(
        userId,
        mapped.name,
        mapped.email || null,
        mapped.security_type || null,
        Number(mapped.shares) || 0,
        mapped.ownership_pct ? Number(mapped.ownership_pct) : null,
      ).run();
      return;
    case 'kyc_partners':
      // Light-touch — same fallback pattern. Real KYC partner ingestion
      // has its own admin route; this just lands rows for review.
      try {
        await env.DB.prepare(
          `INSERT INTO kyc_partner_imports (user_id, legal_name, jurisdiction, entity_type, contact_email, data_import_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        ).bind(
          userId,
          mapped.legal_name,
          mapped.jurisdiction || null,
          mapped.entity_type || null,
          mapped.contact_email || null,
          importId,
        ).run();
      } catch {
        throw new Error('kyc_partners target unavailable on this deployment');
      }
      return;
    default:
      throw new Error(`unsupported_target:${target}`);
  }
}

// ────────────────────────────── AngelList Stack CSV importer

const ANGELLIST_HEADERS = [
  'company_name', 'sector', 'stage', 'holder_name', 'holder_email',
  'security_type', 'shares', 'investment_amount', 'round_name', 'round_date',
];

imports.get('/angellist/template.csv', async (c) => {
  const csv =
    ANGELLIST_HEADERS.join(',') + '\n' +
    'Acme Robotics,Hardware,Seed,Alice Founder,alice@acme.example,Common,5000000,,,\n' +
    'Acme Robotics,Hardware,Seed,Bob Investor,bob@vc.example,SAFE,,250000,Pre-Seed,2026-01-15\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="angellist-stack-template.csv"',
    },
  });
});

imports.post('/angellist/preview', async (c) => {
  await requireAuth(c);
  const body = await c.req.json<{ csv?: string }>().catch(() => ({} as { csv?: string }));
  const csv = String(body.csv || '');
  if (!csv.trim()) return c.json({ error: 'empty_csv' }, 400);
  const { headers, rows } = parseCsv(csv);
  return c.json({
    headers,
    expected: ANGELLIST_HEADERS,
    row_count: rows.length,
    preview: rows.slice(0, 5).map((r) => rowToObject(headers, r)),
  });
});

imports.post('/angellist/commit', async (c) => {
  const user = await requireAuth(c);
  const quotaResp = await enforceQuota(c, user);
  if (quotaResp) return quotaResp;
  const body = await c.req.json<{ csv?: string }>().catch(() => ({} as { csv?: string }));
  const csv = String(body.csv || '');
  if (!csv.trim()) return c.json({ error: 'empty_csv' }, 400);
  const { headers, rows } = parseCsv(csv);
  const normHeaders = headers.map(normalizeHeader);
  const hidx: Record<string, number> = {};
  for (const h of ANGELLIST_HEADERS) hidx[h] = normHeaders.indexOf(h);

  const rawKey = await maybeStoreRaw(c.env, user.id, csv, 'angellist');
  const importId = await startImport(c.env, user.id, 'angellist_csv', 'projects+captable+rounds', rawKey);

  const errors: Array<{ row: number; error: string }> = [];
  let succeeded = 0;
  const projectIdByName = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const get = (k: string) => (hidx[k] >= 0 ? (r[hidx[k]] || '').trim() : '');
    const company = get('company_name');
    const holder = get('holder_name');
    if (!company) { errors.push({ row: i + 2, error: 'missing company_name' }); continue; }
    try {
      // Project: upsert (most recent for this founder by name). Uses the
      // shared `ensureProjectForImport` helper so imported projects are
      // linked to the founder's `founder_id` and therefore appear in
      // founder-scoped project listings.
      let projectId = projectIdByName.get(company.toLowerCase());
      if (!projectId) {
        projectId = await ensureProjectForImport(c.env, user, company, 'angellist');
        if (projectId) {
          // Best-effort: backfill sector/stage from CSV when we just
          // created the placeholder (no-op when already populated).
          const sector = get('sector');
          const stage = get('stage');
          if (sector || stage) {
            try {
              await c.env.DB.prepare(
                `UPDATE projects SET sector = COALESCE(sector, ?), stage = COALESCE(NULLIF(stage,'idea'), ?, stage) WHERE id = ?`,
              ).bind(sector || null, stage || null, projectId).run();
            } catch { /* schema variance — ignore */ }
          }
        }
        projectIdByName.set(company.toLowerCase(), projectId!);
      }

      if (holder) {
        const sharesRaw = get('shares');
        await c.env.DB.prepare(
          `INSERT INTO cap_table_holders (user_id, project_id, name, email, security_type, shares, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'angellist', CURRENT_TIMESTAMP)`,
        ).bind(
          user.id, projectId, holder, get('holder_email') || null,
          get('security_type') || null, Number(sharesRaw) || 0,
        ).run();
      }

      const roundName = get('round_name');
      if (roundName) {
        try {
          await c.env.DB.prepare(
            `INSERT INTO rounds (project_id, name, amount, closed_at, source, created_at)
             VALUES (?, ?, ?, ?, 'angellist', CURRENT_TIMESTAMP)`,
          ).bind(
            projectId,
            roundName,
            Number(get('investment_amount')) || null,
            get('round_date') || null,
          ).run();
        } catch {
          // `rounds` schema varies across migrations; ignore if column shape
          // doesn't match — the project + holder rows are the primary signal.
        }
      }
      succeeded++;
    } catch (e: any) {
      errors.push({ row: i + 2, error: String(e?.message || e).slice(0, 240) });
    }
  }

  await finishImport(c.env, importId, rows.length, succeeded, rows.length - succeeded, errors);
  return c.json({ import_id: importId, rows_attempted: rows.length, rows_succeeded: succeeded, rows_failed: rows.length - succeeded, errors: errors.slice(0, 50) });
});

// ────────────────────────────── Investor portfolio CSV importer

const PORTFOLIO_HEADERS = ['company', 'ticker', 'investment_date', 'amount', 'instrument', 'current_valuation'];

imports.get('/portfolio/template.csv', async (c) => {
  const csv =
    PORTFOLIO_HEADERS.join(',') + '\n' +
    'Acme Robotics,,2024-06-12,250000,SAFE,2000000\n' +
    'NVIDIA,NVDA,2023-01-04,100000,Public Equity,180000\n';
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="investor-portfolio-template.csv"' },
  });
});

imports.post('/portfolio/preview', async (c) => {
  await requireAuth(c);
  const body = await c.req.json<{ csv?: string }>().catch(() => ({} as { csv?: string }));
  const csv = String(body.csv || '');
  if (!csv.trim()) return c.json({ error: 'empty_csv' }, 400);
  const { headers, rows } = parseCsv(csv);
  return c.json({
    headers, expected: PORTFOLIO_HEADERS, row_count: rows.length,
    preview: rows.slice(0, 5).map((r) => rowToObject(headers, r)),
  });
});

imports.post('/portfolio/commit', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'investor' && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const quotaResp = await enforceQuota(c, user);
  if (quotaResp) return quotaResp;
  const body = await c.req.json<{ csv?: string }>().catch(() => ({} as { csv?: string }));
  const csv = String(body.csv || '');
  if (!csv.trim()) return c.json({ error: 'empty_csv' }, 400);
  const { headers, rows } = parseCsv(csv);
  const norm = headers.map(normalizeHeader);
  const idx: Record<string, number> = {};
  for (const h of PORTFOLIO_HEADERS) idx[h] = norm.indexOf(h);

  const rawKey = await maybeStoreRaw(c.env, user.id, csv, 'portfolio');
  const importId = await startImport(c.env, user.id, 'portfolio_csv', 'investor_portfolio_holdings', rawKey);

  const errors: Array<{ row: number; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const get = (k: string) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
    const company = get('company');
    if (!company) { errors.push({ row: i + 2, error: 'missing company' }); continue; }
    try {
      await c.env.DB.prepare(
        `INSERT INTO investor_portfolio_holdings
         (investor_user_id, company_name, ticker, investment_date, amount, instrument, current_valuation, source, data_import_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'csv', ?)`,
      ).bind(
        user.id, company, get('ticker') || null, get('investment_date') || null,
        Number(get('amount')) || null, get('instrument') || null,
        Number(get('current_valuation')) || null, importId,
      ).run();
      succeeded++;
    } catch (e: any) {
      errors.push({ row: i + 2, error: String(e?.message || e).slice(0, 240) });
    }
  }
  await finishImport(c.env, importId, rows.length, succeeded, rows.length - succeeded, errors);
  return c.json({ import_id: importId, rows_attempted: rows.length, rows_succeeded: succeeded, rows_failed: rows.length - succeeded, errors: errors.slice(0, 50) });
});

imports.get('/portfolio/holdings', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'investor' && user.role !== 'admin') return c.json({ holdings: [] });
  const rows = await c.env.DB.prepare(
    `SELECT id, company_name, ticker, investment_date, amount, instrument, current_valuation, source, created_at
       FROM investor_portfolio_holdings
      WHERE investor_user_id = ?
      ORDER BY investment_date DESC, id DESC
      LIMIT 500`,
  ).bind(user.id).all<any>();
  return c.json({ holdings: rows.results || [] });
});

// ────────────────────────────── Carta one-shot import

imports.post('/carta', async (c) => {
  const user = await requireAuth(c);
  const quotaResp = await enforceQuota(c, user);
  if (quotaResp) return quotaResp;
  // Honour caller-supplied integration_id (with ownership check) so users
  // with multiple Carta connections can pick a specific issuer; fall back
  // to the most-recently-touched active Carta integration for the user.
  const body = await c.req.json<{ integration_id?: number }>().catch(() => ({} as { integration_id?: number }));
  let row: { id: number; status: string } | null;
  if (body.integration_id) {
    row = await c.env.DB.prepare(
      `SELECT id, status FROM integrations
        WHERE id = ? AND user_id = ? AND provider_key = 'carta' LIMIT 1`,
    ).bind(body.integration_id, user.id).first<{ id: number; status: string }>();
  } else {
    row = await c.env.DB.prepare(
      `SELECT id, status FROM integrations
        WHERE user_id = ? AND provider_key = 'carta'
        ORDER BY last_synced_at DESC, id DESC LIMIT 1`,
    ).bind(user.id).first<{ id: number; status: string }>();
  }
  if (!row || row.status !== 'active') {
    return c.json({ error: 'carta_not_connected', message: 'Connect Carta from Integrations first.' }, 412);
  }
  const importId = await startImport(c.env, user.id, 'carta', 'cap_table_holders+securities+vesting+option_pools', null);
  try {
    // Defer the actual sync to the existing provider — it's idempotent.
    // Provider sync errors must propagate so the data_imports row is
    // marked failed AND the API surfaces a non-2xx response; swallowing
    // here lets users see "succeeded with 0 rows" on auth/network errors.
    const mod = await import('../integrations/providers/carta');
    if (!mod.syncCartaForIntegration) {
      throw new Error('carta_sync_unavailable: provider sync entrypoint missing');
    }
    const r = await mod.syncCartaForIntegration(c, user, row.id);
    if (!r || typeof r !== 'object') {
      throw new Error('carta_sync_returned_no_result');
    }
    const counts = (r as any).counts || {};
    const attempted =
      (counts.holders || 0) +
      (counts.securities || 0) +
      (counts.vesting || 0) +
      (counts.option_pools || 0) +
      (counts.errors || 0);
    const succeeded = attempted - (counts.errors || 0);
    await finishImport(c.env, importId, attempted, Math.max(0, succeeded), counts.errors || 0, []);
  } catch (e: any) {
    await finishImport(c.env, importId, 0, 0, 1, [{ row: 0, error: String(e?.message || e).slice(0, 240) }]);
    return c.json({ error: 'carta_sync_failed', message: String(e?.message || e), import_id: importId }, 502);
  }
  return c.json({ import_id: importId, ok: true });
});

// ────────────────────────────── HubSpot pipeline import

imports.post('/hubspot/preview', async (c) => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare(
    `SELECT id, status FROM integrations WHERE user_id = ? AND provider_key = 'hubspot' LIMIT 1`,
  ).bind(user.id).first<{ id: number; status: string }>();
  if (!row || row.status !== 'active') {
    return c.json({ error: 'hubspot_not_connected' }, 412);
  }
  try {
    const mod = await import('../integrations/providers/hubspot');
    const pipelines = (await mod.listHubspotPipelines?.(c.env, row.id).catch(() => null)) || [];
    return c.json({ pipelines });
  } catch (e: any) {
    return c.json({ error: 'hubspot_list_failed', message: String(e?.message || e) }, 502);
  }
});

imports.post('/hubspot/commit', async (c) => {
  const user = await requireAuth(c);
  const quotaResp = await enforceQuota(c, user);
  if (quotaResp) return quotaResp;
  const body = await c.req.json<{ pipeline_id?: string; stage_map?: Record<string, string> }>().catch(() => ({} as { pipeline_id?: string; stage_map?: Record<string, string> }));
  const row = await c.env.DB.prepare(
    `SELECT id, status FROM integrations WHERE user_id = ? AND provider_key = 'hubspot' LIMIT 1`,
  ).bind(user.id).first<{ id: number; status: string }>();
  if (!row || row.status !== 'active') return c.json({ error: 'hubspot_not_connected' }, 412);
  const importId = await startImport(c.env, user.id, 'hubspot', 'deals', null);
  try {
    const mod = await import('../integrations/providers/hubspot');
    const r = await mod.importHubspotPipeline?.(c.env, user, row.id, body.pipeline_id || 'default', body.stage_map || {});
    const counts = r?.counts || { imported: 0, errors: 0 };
    await finishImport(c.env, importId, counts.imported + counts.errors, counts.imported, counts.errors, []);
    return c.json({ import_id: importId, ...counts });
  } catch (e: any) {
    // failed=1 so finishImport derives status='failed' and the Settings
    // UI's "View errors" drill-down opens (it keys off non-succeeded
    // status / non-zero failed count).
    await finishImport(c.env, importId, 0, 0, 1, [{ row: 0, error: String(e?.message || e).slice(0, 240) }]);
    return c.json({ error: 'hubspot_import_failed', message: String(e?.message || e), import_id: importId }, 502);
  }
});

// ────────────────────────────── Affinity list import

imports.post('/affinity/preview', async (c) => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare(
    `SELECT id, status FROM integrations WHERE user_id = ? AND provider_key = 'affinity' LIMIT 1`,
  ).bind(user.id).first<{ id: number; status: string }>();
  if (!row || row.status !== 'active') {
    return c.json({ error: 'affinity_not_connected' }, 412);
  }
  try {
    const mod = await import('../integrations/providers/affinity');
    const lists = (await mod.listAffinityLists?.(c.env, row.id).catch(() => null)) || [];
    return c.json({ lists });
  } catch (e: any) {
    return c.json({ error: 'affinity_list_failed', message: String(e?.message || e) }, 502);
  }
});

imports.post('/affinity/commit', async (c) => {
  const user = await requireAuth(c);
  const quotaResp = await enforceQuota(c, user);
  if (quotaResp) return quotaResp;
  const body = await c.req.json<{ list_id?: string; stage_map?: Record<string, string> }>().catch(() => ({} as { list_id?: string; stage_map?: Record<string, string> }));
  const row = await c.env.DB.prepare(
    `SELECT id, status FROM integrations WHERE user_id = ? AND provider_key = 'affinity' LIMIT 1`,
  ).bind(user.id).first<{ id: number; status: string }>();
  if (!row || row.status !== 'active') return c.json({ error: 'affinity_not_connected' }, 412);
  if (!body.list_id) return c.json({ error: 'list_id_required' }, 400);
  const importId = await startImport(c.env, user.id, 'affinity', 'deals', null);
  try {
    const mod = await import('../integrations/providers/affinity');
    const r = await mod.importAffinityList?.(c.env, user, row.id, body.list_id, body.stage_map || {});
    const counts = r?.counts || { imported: 0, errors: 0 };
    await finishImport(c.env, importId, counts.imported + counts.errors, counts.imported, counts.errors, []);
    return c.json({ import_id: importId, ...counts });
  } catch (e: any) {
    // failed=1 so finishImport derives status='failed' and the Settings
    // UI surfaces the error drill-down.
    await finishImport(c.env, importId, 0, 0, 1, [{ row: 0, error: String(e?.message || e).slice(0, 240) }]);
    return c.json({ error: 'affinity_import_failed', message: String(e?.message || e), import_id: importId }, 502);
  }
});

// ────────────────────────────── Deck PDF/PPTX text extraction

imports.post('/deck', async (c) => {
  const user = await requireAuth(c);
  const quotaResp = await enforceQuota(c, user);
  if (quotaResp) return quotaResp;
  const ctype = (c.req.header('content-type') || '').toLowerCase();
  if (!ctype.includes('multipart/form-data')) {
    return c.json({ error: 'expected_multipart' }, 400);
  }
  const form = await c.req.formData();
  const file = form.get('file');
  const projectId = Number(form.get('project_id') || 0) || null;
  if (!file || typeof (file as unknown as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
    return c.json({ error: 'no_file' }, 400);
  }
  // Authorisation: when the caller supplies a project_id, verify they own
  // the project (founder_id link). Admins are allowed through. Without this
  // check ANY authenticated user could write deck content into another
  // user's project by guessing the id.
  if (projectId) {
    if (user.role !== 'admin') {
      const owns = await c.env.DB.prepare(
        // `founders` has no user_id — the link is `users.founder_id`. This is
        // an ownership gate, and with the wrong column it could not evaluate
        // at all rather than evaluating to false.
        `SELECT 1 AS ok FROM projects p
           LEFT JOIN users fu ON fu.founder_id = p.founder_id
          WHERE p.id = ? AND (fu.id = ? OR p.description = ?) LIMIT 1`,
      ).bind(projectId, user.id, `imported_from:deck:user_${user.id}`).first<{ ok: number }>();
      if (!owns) return c.json({ error: 'forbidden_project' }, 403);
    }
  }
  const f = file as unknown as { name?: string; arrayBuffer(): Promise<ArrayBuffer> };
  const name = String(f.name || '').toLowerCase();
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes.byteLength > 25 * 1024 * 1024) return c.json({ error: 'file_too_large', max_mb: 25 }, 413);

  const importId = await startImport(c.env, user.id, name.endsWith('.pptx') ? 'deck_pptx' : 'deck_pdf', 'pitch_decks', null);
  let slides: { index: number; text: string }[] = [];
  try {
    if (name.endsWith('.pdf')) {
      slides = await extractPdfText(bytes);
    } else if (name.endsWith('.pptx')) {
      slides = await extractPptxText(bytes);
    } else {
      throw new Error('unsupported_format');
    }
  } catch (e: any) {
    await finishImport(c.env, importId, 0, 0, 1, [{ row: 0, error: String(e?.message || e).slice(0, 240) }]);
    return c.json({ error: 'extract_failed', message: String(e?.message || e) }, 415);
  }

  // Pre-fill pitch_decks (best-effort; the user can edit in the builder).
  if (projectId && slides.length) {
    try {
      const payload = { slides: slides.map((s) => ({ index: s.index, body: s.text })) };
      await c.env.DB.prepare(
        // No `updated_at`: neither definition of pitch_decks has one
        // (routes/decks.ts and services/advisor/writeRouter.ts both stop at
        // created_at) and nothing reads it. Naming it here threw into the
        // catch below, so an imported deck was parsed and then dropped —
        // the "schema variance" the comment guesses at was this column.
        `INSERT INTO pitch_decks (project_id, version, title, slides, is_current, created_by, created_at)
         VALUES (?, COALESCE((SELECT MAX(version)+1 FROM pitch_decks WHERE project_id = ?), 1),
                 'Imported from deck', ?, 1, ?, CURRENT_TIMESTAMP)`,
      ).bind(projectId, projectId, JSON.stringify(payload), user.id).run();
    } catch {
      // Schema variance — return slides anyway so the UI can write to the builder.
    }
  }

  const imageOnly = slides.every((s) => s.text.trim().length < 4);
  // For image-only decks we mark the import partial (failed=slides.length)
  // so the Settings list shows the red flag + drill-down. The response
  // still returns `image_only: true` for inline UI handling.
  if (imageOnly) {
    await finishImport(c.env, importId, slides.length, 0, slides.length, [{ row: 0, error: 'image_only_deck' }]);
  } else {
    await finishImport(c.env, importId, slides.length, slides.length, 0, []);
  }
  return c.json({
    import_id: importId,
    slides,
    slide_count: slides.length,
    image_only: imageOnly,
    project_id: projectId,
  });
});

// Lightweight PDF text-layer extraction. Walks `BT … ET` blocks, decoding
// `(literal) Tj`, `[…] TJ`, and `'`/`"` operators. Adequate for marketing-
// deck PDFs (decks exported from PowerPoint / Keynote / Pitch). Returns one
// entry per PDF page boundary (`showpage` operator is rare in modern PDFs
// so we split on `endobj` of /Type /Page blocks). On image-only decks
// every entry's text will be empty — the caller surfaces `image_only`.
async function extractPdfText(bytes: Uint8Array): Promise<{ index: number; text: string }[]> {
  const txt = new TextDecoder('latin1').decode(bytes);
  // Split into pages by `/Type /Page` … `endobj`.
  const pageRegex = /\/Type\s*\/Page[\s>][\s\S]*?endobj/g;
  const pages: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pageRegex.exec(txt)) !== null) pages.push(m[0]);
  if (pages.length === 0) pages.push(txt);

  const result: { index: number; text: string }[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const out: string[] = [];
    // (literal) Tj  |  (literal) '  |  (literal) "
    const tjRe = /\(((?:\\.|[^\\)])*)\)\s*(Tj|TJ|'|")/g;
    let mm: RegExpExecArray | null;
    while ((mm = tjRe.exec(page)) !== null) {
      out.push(decodePdfLiteral(mm[1]));
    }
    // [(a)(b)(c)] TJ
    const tjArrRe = /\[((?:[^\[\]\\]|\\.)+)\]\s*TJ/g;
    while ((mm = tjArrRe.exec(page)) !== null) {
      const litRe = /\(((?:\\.|[^\\)])*)\)/g;
      let lm: RegExpExecArray | null;
      while ((lm = litRe.exec(mm[1])) !== null) out.push(decodePdfLiteral(lm[1]));
    }
    result.push({ index: i + 1, text: out.join(' ').replace(/\s+/g, ' ').trim() });
  }
  return result;
}

function decodePdfLiteral(s: string): string {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b').replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
}

// PPTX is a ZIP of XML. We use DecompressionStream('deflate-raw') to inflate
// each `ppt/slides/slideN.xml` and pull `<a:t>…</a:t>` runs in order.
async function extractPptxText(bytes: Uint8Array): Promise<{ index: number; text: string }[]> {
  const files = await readZip(bytes);
  const slides: { index: number; text: string }[] = [];
  const slideEntries = files
    .filter((f) => /^ppt\/slides\/slide(\d+)\.xml$/.test(f.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)\.xml$/)![1]);
      const nb = Number(b.name.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });
  for (let i = 0; i < slideEntries.length; i++) {
    const xml = new TextDecoder('utf-8').decode(await slideEntries[i].data());
    const runs: string[] = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      runs.push(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    }
    slides.push({ index: i + 1, text: runs.join(' ').replace(/\s+/g, ' ').trim() });
  }
  return slides;
}

interface ZipEntry { name: string; data: () => Promise<Uint8Array>; }

async function readZip(buf: Uint8Array): Promise<ZipEntry[]> {
  // Find EOCD record (signature 0x06054b50) — scan from end, max 65557 bytes back.
  const sig = (b: Uint8Array, i: number, a: number, b1: number, c: number, d: number) =>
    b[i] === a && b[i + 1] === b1 && b[i + 2] === c && b[i + 3] === d;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (sig(buf, i, 0x50, 0x4b, 0x05, 0x06)) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not_a_zip');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cdEntries = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (!sig(buf, p, 0x50, 0x4b, 0x01, 0x02)) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const fnameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(buf.subarray(p + 46, p + 46 + fnameLen));
    p += 46 + fnameLen + extraLen + commentLen;
    entries.push({
      name,
      data: async () => {
        const localHeader = localOff;
        if (!sig(buf, localHeader, 0x50, 0x4b, 0x03, 0x04)) throw new Error('bad_local_header');
        const lfnameLen = dv.getUint16(localHeader + 26, true);
        const lextraLen = dv.getUint16(localHeader + 28, true);
        const dataStart = localHeader + 30 + lfnameLen + lextraLen;
        const raw = buf.subarray(dataStart, dataStart + compSize);
        if (method === 0) return raw.slice();
        if (method === 8) {
          // raw DEFLATE
          const stream = new Response(raw).body!.pipeThrough(new DecompressionStream('deflate-raw'));
          const ab = await new Response(stream).arrayBuffer();
          return new Uint8Array(ab);
        }
        throw new Error(`unsupported_zip_method:${method}`);
      },
    });
  }
  return entries;
}

export default imports;
