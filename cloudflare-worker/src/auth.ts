import type { Context } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { Env, User, JWTPayload } from './types';
import { getSQL } from './db';

const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRY_HOURS = 24;

/**
 * Phase A5 — call this exactly once at the start of every request handler
 * so weak/missing JWT_SECRET fails the whole request, not just the auth
 * paths. Cloudflare Workers do not have a startup hook, so the next-best
 * place is the top of the `fetch` handler in `index.ts`.
 *
 * Dev/preview workers can use shorter secrets for local convenience.
 */
export function assertJwtSecretStrength(env: Env): void {
  // Accept either STUDIOOS_ENV (FastAPI convention) or ENVIRONMENT (the var
  // wrangler.toml actually sets in production). Otherwise the strength check
  // silently no-ops in prod, which defeats the whole guard.
  const envName = (env.STUDIOOS_ENV || env.ENVIRONMENT || 'dev').toLowerCase();
  if (envName !== 'production' && envName !== 'prod' && envName !== 'staging') return;
  const secret = env.JWT_SECRET || '';
  if (!secret) throw new Error(`JWT_SECRET must be set in ${envName}`);
  const len = new TextEncoder().encode(secret).byteLength;
  if (len < 32) {
    throw new Error(`JWT_SECRET must be at least 32 bytes in ${envName}; got ${len} bytes`);
  }
}

/**
 * T9 — SCORING_HMAC_SECRET enforcement.
 *
 * The Epic-5 score-integrity HMAC derives an HKDF domain-separated subkey
 * from JWT_SECRET when SCORING_HMAC_SECRET is unset (see
 * services/scoreIntegrity.ts:deriveScoringKey). That derivation keeps the
 * score-signing key cryptographically independent from the auth-signing key
 * even in dev, but production still requires a DEDICATED secret so the two
 * keys never share a root. Refuse to boot in production unless an explicit
 * SCORING_HMAC_SECRET (≥32 bytes) is provisioned. Dev/preview tolerate the
 * derived fallback but log a one-shot warning so the operator sees it.
 *
 * Provision via:
 *   openssl rand -hex 32 | npx wrangler secret put SCORING_HMAC_SECRET --env=production
 */
let _scoringSecretWarned = false;
export function assertScoringHmacSecret(env: Env): void {
  const envName = (env.STUDIOOS_ENV || env.ENVIRONMENT || 'dev').toLowerCase();
  const isProd = envName === 'production' || envName === 'prod';
  const explicit = env.SCORING_HMAC_SECRET || '';
  if (isProd) {
    const len = explicit ? new TextEncoder().encode(explicit).byteLength : 0;
    if (!explicit) {
      throw new Error(
        'SCORING_HMAC_SECRET is required in production. Provision via ' +
        '`npx wrangler secret put SCORING_HMAC_SECRET --env=production` ' +
        '(generate with `openssl rand -hex 32`).',
      );
    }
    if (len < 32) {
      throw new Error(
        `SCORING_HMAC_SECRET must be at least 32 bytes in production; got ${len} bytes.`,
      );
    }
    return;
  }
  if (!explicit && !_scoringSecretWarned) {
    _scoringSecretWarned = true;
    console.warn(
      '[boot] SCORING_HMAC_SECRET is unset — deriving an HKDF domain-separated ' +
      'subkey from JWT_SECRET for Epic-5 score signing. This is allowed in ' +
      'dev/preview only; production boot will refuse to start without it.',
    );
  }
}

function getSecretKey(env: Env) {
  // Defense in depth: also check here in case a caller bypassed the
  // top-level guard. The `assert` helper is the canonical entry point.
  assertJwtSecretStrength(env);
  return new TextEncoder().encode(env.JWT_SECRET || '');
}

