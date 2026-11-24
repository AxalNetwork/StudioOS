-- D5828 part 2 (#5828) — the data center a Typeform sync row last read from.
--
-- Additive only: one nullable column. The response importer copies the region
-- #5827 records inside the connection's encrypted grant (`us` or `eu`) onto
-- the sync row at each run, so the form's responses link is built without
-- decrypting the grant. No token or other credential is ever stored here.
-- NULL means no run has read a validated region yet: the link is then absent,
-- never a guessed data center.
ALTER TABLE typeform_form_syncs ADD COLUMN region TEXT CHECK (region IS NULL OR region IN ('us', 'eu'));
