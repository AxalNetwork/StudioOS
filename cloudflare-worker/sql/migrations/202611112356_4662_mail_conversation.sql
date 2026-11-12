-- D4662 (#4662): conversation identity belongs to the sent record, not its editable draft.
ALTER TABLE mail_sent ADD COLUMN person_ref TEXT;

-- Only an existing, same-member draft establishes a historical association.
-- Missing/deleted drafts and manual sends stay explicitly unassociated.
UPDATE mail_sent SET person_ref = (
  SELECT d.person_ref FROM mail_drafts d
  WHERE d.uid = mail_sent.draft_uid AND d.user_id = mail_sent.user_id
) WHERE EXISTS (
  SELECT 1 FROM mail_drafts d
  WHERE d.uid = mail_sent.draft_uid AND d.user_id = mail_sent.user_id
);
CREATE INDEX idx_mail_sent_conversation ON mail_sent(user_id, person_ref, created_at DESC, id DESC);