export async function createJWT(
  env: Env,
  userId: number,
  email: string,
  role: string,
  impersonatedBy?: number,
  jti?: string,
) {
  const payload: Record<string, unknown> = {
    user_id: userId,
    email,
    role,
  };
  if (impersonatedBy) payload.impersonated_by = impersonatedBy;
  // Epic 3 — jti binds the token to a row in user_sessions so individual
  // sessions can be revoked from /settings without nuking every device.
  // Optional for back-compat with existing in-flight tokens.
  if (jti) payload.jti = jti;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_HOURS}h`)
    .sign(getSecretKey(env));
}

export async function decodeJWT(env: Env, token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getSecretKey(env), { algorithms: [JWT_ALGORITHM] });
  return payload as unknown as JWTPayload;
}

/**
 * T6 — Read the JWT from either `Authorization: Bearer ...` (legacy / Bearer
 * flow used by impersonation, websocket subprotocols and signed-download
 * URLs) OR the `studioos_auth` httpOnly cookie (cookie flow used by
 * api.js → /api/* calls).
 *
 * Task #4 — When BOTH are present we no longer blindly prefer Bearer. A
 * cross-account session leak was possible: an admin impersonation Bearer
 * lingering in localStorage would override the fresh cookie minted by
 * the next user's sign-in, dropping them into the admin's account.
 * Precedence is now resolved by `pickAuthToken` against the decoded
 * payloads — Bearer only wins when it is the SAME identity as the
 * cookie OR a legitimate impersonation Bearer (impersonated_by ===
 * cookie.user_id). Otherwise the cookie (the freshest sign-in) wins.
 */
export function extractJwtCandidates(c: Context<{ Bindings: Env }>): { bearer: string | null; cookie: string | null } {
  const authHeader = c.req.header('Authorization');
  const bearer = (authHeader && authHeader.startsWith('Bearer ')) ? (authHeader.slice(7) || null) : null;
  let cookie: string | null = null;
  const cookieHeader = c.req.header('Cookie') || '';
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      if (trimmed.slice(0, eq) === 'studioos_auth') {
        cookie = trimmed.slice(eq + 1) || null;
        break;
      }
    }
  }
  return { bearer, cookie };
}

/**
 * Pure, exported for unit tests. Given decoded Bearer + Cookie payloads
 * (or nulls when the slot is empty / undecodable), decide which token's
 * session should authenticate this request.
 *
 *   - Cookie only present                       → 'cookie'
 *   - Bearer only present                       → 'bearer'
 *   - Both present, same user_id                → 'bearer' (back-compat)
 *   - Both present, Bearer is admin impersonating cookie.user_id → 'bearer'
 *   - Both present, identities differ           → 'cookie'  (the fresh sign-in
 *                                                            always wins over a
 *                                                            stale Bearer)
 *   - Neither present                           → null
 */
export type TokenChoice = 'bearer' | 'cookie' | null;
export function pickAuthToken(opts: {
  bearer: { user_id?: number; impersonated_by?: number } | null;
  cookie: { user_id?: number } | null;
}): TokenChoice {
  const { bearer, cookie } = opts;
  if (!bearer && !cookie) return null;
  if (!bearer) return 'cookie';
  if (!cookie) return 'bearer';
  if (bearer.impersonated_by && cookie.user_id && Number(bearer.impersonated_by) === Number(cookie.user_id)) {
    return 'bearer';
  }
  if (bearer.user_id && cookie.user_id && Number(bearer.user_id) === Number(cookie.user_id)) {
    return 'bearer';
  }
  return 'cookie';
}

/**
 * Select and decode the authenticating JWT for this request, applying the
 * cross-identity precedence above. Returns null when neither side decodes.
 * Used by getCurrentUser and requireFactor so both look at the same session.
 */
export async function selectJwt(c: Context<{ Bindings: Env }>): Promise<{ token: string; payload: JWTPayload } | null> {
  const { bearer, cookie } = extractJwtCandidates(c);
  if (!bearer && !cookie) return null;
  let bP: JWTPayload | null = null;
  let cP: JWTPayload | null = null;
  if (bearer) { try { bP = await decodeJWT(c.env, bearer); } catch { bP = null; } }
  if (cookie) { try { cP = await decodeJWT(c.env, cookie); } catch { cP = null; } }
  const choice = pickAuthToken({ bearer: bP as any, cookie: cP as any });
  // Task #4 — audit-log every time we discarded a Bearer in favour of a
  // cookie for a DIFFERENT identity. This is the cross-account leak
  // signal — without the log there's no way to alert on it post-hoc.
  // Fire-and-forget; the auth path must not block on activity_logs.
  if (choice === 'cookie' && bP && cP && Number(bP.user_id) !== Number(cP.user_id)
      && Number(bP.impersonated_by || 0) !== Number(cP.user_id)) {
    try {
      const ctx = (c as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx;
      const p = c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, user_id) VALUES (?, ?, ?)`
      ).bind(
        'cross_session_bearer_discarded',
        JSON.stringify({
          bearer_user_id: Number(bP.user_id),
          cookie_user_id: Number(cP.user_id),
          bearer_impersonated_by: bP.impersonated_by ? Number(bP.impersonated_by) : null,
          path: c.req.path || null,
        }),
        Number(cP.user_id),
      ).run().catch((e: unknown) => console.warn('[auth:selectJwt] audit log failed', e));
      if (ctx?.waitUntil) ctx.waitUntil(p);
    } catch (e) { console.warn('[auth:selectJwt] audit log dispatch failed', e); }
  }
  if (choice === 'bearer' && bearer && bP) return { token: bearer, payload: bP };
  if (choice === 'cookie' && cookie && cP) return { token: cookie, payload: cP };
  // Chosen side failed to decode — fall back to the other if it did.
  if (bearer && bP) return { token: bearer, payload: bP };
  if (cookie && cP) return { token: cookie, payload: cP };
  return null;
}

