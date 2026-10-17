-- 471_platform_ip_licences.sql — D707 (#1772): the template catalog lists the
-- two platform IP licences the owner's model needs.
--
-- Axal VC Holdings LLC licenses the software IP platform to Axal VC
-- Management LLC for management administration, and to Axal VC GP LLC for fund
-- administration (D707 decision 1). The catalog has neither: `ip_license`
-- (085) licenses IP to a portfolio company, and
-- `intercompany_ip_services_v1.md` grants Management an exclusive licence that
-- leaves no room for the GP's, so nothing issues it.
--
-- Adds one CATALOG ENTRY per licence to `legal_templates` (084), as 468 did: a
-- stub row with no body (is_stub = 1, body_md = '', merge_fields '[]',
-- version 1, active) in the `gp` layer, the only internal one ("Internal
-- Management (GP Level)"). Counsel writes both bodies; nothing here is legal
-- text. A stub has no store body, and contract publication (D647) skips stubs,
-- so no existing send, preview or usage count changes.
--
-- Both slugs were grepped first across cloudflare-worker/ and frontend/src:
-- neither existed. Each row is inserted only when its slug does not exist yet
-- (WHERE NOT EXISTS, plus OR IGNORE), so a row an admin already created under
-- the same slug is left as it is, and a re-run adds nothing. The slug is the
-- join key for esign_envelopes.document_type and the usage counts (084:14-17).
--
-- Both route to Axal VC Holdings LLC as licensor, by name, in
-- services/legalDocFormat.ts and frontend/src/lib/legalDocFormat.js.
--
-- STANDS ALONE and idempotent under the runner: data only, no BEGIN/COMMIT.

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
SELECT v.column1, v.column2, v.column3, '', '[]', 1, 1, 1
  FROM (VALUES
    ('platform_ip_licence_management_admin', 'Platform IP Licence Agreement — Management Administration', 'gp'),
    ('platform_ip_licence_fund_admin', 'Platform IP Licence Agreement — Fund Administration', 'gp')
  ) AS v
 WHERE NOT EXISTS (SELECT 1 FROM legal_templates t WHERE t.slug = v.column1);
