/**
 * D6139 part 1 (#6139) — accreditation evidence: the investor uploads a
 * verification letter, the fund team reviews it. Store: `accreditation_evidence`
 * (migration 202611272256_6139); the file is a record in R2 under
 * `accreditation-evidence/<user_id>/`. Rules: `services/accreditationEvidence.ts`.
 *
 * The member, on /api/trust/accreditation:
 *   POST /evidence        multipart `basis` + `file`: one verification letter
 *                         from a CPA, attorney, broker-dealer or registered
 *                         adviser (owner answer A), PDF, PNG or JPEG by its
 *                         bytes, at most 10 MB. Only a member asked for
 *                         `accreditation_v1` (required, not waived). One letter
 *                         open at a time (409 `letter_open`). A pending or
 *                         expired requirement moves to `in_review`; a satisfied
 *                         one stays satisfied while a renewal letter is read.
 *   GET  /evidence/mine   the requirement and the caller's letters: basis,
 *                         uploaded date, state, and the decision's date, period
 *                         and reason. Never the file, its key or its digest.
 *
 * The fund team, on /api/kyc (the KYC desk; part 2 draws it), every call logged
 * in `activity_logs` under an action the KYC audit lists (`KYC_AUDIT_ACTIONS`):
 *   GET  /admin/accreditation?status=open|all     requireAdmin, `accreditation_queue_access`
 *   GET  /admin/accreditation/:id/file            requireAdmin, `accreditation_document_access`
 *   POST /admin/accreditation/:id/decision        requireAdmin + step-up, not on a suspended branch
 *        { decision: 'in_review' }                `accreditation_review_started`
 *        { decision: 'accept' }                   `accreditation_accepted`: the letter and
 *                                                 `accreditation_v1` are satisfied until now + the
 *                                                 accreditation period HQ sets (`renewalPeriods`)
 *        { decision: 'send_back', reason }        `accreditation_sent_back`: the member reads the
 *                                                 reason; a requirement in review returns to pending
 *
 * THE ONLY WRITER of `accreditation_v1 = 'satisfied'` is the accept decision
 * here (`services/trust.ts` keeps it out of the signature and clickwrap
 * satisfiers). A reviewer never decides their own letter, and another admin's
 * letter is the Super Admin's.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { isSuperAdmin, requireAdmin, requireAuth, requireBranchNotSuspended, requireStepUp } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { hashEmail } from '../util/hashEmail';
import { investorPreviewRefusal } from '../util/investorPreview';
import { putRecordOrThrow } from '../services/recordStore';
import { eraseRecordObjects } from '../services/recordErasure';
import { monthsToMs, renewalPeriods } from '../services/trust';
import {
  ACCREDITATION_EVIDENCE_PREFIX, ACCREDITATION_LETTER_MAX_BYTES, EVIDENCE_COLUMNS, INVESTOR_RECORD_RETENTION_MONTHS,
  SEND_BACK_REASON_MAX, SEND_BACK_REASON_MIN, isAccreditationBasis, letterFileName, letterKeptUntil, memberEvidence,
  sha256Hex, sniffLetter, type EvidenceRow,
} from '../services/accreditationEvidence';
import kyc from './kyc';

const member = new Hono<{ Bindings: Env }>();
const review = new Hono<{ Bindings: Env }>();

type Obligation = { required: number; status: string; expires_at: string | null };

async function obligationOf(env: Env, userId: number): Promise<Obligation | null> {
  return env.DB.prepare(
    `SELECT required, status, expires_at FROM legal_obligations WHERE user_id = ? AND obligation_key = 'accreditation_v1'`,
  ).bind(userId).first<Obligation>();
}

const asked = (o: Obligation | null) => !!o && Number(o.required) === 1 && o.status !== 'waived';

/** The member's open letter, if any. */
async function openLetter(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT ${EVIDENCE_COLUMNS} FROM accreditation_evidence e WHERE e.user_id = ? AND e.status IN ('submitted','in_review')`,
  ).bind(userId).first<EvidenceRow>();
}

async function logAction(env: Env, action: string, details: string, actor: User) {
  await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind(action, details, await hashEmail(actor.email), actor.id).run();
}

const unreadable = (c: any, raw: unknown) => refuse(c, 503, {
  code: 'accreditation_unreadable',
  message: 'Your accreditation evidence could not be read. Try again.',
  raw,
});

// POST /api/trust/accreditation/evidence — multipart { basis, file }
member.post('/evidence', async (c) => {
  try {
    const user = await requireAuth(c);
    const preview = investorPreviewRefusal(c, user);
    if (preview) return preview;
    const type = String(c.req.header('content-type') || '').toLowerCase();
    const form = type.startsWith('multipart/form-data') ? await c.req.formData().catch(() => null) : null;
    if (!form) return refuse(c, 400, { code: 'letter_required', message: 'Send the letter as a file, with who wrote it.' });
    const basis = form.get('basis');
    if (!isAccreditationBasis(basis)) {
      return refuse(c, 400, { code: 'bad_basis', message: 'Say who wrote the letter: a CPA, an attorney, a broker-dealer or a registered adviser.' });
    }
    const f = form.get('file');
    const file = f && typeof f === 'object' && typeof (f as File).arrayBuffer === 'function' ? f as File : null;
    if (!file || !file.size) return refuse(c, 400, { code: 'letter_required', message: 'Choose the verification letter to upload.' });
    if (file.size > ACCREDITATION_LETTER_MAX_BYTES) return refuse(c, 413, { code: 'letter_too_large', message: 'The letter is at most 10 MB.' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffLetter(bytes);
    if (!kind) return refuse(c, 415, { code: 'letter_type', message: 'Upload the letter as a PDF, PNG or JPEG file.' });

    const obligation = await obligationOf(c.env, user.id);
    if (!asked(obligation)) {
      return refuse(c, 403, { code: 'accreditation_not_asked', message: 'Accreditation evidence is not asked of your account.' });
    }
    if (await openLetter(c.env, user.id)) {
      return refuse(c, 409, { code: 'letter_open', message: 'A letter of yours is already with the fund team. Wait for their decision before sending another.' });
    }
    if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Letters cannot be stored just now. Try again later.' });

    const fileKey = `${ACCREDITATION_EVIDENCE_PREFIX}${user.id}/${crypto.randomUUID()}.${kind.ext}`;
    const sha256 = await sha256Hex(bytes);
    const name = letterFileName(file.name, kind.ext);
    const at = nowIso();
    // D6651: a letter is a record, written once under a fresh key.
    await putRecordOrThrow(c.env.FILES, fileKey, bytes, {
      httpMetadata: { contentType: kind.mime },
      customMetadata: { user_id: String(user.id), sha256 },
    });
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO accreditation_evidence (user_id, basis, file_key, file_name, content_type, size_bytes, sha256, status, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
        ).bind(user.id, basis, fileKey, name, kind.mime, bytes.byteLength, sha256, at),
        // A pending or expired requirement is now in review; a satisfied one stays satisfied while a renewal is read.
        c.env.DB.prepare(
          `UPDATE legal_obligations SET status = 'in_review', updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND obligation_key = 'accreditation_v1' AND status IN ('pending','expired')`,
        ).bind(user.id),
        c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
          .bind('accreditation_evidence_submitted', `Accreditation letter uploaded (${basis}) by user_id=${user.id}`, await hashEmail(user.email), user.id),
      ]);
    } catch (e) {
      // No row names the file this request just stored; it leaves through the record-erasure path (D6651).
      try { await eraseRecordObjects(c.env.FILES, fileKey, 'unreferenced', { db: c.env.DB }); } catch { console.warn('[accreditation] orphan_letter_not_deleted'); }
      if (/UNIQUE constraint failed/i.test(String((e as Error)?.message || ''))) {
        return refuse(c, 409, { code: 'letter_open', message: 'A letter of yours is already with the fund team. Wait for their decision before sending another.' });
      }
      throw e;
    }
    const row = await openLetter(c.env, user.id);
    return c.json({ item: row ? memberEvidence(row) : null }, 201);
  } catch (e) { return mapError(c, e); }
});

// GET /api/trust/accreditation/evidence/mine
member.get('/evidence/mine', async (c) => {
  try {
    const user = await requireAuth(c);
    let obligation: Obligation | null; let rows: EvidenceRow[]; let months: number;
    try {
      obligation = await obligationOf(c.env, user.id);
      rows = (await c.env.DB.prepare(
        `SELECT ${EVIDENCE_COLUMNS} FROM accreditation_evidence e WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 50`,
      ).bind(user.id).all<EvidenceRow>()).results || [];
      months = (await renewalPeriods(c.env)).accreditation_v1.months;
    } catch (e) { return unreadable(c, e); }
    return c.json({
      obligation: obligation ? { required: Number(obligation.required) === 1, status: obligation.status, expires_at: obligation.expires_at ?? null } : null,
      items: rows.map(memberEvidence),
      retention: { accreditation_months: months, investor_record_months: INVESTOR_RECORD_RETENTION_MONTHS },
    });
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * The fund team's review
 * ------------------------------------------------------------------ */

const evidenceId = (raw: string | undefined) => (raw && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null);

/** The letter and its owner's role, or null when the reviewer may not see it: another admin's letter is the Super Admin's. */
async function reviewable(env: Env, reviewer: User, id: number) {
  const row = await env.DB.prepare(
    `SELECT ${EVIDENCE_COLUMNS}, e.status, e.file_key, u.role AS owner_role, u.name AS owner_name
       FROM accreditation_evidence e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ?`,
  ).bind(id).first<EvidenceRow & { status: string; file_key: string; owner_role: string | null; owner_name: string | null }>();
  if (!row) return null;
  if (row.owner_role === 'admin' && !isSuperAdmin(reviewer as any)) return null;
  return row;
}

const notFound = (c: any) => refuse(c, 404, { code: 'letter_not_found', message: 'No such letter is on record.' });

// GET /api/kyc/admin/accreditation?status=open|all — the letters, oldest open first. No file in the list.
review.get('/admin/accreditation', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const status = c.req.query('status') || 'open';
    if (status !== 'open' && status !== 'all') return refuse(c, 400, { code: 'bad_status', message: 'status must be open or all.' });
    const rows = (await c.env.DB.prepare(
      `SELECT ${EVIDENCE_COLUMNS}, u.name AS owner_name, u.role AS owner_role
         FROM accreditation_evidence e LEFT JOIN users u ON u.id = e.user_id
        WHERE (? = 'all' OR e.status IN ('submitted','in_review'))
          AND (COALESCE(u.role, '') <> 'admin' OR ? = 1)
        ORDER BY CASE WHEN e.status IN ('submitted','in_review') THEN 0 ELSE 1 END, e.uploaded_at ASC, e.id ASC LIMIT 500`,
    ).bind(status, isSuperAdmin(admin as any) ? 1 : 0).all<EvidenceRow & { owner_name: string | null }>()).results || [];
    await logAction(c.env, 'accreditation_queue_access', `Accreditation letters read status=${status} count=${rows.length}`, admin);
    return c.json({
      items: rows.map((r) => ({
        ...memberEvidence(r),
        review_reason: r.review_reason ?? null,
        content_type: r.content_type,
        size_bytes: Number(r.size_bytes),
        member: { id: Number(r.user_id), name: r.owner_name ?? null },
        kept_until: letterKeptUntil(r.expires_at),
      })),
      retention: { investor_record_months: INVESTOR_RECORD_RETENTION_MONTHS },
    });
  } catch (e) { return mapError(c, e); }
});

// GET /api/kyc/admin/accreditation/:id/file — the letter itself, to a reviewer. Logged.
review.get('/admin/accreditation/:id/file', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const id = evidenceId(c.req.param('id'));
    const row = id ? await reviewable(c.env, admin, id) : null;
    if (!row) return notFound(c);
    if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'File storage is not available.' });
    if (!String(row.file_key).startsWith(ACCREDITATION_EVIDENCE_PREFIX)) return notFound(c);
    const obj = await c.env.FILES.get(String(row.file_key));
    if (!obj) return refuse(c, 404, { code: 'letter_unreadable', message: 'The letter could not be read from storage.' });
    await logAction(c.env, 'accreditation_document_access', `Admin viewed accreditation letter ${row.id} for user_id=${row.user_id}`, admin);
    return new Response(obj.body, {
      headers: {
        'Content-Type': row.content_type,
        'Content-Disposition': `attachment; filename="${String(row.file_name).replace(/[^\w.\- ]/g, '_')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/kyc/admin/accreditation/:id/decision — { decision: 'in_review' | 'accept' | 'send_back', reason? }
review.post('/admin/accreditation/:id/decision', async (c) => {
  try {
    const admin = await requireAdmin(c);
    await requireBranchNotSuspended(c);
    await requireStepUp(c);
    const id = evidenceId(c.req.param('id'));
    const row = id ? await reviewable(c.env, admin, id) : null;
    if (!row) return notFound(c);
    if (Number(row.user_id) === Number(admin.id)) {
      return refuse(c, 403, { code: 'own_letter', message: 'Another reviewer decides your own letter.' });
    }
    const body = await c.req.json().catch(() => ({} as any));
    const decision = String(body?.decision ?? '');
    if (!['in_review', 'accept', 'send_back'].includes(decision)) {
      return refuse(c, 400, { code: 'bad_decision', message: 'decision must be in_review, accept or send_back.' });
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (decision === 'send_back' && (reason.length < SEND_BACK_REASON_MIN || reason.length > SEND_BACK_REASON_MAX)) {
      return refuse(c, 400, { code: 'reason_required', message: `Say why the letter is sent back, in ${SEND_BACK_REASON_MIN} to ${SEND_BACK_REASON_MAX} characters. The member reads it.` });
    }
    const already = () => refuse(c, 409, { code: 'letter_decided', message: 'This letter is already decided.', extra: { status: row.state } });
    const at = nowIso();
    const actor = await hashEmail(admin.email);
    const log = (action: string, details: string) => c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
      .bind(action, details, actor, admin.id);

    if (decision === 'in_review') {
      const res = await c.env.DB.prepare(
        `UPDATE accreditation_evidence SET status = 'in_review', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'submitted'`,
      ).bind(admin.id, at, row.id).run();
      if (!res.meta?.changes) return row.state === 'in_review' ? c.json({ id: row.id, status: 'in_review' }) : already();
      await log('accreditation_review_started', `Admin started reviewing accreditation letter ${row.id} for user_id=${row.user_id}`).run();
      return c.json({ id: row.id, status: 'in_review' });
    }

    if (decision === 'send_back') {
      const res = await c.env.DB.prepare(
        `UPDATE accreditation_evidence SET status = 'sent_back', reviewed_by = ?, reviewed_at = ?, review_reason = ?
          WHERE id = ? AND status IN ('submitted','in_review')`,
      ).bind(admin.id, at, reason, row.id).run();
      if (!res.meta?.changes) return already();
      await c.env.DB.batch([
        // A requirement this letter put in review is pending again; a satisfied one (a renewal) keeps its period.
        c.env.DB.prepare(
          `UPDATE legal_obligations SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND obligation_key = 'accreditation_v1' AND status = 'in_review'`,
        ).bind(row.user_id),
        log('accreditation_sent_back', `Admin sent back accreditation letter ${row.id} for user_id=${row.user_id}`),
      ]);
      return c.json({ id: row.id, status: 'sent_back', review_reason: reason });
    }

    // accept — the one writer of accreditation_v1 = 'satisfied'. The period is HQ's (`kyc_renewal_periods`).
    let months: number;
    try { months = (await renewalPeriods(c.env)).accreditation_v1.months; }
    catch (e) { return refuse(c, 503, { code: 'period_unreadable', message: 'How long accreditation lasts could not be read, so nothing was accepted. Try again.', raw: e, audience: 'admin' }); }
    const expiresAt = new Date(Date.now() + monthsToMs(months)).toISOString();
    try {
      const target = await c.env.DB.prepare(
        `SELECT status FROM legal_obligations WHERE user_id = ? AND obligation_key = 'accreditation_v1'`,
      ).bind(row.user_id).first<{ status: string }>();
      if (!target || target.status === 'waived') {
        return refuse(c, 409, { code: 'accreditation_not_asked', message: 'This member is not asked for accreditation evidence, so nothing was accepted.' });
      }
      const res = await c.env.DB.prepare(
        `UPDATE accreditation_evidence SET status = 'accepted', reviewed_by = ?, reviewed_at = ?, expires_at = ?
          WHERE id = ? AND status IN ('submitted','in_review')`,
      ).bind(admin.id, at, expiresAt, row.id).run();
      if (!res.meta?.changes) return already();
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE legal_obligations
              SET status = 'satisfied', expires_at = ?,
                  evidence_meta = json_object('source', 'accreditation_evidence', 'evidence_id', ?),
                  updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND obligation_key = 'accreditation_v1' AND status <> 'waived'`,
        ).bind(expiresAt, row.id, row.user_id),
        log('accreditation_accepted', `Admin accepted accreditation letter ${row.id} for user_id=${row.user_id} until ${expiresAt.slice(0, 10)}`),
      ]);
    } catch (e) { return mapError(c, e); }
    return c.json({ id: row.id, status: 'accepted', expires_at: expiresAt, period_months: months });
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount[] = [
  { path: '/api/trust/accreditation', router: member },
  // Ahead of `kyc.ts`, whose `/admin/:userId` would read "accreditation" as an account id.
  { path: '/api/kyc', router: review, before: [kyc] },
];
export { member as accreditationMember, review as accreditationReview };
