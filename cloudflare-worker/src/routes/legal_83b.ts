import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { getActiveTemplateBody } from '../services/legalTemplateStore';
import { applyMergeFields } from '../services/mergeFields';
import {
  ensureSection83bSchema,
  tracker83bDto,
  addDaysISO,
  type Section83bRow,
} from '../services/section83b';

// ----------------------- 83(b) tracker (Task #13) ---------------------------
// Worker parity for the 83(b) tracker (/spinout-lab/83b). The dev FastAPI backend
// (routes/legal.py) is the authoritative contract; the DTO + access rules
// mirror it 1:1. Trackers are scoped per founder (admins/partners see all);
// the receipt upload stores binary scans in R2 (FILES) with a JSON pointer
// in the document `content` column (the worker `documents` table has no
// file_* columns), and `content` is never returned by `safeDoc`.
//
// Lives in its own Hono sub-app (mounted by legal.ts) so the route logic can
// be exercised by `node --test` under --experimental-strip-types without
// dragging legal.ts's heavy import graph (billing → payments → queue) into
// the strip-only loader.

const app = new Hono<{ Bindings: Env }>();

// Inline fallback for the election body when the canonical D1 template store
// has no active `section_83b` slug. The rich, counsel-reviewed body is
// managed in the FastAPI backend; this keeps prod from silently failing.
const ELECTION_FALLBACK = 'SECTION 83(b) ELECTION — ELECTION TO INCLUDE IN GROSS INCOME UNDER SECTION 83(b)';

function isPrivileged(role: unknown): boolean {
  return role === 'admin' || role === 'partner';
}

app.get('/83b/trackers', async (c) => {
  const user = await requireAuth(c);
  await ensureSection83bSchema(c.env);
  const sql = getSQL(c.env);
  const projectIdRaw = c.req.query('project_id');
  const projectId = projectIdRaw ? Number(projectIdRaw) : null;
  const priv = isPrivileged(user.role);

  let rows: any[];
  if (priv && projectId) {
    rows = await sql`SELECT * FROM section_83b_trackers WHERE project_id = ${projectId} ORDER BY deadline_date ASC`;
  } else if (priv) {
    rows = await sql`SELECT * FROM section_83b_trackers ORDER BY deadline_date ASC`;
  } else if (projectId) {
    rows = await sql`SELECT * FROM section_83b_trackers WHERE user_id = ${user.id} AND project_id = ${projectId} ORDER BY deadline_date ASC`;
  } else {
    rows = await sql`SELECT * FROM section_83b_trackers WHERE user_id = ${user.id} ORDER BY deadline_date ASC`;
  }
  await sql.end();
  return c.json({ trackers: (rows as Section83bRow[]).map(tracker83bDto) });
});

