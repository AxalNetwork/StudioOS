/**
 * D4294 (#4294, D4289 P5) — influencer payout readiness.
 *
 *   GET  /api/influencer/me/payout-readiness        IN4's checklist (services/influencer/payoutReadiness.ts)
 *   GET  /api/influencer/me/tax-form                the form's status: missing | submitted | accepted | rejected
 *   POST /api/influencer/me/tax-form                { form_type: 'w9' | 'w8ben', file: data URI (PDF, JPEG or PNG, ≤ 5 MB) }
 *   POST /api/influencer/me/terms/accept            { version } — the current Influencer terms
 *   POST /api/admin/influencers/:uid/tax-form/decision   { decision: 'accept' | 'reject', reason }
 *   GET  /api/admin/influencers/:uid/tax-form/file       the file itself
 *
 * WHO. The member's routes are the influencer's own (an admitted influencer:
 * `isInfluencer`); anyone else gets 404 `not_an_influencer`. The tax form is
 * reviewed, and its file read, by the Super Admin only: an admin gets 403
 * `super_admin_only`. Each decision and each read of the file goes through
 * `logAdminAction`.
 *
 * THE FILE STAYS PRIVATE. It is stored in the private FILES bucket under
 * `taxforms/`; no reply carries its key or a URL to it; the one route that
 * streams it is the Super Admin's, with `no-store` and as an attachment.
 *
 * The payout gate itself is in `routes/network.ts` (`POST /payout/request`).
 * Nothing logs a file, a reason or a figure. All SQL is bound.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { logAdminAction } from '../services/adminAudit';
import { getTaxForm, putTaxFormFromDataUri } from '../services/r2';
import {
  INFLUENCER_TERMS_VERSION, TAX_FORM_TYPES, type TaxFormType, isInfluencer, latestTaxForm, payoutReadiness,
} from '../services/influencer/payoutReadiness';

const me = new Hono<{ Bindings: Env }>();
const admin = new Hono<{ Bindings: Env }>();

const UPLOAD_REFUSAL: Record<string, { status: 400 | 413 | 503; message: string }> = {
  not_a_file: { status: 400, message: 'Attach the form as a file.' },
  unsupported_type: { status: 400, message: 'A tax form is a PDF, JPEG or PNG.' },
  too_large: { status: 413, message: 'A tax form can be up to 5 MB.' },
  storage_unavailable: { status: 503, message: 'The form could not be stored just now. Nothing was saved; try again.' },
};

async function influencerOnly(c: any) {
  const user = await requireAuth(c);
  if (!(await isInfluencer(c.env, user.id))) {
    return { user, refusal: refuse(c, 404, { code: 'not_an_influencer', message: 'This is for admitted Axal influencers.' }) };
  }
  return { user, refusal: null };
}

me.get('/me/payout-readiness', async (c) => {
  const { user, refusal } = await influencerOnly(c);
  if (refusal) return refusal;
  return c.json(await payoutReadiness(c.env, user.id));
});

me.get('/me/tax-form', async (c) => {
  const { user, refusal } = await influencerOnly(c);
  if (refusal) return refusal;
  const form = await latestTaxForm(c.env, user.id);
  if (!form) return c.json({ status: 'missing' });
  return c.json({
    status: form.status, form_type: form.form_type, submitted_at: form.submitted_at, decided_at: form.decided_at,
    reason: form.status === 'rejected' ? form.decision_reason : null,
  });
});

me.post('/me/tax-form', async (c) => {
  const { user, refusal } = await influencerOnly(c);
  if (refusal) return refusal;
  const body = await c.req.json().catch(() => ({})) as { form_type?: unknown; file?: unknown };
  if (!TAX_FORM_TYPES.includes(body.form_type as TaxFormType)) {
    return refuse(c, 400, { code: 'invalid_form_type', message: 'Choose the W-9 (US persons) or the W-8BEN (everyone else).' });
  }
  const current = await latestTaxForm(c.env, user.id);
  if (current?.status === 'accepted') {
    return refuse(c, 409, { code: 'tax_form_already_accepted', message: 'Your tax form is already accepted. Ask HQ if your details have changed.' });
  }
  if (typeof body.file !== 'string') return refuse(c, 400, { code: 'not_a_file', message: UPLOAD_REFUSAL.not_a_file.message });
  let stored;
  try {
    stored = await putTaxFormFromDataUri(c.env, user.id, body.file);
  } catch (e) {
    const code = (e as Error).message in UPLOAD_REFUSAL ? (e as Error).message : 'storage_unavailable';
    return refuse(c, UPLOAD_REFUSAL[code].status, { code, message: UPLOAD_REFUSAL[code].message });
  }
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO influencer_tax_forms (uid, user_id, form_type, status, r2_key, content_type, size_bytes, sha256)
     VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?)`,
  ).bind(uid, user.id, body.form_type, stored.file_key, stored.content_type, stored.size, stored.sha256).run();
  return c.json({ status: 'submitted', form_type: body.form_type }, 201);
});

me.post('/me/terms/accept', async (c) => {
  const { user, refusal } = await influencerOnly(c);
  if (refusal) return refusal;
  const body = await c.req.json().catch(() => ({})) as { version?: unknown };
  if (body.version !== INFLUENCER_TERMS_VERSION) {
    return refuse(c, 409, {
      code: 'terms_version_not_current', message: 'These are not the current Influencer terms. Read the current version and accept it.',
      extra: { version: INFLUENCER_TERMS_VERSION },
    });
  }
  await c.env.DB.prepare(
    `INSERT INTO influencer_terms_acceptances (user_id, version) VALUES (?, ?) ON CONFLICT (user_id, version) DO NOTHING`,
  ).bind(user.id, INFLUENCER_TERMS_VERSION).run();
  return c.json({ version: INFLUENCER_TERMS_VERSION, accepted: true });
});

/** The Super Admin, or a named refusal for any other admin. */
async function superAdminOnly(c: any) {
  const user = await requireAdmin(c);
  if (!isSuperAdmin(user as any)) {
    return { user, refusal: refuse(c, 403, { code: 'super_admin_only', message: 'Only the Super Admin reviews and reads tax forms.' }) };
  }
  return { user, refusal: null };
}

