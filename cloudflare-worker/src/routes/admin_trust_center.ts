/**
 * D1075 (#2967, part 3 of #2425) — HQ › Security › Trust center content: the
 * Super Admin's writes to the public trust center's store (migration 584).
 * Part 7 (#2971) draws the editor (TRU14) on these.
 *
 * Mounted at /api/admin/security/trust-center.
 *   GET    /                        every block (draft and published), every
 *                                   subprocessor, the reports on file, the
 *                                   change log, subscriber counts
 *                                   (requireSuperAdmin)
 *   PUT    /blocks/:key             { body, checked_at } saves the block's draft
 *   DELETE /blocks/:key/draft       discards it
 *   POST   /subprocessors           { name, purpose, data, location, starts_at? } a draft
 *   PATCH  /subprocessors/:uid      edits a draft
 *   DELETE /subprocessors/:uid      deletes a draft; marks a listed one for removal
 *   POST   /subprocessors/:uid/keep cancels a removal not yet published
 *   POST   /reports                 an auditor's report: the PDF as the body
 *   GET    /reports/:uid            reads one back (requireSuperAdmin)
 *   POST   /publish                 { note } every draft live, one change note
 *
 * EVERY WRITE IS BEHIND THE WRITE BAR (`requireSuperAdminWriteBar`: a TOTP
 * session, a recent step-up, the Super Admin elevation) and is in the admin
 * audit log (`logAdminAction`). The log holds keys, uids and counts, never
 * the page's words: a draft is not public yet.
 *
 * NOTHING HERE IS PUBLIC UNTIL PUBLISH. Visitors read only the published copy
 * (`routes/trust_public.ts`). Publish without a note of 10 to 1000
 * characters is refused, as is a certification without its report on file.
 * After Publish, a new subprocessor's notice goes to confirmed subscribers
 * (`services/subprocessorNotices.ts`): now, in the background, and again
 * from the cron if anything was left.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import {
  BLOCK_KEYS, BLOCK_LABELS, CONTENT_REFUSALS, type ContentRefusal, allSubprocessors, blocksIn, changes, isBlockKey,
  newUid, parseBody, parseCheckedAt, parseNote, parseSubprocessor, publish, reportOnFile,
  pendingReviewToken, PUBLISH_KEY_RE,
} from '../services/trustContent';
import { ensureAdminAuditLogTable } from './admin';
import { sendSubprocessorNotices, subscriberCounts } from '../services/subprocessorNotices';

const r = new Hono<{ Bindings: Env }>();

/** The largest auditor's report accepted. */
export const REPORT_MAX_BYTES = 20 * 1024 * 1024;

const refuse = (c: Context<{ Bindings: Env }>, code: ContentRefusal, status = 400) =>
  c.json({ error: code, code, message: CONTENT_REFUSALS[code] }, status as any);

const audit = (env: Env, admin: { id: number; email: string }, action: string, details: Record<string, unknown>) =>
  logAdminAction(env, admin.id, admin.email, action, details);

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    // D4675 — the review token is read FIRST: a save landing during the reads
    // below then makes the token stale, which refuses a Publish of drafts the
    // page did not show, instead of letting one through.
    const pendingToken = await pendingReviewToken(c.env);
    const [published, drafts, subprocessors, reports, log, subscribers] = await Promise.all([
      blocksIn(c.env, 'published'),
      blocksIn(c.env, 'draft'),
      allSubprocessors(c.env),
      c.env.DB.prepare('SELECT uid, size_bytes, uploaded_at FROM trust_certification_reports ORDER BY uploaded_at DESC, id DESC').all(),
      changes(c.env, 50),
      subscriberCounts(c.env),
    ]);
    return c.json({
      blocks: BLOCK_KEYS.map((k) => ({ key: k, label: BLOCK_LABELS[k], published: published[k], draft: drafts[k] })),
      subprocessors: subprocessors.map((s) => ({
        uid: s.uid, name: s.name, purpose: s.purpose, data: s.data_seen, location: s.location, state: s.state,
        starts_at: s.starts_at, published_at: s.published_at, removed_at: s.removed_at,
      })),
      reports: reports.results || [],
      changes: log,
      subscribers,
      pending_token: pendingToken,
    });
  } catch (e) { return mapError(c, e); }
});

