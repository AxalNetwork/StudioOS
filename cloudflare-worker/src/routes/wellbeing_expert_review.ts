/** D1043 (#2891), mounted by wellbeing.ts under /api/wellbeing. */
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../types';
import { requireAdmin, requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { SAMPLE_EXPERT_UID_PREFIX } from '../services/wellbeing/seedExperts';
import {
  CREDENTIAL_FILE_MAX, CREDENTIAL_TYPES, ExpertReviewError, auditExpert, credentialFiles, credentialFilesFor, expertDecision,
  ownExpert, reviewDto, reviewTarget, saveCredentials,
} from '../services/wellbeing/expertReview';

const reviews = new Hono<{ Bindings: Env }>();
export async function expertReviewResult(c: Context<{ Bindings: Env }>, fn: () => Promise<Response>) {
  try { return await fn(); } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof Error && AUTH_ERROR_STATUSES[e.message]) throw e;
    if (e instanceof ExpertReviewError) return refuse(c, e.status as ContentfulStatusCode, { code: e.code, message: e.sentence });
    console.error('[expert-review] database or storage operation failed');
    return refuse(c, 503, { code: 'expert_review_unreadable', message: 'The expert record could not be read or saved. Read it again before retrying.' });
  }
}
const result = expertReviewResult;

reviews.get('/admin/experts', async (c) => {
  const actor = await requireAdmin(c);
  return result(c, async () => {
    const limit = Number(c.req.query('limit') ?? 25); const offset = Number(c.req.query('offset') ?? 0);
    const state = c.req.query('state') ?? 'all';
    if (!['all', 'pending', 'verified', 'declined'].includes(state) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) {
      return refuse(c, 400, { code: 'invalid_page', message: 'Choose a review state, a limit from 1 to 200, and a nonnegative offset.' });
    }
    const elevated = isSuperAdmin(actor) ? 1 : 0;
    const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM experts e LEFT JOIN users u ON u.id = e.user_id
      WHERE substr(e.uid, 1, ?) <> ? AND (? = 'all' OR e.decision_state = ?) AND (? = 1 OR COALESCE(u.role, '') <> 'admin' OR u.id = ?)`)
      .bind(SAMPLE_EXPERT_UID_PREFIX.length, SAMPLE_EXPERT_UID_PREFIX, state, state, elevated, actor.id).first<{ n: number }>();
    const rows = await c.env.DB.prepare(`SELECT e.* FROM experts e LEFT JOIN users u ON u.id = e.user_id
      WHERE substr(e.uid, 1, ?) <> ? AND (? = 'all' OR e.decision_state = ?) AND (? = 1 OR COALESCE(u.role, '') <> 'admin' OR u.id = ?)
      ORDER BY datetime(e.created_at), e.id LIMIT ? OFFSET ?`)
      .bind(SAMPLE_EXPERT_UID_PREFIX.length, SAMPLE_EXPERT_UID_PREFIX, state, state, elevated, actor.id, limit, offset).all<any>();
    if (!count || !Number.isSafeInteger(count.n) || ('success' in rows && !rows.success) || !Array.isArray(rows.results)) throw new Error('Review rows were not returned');
    const files = await credentialFilesFor(c.env, rows.results.map((r) => Number(r.id)));
    return c.json({ items: await Promise.all(rows.results.map((r) => reviewDto(c.env, r, files.get(Number(r.id)) ?? []))), total: Number(count.n), limit, offset });
  });
});

reviews.get('/admin/experts/:uid/review', async (c) => {
  const actor = await requireAdmin(c);
  return result(c, async () => {
    const row = await reviewTarget(c.env, c.req.param('uid'), actor);
    const history = await c.env.DB.prepare(`SELECT decision, decided_by, decided_at, reason, credentials_checked, review_version
      FROM expert_review_decisions WHERE expert_id = ? ORDER BY review_version DESC`).bind(row.id).all();
    if (('success' in history && !history.success) || !Array.isArray(history.results)) throw new Error('Decision history was not returned');
    return c.json({ expert: await reviewDto(c.env, row), history: history.results });
  });
});

reviews.post('/admin/experts/:uid/decline', async (c) => {
  const actor = await requireAdmin(c);
  return result(c, async () => {
    const row = await reviewTarget(c.env, c.req.param('uid'), actor);
    const saved = await expertDecision(c.env, row, actor, 'declined', await c.req.json().catch(() => ({})));
    await auditExpert(c.env, actor.id, 'expert_declined', row.uid);
    return c.json(saved);
  });
});

reviews.get('/experts/me/credentials', async (c) => {
  const user = await requireAuth(c);
  return result(c, async () => c.json(await reviewDto(c.env, await ownExpert(c.env, user.id))));
});

reviews.patch('/experts/me/credentials', async (c) => {
  const user = await requireAuth(c);
  return result(c, async () => {
    const row = await ownExpert(c.env, user.id);
    await saveCredentials(c.env, row, await c.req.json().catch(() => null));
    return c.json(await reviewDto(c.env, await ownExpert(c.env, user.id)));
  });
});

reviews.put('/experts/me/credentials/files', async (c) => {
  const user = await requireAuth(c);
  return result(c, async () => {
    const row = await ownExpert(c.env, user.id);
    if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Credential file storage is unavailable.' });
    const type = (c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!Object.hasOwn(CREDENTIAL_TYPES, type)) return refuse(c, 415, { code: 'unsupported_type', message: 'Upload a PDF, PNG or JPEG credential file.' });
    const declared = Number(c.req.header('content-length'));
    if (!Number.isSafeInteger(declared) || declared <= 0) return refuse(c, 411, { code: 'length_required', message: 'The upload must declare its byte length.' });
    if (declared > CREDENTIAL_FILE_MAX) return refuse(c, 413, { code: 'file_too_large', message: 'A credential file is at most 10 MB.' });
    const files = await credentialFiles(c.env, row.id);
    if (files.length >= 10) return refuse(c, 409, { code: 'file_limit', message: 'Remove an old credential file before uploading more than ten.' });
    const reader = c.req.raw.body?.getReader();
    if (!reader) return refuse(c, 400, { code: 'empty_file', message: 'The upload has no file bytes.' });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > declared || size > CREDENTIAL_FILE_MAX) { await reader.cancel(); return refuse(c, 413, { code: 'file_too_large', message: 'The upload exceeds its declared size or 10 MB.' }); }
      chunks.push(next.value);
    }
    if (size !== declared) return refuse(c, 400, { code: 'length_mismatch', message: 'The upload did not match its declared size.' });
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    const valid = type === 'application/pdf' ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
      : type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid) return refuse(c, 415, { code: 'file_type_mismatch', message: 'The file bytes do not match the declared type.' });
    const uid = crypto.randomUUID(); const key = `wellbeing/credentials/${row.id}/${uid}.${CREDENTIAL_TYPES[type]}`;
    const name = (c.req.header('x-file-name') || `Credential.${CREDENTIAL_TYPES[type]}`).replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200);
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
      const saved = await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO expert_credential_files(uid, expert_id, file_key, file_name, file_type, file_size, uploaded_by)
          SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM expert_credential_files WHERE expert_id = ?) < 10`)
          .bind(uid, row.id, key, name, type, size, user.id, row.id),
        c.env.DB.prepare(`UPDATE experts SET verified = 0, decision_state = 'pending', decided_by = NULL, decided_at = NULL,
          decline_reason = NULL, decision_token = NULL, review_version = review_version + 1 WHERE id = ?
          AND EXISTS (SELECT 1 FROM expert_credential_files WHERE uid = ?)`).bind(row.id, uid),
      ]);
      if (Number(saved[0].meta?.changes) !== 1) { await c.env.FILES.delete(key); return refuse(c, 409, { code: 'file_limit', message: 'Ten credential files are already recorded. Remove an old one first.' }); }
    } catch (e) { try { await c.env.FILES.delete(key); } catch { /* inaccessible orphan; no DB reference */ } throw e; }
    return c.json({ files: await credentialFiles(c.env, row.id) }, 201);
  });
});

