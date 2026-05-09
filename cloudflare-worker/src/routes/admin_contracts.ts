import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { mintDownloadToken } from '../services/signedDownload';

type AppContext = Context<{ Bindings: Env }>;
type ContractDownloadResult =
  | { ok: { url: string; expires_at: string }; error?: undefined }
  | { ok?: undefined; error: Response };

const adminContracts = new Hono<{ Bindings: Env }>();

const TEMPLATE_LAYERS: Record<string, { label: string; description: string }> = {
  gp: { label: 'Internal Management (GP Level)', description: 'Governance, partner economics, and decision-making framework' },
  fund: { label: 'Fund Formation (LP Level)', description: 'Capital raising, investor agreements, and fund structure' },
  portfolio: { label: 'Investment Execution (Portfolio Level)', description: 'Templates used when investing into startups' },
  compliance: { label: 'Compliance & Regulatory', description: 'SEC filings, AML/KYC, and tax elections' },
};

const TEMPLATES: Record<string, { title: string; layer: string }> = {
  operating_agreement: { title: 'Operating Agreement (LLC)', layer: 'gp' },
  carried_interest: { title: 'Carried Interest / Partnership Agreement', layer: 'gp' },
  ic_charter: { title: 'Investment Committee Charter', layer: 'gp' },
  service_agreement: { title: 'Partner Service Agreement', layer: 'gp' },
  lpa: { title: 'Limited Partnership Agreement (LPA)', layer: 'fund' },
  ppm: { title: 'Private Placement Memorandum (PPM)', layer: 'fund' },
  subscription: { title: 'Subscription Agreement', layer: 'fund' },
  mgmt_company: { title: 'Management Company Agreement', layer: 'fund' },
  safe: { title: 'SAFE Agreement', layer: 'portfolio' },
  term_sheet: { title: 'Term Sheet', layer: 'portfolio' },
  bylaws: { title: 'Corporate Bylaws', layer: 'portfolio' },
  equity_split: { title: 'Equity Split Agreement', layer: 'portfolio' },
  ip_license: { title: 'IP License Agreement', layer: 'portfolio' },
  spa: { title: 'Stock Purchase Agreement (SPA)', layer: 'portfolio' },
  voting_rights: { title: "Voting & Investors' Rights Agreement", layer: 'portfolio' },
  form_adv: { title: 'Form ADV / Investment Adviser Registration', layer: 'compliance' },
  aml_kyc: { title: 'AML/KYC Policy', layer: 'compliance' },
  section_83b: { title: 'Section 83(b) Election', layer: 'compliance' },
};

function daysBetween(a: any, b: any): number | null {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.max(0, Math.floor((t1 - t2) / 86400000));
}

function enrichRow(d: any, projectName: string | null, founderEmail: string | null) {
  const recipient = d.signed_by || founderEmail || null;
  return {
    id: d.id,
    uid: d.uid,
    title: d.title,
    doc_type: d.doc_type,
    status: d.status,
    template_name: d.template_name,
    project_id: d.project_id,
    project_name: projectName,
    recipient_email: recipient,
    signed_by: d.signed_by,
    signed_at: d.signed_at,
    signed_ip: d.signed_ip,
    days_to_sign: daysBetween(d.signed_at, d.created_at),
    created_at: d.created_at,
    updated_at: d.updated_at,
    file_key: d.file_key,
    file_size: d.file_size,
    file_content_type: d.file_content_type,
    file_sha256: d.file_sha256,
  };
}

