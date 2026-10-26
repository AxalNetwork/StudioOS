import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin, requireStepUp, requireBranchNotSuspended } from '../auth';
import { putKycDocumentFromDataUri, getKycDocument, deleteKycDocument } from '../services/r2';
import { hashEmail } from '../util/hashEmail';
import { bindingKey } from '../util/schemaBootstrap';
import { KYC_SENSITIVE, type KycSensitive, kycFieldValue, maskKycData } from '../services/sensitiveFields';
import {
  DOCUMENT_KINDS, MAX_DOCUMENTS, NOTE_MAX, SUBMITTABLE, noticeMember, parseQueueQuery, readFigures, readQueue, recordEvent,
} from '../services/kycCase';

const kyc = new Hono<{ Bindings: Env }>();

const KYC_COLUMNS: Array<[string, string]> = [
  ['kyc_status', "TEXT DEFAULT 'not_started'"],
  ['kyc_data', 'TEXT'],
  ['kyc_provider', 'TEXT'],
  ['kyc_submitted_at', 'TIMESTAMP'],
  ['kyc_reviewed_at', 'TIMESTAMP'],
  ['kyc_reviewed_by', 'INTEGER'],
  ['kyc_rejection_reason', 'TEXT'],
];

const MIGRATED = new WeakMap<object, boolean>();
async function ensureColumns(env: Env) {
  if (MIGRATED.get(bindingKey(env))) return;
  const db = env.DB;
  for (const [col, type] of KYC_COLUMNS) {
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run(); } catch {}
  }
  try { await db.prepare(`UPDATE users SET kyc_status = 'not_started' WHERE kyc_status IS NULL`).run(); } catch {}
  MIGRATED.set(bindingKey(env), true);
}

const ALLOWED_ID_TYPES = ['passport', 'driver_license', 'national_id', 'residence_permit'];
const ALLOWED_DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_DOC_BYTES = 6 * 1024 * 1024; // 6MB

function safeParse(s: any): any {
  if (!s) return null;
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
}

function publicKycData(raw: any) {
  const d = safeParse(raw);
  if (!d) return null;
  // strip raw document bytes from responses to keep payload small.
  // Newer records store an `id_document` metadata object pointing at R2;
  // legacy records inlined `id_document_base64`. Both must be hidden but
  // surfaced as a presence flag.
  const { id_document_base64, id_document, ...safe } = d;
  const hasDoc = !!id_document_base64 || !!(id_document && id_document.file_key);
  return {
    ...safe,
    document_uploaded: hasDoc,
    document_storage: id_document?.file_key ? 'r2' : (id_document_base64 ? 'legacy_d1' : null),
  };
}

async function runMockKyc(payload: any): Promise<{ provider: string; result: 'pass' | 'review' | 'fail'; checks: Record<string, boolean>; ref_id: string }> {
  const checks = {
    name_present: !!(payload.legal_first_name && payload.legal_last_name),
    dob_valid: !!payload.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(payload.date_of_birth),
    address_present: !!payload.address_line1 && !!payload.country,
    id_type_valid: ALLOWED_ID_TYPES.includes(payload.id_type),
    id_number_present: !!payload.id_number && payload.id_number.length >= 4,
    // D1229: a document in `documents` counts as much as the single legacy one.
    document_present: !!payload.id_document_base64 || (Array.isArray(payload.documents) && payload.documents.length > 0),
  };
  const allPass = Object.values(checks).every(Boolean);
  // simple sanctions / age stub
  const ageOk = (() => {
    if (!checks.dob_valid) return false;
    const [y, m, d] = payload.date_of_birth.split('-').map(Number);
    const age = (Date.now() - new Date(y, m - 1, d).getTime()) / (365.25 * 24 * 3600 * 1000);
    return age >= 18 && age < 120;
  })();
  const result = allPass && ageOk ? 'review' : 'fail';
  return {
    provider: 'mock',
    result,
    checks: { ...checks, age_ok: ageOk },
    ref_id: `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

// ---------- USER ENDPOINTS ----------

kyc.get('/status', async (c) => {
  const user = await requireAuth(c);
  await ensureColumns(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT kyc_status, kyc_data, kyc_provider, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason FROM users WHERE id = ${user.id}`;
  await sql.end();
  const row = rows[0] || {};
  // D1229 — while the case needs information, the member reads what was asked.
  let infoRequest: string | null = null;
  if (row.kyc_status === 'needs_info') {
    const ev = await c.env.DB.prepare(
      `SELECT note FROM kyc_case_events WHERE user_id = ? AND kind IN ('needs_info', 'recheck') ORDER BY id DESC LIMIT 1`,
    ).bind(user.id).first<{ note: string | null }>().catch(() => null);
    infoRequest = ev?.note ?? null;
  }
  return c.json({
    user_id: user.id,
    kyc_status: row.kyc_status || 'not_started',
    info_request: infoRequest,
    kyc_provider: row.kyc_provider || null,
    kyc_data: publicKycData(row.kyc_data),
    submitted_at: row.kyc_submitted_at || null,
    reviewed_at: row.kyc_reviewed_at || null,
    rejection_reason: row.kyc_rejection_reason || null,
  });
});

