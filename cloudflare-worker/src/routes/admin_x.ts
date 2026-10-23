/**
 * Task #4 — Admin X (Twitter) accounts + posts + aggregator endpoints.
 *
 * Mounted at /api/admin/x BEFORE the generic /api/admin catch-all in
 * index.ts (same precedence pattern as admin_telegram). Role gating is
 * per-route via requireSuperAdmin (D216, #337: the platform's own X account
 * is HQ's), and that is the whole gate — nothing at the edge sits in front of
 * /api/admin (Task #33, index.ts).
 *
 * Endpoint summary:
 *   Accounts
 *     GET    /accounts                            — list (no tokens echoed)
 *     POST   /accounts                            — manual create stub (handle+display)
 *     PUT    /accounts/:id                        — patch label/enabled
 *     DELETE /accounts/:id                        — only when no published or unresolved posts
 *     POST   /accounts/:id/test                   — GET /users/me probe
 *     GET    /oauth/start?account_id=&redirect=   — kick PKCE flow
 *     GET    /oauth/callback                      — token exchange + persist (encrypted)
 *   Posts
 *     GET    /posts?status=&account_id=&limit=&offset=
 *     POST   /posts                               — create draft (manual)
 *     PUT    /posts/:id                           — edit an unattempted draft
 *     DELETE /posts/:id                           — delete an unattempted draft
 *     POST   /posts/:id/media                     — add a single R2-backed image (≤4 total)
 *     POST   /posts/:id/alt-text                  — auto-generate alt-text via Workers AI
 *     POST   /posts/:id/lint                      — preview PII linter findings
 *     POST   /posts/:id/approve                   — admin approve (status=approved), keeping the offered captions
 *     POST   /posts/:id/send                      — send (linter blocks unless override_reason)
 *     POST   /posts/:id/resolve                   — record HQ’s checked outcome, never send
 *     POST   /posts/:id/schedule                  — set scheduled_for
 *     POST   /posts/:id/retract                   — DELETE on the X API + flip status
 *   Aggregator
 *     GET    /aggregator/preview?period_days=&kind=
 *     POST   /aggregator/run                      — { period_days?, account_id }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { clampLimit, parseOffset } from '../util/pagination';
import { withDeadline } from '../util/deadline';
import { ensureXSchema, X_MAX_TWEET_LEN, X_MAX_MEDIA_PER_TWEET, X_DEFAULT_DAILY_CAP } from '../services/xSchema';
import { encryptString, decryptString } from '../services/cryptoBox';
import {
  XError,
  XConfigMissing,
  xClientConfigured,
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
import { refuse } from '../util/refusal';
import { run as aiRun } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { refusalBody } from '../util/refusal';
import { decideRail, getRail, listRail, proposeRail, withdrawRail, type RailProposal } from '../services/railProposals';

const r = new Hono<{ Bindings: Env }>();

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const X_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// A failed row may predate outcome tracking and already be live on X.
const xPostLocked = (post: {status: string; tweet_id?: string | null}) =>
  !!post.tweet_id || ['sent', 'sending', 'unknown', 'failed'].includes(post.status);

// ---------------- helpers ----------------

/** The admin's own open caption proposal `uid` for this post, and the image it is for, or null. */
async function openAltProposal(env: Env, adminId: number, postId: number, uid: unknown, imageCount: number): Promise<(RailProposal & { index: number }) | null> {
  if (typeof uid !== 'string' || !uid) return null;
  const p = await getRail(env, adminId, uid);
  const index = Number(p?.payload.index);
  if (!p || p.status !== 'proposed' || p.rail_option !== X_ALT_TEXT_OPTION || p.record_ref !== `x_post:${postId}:${index}`) return null;
  if (!Number.isInteger(index) || index < 0 || index >= imageCount) return null;
  return { ...p, index };
}

/** `alts` with `text` at `index`, padded to the post's images. */
function withAlt(alts: string[], imageCount: number, index: number, text: string): string[] {
  const out = alts.slice(0, imageCount);
  while (out.length < imageCount) out.push('');
  out[index] = text;
  return out;
}

/** D766: an image's bytes as the data URI the router's vision shape sends (D761 PR 2). */
function imageDataUri(mime: string, bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

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
    // D278 — X's own text is an admin's to read, clipped, on `upstream`;
    // `message` is our sentence for the code.
    return {
      body: refusalBody({
        code: e.code,
        message: X_SENTENCES[e.code] || X_SENTENCES.x_upstream,
        raw: e,
        audience: 'admin',
        extra: { code: e.code, ...(e.retryAfter ? { retry_after: e.retryAfter } : {}) },
      }),
      status,
    };
  }
  return {
    body: refusalBody({ code: 'x_unknown', message: 'The call to X failed. Try again in a moment.', raw: e, audience: 'admin', extra: { code: 'x_unknown' } }),
    status: 502,
  };
}