async function influencerByUid(env: Env, uid: string) {
  return env.DB.prepare(`SELECT id FROM users WHERE uid = ?`).bind(uid).first<{ id: number }>();
}

admin.post('/:uid/tax-form/decision', async (c) => {
  const { user, refusal } = await superAdminOnly(c);
  if (refusal) return refusal;
  const target = await influencerByUid(c.env, c.req.param('uid'));
  if (!target || !(await isInfluencer(c.env, target.id))) return refuse(c, 404, { code: 'not_an_influencer', message: 'No influencer has that id.' });
  const body = await c.req.json().catch(() => ({})) as { decision?: unknown; reason?: unknown };
  const decision = body.decision === 'accept' ? 'accepted' : body.decision === 'reject' ? 'rejected' : null;
  if (!decision) return refuse(c, 400, { code: 'invalid_decision', message: 'Accept or reject the form.' });
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (decision === 'rejected' && !reason) {
    return refuse(c, 400, { code: 'reason_required', message: 'Say why the form cannot be accepted. The influencer reads it.' });
  }
  const res = await c.env.DB.prepare(
    `UPDATE influencer_tax_forms SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_reason = ?
      WHERE id = (SELECT id FROM influencer_tax_forms WHERE user_id = ? ORDER BY id DESC LIMIT 1) AND status = 'submitted'`,
  ).bind(decision, user.id, reason || null, target.id).run();
  if (!res.meta?.changes) {
    return refuse(c, 409, { code: 'no_form_to_review', message: 'There is no submitted tax form waiting for a decision.' });
  }
  await logAdminAction(c.env, user.id, user.email, 'influencer_tax_form_decided', { target_user_id: target.id, decision });
  return c.json({ status: decision });
});

admin.get('/:uid/tax-form/file', async (c) => {
  const { user, refusal } = await superAdminOnly(c);
  if (refusal) return refusal;
  const target = await influencerByUid(c.env, c.req.param('uid'));
  const row = target ? await c.env.DB.prepare(
    `SELECT r2_key, content_type, form_type FROM influencer_tax_forms WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(target.id).first<{ r2_key: string; content_type: string; form_type: TaxFormType }>() : null;
  const obj = row ? await getTaxForm(c.env, row.r2_key) : null;
  if (!target || !row || !obj) return refuse(c, 404, { code: 'no_tax_form', message: 'This influencer has no tax form on file.' });
  await logAdminAction(c.env, user.id, user.email, 'influencer_tax_form_viewed', { target_user_id: target.id });
  const ext = row.r2_key.slice(row.r2_key.lastIndexOf('.') + 1);
  return new Response(obj.body, {
    headers: {
      'content-type': row.content_type,
      'content-disposition': `attachment; filename="${row.form_type}.${ext}"`,
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    },
  });
});

export const mount: RouteMount[] = [
  { path: '/api/influencer', router: me },
  { path: '/api/admin/influencers', router: admin },
];

export default me;
