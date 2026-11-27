/**
 * D1312 (#3432, Lovable part 4 of #2398) — a landing-page experiment's own
 * sign-up address. The Lovable app's form posts to it; each sign-up counts in
 * Demand and urgency signals. Only the count is kept: never a name, never an
 * email.
 *
 * THE TOKEN. 32 hex characters, derived from the row's `uid` with the Worker's
 * index secret (`indexHmac`, services/columnCipher.ts). Only its SHA-256 is
 * stored (`lovable_signup_tokens.token_hash`, migration 646); the venture's
 * writers are shown the address again because the Worker can derive it, never
 * because it is stored. A rotated index secret changes every address.
 *
 * THE SIGN-UP. `waitlist_signups` with `source = 'lovable'`, `audience =
 * 'customer'`, an empty email and no `landing_page_id`, so the weekly
 * sign-ups bar counts it (cycleValidate.ts `weeklySignups`). A repeat of the
 * same email on the same address is a no-op: `lovable_signup_seen` keeps a
 * keyed hash of (address, email), which is also the address's count.
 *
 * Nothing here logs a token, an address or an email.
 */
import type { Env } from '../../types';
import { indexHmac } from '../columnCipher';
import { HONEYPOT_FIELD } from '../landingTemplates';

const TABLE = 'lovable_signup_tokens';
export const SIGNUP_PATH = '/api/validate/lovable-signups/';
const TOKEN = /^[0-9a-f]{32}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A row's token, re-derived; never stored. */
export async function tokenFor(env: Env, uid: string): Promise<string> {
  return (await indexHmac(env as never, TABLE, 'token', uid)).slice(0, 32);
}

/** The origin the address is named by: the deployment's public base, else production's apex. */
export function signupOrigin(env: Env): string {
  for (const raw of [(env as unknown as Record<string, unknown>).PUBLIC_BASE_URL, (env as unknown as Record<string, unknown>).APP_URL]) {
    try { if (typeof raw === 'string' && raw.trim()) return new URL(raw).origin; } catch { /* next */ }
  }
  return 'https://axal.vc';
}

export const signupAddress = (env: Env, token: string) => `${signupOrigin(env)}${SIGNUP_PATH}${token}`;

export type SignupView = { live: boolean; uid: string | null; address: string | null; count: number | null; since: string | null };

/**
 * Each experiment's sign-up address, for the From Lovable part. `address` is
 * drawn only for the venture's writers; `count` is null when it could not be
 * read (never a zero for a failed read).
 */
export async function signupViews(env: Env, projectId: number, experimentIds: ReadonlyArray<number>, writer: boolean): Promise<Map<number, SignupView>> {
  const out = new Map<number, SignupView>();
  if (!experimentIds.length) return out;
  const rows = (await env.DB.prepare(
    `SELECT t.id, t.uid, t.experiment_id, t.created_at,
            (SELECT COUNT(*) FROM lovable_signup_seen s WHERE s.token_id = t.id) AS n
       FROM lovable_signup_tokens t WHERE t.project_id = ? AND t.revoked_at IS NULL`,
  ).bind(projectId).all<{ id: number; uid: string; experiment_id: number; created_at: string; n: number }>()).results || [];
  const wanted = new Set(experimentIds.map(Number));
  for (const r of rows) {
    if (!wanted.has(Number(r.experiment_id))) continue;
    out.set(Number(r.experiment_id), {
      live: true, uid: r.uid, address: writer ? signupAddress(env, await tokenFor(env, r.uid)) : null,
      count: Number.isFinite(Number(r.n)) ? Number(r.n) : null, since: r.created_at ?? null,
    });
  }
  return out;
}

/** The live address of one experiment, for the prompt; null when it has none. */
export async function liveAddress(env: Env, projectId: number, experimentId: number): Promise<string | null> {
  const r = await env.DB.prepare('SELECT uid FROM lovable_signup_tokens WHERE project_id = ? AND experiment_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1')
    .bind(projectId, experimentId).first<{ uid: string }>();
  return r ? signupAddress(env, await tokenFor(env, r.uid)) : null;
}

/** Make an experiment's address, turning off any live one first, so one address is live per experiment. */
export async function makeAddress(env: Env, projectId: number, experimentId: number, userId: number): Promise<{ uid: string; address: string }> {
  const uid = crypto.randomUUID();
  const token = await tokenFor(env, uid);
  await env.DB.batch([
    env.DB.prepare("UPDATE lovable_signup_tokens SET revoked_at = datetime('now') WHERE project_id = ? AND experiment_id = ? AND revoked_at IS NULL")
      .bind(projectId, experimentId),
    env.DB.prepare('INSERT INTO lovable_signup_tokens (uid, project_id, experiment_id, token_hash, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(uid, projectId, experimentId, await sha256Hex(token), userId),
  ]);
  return { uid, address: signupAddress(env, token) };
}

/** Turn off an experiment's live address. Sign-ups already counted stay counted. */
export async function turnOffAddress(env: Env, projectId: number, experimentId: number): Promise<number> {
  const r = await env.DB.prepare("UPDATE lovable_signup_tokens SET revoked_at = datetime('now') WHERE project_id = ? AND experiment_id = ? AND revoked_at IS NULL")
    .bind(projectId, experimentId).run();
  return Number(r.meta?.changes ?? 0);
}

/** A form body or a JSON body, as plain fields. Anything else is empty. */
export async function readFields(req: Request): Promise<Record<string, string>> {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  try {
    if (type.includes('application/json')) {
      const j = await req.json() as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j || {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]));
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const f = await req.formData();
      const out: Record<string, string> = {};
      for (const [k, v] of f.entries()) if (typeof v === 'string') out[k] = v;
      return out;
    }
  } catch { /* an unreadable body is an empty one */ }
  return {};
}

export type SignupOutcome = 'counted' | 'duplicate' | 'trap' | 'invalid_email' | 'not_found';

/**
 * One sign-up. The honeypot and a repeat both answer as success, so a bot
 * learns nothing; an unknown or turned-off address is `not_found`.
 */
export async function acceptSignup(env: Env, token: string, fields: Record<string, string>, ip: string | null): Promise<SignupOutcome> {
  if (!TOKEN.test(token)) return 'not_found';
  const row = await env.DB.prepare('SELECT id, project_id FROM lovable_signup_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256Hex(token)).first<{ id: number; project_id: number }>();
  if (!row) return 'not_found';
  const trap = fields[HONEYPOT_FIELD];
  if (typeof trap === 'string' && trap.trim() !== '') return 'trap';
  const email = String(fields.email || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) return 'invalid_email';
  const seen = await indexHmac(env as never, 'lovable_signup_seen', 'email', `${row.id}:${email}`);
  const ipHash = ip ? (await sha256Hex(ip)).slice(0, 32) : null;
  const first = await env.DB.prepare('INSERT OR IGNORE INTO lovable_signup_seen (token_id, email_hmac) VALUES (?, ?)').bind(row.id, seen).run();
  if (!Number(first.meta?.changes ?? 0)) return 'duplicate';
  await env.DB.prepare(`INSERT INTO waitlist_signups (project_id, landing_page_id, email, name, source, audience, ip_hash)
     VALUES (?, NULL, '', NULL, 'lovable', 'customer', ?)`).bind(row.project_id, ipHash).run();
  return 'counted';
}