kyc.post('/submit', async (c) => {
  const user = await requireAuth(c);
  await ensureColumns(c.env);
  const body = await c.req.json().catch(() => ({}));

  // Validation
  const required = ['legal_first_name', 'legal_last_name', 'date_of_birth', 'country', 'address_line1', 'city', 'postal_code', 'id_type', 'id_number'];
  const missing = required.filter(k => !body[k] || String(body[k]).trim() === '');
  if (missing.length) return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
  if (!ALLOWED_ID_TYPES.includes(body.id_type)) return c.json({ error: `Invalid id_type. Allowed: ${ALLOWED_ID_TYPES.join(', ')}` }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date_of_birth)) return c.json({ error: 'date_of_birth must be YYYY-MM-DD' }, 400);

  // Document validation (optional but recommended)
  if (body.id_document_base64) {
    if (typeof body.id_document_base64 !== 'string' || !body.id_document_base64.startsWith('data:')) {
      return c.json({ error: 'id_document_base64 must be a data: URI' }, 400);
    }
    const [meta] = body.id_document_base64.split(',');
    const mime = meta.replace('data:', '').replace(';base64', '');
    if (!ALLOWED_DOC_MIME.includes(mime)) return c.json({ error: `Document mime type not allowed. Allowed: ${ALLOWED_DOC_MIME.join(', ')}` }, 400);
    // Approx size: base64 length * 3/4
    const estBytes = Math.floor((body.id_document_base64.length - meta.length - 1) * 3 / 4);
    if (estBytes > MAX_DOC_BYTES) return c.json({ error: `Document exceeds ${MAX_DOC_BYTES / 1024 / 1024}MB limit` }, 413);
  }

  // D1229 — several documents, each with its kind. They go to R2 only: with no
  // bucket bound there is nowhere to keep them, so they are refused rather
  // than inlined into the row as the single legacy document is in dev.
  const documents: Array<{ kind: string; data_uri: string }> = [];
  if (body.documents != null) {
    if (!Array.isArray(body.documents) || body.documents.length > MAX_DOCUMENTS) {
      return c.json({ error: `documents must be a list of at most ${MAX_DOCUMENTS}` }, 400);
    }
    for (const d of body.documents) {
      const kind = String(d?.kind || '');
      const uri = d?.data_uri;
      if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return c.json({ error: `Each document needs a kind: ${DOCUMENT_KINDS.join(', ')}` }, 400);
      if (typeof uri !== 'string' || !uri.startsWith('data:')) return c.json({ error: 'Each document must be a data: URI' }, 400);
      const [meta] = uri.split(',');
      const mime = meta.replace('data:', '').replace(';base64', '');
      if (!ALLOWED_DOC_MIME.includes(mime)) return c.json({ error: `Document mime type not allowed. Allowed: ${ALLOWED_DOC_MIME.join(', ')}` }, 400);
      if (Math.floor((uri.length - meta.length - 1) * 3 / 4) > MAX_DOC_BYTES) return c.json({ error: `Document exceeds ${MAX_DOC_BYTES / 1024 / 1024}MB limit` }, 413);
      documents.push({ kind, data_uri: uri });
    }
    if (documents.length && !c.env.FILES) return c.json({ error: 'storage_unavailable', detail: 'Documents cannot be stored just now. Try again later.' }, 503);
  }

  const sql = getSQL(c.env);

  // Block re-submission unless the case is open to one (D1229: not started,
  // rejected, Needs information or Expired) — do this BEFORE any R2 upload so
  // we never orphan an object on a 409.
  const existing = await sql`SELECT kyc_status, kyc_data FROM users WHERE id = ${user.id}`;
  const status = existing[0]?.kyc_status || 'not_started';
  if (!SUBMITTABLE.includes(status)) {
    await sql.end();
    return c.json({ error: `Cannot resubmit while status is '${status}'` }, 409);
  }
  const previousFileKey: string | undefined = safeParse(existing[0]?.kyc_data)?.id_document?.file_key;

  // Upload to R2. On any post-upload failure below, we delete this object
  // before bailing — see the catch around the UPDATE.
  let documentMeta: Awaited<ReturnType<typeof putKycDocumentFromDataUri>> | null = null;
  if (body.id_document_base64 && c.env.FILES) {
    try {
      documentMeta = await putKycDocumentFromDataUri(c.env, user.id, body.id_document_base64);
    } catch (e: any) {
      console.error('R2 KYC upload failed:', e?.message);
      await sql.end();
      return c.json({ error: 'Failed to store ID document. Please try again.' }, 500);
    }
  }
  const stored: Array<{ kind: string; meta: Awaited<ReturnType<typeof putKycDocumentFromDataUri>> }> = [];
  for (const d of documents) {
    try {
      stored.push({ kind: d.kind, meta: await putKycDocumentFromDataUri(c.env, user.id, d.data_uri) });
    } catch {
      console.error('R2 KYC upload failed: a document in the list');
      for (const s of stored) await deleteKycDocument(c.env, s.meta.file_key).catch(() => {});
      if (documentMeta) await deleteKycDocument(c.env, documentMeta.file_key).catch(() => {});
      await sql.end();
      return c.json({ error: 'Failed to store ID document. Please try again.' }, 500);
    }
  }

  // Provider selection
  let providerResult;
  let providerName = 'mock';
  if (c.env.PERSONA_API_KEY) {
    providerName = 'persona';
    // Placeholder — real Persona Inquiry API would be called here.
    providerResult = { provider: 'persona', result: 'review' as const, checks: { provider_stub: true }, ref_id: `persona_pending_${Date.now()}` };
  } else if (c.env.SUMSUB_API_KEY) {
    providerName = 'sumsub';
    providerResult = { provider: 'sumsub', result: 'review' as const, checks: { provider_stub: true }, ref_id: `sumsub_pending_${Date.now()}` };
  } else {
    providerResult = await runMockKyc(body);
  }

  const kycPayload = {
    legal_first_name: body.legal_first_name,
    legal_last_name: body.legal_last_name,
    date_of_birth: body.date_of_birth,
    nationality: body.nationality || null,
    country: body.country,
    address_line1: body.address_line1,
    address_line2: body.address_line2 || null,
    city: body.city,
    state_region: body.state_region || null,
    postal_code: body.postal_code,
    id_type: body.id_type,
    id_number: body.id_number,
    // Store R2 metadata pointer (preferred) OR fall back to inline base64
    // when no R2 binding is configured (dev). Never store both.
    id_document: documentMeta,
    id_document_base64: documentMeta ? null : (body.id_document_base64 || null),
    phone: body.phone || null,
    pep_self_disclosed: !!body.pep_self_disclosed,
    sanctions_acknowledged: !!body.sanctions_acknowledged,
    submitted_at: new Date().toISOString(),
    provider_result: providerResult,
  };

  const newStatus = providerResult.result === 'fail' ? 'rejected' : 'pending';
  const rejectionReason = providerResult.result === 'fail' ? 'Automated checks failed — please correct your information and resubmit.' : null;

  try {
    await sql`UPDATE users SET kyc_status = ${newStatus}, kyc_data = ${JSON.stringify(kycPayload)}, kyc_provider = ${providerName}, kyc_submitted_at = CURRENT_TIMESTAMP, kyc_rejection_reason = ${rejectionReason} WHERE id = ${user.id}`;
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_submitted', ${`KYC verification submitted via ${providerName} (auto-result: ${providerResult.result})`}, ${await hashEmail(user.email)}, ${user.id})`;
    for (const d of stored) {
      await c.env.DB.prepare('INSERT INTO kyc_documents (user_id, kind, file_key, content_type, size_bytes) VALUES (?, ?, ?, ?, ?)')
        .bind(user.id, d.kind, d.meta.file_key, d.meta.content_type, d.meta.size).run();
    }
    const at = await c.env.DB.prepare('SELECT kyc_submitted_at FROM users WHERE id = ?').bind(user.id).first<{ kyc_submitted_at: string | null }>();
    await recordEvent(c.env, { userId: Number(user.id), kind: 'submitted', actorId: Number(user.id), submittedAt: at?.kyc_submitted_at ?? null });
    // An automated fail is a decision the member is told about on the page; it is recorded beside the submission.
    if (newStatus === 'rejected') await recordEvent(c.env, { userId: Number(user.id), kind: 'rejected', actorId: null, note: rejectionReason, submittedAt: at?.kyc_submitted_at ?? null });
  } catch (e) {
    // Compensating delete: roll back the R2 upload if DB write failed,
    // otherwise we'd orphan PII.
    if (documentMeta) await deleteKycDocument(c.env, documentMeta.file_key).catch(() => {});
    for (const d of stored) await deleteKycDocument(c.env, d.meta.file_key).catch(() => {});
    await sql.end();
    throw e;
  }
  await sql.end();

  // Resubmission cleanup: delete the previously-stored document, if any.
  // Done after the UPDATE so a failure here doesn't leave the user without
  // a valid pointer; we just log it as a soft leak.
  if (previousFileKey && previousFileKey !== documentMeta?.file_key) {
    await deleteKycDocument(c.env, previousFileKey).catch(e => console.error('R2 cleanup of previous KYC doc failed:', e?.message, previousFileKey));
  }

  return c.json({
    kyc_status: newStatus,
    provider: providerName,
    auto_result: providerResult.result,
    rejection_reason: rejectionReason,
    message: newStatus === 'pending'
      ? 'Submitted. An Axal compliance reviewer will approve within 1 business day.'
      : 'Automated checks failed. Please review your information and resubmit.',
  });
});

