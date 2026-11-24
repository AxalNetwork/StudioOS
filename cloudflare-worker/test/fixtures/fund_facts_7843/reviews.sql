-- D7843 (#7843) fixture: invented list reviews, in the shape migration 406 writes. Not a migration.
INSERT OR IGNORE INTO research_fund_sources
  (source_name, title, publisher, published_url, terms_status, terms_quote, evidence_url, evidence,
   verdict, verdict_reason, reviewed_on, repo_copy, repo_copy_note)
VALUES
  ('Harbour Lantern Fund Index', 'Harbour Lantern', 'An invented publisher', 'https://list.example/hl', 'not found', NULL, NULL,
   'Invented for a test.', 'cite only', 'Invented for a test.', '2026-11-01', NULL, NULL),
  ('Quill Meadow Investor Notes', 'Quill Meadow', 'An invented publisher', 'https://list.example/qm', 'found', 'Reuse is welcome.',
   'https://list.example/qm/terms', 'Invented for a test.', 'republish allowed', 'Invented for a test.', '2026-11-01', NULL, NULL),
  ('Slate Orchard Fund Sheet', 'Slate Orchard', 'An invented publisher', 'https://list.example/so', 'not found', NULL, NULL,
   'Invented for a test.', 'not allowed', 'Invented for a test.', '2026-11-01', NULL, NULL);
