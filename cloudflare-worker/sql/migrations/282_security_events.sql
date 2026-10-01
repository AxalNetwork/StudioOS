-- 282 — the auth boundary recorded every success and not one refusal (D200).
--
-- THE DEFECT, measured site by site before this table was written:
--
--   activity_logs holds     user_login, user_login_google, user_login_passkey,
--                           user_login_magic, user_login_sms, turnstile_failed,
--                           session_revoked_on_signin, sessions_revoked_all,
--                           every factor enrolment and every recovery SUCCESS.
--   nothing holds           a refused sign-in (routes/auth.ts /login, four
--                           refusals; /verify-totp; /magic/verify), a refused
--                           SMS challenge (auth_sms.ts), a refused passkey
--                           (auth_passkey.ts, seven refusals), a refused
--                           recovery step (auth_recover.ts, four routes), a
--                           step-up — refused OR granted (/step-up stamps one
--                           column and leaves no trail), or a privileged gate
--                           turning a caller away (requireFactor, requireStepUp
--                           in src/auth.ts).
--   HQ renders              admin_security.ts answered
--                           `security_events: absent('No security_events ledger
--                           exists yet.')` and SecurityPage.jsx drew the zone
--                           the canvas (H23) reserves for it as "Not recorded".
--
-- So the one screen whose subject is security could count sessions and
-- impersonations and could not say whether anybody had been refused at the
-- door today. This table is the ledger H23 draws: `security_events ·
-- append-only · N rows today`.
--
-- WHAT IS RECORDED HERE, AND WHAT DELIBERATELY IS NOT. Refusals and step-ups
-- only — never a sign-in success. activity_logs already holds those, and a
-- second copy of them is the tile-versus-table disagreement D128 ended, one
-- store over: two ledgers that count the same event drift the day one of
-- them misses a write. The service header (services/securityEvents.ts)
-- restates the rule and the test asserts a successful /login leaves this
-- table empty.
--
-- THE SUBJECT IS A HASH, NEVER AN ADDRESS. `subject_key` is
-- util/hashEmail.ts's 16-hex SHA-256 of the lowercased address — the same
-- key rate_limit_logs and the auth blockers already use — so a refused
-- attempt against an address that belongs to nobody never writes that
-- address anywhere. An unknown subject is '' and an unknown network is
-- 'unknown', both NOT NULL, because the UNIQUE tuple below has to be able to
-- collapse them: two NULLs never compare equal in SQLite, and a dedupe key
-- with a NULL in it deduplicates nothing.
--
-- THE WRITE IS BOUNDED BY CONSTRUCTION, because the writer sits on an
-- UNAUTHENTICATED path. `INSERT OR IGNORE` on
-- (kind, factor, outcome, subject_key, ip_prefix, minute) means a burst of
-- refusals inside one minute is ONE row: the ledger records THAT a subject
-- was refused from a network in that minute, not how many times. An attempt
-- counter would need an UPDATE the seal below forbids. `outcome` is in the
-- tuple on purpose — an `ok` step-up after a `refused` one in the same minute
-- is a different fact and must not be dropped as a duplicate. `minute` and
-- `occurred_at` are both taken from SQLite's own 'now' in the one INSERT, so
-- they cannot straddle a boundary. `detail` is NOT in the tuple, also on
-- purpose: the row keeps the reason of the FIRST refusal in that minute, and
-- a later refusal with a different reason from the same subject and network
-- in the same minute is the same row. Keying on the reason would multiply
-- the bound by the number of reasons a factor can refuse for.
--
-- NO FOREIGN KEY ON user_id, on purpose. `REFERENCES users(id) ON DELETE SET
-- NULL` would run an UPDATE on an append-only table, so the seal would abort
-- the user delete — a trap nobody would find until a deletion path exists
-- (there is none today, D168/D189). The column is a plain integer and the
-- reader LEFT JOINs it.
--
-- RETENTION IS 90 DAYS AND IT IS STRUCTURAL. The delete trigger refuses any
-- row younger than the window, so not even a direct statement can shorten the
-- ledger; the nightly sweep (services/securityEvents.ts pruneSecurityEvents)
-- deletes only what the trigger admits. The number lives twice — here and as
-- SECURITY_EVENT_RETENTION_DAYS — and the test slices this file off disk and
-- asserts they agree, the D143 shape.
--
-- D1 REJECTS BEGIN/COMMIT (the #26 lesson). The `BEGIN` under each trigger
-- opens a TRIGGER BODY, which scripts/check-sql-migrations.mjs strips before
-- it looks for statement-leading transaction keywords (migration 269 set the
-- idiom).

CREATE TABLE IF NOT EXISTS security_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- signin   — a credential presented at the door and refused
    -- step_up  — a fresh authenticator check on an existing session,
    --            refused or granted (the only kind with an `ok` row)
    -- gate     — a privileged route turning an authenticated caller away
    -- recovery — a refused account-recovery step
    kind            TEXT NOT NULL
                    CHECK (kind IN ('signin', 'step_up', 'gate', 'recovery')),
    -- the factor or mechanism: totp, magic, sms, passkey, backup_code,
    -- email, trusted_contact, claim, step_up
    factor          TEXT NOT NULL,
    outcome         TEXT NOT NULL
                    CHECK (outcome IN ('ok', 'refused')),
    -- the refusal's own code (unknown_account, invalid_code, session_expired…)
    -- — never free text, never the message a user saw
    detail          TEXT,
    user_id         INTEGER,
    subject_key     TEXT NOT NULL DEFAULT '',
    ip_prefix       TEXT NOT NULL DEFAULT 'unknown',
    branch_code     TEXT NOT NULL DEFAULT 'hq',
    minute          TEXT NOT NULL,
    occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (kind, factor, outcome, subject_key, ip_prefix, minute)
);

-- The ledger, newest first: /governance's fifth read and the "rows today"
-- count both walk this.
CREATE INDEX IF NOT EXISTS idx_security_events_occurred
    ON security_events(occurred_at DESC);

-- "Was this account refused recently?" — the per-subject history a support
-- session would ask for.
CREATE INDEX IF NOT EXISTS idx_security_events_user
    ON security_events(user_id, occurred_at DESC);

-- ---------------------------------------------------------------- the seal
CREATE TRIGGER IF NOT EXISTS security_events_block_update
BEFORE UPDATE ON security_events
BEGIN
    SELECT RAISE(ABORT,
        'security_events is append-only (D200). A refusal already recorded cannot be rewritten; a later outcome is its own row.'
    );
END;

-- A delete is permitted for exactly one reason: the row has aged past the
-- 90-day retention window. Inside the window the ledger cannot be shortened
-- by anyone, including the sweep that prunes it.
CREATE TRIGGER IF NOT EXISTS security_events_seal_delete
BEFORE DELETE ON security_events
WHEN datetime(OLD.occurred_at) >= datetime('now', '-90 days')
BEGIN
    SELECT RAISE(ABORT,
        'security_events keeps 90 days (D200). A row inside the retention window cannot be deleted; the nightly sweep removes rows once they age out.'
    );
END;