// ---------- ADMIN ENDPOINTS ----------

kyc.get('/admin/queue', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const status = c.req.query('status') || 'pending';
  const sql = getSQL(c.env);
  // Identity stays off the list. The review window reads the record, which is logged.
  const rows = await sql`SELECT id, email, name, role, kyc_status, kyc_provider, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason FROM users WHERE kyc_status = ${status} ORDER BY kyc_submitted_at DESC`;
  const listed = rows.map((r: any) => ({
    id: r.id, email: r.email, name: r.name, role: r.role,
    kyc_status: r.kyc_status, kyc_provider: r.kyc_provider,
    submitted_at: r.kyc_submitted_at, reviewed_at: r.kyc_reviewed_at,
    rejection_reason: r.kyc_rejection_reason,
  }));
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_queue_access', ${`KYC queue read count=${listed.length}`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
  await sql.end();
  return c.json(listed);
});

// ---------- D1229 · THE PEOPLE QUEUE, THE FIGURES ----------

// KYC1, KYC2 — the people queue: search, the filters, sort (oldest first by
// default), paging, the count per status, the wait, the ID type, the country,
// the flags, the assignee and the reviewer. Identity values stay off it, as on
// `/admin/queue`, which keeps D648's console working unchanged. One
// `kyc_queue_access` row per read.
kyc.get('/admin/people', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const q = parseQueueQuery(c.req.query(), Number(adminUser.id));
  const out = await readQueue(c.env, q);
  await c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind('kyc_queue_access', `KYC people read count=${out.rows.length} total=${out.total} page=${out.page}`, await hashEmail(adminUser.email), adminUser.id).run();
  return c.json(out);
});

