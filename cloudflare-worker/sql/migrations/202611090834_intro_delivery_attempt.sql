-- 202611090834 — #4604 (D4604): an introduction's delivery attempt.
--
-- `delivery_op_uid` names the send operation (`mail_send_ops.uid`, D4665)
-- that holds the right to deliver this accepted introduction. The Email send
-- claims it before the nonce is spent and before any provider I/O, with one
-- conditional UPDATE: only while the request is accepted and no other
-- operation that is pending, accepted or uncertain holds it. So:
--   - a second composition of the same intro cannot reach the provider while
--     an earlier one is unconfirmed or already delivered;
--   - a delivery the provider accepted but whose record failed is reconciled
--     to `made` from this operation, without sending again;
--   - a refused (or never-admitted) operation releases the claim.
--
-- Nullable, nothing backfilled: a request sent before this migration has no
-- recorded attempt, and none is invented for it.
ALTER TABLE relationship_interactions ADD COLUMN delivery_op_uid TEXT;
CREATE INDEX IF NOT EXISTS idx_relationship_interactions_delivery ON relationship_interactions(delivery_op_uid);