r.put('/blocks/:key', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const key = c.req.param('key');
    if (!isBlockKey(key)) return refuse(c, 'bad_block', 404);
    let raw: Record<string, unknown> = {};
    try { raw = await c.req.json<Record<string, unknown>>(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const checked = parseCheckedAt(raw.checked_at);
    if (!checked.ok) return refuse(c, checked.code);
    const body = await parseBody(key, raw.body, (uid) => reportOnFile(c.env, uid));
    if (!body.ok) return refuse(c, body.code);
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO trust_content_blocks (key, state, body_json, checked_at, updated_at, updated_by)
       VALUES (?, 'draft', ?, ?, datetime('now'), ?)`,
    ).bind(key, JSON.stringify(body.value), checked.value, admin.id).run();
    await audit(c.env, admin, 'trust_center.draft_saved', { block: key });
    const drafts = await blocksIn(c.env, 'draft');
    return c.json({ ok: true, draft: drafts[key] });
  } catch (e) { return mapError(c, e); }
});

r.delete('/blocks/:key/draft', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const key = c.req.param('key');
    if (!isBlockKey(key)) return refuse(c, 'bad_block', 404);
    const done = await c.env.DB.prepare(`DELETE FROM trust_content_blocks WHERE key = ? AND state = 'draft'`).bind(key).run();
    const n = Number((done as any)?.meta?.changes ?? 0);
    if (n) await audit(c.env, admin, 'trust_center.draft_discarded', { block: key });
    return c.json({ ok: true, discarded: n === 1 });
  } catch (e) { return mapError(c, e); }
});

r.post('/subprocessors', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const raw = await c.req.json().catch(() => null);
    const f = parseSubprocessor(raw, false);
    if (!f.ok) return refuse(c, f.code);
    const uid = newUid('tsp');
    await c.env.DB.prepare(
      `INSERT INTO trust_subprocessors (uid, name, purpose, data_seen, location, state, starts_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(uid, f.value.name, f.value.purpose, f.value.data_seen, f.value.location, f.value.starts_at ?? null, admin.id).run();
    await audit(c.env, admin, 'trust_center.subprocessor_drafted', { subprocessor: uid });
    return c.json({ ok: true, uid, state: 'draft' }, 201);
  } catch (e) { return mapError(c, e); }
});

async function subprocessorState(env: Env, uid: string) {
  return env.DB.prepare('SELECT state FROM trust_subprocessors WHERE uid = ?').bind(uid).first<{ state: string }>();
}

r.patch('/subprocessors/:uid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const uid = c.req.param('uid');
    const row = await subprocessorState(c.env, uid);
    if (!row) return refuse(c, 'not_found', 404);
    if (row.state !== 'draft') return refuse(c, 'not_draft', 409);
    const f = parseSubprocessor(await c.req.json().catch(() => null), true);
    if (!f.ok) return refuse(c, f.code);
    const v = f.value;
    await c.env.DB.prepare(
      `UPDATE trust_subprocessors
          SET name = COALESCE(?, name), purpose = COALESCE(?, purpose), data_seen = COALESCE(?, data_seen),
              location = COALESCE(?, location),
              starts_at = CASE WHEN ? THEN ? ELSE starts_at END,
              updated_at = datetime('now')
        WHERE uid = ? AND state = 'draft'`,
    ).bind(v.name ?? null, v.purpose ?? null, v.data_seen ?? null, v.location ?? null,
      v.starts_at !== undefined ? 1 : 0, v.starts_at ?? null, uid).run();
    await audit(c.env, admin, 'trust_center.subprocessor_edited', { subprocessor: uid });
    return c.json({ ok: true, uid });
  } catch (e) { return mapError(c, e); }
});

r.delete('/subprocessors/:uid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const uid = c.req.param('uid');
    const row = await subprocessorState(c.env, uid);
    if (!row) return refuse(c, 'not_found', 404);
    if (row.state === 'draft') {
      await c.env.DB.prepare(`DELETE FROM trust_subprocessors WHERE uid = ? AND state = 'draft'`).bind(uid).run();
      await audit(c.env, admin, 'trust_center.subprocessor_draft_deleted', { subprocessor: uid });
      return c.json({ ok: true, uid, state: 'deleted' });
    }
    if (row.state !== 'published') return refuse(c, 'cannot_remove', 409);
    await c.env.DB.prepare(
      `UPDATE trust_subprocessors SET state = 'removing', updated_at = datetime('now') WHERE uid = ? AND state = 'published'`,
    ).bind(uid).run();
    await audit(c.env, admin, 'trust_center.subprocessor_removal_drafted', { subprocessor: uid });
    return c.json({ ok: true, uid, state: 'removing' });
  } catch (e) { return mapError(c, e); }
});