// KYC3 — decisions per week, the median time to a decision, the wait bands.
kyc.get('/admin/figures', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const out = await readFigures(c.env);
  await c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind('kyc_figures_access', `KYC figures read decisions_measured=${out.decisions_measured}`, await hashEmail(adminUser.email), adminUser.id).run();
  return c.json(out);
});

kyc.get('/admin/:userId', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, email, name, role, kyc_status, kyc_provider, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, kyc_data FROM users WHERE id = ${userId}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const r: any = rows[0];
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_record_access', ${`Admin read KYC record for user_id=${r.id}`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
  await sql.end();
  return c.json({
    id: r.id, email: r.email, name: r.name, role: r.role,
    kyc_status: r.kyc_status, kyc_provider: r.kyc_provider,
    submitted_at: r.kyc_submitted_at, reviewed_at: r.kyc_reviewed_at,
    rejection_reason: r.kyc_rejection_reason,
    // D634 — sensitive values leave masked. Each one is shown, and logged,
    // through `GET /admin/:userId/sensitive/:field` below.
    kyc_data: maskKycData(publicKycData(r.kyc_data)),
    _admin: adminUser.email,
  });
});

// D634 (#1392) — one sensitive KYC value in clear, and that showing logged.
// `kyc_field_shown` names the field and the member, never the value. A field
// the member did not submit is a 404 that writes nothing: nothing was shown.
kyc.get('/admin/:userId/sensitive/:field', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const field = c.req.param('field') as KycSensitive;
  if (!(KYC_SENSITIVE as readonly string[]).includes(field)) {
    return c.json({ error: 'unknown_field', detail: `Only ${KYC_SENSITIVE.join(', ')} can be shown.` }, 400);
  }
  const userId = parseInt(c.req.param('userId'));
  const row = await c.env.DB.prepare('SELECT id, kyc_data FROM users WHERE id = ?').bind(userId).first<any>();
  if (!row) return c.json({ error: 'user_not_found', detail: 'This member does not exist. Nothing was shown.' }, 404);
  const value = kycFieldValue(safeParse(row.kyc_data), field);
  if (value == null) {
    return c.json({ error: 'field_not_recorded', detail: 'The member did not submit this. Nothing was shown.' }, 404);
  }
  const shownAt = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind('kyc_field_shown', `Admin showed ${field} on the KYC record for user_id=${row.id}`, await hashEmail(adminUser.email), adminUser.id).run();
  return c.json({ field, value, shown_at: shownAt, shown_by: adminUser.name || null });
});

