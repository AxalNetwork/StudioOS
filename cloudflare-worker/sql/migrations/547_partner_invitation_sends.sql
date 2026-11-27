-- D924 (#2720): record send attempts, not delivery, and why a deal was voided.
-- Legacy failures have no recorded cause; do not invent one during backfill.
ALTER TABLE partner_invitations ADD COLUMN last_sent_at TEXT;
ALTER TABLE partner_invitations ADD COLUMN send_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE partner_invitations ADD COLUMN last_send_ok INTEGER CHECK (last_send_ok IN (0, 1));
ALTER TABLE partner_invitations ADD COLUMN last_send_reason TEXT CHECK (last_send_reason IN ('suppressed','not_configured','refused','failed'));
ALTER TABLE partner_deals ADD COLUMN void_reason TEXT CHECK (void_reason IN ('invitation_revoked','link_lapsed','admin_revoked'));

-- logAdminAction writes both stores. Prefer the canonical admin audit entry
-- for the same invitation/action/time, with activity-only entries as fallback.
-- Malformed audit JSON cannot identify an attempt. Missing outcomes stay unknown;
-- an invitation itself records its initial attempt, plus each audited resend.
-- Opposite outcomes in the newest second cannot be ordered across two stores;
-- leave that historical last outcome unknown instead of choosing one.
WITH activity_sends AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY action, datetime(created_at), json_extract(details, '$.invitation_id'), json_extract(details, '$.email_sent')
    ORDER BY id
  ) AS occurrence
    FROM activity_logs
   WHERE action IN ('partner_invitation_created','partner_invitation_resent')
     AND json_valid(details)
), sends AS (
  SELECT id, action, exported_at AS sent_at, filters_json AS details, 1 AS source
    FROM admin_audit_log
   WHERE action IN ('partner_invitation_created','partner_invitation_resent')
     AND json_valid(filters_json)
  UNION ALL
  SELECT a.id, a.action, a.created_at, a.details, 0
    FROM activity_sends a
   WHERE a.action IN ('partner_invitation_created','partner_invitation_resent')
     AND json_valid(a.details)
     AND a.occurrence > (
       SELECT COUNT(*) FROM admin_audit_log b
        WHERE b.action = a.action AND datetime(b.exported_at) = datetime(a.created_at)
          AND json_extract(CASE WHEN json_valid(b.filters_json) THEN b.filters_json ELSE '{}' END, '$.invitation_id') = json_extract(a.details, '$.invitation_id')
          AND json_extract(CASE WHEN json_valid(b.filters_json) THEN b.filters_json ELSE '{}' END, '$.email_sent') IS json_extract(a.details, '$.email_sent')
     )
), known AS (
  SELECT *, json_extract(details, '$.invitation_id') AS invitation_id,
         CASE WHEN json_type(details, '$.email_sent') IN ('true','false') THEN json_extract(details, '$.email_sent') ELSE NULL END AS ok,
         ROW_NUMBER() OVER (
           PARTITION BY json_extract(details, '$.invitation_id')
           ORDER BY datetime(sent_at) DESC, source DESC, id DESC
         ) AS latest
    FROM sends
)
UPDATE partner_invitations
   SET last_sent_at = (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', sent_at) FROM known WHERE invitation_id = partner_invitations.id AND latest = 1),
       send_count = 1 + (SELECT COUNT(*) FROM known WHERE invitation_id = partner_invitations.id AND action = 'partner_invitation_resent'),
       last_send_ok = (
         SELECT CASE WHEN COUNT(*) = COUNT(ok) AND COUNT(DISTINCT ok) = 1 THEN MAX(ok) ELSE NULL END
           FROM known
          WHERE invitation_id = partner_invitations.id
            AND datetime(sent_at) = (SELECT MAX(datetime(sent_at)) FROM known WHERE invitation_id = partner_invitations.id)
       )
 WHERE id IN (SELECT invitation_id FROM known);
