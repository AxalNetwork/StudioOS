-- #4684 (Practice audit 1/6): who a sent work product went to, and who
-- recorded each receipt, fixed at the moment it happened.
--
-- Until now a client's read of a sent version, and their open and sign-off,
-- were authorised through the engagement's CURRENT client
-- (`advisor_engagements.founder_user_id`). Relinking an engagement to another
-- account therefore moved every version already sent: the first client lost
-- it, and the new one saw it, with the first client's receipts on it.
--
--   recipient_user_id      the account the version was sent to. Written once,
--                          by the send, in the same UPDATE as `sent_at`; the
--                          client routes authorise against it alone.
--   opened_by_user_id      the account that recorded the open, written once
--                          with `opened_at`.
--   signed_off_by_user_id  the account that recorded the sign-off, written
--                          once with `signed_off_at`.
--
-- Versions sent before this migration are pinned to the engagement's client as
-- it stands when this runs: the only record of who they went to. Their
-- receipts keep a null actor: who opened them was never recorded, and a guess
-- is not a record.
--
-- The triggers make all three write-once: a set value can never change, so a
-- later relink, or a race between a relink and an open, cannot move a sent
-- version or re-attribute a receipt.
ALTER TABLE advisor_deliverable_versions ADD COLUMN recipient_user_id INTEGER REFERENCES users(id);
ALTER TABLE advisor_deliverable_versions ADD COLUMN opened_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE advisor_deliverable_versions ADD COLUMN signed_off_by_user_id INTEGER REFERENCES users(id);

UPDATE advisor_deliverable_versions
   SET recipient_user_id = (
         SELECT e.founder_user_id
           FROM advisor_deliverables d
           JOIN advisor_engagements e ON e.id = d.engagement_id
          WHERE d.id = advisor_deliverable_versions.deliverable_id)
 WHERE sent_at IS NOT NULL AND recipient_user_id IS NULL;

-- The client's read: what was sent to me.
CREATE INDEX IF NOT EXISTS idx_advisor_deliverable_versions_recipient
  ON advisor_deliverable_versions(recipient_user_id, sent_at DESC);

CREATE TRIGGER IF NOT EXISTS advisor_deliverable_versions_recipient_fixed
BEFORE UPDATE OF recipient_user_id ON advisor_deliverable_versions
WHEN OLD.recipient_user_id IS NOT NULL AND NEW.recipient_user_id IS NOT OLD.recipient_user_id
BEGIN
  SELECT RAISE(ABORT, 'a sent version keeps the recipient it was sent to');
END;

CREATE TRIGGER IF NOT EXISTS advisor_deliverable_versions_opened_by_fixed
BEFORE UPDATE OF opened_by_user_id ON advisor_deliverable_versions
WHEN OLD.opened_by_user_id IS NOT NULL AND NEW.opened_by_user_id IS NOT OLD.opened_by_user_id
BEGIN
  SELECT RAISE(ABORT, 'a receipt keeps the account that recorded it');
END;

CREATE TRIGGER IF NOT EXISTS advisor_deliverable_versions_signed_off_by_fixed
BEFORE UPDATE OF signed_off_by_user_id ON advisor_deliverable_versions
WHEN OLD.signed_off_by_user_id IS NOT NULL AND NEW.signed_off_by_user_id IS NOT OLD.signed_off_by_user_id
BEGIN
  SELECT RAISE(ABORT, 'a sign-off keeps the account that recorded it');
END;