// Stream a KYC document from R2 back to an admin reviewer.
// Auth is re-checked here, so links are safe to share with other admins
// (their session still has to be valid). Every access is audit-logged.
kyc.get('/admin/:userId/document', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, email, kyc_data FROM users WHERE id = ${userId}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target: any = rows[0];
  const data = safeParse(target.kyc_data);
  const fileKey: string | undefined = data?.id_document?.file_key;
  const legacyB64: string | undefined = data?.id_document_base64;

  // Fall back to legacy inline base64 for records uploaded before R2 migration.
  if (!fileKey && legacyB64) {
    const commaIdx = legacyB64.indexOf(',');
    const meta = legacyB64.slice(5, commaIdx);
    const contentType = meta.replace(';base64', '').trim();
    // Defense-in-depth: re-check the stored MIME against the allowlist on
    // read, in case the row was tampered with via a direct SQL path.
    if (!ALLOWED_DOC_MIME.includes(contentType)) {
      await sql.end();
      return c.json({ error: 'Stored document has disallowed content type' }, 415);
    }
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_document_access', ${`Admin viewed KYC document for user_id=${target.id} (legacy D1 storage)`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
    await sql.end();
    const bin = atob(legacyB64.slice(commaIdx + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { 'content-type': contentType, 'cache-control': 'private, no-store' } });
  }

  if (!fileKey) { await sql.end(); return c.json({ error: 'No document on file' }, 404); }

  const obj = await getKycDocument(c.env, fileKey);
  if (!obj) { await sql.end(); return c.json({ error: 'Document not found in storage' }, 404); }
  const objContentType = obj.httpMetadata?.contentType || '';
  if (!ALLOWED_DOC_MIME.includes(objContentType)) {
    await sql.end();
    return c.json({ error: 'Stored document has disallowed content type' }, 415);
  }

  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_document_access', ${`Admin viewed KYC document for user_id=${target.id} (${fileKey})`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
  await sql.end();

  return new Response(obj.body, {
    headers: {
      'content-type': objContentType,
      'cache-control': 'private, no-store',
      'content-length': String(obj.size),
    },
  });
});


// ---------- D1229 · ONE CASE: assignment, notes, history, documents ----------

const caseUserId = (c: any) => {
  const n = Number(c.req.param('userId'));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const logAdmin = async (c: any, adminUser: any, action: string, details: string) => {
  await c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind(action, details, await hashEmail(adminUser.email), adminUser.id).run();
};

// KYC5 — the case beside the record: who holds it, its history, HQ's notes and
// its documents (their kinds and sizes, never their bytes). Logged once.
kyc.get('/admin/:userId/case', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = caseUserId(c);
  if (!userId) return c.json({ error: 'user_not_found' }, 404);
  const who = await c.env.DB.prepare(
    `SELECT u.id, u.kyc_status, ka.assignee_id AS kyc_assignee_id, ka.assigned_at AS kyc_assigned_at, a.name AS assignee_name
       FROM users u
       LEFT JOIN kyc_case_assignments ka ON ka.user_id = u.id
       LEFT JOIN users a ON a.id = ka.assignee_id
      WHERE u.id = ?`,
  ).bind(userId).first<any>();
  if (!who) return c.json({ error: 'user_not_found' }, 404);
  const [events, notes, documents] = await Promise.all([
    c.env.DB.prepare(
      `SELECT e.id, e.kind, e.note, e.submitted_at, e.created_at, e.actor_user_id, a.name AS actor_name
         FROM kyc_case_events e LEFT JOIN users a ON a.id = e.actor_user_id
        WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 100`,
    ).bind(userId).all<any>(),
    c.env.DB.prepare(
      `SELECT n.id, n.body, n.created_at, n.author_user_id, a.name AS author_name
         FROM kyc_notes n LEFT JOIN users a ON a.id = n.author_user_id
        WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`,
    ).bind(userId).all<any>(),
    c.env.DB.prepare(
      'SELECT id, kind, content_type, size_bytes, created_at, removed_at FROM kyc_documents WHERE user_id = ? ORDER BY id',
    ).bind(userId).all<any>(),
  ]);
  await logAdmin(c, adminUser, 'kyc_case_access', `Admin read the KYC case for user_id=${userId}`);
  return c.json({
    user_id: userId,
    kyc_status: who.kyc_status || 'not_started',
    assignee: who.kyc_assignee_id ? { id: who.kyc_assignee_id, name: who.assignee_name ?? null } : null,
    assigned_at: who.kyc_assigned_at ?? null,
    events: (events.results || []).map((e: any) => ({
      id: e.id, kind: e.kind, note: e.note ?? null, submitted_at: e.submitted_at ?? null, at: e.created_at,
      actor: e.actor_user_id ? { id: e.actor_user_id, name: e.actor_name ?? null } : null,
    })),
    notes: (notes.results || []).map((n: any) => ({
      id: n.id, body: n.body, at: n.created_at, author: { id: n.author_user_id, name: n.author_name ?? null },
    })),
    documents: documents.results || [],
  });
});

