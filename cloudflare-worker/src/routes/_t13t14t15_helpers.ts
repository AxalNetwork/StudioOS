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

/** Trim a value to a string, capped at `max`, or null when blank. */
export function trimOrNull(v: unknown, max = 100000): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Normalise a tags input to a JSON-array string, mirroring backend
 * watchlist.py::_normalise_tags: accepts a JSON-array string, a comma-separated
 * string, or an array; trims + drops blanks; caps at 20 entries.
 */
export function normaliseTags(value: unknown): string {
  if (value == null) return '[]';
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((t) => String(t).trim()).filter(Boolean).slice(0, 20));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 20));
      }
    } catch { /* not JSON — fall through to CSV parsing */ }
    return JSON.stringify(value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20));
  }
  return '[]';
}

/** Map auth-helper Errors to JSON responses. Use inside `try {...} catch (e) { return mapError(c, e); }`. */
export function mapError(c: Context<{ Bindings: Env }>, e: any) {
  // A THROWN `Response` IS THE ANSWER, not something to describe.
  //
  // Every status this function can produce is 400, 401 or 403 — it reads a
  // message and picks one. A helper that needs any OTHER status has nowhere to
  // put it, and 404 is the one that matters: an ownership check must answer
  // "not found" rather than "forbidden", because 403 confirms to a non-owner
  // that the row exists. `requireOwnEngagement` and `requireOwnQuote` in
  // `_partner_workspace_helpers.ts` therefore throw the Response itself.
  //
  // Without this line that Response fell through to `String(e?.message || e)`
  // and shipped as a 400 reading `[object Response]` — which is why it is here:
  // `partner_pipeline_stores.test.ts` asserted the 404 and got the 400. No
  // existing caller throws a Response, so nothing else changes.
  if (e instanceof Response) return e;

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
