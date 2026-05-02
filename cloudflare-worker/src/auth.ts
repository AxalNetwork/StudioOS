import { Context } from 'hono';
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
  const envName = ((env as any).STUDIOOS_ENV || (env as any).ENVIRONMENT || 'dev').toLowerCase();
  if (envName !== 'production' && envName !== 'prod' && envName !== 'staging') return;
  const secret = env.JWT_SECRET || '';
  if (!secret) throw new Error(`JWT_SECRET must be set in ${envName}`);
  const len = new TextEncoder().encode(secret).byteLength;
  if (len < 32) {
    throw new Error(`JWT_SECRET must be at least 32 bytes in ${envName}; got ${len} bytes`);
  }
}

function getSecretKey(env: Env) {
  // Defense in depth: also check here in case a caller bypassed the
  // top-level guard. The `assert` helper is the canonical entry point.
  assertJwtSecretStrength(env);
  return new TextEncoder().encode(env.JWT_SECRET || '');
}

export async function createJWT(env: Env, userId: number, email: string, role: string, impersonatedBy?: number) {
  const payload: Record<string, unknown> = {
    user_id: userId,
    email,
    role,
  };
  if (impersonatedBy) payload.impersonated_by = impersonatedBy;

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

export async function getCurrentUser(c: Context<{ Bindings: Env }>): Promise<User | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  try {
    const payload = await decodeJWT(c.env, token);
    const sql = getSQL(c.env);
    const users = await sql`SELECT * FROM users WHERE id = ${payload.user_id}`;
    await sql.end();
    if (users.length === 0 || !users[0].is_active) return null;
    // Epic 3 — sessions/revoke-all and email-change/revoke bump
    // `users.jwt_min_iat`. Reject any token issued before that mark so
    // "Sign out everywhere" is a real invalidation, not a frontend-only
    // gesture. Tokens predating the column return undefined → we accept.
    const minIat = (users[0] as any).jwt_min_iat;
    let tokenIat = (payload as any).iat;
    // jose emits `iat` in seconds (per RFC 7519), but legacy tokens issued
    // before this column existed could in theory carry a ms-based value. If
    // the number looks like ms (greater than 1e12 ≈ year 2001 in s, or year
    // 33658 in s), normalize to seconds before comparison so revocation
    // can never be bypassed by a unit mismatch.
    if (typeof tokenIat === 'number' && tokenIat > 1e12) {
      tokenIat = Math.floor(tokenIat / 1000);
    }
    if (typeof minIat === 'number' && minIat > 0 && typeof tokenIat === 'number' && tokenIat < minIat) {
      return null;
    }
    return users[0] as unknown as User;
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
  if (user.role === 'admin' || user.role === 'partner') return true;
  if (ownerFounderId == null) return false;
  return !!user.founder_id && user.founder_id === ownerFounderId;
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

export function generateToken(): string {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(36)).join('').slice(0, 48);
}
