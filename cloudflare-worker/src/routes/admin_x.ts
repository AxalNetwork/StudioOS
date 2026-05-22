/**
 * Task #4 — Admin X (Twitter) accounts + posts + aggregator endpoints.
 *
 * Mounted at /api/admin/x BEFORE the generic /api/admin catch-all in
 * index.ts (same precedence pattern as admin_telegram). Sits inside the
 * existing requireCfAccess() perimeter; role gating is per-route via
 * requireAdmin.
 *
 * Endpoint summary:
 *   Accounts
 *     GET    /accounts                            — list (no tokens echoed)
 *     POST   /accounts                            — manual create stub (handle+display)
 *     PUT    /accounts/:id                        — patch label/enabled
 *     DELETE /accounts/:id                        — only when no sent posts
 *     POST   /accounts/:id/test                   — GET /users/me probe
 *     GET    /oauth/start?account_id=&redirect=   — kick PKCE flow
 *     GET    /oauth/callback                      — token exchange + persist (encrypted)
 *   Posts
 *     GET    /posts?status=&account_id=&limit=&offset=
 *     POST   /posts                               — create draft (manual)
 *     PUT    /posts/:id                           — edit draft (forbidden when sent/sending)
 *     DELETE /posts/:id                           — delete draft (forbidden when sent/sending)
 *     POST   /posts/:id/media                     — add a single R2-backed image (≤4 total)
 *     POST   /posts/:id/alt-text                  — auto-generate alt-text via Workers AI
 *     POST   /posts/:id/lint                      — preview PII linter findings
 *     POST   /posts/:id/approve                   — admin approve (status=approved)
 *     POST   /posts/:id/send                      — send (linter blocks unless override_reason)
 *     POST   /posts/:id/schedule                  — set scheduled_for
 *     POST   /posts/:id/retract                   — DELETE on the X API + flip status
 *   Aggregator
 *     GET    /aggregator/preview?period_days=&kind=
 *     POST   /aggregator/run                      — { period_days?, account_id }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { clampLimit, parseOffset } from '../util/pagination';
import { ensureXSchema, X_MAX_TWEET_LEN, X_MAX_MEDIA_PER_TWEET, X_DEFAULT_DAILY_CAP } from '../services/xSchema';
import { encryptString, decryptString } from '../services/cryptoBox';
import {
  XError,
  XConfigMissing,
  generatePkcePair,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  createTweet,
  deleteTweet,
  getMe,
  uploadMedia,
  tweetLength,
} from '../services/xClient';
import { lintForSend } from '../services/telegramRedactCheck';
import { previewXAll, previewXAudience, runXAggregator, X_AUDIENCES, type XAudience } from '../services/xAggregator';

const r = new Hono<{ Bindings: Env }>();

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const X_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ---------------- helpers ----------------

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeJson<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function xErrorPayload(e: unknown): { body: Record<string, unknown>; status: 400 | 429 | 502 | 503 } {
  if (e instanceof XConfigMissing) return { body: { error: e.code, code: e.code, message: e.message }, status: 503 };
  if (e instanceof XError) {
    const status: 400 | 429 | 502 | 503 =
      e.code === 'rate_limited' ? 429 :
      e.code === 'x_breaker_open' ? 503 :
      e.code === 'x_unauthorized' || e.code === 'x_forbidden' || e.code === 'x_duplicate_content' ? 400 :
      502;
    return {
      body: {
        error: e.code, code: e.code, message: e.message,
        ...(e.retryAfter ? { retry_after: e.retryAfter } : {}),
      },
      status,
    };
  }
  return { body: { error: 'x_unknown', code: 'x_unknown', message: (e as Error).message || String(e) }, status: 502 };
}

// Audit ------------------------------------------------------------------

let _auditHasActor: boolean | null = null;
async function auditHasActor(env: Env): Promise<boolean> {
  if (_auditHasActor !== null) return _auditHasActor;
  try {
    const rr = await env.DB.prepare("PRAGMA table_info('admin_audit_log')").all<{ name: string }>();
    _auditHasActor = (rr.results || []).some((c) => String(c.name) === 'actor');
  } catch { _auditHasActor = false; }
  return _auditHasActor;
}

async function writeAudit(env: Env, opts: {
  adminId: number; adminEmail: string; action: string;
  postId?: number; accountId?: number; bodyHash?: string;
  extra?: Record<string, unknown>;
}) {
  try {
    const filters = JSON.stringify({
      post_id: opts.postId, account_id: opts.accountId, body_hash: opts.bodyHash,
      ...(opts.extra || {}),
    });
    if (await auditHasActor(env)) {
      const actor = await hashEmail(opts.adminEmail);
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, actor)
           VALUES (?, ?, 'x', ?, ?)`,
      ).bind(opts.adminId, opts.action, filters, actor).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json)
           VALUES (?, ?, 'x', ?)`,
      ).bind(opts.adminId, opts.action, filters).run();
    }
  } catch (e) {
    console.warn('[admin_x] audit write failed:', (e as Error).message);
  }
}

// Loaders ---------------------------------------------------------------

async function loadPost(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT p.*, a.handle, a.display_name
       FROM x_posts p JOIN x_accounts a ON a.id = p.account_id
      WHERE p.id = ?`,
  ).bind(id).first<any>();
}

async function loadAccount(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT id, handle, display_name, x_user_id, scopes,
            access_token_ct, refresh_token_ct, expires_at,
            enabled, last_test_at, last_error
       FROM x_accounts WHERE id = ?`,
  ).bind(id).first<any>();
}

/**
 * Return a usable plaintext access token, refreshing + re-encrypting in
 * place when the cached one is within 60s of expiry (or already expired).
 * Throws XConfigMissing / x_unauthorized via the underlying refresh call.
 */
