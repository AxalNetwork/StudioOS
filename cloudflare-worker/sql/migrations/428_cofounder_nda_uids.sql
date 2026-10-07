-- 428 — co-founder NDAs name their signer by uid, never by email (D639, #1396).
--
-- `ensureConnectionWithNdas` titled each NDA "Co-founder Mutual
-- Non-Disclosure Agreement — <email>", and the sign route stored the signer's
-- email in `documents.signed_by`. From D639 both carry the person's uid. These
-- statements rewrite the rows written before that.
--
-- Each NDA is matched to its signer through `cofounder_connections` (side A's
-- document belongs to user_a, side B's to user_b), not by parsing the email
-- out of the title, so a changed email still finds its row. A row whose
-- signer's account is gone gets "a former member" rather than a NULL title
-- (the column is NOT NULL) and a NULL `signed_by` rather than a stale email.
--
-- Re-runnable: each statement only touches rows that still hold an "@".

UPDATE documents
   SET title = 'Co-founder Mutual Non-Disclosure Agreement — ' || COALESCE(
         (SELECT u.uid FROM cofounder_connections cc JOIN users u ON u.id = cc.user_a_id WHERE cc.nda_doc_a_id = documents.id),
         'a former member'),
       updated_at = datetime('now')
 WHERE template_name = 'nda_cofounder'
   AND title LIKE '%@%'
   AND id IN (SELECT nda_doc_a_id FROM cofounder_connections WHERE nda_doc_a_id IS NOT NULL);

UPDATE documents
   SET title = 'Co-founder Mutual Non-Disclosure Agreement — ' || COALESCE(
         (SELECT u.uid FROM cofounder_connections cc JOIN users u ON u.id = cc.user_b_id WHERE cc.nda_doc_b_id = documents.id),
         'a former member'),
       updated_at = datetime('now')
 WHERE template_name = 'nda_cofounder'
   AND title LIKE '%@%'
   AND id IN (SELECT nda_doc_b_id FROM cofounder_connections WHERE nda_doc_b_id IS NOT NULL);

UPDATE documents
   SET signed_by = (SELECT u.uid FROM cofounder_connections cc JOIN users u ON u.id = cc.user_a_id WHERE cc.nda_doc_a_id = documents.id),
       updated_at = datetime('now')
 WHERE template_name = 'nda_cofounder'
   AND signed_by LIKE '%@%'
   AND id IN (SELECT nda_doc_a_id FROM cofounder_connections WHERE nda_doc_a_id IS NOT NULL);

UPDATE documents
   SET signed_by = (SELECT u.uid FROM cofounder_connections cc JOIN users u ON u.id = cc.user_b_id WHERE cc.nda_doc_b_id = documents.id),
       updated_at = datetime('now')
 WHERE template_name = 'nda_cofounder'
   AND signed_by LIKE '%@%'
   AND id IN (SELECT nda_doc_b_id FROM cofounder_connections WHERE nda_doc_b_id IS NOT NULL);
