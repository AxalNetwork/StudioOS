/**
 * Task #6 — SMS 2FA storage layer.
 *
 * Phone numbers are encrypted at rest via the column cipher (AES-GCM,
 * AAD bound to `auth_sms:phone:<user_id>`). Only the country code and
 * the last 4 digits are stored in the clear so the Settings UI can render
 * "+• ••• •••• 1234 (US)" without a decrypt round-trip.
 *
 * "Does this user have SMS configured?" is derived from the presence of
 * an `auth_sms` row. The `users.tfa_methods` JSON column is the unified
 * factor list maintained alongside it (see `setUserFactor` /
 * `clearUserFactor`).
 */
import type { Env } from '../types';
import { encryptColumn, decryptColumn, last4 } from './columnCipher';

let migrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS auth_sms (
       user_id INTEGER PRIMARY KEY,
       phone_ct TEXT NOT NULL,
       phone_last4 TEXT NOT NULL,
       phone_country TEXT NOT NULL,
       firebase_uid TEXT,
       enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
       last_verified_at TEXT,
       last_used_at TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sms_firebase ON auth_sms(firebase_uid)`,
    `ALTER TABLE users ADD COLUMN tfa_methods TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE user_sessions ADD COLUMN factor TEXT`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) {
        console.warn('[authSms] schema stmt skipped:', msg);
      }
    }
  }
  migrated = true;
}

export interface SmsRow {
  phone: string;       // E.164, decrypted
  last4: string;
  country: string;
  firebaseUid: string | null;
  enrolledAt: string;
  lastVerifiedAt: string | null;
}

/** Persist a freshly-verified SMS enrollment. Idempotent (UPSERT). */
export async function persistSmsEnrollment(
  env: Env,
  userId: number,
  phoneE164: string,
  country: string,
  firebaseUid: string | null,
): Promise<void> {
  await ensureSchema(env);
  const ct = await encryptColumn(env, 'auth_sms', 'phone', userId, phoneE164);
  const tail = last4(phoneE164);
  await env.DB.prepare(
    `INSERT INTO auth_sms (user_id, phone_ct, phone_last4, phone_country, firebase_uid, last_verified_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       phone_ct = excluded.phone_ct,
       phone_last4 = excluded.phone_last4,
       phone_country = excluded.phone_country,
       firebase_uid = excluded.firebase_uid,
       last_verified_at = excluded.last_verified_at`
  ).bind(userId, ct, tail, country.toUpperCase(), firebaseUid).run();
}

export async function loadSms(env: Env, userId: number): Promise<SmsRow | null> {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT phone_ct, phone_last4, phone_country, firebase_uid, enrolled_at, last_verified_at
       FROM auth_sms WHERE user_id = ?`
  ).bind(userId).first<{
    phone_ct: string; phone_last4: string; phone_country: string;
    firebase_uid: string | null; enrolled_at: string; last_verified_at: string | null;
  }>();
  if (!row) return null;
  const phone = await decryptColumn(env, 'auth_sms', 'phone', userId, row.phone_ct);
  if (!phone) return null;
  return {
    phone,
    last4: row.phone_last4,
    country: row.phone_country,
    firebaseUid: row.firebase_uid,
    enrolledAt: row.enrolled_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

export async function hasSmsConfigured(env: Env, userId: number): Promise<boolean> {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM auth_sms WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<{ x: number }>();
  return !!row;
}

export async function clearSms(env: Env, userId: number): Promise<void> {
  await ensureSchema(env);
  await env.DB.prepare(`DELETE FROM auth_sms WHERE user_id = ?`).bind(userId).run();
}

export async function markSmsUsed(env: Env, userId: number): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE auth_sms SET last_used_at = datetime('now') WHERE user_id = ?`
    ).bind(userId).run();
  } catch {}
}

/** Get the unified factor list from users.tfa_methods (always returns an array). */
export async function getUserFactors(env: Env, userId: number): Promise<string[]> {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT tfa_methods FROM users WHERE id = ?`
  ).bind(userId).first<{ tfa_methods: string | null }>();
  if (!row?.tfa_methods) return [];
  try {
    const arr = JSON.parse(row.tfa_methods);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}

export async function setUserFactor(env: Env, userId: number, factor: 'totp' | 'sms'): Promise<void> {
  await ensureSchema(env);
  const current = await getUserFactors(env, userId);
  if (current.includes(factor)) return;
  const next = Array.from(new Set([...current, factor]));
  await env.DB.prepare(`UPDATE users SET tfa_methods = ? WHERE id = ?`)
    .bind(JSON.stringify(next), userId).run();
}

export async function clearUserFactor(env: Env, userId: number, factor: 'totp' | 'sms'): Promise<void> {
  await ensureSchema(env);
  const current = await getUserFactors(env, userId);
  const next = current.filter((f) => f !== factor);
  await env.DB.prepare(`UPDATE users SET tfa_methods = ? WHERE id = ?`)
    .bind(JSON.stringify(next), userId).run();
}

// Country allow-list. Defaults to the jurisdictions the platform routinely
// operates in; can be overridden via SMS_COUNTRY_ALLOWLIST (comma-separated
// ISO-3166 alpha-2). Setting it to "*" disables the gate (testing only).
const DEFAULT_COUNTRY_ALLOWLIST = [
  'US', 'CA', 'GB', 'IE', 'DE', 'FR', 'NL', 'CH', 'LU', 'ES', 'IT', 'SE',
  'NO', 'DK', 'FI', 'EE', 'AE', 'IL', 'IN', 'SG', 'HK', 'JP', 'KR', 'AU',
  'NZ', 'BR', 'MX',
];

export function isCountryAllowed(env: Env, countryAlpha2: string): boolean {
  const cc = (countryAlpha2 || '').toUpperCase();
  if (!cc) return false;
  const raw = (env as { SMS_COUNTRY_ALLOWLIST?: string }).SMS_COUNTRY_ALLOWLIST || '';
  if (raw.trim() === '*') return true;
  const list = raw
    ? raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_COUNTRY_ALLOWLIST;
  return list.includes(cc);
}
