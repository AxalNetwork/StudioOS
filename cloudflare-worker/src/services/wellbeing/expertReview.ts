/** D1043: private credentials and decisions; no member check-in data. */
import type { Env } from '../../types';
import { isSuperAdmin } from '../../auth';
import { notify } from '../notify';
import { isSampleExpert } from './seedExperts';
import { ensureAdminAuditLogTable } from '../../routes/admin';

export class ExpertReviewError extends Error {
  code: string; status: number; sentence: string;
  constructor(code: string, sentence: string, status = 400) { super(sentence); this.code = code; this.status = status; this.sentence = sentence; }
}
export type ReviewActor = Parameters<typeof isSuperAdmin>[0] & { id: number };
export type ReviewAction = 'verified' | 'unverified' | 'declined' | 'hidden' | 'restored';
export const CREDENTIAL_FILE_MAX = 10 * 1024 * 1024;
export const CREDENTIAL_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

export async function reviewTarget(env: Env, uid: string, actor: ReviewActor) {
  const row = await env.DB.prepare(`SELECT e.*, u.role AS account_role FROM experts e LEFT JOIN users u ON u.id = e.user_id WHERE e.uid = ?`)
    .bind(uid).first<any>();
  if (!row) throw new ExpertReviewError('expert_not_found', 'Expert not found.', 404);
  if (row.account_role === 'admin' && row.user_id !== actor.id && !isSuperAdmin(actor)) {
    throw new ExpertReviewError('super_admin_required', 'Another admin’s credentials require the Super Admin.', 403);
  }
  return row;
}

export async function ownExpert(env: Env, userId: number) {
  const row = await env.DB.prepare('SELECT * FROM experts WHERE user_id = ? ORDER BY id DESC LIMIT 1').bind(userId).first<any>();
  if (!row) throw new ExpertReviewError('expert_not_found', 'Create an expert profile before recording credentials.', 404);
  return row;
}

export async function credentialFilesFor(env: Env, ids: number[]) {
  const result = await env.DB.prepare(`SELECT expert_id, uid, file_name, file_type, file_size, created_at FROM expert_credential_files
    WHERE expert_id IN (SELECT value FROM json_each(?)) ORDER BY expert_id, created_at, uid`)
    .bind(JSON.stringify(ids)).all<any>();
  if (('success' in result && !result.success) || !Array.isArray(result.results)) throw new Error('Credential files were not returned');
  const grouped = new Map<number, any[]>();
  for (const r of result.results) {
    const files = grouped.get(Number(r.expert_id)) ?? [];
    files.push({ uid: r.uid, file_name: r.file_name, file_type: r.file_type, file_size: r.file_size, created_at: r.created_at,
      url: `/api/wellbeing/experts/credentials/files/${encodeURIComponent(r.uid)}` });
    grouped.set(Number(r.expert_id), files);
  }
  return grouped;
}

export async function credentialFiles(env: Env, id: number) {
  return (await credentialFilesFor(env, [id])).get(id) ?? [];
}

export async function reviewDto(env: Env, row: any, files?: any[], includeActor = false) {
  return {
    uid: row.uid, name: row.name, headline: row.headline, bio: row.bio, is_sample: isSampleExpert(row.uid),
    verified: !!row.verified, hidden: !!row.hidden_by_admin, created_at: row.created_at ?? null,
    profile_completion_pct: row.profile_completion_pct ?? null,
    decision_state: row.decision_state, ...(includeActor ? { decided_by: row.decided_by ?? null } : {}), decided_at: row.decided_at ?? null,
    decline_reason: row.decline_reason ?? null, review_version: row.review_version,
    credentials: { licence_number: row.licence_number ?? null, issuer: row.licence_issuer ?? null,
      expires_on: row.licence_expires_on ?? null, files: files ?? await credentialFiles(env, row.id) },
  };
}

