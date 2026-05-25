/**
 * Task #3 — Admin Telegram channels + posts + aggregator endpoints.
 *
 * Mounted at /api/admin/telegram. ALL endpoints admin-gated via
 * requireAdmin and (in prod) sit behind the /api/admin/* Cf-Access
 * perimeter applied in index.ts. The full surface is documented in the
 * task spec at `.local/tasks/task-3.md`.
 *
 * Endpoint summary:
 *   Channels
 *     GET    /channels                       — list
 *     POST   /channels                       — create (slug+label+audience required)
 *     PUT    /channels/:id                   — patch (chat_id / enabled / label …)
 *     DELETE /channels/:id                   — remove (only when no sent posts attached)
 *     POST   /channels/:id/test              — getChat + send "hello" probe
 *   Posts
 *     GET    /posts?status=&channel_id=&limit=&offset=
 *     POST   /posts                          — create draft (manual)
 *     PUT    /posts/:id                      — edit draft (forbidden once sent)
 *     DELETE /posts/:id                      — delete draft (forbidden once sent)
 *     POST   /posts/:id/media                — upload R2-backed media (data URI)
 *     POST   /posts/:id/lint                 — preview PII linter findings
 *     POST   /posts/:id/send                 — send (linter blocks unless override_reason)
 *     POST   /posts/:id/schedule             — set scheduled_for (ISO ts) + status='scheduled'
 *   Aggregator
 *     GET    /aggregator/preview?period_days=
 *     POST   /aggregator/run                 — { period_days? }
 *   Consent (settings surface uses this from the user UI; admin override here)
 *     GET    /consent/:user_id
 *     PUT    /consent/:user_id               — { consented: bool, source }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { clampLimit, parseOffset } from '../util/pagination';
import { ensureTelegramSchema, TELEGRAM_AUDIENCES, type TelegramAudience } from '../services/telegramSchema';
import {
  TelegramError,
  TelegramTokenMissing,
  buildTelegramLink,
  escapeMd2,
  getChat,
  sendDocument,
  sendMessage,
  sendPhoto,
} from '../services/telegramClient';
import { lintForSend } from '../services/telegramRedactCheck';
import { previewAll, previewAudience, runAggregator } from '../services/telegramAggregator';

const r = new Hono<{ Bindings: Env }>();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

const PHOTO_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const DOC_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
};
const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // Telegram caps photos ~10MB

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function loadPost(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT p.*, c.slug AS channel_slug, c.label AS channel_label, c.chat_id,
            c.audience AS channel_audience, c.signature AS channel_signature
       FROM telegram_posts p
       JOIN telegram_channels c ON c.id = p.channel_id
      WHERE p.id = ?`,
  )
    .bind(id)
    .first<any>();
}

/**
 * Append a human author signature to a MarkdownV2 body just before send.
 * Stored body_md stays clean so the signature stays editable per-channel
 * without rewriting historical drafts. Idempotent: if the exact sig line
 * is already present at the tail, returns body unchanged so manual signs
 * don't double up.
 */
function appendSignature(body: string, sig: string | null | undefined): string {
  const s = (sig || '').trim();
  if (!s) return body;
  const sigLine = `— ${escapeMd2(s)}`;
  // Canonicalize trailing whitespace before the duplicate check so manually-
  // signed drafts (extra blank lines, trailing spaces) don't slip through and
  // produce a double signature. Also catches the unescaped tail-form
  // `— Name` that a human might have typed directly.
  const trimmed = body.replace(/[\s\n]+$/g, '');
  const tailUnescaped = `— ${s}`;
  if (trimmed.endsWith(sigLine) || trimmed.endsWith(tailUnescaped)) {
    return `${trimmed}`;
  }
  return `${trimmed}\n\n${sigLine}`;
}

// admin_audit_log writer. Tolerates the optional `actor` column the same
// way admin_publications.ts does (see writeAudit there for prior art).
let _auditHasActor: boolean | null = null;
async function auditHasActor(env: Env): Promise<boolean> {
  if (_auditHasActor !== null) return _auditHasActor;
  try {
    const r = await env.DB.prepare("PRAGMA table_info('admin_audit_log')").all<{ name: string }>();
    _auditHasActor = (r.results || []).some((c) => String(c.name) === 'actor');
  } catch {
    _auditHasActor = false;
  }
  return _auditHasActor;
}

