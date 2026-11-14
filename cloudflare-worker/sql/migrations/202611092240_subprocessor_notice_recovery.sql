-- 202611092240_subprocessor_notice_recovery.sql — D4683 (#4683): a notice
-- delivery that was interrupted is recovered and said to be uncertain, and a
-- failing one stops retrying and says so. Additive: three columns on 584's
-- `subprocessor_notice_deliveries`.
--
-- `outcome` keeps 584's CHECK (sending, sent, failed). An interrupted send is
-- not a fourth stored value: it is a `sending` claim older than the sweep's
-- lease, which the sweep re-claims and the Trust workspace reads as unknown.
--
--   attempts     sends attempted for this subscriber and notice; the sweep
--                stops after a fixed number and the notice needs attention
--   interrupted  how many of those were cut off before their outcome was
--                recorded, so a resend may have reached the inbox twice
--   sent_at      when the provider accepted it, to tell a notice that went
--                out after its notice date from one that went out in time
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

ALTER TABLE subprocessor_notice_deliveries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subprocessor_notice_deliveries ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subprocessor_notice_deliveries ADD COLUMN sent_at TEXT;
