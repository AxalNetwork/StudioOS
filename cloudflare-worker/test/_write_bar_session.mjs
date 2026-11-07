/**
 * D4703 (#4703) part 3: a session that passes `requireSuperAdminWriteBar` — a
 * TOTP-minted session with a step-up just now — for tests of routes that now
 * take the write bar. `grantWriteBar(db, userId)` makes `user_sessions` if the
 * fixture has none (the baseline's columns), inserts the session and returns
 * its `jti`, which the test puts in the user's token.
 *
 * Only for the user the test means to be acting with the write bar. Tests of
 * a refused write keep using a token without it.
 */
export function grantWriteBar(db, userId, jti = `write-bar-${userId}`) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, jti TEXT NOT NULL UNIQUE,
    user_agent TEXT, ip TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMP,
    factor TEXT, last_step_up_at TIMESTAMP, step_up_due_at TIMESTAMP, assurance_level TEXT)`);
  db.prepare(`INSERT OR IGNORE INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at)
    VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`).run(userId, jti);
  return jti;
}