/**
 * Task #4 — Sign-in handlers call this AFTER authenticating `newUserId` to
 * revoke any incoming Bearer/cookie session that belongs to a DIFFERENT
 * user. Without this, a stale admin JWT in localStorage (or a stale
 * `studioos_auth` cookie still scoped to .axal.vc from a prior browser
 * user) keeps a valid `user_sessions` row that could be replayed from
 * outside the browser even after the SPA's identity-change purge cleared
 * localStorage. Defence-in-depth alongside the `pickAuthToken` precedence
 * fix and the SPA-side purge in useAuthSync.jsx.
 *
 * Idempotent + fire-and-forget-safe: errors are logged, never thrown.
 */
export async function revokeStaleCrossIdentitySession(
  c: Context<{ Bindings: Env }>,
  newUserId: number,
): Promise<void> {
  try {
    const { bearer, cookie } = extractJwtCandidates(c);
    const toks = [bearer, cookie].filter(Boolean) as string[];
    for (const tok of toks) {
      let payload: JWTPayload | null = null;
      try { payload = await decodeJWT(c.env, tok); } catch { continue; }
      if (!payload?.jti || !payload?.user_id) continue;
      if (Number(payload.user_id) === Number(newUserId)) continue;
      try {
        await c.env.DB.prepare(
          "UPDATE user_sessions SET revoked_at = datetime('now') " +
            "WHERE jti = ? AND user_id = ? AND revoked_at IS NULL"
        ).bind(payload.jti, Number(payload.user_id)).run();
        try {
          await c.env.DB.prepare(
            `INSERT INTO activity_logs (action, details, user_id) VALUES (?, ?, ?)`
          ).bind(
            'session_revoked_on_signin',
            JSON.stringify({
              prior_user_id: Number(payload.user_id),
              new_user_id: Number(newUserId),
              jti: payload.jti,
              impersonated_by: payload.impersonated_by ? Number(payload.impersonated_by) : null,
            }),
            Number(newUserId),
          ).run();
        } catch {}
      } catch (e) {
        console.warn('[auth:revokeStaleCrossIdentitySession] revoke failed', e);
      }
    }
  } catch (e) {
    console.warn('[auth:revokeStaleCrossIdentitySession] outer failure', e);
  }
}