// GET /api/admin/contracts — list with filters
adminContracts.get('/', async (c) => {
  await requireAdmin(c);
  const status = c.req.query('status') || '';
  const docType = c.req.query('doc_type') || '';
  const projectId = c.req.query('project_id');
  const q = (c.req.query('q') || '').toLowerCase();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 500);
  const offset = parseInt(c.req.query('offset') || '0', 10) || 0;

  const sql = getSQL(c.env);
  try {
    // Pull all matching docs, then enrich + filter in JS (matches FastAPI parity).
    let docs: any[];
    if (status && docType && projectId) {
      docs = await sql`SELECT * FROM documents WHERE status = ${status} AND doc_type = ${docType} AND project_id = ${parseInt(projectId)} ORDER BY created_at DESC`;
    } else if (status && docType) {
      docs = await sql`SELECT * FROM documents WHERE status = ${status} AND doc_type = ${docType} ORDER BY created_at DESC`;
    } else if (status && projectId) {
      docs = await sql`SELECT * FROM documents WHERE status = ${status} AND project_id = ${parseInt(projectId)} ORDER BY created_at DESC`;
    } else if (docType && projectId) {
      docs = await sql`SELECT * FROM documents WHERE doc_type = ${docType} AND project_id = ${parseInt(projectId)} ORDER BY created_at DESC`;
    } else if (status) {
      docs = await sql`SELECT * FROM documents WHERE status = ${status} ORDER BY created_at DESC`;
    } else if (docType) {
      docs = await sql`SELECT * FROM documents WHERE doc_type = ${docType} ORDER BY created_at DESC`;
    } else if (projectId) {
      docs = await sql`SELECT * FROM documents WHERE project_id = ${parseInt(projectId)} ORDER BY created_at DESC`;
    } else {
      docs = await sql`SELECT * FROM documents ORDER BY created_at DESC`;
    }

    // Batch-resolve project + founder emails so we don't do N round-trips.
    const projectIds = Array.from(new Set(docs.map(d => d.project_id).filter(Boolean)));
    const projectMap = new Map<number, { name: string; founder_email: string | null }>();
    if (projectIds.length > 0) {
      const projRows = await sql`
        SELECT p.id, p.name, f.email AS founder_email
          FROM projects p
          LEFT JOIN founders f ON f.id = p.founder_id
         WHERE p.id = ANY(${projectIds})
      `;
      for (const r of projRows as any[]) {
        projectMap.set(r.id, { name: r.name, founder_email: r.founder_email });
      }
    }

    let rows = docs.map(d => {
      const p = d.project_id ? projectMap.get(d.project_id) : null;
      return enrichRow(d, p?.name || null, p?.founder_email || null);
    });

    if (q) {
      rows = rows.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.recipient_email || '').toLowerCase().includes(q) ||
        (r.template_name || '').toLowerCase().includes(q) ||
        (r.project_name || '').toLowerCase().includes(q)
      );
    }

    const total = rows.length;
    return c.json({ total, limit, offset, items: rows.slice(offset, offset + limit) });
  } finally {
    await sql.end();
  }
});

// GET /api/admin/contracts/stats
adminContracts.get('/stats', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const docs: any[] = await sql`SELECT status, doc_type, signed_at, created_at FROM documents`;
    const byStatus: Record<string, number> = { draft: 0, generated: 0, sent: 0, signed: 0, void: 0 };
    const byTypeCount = new Map<string, number>();
    const signDays: number[] = [];
    let signedRecent = 0;
    const now = Date.now();
    const cutoff = now - 30 * 86400000;

    for (const d of docs) {
      const s = String(d.status || '').toLowerCase();
      if (s in byStatus) byStatus[s]++;
      if (d.doc_type) byTypeCount.set(d.doc_type, (byTypeCount.get(d.doc_type) || 0) + 1);
      const days = daysBetween(d.signed_at, d.created_at);
      if (days != null) signDays.push(days);
      if (d.signed_at) {
        const t = new Date(d.signed_at).getTime();
        if (Number.isFinite(t) && t >= cutoff) signedRecent++;
      }
    }

    const byType = Array.from(byTypeCount.entries())
      .filter(([t]) => !!t)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));

    return c.json({
      total: docs.length,
      by_status: byStatus,
      by_type: byType,
      avg_days_to_sign: signDays.length ? Math.round((signDays.reduce((a, b) => a + b, 0) / signDays.length) * 10) / 10 : null,
      signed_last_30d: signedRecent,
      pending_signature: byStatus.sent + byStatus.generated,
    });
  } finally {
    await sql.end();
  }
});

// GET /api/admin/contracts/templates — catalog with usage counts.
adminContracts.get('/templates', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const docs: any[] = await sql`SELECT template_name, doc_type, created_at FROM documents`;
    const usage = new Map<string, number>();
    const lastUsed = new Map<string, string>();
    for (const d of docs) {
      const key = d.template_name || d.doc_type;
      if (!key) continue;
      usage.set(key, (usage.get(key) || 0) + 1);
      const prev = lastUsed.get(key);
      if (d.created_at && (!prev || new Date(d.created_at) > new Date(prev))) {
        lastUsed.set(key, d.created_at);
      }
    }
    const out = Object.entries(TEMPLATES).map(([k, v]) => ({
      key: k,
      title: v.title,
      doc_type: k,
      layer: v.layer,
      layer_label: TEMPLATE_LAYERS[v.layer]?.label || v.layer,
      usage_count: usage.get(k) || 0,
      last_used_at: lastUsed.get(k) || null,
    }));
    out.sort((a, b) => (b.usage_count - a.usage_count) || a.title.localeCompare(b.title));
    return c.json(out);
  } finally {
    await sql.end();
  }
});

// GET /api/admin/contracts/:uid — detail
adminContracts.get('/:uid', async (c) => {
  await requireAdmin(c);
  const uid = c.req.param('uid');
  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`SELECT * FROM documents WHERE uid = ${uid} LIMIT 1`;
    if (rows.length === 0) return c.json({ error: 'Contract not found' }, 404);
    const d = rows[0];
    let projName: string | null = null;
    let founderEmail: string | null = null;
    if (d.project_id) {
      const pr: any[] = await sql`
        SELECT p.name, f.email AS founder_email
          FROM projects p
          LEFT JOIN founders f ON f.id = p.founder_id
         WHERE p.id = ${d.project_id}
         LIMIT 1
      `;
      if (pr[0]) { projName = pr[0].name; founderEmail = pr[0].founder_email; }
    }
    return c.json(enrichRow(d, projName, founderEmail));
  } finally {
    await sql.end();
  }
});