async function getFreshAccessToken(env: Env, account: any): Promise<string> {
  if (!account?.access_token_ct) throw new XError('x_account_not_linked', 'X account not linked yet.');
  const exp = account.expires_at ? Date.parse(account.expires_at) : 0;
  const needRefresh = !exp || exp - Date.now() < 60_000;
  if (!needRefresh) {
    const at = await decryptString(env, account.access_token_ct);
    if (!at) throw new XError('x_account_not_linked', 'Stored access token unreadable. Re-authorise the account.');
    return at;
  }
  if (!account.refresh_token_ct) {
    throw new XError('x_refresh_missing', 'Access token expired and no refresh token stored. Re-authorise the account.');
  }
  const rt = await decryptString(env, account.refresh_token_ct);
  if (!rt) throw new XError('x_refresh_missing', 'Stored refresh token unreadable. Re-authorise the account.');
  const fresh = await refreshAccessToken(env, rt);
  const newAtCt = await encryptString(env, fresh.access_token);
  const newRtCt = fresh.refresh_token ? await encryptString(env, fresh.refresh_token) : account.refresh_token_ct;
  const expiresAt = new Date(Date.now() + (fresh.expires_in || 7200) * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE x_accounts
        SET access_token_ct = ?, refresh_token_ct = ?, expires_at = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(newAtCt, newRtCt, expiresAt, account.id).run();
  return fresh.access_token;
}

// Per-account daily cap (KV-backed) -------------------------------------

function quotaKey(accountId: number, day: string): string {
  return `x_quota:${accountId}:${day}`;
}
function isoDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Read sent-today via the source-of-truth D1 query (atomic + consistent).
 * KV is only used as a non-authoritative cache hint for fast UI reads.
 */
async function readSentToday(env: Env, accountId: number): Promise<number> {
  try {
    const row: any = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM x_posts
        WHERE account_id = ? AND status = 'sent'
          AND date(sent_at) = date('now')`,
    ).bind(accountId).first();
    return Number(row?.n || 0);
  } catch { return 0; }
}

/**
 * Atomic reservation count: sent-today PLUS every row currently in 'sending'
 * for this account. Because `/send` CAS-flips head + children to 'sending'
 * BEFORE the cap check, two concurrent thread sends on the same account
 * cannot both pass the check — the second one sees the first one's 'sending'
 * rows and gets bounced.
 */
async function reservedTodayWithInflight(env: Env, accountId: number): Promise<number> {
  try {
    const row: any = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM x_posts
            WHERE account_id = ? AND status = 'sent'
              AND date(sent_at) = date('now')) +
         (SELECT COUNT(*) FROM x_posts
            WHERE account_id = ? AND status = 'sending') AS n`,
    ).bind(accountId, accountId).first();
    return Number(row?.n || 0);
  } catch { return 0; }
}

async function bumpSentToday(env: Env, accountId: number, by = 1) {
  // Non-authoritative cache for fast reads on the Accounts tab. Real cap
  // accounting lives in D1 via reservedTodayWithInflight() above.
  try {
    const cur = Number((await env.RATE_LIMITS.get(quotaKey(accountId, isoDay()))) || 0);
    await env.RATE_LIMITS.put(quotaKey(accountId, isoDay()), String(cur + by), { expirationTtl: 60 * 60 * 36 });
  } catch (e) {
    console.warn('[admin_x] quota bump failed', (e as Error).message);
  }
}

function dailyCap(env: Env): number {
  const n = Number(env.X_DAILY_CAP || 0);
  return Number.isFinite(n) && n > 0 ? n : X_DEFAULT_DAILY_CAP;
}

// ----------------------------- ACCOUNTS -----------------------------