app.post('/83b/trackers', async (c) => {
  const user = await requireAuth(c);
  await ensureSection83bSchema(c.env);
  const body = (await c.req.json().catch(() => ({}))) as {
    project_id?: number | string;
    taxpayer_name?: string;
    grant_date?: string;
  };
  const projectId = Number(body.project_id);
  const taxpayerName = String(body.taxpayer_name || '').trim();
  const grantDate = String(body.grant_date || '').trim();

  if (!projectId) return c.json({ error: 'project_id is required' }, 400);
  if (!taxpayerName) return c.json({ error: 'taxpayer_name is required' }, 400);
  // Strict calendar validation to match FastAPI's date.fromisoformat: JS
  // Date.parse normalizes impossible dates (2026-02-31 -> 2026-03-03), so we
  // verify the parsed Y/M/D round-trips to the input instead of trusting it.
  const gm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(grantDate);
  if (!gm) return c.json({ error: 'grant_date must be ISO format (YYYY-MM-DD)' }, 400);
  const gy = Number(gm[1]);
  const gmo = Number(gm[2]);
  const gd = Number(gm[3]);
  const gdt = new Date(Date.UTC(gy, gmo - 1, gd));
  if (gdt.getUTCFullYear() !== gy || gdt.getUTCMonth() !== gmo - 1 || gdt.getUTCDate() !== gd) {
    return c.json({ error: 'grant_date is not a valid calendar date' }, 400);
  }

  const sql = getSQL(c.env);
  const projRows = await sql`SELECT id, name, founder_id, entity_id FROM projects WHERE id = ${projectId}`;
  if (projRows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projRows[0] as any;

  // Same write guard as the wizard / FastAPI `_check_project_write_access`:
  // admin/partner OR the founder who owns the project. Investors are NOT
  // privileged here.
  if (!isPrivileged(user.role)) {
    const ownsProject = project.founder_id != null && (user as any).founder_id === project.founder_id;
    if (!ownsProject) { await sql.end(); return c.json({ error: 'Forbidden: you do not own this project' }, 403); }
  }

  const deadline = addDaysISO(grantDate, 30);

  // Idempotency: same project + user + grant_date → reuse. The unique index
  // (uq_83b_project_user_grant) also guards against a concurrent race below.
  const existing = await sql`
    SELECT * FROM section_83b_trackers
     WHERE project_id = ${projectId} AND user_id = ${user.id} AND grant_date = ${grantDate}
     LIMIT 1`;
  if (existing.length) {
    await sql.end();
    return c.json({ ok: true, reused: true, tracker: tracker83bDto(existing[0] as Section83bRow) });
  }

  // Generate a pre-filled election Document (body stored inline in `content`;
  // never surfaced via safeDoc). Prefer the canonical D1 template store.
  let company = String(project.name || '');
  if (project.entity_id) {
    const er = await sql`SELECT name FROM entities WHERE id = ${project.entity_id}`;
    if (er.length && (er[0] as any).name) company = String((er[0] as any).name);
  }
  const grantYear = grantDate.slice(0, 4);
  const d1Body = await getActiveTemplateBody(c.env, 'section_83b');
  let content: string;
  if (d1Body) {
    content = applyMergeFields(d1Body, {
      company_name: company,
      taxpayer_name: taxpayerName,
      tax_year: grantYear,
      date_of_transfer: grantDate,
    });
  } else {
    content =
      `${ELECTION_FALLBACK}\n\nCompany: ${company}\nTaxpayer: ${taxpayerName}\n` +
      `Tax Year: ${grantYear}\nDate of transfer: ${grantDate}\n\n` +
      '[Counsel-reviewed body managed in the FastAPI backend.]';
  }
  const docTitle = `83(b) Election — ${taxpayerName} (${grantDate})`;
  const docRows = await sql`
    INSERT INTO documents (project_id, title, doc_type, status, content, template_name)
    VALUES (${projectId}, ${docTitle}, 'section_83b', 'generated', ${content}, 'section_83b')
    RETURNING id`;
  const electionDocId = (docRows[0] as any).id as number;

  let trackerRows: any[];
  try {
    trackerRows = await sql`
      INSERT INTO section_83b_trackers
        (project_id, user_id, taxpayer_name, grant_date, deadline_date, election_doc_id, status)
      VALUES
        (${projectId}, ${user.id}, ${taxpayerName}, ${grantDate}, ${deadline}, ${electionDocId}, 'pending')
      RETURNING *`;
  } catch (e) {
    // Lost the race against the unique index — return the now-existing row.
    const again = await sql`
      SELECT * FROM section_83b_trackers
       WHERE project_id = ${projectId} AND user_id = ${user.id} AND grant_date = ${grantDate}
       LIMIT 1`;
    await sql.end();
    if (again.length) return c.json({ ok: true, reused: true, tracker: tracker83bDto(again[0] as Section83bRow) });
    throw e;
  }
  await sql.end();

  return c.json({
    ok: true,
    reused: false,
    tracker: tracker83bDto(trackerRows[0] as Section83bRow),
    election_document_id: electionDocId,
  });
});

app.patch('/83b/trackers/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureSection83bSchema(c.env);
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as {
    mailed_at?: string;
    receipt_doc_id?: number;
    status?: string;
    notes?: string;
  };

  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM section_83b_trackers WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Tracker not found' }, 404); }
  const t = rows[0] as Section83bRow;
  if (!isPrivileged(user.role) && t.user_id !== user.id) {
    await sql.end();
    return c.json({ error: 'Forbidden: not your tracker' }, 403);
  }

  let mailedAt = t.mailed_at;
  let status = t.status;
  let receiptDocId = t.receipt_doc_id;
  let notes = t.notes;

  if (body.mailed_at != null) {
    const parsed = Date.parse(body.mailed_at);
    if (Number.isNaN(parsed)) { await sql.end(); return c.json({ error: 'mailed_at must be ISO datetime' }, 400); }
    mailedAt = new Date(parsed).toISOString();
    if (status === 'pending') status = 'mailed';
  }
  if (body.receipt_doc_id != null) {
    const docId = Number(body.receipt_doc_id);
    const d = await sql`SELECT id, project_id FROM documents WHERE id = ${docId}`;
    if (d.length === 0 || (d[0] as any).project_id !== t.project_id) {
      await sql.end();
      return c.json({ error: 'receipt_doc_id is not a document on this project' }, 400);
    }
    receiptDocId = docId;
  }
  if (body.status != null) {
    if (!['pending', 'mailed', 'confirmed', 'missed'].includes(body.status)) {
      await sql.end();
      return c.json({ error: 'Invalid status' }, 400);
    }
    status = body.status;
  }
  if (body.notes != null) notes = body.notes;

  const updated = await sql`
    UPDATE section_83b_trackers
       SET mailed_at = ${mailedAt ?? null},
           status = ${status},
           receipt_doc_id = ${receiptDocId ?? null},
           notes = ${notes ?? null},
           updated_at = datetime('now')
     WHERE id = ${id}
     RETURNING *`;
  await sql.end();
  return c.json({ ok: true, tracker: tracker83bDto(updated[0] as Section83bRow) });
});

