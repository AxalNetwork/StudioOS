import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin } from '../auth';

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

let migrated = false;
async function ensureColumns(env: Env) {
  if (migrated) return;
  const db = env.DB;
  for (const [col, type] of KYC_COLUMNS) {
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run(); } catch {}
  }
  try { await db.prepare(`UPDATE users SET kyc_status = 'not_started' WHERE kyc_status IS NULL`).run(); } catch {}
  migrated = true;
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
  // strip raw document base64 from responses to keep payload small
  const { id_document_base64, ...safe } = d;
  return { ...safe, document_uploaded: !!id_document_base64 };
}

async function runMockKyc(payload: any): Promise<{ provider: string; result: 'pass' | 'review' | 'fail'; checks: Record<string, boolean>; ref_id: string }> {
  const checks = {
    name_present: !!(payload.legal_first_name && payload.legal_last_name),
    dob_valid: !!payload.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(payload.date_of_birth),
    address_present: !!payload.address_line1 && !!payload.country,
    id_type_valid: ALLOWED_ID_TYPES.includes(payload.id_type),
    id_number_present: !!payload.id_number && payload.id_number.length >= 4,
    document_present: !!payload.id_document_base64,
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
  return c.json({
    user_id: user.id,
    kyc_status: row.kyc_status || 'not_started',
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

  const sql = getSQL(c.env);

  // Block re-submission unless rejected or not_started
  const existing = await sql`SELECT kyc_status FROM users WHERE id = ${user.id}`;
  const status = existing[0]?.kyc_status || 'not_started';
  if (!['not_started', 'rejected'].includes(status)) {
    await sql.end();
    return c.json({ error: `Cannot resubmit while status is '${status}'` }, 409);
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
    id_document_base64: body.id_document_base64 || null,
    phone: body.phone || null,
    pep_self_disclosed: !!body.pep_self_disclosed,
    sanctions_acknowledged: !!body.sanctions_acknowledged,
    submitted_at: new Date().toISOString(),
    provider_result: providerResult,
  };

  const newStatus = providerResult.result === 'fail' ? 'rejected' : 'pending';
  const rejectionReason = providerResult.result === 'fail' ? 'Automated checks failed — please correct your information and resubmit.' : null;

  await sql`UPDATE users SET kyc_status = ${newStatus}, kyc_data = ${JSON.stringify(kycPayload)}, kyc_provider = ${providerName}, kyc_submitted_at = CURRENT_TIMESTAMP, kyc_rejection_reason = ${rejectionReason} WHERE id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_submitted', ${`KYC verification submitted via ${providerName} (auto-result: ${providerResult.result})`}, ${user.email}, ${user.id})`;
  await sql.end();

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
  await requireAdmin(c);
  await ensureColumns(c.env);
  const status = c.req.query('status') || 'pending';
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, email, name, role, kyc_status, kyc_provider, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, kyc_data FROM users WHERE kyc_status = ${status} ORDER BY kyc_submitted_at DESC`;
  await sql.end();
  return c.json(rows.map((r: any) => ({
    id: r.id, email: r.email, name: r.name, role: r.role,
    kyc_status: r.kyc_status, kyc_provider: r.kyc_provider,
    submitted_at: r.kyc_submitted_at, reviewed_at: r.kyc_reviewed_at,
    rejection_reason: r.kyc_rejection_reason,
    kyc_data: publicKycData(r.kyc_data),
  })));
});

kyc.get('/admin/:userId', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, email, name, role, kyc_status, kyc_provider, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, kyc_data FROM users WHERE id = ${userId}`;
  await sql.end();
  if (!rows.length) return c.json({ error: 'User not found' }, 404);
  const r: any = rows[0];
  return c.json({
    id: r.id, email: r.email, name: r.name, role: r.role,
    kyc_status: r.kyc_status, kyc_provider: r.kyc_provider,
    submitted_at: r.kyc_submitted_at, reviewed_at: r.kyc_reviewed_at,
    rejection_reason: r.kyc_rejection_reason,
    kyc_data: publicKycData(r.kyc_data),
    _admin: adminUser.email,
  });
});

kyc.patch('/admin/:userId/approve', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, email, name, kyc_status FROM users WHERE id = ${userId}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target: any = rows[0];
  if (target.kyc_status === 'approved') { await sql.end(); return c.json({ error: 'Already approved' }, 409); }

  await sql`UPDATE users SET kyc_status = 'approved', kyc_reviewed_at = CURRENT_TIMESTAMP, kyc_reviewed_by = ${adminUser.id}, kyc_rejection_reason = NULL WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_approved_by_admin', ${`Admin ${adminUser.name} approved KYC for ${target.name} (${target.email})`}, ${adminUser.email}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_approved', ${`Your KYC verification was approved by Axal compliance.`}, ${target.email}, ${target.id})`;
  await sql.end();

  // Fire commission event for the referrer (if any)
  try {
    const { fireCommissionEvent } = await import('./network');
    await fireCommissionEvent(c.env, userId, 'referral_kyc_approved', `kyc:${userId}`);
  } catch (e) { console.error('fireCommissionEvent failed:', e); }

  return c.json({ kyc_status: 'approved', user_id: userId });
});

kyc.patch('/admin/:userId/reject', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureColumns(c.env);
  const userId = parseInt(c.req.param('userId'));
  const { reason } = await c.req.json().catch(() => ({}));
  if (!reason || String(reason).trim().length < 5) return c.json({ error: 'Rejection reason required (min 5 chars)' }, 400);

  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, email, name, kyc_status FROM users WHERE id = ${userId}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target: any = rows[0];

  await sql`UPDATE users SET kyc_status = 'rejected', kyc_reviewed_at = CURRENT_TIMESTAMP, kyc_reviewed_by = ${adminUser.id}, kyc_rejection_reason = ${reason} WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_rejected_by_admin', ${`Admin ${adminUser.name} rejected KYC for ${target.name} — reason: ${reason}`}, ${adminUser.email}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('kyc_rejected', ${`Your KYC submission was rejected by Axal compliance. Reason: ${reason}. You may resubmit.`}, ${target.email}, ${target.id})`;
  await sql.end();
  return c.json({ kyc_status: 'rejected', user_id: userId, reason });
});

export default kyc;
