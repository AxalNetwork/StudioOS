-- D7168 (#7168): My funds past 500, identity by catalogue uid, and an
-- intended allocation per fund (Research Funds canvas D7033, boards FND-S00 to FND-S09).
--
-- own_record_at: when the member chose "Keep as my own record", or created
-- the row by hand after this migration. A row with no catalogue_uid and no
-- own_record_at is a legacy entry, saved before catalogue links, and the
-- dossier offers it the chooser. Nothing is backfilled: no existing row is
-- guessed into either identity, and a name match is never a link (D7033 Q1).
--
-- intended_allocation_cents: what the founder intends to raise from this
-- fund, in USD cents, compared with the fund's cheque range (also USD cents)
-- and never with a figure in another currency. NULL is Not recorded, not 0.
--
-- The index serves the list's default order, last updated first, per owner.

ALTER TABLE research_funds ADD COLUMN own_record_at TEXT;

ALTER TABLE research_funds ADD COLUMN intended_allocation_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_research_funds_owner_updated
    ON research_funds (owner_user_id, updated_at DESC);