r.post('/subprocessors/:uid/keep', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const uid = c.req.param('uid');
    const row = await subprocessorState(c.env, uid);
    if (!row) return refuse(c, 'not_found', 404);
    if (row.state !== 'removing') return refuse(c, 'not_removing', 409);
    await c.env.DB.prepare(
      `UPDATE trust_subprocessors SET state = 'published', updated_at = datetime('now') WHERE uid = ? AND state = 'removing'`,
    ).bind(uid).run();
    await audit(c.env, admin, 'trust_center.subprocessor_removal_cancelled', { subprocessor: uid });
    return c.json({ ok: true, uid, state: 'published' });
  } catch (e) { return mapError(c, e); }
});

r.post('/reports', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    if (!c.env.FILES) return c.json({ error: 'storage_unavailable', message: 'File storage is not available here.' }, 503);
    const declared = Number(c.req.header('Content-Length') || 0);
    if (declared > REPORT_MAX_BYTES) return c.json({ error: 'report_too_large', message: 'An auditor\'s report is at most 20 MB.' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length || bytes.length > REPORT_MAX_BYTES) return c.json({ error: 'report_too_large', message: 'An auditor\'s report is at most 20 MB.' }, 413);
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      return c.json({ error: 'report_not_pdf', message: 'Attach the auditor\'s report as a PDF.' }, 415);
    }
    const uid = newUid('tcr');
    const key = `trust-center/reports/${uid}.pdf`;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
    await c.env.DB.prepare(
      `INSERT INTO trust_certification_reports (uid, r2_key, sha256, size_bytes, content_type, uploaded_by) VALUES (?, ?, ?, ?, 'application/pdf', ?)`,
    ).bind(uid, key, sha, bytes.length, admin.id).run();
    await audit(c.env, admin, 'trust_center.report_attached', { report: uid, size_bytes: bytes.length });
    return c.json({ ok: true, uid, size_bytes: bytes.length, sha256: sha }, 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/reports/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const row = await c.env.DB.prepare('SELECT r2_key FROM trust_certification_reports WHERE uid = ?')
      .bind(c.req.param('uid')).first<{ r2_key: string }>();
    if (!row) return c.json({ error: 'not_found', message: 'There is no such report.' }, 404);
    const obj = c.env.FILES ? await c.env.FILES.get(row.r2_key) : null;
    if (!obj) return c.json({ error: 'report_unreadable', message: 'The report could not be read just now. Try again.' }, 503);
    return new Response(obj.body, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' } });
  } catch (e) { return mapError(c, e); }
});

/**
 * D4675 — PUBLISH WHAT WAS REVIEWED, ONCE. The body carries the review token
 * the editor read (`pending_token`) and a key the dialog made for this
 * Publish. Drafts that changed since are refused whole; a retry of the same
 * key answers with the change it already recorded; the audit rows are in the
 * publish batch. The notice emails to subscribers are queued after the
 * commit, and the response says queued, never sent.
 */
r.post('/publish', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const raw = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const note = parseNote(raw?.note);
    if (!note.ok) return refuse(c, note.code);
    const token = typeof raw?.pending_token === 'string' ? raw.pending_token : '';
    const key = typeof raw?.publish_key === 'string' ? raw.publish_key : '';
    if (!/^[0-9a-f]{64}$/.test(token) || !PUBLISH_KEY_RE.test(key)) return refuse(c, 'review_required');
    // A certification whose report left the store since it was saved is refused here too.
    const drafts = await blocksIn(c.env, 'draft');
    const certs = drafts.certifications;
    if (certs) {
      const again = await parseBody('certifications', certs.body, (uid) => reportOnFile(c.env, uid));
      if (!again.ok) return refuse(c, again.code);
    }
    await ensureAdminAuditLogTable(c.env);
    let out;
    try {
      out = await publish(c.env, admin.id, note.value, Date.now(), { token, key, actorEmail: admin.email });
    } catch (e) {
      console.warn('[trust-center] publish batch failed', (e as Error).message);
      return c.json({
        error: 'not_confirmed', code: 'not_confirmed',
        message: 'The Publish could not be confirmed. As far as this server can tell nothing was published; '
          + 'trying again publishes it at most once.',
      }, 503);
    }
    if (!out.ok) return refuse(c, out.code, 409);
    let notices: 'none' | 'queued' = 'none';
    // On a replay too: the sweep claims each delivery once, so running it
    // again finishes one an interrupted first attempt left undone.
    if (out.value.added.length) {
      const sweep = sendSubprocessorNotices(c.env).catch(() => { console.warn('[trust-center] notice sweep failed'); });
      try { c.executionCtx.waitUntil(sweep); } catch { await sweep; }
      notices = 'queued';
    }
    return c.json({ ok: true, ...out.value, notices });
  } catch (e) { return mapError(c, e); }
});

export default r;