// Assign the case to an admin, or to nobody. Not a decision, so no step-up.
kyc.patch('/admin/:userId/assign', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = caseUserId(c);
  if (!userId) return c.json({ error: 'user_not_found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const raw = body?.assignee_id;
  const assigneeId = raw == null ? null : Number(raw);
  if (assigneeId != null && !(Number.isInteger(assigneeId) && assigneeId > 0)) return c.json({ error: 'assignee_id must be an admin\'s id, or null' }, 400);
  const target = await c.env.DB.prepare(
    `SELECT u.id, ka.assignee_id AS kyc_assignee_id FROM users u LEFT JOIN kyc_case_assignments ka ON ka.user_id = u.id WHERE u.id = ?`,
  ).bind(userId).first<any>();
  if (!target) return c.json({ error: 'user_not_found' }, 404);
  if (assigneeId != null) {
    const a = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'admin'").bind(assigneeId).first();
    if (!a) return c.json({ error: 'assignee_not_admin', detail: 'Only an HQ admin can hold a KYC case.' }, 400);
  }
  if ((target.kyc_assignee_id ?? null) === assigneeId) return c.json({ user_id: userId, assignee_id: assigneeId, changed: false });
  await c.env.DB.prepare(
    `INSERT INTO kyc_case_assignments (user_id, assignee_id, assigned_at, updated_at)
     VALUES (?, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET assignee_id = excluded.assignee_id, assigned_at = excluded.assigned_at, updated_at = excluded.updated_at`,
  ).bind(userId, assigneeId, assigneeId).run();
  await recordEvent(c.env, { userId, kind: assigneeId == null ? 'unassigned' : 'assigned', actorId: Number(adminUser.id), note: assigneeId == null ? null : `user_id=${assigneeId}` });
  await logAdmin(c, adminUser, 'kyc_case_assigned', `Admin ${assigneeId == null ? 'unassigned' : `assigned user_id=${assigneeId} to`} the KYC case for user_id=${userId}`);
  return c.json({ user_id: userId, assignee_id: assigneeId, changed: true });
});

// HQ's note on a case. The member never reads it; the log never holds it.
kyc.post('/admin/:userId/notes', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = caseUserId(c);
  if (!userId) return c.json({ error: 'user_not_found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const text = String(body?.body ?? '').trim();
  if (!text) return c.json({ error: 'note_empty', detail: 'Write the note first.' }, 400);
  if (text.length > NOTE_MAX) return c.json({ error: 'note_too_long', detail: `A note is at most ${NOTE_MAX} characters.` }, 400);
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!target) return c.json({ error: 'user_not_found' }, 404);
  const res = await c.env.DB.prepare('INSERT INTO kyc_notes (user_id, author_user_id, body) VALUES (?, ?, ?)').bind(userId, adminUser.id, text).run();
  await logAdmin(c, adminUser, 'kyc_note_added', `Admin added a note to the KYC case for user_id=${userId}`);
  return c.json({ id: res.meta?.last_row_id ?? null, user_id: userId }, 201);
});

// One document of the case, streamed and logged as the single one is.
kyc.get('/admin/:userId/documents/:docId', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = caseUserId(c);
  const docId = Number(c.req.param('docId'));
  if (!userId || !Number.isInteger(docId)) return c.json({ error: 'No document on file' }, 404);
  const doc = await c.env.DB.prepare('SELECT id, file_key, kind FROM kyc_documents WHERE id = ? AND user_id = ? AND removed_at IS NULL')
    .bind(docId, userId).first<{ id: number; file_key: string; kind: string }>();
  if (!doc) return c.json({ error: 'No document on file' }, 404);
  const obj = await getKycDocument(c.env, doc.file_key);
  if (!obj) return c.json({ error: 'Document not found in storage' }, 404);
  const type = obj.httpMetadata?.contentType || '';
  if (!ALLOWED_DOC_MIME.includes(type)) return c.json({ error: 'Stored document has disallowed content type' }, 415);
  await logAdmin(c, adminUser, 'kyc_document_access', `Admin viewed KYC document ${doc.kind} #${doc.id} for user_id=${userId}`);
  return new Response(obj.body, { headers: { 'content-type': type, 'cache-control': 'private, no-store', 'content-length': String(obj.size) } });
});

