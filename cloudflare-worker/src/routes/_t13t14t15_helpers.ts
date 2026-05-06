/**
 * Shared helpers for T13/T14/T15 ports.
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';

export function role(u: { role: string }): string {
  return (u.role || '').toLowerCase();
}

export function isAdmin(u: User): boolean {
  return role(u) === 'admin';
}

export function isFounder(u: User): boolean {
  return role(u) === 'founder';
}

export function isPartner(u: User): boolean {
  return role(u) === 'partner';
}

export function isInvestor(u: User): boolean {
  return role(u) === 'investor';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Generate a short uid (mirrors FastAPI default uid; shape: hex). */
export function newUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Convenience: bind a list of values into `?,?,?,...` placeholders. */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

/** Safe JSON parse with default. */
export function jload<T>(s: string | null | undefined, def: T): T {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
}

/** Map auth-helper Errors to JSON responses. Use inside `try {...} catch (e) { return mapError(c, e); }`. */
export function mapError(c: Context<{ Bindings: Env }>, e: any) {
  const msg = String(e?.message || e || 'Error');
  const status =
    msg === 'Unauthorized' ? 401 :
    msg === 'Forbidden' || msg === 'Admin required' || msg === 'KYC required' ? 403 :
    400;
  return c.json({ detail: msg }, status as any);
}

/** Resolve a partner row attached to the user (admin can act as a partner only
 *  if `user.partner_id` is set). Mirrors `_require_partner` in FastAPI. */
export async function requirePartnerProfile(env: Env, user: User) {
  if (!(isPartner(user) || isAdmin(user))) {
    throw new Error('Forbidden');
  }
  if (user.partner_id) {
    const row = await env.DB.prepare('SELECT * FROM partners WHERE id = ?')
      .bind(user.partner_id).first<any>();
    if (row) return row;
  }
  const byEmail = await env.DB.prepare('SELECT * FROM partners WHERE email = ?')
    .bind(user.email).first<any>();
  if (byEmail) return byEmail;
  throw new Error('No partner profile attached to your account');
}
