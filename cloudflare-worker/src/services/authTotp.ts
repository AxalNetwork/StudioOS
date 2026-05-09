/**
 * Task #33 — Dedicated TOTP secret store.
 *
 * Pre-task #33, TOTP secrets were stored in `users.password_hash` (a
 * historical bug: the column was misused because the legacy schema lacked
 * a TOTP secret column). That meant the secret was indistinguishable from
 * a future bcrypt hash and every read of `password_hash` had to assume it
 * was actually a TOTP secret in base32. It also blocked Task #38 (SMS 2FA),
 * which needs to add a phone-based factor without colliding with the TOTP
 * column.
 *
 * The new `auth_totp` table holds:
 *   - secret_ct        : AES-GCM ciphertext of the base32 TOTP secret
 *                        (AAD = `auth_totp:secret:<user_id>`).
 *   - recovery_hashes  : JSON array of SHA-256 hex hashes (mirror of the
 *                        existing `users.totp_recovery_codes` column;
 *                        kept in lockstep so legacy readers continue to
 *                        work).
 *   - last_used_at     : audit field — last successful TOTP/recovery
 *                        consumption.
 *
 * Migration strategy (lazy, gated on read):
 *   - On every `verifyTotpForLogin` call, if `auth_totp` has no row for the
 *     user but `users.password_hash` looks like a base32 TOTP secret
 *     (length 32, all-uppercase A-Z2-7), copy it into `auth_totp` and
 *     overwrite `users.password_hash` with NULL + set
 *     `password_reset_required = 1`. This drains the legacy storage at
 *     human pace without a big-bang batch.
 *   - New TOTP enrolments (`/api/auth/setup-totp`) write straight to
 *     `auth_totp` and never touch `users.password_hash`.
 */
import type { Env } from '../types';
import { encryptColumn, decryptColumn } from './columnCipher';

const BASE32_RE = /^[A-Z2-7]{16,64}$/;

let migrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS auth_totp (
       user_id INTEGER PRIMARY KEY,
       secret_ct TEXT NOT NULL,
       recovery_hashes TEXT NOT NULL DEFAULT '[]',
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       last_used_at TEXT
     )`,
    // password_reset_required flag — true for users whose legacy
    // password_hash was overwritten with a TOTP secret and must therefore
    // re-establish a real authenticator. Used by the login route to gate
    // them into the recovery flow.
    `ALTER TABLE users ADD COLUMN password_reset_required INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) {
        console.warn('[authTotp] schema stmt skipped:', msg);
      }
    }
  }
  migrated = true;
}

export interface TotpRow {
  secret: string;            // decrypted base32
  recoveryHashes: string[];
  source: 'auth_totp' | 'legacy';
}

/** Persist a freshly-minted TOTP secret + recovery codes to the new table. */
export async function persistNewTotpEnrolment(
  env: Env,
  userId: number,
  secretBase32: string,
  recoveryHashes: string[],
): Promise<void> {
  await ensureSchema(env);
  const ct = await encryptColumn(env, 'auth_totp', 'secret', userId, secretBase32);
  await env.DB.prepare(
    `INSERT INTO auth_totp (user_id, secret_ct, recovery_hashes)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       secret_ct = excluded.secret_ct,
       recovery_hashes = excluded.recovery_hashes,
       created_at = datetime('now')`
  ).bind(userId, ct, JSON.stringify(recoveryHashes)).run();
  // Mirror recovery hashes to the legacy column so existing read paths in
  // settings.ts and the regenerate endpoint keep working unchanged.
  try {
    await env.DB.prepare(
      `UPDATE users SET totp_recovery_codes = ? WHERE id = ?`
    ).bind(JSON.stringify(recoveryHashes), userId).run();
  } catch {}
}

/**
 * Load the TOTP secret + recovery hashes for a user. If the user is on the
 * legacy `users.password_hash` storage AND the value matches a base32
 * pattern, lazily migrate it to `auth_totp` and clear the legacy column.
 * Returns null if the user has no TOTP secret of any kind.
 */