async function writeAudit(
  env: Env,
  opts: {
    adminId: number;
    adminEmail: string;
    action: string;
    postId?: number;
    channelId?: number;
    bodyHash?: string;
    extra?: Record<string, unknown>;
  },
) {
  try {
    const filters = JSON.stringify({
      post_id: opts.postId,
      channel_id: opts.channelId,
      body_hash: opts.bodyHash,
      ...(opts.extra || {}),
    });
    const reportType = 'telegram';
    if (await auditHasActor(env)) {
      const actor = await hashEmail(opts.adminEmail);
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, actor)
           VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(opts.adminId, opts.action, reportType, filters, actor)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json)
           VALUES (?, ?, ?, ?)`,
      )
        .bind(opts.adminId, opts.action, reportType, filters)
        .run();
    }
  } catch (e) {
    console.warn('[admin_telegram] audit write failed:', (e as Error).message);
  }
}

function telegramErrorPayload(e: unknown): { body: Record<string, unknown>; status: 400 | 502 | 503 | 429 } {
  if (e instanceof TelegramTokenMissing) {
    return { body: { error: 'telegram_token_missing', code: 'telegram_token_missing', message: e.message }, status: 503 };
  }
  if (e instanceof TelegramError) {
    const status: 400 | 502 | 503 | 429 =
      e.code === 'telegram_rate_limited' ? 429 :
      e.code === 'telegram_breaker_open' ? 503 :
      e.code === 'telegram_chat_not_found' || e.code === 'telegram_forbidden' || e.code === 'telegram_unauthorized' ? 400 :
      502;
    return {
      body: {
        error: e.code,
        code: e.code,
        message: e.message,
        ...(e.retryAfter ? { retry_after: e.retryAfter } : {}),
      },
      status,
    };
  }
  return {
    body: { error: 'telegram_unknown', code: 'telegram_unknown', message: (e as Error).message || String(e) },
    status: 502,
  };
}

// ----------------------------- CHANNELS -----------------------------

r.get('/channels', async (c) => {
  await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, slug, label, chat_id, audience, is_invite_only, enabled,
            signature, last_test_at, last_error, created_at, updated_at
       FROM telegram_channels
       ORDER BY audience ASC, id ASC`,
  ).all<any>();
  const channels = (rows.results || []).map((r) => ({
    ...r,
    is_invite_only: !!r.is_invite_only,
    enabled: !!r.enabled,
    has_chat_id: !!r.chat_id,
  }));
  return c.json({ channels, count: channels.length });
});

