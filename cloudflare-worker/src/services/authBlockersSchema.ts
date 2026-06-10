/**
 * Task IB — lazy bootstrap for the auth-blockers schema (migration 083).
 *
 * Mirrors ensureTelegramSchema / ensureCalendarOAuthSchema: workers have no
 * startup hook, so we create the magic-link / passkey / WebAuthn-challenge
 * tables (and the step-up columns on user_sessions) on first hit, idempotently.
 * Memoized per isolate so the cold-start cost is paid at most once.
 *
 * Everything here is additive + IF NOT EXISTS, so it is safe to run against a
 * DB where migration 083 has already been applied (and vice-versa).
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureAuthBlockersSchema(env: Env): Promise<void> {
  if (_ready) return;
  const db = env.DB;

  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS magic_link_tokens (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT NOT NULL,
        token_hash  TEXT NOT NULL UNIQUE,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP NOT NULL,
        used_at     TIMESTAMP,
        ip          TEXT,
        user_agent  TEXT
      )`,
    ).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_magic_link_email ON magic_link_tokens(email, created_at DESC)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_magic_link_hash ON magic_link_tokens(token_hash)`).run();
  } catch (e) { console.error('[ensureAuthBlockersSchema] magic_link_tokens', e); }

  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS passkeys (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        public_key    TEXT NOT NULL,
        counter       INTEGER NOT NULL DEFAULT 0,
        transports    TEXT,
        device_type   TEXT,
        backed_up     INTEGER NOT NULL DEFAULT 0,
        aaguid        TEXT,
        name          TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at  TIMESTAMP
      )`,
    ).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_passkeys_cred ON passkeys(credential_id)`).run();
  } catch (e) { console.error('[ensureAuthBlockersSchema] passkeys', e); }

  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge   TEXT NOT NULL UNIQUE,
        user_id     INTEGER,
        kind        TEXT NOT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP NOT NULL,
        used_at     TIMESTAMP
      )`,
    ).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_webauthn_chal ON webauthn_challenges(challenge)`).run();
  } catch (e) { console.error('[ensureAuthBlockersSchema] webauthn_challenges', e); }

  // SQLite/D1 has no ADD COLUMN IF NOT EXISTS — swallow the "duplicate column"
  // error so replays are no-ops. user_sessions is NOT at the ALTER limit.
  for (const ddl of [
    `ALTER TABLE user_sessions ADD COLUMN last_step_up_at TIMESTAMP`,
    `ALTER TABLE user_sessions ADD COLUMN step_up_due_at TIMESTAMP`,
    `ALTER TABLE user_sessions ADD COLUMN assurance_level TEXT`,
  ]) {
    try { await db.prepare(ddl).run(); } catch {}
  }

  _ready = true;
}