/** The submission a decision answers, for the event. */
const submittedAtOf = async (env: Env, userId: number) =>
  (await env.DB.prepare('SELECT kyc_submitted_at FROM users WHERE id = ?').bind(userId).first<{ kyc_submitted_at: string | null }>())?.kyc_submitted_at ?? null;

/** A message the member reads: at least five characters, at most NOTE_MAX. */
const memberMessage = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s.length >= 5 && s.length <= NOTE_MAX ? s : null;
};

// Needs information: a waiting case goes back to the member with a question.
// A decision, so step-up and the branch gate, as approve and reject.
kyc.patch('/admin/:userId/needs-info', async (c) => {
  const adminUser = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  await requireStepUp(c);
  await ensureColumns(c.env);
  const userId = caseUserId(c);
  if (!userId) return c.json({ error: 'User not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const message = memberMessage(body?.message);
  if (!message) return c.json({ error: `Say what the member should send (5 to ${NOTE_MAX} characters)` }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE users SET kyc_status = 'needs_info', kyc_reviewed_at = CURRENT_TIMESTAMP, kyc_reviewed_by = ? WHERE id = ? AND kyc_status = 'pending'`,
  ).bind(adminUser.id, userId).run();
  if (!res.meta?.changes) {
    const t = await c.env.DB.prepare('SELECT kyc_status FROM users WHERE id = ?').bind(userId).first<{ kyc_status: string | null }>();
    if (!t) return c.json({ error: 'User not found' }, 404);
    return c.json({ error: 'not_waiting', detail: 'Only a waiting case can be sent back for information.', kyc_status: t.kyc_status || 'not_started' }, 409);
  }
  await recordEvent(c.env, { userId, kind: 'needs_info', actorId: Number(adminUser.id), note: message, submittedAt: await submittedAtOf(c.env, userId) });
  await logAdmin(c, adminUser, 'kyc_needs_info_by_admin', `Admin asked for information on the KYC case for user_id=${userId}`);
  await noticeMember(c.env, userId, 'needs_info', message);
  return c.json({ kyc_status: 'needs_info', user_id: userId });
});

// Re-check: an approved or expired person verifies again. Their full access
// waits until the new check is approved, which is what the dialog says.
kyc.patch('/admin/:userId/recheck', async (c) => {
  const adminUser = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  await requireStepUp(c);
  await ensureColumns(c.env);
  const userId = caseUserId(c);
  if (!userId) return c.json({ error: 'User not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const message = memberMessage(body?.message);
  if (!message) return c.json({ error: `Say why the member should verify again (5 to ${NOTE_MAX} characters)` }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE users SET kyc_status = 'needs_info', kyc_reviewed_at = CURRENT_TIMESTAMP, kyc_reviewed_by = ? WHERE id = ? AND kyc_status IN ('approved', 'expired')`,
  ).bind(adminUser.id, userId).run();
  if (!res.meta?.changes) {
    const t = await c.env.DB.prepare('SELECT kyc_status FROM users WHERE id = ?').bind(userId).first<{ kyc_status: string | null }>();
    if (!t) return c.json({ error: 'User not found' }, 404);
    return c.json({ error: 'not_checked', detail: 'Only an approved or expired check can be re-checked.', kyc_status: t.kyc_status || 'not_started' }, 409);
  }
  await recordEvent(c.env, { userId, kind: 'recheck', actorId: Number(adminUser.id), note: message, submittedAt: await submittedAtOf(c.env, userId) });
  await logAdmin(c, adminUser, 'kyc_recheck_by_admin', `Admin asked user_id=${userId} to verify again`);
  await noticeMember(c.env, userId, 'recheck', message);
  return c.json({ kyc_status: 'needs_info', user_id: userId });
});

kyc.patch('/admin/:userId/approve', async (c) => {
  const adminUser = await requireAdmin(c);
  // D260 — a suspended branch clears no one for full access: 423, after the
  // admin gate (an anonymous caller still gets 401) and before step-up (a
  // frozen branch is not asked for a code it could not use).
  await requireBranchNotSuspended(c);
  await requireStepUp(c); // BLOCK-AUTH-03 — KYC verdicts require a RECENT TOTP step-up
  await ensureColumns(c.env);
  const userId = parseInt(c.req.param('userId'));
  // D1229 — an optional approval note, kept on the case's history (HQ's words, never the member's).
  const approveBody = await c.req.json().catch(() => ({}));
  const approvalNote = approveBody?.note == null ? null : String(approveBody.note).trim();
  if (approvalNote && approvalNote.length > NOTE_MAX) return c.json({ error: `An approval note is at most ${NOTE_MAX} characters` }, 400);
  const sql = getSQL(c.env);
  // Pull kyc_submitted_at too so we can distinguish a normal queue review
  // (user submitted KYC, admin reviewed it) from an admin bypass
  // (admin grants full access without the user ever submitting). Both paths
  // land on kyc_status='approved', but the audit trail must show which.
  const rows = await sql`SELECT id, email, name, kyc_status, kyc_submitted_at FROM users WHERE id = ${userId}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target: any = rows[0];
  if (target.kyc_status === 'approved') { await sql.end(); return c.json({ error: 'Already approved' }, 409); }
  const isBypass = !target.kyc_submitted_at;

  await sql`UPDATE users SET kyc_status = 'approved', kyc_reviewed_at = CURRENT_TIMESTAMP, kyc_reviewed_by = ${adminUser.id}, kyc_rejection_reason = NULL WHERE id = ${userId}`;
  const adminAction = isBypass ? 'kyc_bypass_granted' : 'kyc_approved_by_admin';
  const adminDetails = isBypass
    ? `Admin ${adminUser.name} granted full access (KYC bypass) to ${target.name} (user_id=${target.id}) — no submission on file`
    : `Admin ${adminUser.name} approved KYC for ${target.name} (user_id=${target.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES (${adminAction}, ${adminDetails}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_approved', ${`Your KYC verification was approved by Axal compliance.`}, ${await hashEmail(target.email)}, ${target.id})`;
  await sql.end();
  await recordEvent(c.env, { userId, kind: 'approved', actorId: Number(adminUser.id), note: approvalNote || null, submittedAt: target.kyc_submitted_at ?? null });
  await noticeMember(c.env, userId, 'approved');

  // Fire commission event for the referrer (if any)
  try {
    const { fireCommissionEvent } = await import('./network');
    await fireCommissionEvent(c.env, userId, 'referral_kyc_approved', `kyc:${userId}`);
  } catch (e) { console.error('fireCommissionEvent failed:', e); }

  return c.json({ kyc_status: 'approved', user_id: userId });
});

kyc.patch('/admin/:userId/reject', async (c) => {
  const adminUser = await requireAdmin(c);
  // D260 — the verdict is frozen both ways, as every D107 queue is: a reject
  // purges the stored document and writes a verdict, and neither is a takedown.
  await requireBranchNotSuspended(c);
  await requireStepUp(c); // BLOCK-AUTH-03 — KYC verdicts require a RECENT TOTP step-up
  await ensureColumns(c.env);
  const userId = parseInt(c.req.param('userId'));
  const { reason } = await c.req.json().catch(() => ({}));
  if (!reason || String(reason).trim().length < 5) return c.json({ error: 'Rejection reason required (min 5 chars)' }, 400);

  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, email, name, kyc_status, kyc_data, kyc_submitted_at FROM users WHERE id = ${userId}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target: any = rows[0];

  // Delete the stored ID document on rejection — we should not retain
  // PII for users we've explicitly told to start over. The metadata
  // pointer in kyc_data stays for audit history but the bytes are gone.
  const rejectFileKey: string | undefined = safeParse(target.kyc_data)?.id_document?.file_key;
  if (rejectFileKey) {
    await deleteKycDocument(c.env, rejectFileKey).catch(e => console.error('R2 cleanup on reject failed:', e?.message, rejectFileKey));
  }

  await sql`UPDATE users SET kyc_status = 'rejected', kyc_reviewed_at = CURRENT_TIMESTAMP, kyc_reviewed_by = ${adminUser.id}, kyc_rejection_reason = ${reason} WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_rejected_by_admin', ${`Admin ${adminUser.name} rejected KYC for ${target.name} — reason: ${reason} (document purged: ${!!rejectFileKey})`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_rejected', ${`Your KYC submission was rejected by Axal compliance. Reason: ${reason}. You may resubmit.`}, ${await hashEmail(target.email)}, ${target.id})`;
  await sql.end();
  // D1229 — the case's other documents go too: the bytes from R2, the row keeps when.
  const listed = await c.env.DB.prepare('SELECT id, file_key FROM kyc_documents WHERE user_id = ? AND removed_at IS NULL').bind(userId).all<{ id: number; file_key: string }>();
  for (const d of listed.results || []) {
    await deleteKycDocument(c.env, d.file_key).catch(() => console.error('R2 cleanup on reject failed: a listed document'));
    await c.env.DB.prepare('UPDATE kyc_documents SET removed_at = CURRENT_TIMESTAMP WHERE id = ? AND removed_at IS NULL').bind(d.id).run();
  }
  await recordEvent(c.env, { userId, kind: 'rejected', actorId: Number(adminUser.id), note: String(reason), submittedAt: target.kyc_submitted_at ?? null });
  await noticeMember(c.env, userId, 'rejected', String(reason));
  return c.json({ kyc_status: 'rejected', user_id: userId, reason });
});

export default kyc;
