-- D924 (#2720): record send attempts, not delivery, and why a deal was voided.
-- Legacy failures have no recorded cause; do not invent one during backfill.
ALTER TABLE partner_invitations ADD COLUMN last_sent_at TEXT;
ALTER TABLE partner_invitations ADD COLUMN send_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE partner_invitations ADD COLUMN last_send_ok INTEGER CHECK (last_send_ok IN (0, 1));
ALTER TABLE partner_invitations ADD COLUMN last_send_reason TEXT CHECK (last_send_reason IN ('suppressed','not_configured','refused','failed'));
ALTER TABLE partner_deals ADD COLUMN void_reason TEXT CHECK (void_reason IN ('invitation_revoked','link_lapsed','admin_revoked'));

-- logAdminAction writes both stores. Prefer the canonical admin audit entry
-- for the same invitation/action/time, with activity-only entries as fallback.
-- Malformed audit JSON and entries without a recorded boolean are not facts.
WITH sends AS (
  SELECT id, action, exported_at AS sent_at, filters_json AS details, 1 AS source
    FROM admin_audit_log
   WHERE action IN ('partner_invitation_created','partner_invitation_resent')
     AND json_valid(filters_json)
  UNION ALL
  SELECT a.id, a.action, a.created_at, a.details, 0
    FROM activity_logs a
   WHERE a.action IN ('partner_invitation_created','partner_invitation_resent')
     AND json_valid(a.details)
     AND NOT EXISTS (
       SELECT 1 FROM admin_audit_log b
        WHERE b.action = a.action AND datetime(b.exported_at) = datetime(a.created_at)
          AND json_extract(CASE WHEN json_valid(b.filters_json) THEN b.filters_json ELSE '{}' END, '$.invitation_id') = json_extract(a.details, '$.invitation_id')
          AND json_type(CASE WHEN json_valid(b.filters_json) THEN b.filters_json ELSE '{}' END, '$.email_sent') IN ('true','false')
     )
), known AS (
  SELECT *, json_extract(details, '$.invitation_id') AS invitation_id,
         json_extract(details, '$.email_sent') AS ok,
         ROW_NUMBER() OVER (
           PARTITION BY json_extract(details, '$.invitation_id')
           ORDER BY datetime(sent_at) DESC, source DESC, id DESC
         ) AS latest
    FROM sends
   WHERE json_type(details, '$.email_sent') IN ('true','false')
)
UPDATE partner_invitations
   SET last_sent_at = (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', sent_at) FROM known WHERE invitation_id = partner_invitations.id AND latest = 1),
       send_count = MAX(1, (SELECT COUNT(*) FROM known WHERE invitation_id = partner_invitations.id)),
       last_send_ok = (SELECT ok FROM known WHERE invitation_id = partner_invitations.id AND latest = 1)
 WHERE id IN (SELECT invitation_id FROM known);
