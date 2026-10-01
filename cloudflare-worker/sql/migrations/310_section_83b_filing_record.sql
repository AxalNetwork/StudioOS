-- 310_section_83b_filing_record.sql — the 83(b) filing record (D361, wave 8,
-- Session 8 item 2).
--
-- The 83(b) Election Tracker canvas draws a filing record: how the election
-- was filed, the tracking number, the IRS service center it went to, when the
-- company acknowledged its copy, and when a copy was attached to the tax
-- return. `section_83b_trackers` stored none of them, so the Lab page printed
-- "Not recorded" for each, and "Mark as filed" stamped the moment of the click
-- as the mailing date (D360 recorded that; this is the fix). Five additive,
-- nullable columns:
--
--   filing_method        TEXT  -- 'certified_mail' | 'private_delivery' | 'irs_online'
--   tracking_number      TEXT  -- as printed on the receipt; charset-checked by the Worker
--   irs_service_center   TEXT  -- free text, capped by the Worker
--   company_ack_at       TEXT  -- YYYY-MM-DD the company acknowledged its copy
--   tax_return_copy_at   TEXT  -- YYYY-MM-DD a copy went with the tax return
--
-- `mailed_at` is unchanged in shape; from D361 the Worker writes it only from a
-- date the founder supplies (PATCH `mailed_on`), never from the clock.
--
-- The Worker (routes/legal_83b.ts) is the only writer's gate: `filing_method`
-- must be one of the three values, dates must be real calendar dates not in the
-- future and not before the grant date, and the text fields are trimmed and
-- capped. Nothing here is a recommendation of a method; it records the one the
-- founder used.
--
-- STANDS ALONE: it depends on no other wave-8 migration. NON-IDEMPOTENT: D1's
-- ALTER TABLE has no IF NOT EXISTS. Apply through the ledger-driven runner,
-- which records the schema_migrations row and runs it exactly once:
--
--   npm run d1:migrate:remote
--
-- The worker self-heals cold isolates via ensureSection83bSchema()
-- (services/section83b.ts), a safety net for these declared columns (D235).

ALTER TABLE section_83b_trackers ADD COLUMN filing_method TEXT;
ALTER TABLE section_83b_trackers ADD COLUMN tracking_number TEXT;
ALTER TABLE section_83b_trackers ADD COLUMN irs_service_center TEXT;
ALTER TABLE section_83b_trackers ADD COLUMN company_ack_at TEXT;
ALTER TABLE section_83b_trackers ADD COLUMN tax_return_copy_at TEXT;