r.post('/channels', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid_slug' }, 400);
  const label = String(body.label || '').trim().slice(0, 200);
  if (!label) return c.json({ error: 'label_required' }, 400);
  const audience = String(body.audience || '');
  if (!TELEGRAM_AUDIENCES.includes(audience as TelegramAudience)) {
    return c.json({ error: 'invalid_audience', allowed: TELEGRAM_AUDIENCES }, 400);
  }
  const chatId = body.chat_id ? String(body.chat_id).trim() : null;
  const isInviteOnly = body.is_invite_only === false ? 0 : 1;
  const signature = typeof body.signature === 'string' ? body.signature.trim().slice(0, 100) || null : null;
  try {
    const ins = await c.env.DB.prepare(
      `INSERT INTO telegram_channels (slug, label, chat_id, audience, is_invite_only, signature)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(slug, label, chatId, audience, isInviteOnly, signature).first<{ id: number }>();
    await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_channel_created', channelId: ins?.id, extra: { slug, audience } });
    return c.json({ id: ins?.id, slug }, 201);
  } catch (err: any) {
    if (String(err?.message || '').toLowerCase().includes('unique')) {
      return c.json({ error: 'slug_taken' }, 409);
    }
    console.error('[admin_telegram] channel create failed', err);
    return c.json({ error: 'create_failed' }, 500);
  }
});

r.put('/channels/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof body.label === 'string') {
    const v = body.label.trim().slice(0, 200);
    if (!v) return c.json({ error: 'label_required' }, 400);
    sets.push('label = ?'); args.push(v);
  }
  if ('chat_id' in body) {
    const v = body.chat_id == null ? null : String(body.chat_id).trim() || null;
    sets.push('chat_id = ?'); args.push(v);
  }
  if ('is_invite_only' in body) { sets.push('is_invite_only = ?'); args.push(body.is_invite_only ? 1 : 0); }
  if ('enabled' in body) { sets.push('enabled = ?'); args.push(body.enabled ? 1 : 0); }
  if ('signature' in body) {
    const v = body.signature == null ? null : String(body.signature).trim().slice(0, 100) || null;
    sets.push('signature = ?'); args.push(v);
  }
  if (sets.length === 0) return c.json({ error: 'no_fields' }, 400);
  sets.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE telegram_channels SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...args, id)
    .run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_channel_updated', channelId: id, extra: { fields: Object.keys(body) } });
  return c.json({ ok: true });
});

r.delete('/channels/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const sent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM telegram_posts WHERE channel_id = ? AND status = 'sent'`,
  ).bind(id).first<{ n: number }>();
  if ((sent?.n ?? 0) > 0) {
    return c.json({ error: 'has_sent_posts', message: 'Channel has sent posts; disable it instead.' }, 409);
  }
  await c.env.DB.prepare(`DELETE FROM telegram_posts WHERE channel_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM telegram_channels WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_channel_deleted', channelId: id });
  return c.json({ ok: true });
});

r.post('/channels/:id/test', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  const ch: any = await c.env.DB.prepare(
    `SELECT id, slug, label, chat_id FROM telegram_channels WHERE id = ?`,
  ).bind(id).first();
  if (!ch) return c.json({ error: 'not_found' }, 404);
  if (!ch.chat_id) return c.json({ error: 'chat_id_missing', message: 'Set chat_id before testing.' }, 400);
  try {
    const chat = await getChat(c.env, ch.chat_id);
    const greeting = `*Axal bot connected*\nChannel: ${escapeMd2(ch.label)}\nTimestamp: ${escapeMd2(new Date().toISOString())}`;
    const msg = await sendMessage(c.env, ch.chat_id, greeting);
    const link = buildTelegramLink(chat, msg.message_id);
    await c.env.DB.prepare(
      `UPDATE telegram_channels SET last_test_at = datetime('now'), last_error = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).bind(id).run();
    await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_channel_tested', channelId: id, extra: { message_id: msg.message_id } });
    return c.json({ ok: true, chat: { id: chat.id, title: chat.title, username: chat.username, type: chat.type }, message_id: msg.message_id, link });
  } catch (e) {
    const { body, status } = telegramErrorPayload(e);
    try {
      await c.env.DB.prepare(
        `UPDATE telegram_channels SET last_error = ?, updated_at = datetime('now') WHERE id = ?`,
      ).bind(String((body as any).message || (body as any).code || 'error').slice(0, 500), id).run();
    } catch {}
    return c.json(body, status);
  }
});

// ----------------------------- POSTS -----------------------------