export async function expertDecision(env: Env, row: any, actor: ReviewActor, decision: ReviewAction, body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ExpertReviewError('invalid_body', 'Send the decision as an object.');
  if (row.user_id === actor.id && !isSuperAdmin(actor) && ['verified', 'declined', 'restored'].includes(decision)) {
    throw new ExpertReviewError('independent_review_required', 'The Super Admin must decide on your own expert profile.', 403);
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (decision === 'declined' && (reason.length < 10 || reason.length > 4000)) {
    throw new ExpertReviewError('reason_required', 'A decline needs a reason of 10 to 4000 characters. The expert sees it.');
  }
  if (decision === 'verified') {
    if (body.credentials_checked !== true) throw new ExpertReviewError('credentials_check_required', 'Confirm that you checked the expert’s credentials.');
    if (!Number.isSafeInteger(body.expected_version)) throw new ExpertReviewError('version_required', 'Send the review version you checked.');
    if (row.licence_expires_on && row.licence_expires_on < new Date().toISOString().slice(0, 10)) {
      throw new ExpertReviewError('credentials_expired', 'The recorded credential has expired. Ask the expert to update it.');
    }
  }
  if ((decision === 'verified' || decision === 'declined') && !row.user_id) {
    throw new ExpertReviewError('expert_account_required', 'This expert has no member account to receive the decision. Link an account first.', 409);
  }
  if (body.expected_version !== undefined && body.expected_version !== row.review_version) {
    throw new ExpertReviewError('review_changed', 'The profile or credentials changed. Read them again before deciding.', 409);
  }
  if (decision === 'unverified' && !row.verified) {
    throw new ExpertReviewError('already_decided', 'This expert is not currently verified.', 409);
  }
  const verified = decision === 'verified' ? 1 : ['unverified', 'declined'].includes(decision) ? 0 : row.verified;
  const hidden = decision === 'hidden' ? 1 : decision === 'restored' ? 0 : row.hidden_by_admin;
  const state = decision === 'verified' ? 'verified' : decision === 'declined' ? 'declined' : decision === 'unverified' && row.decision_state === 'verified' ? 'pending' : row.decision_state;
  if (verified === row.verified && hidden === row.hidden_by_admin && state === row.decision_state) {
    throw new ExpertReviewError('already_decided', 'This expert is already in that state.', 409);
  }
  const token = crypto.randomUUID(); const at = new Date().toISOString();
  const visibilityOnly = decision === 'hidden' || decision === 'restored';
  const decidedBy = visibilityOnly ? row.decided_by : actor.id;
  const decidedAt = visibilityOnly ? row.decided_at : at;
  const version = Number(row.review_version) + 1;
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE experts SET verified = ?, hidden_by_admin = ?, decision_state = ?, decided_by = ?, decided_at = ?,
      decline_reason = ?, review_version = ?, decision_token = ? WHERE id = ? AND review_version = ?`)
      .bind(verified, hidden, state, decidedBy, decidedAt, decision === 'declined' ? reason : ['hidden', 'restored'].includes(decision) ? row.decline_reason : null, version, token, row.id, row.review_version),
    env.DB.prepare(`INSERT INTO expert_review_decisions(uid, expert_id, decision, decided_by, decided_at, reason, credentials_checked, review_version)
      SELECT ?, id, ?, ?, ?, ?, ?, ? FROM experts WHERE id = ? AND decision_token = ?`)
      .bind(token, decision, actor.id, at, reason || null, decision === 'verified' ? 1 : 0, version, row.id, token),
  ]);
  if (results.some((r) => 'success' in r && !r.success)) throw new Error('Decision batch failed');
  if (Number(results[0].meta?.changes) !== 1) throw new ExpertReviewError('review_changed', 'The profile or credentials changed. Read them again.', 409);
  if (row.user_id) await notify(env, {
    userId: row.user_id, type: `wellbeing_expert_${decision}`, title: `Wellbeing expert profile ${decision}`,
    body: `Your wellbeing expert profile was ${decision}.${decision === 'declined' ? ` Reason: ${reason}` : ''}`,
    link: '/wellbeing/expert-dashboard', channels: ['in_app', 'email'], payload: { expert_uid: row.uid, decision },
  });
  return { ok: true, verified: !!verified, hidden: !!hidden, decision_state: state, decided_by: decidedBy, decided_at: decidedAt, review_version: version };
}

export async function saveCredentials(env: Env, row: any, body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ExpertReviewError('invalid_body', 'Send the credentials as an object.');
  const values: Record<string, string | null> = {};
  for (const key of ['licence_number', 'issuer', 'expires_on']) {
    const value = body[key] === undefined ? ({ licence_number: row.licence_number, issuer: row.licence_issuer, expires_on: row.licence_expires_on } as any)[key] : body[key];
    if (value !== null && (typeof value !== 'string' || value.trim().length > 200)) throw new ExpertReviewError('invalid_credentials', 'Credential values must be text of at most 200 characters, or null.');
    values[key] = typeof value === 'string' ? value.trim() || null : null;
  }
  const expiry = values.expires_on;
  if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(expiry)) || new Date(expiry).toISOString().slice(0, 10) !== expiry)) {
    throw new ExpertReviewError('invalid_expiry', 'Use a real expiry date in YYYY-MM-DD format, or null when none is recorded.');
  }
  if (values.licence_number === (row.licence_number ?? null) && values.issuer === (row.licence_issuer ?? null)
      && expiry === (row.licence_expires_on ?? null)) return;
  const changed = await env.DB.prepare(`UPDATE experts SET licence_number = ?, licence_issuer = ?, licence_expires_on = ?,
    verified = 0, decision_state = 'pending', decided_by = NULL, decided_at = NULL, decline_reason = NULL, decision_token = NULL,
    review_version = review_version + 1 WHERE id = ? AND review_version = ?`)
    .bind(values.licence_number, values.issuer, expiry, row.id, row.review_version).run();
  if (Number(changed.meta?.changes) !== 1) throw new ExpertReviewError('review_changed', 'The credentials changed. Read them again.', 409);
}

/** Same governance feed for every expert decision; the atomic history above
 * remains authoritative if this best-effort activity copy cannot be written. */
export async function auditExpert(env: Env, adminId: number, action: string, uid: string) {
  try {
    await ensureAdminAuditLogTable(env);
    await env.DB.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json) VALUES (?, ?, 'wellbeing', ?)`)
      .bind(adminId, action, JSON.stringify({ expert_uid: uid })).run();
  } catch (e) { console.warn('[wellbeing] audit write failed', action, (e as Error).message); }
}