app.post('/83b/trackers/:id/receipt', async (c) => {
  const user = await requireAuth(c);
  await ensureSection83bSchema(c.env);
  const id = Number(c.req.param('id'));

  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM section_83b_trackers WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Tracker not found' }, 404); }
  const t = rows[0] as Section83bRow;
  if (!isPrivileged(user.role) && t.user_id !== user.id) {
    await sql.end();
    return c.json({ error: 'Forbidden: not your tracker' }, 403);
  }

  const ctype = (c.req.header('content-type') || '').toLowerCase();
  if (!ctype.includes('multipart/form-data')) {
    await sql.end();
    return c.json({ error: 'file is required (multipart/form-data)' }, 400);
  }
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof (file as unknown as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
    await sql.end();
    return c.json({ error: 'file is required (multipart/form-data)' }, 400);
  }
  const f = file as unknown as { type?: string; arrayBuffer(): Promise<ArrayBuffer> };
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes.length === 0) { await sql.end(); return c.json({ error: 'Empty file' }, 400); }
  if (bytes.length > 10 * 1024 * 1024) { await sql.end(); return c.json({ error: 'File too large (max 10 MB)' }, 400); }

  // Magic-byte sniff (don't trust the client Content-Type). Receipts are
  // scans of PS Form 3800 — PDF / JPEG / PNG cover every legitimate upload.
  const h = bytes;
  let sniffed: string | null = null;
  if (h.length >= 5 && h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d) {
    sniffed = 'application/pdf'; // %PDF-
  } else if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) {
    sniffed = 'image/jpeg';
  } else if (
    h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 &&
    h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a
  ) {
    sniffed = 'image/png';
  }
  if (!sniffed) { await sql.end(); return c.json({ error: 'Receipt must be a PDF, JPEG, or PNG file' }, 400); }
  const declared = String(f.type || '').toLowerCase().split(';')[0].trim();
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);
  if (declared && !allowed.has(declared)) {
    await sql.end();
    return c.json({ error: `Unsupported content type: ${declared}` }, 400);
  }
  const contentType = sniffed;

  // Persist bytes to R2 first — only link the Document + tracker if storage
  // succeeds (explicit failure over a silent drop of the filing-date proof).
  const files = c.env.FILES;
  if (!files) {
    await sql.end();
    return c.json({ error: 'Receipt storage is not configured on this deployment.' }, 503);
  }
  const r2Key = `83b-receipts/${t.uid}/${crypto.randomUUID()}`;
  try {
    await files.put(r2Key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { userId: String(user.id), trackerId: String(id) },
    });
  } catch {
    await sql.end();
    return c.json({ error: 'Receipt storage failed; please retry.' }, 502);
  }

  let sha256 = '';
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { /* hash is best-effort metadata */ }

  const pointer = JSON.stringify({
    kind: '83b_certified_receipt',
    r2_key: r2Key,
    content_type: contentType,
    size: bytes.length,
    sha256,
  });
  const docRows = await sql`
    INSERT INTO documents (project_id, title, doc_type, status, content, template_name)
    VALUES (${t.project_id}, ${`83(b) Certified-Mail Receipt — ${t.taxpayer_name}`}, 'other', 'generated', ${pointer}, '83b_certified_receipt')
    RETURNING id`;
  const receiptDocId = (docRows[0] as any).id as number;

  const newStatus = t.status === 'pending' ? 'mailed' : t.status;
  const newMailedAt = t.mailed_at ?? new Date().toISOString();
  const updated = await sql`
    UPDATE section_83b_trackers
       SET receipt_doc_id = ${receiptDocId},
           status = ${newStatus},
           mailed_at = ${newMailedAt},
           updated_at = datetime('now')
     WHERE id = ${id}
     RETURNING *`;
  await sql.end();
  return c.json({ ok: true, tracker: tracker83bDto(updated[0] as Section83bRow) });
});

export default app;
