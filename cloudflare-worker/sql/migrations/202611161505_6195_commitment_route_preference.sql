-- D6195 (#6195): how an investor would like to invest, stored on their commitment.
--
-- The owner's answer on #6195 (2026-11-16): a preference only. The investor
-- may record one when committing and change it while the commitment is
-- Pending; the studio sets the real route on the closing line
-- (`closing_lines.route`, D1205), and nothing here changes that.
-- NULL means "no preference recorded", which every existing commitment is,
-- so there is no backfill and NULL is never read as Direct.
--
-- Additive; the ledger applies the ALTER once. No transaction statements: D1
-- rejects `BEGIN;`/`COMMIT;` (see 200's header).
ALTER TABLE commitments ADD COLUMN route_preference TEXT
  CHECK (route_preference IS NULL OR route_preference IN ('direct', 'syndicate', 'fund'));