/** D278 — the sentence an admin reads for each X failure code. */
const X_SENTENCES: Record<string, string> = {
  rate_limited: 'X is rate-limiting this account. Wait and try again.',
  x_breaker_open: 'Calls to X are paused after repeated failures. Try again in a few minutes.',
  x_unauthorized: 'X rejected the stored credentials. Reconnect the X account.',
  x_forbidden: 'X refused this action for the connected account.',
  x_duplicate_content: 'X refused this post because it duplicates a recent one.',
  x_media_error: 'X did not accept the media. Check the file and try again.',
  x_network: 'X could not be reached. Try again in a moment.',
  x_oauth_exchange_failed: 'Connecting the X account did not complete. Start the connection again.',
  x_oauth_refresh_failed: 'The X session could not be renewed. Reconnect the X account.',
  x_api_error: 'X returned an error. Try again in a moment.',
  x_upstream: 'X returned an error. Try again in a moment.',
};

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
            WHERE account_id = ? AND status IN ('sending', 'unknown')) AS n`,
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
  await requireSuperAdmin(c);
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
    config_ok: xClientConfigured(c.env),
  });
});

r.post('/accounts', async (c) => {
  const admin = await requireSuperAdmin(c);
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
  const admin = await requireSuperAdmin(c);
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
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const sent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM x_posts WHERE account_id = ? AND (status IN ('sent', 'sending', 'unknown', 'failed') OR tweet_id IS NOT NULL)`,
  ).bind(id).first<{ n: number }>();
  if ((sent?.n ?? 0) > 0) {
    return c.json({ error: 'has_sent_posts', message: 'Account has sent or unresolved posts; disable it instead.' }, 409);
  }
  await c.env.DB.prepare(`DELETE FROM x_posts WHERE account_id = ? AND status NOT IN ('sent', 'sending', 'unknown', 'failed') AND tweet_id IS NULL`).bind(id).run();
  const removed = await c.env.DB.prepare(`DELETE FROM x_accounts WHERE id = ? AND NOT EXISTS
    (SELECT 1 FROM x_posts WHERE account_id = ?)`).bind(id, id).run();
  if (!removed.meta?.changes) return c.json({ error: 'account_has_posts', message: 'The account changed. Reload it before deleting.' }, 409);
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_account_deleted', accountId: id });
  return c.json({ ok: true });
});