export async function getCurrentUser(c: Context<{ Bindings: Env }>): Promise<User | null> {
  const sel = await selectJwt(c);
  if (!sel) return null;
  try {
    const payload = sel.payload;
    const sql = getSQL(c.env);
    const users = await sql`SELECT * FROM users WHERE id = ${payload.user_id}` as unknown as User[];
    await sql.end();
    if (users.length === 0 || !users[0].is_active) return null;
    const u = users[0];
    // MI Pro subscription state lives in the mi_pro_subscriptions side table
    // (the `users` table is at D1's hard 100-column limit, and D1 also rejects
    // any result set wider than 100 columns — so we cannot JOIN it into the
    // SELECT * above). Hydrate it with a small keyed lookup so userHasMiPro()
    // and the MI Pro routes keep reading user.mi_subscription_* unchanged.
    // Best-effort: a missing row/table leaves the user on the free tier.
    try {
      const mi = await c.env.DB.prepare(
        'SELECT status, subscription_id, plan, period_end, stripe_customer_id FROM mi_pro_subscriptions WHERE user_id = ?'
      ).bind(payload.user_id).first<{
        status: string | null; subscription_id: string | null; plan: string | null;
        period_end: string | null; stripe_customer_id: string | null;
      }>();
      const mu = u as User & {
        mi_subscription_status?: string | null; mi_subscription_id?: string | null;
        mi_subscription_plan?: string | null; mi_subscription_period_end?: string | null;
        mi_stripe_customer_id?: string | null;
      };
      mu.mi_subscription_status = mi?.status ?? 'free';
      mu.mi_subscription_id = mi?.subscription_id ?? null;
      mu.mi_subscription_plan = mi?.plan ?? null;
      mu.mi_subscription_period_end = mi?.period_end ?? null;
      mu.mi_stripe_customer_id = mi?.stripe_customer_id ?? null;
    } catch (e) {
      console.warn('[auth] mi_pro_subscriptions hydrate failed', (e as Error).message);
    }
    // Epic 3 — global sign-out: reject tokens issued before users.jwt_min_iat.
    // Normalize ms→s for any legacy ms-based iat values.
    const minIat = u.jwt_min_iat ?? 0;
    let tokenIat = payload.iat;
    if (typeof tokenIat === 'number' && tokenIat > 1e12) {
      tokenIat = Math.floor(tokenIat / 1000);
    }
    if (minIat > 0 && typeof tokenIat === 'number' && tokenIat < minIat) {
      return null;
    }
    // Per-session revocation. Tokens without jti skip (back-compat).
    const tokenJti = payload.jti;
    // Task IB — session-scoped step-up deadline. Captured here so the
    // auto-relock below can prefer it over the prod-broken users column.
    let sessionStepUpDue: string | null = null;
    if (tokenJti) {
      try {
        let sess: { revoked_at: string | null; step_up_due_at?: string | null } | null = null;
        try {
          sess = await c.env.DB.prepare(
            'SELECT revoked_at, step_up_due_at FROM user_sessions WHERE jti = ? AND user_id = ?'
          ).bind(tokenJti, payload.user_id).first<{ revoked_at: string | null; step_up_due_at: string | null }>();
        } catch {
          // step_up_due_at column not migrated yet — fall back to the base check.
          sess = await c.env.DB.prepare(
            'SELECT revoked_at FROM user_sessions WHERE jti = ? AND user_id = ?'
          ).bind(tokenJti, payload.user_id).first<{ revoked_at: string | null }>();
        }
        if (!sess || sess.revoked_at) return null;
        sessionStepUpDue = (sess as any).step_up_due_at ?? null;
        try {
          // T22.6 — Coalesce last_seen_at writes. Only update if the row's
          // existing value is >5 min old. Prevents a write per request on a
          // hot session (which serialises through D1 and inflates write QPS).
          await c.env.DB.prepare(
            "UPDATE user_sessions SET last_seen_at = datetime('now') " +
              "WHERE jti = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now','-5 minutes'))"
          ).bind(tokenJti).run();
        } catch {}
      } catch {
        // user_sessions not migrated yet; rely on iat alone.
      }
    }
    // Task #50 / Task IB — lower-assurance step-up deadline. When a session
    // was minted via the email-magic recovery layer OR the BLOCK-AUTH-01
    // magic-link sign-in ('email_only'), the user has 7 days to re-enrol a
    // strong factor. Once that deadline elapses without re-enrolment, every
    // subsequent request returns 401 EXCEPT the narrow re-enrol surface and
    // the logout endpoint. This is the "auto-relock" enforcement. We prefer
    // the SESSION-scoped deadline (user_sessions.step_up_due_at) because the
    // users.recovery_step_up_due_at column is unapplied/broken in prod (060).
    // NOTE: the relock allowlist below currently exposes ONLY the TOTP re-enrol
    // surface — passkey enrolment (/api/auth/passkey/*) is intentionally not a
    // relock-recovery path yet, so a relocked user recovers via TOTP, then can
    // add a passkey from a fresh full-assurance session.
    const stepUpDue = sessionStepUpDue || ((u as any).recovery_step_up_due_at as string | null);
    if (stepUpDue) {
      let expired = false;
      try { expired = new Date(stepUpDue).getTime() < Date.now(); } catch {}
      if (expired) {
        const path = c.req.path || '';
        // Allow the user to log out + look at /me + complete TOTP re-enrol.
        // Allowlist mirrors actually-mounted routes:
        //   /api/auth/me            — read profile + recovery_pending
        //   /api/auth/logout        — sign out
        //   /api/settings/totp/re-enrol/* — fresh post-recovery TOTP pair
        //                                  (Task #50, doesn't require existing code)
        //   /api/settings/totp/repair      — swap secrets when current code still works
        //   /api/settings/totp/recovery-codes/regenerate — fresh backup codes
        //   /api/settings/sessions  — view + revoke sessions
        //   /api/settings           — read settings root (the SPA mounts the page)
        const ALLOWED = [
          '/api/auth/me', '/api/auth/logout',
          '/api/settings',
          '/api/settings/totp/re-enrol', '/api/settings/totp/re-enrol/start',
          '/api/settings/totp/re-enrol/confirm',
          '/api/settings/totp/repair',
          '/api/settings/totp/recovery-codes/regenerate',
          '/api/settings/sessions',
        ];
        const allowed = ALLOWED.some((p) => path === p || path.startsWith(p + '/'));
        if (!allowed) return null;
      }
    }
    return u;
  } catch {
    return null;
  }
}

