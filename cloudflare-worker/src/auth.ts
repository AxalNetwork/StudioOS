import { Context } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { Env, User, JWTPayload } from './types';
import { getSQL } from './db';

const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRY_HOURS = 24;

function getSecretKey(env: Env) {
  return new TextEncoder().encode(env.JWT_SECRET);
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
