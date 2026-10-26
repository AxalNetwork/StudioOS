-- 621 — Due diligence part 3 (D1247, #3262, part 3 of #2385): a flag can be
-- raised by hand, given an owner, worked through a state, and closed with a
-- resolution. Assigned to #3262 by S21 (D1244 §6).
--
-- Until now findings came only from connectors, and `resolved_at` and
-- `resolved_by_user_id` (migration 008) existed but nothing wrote them.
--
-- dd_findings:
--   owner_user_id       who works the flag; NULL until someone is named.
--   state               open | in_progress | condition_to_close | accepted |
--                       closed. Every row starts 'open' — that is true of a
--                       connector finding nobody has worked yet. Only
--                       'closed' sets resolved_at, and only a closed flag
--                       leaves the score; an accepted risk is still a risk.
--   resolution_enc      what closed or accepted it, in the deal team's words:
--                       column-cipher ciphertext keyed to the finding row,
--                       like `detail_enc`.
--   raised_by_user_id   who raised it by hand; NULL for a connector finding
--                       (its source is `source_id`).
--   checklist_item_id   the checklist item it was raised against, when one
--                       was named; same case and section (the route checks).
--   updated_at          the last change to owner, state or resolution.
--
-- The three references are ON DELETE SET NULL, as dd_checklist_items' owner
-- is: a person's account going, or an item, never blocks that delete and
-- never takes the flag with it.
--
-- BACKFILL: a row that already carries `resolved_at` reads 'closed'; nothing
-- wrote it before this file, so on production every row reads 'open'.
--
-- Grep first (D689 D-t): none of these columns exists on dd_findings in an
-- earlier migration (008, 026, 167, 535) or in schema_baseline.sql.

ALTER TABLE dd_findings ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE dd_findings ADD COLUMN state TEXT NOT NULL DEFAULT 'open'
  CHECK (state IN ('open', 'in_progress', 'condition_to_close', 'accepted', 'closed'));
ALTER TABLE dd_findings ADD COLUMN resolution_enc TEXT;
ALTER TABLE dd_findings ADD COLUMN raised_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE dd_findings ADD COLUMN checklist_item_id INTEGER REFERENCES dd_checklist_items(id) ON DELETE SET NULL;
ALTER TABLE dd_findings ADD COLUMN updated_at TEXT;

UPDATE dd_findings SET state = 'closed' WHERE resolved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dd_findings_owner ON dd_findings(owner_user_id, state);