r.get('/accounts', async (c) => {
  await requireAdmin(c);
  await ensureXSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, handle, display_name, x_user_id, scopes, expires_at,
            enabled, last_test_at, last_error, created_at, updated_at
       FROM x_accounts ORDER BY id ASC`,
  ).all<any>();
  const accounts = (rows.results || []).map((a) => ({
    ...a,
    enabled: !!a.enabled,
    has_token: undefined, // intentionally omitted — never echo token state
  }));
  return c.json({
    accounts,
    daily_cap: dailyCap(c.env),
    config_ok: !!(c.env.X_CLIENT_ID && c.env.X_CLIENT_SECRET),
  });
});

r.post('/accounts', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const handle = String(body.handle || '').replace(/^@/, '').trim();
  if (!HANDLE_RE.test(handle)) return c.json({ error: 'invalid_handle' }, 400);
  const display = body.display_name ? String(body.display_name).trim().slice(0, 200) : null;
  try {
    const ins = await c.env.DB.prepare(
      `INSERT INTO x_accounts (handle, display_name) VALUES (?, ?) RETURNING id`,
    ).bind(handle, display).first<{ id: number }>();
    await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_account_created', accountId: ins?.id, extra: { handle } });
    return c.json({ id: ins?.id, handle }, 201);
  } catch (err: any) {
    if (String(err?.message || '').toLowerCase().includes('unique')) return c.json({ error: 'handle_taken' }, 409);
    console.error('[admin_x] account create failed', err);
    return c.json({ error: 'create_failed' }, 500);
  }
});

r.put('/accounts/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof body.display_name === 'string') { sets.push('display_name = ?'); args.push(body.display_name.trim().slice(0, 200) || null); }
  if ('enabled' in body) { sets.push('enabled = ?'); args.push(body.enabled ? 1 : 0); }
  if (sets.length === 0) return c.json({ error: 'no_fields' }, 400);
  sets.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE x_accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_account_updated', accountId: id, extra: { fields: Object.keys(body) } });
  return c.json({ ok: true });
});

r.delete('/accounts/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const sent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM x_posts WHERE account_id = ? AND status = 'sent'`,
  ).bind(id).first<{ n: number }>();
  if ((sent?.n ?? 0) > 0) {
    return c.json({ error: 'has_sent_posts', message: 'Account has sent posts; disable it instead.' }, 409);
  }
  await c.env.DB.prepare(`DELETE FROM x_posts WHERE account_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM x_accounts WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_account_deleted', accountId: id });
  return c.json({ ok: true });
});

r.post('/accounts/:id/test', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const acct: any = await loadAccount(c.env, id);
  if (!acct) return c.json({ error: 'not_found' }, 404);
  try {
    const at = await getFreshAccessToken(c.env, acct);
    const me = await getMe(at);
    await c.env.DB.prepare(
      `UPDATE x_accounts SET last_test_at = datetime('now'), last_error = NULL,
                              x_user_id = COALESCE(x_user_id, ?),
                              updated_at = datetime('now') WHERE id = ?`,
    ).bind(me.data.id, id).run();
    await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_account_tested', accountId: id });
    return c.json({ ok: true, me: me.data });
  } catch (e) {
    const { body, status } = xErrorPayload(e);
    try {
      await c.env.DB.prepare(`UPDATE x_accounts SET last_error = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(String((body as any).message || (body as any).code || 'error').slice(0, 500), id).run();
    } catch {}
    return c.json(body, status);
  }
});

// ----------------------------- OAUTH (PKCE) -----------------------------

function appBase(env: Env): string {
  return (env.PUBLIC_BASE_URL || env.APP_URL || 'https://axal.vc').replace(/\/$/, '');
}
function oauthBase(env: Env): string {
  return (env.OAUTH_CALLBACK_BASE_URL || 'https://app.axal.vc').replace(/\/$/, '');
}
function xRedirectUri(env: Env): string {
  return `${oauthBase(env)}/api/admin/x/oauth/callback`;
}