export async function requireAuth(c: Context<{ Bindings: Env }>): Promise<User> {
  const user = await getCurrentUser(c);
  if (!user) throw new Error('Unauthorized');
  return user;
}

export async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<User> {
  const user = await requireAuth(c);
  if (user.role !== 'admin') throw new Error('Admin required');
  return user;
}

/**
 * RBAC: ensure the authenticated user has one of the allowed roles.
 * Throws "Forbidden" (mapped to 403 by the global error handler) otherwise.
 * Admin always passes.
 */
export async function requireRole(
  c: Context<{ Bindings: Env }>,
  ...roles: Array<'admin' | 'partner' | 'founder' | 'investor' | 'guest'>
): Promise<User> {
  const user = await requireAuth(c);
  if (user.role === 'admin') return user;
  if (!roles.includes(user.role as any)) throw new Error('Forbidden');
  return user;
}

/**
 * IDOR guard. Returns true if the user is allowed to read/touch a row that
 * belongs to `ownerFounderId`. Admins and partners always pass; founders only
 * pass when the row's founder_id matches their own.
 */
export function canAccessFounderResource(user: User, ownerFounderId: number | null | undefined): boolean {
  // Relationship predicate (was a Phase-0.1 blanket admin/partner/investor
  // bypass — see the 2026-06-25 audit, M2).
  //
  // Admin + partner are studio-wide staff: there is no per-deal assignment
  // model, so they retain broad access by design.
  //
  // INVESTORS get NO access through this predicate. An investor's only path to
  // founder data is the NDA-gated, fail-closed `maskFounderForInvestor` view
  // (projects list/detail, dashboard, private-data). The routes that call THIS
  // predicate (financials, scoring, progress, pipeline, deals, legal docs,
  // studioops) carry NO mask, so letting an investor through leaks unmasked
  // founder data regardless of any NDA — a cross-founder IDOR. The one place an
  // investor still needs a masked fallback, `projects.get('/:id')`, keeps its
  // own `user.role !== 'investor'` branch so the mask below still runs.
  if (user.role === 'admin' || user.role === 'partner') return true;
  if (ownerFounderId == null) return false;
  // Founder role only — and only their own row. Gating on the role (not merely
  // a matching founder_id) means a non-founder principal that happens to carry
  // a residual founder_id (e.g. a founder later converted to an investor) can
  // never bypass into the un-masked data this predicate guards.
  return user.role === 'founder' && !!user.founder_id && user.founder_id === ownerFounderId;
}

/** Phase 0.1 — true iff viewer may see capital / LP / fund cashflow data.
 * Strictly admin or investor. Mirrors `services.access_policy.can_view_lp_data`. */
export function canViewLpData(user: User | null | undefined): boolean {
  return !!user && (user.role === 'admin' || user.role === 'investor');
}

/** Phase 0.1 — true iff viewer may see partner-side demand boards.
 * Strictly admin or partner. */
export function canViewPartnerDemand(user: User | null | undefined): boolean {
  return !!user && (user.role === 'admin' || user.role === 'partner');
}

