-- #4654 (Email audit 2/6) — a mailbox's connect, verify, reconnect and disconnect resolve to one state.
--
-- `lifecycle_rev` counts the changes a member makes to a mailbox's connection: a connect or reconnect
-- and a disconnect each add one. A provider operation (verify, send, a thread read) reads the row, calls
-- the provider, and may then write the mailbox's credentials or status only while the revision is the one
-- it read. A completion that arrives after the member disconnected or reconnected finds a different
-- revision and changes nothing, whether it succeeded or failed.
--
-- `connect_started_at` is when the connection now holding the row was STARTED (an OAuth connect: when its
-- one-use state was issued), and `disconnected_at` when the member last disconnected it. A connection
-- completing later is applied only if it was started after the disconnect and not before the connection
-- already on the row: an older connect never reactivates a disconnected mailbox or replaces a newer one.
--
-- `mail_nonces.issued_at` is the start time an OAuth state carries to its callback.
--
-- A member has ONE row per provider and normalized address (the unique index at the end). Existing
-- duplicates are merged first: the survivor is the active row with credentials, else the newest that is
-- not revoked, else the newest; the others' sent rows move to it (history kept) and the others are
-- removed. A removed duplicate's sealed credentials go with it; nothing here can revoke a token at the
-- provider, so a member who connected the same mailbox twice may want to remove the app's access in the
-- provider's own settings.
ALTER TABLE mail_accounts ADD COLUMN lifecycle_rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mail_accounts ADD COLUMN connect_started_at TEXT;
ALTER TABLE mail_accounts ADD COLUMN disconnected_at TEXT;
ALTER TABLE mail_nonces ADD COLUMN issued_at TEXT;

UPDATE mail_sent
   SET account_id = (
     SELECT s.id FROM mail_accounts s, mail_accounts o
      WHERE o.id = mail_sent.account_id
        AND s.user_id = o.user_id AND s.provider = o.provider AND lower(s.address) = lower(o.address)
      ORDER BY (s.status = 'active' AND s.credentials IS NOT NULL) DESC, (s.status <> 'revoked') DESC, s.id DESC
      LIMIT 1)
 WHERE account_id IN (
   SELECT o.id FROM mail_accounts o
    WHERE o.id <> (
      SELECT s.id FROM mail_accounts s
       WHERE s.user_id = o.user_id AND s.provider = o.provider AND lower(s.address) = lower(o.address)
       ORDER BY (s.status = 'active' AND s.credentials IS NOT NULL) DESC, (s.status <> 'revoked') DESC, s.id DESC
       LIMIT 1));

DELETE FROM mail_accounts
 WHERE id <> (
   SELECT s.id FROM mail_accounts s
    WHERE s.user_id = mail_accounts.user_id AND s.provider = mail_accounts.provider AND lower(s.address) = lower(mail_accounts.address)
    ORDER BY (s.status = 'active' AND s.credentials IS NOT NULL) DESC, (s.status <> 'revoked') DESC, s.id DESC
    LIMIT 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_accounts_identity ON mail_accounts(user_id, provider, lower(address));