// POST /api/admin/contracts/:uid/resend
adminContracts.post('/:uid/resend', async (c) => {
  const adminUser = await requireAdmin(c);
  const uid = c.req.param('uid');
  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`SELECT id, uid, title, status, project_id FROM documents WHERE uid = ${uid} LIMIT 1`;
    if (rows.length === 0) return c.json({ error: 'Contract not found' }, 404);
    const d = rows[0];
    if (String(d.status).toLowerCase() === 'signed') {
      return c.json({ error: 'Cannot resend a signed contract' }, 400);
    }
    await sql`UPDATE documents SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE uid = ${uid}`;
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('contract_resent', ${`Admin ${adminUser.name} resent contract '${d.title}'`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
    const updated: any[] = await sql`SELECT * FROM documents WHERE uid = ${uid} LIMIT 1`;
    return c.json({ ok: true, contract: enrichRow(updated[0], null, null) });
  } finally {
    await sql.end();
  }
});

// POST /api/admin/contracts/:uid/void
adminContracts.post('/:uid/void', async (c) => {
  const adminUser = await requireAdmin(c);
  const uid = c.req.param('uid');
  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`SELECT id, uid, title, status, project_id FROM documents WHERE uid = ${uid} LIMIT 1`;
    if (rows.length === 0) return c.json({ error: 'Contract not found' }, 404);
    const d = rows[0];
    if (String(d.status).toLowerCase() === 'signed') {
      return c.json({ error: 'Cannot void a signed contract' }, 400);
    }
    await sql`UPDATE documents SET status = 'void', updated_at = CURRENT_TIMESTAMP WHERE uid = ${uid}`;
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('contract_voided', ${`Admin ${adminUser.name} voided contract '${d.title}'`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
    const updated: any[] = await sql`SELECT * FROM documents WHERE uid = ${uid} LIMIT 1`;
    return c.json({ ok: true, contract: enrichRow(updated[0], null, null) });
  } finally {
    await sql.end();
  }
});

// Task #1 (security hardening) — Contract download is now backed by the
// shared one-time signed-URL primitive (`services/signedDownload.ts` →
// `routes/files.ts:/api/files/dl/:token`). The R2 bucket itself is private;
// admins receive a 5-minute, single-use token that audits each download.
//
// Two endpoints:
//   - GET  /:uid/download      — 302 redirect to the signed URL (browser
//                                navigation, "Download" button in admin UI).
//   - POST /:uid/download-url  — JSON body returning {url, expires_at} so
//                                the SPA can copy/share the link.
async function mintContractDownload(c: AppContext): Promise<ContractDownloadResult> {
  const adminUser = await requireAdmin(c);
  const uid = c.req.param('uid');
  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`SELECT id, uid, title, file_key, status FROM documents WHERE uid = ${uid} LIMIT 1`;
    if (rows.length === 0) return { error: c.json({ error: 'Contract not found' }, 404) };
    const d = rows[0];
    if (!d.file_key) return { error: c.json({ error: 'Contract has no stored file yet' }, 404) };
    if (typeof d.file_key !== 'string' || !/^contracts?\/|^esign\/|^documents\//.test(d.file_key)) {
      // Defence-in-depth: refuse to mint a token for an unexpected R2 prefix
      // so a future bug that lets `file_key` be set arbitrarily can't be
      // pivoted into reading other buckets.
      return { error: c.json({ error: 'Invalid document storage key' }, 400) };
    }
    const minted = await mintDownloadToken(c.env, {
      key: d.file_key,
      ttlSec: 300, // hard-clamped to 5 min upstream too, but explicit here
      audience: 'admin_contract',
      userId: adminUser.id,
    });
    // Audit-log the mint (the actual download is also logged by files.ts).
    try {
      await sql`INSERT INTO activity_logs (action, details, actor, user_id)
                VALUES ('contract_download_url_issued',
                        ${JSON.stringify({ uid: d.uid, title: d.title, expires_at: minted.expires_at })},
                        ${await hashEmail(adminUser.email)},
                        ${adminUser.id})`;
    } catch (e) { console.error('[admin_contracts] audit log failed', e); }
    return { ok: { url: `/api/files/dl/${minted.token}`, expires_at: minted.expires_at } };
  } finally {
    await sql.end();
  }
}

adminContracts.get('/:uid/download', async (c) => {
  const r = await mintContractDownload(c);
  if (r.error) return r.error;
  return c.redirect(r.ok.url, 302);
});

adminContracts.post('/:uid/download-url', async (c) => {
  const r = await mintContractDownload(c);
  if (r.error) return r.error;
  return c.json(r.ok);
});

export default adminContracts;