r.get('/posts', async (c) => {
  await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const status = c.req.query('status');
  const channelId = c.req.query('channel_id');
  const limit = clampLimit(c.req.query('limit'), 50, 200);
  const offset = parseOffset(c.req.query('offset'));
  const where: string[] = [];
  const args: unknown[] = [];
  if (status) { where.push('p.status = ?'); args.push(status); }
  if (channelId) { where.push('p.channel_id = ?'); args.push(Number(channelId)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.channel_id, p.audience, p.status, p.title, p.body_md,
            p.media_r2_key, p.media_kind, p.scheduled_for, p.sent_at,
            p.telegram_message_id, p.telegram_link, p.source, p.source_kind,
            p.send_error, p.override_reason, p.created_by, p.created_at, p.updated_at,
            c.slug AS channel_slug, c.label AS channel_label
       FROM telegram_posts p
       JOIN telegram_channels c ON c.id = p.channel_id
       ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
  ).bind(...args, limit, offset).all<any>();
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM telegram_posts p ${whereSql}`,
  ).bind(...args).first<{ n: number }>();
  return c.json({ posts: rows.results || [], total: total?.n ?? 0, limit, offset });
});

// Single-post fetch by id — used by ComposeTab when opening a draft from
// the Drafts list. Previously the frontend re-fetched a paginated list and
// `.find()`d by id, which silently failed if the draft was beyond the
// LIMIT 200 window (e.g. after several aggregator runs accumulated drafts).
r.get('/posts/:id', async (c) => {
  await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const row = await loadPost(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ post: row });
});

r.post('/posts', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const channelId = Number(body.channel_id);
  if (!Number.isFinite(channelId)) return c.json({ error: 'channel_id_required' }, 400);
  const ch: any = await c.env.DB.prepare(
    `SELECT id, audience, enabled FROM telegram_channels WHERE id = ?`,
  ).bind(channelId).first();
  if (!ch) return c.json({ error: 'channel_not_found' }, 404);
  if (!ch.enabled) return c.json({ error: 'channel_disabled' }, 400);
  const bodyMd = String(body.body_md || '').trim();
  if (!bodyMd) return c.json({ error: 'body_required' }, 400);
  if (bodyMd.length > 4000) return c.json({ error: 'body_too_long', max: 4000 }, 400);
  const title = body.title ? String(body.title).trim().slice(0, 200) : null;

  const ins = await c.env.DB.prepare(
    `INSERT INTO telegram_posts (channel_id, audience, status, title, body_md, source, created_by)
       VALUES (?, ?, 'draft', ?, ?, 'manual', ?) RETURNING id`,
  ).bind(channelId, ch.audience, title, bodyMd, admin.id).first<{ id: number }>();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_post_created', postId: ins?.id, channelId });
  return c.json({ id: ins?.id }, 201);
});

r.put('/posts/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_edit_in_state', state: post.status }, 409);
  const body: any = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof body.title === 'string') { sets.push('title = ?'); args.push(body.title.trim().slice(0, 200) || null); }
  if (typeof body.body_md === 'string') {
    const v = body.body_md.trim();
    if (!v) return c.json({ error: 'body_required' }, 400);
    if (v.length > 4000) return c.json({ error: 'body_too_long', max: 4000 }, 400);
    sets.push('body_md = ?'); args.push(v);
  }
  if ('scheduled_for' in body) {
    const v = body.scheduled_for ? String(body.scheduled_for) : null;
    if (v && Number.isNaN(Date.parse(v))) return c.json({ error: 'invalid_scheduled_for' }, 400);
    sets.push('scheduled_for = ?'); args.push(v);
  }
  if (sets.length === 0) return c.json({ error: 'no_fields' }, 400);
  sets.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE telegram_posts SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...args, id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_post_edited', postId: id, channelId: post.channel_id, extra: { fields: Object.keys(body) } });
  return c.json({ ok: true });
});

r.delete('/posts/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_delete_in_state', state: post.status }, 409);
  // Best-effort R2 cleanup.
  if (post.media_r2_key && c.env.FILES && post.media_r2_key.startsWith('telegram/')) {
    try { await c.env.FILES.delete(post.media_r2_key); } catch {}
  }
  await c.env.DB.prepare(`DELETE FROM telegram_posts WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_post_deleted', postId: id, channelId: post.channel_id });
  return c.json({ ok: true });
});

r.post('/posts/:id/media', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_attach_in_state', state: post.status }, 409);

  const body: any = await c.req.json().catch(() => ({}));
  const dataUri = String(body.data_uri || '');
  if (!dataUri.startsWith('data:')) return c.json({ error: 'invalid_data_uri' }, 400);
  const commaIdx = dataUri.indexOf(',');
  if (commaIdx < 0) return c.json({ error: 'invalid_data_uri' }, 400);
  const declaredMime = dataUri.slice(5, commaIdx).replace(';base64', '').trim();
  let kind: 'photo' | 'document' | null = null;
  let ext: string | null = null;
  if (PHOTO_MIME[declaredMime]) { kind = 'photo'; ext = PHOTO_MIME[declaredMime]; }
  else if (DOC_MIME[declaredMime]) { kind = 'document'; ext = DOC_MIME[declaredMime]; }
  else return c.json({ error: 'unsupported_mime', allowed: [...Object.keys(PHOTO_MIME), ...Object.keys(DOC_MIME)] }, 400);

  let bytes: Uint8Array;
  try { bytes = bytesFromBase64(dataUri.slice(commaIdx + 1)); }
  catch { return c.json({ error: 'invalid_base64' }, 400); }
  if (bytes.byteLength > MAX_MEDIA_BYTES) return c.json({ error: 'too_large', max_bytes: MAX_MEDIA_BYTES }, 413);

  const oldKey = post.media_r2_key;
  const key = `telegram/${post.channel_id}/${id}/${crypto.randomUUID()}.${ext}`;
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: declaredMime },
    customMetadata: { post_id: String(id), uploaded_by: String(admin.id) },
  });
  await c.env.DB.prepare(
    `UPDATE telegram_posts SET media_r2_key = ?, media_kind = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(key, kind, id).run();
  if (oldKey && oldKey.startsWith('telegram/') && oldKey !== key) {
    try { await c.env.FILES.delete(oldKey); } catch {}
  }
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_post_media_uploaded', postId: id, channelId: post.channel_id, extra: { kind, size: bytes.byteLength } });
  return c.json({ ok: true, media_r2_key: key, media_kind: kind, size: bytes.byteLength });
});

r.post('/posts/:id/lint', async (c) => {
  await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  const result = await lintForSend(c.env, post.body_md, post.audience);
  return c.json(result);
});

r.post('/posts/:id/schedule', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_schedule_in_state', state: post.status }, 409);
  const body: any = await c.req.json().catch(() => ({}));
  const ts = body.scheduled_for ? String(body.scheduled_for) : '';
  const at = Date.parse(ts);
  if (!Number.isFinite(at)) return c.json({ error: 'invalid_scheduled_for' }, 400);
  if (at < Date.now() - 60_000) return c.json({ error: 'scheduled_in_past' }, 400);
  await c.env.DB.prepare(
    `UPDATE telegram_posts SET status = 'scheduled', scheduled_for = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(new Date(at).toISOString(), id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_post_scheduled', postId: id, channelId: post.channel_id, extra: { scheduled_for: new Date(at).toISOString() } });
  return c.json({ ok: true, scheduled_for: new Date(at).toISOString() });
});