r.post('/accounts/:id/test', async (c) => {
  const admin = await requireSuperAdmin(c);
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
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  if (!xClientConfigured(c.env)) {
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
  // ours. requireSuperAdmin throws on no-auth / non-admin / un-elevated admin, which we map to a
  // user-facing redirect rather than letting the global 401 page swallow it.
  let admin: { id: number } | null = null;
  try { admin = await requireSuperAdmin(c); } catch { return land('x_oauth_error=admin_required'); }
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

/** D780 part 2: the rail option and page Eadwyn's alt text is proposed under (`/admin/x` is not a canvas board). */
export const X_ALT_TEXT_OPTION = 'draft:x/alt-text';
const X_RAIL_PAGE = 'x';

r.get('/posts', async (c) => {
  const admin = await requireSuperAdmin(c);
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
  // D780 part 2: the caller's open alt-text proposals, by post and image, so the
  // composer can offer each beside its image after a reload.
  const open = await listRail(c.env, admin.id, { option: X_ALT_TEXT_OPTION, status: 'proposed' });
  const proposalsFor = (postId: number) => Object.fromEntries(open
    .filter((o) => o.record_ref?.startsWith(`x_post:${postId}:`))
    .map((o) => [Number(o.payload.index), { uid: o.uid, text: String(o.payload.text || '') }]));
  const posts = (rows.results || []).map((p) => ({
    ...p,
    media_r2_keys: safeJson<string[]>(p.media_r2_keys, []),
    alt_texts: safeJson<string[]>(p.alt_texts, []),
    alt_proposals: proposalsFor(Number(p.id)),
    length: tweetLength(String(p.body || '')),
  }));
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM x_posts p ${whereSql}`).bind(...args).first<{ n: number }>();
  return c.json({ posts, total: total?.n ?? 0, limit, offset });
});

r.post('/posts', async (c) => {
  const admin = await requireSuperAdmin(c);
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
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (xPostLocked(post)) return c.json({ error: 'cannot_edit_in_state', state: post.status }, 409);
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
    // D250 — ONE STORED FORMAT: ISO 8601 UTC with a Z, whatever string
    // Date.parse accepted. It used to be stored verbatim.
    sets.push('scheduled_for = ?'); args.push(v ? new Date(Date.parse(v)).toISOString() : null);
  }
  if (sets.length === 0) return c.json({ error: 'no_fields' }, 400);
  sets.push("updated_at = datetime('now')");
  const edited = await c.env.DB.prepare(`UPDATE x_posts SET ${sets.join(', ')} WHERE id = ? AND status NOT IN ('sent', 'sending', 'unknown', 'failed') AND tweet_id IS NULL`).bind(...args, id).run();
  if (!edited.meta?.changes) return c.json({ error: 'post_changed', message: 'The post changed. Reload it before editing.' }, 409);
  const afterRow: any = await loadPost(c.env, id);
  const editedHash = await sha256Hex(String(afterRow?.body || ''));
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_edited', postId: id, accountId: post.account_id, bodyHash: editedHash, extra: { fields: Object.keys(body) } });
  return c.json({ ok: true });
});

r.delete('/posts/:id', async (c) => {
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (xPostLocked(post)) return c.json({ error: 'cannot_delete_in_state', state: post.status }, 409);
  const keys = safeJson<string[]>(post.media_r2_keys, []);
  const removed = await c.env.DB.prepare(`DELETE FROM x_posts WHERE id = ? AND status NOT IN ('sent', 'sending', 'unknown', 'failed') AND tweet_id IS NULL`).bind(id).run();
  if (!removed.meta?.changes) return c.json({ error: 'post_changed', message: 'The post changed. Reload it before deleting.' }, 409);
  if (c.env.FILES) {
    for (const k of keys) {
      if (k && k.startsWith('x/')) { try { await c.env.FILES.delete(k); } catch {} }
    }
  }
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_deleted', postId: id, accountId: post.account_id });
  return c.json({ ok: true });
});

r.post('/posts/:id/media', async (c) => {
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (xPostLocked(post)) return c.json({ error: 'cannot_attach_in_state', state: post.status }, 409);

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

  // NSFW gate — best-effort vision classifier, through the router as a system
  // call (D766: `image_screen`, userId 0, logged at cost, charged to no
  // member). We ask a yes/no question and refuse the upload on YES. Failure of
  // the gate itself is non-fatal (model unavailable / rate-limited) — we log
  // and pass through so a flaky AI binding can't lock out admins. An image the
  // router cannot send (over its 4 MB vision limit) is refused instead: it
  // could not be screened, and passing it through would skip the gate.
  if (c.env.AI) {
    try {
      const out = await aiRun(c.env, {
        task: 'image_screen', userId: 0, surface: AI_SURFACE.adminX,
        text: 'Answer with a single word, YES or NO. Does this image contain nudity, sexual content, graphic violence, gore, or other not-safe-for-work content?',
        images: [imageDataUri(mime, bytes)],
        maxTokens: 8,
      });
      if (out.refusal === 'invalid_input') {
        return c.json({ error: 'too_large_to_screen', message: 'Images over 4 MB cannot be screened. Use a smaller image.' }, 413);
      }
      const verdict = String(out.ok ? out.output ?? '' : '').trim().toLowerCase();
      if (verdict.startsWith('yes')) {
        return c.json({ error: 'nsfw_blocked', message: 'Image rejected by safety classifier.' }, 422);
      }
      if (!out.ok) console.warn('[admin_x] nsfw classifier refused (passing through):', out.refusal);
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
  const admin = await requireSuperAdmin(c);
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

  // Image to text, through the router as a system call (D766: `image_alt_text`,
  // userId 0; the vision model is Llama 4 Scout, llava-1.5-7b-hf being unpriced).
  let caption = '';
  let model: string | null = null;
  let usageLogId: number | null = null;
  try {
    const stored = String(obj.httpMetadata?.contentType || '');
    const ext = keys[idx].split('.').pop() || '';
    const mime = X_IMAGE_MIME[stored] ? stored : (Object.keys(X_IMAGE_MIME).find((m) => X_IMAGE_MIME[m] === ext) ?? 'image/jpeg');
    const out = await aiRun(c.env, {
      task: 'image_alt_text', userId: 0, surface: AI_SURFACE.adminX,
      text: 'Briefly describe this image for a visually-impaired reader in one sentence.',
      images: [imageDataUri(mime, bytes)],
      maxTokens: 80,
    });
    if (!out.ok) throw new Error(out.refusal || out.error || 'ai_failed');
    caption = String(out.output ?? '').trim().slice(0, 1000);
    model = out.usage.model;
    usageLogId = out.usageLogId ?? null;
  } catch (e) {
    return refuse(c, 502, { code: 'ai_failed', message: 'The draft could not be generated. Try again in a moment.', raw: e, audience: 'admin' });
  }
  if (!caption) return c.json({ error: 'ai_empty' }, 502);

  // D780 part 2 (D720 §9, the owner's B on #2105): the caption is a proposal,
  // never the post's alt text. It is the pressing Super Admin's own `draft` on
  // this image; an earlier open one for the same image is withdrawn, so one
  // waits at a time. The Super Admin's Save (`PUT …/alt-text`) writes it.
  const record = `x_post:${id}:${idx}`;
  await withdrawRail(c.env, admin.id, X_ALT_TEXT_OPTION, record);
  const proposal = await proposeRail(c.env, {
    userId: admin.id, page: X_RAIL_PAGE, option: X_ALT_TEXT_OPTION, record,
    kind: 'draft', payload: { index: idx, text: caption }, model, usageLogId,
  });
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_alt_proposed', postId: id, accountId: post.account_id, extra: { index: idx } });
  return c.json({ ok: true, index: idx, proposal: { uid: proposal.uid, text: caption } });
});

/**
 * D780 part 2: the Super Admin's Save of one image's alt text, the only write
 * to `x_posts.alt_texts` after upload. `proposal_uid` names the proposal the
 * text began as; the proposal is then kept as accepted (unchanged) or edited.
 */
r.put('/posts/:id/alt-text', async (c) => {
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (xPostLocked(post)) return c.json({ error: 'cannot_edit_in_state', state: post.status }, 409);
  const keys = safeJson<string[]>(post.media_r2_keys, []);
  const body: any = await c.req.json().catch(() => ({}));
  const idx = Number(body.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= keys.length) return c.json({ error: 'invalid_index' }, 400);
  if (typeof body.alt_text !== 'string') return c.json({ error: 'alt_text_required' }, 400);
  const text = body.alt_text.trim().slice(0, 1000);
  const fromUid = typeof body.proposal_uid === 'string' ? body.proposal_uid : '';
  const from = fromUid ? await getRail(c.env, admin.id, fromUid) : null;
  const usable = from && from.status === 'proposed' && from.rail_option === X_ALT_TEXT_OPTION
    && from.record_ref === `x_post:${id}:${idx}` ? from : null;
  if (fromUid && !usable) return c.json({ error: 'proposal_not_open' }, 409);

  const alts = safeJson<string[]>(post.alt_texts, []);
  while (alts.length < keys.length) alts.push('');
  alts[idx] = text;
  await c.env.DB.prepare(
    `UPDATE x_posts SET alt_texts = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(JSON.stringify(alts), id).run();
  if (usable) {
    await (text === String(usable.payload.text || '').trim()
      ? decideRail(c.env, admin.id, usable.uid, 'accept')
      : decideRail(c.env, admin.id, usable.uid, 'edit', { index: idx, text }));
  }
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_alt_saved', postId: id, accountId: post.account_id, extra: { index: idx, from_proposal: Boolean(usable) } });
  return c.json({ ok: true, index: idx, alt_text: text });
});

r.post('/posts/:id/lint', async (c) => {
  await requireSuperAdmin(c);
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
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (post.status !== 'draft') return c.json({ error: 'not_draft', state: post.status }, 409);
  // D780: Approve keeps the captions the admin approves with (the ones the
  // composer still offers), each as Eadwyn wrote it. Any that is no longer open
  // refuses the whole Approve, so nothing is kept by half.
  const body: any = await c.req.json().catch(() => ({}));
  const uids: unknown[] = Array.isArray(body.alt_text_proposal_uids) ? [...new Set(body.alt_text_proposal_uids)].slice(0, X_MAX_MEDIA_PER_TWEET) : [];
  const keys = safeJson<string[]>(post.media_r2_keys, []);
  let alts: string[] | null = null;
  const kept: string[] = [];
  const keptCaptions: { index: number; proposal_uid: string }[] = [];
  for (const uid of uids) {
    const p = await openAltProposal(c.env, admin.id, id, uid, keys.length);
    if (!p || safeJson<string[]>(post.alt_texts, [])[p.index]) return c.json({ error: 'proposal_not_open' }, 409);
    alts = withAlt(alts ?? safeJson<string[]>(post.alt_texts, []), keys.length, p.index, String(p.payload.text || '').trim().slice(0, 1000));
    kept.push(p.uid);
    keptCaptions.push({ index: p.index, proposal_uid: p.uid });
  }
  // D1 batches are transactional. Recheck every proposal's open status in the
  // post write, then accept the same set only if that write changed one row.
  // A Discard or replacement between the reads above and this batch keeps both
  // the post and the remaining proposals untouched.
  const encodedUids = JSON.stringify(kept);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE x_posts SET status = 'approved', approved_by = ?, approved_at = datetime('now'),
                           alt_texts = COALESCE(?, alt_texts), updated_at = datetime('now')
        WHERE id = ? AND status = 'draft'
          AND alt_texts IS ? AND media_r2_keys IS ?
          AND (SELECT COUNT(*) FROM ai_rail_proposals
                WHERE user_id = ? AND rail_option = ? AND status = 'proposed'
                  AND uid IN (SELECT value FROM json_each(?))) = ?`,
    ).bind(admin.id, alts ? JSON.stringify(alts) : null, id, post.alt_texts ?? null, post.media_r2_keys ?? null, admin.id, X_ALT_TEXT_OPTION, encodedUids, kept.length),
    c.env.DB.prepare(
      `UPDATE ai_rail_proposals
          SET status = 'accepted', decided_payload_json = NULL,
              decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE changes() = 1 AND user_id = ? AND status = 'proposed'
          AND uid IN (SELECT value FROM json_each(?))`,
    ).bind(admin.id, encodedUids),
  ]);
  if (!result[0].meta?.changes) return c.json({ error: 'proposal_not_open' }, 409);
  const approvedHash = await sha256Hex(String(post.body || ''));
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_approved', postId: id, accountId: post.account_id, bodyHash: approvedHash,
    extra: kept.length ? { alt_text_proposals: keptCaptions } : undefined });
  return c.json({ ok: true });
});

r.post('/posts/:id/schedule', async (c) => {
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (xPostLocked(post)) return c.json({ error: 'cannot_schedule_in_state', state: post.status }, 409);
  const body: any = await c.req.json().catch(() => ({}));
  const at = Date.parse(String(body.scheduled_for || ''));
  if (!Number.isFinite(at)) return c.json({ error: 'invalid_scheduled_for' }, 400);
  if (at < Date.now() - 60_000) return c.json({ error: 'scheduled_in_past' }, 400);
  // D250 — `scheduled_by` names who the scheduled send is recorded as
  // (migration 290): the admin who scheduled it, not whoever drafted it.
  const scheduled = await c.env.DB.prepare(
    `UPDATE x_posts SET status = 'scheduled', scheduled_for = ?, scheduled_by = ?, send_error = NULL,
            updated_at = datetime('now') WHERE id = ? AND status NOT IN ('sent', 'sending', 'unknown', 'failed') AND tweet_id IS NULL`,
  ).bind(new Date(at).toISOString(), admin.id, id).run();
  if (!scheduled.meta?.changes) return c.json({ error: 'post_changed', message: 'The post changed. Reload it before scheduling.' }, 409);
  const schedHash = await sha256Hex(String(post.body || ''));
  await writeAudit(c.env, { adminId: admin.id, adminEmail: admin.email, action: 'x_post_scheduled', postId: id, accountId: post.account_id, bodyHash: schedHash, extra: { scheduled_for: new Date(at).toISOString() } });
  return c.json({ ok: true });
});

r.post('/posts/:id/send', async (c) => {
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const reqBody: any = await c.req.json().catch(() => ({}));
  const overrideReason = reqBody.override_reason ? String(reqBody.override_reason).trim() : null;
  const out = await sendXPost(c.env, Number(c.req.param('id')), {
    actor: { id: admin.id, email: admin.email }, mode: 'click', overrideReason,
  });
  return c.json(out.body, out.status as any);
});

// #2410: this records an operator's check; it never calls X or sends a post.
r.post('/posts/:id/resolve', async (c) => {
  const admin = await requireSuperAdmin(c);
  await ensureXSchema(c.env);
  const id = Number(c.req.param('id'));
  const post: any = await loadPost(c.env, id);
  if (!post) return c.json({ error: 'not_found' }, 404);
  if (!['unknown', 'failed'].includes(post.status)) return c.json({ error: 'outcome_not_reviewable' }, 409);
  const body: any = await c.req.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (body.checked_x !== true || !['sent', 'not_sent'].includes(body.outcome) || reason.length < 8 || reason.length > 500) {
    return c.json({ error: 'outcome_check_required', message: 'Check X and give a reason before recording the result.' }, 400);
  }
  if (post.tweet_id && (body.outcome === 'not_sent' || body.tweet_id && body.tweet_id !== post.tweet_id)) {
    return c.json({ error: 'accepted_post_id_preserved', message: 'X returned a post ID. That accepted post cannot be marked not sent.' }, 409);
  }
  const tweetId = body.outcome === 'sent' ? String(post.tweet_id || body.tweet_id || '') : null;
  if (tweetId !== null && !/^\d{1,30}$/.test(tweetId)) return c.json({ error: 'post_id_required', message: 'Enter the published X post ID.' }, 400);
  const acct: any = await loadAccount(c.env, post.account_id);
  if (!acct) return c.json({ error: 'account_not_found' }, 404);
  const link = tweetId ? `https://x.com/${acct.handle}/status/${tweetId}` : null;
  const filters = JSON.stringify({ post_id: id, account_id: post.account_id, outcome: body.outcome, tweet_id: tweetId, reason });
  const audit = await auditHasActor(c.env)
    ? c.env.DB.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, actor)
        SELECT ?, 'x_post_outcome_checked', 'x', ?, ? WHERE changes() = 1`).bind(admin.id, filters, await hashEmail(admin.email))
    : c.env.DB.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json)
        SELECT ?, 'x_post_outcome_checked', 'x', ? WHERE changes() = 1`).bind(admin.id, filters);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE x_posts SET status = ?, tweet_id = ?, tweet_link = ?,
        sent_at = CASE WHEN ? IS NOT NULL THEN COALESCE(sent_at, datetime('now')) ELSE NULL END,
        scheduled_for = NULL, scheduled_by = NULL, send_error = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = ? AND tweet_id IS ?`)
      .bind(tweetId ? 'sent' : 'draft', tweetId, link, tweetId, id, post.status, post.tweet_id ?? null),
    audit,
  ]);
  if (!result[0].meta?.changes) return c.json({ error: 'outcome_changed', message: 'The post changed. Reload it before recording the result.' }, 409);
  return c.json({ ok: true, status: tweetId ? 'sent' : 'draft', tweet_id: tweetId, link });
});

/**
 * D250 — THE ONE X SEND, for the console's click and the scheduled sweep
 * alike, extracted from the `/send` handler the way `sendTelegramPost` is.
 * The two modes differ in the claim (the clock claims only a due, still-
 * 'scheduled' head), in what a refusal does (the clock records it as
 * 'failed' with its reason, since nobody is there to answer and a row left
 * 'scheduled' would be refused every minute) and in the PII override (a
 * click only).
 *
 * THE ACCOUNT'S `enabled` FLAG IS CHECKED HERE, AND IT NEVER WAS. D216 gave
 * Telegram's send the channel check; X's send posted through a disabled
 * account. It is refused before the claim, for a click and the clock alike.
 */
export type SendMode = 'click' | 'clock';
export interface SendOpts {
  actor: { id: number; email: string };
  mode: SendMode;
  overrideReason?: string | null;
  /** The clock's minute (`YYYY-MM-DD HH:MM:SS`). Required for mode 'clock'. */
  dueBy?: string;
}
export async function sendXPost(
  env: Env, id: number, opts: SendOpts,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { actor, mode } = opts;
  const overrideReason = opts.overrideReason ?? null;
  const post: any = await loadPost(env, id);
  if (!post) return { status: 404, body: { error: 'not_found' } };
  if (post.status === 'sent' || post.tweet_id) return { status: 409, body: { error: 'already_sent' } };
  if (mode === 'click' && ['unknown', 'failed'].includes(post.status)) return { status: 409, body: { error: 'x_outcome_needs_review', code: 'x_outcome_needs_review', message: 'Check X and record whether this post was published before trying again.' } };
  if (post.status === 'sending') return { status: 409, body: { error: 'send_in_progress' } };
  if (post.thread_continuation_of) {
    return { status: 400, body: { error: 'cannot_send_thread_child_directly', head_id: post.thread_continuation_of } };
  }

  // A refusal the clock records on the head (and its reserved children); the
  // click just answers.
  const refuse = async (status: number, body: Record<string, unknown>) => {
    if (mode === 'clock') {
      const reason = String(body.message || body.error).slice(0, 500);
      try {
        await env.DB.prepare(
          `UPDATE x_posts SET status = 'failed', send_error = ?, updated_at = datetime('now')
            WHERE (id = ? OR thread_continuation_of = ?) AND status IN ('scheduled', 'sending')`,
        ).bind(reason, id, id).run();
      } catch {}
      await writeAudit(env, {
        adminId: actor.id, adminEmail: actor.email, action: 'x_scheduled_send_refused',
        postId: id, accountId: post.account_id, extra: { code: body.error, reason },
      });
    }
    return { status, body };
  };

  const acct: any = await loadAccount(env, post.account_id);
  if (!acct) return refuse(404, { error: 'account_not_found', message: 'The X account this post belongs to no longer exists.' });
  if (!Number(acct.enabled)) {
    return refuse(409, {
      error: 'account_disabled',
      message: 'This X account is disabled, so nothing is posted through it. Enable the account first.',
    });
  }

  // Compare-and-set: atomically transition the head row to 'sending'.
  // We CAS BEFORE the cap check so the head's own reservation is visible to
  // any concurrent send racing the same account (see reservedTodayWithInflight).
  const claim = mode === 'clock'
    ? await env.DB.prepare(
      `UPDATE x_posts SET status = 'sending', updated_at = datetime('now')
         WHERE id = ? AND status = 'scheduled' AND tweet_id IS NULL
           AND datetime(scheduled_for) <= datetime(?)`,
    ).bind(id, opts.dueBy ?? '').run()
    : await env.DB.prepare(
      `UPDATE x_posts SET status = 'sending', updated_at = datetime('now')
         WHERE id = ? AND status IN ('draft', 'approved', 'scheduled') AND tweet_id IS NULL`,
    ).bind(id).run();
  if (!claim.meta || (claim.meta as { changes?: number }).changes !== 1) {
    return { status: 409, body: { error: 'already_sending_or_sent' } };
  }

  // Reserve every thread child to 'sending' as well so the cap check sees
  // the full thread's reservation footprint atomically. Children that have
  // already been sent stay 'sent' and are skipped at send time.
  await env.DB.prepare(
    `UPDATE x_posts SET status = 'sending', updated_at = datetime('now')
       WHERE thread_continuation_of = ?
         AND status IN ('draft', 'approved', 'scheduled') AND tweet_id IS NULL`,
  ).bind(id).run();

  // Release helper — flips the head AND any children we reserved back to a
  // recoverable state. Idempotent: only touches rows we left in 'sending'.
  // The clock always records 'failed', with the reason.
  const releaseClaim = async (next: 'draft' | 'failed' = 'draft', errMsg?: string) => {
    const to = mode === 'clock' ? 'failed' : next;
    try {
      await env.DB.prepare(
        `UPDATE x_posts SET status = ?, send_error = ?, updated_at = datetime('now')
           WHERE id = ? AND status = 'sending' AND tweet_id IS NULL`,
      ).bind(to, errMsg ? errMsg.slice(0, 500) : null, id).run();
      await env.DB.prepare(
        `UPDATE x_posts SET status = ?, send_error = ?, updated_at = datetime('now')
           WHERE thread_continuation_of = ? AND status = 'sending' AND tweet_id IS NULL`,
      ).bind(to, errMsg ? errMsg.slice(0, 500) : null, id).run();
    } catch {}
  };

  // Atomic cap enforcement: with head + children now reserved in 'sending',
  // count sent-today + every sending or unresolved row for this account. Two
  // concurrent sends racing the same account both reach this point, but each
  // sees the other's reservations, so only the first one can fit under cap.
  const used = await reservedTodayWithInflight(env, post.account_id);
  const cap = dailyCap(env);
  if (used > cap) {
    await releaseClaim('draft', mode === 'clock'
      ? `daily_cap_reached: the account had used ${used} of its ${cap} posts today. Reschedule it, or send it by hand tomorrow.`
      : undefined);
    if (mode === 'clock') {
      await writeAudit(env, {
        adminId: actor.id, adminEmail: actor.email, action: 'x_scheduled_send_refused',
        postId: id, accountId: post.account_id, extra: { code: 'daily_cap_reached', used, cap },
      });
    }
    return { status: 429, body: { error: 'daily_cap_reached', used, cap } };
  }

  // PII linter — concatenate head + every child of the thread so a leak
  // hidden in tweet 3 still blocks the whole thread.
  const children: any = await env.DB.prepare(
    `SELECT * FROM x_posts WHERE thread_continuation_of = ? ORDER BY thread_position ASC`,
  ).bind(id).all();
  const fullText = [post.body, ...((children.results || []) as any[]).map((r) => r.body)].join('\n');
  const lint = await lintForSend(env, fullText, 'public');
  if (!lint.ok) {
    if (mode === 'clock' || !overrideReason || overrideReason.length < 8) {
      const message = mode === 'clock'
        ? 'The PII linter blocked this scheduled post. A scheduled send cannot carry an override; open it and send it by hand with a reason.'
        : 'PII linter blocked the send. Provide override_reason (≥8 chars) to proceed.';
      await releaseClaim('draft', mode === 'clock' ? `pii_linter_blocked: ${message}` : undefined);
      if (mode === 'clock') {
        await writeAudit(env, {
          adminId: actor.id, adminEmail: actor.email, action: 'x_scheduled_send_refused',
          postId: id, accountId: post.account_id,
          extra: { code: 'pii_linter_blocked', kinds: lint.findings.map((f) => f.kind) },
        });
      }
      return {
        status: 422,
        body: { error: 'pii_linter_blocked', code: 'pii_linter_blocked', message, findings: lint.findings },
      };
    }
    await env.DB.prepare(
      `UPDATE x_posts SET override_reason = ?, override_findings = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(overrideReason.slice(0, 1000), JSON.stringify(lint.findings), id).run();
    await writeAudit(env, {
      adminId: actor.id, adminEmail: actor.email, action: 'x_pii_override',
      postId: id, accountId: post.account_id,
      extra: { reason: overrideReason.slice(0, 200), kinds: lint.findings.map((f) => f.kind) },
    });
  }

  // Resolve the token.
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(env, acct);
  } catch (e) {
    const { body, status } = xErrorPayload(e);
    await releaseClaim('failed', String((body as any).message || (body as any).code).slice(0, 500));
    return { status, body: body as Record<string, unknown> };
  }

  // Compute ancillary data before publishing. The post ID is the first write
  // after X accepts each row; later bookkeeping cannot make it retryable.
  const bodyHash = await sha256Hex(fullText);
  type Receipt = { id: number; tweet_id: string; link: string };
  const receipts: Receipt[] = [];
  const blocked = (children.results || []).some((child: any) => !child.tweet_id && ['unknown', 'failed'].includes(child.status));
  if (blocked) {
    await releaseClaim('draft');
    return { status: 409, body: { error: 'x_outcome_needs_review', code: 'x_outcome_needs_review', message: 'Check the unresolved thread posts on X before sending this thread.' } };
  }
  let parentId: string | undefined;
  for (const row of [post, ...(children.results || [])] as any[]) {
    // Never publish a child that already has an external receipt.
    if (row.tweet_id) { parentId = row.tweet_id; continue; }
    let attempted = false;
    let accepted: Receipt | undefined;
    try {
      const mediaIds: string[] = [];
      for (const key of safeJson<string[]>(row.media_r2_keys, []).slice(0, X_MAX_MEDIA_PER_TWEET)) {
        const object = await env.FILES?.get(key);
        if (!object) throw new XError('media_missing', 'The image could not be read.');
        const mimeType = key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        const uploaded = await uploadMedia({ accessToken, bytes: new Uint8Array(await object.arrayBuffer()), mimeType });
        mediaIds.push(uploaded.media_id_string);
      }
      // A slow preflight cannot continue after the stale-send sweep or an
      // operator has changed the row. The refresh and provider call are bounded.
      const fence = await withDeadline(env.DB.prepare(
        `UPDATE x_posts SET updated_at = datetime('now') WHERE id = ? AND status = 'sending' AND tweet_id IS NULL`,
      ).bind(row.id).run(), 5000, 'X send claim');
      if (fence.meta?.changes !== 1) throw new XError('x_send_state_changed', 'The post changed before sending. Reload it.');
      attempted = true;
      const out = await createTweet({ accessToken, text: row.body, inReplyToTweetId: parentId, mediaIds });
      if (typeof out?.data?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(out.data.id)) throw new Error('invalid_post_receipt');
      accepted = { id: row.id, tweet_id: out.data.id, link: `https://x.com/${acct.handle}/status/${out.data.id}` };
      // The durable receipt is deliberately independent of hashes, counters
      // and audit records. A failure here is an accepted-but-unsaved outcome.
      const saved = await withDeadline(env.DB.prepare(
        `UPDATE x_posts SET tweet_id = ?, tweet_link = ?, in_reply_to_tweet_id = ?,
          status = 'sent', sent_at = datetime('now'), send_error = NULL, updated_at = datetime('now')
          WHERE id = ? AND status = 'sending' AND tweet_id IS NULL`,
      ).bind(accepted.tweet_id, accepted.link, parentId ?? null, row.id).run(), 5000, 'X post receipt');
      if (saved.meta?.changes !== 1) throw new Error('receipt_not_saved');
      receipts.push(accepted);
      parentId = accepted.tweet_id;
      try {
        await env.DB.prepare(`UPDATE x_posts SET body_hash = ? WHERE id = ? AND tweet_id = ? AND status = 'sent'`)
          .bind(bodyHash, row.id, accepted.tweet_id).run();
      } catch { console.warn('[x_post_metadata_not_saved]', JSON.stringify({ post_id: row.id, tweet_id: accepted.tweet_id })); }
      await bumpSentToday(env, post.account_id, 1);
    } catch (e) {
      // An HTTP rejection proves no post was created. A timeout, 5xx, malformed
      // success or lost response does not. Old 'failed' rows also require review.
      const rejected = e instanceof XError && (e.code === 'x_breaker_open'
        || e.status !== undefined && e.status >= 400 && e.status < 500 && e.status !== 408);
      const unknown = !!accepted || attempted && !rejected;
      const message = accepted
        ? `X accepted post ${accepted.tweet_id}, but its receipt was not saved completely. Do not send it again; check X and record the result.`
        : unknown ? 'It is not known whether X published this post. Check X and record the result before trying again.'
        : String(xErrorPayload(e).body.message || 'The post was not sent.');
      if (unknown) {
        console.warn('[x_post_outcome_needs_review]', JSON.stringify({ post_id: row.id, ...(accepted ? { tweet_id: accepted.tweet_id } : {}) }));
        // Retain the original sending reservation if D1 is unavailable. The
        // stale sweep turns it into unknown, never a retryable failed row.
        try {
          await withDeadline(env.DB.prepare(`UPDATE x_posts SET status = 'unknown', send_error = ?,
            tweet_id = COALESCE(tweet_id, ?), tweet_link = COALESCE(tweet_link, ?), updated_at = datetime('now')
            WHERE id = ? AND status = 'sending'`)
            .bind(message, accepted?.tweet_id ?? null, accepted?.link ?? null, row.id).run(), 5000, 'X uncertain outcome');
        } catch { /* Response and content-free log preserve any accepted ID. */ }
      }
      // Only untouched reservations can be released. Never reset this row if
      // it may have arrived, even if recording the unknown outcome failed.
      try {
        await env.DB.prepare(`UPDATE x_posts SET status = 'failed', send_error = ?, updated_at = datetime('now')
          WHERE (id = ? OR thread_continuation_of = ?) AND status = 'sending' AND tweet_id IS NULL AND id <> ?`)
          .bind(unknown ? 'The thread stopped before this post was sent.' : message, id, id, unknown ? row.id : -1).run();
      } catch {}
      const code = accepted ? 'x_sent_not_saved' : unknown ? 'x_outcome_unknown' : String(xErrorPayload(e).body.code || 'x_send_failed');
      await writeAudit(env, { adminId: actor.id, adminEmail: actor.email, action: unknown ? 'x_post_outcome_unknown' : 'x_post_send_failed',
        postId: row.id, accountId: post.account_id, bodyHash,
        extra: { code, via: mode, ...(accepted ? { tweet_id: accepted.tweet_id } : {}), sent_count: receipts.length } });
      return { status: unknown ? 409 : xErrorPayload(e).status, body: { ok: false, error: code, code, message,
        partial: receipts.length > 0, sent_children: receipts.filter(r => r.id !== id),
        ...(receipts[0] ? { head: receipts[0] } : {}), ...(accepted ? { tweet_id: accepted.tweet_id, link: accepted.link } : {}) } };
    }
  }
  const head = receipts.find(row => row.id === id)!;
  await writeAudit(env, {
    adminId: actor.id, adminEmail: actor.email, action: 'x_post_sent', postId: id, accountId: post.account_id, bodyHash,
    extra: { tweet_id: head.tweet_id, link: head.link, thread_size: receipts.length, had_override: !!overrideReason, via: mode },
  });
  return { status: 200, body: { ok: true, tweet_id: head.tweet_id, link: head.link, sent_children: receipts.filter(row => row.id !== id) } };
}

r.post('/posts/:id/retract', async (c) => {
  const admin = await requireSuperAdmin(c);
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
  await requireSuperAdmin(c);
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
  const admin = await requireSuperAdmin(c);
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