/**
 * Task #6 — Step-up factor enforcement.
 *
 * `requireFactor(c, 'totp')` resolves the JWT's `jti` to its row in
 * `user_sessions` and asserts the session's `factor` column matches.
 * High-risk routes (admin impersonation, billing checkout/portal, contract
 * void, DD report generation) call this so a session that only authenticated
 * via SMS can never reach them — TOTP is always required for these surfaces
 * regardless of which factors the user has enrolled.
 *
 * Throws 'TOTP required' (mapped to 403 by the global error handler).
 * Sessions whose `factor` is NULL (pre-Task-#6 mint or impersonation Bearer
 * tokens that never created a session row) fail closed: the user must
 * sign back in with TOTP to step up.
 */
export async function requireFactor(
  c: Context<{ Bindings: Env }>,
  factor: 'totp',
): Promise<User> {
  const user = await requireAuth(c);
  // Task #4 — share the same selection logic getCurrentUser used so a stale
  // cross-identity Bearer can't step up via its own jti.
  const sel = await selectJwt(c);
  if (!sel) throw new Error('TOTP required');
  const jti = sel.payload?.jti as string | undefined;
  if (!jti) throw new Error('TOTP required');
  try {
    const row = await c.env.DB.prepare(
      'SELECT factor FROM user_sessions WHERE jti = ? AND user_id = ?'
    ).bind(jti, user.id).first<{ factor: string | null }>();
    if (!row || row.factor !== factor) throw new Error('TOTP required');
  } catch (e) {
    if ((e as Error).message === 'TOTP required') throw e;
    // user_sessions table missing or query failure → fail closed.
    throw new Error('TOTP required');
  }
  return user;
}

// ─────────────────────────────────────── BLOCK-AUTH-03 — step-up auth ──
export const STEP_UP_TTL_MINUTES = 15;

/** Parse a SQLite/D1 timestamp. CURRENT_TIMESTAMP is 'YYYY-MM-DD HH:MM:SS'
 *  (UTC, no zone); ISO strings already carry T/Z. Returns NaN on failure. */
function parseSqlTs(s: string | null | undefined): number {
  if (!s) return NaN;
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  return Date.parse(iso);
}

/**
 * Task IB (BLOCK-AUTH-03) — step-up auth. Stricter than requireFactor: the
 * session must have been minted via a STRONG factor (TOTP or passkey) AND that
 * factor (or an explicit POST /api/auth/step-up) must be RECENT (within
 * ttlMinutes). Otherwise throws 'step_up_required' (mapped to 403
 * {code:'step_up_required', ttl_minutes}) so the SPA can prompt for a fresh
 * TOTP and retry. SMS / recovery-code / magic-link / google sessions can never
 * satisfy step-up.
 */
export async function requireStepUp(
  c: Context<{ Bindings: Env }>,
  ttlMinutes: number = STEP_UP_TTL_MINUTES,
): Promise<User> {
  const user = await requireAuth(c);
  const deny = (): never => {
    const e: any = new Error('step_up_required');
    e.ttlMinutes = ttlMinutes;
    throw e;
  };
  const sel = await selectJwt(c);
  const jti = sel?.payload?.jti as string | undefined;
  if (!jti) deny();

  let row: { factor: string | null; created_at: string | null; last_step_up_at?: string | null } | null = null;
  try {
    row = await c.env.DB.prepare(
      'SELECT factor, created_at, last_step_up_at FROM user_sessions WHERE jti = ? AND user_id = ?'
    ).bind(jti, user.id).first<{ factor: string | null; created_at: string | null; last_step_up_at: string | null }>();
  } catch {
    // last_step_up_at column not migrated yet — fall back to factor+created_at.
    try {
      row = await c.env.DB.prepare(
        'SELECT factor, created_at FROM user_sessions WHERE jti = ? AND user_id = ?'
      ).bind(jti, user.id).first<{ factor: string | null; created_at: string | null }>();
    } catch { row = null; }
  }
  if (!row) deny();

  const strong = row!.factor === 'totp' || row!.factor === 'passkey';
  const candidates: number[] = [];
  // A fresh strong-factor login counts as a step-up for its first ttl window.
  if (strong) { const t = parseSqlTs(row!.created_at); if (!Number.isNaN(t)) candidates.push(t); }
  // An explicit /step-up always counts, regardless of the original factor.
  const stamped = parseSqlTs(row!.last_step_up_at);
  if (!Number.isNaN(stamped)) candidates.push(stamped);

  const mostRecent = candidates.length ? Math.max(...candidates) : 0;
  if (!mostRecent || Date.now() - mostRecent > ttlMinutes * 60 * 1000) deny();
  return user;
}