reviews.get('/experts/credentials/files/:fileUid', async (c) => {
  const user = await requireAuth(c);
  return result(c, async () => {
    const file = await c.env.DB.prepare(`SELECT f.*, e.uid AS expert_uid, e.user_id FROM expert_credential_files f JOIN experts e ON e.id = f.expert_id WHERE f.uid = ?`)
      .bind(c.req.param('fileUid')).first<any>();
    if (!file || (file.user_id !== user.id && user.role !== 'admin')) return refuse(c, 404, { code: 'file_not_found', message: 'Credential file not found.' });
    if (file.user_id !== user.id) { const actor = await requireAdmin(c); await reviewTarget(c.env, file.expert_uid, actor); }
    const object = await c.env.FILES?.get(file.file_key);
    if (!object) return refuse(c, 503, { code: 'file_unreadable', message: 'This credential file cannot be read.' });
    return new Response(object.body, { headers: { 'Content-Type': file.file_type, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  });
});

reviews.delete('/experts/me/credentials/files/:fileUid', async (c) => {
  const user = await requireAuth(c);
  return result(c, async () => {
    const row = await ownExpert(c.env, user.id);
    if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Credential file storage is unavailable, so the file was not removed.' });
    const file = await c.env.DB.prepare('SELECT file_key FROM expert_credential_files WHERE uid = ? AND expert_id = ?')
      .bind(c.req.param('fileUid'), row.id).first<{ file_key: string }>();
    if (!file) return refuse(c, 404, { code: 'file_not_found', message: 'Credential file not found.' });
    // Keep the key available for retries if storage fails. R2 deletion is
    // idempotent, so a later D1 failure can also be retried with this row.
    await c.env.FILES.delete(file.file_key);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM expert_credential_files WHERE uid = ? AND expert_id = ?').bind(c.req.param('fileUid'), row.id),
      c.env.DB.prepare(`UPDATE experts SET verified = 0, decision_state = 'pending', decided_by = NULL, decided_at = NULL,
        decline_reason = NULL, decision_token = NULL, review_version = review_version + 1 WHERE id = ?`).bind(row.id),
    ]);
    return c.json({ deleted: true });
  });
});

export default reviews;