r.post('/posts/:id/send', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent') return c.json({ error: 'already_sent' }, 409);
  if (post.status === 'sending') return c.json({ error: 'send_in_progress' }, 409);
  if (!post.chat_id) return c.json({ error: 'channel_missing_chat_id' }, 400);

  // Compare-and-set: atomically transition draft|scheduled|failed -> sending
  // so two concurrent /send calls cannot both pass the precheck and double-
  // post the same draft (architect-flagged race).
  const claim = await c.env.DB.prepare(
    `UPDATE telegram_posts
        SET status = 'sending', updated_at = datetime('now')
      WHERE id = ? AND status IN ('draft', 'scheduled', 'failed')`,
  ).bind(id).run();
  if (!claim.meta || (claim.meta as { changes?: number }).changes !== 1) {
    return c.json({ error: 'already_sending_or_sent' }, 409);
  }

  const reqBody: any = await c.req.json().catch(() => ({}));
  const overrideReason = reqBody.override_reason ? String(reqBody.override_reason).trim() : null;

  // Helper: roll back the 'sending' claim on early-exit failure so the
  // draft remains editable. Best-effort — only revert if still 'sending'.
  const releaseClaim = async (next: 'draft' | 'failed' = 'draft', err?: string) => {
    try {
      await c.env.DB.prepare(
        `UPDATE telegram_posts
            SET status = ?, send_error = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'sending'`,
      ).bind(next, err ? err.slice(0, 500) : null, id).run();
    } catch {}
  };

  // PII linter — gate the send. Lint the WIRE body (body_md + appended
  // signature) so PII smuggled into the per-channel signature is caught at
  // send time, not only on stored body. Architect-flagged: signatures are
  // reusable per-channel and broadcast to public audiences, so they must
  // pass the same gate as body_md.
  const wireBodyForLint = appendSignature(post.body_md, post.channel_signature);
  const lint = await lintForSend(c.env, wireBodyForLint, post.audience);
  if (!lint.ok) {
    if (!overrideReason || overrideReason.length < 8) {
      await releaseClaim('draft');
      return c.json({
        error: 'pii_linter_blocked',
        code: 'pii_linter_blocked',
        message: 'PII linter blocked the send. Provide override_reason (≥8 chars) to proceed.',
        findings: lint.findings,
      }, 422);
    }
    // Record the override on the post itself + audit row.
    await c.env.DB.prepare(
      `UPDATE telegram_posts SET override_reason = ?, override_findings = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(overrideReason.slice(0, 1000), JSON.stringify(lint.findings), id).run();
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'telegram_pii_override',
      postId: id, channelId: post.channel_id,
      extra: { reason: overrideReason.slice(0, 200), findings_count: lint.findings.length, kinds: lint.findings.map((f) => f.kind) },
    });
  }

  // Send.
  try {
    let msgId: number | undefined;
    let chatLink: string | null = null;
    // Per-channel human signature appended at send time only (body_md stays
    // clean in storage so the sig can be edited retroactively per-channel).
    const wireBody = appendSignature(post.body_md, post.channel_signature);
    if (post.media_r2_key && c.env.FILES) {
      const obj = await c.env.FILES.get(post.media_r2_key);
      if (!obj) {
        await releaseClaim('failed', 'media_missing');
        return c.json({ error: 'media_missing' }, 410);
      }
      const bytes = new Uint8Array(await obj.arrayBuffer());
      const filename = post.media_r2_key.split('/').pop() || 'media';
      const sendFn = post.media_kind === 'document' ? sendDocument : sendPhoto;
      const sent = await sendFn(c.env, post.chat_id, bytes, filename, wireBody);
      msgId = sent.message_id;
      try {
        const chat = await getChat(c.env, post.chat_id);
        chatLink = buildTelegramLink(chat, msgId);
      } catch { /* link is best-effort */ }
    } else {
      const sent = await sendMessage(c.env, post.chat_id, wireBody);
      msgId = sent.message_id;
      try {
        const chat = await getChat(c.env, post.chat_id);
        chatLink = buildTelegramLink(chat, msgId);
      } catch {}
    }

    const bodyHash = await sha256Hex(post.body_md);
    await c.env.DB.prepare(
      `UPDATE telegram_posts
          SET status = 'sent',
              sent_at = datetime('now'),
              telegram_message_id = ?,
              telegram_link = ?,
              body_hash = ?,
              send_error = NULL,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(msgId ?? null, chatLink, bodyHash, id).run();
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'telegram_post_sent',
      postId: id, channelId: post.channel_id, bodyHash,
      extra: { message_id: msgId, link: chatLink, had_override: !!overrideReason },
    });
    return c.json({ ok: true, message_id: msgId, link: chatLink });
  } catch (e) {
    const { body, status } = telegramErrorPayload(e);
    try {
      // Only flip out of 'sending' (the row we own). A concurrent finalizer
      // shouldn't exist, but the guard keeps this idempotent.
      await c.env.DB.prepare(
        `UPDATE telegram_posts
            SET status = 'failed', send_error = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'sending'`,
      ).bind(String((body as any).message || (body as any).code).slice(0, 500), id).run();
    } catch {}
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'telegram_post_send_failed',
      postId: id, channelId: post.channel_id,
      extra: { code: (body as any).code },
    });
    return c.json(body, status);
  }
});