// Handlers are functions (not inline) so we can mount both the originally-
// implemented `/oauth/*` paths AND the spec-mandated `/auth/*` aliases on
// the same code. Doc says `/api/admin/x/auth/start` + `/auth/callback`.
const oauthStart = async (c: any) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  if (!c.env.X_CLIENT_ID || !c.env.X_CLIENT_SECRET) {
    return c.json({ error: 'x_config_missing', message: 'X_CLIENT_ID / X_CLIENT_SECRET not set.' }, 503);
  }
  const accountId = Number(c.req.query('account_id'));
  if (!Number.isFinite(accountId)) return c.json({ error: 'account_id_required' }, 400);
  const acct = await loadAccount(c.env, accountId);
  if (!acct) return c.json({ error: 'account_not_found' }, 404);

  const { verifier, challenge } = generatePkcePair();
  const challengeB64 = await challenge;
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const state = btoa(String.fromCharCode(...nonceBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // KV-bind state -> { verifier, account_id, admin_id } for 10 min.
  await c.env.TOKENS.put(
    `xstate:${state}`,
    JSON.stringify({ verifier, account_id: accountId, admin_id: admin.id }),
    { expirationTtl: 600 },
  );
  const url = buildAuthorizeUrl({
    clientId: c.env.X_CLIENT_ID,
    redirectUri: xRedirectUri(c.env),
    state,
    codeChallenge: challengeB64,
  });
  return c.json({ url });
};

const oauthCallback = async (c: any) => {
  await ensureXSchema(c.env);
  const code = c.req.query('code');
  const state = c.req.query('state');
  const err = c.req.query('error');
  const land = (q: string) => Response.redirect(`${appBase(c.env)}/admin/x?${q}`, 302);
  if (err) return land(`x_oauth_error=${encodeURIComponent(err)}`);
  if (!code || !state) return land('x_oauth_error=missing_code');
  // CSRF: the callback MUST be hit by the same admin session that started the
  // flow. Without this check, an attacker who tricked an admin into clicking a
  // crafted `/oauth/callback?code=…&state=…` URL (where `state` was minted from
  // the attacker's own /oauth/start) could bind the attacker's X account to
  // ours. requireAdmin throws on no-auth / non-admin, which we map to a
  // user-facing redirect rather than letting the global 401 page swallow it.
  let admin: { id: number } | null = null;
  try { admin = await requireAdmin(c); } catch { return land('x_oauth_error=admin_required'); }
  let bound: { verifier?: string; account_id?: number; admin_id?: number } | null = null;
  try {
    const raw = await c.env.TOKENS.get(`xstate:${state}`);
    bound = raw ? JSON.parse(raw) : null;
  } catch {}
  if (!bound?.verifier || !bound.account_id) return land('x_oauth_error=bad_state');
  if (bound.admin_id && bound.admin_id !== admin.id) {
    try { await c.env.TOKENS.delete(`xstate:${state}`); } catch {}
    return land('x_oauth_error=state_admin_mismatch');
  }
  try { await c.env.TOKENS.delete(`xstate:${state}`); } catch {}

  try {
    const tok = await exchangeCodeForToken(c.env, {
      code, redirectUri: xRedirectUri(c.env), codeVerifier: bound.verifier,
    });
    const accessCt = await encryptString(c.env, tok.access_token);
    const refreshCt = tok.refresh_token ? await encryptString(c.env, tok.refresh_token) : null;
    const expiresAt = new Date(Date.now() + (tok.expires_in || 7200) * 1000).toISOString();
    let xUserId: string | null = null;
    try { xUserId = (await getMe(tok.access_token)).data.id; } catch {}
    await c.env.DB.prepare(
      `UPDATE x_accounts
          SET access_token_ct = ?, refresh_token_ct = ?, expires_at = ?,
              scopes = ?, x_user_id = COALESCE(?, x_user_id),
              last_error = NULL, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(accessCt, refreshCt, expiresAt, tok.scope || null, xUserId, bound.account_id).run();
    return land(`x_oauth_linked=${bound.account_id}`);
  } catch (e) {
    return land(`x_oauth_error=${encodeURIComponent((e as Error).message || 'exchange_failed')}`);
  }
};

// Spec contract: `/auth/start` + `/auth/callback`. Backwards-compat: keep
// the original `/oauth/*` paths mounted so any half-deployed link or in-
// flight OAuth round-trip during cutover still works.
r.get('/auth/start', oauthStart);
r.get('/oauth/start', oauthStart);
r.get('/auth/callback', oauthCallback);
r.get('/oauth/callback', oauthCallback);

// ----------------------------- POSTS -----------------------------

r.get('/posts', async (c) => {
  await requireAdmin(c);
  await ensureXSchema(c.env);
  const status = c.req.query('status');
  const accountId = c.req.query('account_id');
  const limit = clampLimit(c.req.query('limit'), 50, 200);
  const offset = parseOffset(c.req.query('offset'));
  const where: string[] = [];
  const args: unknown[] = [];
  if (status) {
    // Allow comma-separated status filter so the admin UI can fetch all
    // manageable states (draft|approved|scheduled|failed) in a single call —
    // otherwise scheduled posts disappear from the Drafts tab after being
    // scheduled and `Reschedule` becomes unreachable.
    const parts = String(status).split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      where.push('p.status = ?'); args.push(parts[0]);
    } else if (parts.length > 1) {
      where.push(`p.status IN (${parts.map(() => '?').join(',')})`);
      args.push(...parts);
    }
  }
  if (accountId) { where.push('p.account_id = ?'); args.push(Number(accountId)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.account_id, p.status, p.body, p.hashtags, p.media_r2_keys, p.alt_texts,
            p.scheduled_for, p.sent_at, p.tweet_id, p.tweet_link, p.in_reply_to_tweet_id,
            p.thread_continuation_of, p.thread_position, p.source, p.source_kind,
            p.send_error, p.override_reason, p.created_by, p.created_at, p.updated_at,
            a.handle, a.display_name
       FROM x_posts p JOIN x_accounts a ON a.id = p.account_id
       ${whereSql}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...args, limit, offset).all<any>();
  const posts = (rows.results || []).map((p) => ({
    ...p,
    media_r2_keys: safeJson<string[]>(p.media_r2_keys, []),
    alt_texts: safeJson<string[]>(p.alt_texts, []),
    length: tweetLength(String(p.body || '')),
  }));
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM x_posts p ${whereSql}`).bind(...args).first<{ n: number }>();
  return c.json({ posts, total: total?.n ?? 0, limit, offset });
});

r.post('/posts', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const accountId = Number(body.account_id);
  if (!Number.isFinite(accountId)) return c.json({ error: 'account_id_required' }, 400);
  const acct: any = await loadAccount(c.env, accountId);
  if (!acct) return c.json({ error: 'account_not_found' }, 404);
  if (!acct.enabled) return c.json({ error: 'account_disabled' }, 400);
  const text = String(body.body || '').replace(/\r\n/g, '\n').trim();
  if (!text) return c.json({ error: 'body_required' }, 400);
  if (tweetLength(text) > X_MAX_TWEET_LEN) return c.json({ error: 'body_too_long', max: X_MAX_TWEET_LEN, length: tweetLength(text) }, 400);
  const hashtags = body.hashtags ? String(body.hashtags).slice(0, 500) : null;
  const continuationOf = body.thread_continuation_of ? Number(body.thread_continuation_of) : null;
  let threadPos = 0;
  if (continuationOf) {
    const parent: any = await c.env.DB.prepare(
      `SELECT id, account_id, thread_continuation_of FROM x_posts WHERE id = ?`,
    ).bind(continuationOf).first();
    if (!parent || parent.account_id !== accountId) return c.json({ error: 'invalid_thread_parent' }, 400);
    // Always anchor child rows at the HEAD of the thread.
    const headId = parent.thread_continuation_of ? Number(parent.thread_continuation_of) : continuationOf;
    const sib: any = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(thread_position), 0) AS p FROM x_posts WHERE thread_continuation_of = ?`,
    ).bind(headId).first();
    threadPos = Number(sib?.p || 0) + 1;
    const ins = await c.env.DB.prepare(
      `INSERT INTO x_posts (account_id, status, body, hashtags, source, thread_continuation_of, thread_position, created_by)
         VALUES (?, 'draft', ?, ?, 'manual', ?, ?, ?) RETURNING id`,
    ).bind(accountId, text, hashtags, headId, threadPos, admin.id).first<{ id: number }>();
    await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_created', postId: ins?.id, accountId, extra: { thread_pos: threadPos } });
    return c.json({ id: ins?.id, thread_position: threadPos, thread_head_id: headId }, 201);
  }
  const ins = await c.env.DB.prepare(
    `INSERT INTO x_posts (account_id, status, body, hashtags, source, thread_position, created_by)
       VALUES (?, 'draft', ?, ?, 'manual', 0, ?) RETURNING id`,
  ).bind(accountId, text, hashtags, admin.id).first<{ id: number }>();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_created', postId: ins?.id, accountId });
  return c.json({ id: ins?.id }, 201);
});

r.put('/posts/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_edit_in_state', state: post.status }, 409);
  const body: any = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof body.body === 'string') {
    const v = body.body.replace(/\r\n/g, '\n').trim();
    if (!v) return c.json({ error: 'body_required' }, 400);
    if (tweetLength(v) > X_MAX_TWEET_LEN) return c.json({ error: 'body_too_long', max: X_MAX_TWEET_LEN, length: tweetLength(v) }, 400);
    sets.push('body = ?'); args.push(v);
  }
  if (typeof body.hashtags === 'string') { sets.push('hashtags = ?'); args.push(body.hashtags.slice(0, 500) || null); }
  if ('scheduled_for' in body) {
    const v = body.scheduled_for ? String(body.scheduled_for) : null;
    if (v && Number.isNaN(Date.parse(v))) return c.json({ error: 'invalid_scheduled_for' }, 400);
    sets.push('scheduled_for = ?'); args.push(v);
  }
  if (sets.length === 0) return c.json({ error: 'no_fields' }, 400);
  sets.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE x_posts SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
  const afterRow: any = await loadPost(c.env, id);
  const editedHash = await sha256Hex(String(afterRow?.body || ''));
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_edited', postId: id, accountId: post.account_id, bodyHash: editedHash, extra: { fields: Object.keys(body) } });
  return c.json({ ok: true });
});

r.delete('/posts/:id', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_delete_in_state', state: post.status }, 409);
  const keys = safeJson<string[]>(post.media_r2_keys, []);
  if (c.env.FILES) {
    for (const k of keys) {
      if (k && k.startsWith('x/')) { try { await c.env.FILES.delete(k); } catch {} }
    }
  }
  await c.env.DB.prepare(`DELETE FROM x_posts WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_deleted', postId: id, accountId: post.account_id });
  return c.json({ ok: true });
});

r.post('/posts/:id/media', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_attach_in_state', state: post.status }, 409);

  const body: any = await c.req.json().catch(() => ({}));
  const dataUri = String(body.data_uri || '');
  if (!dataUri.startsWith('data:')) return c.json({ error: 'invalid_data_uri' }, 400);
  const comma = dataUri.indexOf(',');
  if (comma < 0) return c.json({ error: 'invalid_data_uri' }, 400);
  const mime = dataUri.slice(5, comma).replace(';base64', '').trim();
  const ext = X_IMAGE_MIME[mime];
  if (!ext) return c.json({ error: 'unsupported_mime', allowed: Object.keys(X_IMAGE_MIME) }, 400);
  let bytes: Uint8Array;
  try { bytes = bytesFromBase64(dataUri.slice(comma + 1)); }
  catch { return c.json({ error: 'invalid_base64' }, 400); }
  if (bytes.byteLength > X_MAX_IMAGE_BYTES) return c.json({ error: 'too_large', max_bytes: X_MAX_IMAGE_BYTES }, 413);

  const existing = safeJson<string[]>(post.media_r2_keys, []);
  const existingAlts = safeJson<string[]>(post.alt_texts, []);
  if (existing.length >= X_MAX_MEDIA_PER_TWEET) return c.json({ error: 'too_many_media', max: X_MAX_MEDIA_PER_TWEET }, 400);

  // Magic-byte sniff — refuse mismatched declared MIME.
  const magicOk =
    (mime === 'image/png'  && bytes[0] === 0x89 && bytes[1] === 0x50) ||
    (mime === 'image/jpeg' && bytes[0] === 0xFF && bytes[1] === 0xD8) ||
    (mime === 'image/webp' && bytes[8] === 0x57 && bytes[9] === 0x45);
  if (!magicOk) return c.json({ error: 'mime_mismatch' }, 400);

  // NSFW gate — best-effort vision classifier via Workers AI (LLaVA). We
  // ask the model a yes/no question and refuse the upload on YES. Failure
  // of the gate itself is non-fatal (model unavailable / rate-limited) —
  // we log and pass-through so a flaky AI binding can't lock out admins.
  if (c.env.AI) {
    try {
      const out: any = await c.env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: Array.from(bytes),
        prompt: 'Answer with a single word, YES or NO. Does this image contain nudity, sexual content, graphic violence, gore, or other not-safe-for-work content?',
        max_tokens: 8,
      });
      const verdict = String(out?.description || out?.response || '').trim().toLowerCase();
      if (verdict.startsWith('yes')) {
        return c.json({ error: 'nsfw_blocked', message: 'Image rejected by safety classifier.' }, 422);
      }
    } catch (e) {
      console.warn('[admin_x] nsfw classifier failed (passing through):', (e as Error).message);
    }
  }

  const key = `x/${post.account_id}/${id}/${crypto.randomUUID()}.${ext}`;
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { post_id: String(id), uploaded_by: String(admin.id) },
  });
  const newKeys = [...existing, key];
  const altText = body.alt_text ? String(body.alt_text).slice(0, 1000) : '';
  const newAlts = [...existingAlts, altText];
  await c.env.DB.prepare(
    `UPDATE x_posts SET media_r2_keys = ?, alt_texts = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(JSON.stringify(newKeys), JSON.stringify(newAlts), id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_media_added', postId: id, accountId: post.account_id, extra: { size: bytes.byteLength, count: newKeys.length } });
  return c.json({ ok: true, media_r2_keys: newKeys, count: newKeys.length });
});

r.post('/posts/:id/alt-text', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  if (!c.env.AI) return c.json({ error: 'ai_unavailable' }, 503);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  const keys = safeJson<string[]>(post.media_r2_keys, []);
  if (!keys.length) return c.json({ error: 'no_media' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const idx = Number(body.index ?? 0);
  if (!Number.isInteger(idx) || idx < 0 || idx >= keys.length) return c.json({ error: 'invalid_index' }, 400);
  const obj = await c.env.FILES?.get(keys[idx]);
  if (!obj) return c.json({ error: 'media_missing' }, 410);
  const bytes = new Uint8Array(await obj.arrayBuffer());

  // Workers AI image-to-text. Llava is the documented captioning model.
  let caption = '';
  try {
    const out: any = await c.env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
      image: Array.from(bytes),
      prompt: 'Briefly describe this image for a visually-impaired reader in one sentence.',
      max_tokens: 80,
    });
    caption = String(out?.description || out?.response || '').trim().slice(0, 1000);
  } catch (e) {
    return c.json({ error: 'ai_failed', message: (e as Error).message }, 502);
  }
  if (!caption) return c.json({ error: 'ai_empty' }, 502);

  const alts = safeJson<string[]>(post.alt_texts, []);
  while (alts.length < keys.length) alts.push('');
  alts[idx] = caption;
  await c.env.DB.prepare(
    `UPDATE x_posts SET alt_texts = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(JSON.stringify(alts), id).run();
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_alt_generated', postId: id, accountId: post.account_id, extra: { index: idx } });
  return c.json({ ok: true, index: idx, alt_text: caption });
});

r.post('/posts/:id/lint', async (c) => {
  await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  // X is always fully public — use the strictest 'public' rule set in
  // telegramRedactCheck which blocks on any unconsented user mention.
  const result = await lintForSend(c.env, post.body, 'public');
  return c.json(result);
});

r.post('/posts/:id/approve', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status !== 'draft') return c.json({ error: 'not_draft', state: post.status }, 409);
  await c.env.DB.prepare(
    `UPDATE x_posts SET status = 'approved', approved_by = ?, approved_at = datetime('now'),
                         updated_at = datetime('now') WHERE id = ?`,
  ).bind(admin.id, id).run();
  const approvedHash = await sha256Hex(String(post.body || ''));
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_approved', postId: id, accountId: post.account_id, bodyHash: approvedHash });
  return c.json({ ok: true });
});

r.post('/posts/:id/schedule', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent' || post.status === 'sending') return c.json({ error: 'cannot_schedule_in_state', state: post.status }, 409);
  const body: any = await c.req.json().catch(() => ({}));
  const at = Date.parse(String(body.scheduled_for || ''));
  if (!Number.isFinite(at)) return c.json({ error: 'invalid_scheduled_for' }, 400);
  if (at < Date.now() - 60_000) return c.json({ error: 'scheduled_in_past' }, 400);
  await c.env.DB.prepare(
    `UPDATE x_posts SET status = 'scheduled', scheduled_for = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(new Date(at).toISOString(), id).run();
  const schedHash = await sha256Hex(String(post.body || ''));
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_scheduled', postId: id, accountId: post.account_id, bodyHash: schedHash, extra: { scheduled_for: new Date(at).toISOString() } });
  return c.json({ ok: true });
});

r.post('/posts/:id/send', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status === 'sent') return c.json({ error: 'already_sent' }, 409);
  if (post.status === 'sending') return c.json({ error: 'send_in_progress' }, 409);
  if (post.thread_continuation_of) {
    return c.json({ error: 'cannot_send_thread_child_directly', head_id: post.thread_continuation_of }, 400);
  }

  // Compare-and-set: atomically transition the head row draft|approved|scheduled|failed -> sending.
  // We CAS BEFORE the cap check so the head's own reservation is visible to
  // any concurrent /send racing the same account (see reservedTodayWithInflight).
  const claim = await c.env.DB.prepare(
    `UPDATE x_posts SET status = 'sending', updated_at = datetime('now')
       WHERE id = ? AND status IN ('draft', 'approved', 'scheduled', 'failed')`,
  ).bind(id).run();
  if (!claim.meta || (claim.meta as { changes?: number }).changes !== 1) {
    return c.json({ error: 'already_sending_or_sent' }, 409);
  }

  // Reserve every thread child to 'sending' as well so the cap check sees
  // the full thread's reservation footprint atomically. Children that have
  // already been sent stay 'sent' and are skipped at send time.
  await c.env.DB.prepare(
    `UPDATE x_posts SET status = 'sending', updated_at = datetime('now')
       WHERE thread_continuation_of = ?
         AND status IN ('draft', 'approved', 'scheduled', 'failed')`,
  ).bind(id).run();

  const reqBody: any = await c.req.json().catch(() => ({}));
  const overrideReason = reqBody.override_reason ? String(reqBody.override_reason).trim() : null;

  // Release helper — flips the head AND any children we reserved back to a
  // recoverable state. Idempotent: only touches rows we left in 'sending'.
  const releaseClaim = async (next: 'draft' | 'failed' = 'draft', errMsg?: string) => {
    try {
      await c.env.DB.prepare(
        `UPDATE x_posts SET status = ?, send_error = ?, updated_at = datetime('now')
           WHERE id = ? AND status = 'sending'`,
      ).bind(next, errMsg ? errMsg.slice(0, 500) : null, id).run();
      await c.env.DB.prepare(
        `UPDATE x_posts SET status = ?, send_error = ?, updated_at = datetime('now')
           WHERE thread_continuation_of = ? AND status = 'sending'`,
      ).bind(next, errMsg ? errMsg.slice(0, 500) : null, id).run();
    } catch {}
  };

  // Atomic cap enforcement: with head + children now reserved in 'sending',
  // count sent-today + every in-flight 'sending' row for this account. Two
  // concurrent sends racing the same account both reach this point, but each
  // sees the other's reservations, so only the first one can fit under cap.
  const used = await reservedTodayWithInflight(c.env, post.account_id);
  const cap = dailyCap(c.env);
  if (used > cap) {
    await releaseClaim('draft');
    return c.json({ error: 'daily_cap_reached', used, cap }, 429);
  }

  // PII linter — concatenate head + every child of the thread so a leak
  // hidden in tweet 3 still blocks the whole thread.
  const children: any = await c.env.DB.prepare(
    `SELECT id, body FROM x_posts WHERE thread_continuation_of = ? ORDER BY thread_position ASC`,
  ).bind(id).all();
  const fullText = [post.body, ...((children.results || []) as any[]).map((r) => r.body)].join('\n');
  const lint = await lintForSend(c.env, fullText, 'public');
  if (!lint.ok) {
    if (!overrideReason || overrideReason.length < 8) {
      await releaseClaim('draft');
      return c.json({
        error: 'pii_linter_blocked', code: 'pii_linter_blocked',
        message: 'PII linter blocked the send. Provide override_reason (≥8 chars) to proceed.',
        findings: lint.findings,
      }, 422);
    }
    await c.env.DB.prepare(
      `UPDATE x_posts SET override_reason = ?, override_findings = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(overrideReason.slice(0, 1000), JSON.stringify(lint.findings), id).run();
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email, action: 'x_pii_override',
      postId: id, accountId: post.account_id,
      extra: { reason: overrideReason.slice(0, 200), kinds: lint.findings.map((f) => f.kind) },
    });
  }

  // Resolve account + token.
  const acct: any = await loadAccount(c.env, post.account_id);
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(c.env, acct);
  } catch (e) {
    const { body, status } = xErrorPayload(e);
    await releaseClaim('failed', String((body as any).message || (body as any).code).slice(0, 500));
    return c.json(body, status);
  }

  // Helper to send one post row (head OR child) with its own media.
  const sendOne = async (row: any, inReplyTo?: string): Promise<{ tweet_id: string; link: string }> => {
    const keys = safeJson<string[]>(row.media_r2_keys, []);
    const mediaIds: string[] = [];
    for (const k of keys.slice(0, X_MAX_MEDIA_PER_TWEET)) {
      const o = await c.env.FILES?.get(k);
      if (!o) throw new XError('media_missing', `R2 object missing: ${k}`);
      const buf = new Uint8Array(await o.arrayBuffer());
      const mimeGuess =
        k.endsWith('.png') ? 'image/png' :
        k.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      const up = await uploadMedia({ accessToken, bytes: buf, mimeType: mimeGuess });
      mediaIds.push(up.media_id_string);
    }
    const res = await createTweet({ accessToken, text: row.body, inReplyToTweetId: inReplyTo, mediaIds });
    const tweetId = res.data.id;
    const link = `https://x.com/${acct.handle}/status/${tweetId}`;
    return { tweet_id: tweetId, link };
  };

  try {
    // Send head, then walk thread children sequentially.
    const headOut = await sendOne(post);
    const bodyHash = await sha256Hex(fullText);
    await c.env.DB.prepare(
      `UPDATE x_posts SET status = 'sent', sent_at = datetime('now'),
                          tweet_id = ?, tweet_link = ?, body_hash = ?,
                          send_error = NULL, updated_at = datetime('now')
         WHERE id = ?`,
    ).bind(headOut.tweet_id, headOut.link, bodyHash, id).run();
    await bumpSentToday(c.env, post.account_id, 1);

    let parentId = headOut.tweet_id;
    const sentChildren: Array<{ id: number; tweet_id: string }> = [];
    for (const child of (children.results || []) as any[]) {
      // Re-load to get media keys.
      const full: any = await c.env.DB.prepare(`SELECT * FROM x_posts WHERE id = ?`).bind(child.id).first();
      try {
        const out = await sendOne(full, parentId);
        await c.env.DB.prepare(
          `UPDATE x_posts SET status = 'sent', sent_at = datetime('now'),
                              tweet_id = ?, tweet_link = ?, in_reply_to_tweet_id = ?,
                              send_error = NULL, updated_at = datetime('now')
             WHERE id = ?`,
        ).bind(out.tweet_id, out.link, parentId, child.id).run();
        sentChildren.push({ id: child.id, tweet_id: out.tweet_id });
        await bumpSentToday(c.env, post.account_id, 1);
        parentId = out.tweet_id;
      } catch (e) {
        // Partial thread — head succeeded, this child + remaining children
        // are marked failed so the admin can re-send them (each is a
        // standalone row). Bubble the error up to the caller too.
        await c.env.DB.prepare(
          `UPDATE x_posts SET status = 'failed', send_error = ?, updated_at = datetime('now')
             WHERE id = ? AND status <> 'sent'`,
        ).bind(String((e as Error).message).slice(0, 500), child.id).run();
        const { body, status } = xErrorPayload(e);
        await writeAudit(c.env, {
          adminId: admin.id, adminEmail: admin.email, action: 'x_post_thread_partial',
          postId: id, accountId: post.account_id, bodyHash,
          extra: { sent_children: sentChildren.length, failed_child_id: child.id, code: (body as any).code },
        });
        return c.json({
          ok: false, partial: true,
          head: headOut, sent_children: sentChildren, failed_child: { id: child.id, ...body },
        }, status);
      }
    }

    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email, action: 'x_post_sent',
      postId: id, accountId: post.account_id, bodyHash,
      extra: { tweet_id: headOut.tweet_id, link: headOut.link, thread_size: 1 + sentChildren.length, had_override: !!overrideReason },
    });
    return c.json({ ok: true, tweet_id: headOut.tweet_id, link: headOut.link, sent_children: sentChildren });
  } catch (e) {
    const { body, status } = xErrorPayload(e);
    await releaseClaim('failed', String((body as any).message || (body as any).code).slice(0, 500));
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email, action: 'x_post_send_failed',
      postId: id, accountId: post.account_id, extra: { code: (body as any).code },
    });
    return c.json(body, status);
  }
});

r.post('/posts/:id/retract', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status !== 'sent') return c.json({ error: 'not_sent', state: post.status }, 409);
  if (!post.tweet_id) return c.json({ error: 'missing_tweet_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const reason = body.reason ? String(body.reason).trim().slice(0, 500) : null;

  const acct: any = await loadAccount(c.env, post.account_id);
  try {
    const at = await getFreshAccessToken(c.env, acct);
    await deleteTweet({ accessToken: at, tweetId: post.tweet_id });
    await c.env.DB.prepare(
      `UPDATE x_posts SET status = 'retracted', retracted_at = datetime('now'),
                          retracted_by = ?, retraction_reason = ?,
                          updated_at = datetime('now') WHERE id = ?`,
    ).bind(admin.id, reason, id).run();
    const retractHash = await sha256Hex(String(post.body || ''));
    await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_retracted', postId: id, accountId: post.account_id, bodyHash: retractHash, extra: { tweet_id: post.tweet_id, reason } });
    return c.json({ ok: true });
  } catch (e) {
    const { body: ebody, status } = xErrorPayload(e);
    return c.json(ebody, status);
  }
});

// ----------------------------- AGGREGATOR -----------------------------

r.get('/aggregator/preview', async (c) => {
  await requireAdmin(c);
  await ensureXSchema(c.env);
  const periodDays = Math.min(90, Math.max(1, Number(c.req.query('period_days')) || 7));
  const kind = c.req.query('kind') as XAudience | undefined;
  if (kind) {
    if (!X_AUDIENCES.includes(kind)) return c.json({ error: 'invalid_kind', allowed: X_AUDIENCES }, 400);
    const d = await previewXAudience(c.env, kind, periodDays);
    return c.json({ drafts: [d], period_days: periodDays });
  }
  const drafts = await previewXAll(c.env, periodDays);
  return c.json({ drafts, period_days: periodDays });
});

r.post('/aggregator/run', async (c) => {
  const admin = await requireAdmin(c);
  await ensureXSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const periodDays = Math.min(90, Math.max(1, Number(body.period_days) || 7));
  const accountId = Number(body.account_id);
  if (!Number.isFinite(accountId)) return c.json({ error: 'account_id_required' }, 400);
  const acct = await loadAccount(c.env, accountId);
  if (!acct) return c.json({ error: 'account_not_found' }, 404);
  const out = await runXAggregator(c.env, { adminId: admin.id, accountId, periodDays });
  await writeAudit(c.env, {
    adminId: admin.id, adminEmail: admin.email, action: 'x_aggregator_run',
    accountId, extra: { period_days: periodDays, drafted_count: out.drafted.length, drafted: out.drafted },
  });
  return c.json({ ok: true, period_days: periodDays, ...out });
});

export default r;