export async function loadTotp(
  env: Env,
  userId: number,
  legacyPasswordHash: string | null | undefined,
  legacyRecoveryHashesJson: string | null | undefined,
): Promise<TotpRow | null> {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT secret_ct, recovery_hashes FROM auth_totp WHERE user_id = ?`
  ).bind(userId).first<{ secret_ct: string; recovery_hashes: string }>();
  if (row) {
    const secret = await decryptColumn(env, 'auth_totp', 'secret', userId, row.secret_ct);
    if (!secret) return null;
    let hashes: string[] = [];
    try { hashes = JSON.parse(row.recovery_hashes || '[]'); } catch {}
    return { secret, recoveryHashes: Array.isArray(hashes) ? hashes : [], source: 'auth_totp' };
  }
  // Legacy path — secret lives in users.password_hash. Migrate on the way out.
  if (!legacyPasswordHash || !BASE32_RE.test(legacyPasswordHash)) return null;
  let legacyHashes: string[] = [];
  try { legacyHashes = JSON.parse(legacyRecoveryHashesJson || '[]'); } catch {}
  if (!Array.isArray(legacyHashes)) legacyHashes = [];
  try {
    const ct = await encryptColumn(env, 'auth_totp', 'secret', userId, legacyPasswordHash);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO auth_totp (user_id, secret_ct, recovery_hashes)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO NOTHING`
      ).bind(userId, ct, JSON.stringify(legacyHashes)),
      // Task #1 — fully decouple TOTP state from `users.password_hash`.
      // The legacy column is now NULLed (so it carries no TOTP secret AND
      // no sentinel that would be mistaken for a credential), and
      // `password_reset_required = 1` is set so the next login surfaces
      // the recovery flow. Auth-factor presence is now derived solely
      // from the `auth_totp` row (see `hasTotpConfigured`).
      env.DB.prepare(`UPDATE users SET password_hash = NULL, password_reset_required = 1 WHERE id = ?`).bind(userId),
    ]);
  } catch (e) {
    console.error('[authTotp] lazy migration failed for user', userId, e);
    // Fall through and serve the secret from the legacy column for this
    // request so login isn't blocked.
  }
  return { secret: legacyPasswordHash, recoveryHashes: legacyHashes, source: 'legacy' };
}

/** Update the recovery_hashes array (after a single-use consumption). */
export async function updateRecoveryHashes(
  env: Env,
  userId: number,
  hashes: string[],
): Promise<void> {
  await ensureSchema(env);
  await env.DB.batch([
    env.DB.prepare(`UPDATE auth_totp SET recovery_hashes = ?, last_used_at = datetime('now') WHERE user_id = ?`)
      .bind(JSON.stringify(hashes), userId),
    env.DB.prepare(`UPDATE users SET totp_recovery_codes = ? WHERE id = ?`)
      .bind(JSON.stringify(hashes), userId),
  ]);
}

export async function markTotpUsed(env: Env, userId: number): Promise<void> {
  try {
    await env.DB.prepare(`UPDATE auth_totp SET last_used_at = datetime('now') WHERE user_id = ?`)
      .bind(userId).run();
  } catch {}
}

/** True iff the user is currently in the legacy storage (for diagnostics). */
export function isLegacyTotpSecret(passwordHash: string | null | undefined): boolean {
  return !!passwordHash && BASE32_RE.test(passwordHash);
}

/**
 * Task #1 — Auth-factor presence check. The canonical source of truth for
 * "does this user have TOTP configured?" is now an `auth_totp` row OR a
 * legacy base32 secret still pending migration in `users.password_hash`.
 * Call sites that previously gated on `!!user.password_hash` should use
 * this helper instead so `password_hash` can be reserved for real
 * credential storage in the future.
 */
export async function hasTotpConfigured(env: Env, userId: number): Promise<boolean> {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM auth_totp WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<{ x: number }>();
  if (row) return true;
  // Legacy fallback — a base32 secret still parked in users.password_hash
  // that hasn't been lazily migrated yet (loadTotp moves it on next login).
  const legacy = await env.DB.prepare(
    `SELECT password_hash FROM users WHERE id = ?`
  ).bind(userId).first<{ password_hash: string | null }>();
  return !!legacy?.password_hash && BASE32_RE.test(legacy.password_hash);
}

/**
 * Task #1 — Hard-delete a user's TOTP enrolment AND any legacy base32
 * secret in `users.password_hash`. Used by the "re-pair TOTP" flow after
 * the new secret is persisted, and by full TOTP disable.
 */
export async function clearTotp(env: Env, userId: number): Promise<void> {
  await ensureSchema(env);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM auth_totp WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`UPDATE users SET password_hash = NULL WHERE id = ?`).bind(userId),
  ]);
}
