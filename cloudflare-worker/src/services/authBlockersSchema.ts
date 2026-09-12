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
 *
 * AND IT IS BOUNDED, because it sits in front of /magic/start. Eleven sequential
 * D1 statements is a cheap bootstrap and an expensive stall: the memo only lands
 * on success, so a D1 that answers slowly (or not at all) made every request
 * re-run all eleven and wait again. Now the whole bootstrap shares one deadline
 * and a cooldown, and sign-in proceeds without it rather than behind it.
 */
import type { Env } from '../types';
import { withDeadline } from '../util/deadline';

// Eleven sequential D1 statements on the most latency-sensitive route in the
// product. On a migrated database every one is a no-op that still costs a round
// trip, so the whole bootstrap gets one budget rather than eleven: past this,
// sign-in proceeds without it.
const BOOTSTRAP_DEADLINE_MS = 3_000;
// ...and once it has blown the budget, stop re-paying it on every request for a
// while. `_ready` is only set on success, so without this a slow D1 makes every
// single request fire all eleven statements again and wait again — the failure
// compounds instead of degrading.
const BOOTSTRAP_COOLDOWN_MS = 60_000;

let _ready = false;
let _skipUntil = 0;

/**
 * Lazily create the auth-blockers tables, WITHOUT letting that hold up a
 * sign-in. Callers must treat this as best-effort: it is a self-healing net for
 * a database where migration 083 was never applied, and on production (where it
 * was) the tables already exist. A route that actually needs one of them still
 * has its own try/catch around the statement that touches it, which is what
 * reports a genuinely missing table — this function's silence never does.
 */
export async function ensureAuthBlockersSchema(env: Env): Promise<void> {
  if (_ready) return;
  if (Date.now() < _skipUntil) return;
  try {
    await withDeadline(bootstrap(env), BOOTSTRAP_DEADLINE_MS, 'authBlockersSchema');
  } catch (e) {
    _skipUntil = Date.now() + BOOTSTRAP_COOLDOWN_MS;
    // Literal format string, value as an argument — Semgrep's
    // unsafe-formatstring rule, and it is right on principle even though this
    // particular value is a module constant: a log line has no reason to build
    // its format from anything but a literal, and the next edit to this call
    // might interpolate something that is not.
    console.error(
      '[ensureAuthBlockersSchema] bootstrap abandoned; skipping for (ms):', BOOTSTRAP_COOLDOWN_MS, e,
    );
  }
}

async function bootstrap(env: Env): Promise<void> {
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