/**
 * NICE-AUTH-04 — sign-out-everywhere primitive. Bumps users.jwt_min_iat so
 * every JWT issued at or before now is rejected on its next request (see the
 * minIat check in getCurrentUser). Returns the new epoch-seconds floor. Shared
 * by POST /api/auth/sign-out-everywhere and POST /api/settings/sessions/revoke-all.
 */
export async function bumpJwtMinIat(env: Env, userId: number): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000) + 1;
  await env.DB.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = ?').bind(nowSec, userId).run();
  return nowSec;
}

export async function requireApprovedKyc(c: Context<{ Bindings: Env }>): Promise<User> {
  const user = await requireAuth(c);
  // Task #2 — KYC is investor-only. Admins always bypass (for support);
  // founders, partners, and advisors are never required to complete KYC
  // and pass through. Only investors must be approved before reaching
  // gated capital / deal-flow / signing endpoints.
  if (user.role === 'admin') return user;
  if (user.role !== 'investor') return user;
  if ((user as any).kyc_status === 'approved') return user;
  throw new Error('KYC required');
}

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * T6 — cookie helpers for the httpOnly auth migration.
 *
 * `studioos_auth` carries the JWT and is HttpOnly so XSS can't read it.
 * `studioos_csrf` is a separate, JS-readable random token for the
 * double-submit CSRF check (see middleware/csrf.ts). SameSite=Lax keeps
 * top-level navigations working (email verification links, OAuth returns)
 * while still blocking cross-site form POST attacks. Secure means it's only
 * ever sent over HTTPS — fine in production (axal.vc is HTTPS-only); the
 * dev backend (FastAPI on localhost) doesn't issue or check these cookies.
 */
const AUTH_COOKIE_TTL = JWT_EXPIRY_HOURS * 3600;

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Derive the cookie Domain attribute from the request host so a session
// set by `app.axal.vc/api/auth/*` is also valid when the SPA loads on the
// apex (`axal.vc/dashboard`, etc). Leaf-host scoping (the old default)
// would log users out the moment they navigated between the two hosts.
// Dev/preview (localhost / *.workers.dev) deliberately omits Domain so
// host-only cookies still work.
function authCookieDomainAttr(c: Context<{ Bindings: Env }>): string {
  const host = (c.req.header('host') || '').toLowerCase();
  // Localhost / preview workers — host-only cookies (no cross-host issue)
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.workers.dev')) {
    return '';
  }
  // Derive registrable parent domain: app.axal.vc → .axal.vc
  const parts = host.split('.');
  if (parts.length >= 2) {
    return `; Domain=.${parts.slice(-2).join('.')}`;
  }
  return '';
}

export function setAuthCookies(c: Context<{ Bindings: Env }>, jwt: string, csrf: string): void {
  const dom = authCookieDomainAttr(c);
  const common = `Secure; SameSite=Lax; Path=/${dom}; Max-Age=${AUTH_COOKIE_TTL}`;
  c.header('Set-Cookie', `studioos_auth=${jwt}; HttpOnly; ${common}`, { append: true });
  c.header('Set-Cookie', `studioos_csrf=${csrf}; ${common}`, { append: true });
}

export function clearAuthCookies(c: Context<{ Bindings: Env }>): void {
  const dom = authCookieDomainAttr(c);
  // Clear with the derived Domain attribute (matches what we now set)
  // AND without it, so any legacy host-only cookie issued before this
  // change still gets cleaned up on logout. Two Set-Cookie headers per
  // cookie is the standard pattern for cookie-domain migrations.
  c.header('Set-Cookie', `studioos_auth=; HttpOnly; Secure; SameSite=Lax; Path=/${dom}; Max-Age=0`, { append: true });
  c.header('Set-Cookie', `studioos_csrf=; Secure; SameSite=Lax; Path=/${dom}; Max-Age=0`, { append: true });
  if (dom) {
    c.header('Set-Cookie', 'studioos_auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0', { append: true });
    c.header('Set-Cookie', 'studioos_csrf=; Secure; SameSite=Lax; Path=/; Max-Age=0', { append: true });
  }
}

export function generateToken(): string {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(36)).join('').slice(0, 48);
}