// ----------------------------- AGGREGATOR -----------------------------

r.get('/aggregator/preview', async (c) => {
  await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const periodDays = Math.min(90, Math.max(1, Number(c.req.query('period_days')) || 7));
  const kind = c.req.query('kind') as TelegramAudience | undefined;
  if (kind) {
    if (!TELEGRAM_AUDIENCES.includes(kind)) return c.json({ error: 'invalid_kind', allowed: TELEGRAM_AUDIENCES }, 400);
    const draft = await previewAudience(c.env, kind, periodDays);
    return c.json({ drafts: [draft], period_days: periodDays });
  }
  const drafts = await previewAll(c.env, periodDays);
  return c.json({ drafts, period_days: periodDays });
});

r.post('/aggregator/run', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const periodDays = Math.min(90, Math.max(1, Number(body.period_days) || 7));
  const out = await runAggregator(c.env, admin.id, periodDays);
  await writeAudit(c.env, {
    adminId: admin.id, adminEmail: admin.email,
    action: 'telegram_aggregator_run',
    extra: { period_days: periodDays, drafted_count: out.drafted.length, drafted: out.drafted },
  });
  return c.json({ ok: true, period_days: periodDays, ...out });
});

// ----------------------------- CONSENT -----------------------------

r.get('/consent/:user_id', async (c) => {
  await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const uid = Number(c.req.param('user_id'));
  if (!Number.isFinite(uid)) return c.json({ error: 'invalid_user_id' }, 400);
  const row: any = await c.env.DB.prepare(
    `SELECT user_id, consented, consented_at, source, updated_at FROM user_promotion_consent WHERE user_id = ?`,
  ).bind(uid).first();
  return c.json({ user_id: uid, consent: row ? { ...row, consented: !!row.consented } : null });
});

r.put('/consent/:user_id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureTelegramSchema(c.env);
  const uid = Number(c.req.param('user_id'));
  if (!Number.isFinite(uid)) return c.json({ error: 'invalid_user_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const consented = body.consented ? 1 : 0;
  const source = String(body.source || 'admin').slice(0, 50);
  await c.env.DB.prepare(
    `INSERT INTO user_promotion_consent (user_id, consented, consented_at, source, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         consented = excluded.consented,
         consented_at = CASE WHEN excluded.consented = 1 THEN datetime('now') ELSE user_promotion_consent.consented_at END,
         source = excluded.source,
         updated_at = datetime('now')`,
  ).bind(uid, consented, consented ? new Date().toISOString() : null, source).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'telegram_consent_updated', extra: { user_id: uid, consented: !!consented, source } });
  return c.json({ ok: true });
});

export default r;
