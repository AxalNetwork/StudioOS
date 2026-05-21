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
 * The Epic-5 score-integrity HMAC silently falls back to JWT_SECRET when
 * SCORING_HMAC_SECRET is unset (see services/scoreIntegrity.ts:hmacKey).
 * That fallback is fine for local dev convenience but in production it
 * collides the score-signing key with the auth-signing key — a JWT_SECRET
 * leak would also forge signed scores. Refuse to boot in production unless
 * an explicit SCORING_HMAC_SECRET (≥32 bytes) is provisioned. Dev/preview
 * still tolerate the fallback but log a one-shot warning so the operator
 * sees it during smoke tests.
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
      '[boot] SCORING_HMAC_SECRET is unset — falling back to JWT_SECRET for ' +
      'Epic-5 score signing. This is allowed in dev/preview only; production ' +
      'boot will refuse to start without it.',
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
 * api.js → /api/* calls). Bearer takes precedence so that an admin who is
 * impersonating a user (Bearer token in localStorage) overrides their own
 * still-valid cookie session in the background.
 */
function extractJwt(c: Context<{ Bindings: Env }>): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookieHeader = c.req.header('Cookie') || '';
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === 'studioos_auth') {
      return trimmed.slice(eq + 1) || null;
    }
  }
  return null;
}

export async function getCurrentUser(c: Context<{ Bindings: Env }>): Promise<User | null> {
  const token = extractJwt(c);
  if (!token) return null;
  try {
    const payload = await decodeJWT(c.env, token);
    const sql = getSQL(c.env);
    const users = await sql`SELECT * FROM users WHERE id = ${payload.user_id}` as unknown as User[];
    await sql.end();
    if (users.length === 0 || !users[0].is_active) return null;
    const u = users[0];
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
    if (tokenJti) {
      try {
        const sess = await c.env.DB.prepare(
          'SELECT revoked_at FROM user_sessions WHERE jti = ? AND user_id = ?'
        ).bind(tokenJti, payload.user_id).first<{ revoked_at: string | null }>();
        if (!sess || sess.revoked_at) return null;
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
    // Task #50 — lower-assurance step-up deadline. When a session was
    // minted via the email-magic recovery layer ('email_only'), the user
    // has 7 days to re-enrol TOTP (or a passkey, once shipped). Once
    // that deadline elapses without re-enrolment, every subsequent
    // request returns 401 EXCEPT the narrow re-enrol surface and the
    // logout endpoint. This is the "auto-relock" enforcement.
    const stepUpDue = (u as any).recovery_step_up_due_at as string | null;
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
  // Phase 0.1 split — admin / partner / investor all bypass founder ownership.
  // Tighten in Phase 4 once role-specific predicates ship.
  if (user.role === 'admin' || user.role === 'partner' || user.role === 'investor') return true;
  if (ownerFounderId == null) return false;
  return !!user.founder_id && user.founder_id === ownerFounderId;
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
  const token = extractJwt(c);
  if (!token) throw new Error('TOTP required');
  let jti: string | undefined;
  try { jti = (await decodeJWT(c.env, token))?.jti as string | undefined; } catch {}
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

export async function requireApprovedKyc(c: Context<{ Bindings: Env }>): Promise<User> {
  const user = await requireAuth(c);
  if (user.role === 'admin') return user;
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

export function setAuthCookies(c: Context<{ Bindings: Env }>, jwt: string, csrf: string): void {
  const common = `Secure; SameSite=Lax; Path=/; Max-Age=${AUTH_COOKIE_TTL}`;
  c.header('Set-Cookie', `studioos_auth=${jwt}; HttpOnly; ${common}`, { append: true });
  c.header('Set-Cookie', `studioos_csrf=${csrf}; ${common}`, { append: true });
}

export function clearAuthCookies(c: Context<{ Bindings: Env }>): void {
  c.header('Set-Cookie', 'studioos_auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0', { append: true });
  c.header('Set-Cookie', 'studioos_csrf=; Secure; SameSite=Lax; Path=/; Max-Age=0', { append: true });
}

export function generateToken(): string {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(36)).join('').slice(0, 48);
}
