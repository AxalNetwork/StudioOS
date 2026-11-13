-- 469 — the template store's bodies take the Fund's legal name (D705 part 2, #1717).
--
-- On 2026-10-17 the owner gave the Fund's legal name: "Axal VC Spin-Out Lab
-- Fund I LP" (D705, #1716). Active templates in the store still print the old
-- one, "Axal VC Fund I, LP". In production on 2026-10-17 (read with SELECT only)
-- that was six rows, each at version 1 with no history and no publication:
-- accreditation_v1, investor_nda_axal, mentor_engagement_disclaimer,
-- partner_services, privacy_v1 and tos_v1. This migration covers any active
-- row whose body still holds the old name, not only those six.
--
-- A NEW VERSION, NEVER AN IN-PLACE EDIT. For each such row, exactly as the
-- template editor does before an update (`services/legalTemplateStore.ts`,
-- migration 084):
--   1. the row as it stands is copied into `legal_template_versions`, so a
--      document already signed can still be reproduced from its version;
--   2. each occurrence of the old name in `body_md` is replaced with the legal
--      name, and nothing else in the body changes;
--   3. `version` goes up by 1 and `updated_at` is set.
-- `created_by` on the history row and `updated_by` on the live row are left
-- as they were written: no person made this change.
--
-- RE-RUNNABLE, AND NEVER OVER AN ADMIN'S EDIT. Both statements match only a
-- body that still holds the old text, so a second run changes nothing, and a
-- row an admin has already rewritten without the old name is left alone. The
-- history insert is INSERT OR IGNORE on (template_id, version), as the editor's.
--
-- Terms and Privacy are included: re-acceptance is keyed by obligation
-- (`tos_v1`, `privacy_v1` in `legal_obligations`), never by a template's
-- version or body, so a new version asks no member to accept again (D705
-- part 2, decision 3).
--
-- The files under `src/templates/legal/` get matching `_v2` files (`tos_v3`
-- for the Terms) in the same change; the `_v1` files stay.
--
-- No BEGIN/COMMIT.
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by
  FROM legal_templates
 WHERE is_active = 1 AND instr(body_md, 'Axal VC Fund I, LP') > 0;

UPDATE legal_templates
   SET body_md = replace(body_md, 'Axal VC Fund I, LP', 'Axal VC Spin-Out Lab Fund I LP'),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE is_active = 1 AND instr(body_md, 'Axal VC Fund I, LP') > 0;
