-- D4838 part 10 (#5936, PP03c): a lead's proposal draft, kept by the partner before any bid exists.
--
-- A DRAFT IS NOT A PROPOSAL. A proposal is a `quotes` row: it exists once the firm bids, and only it
-- can be sent, opened, won or lost. This row is the firm's working shape for a lead it has not bid
-- on yet (shape, price, scope), so nothing that reads it may say a proposal was sent. It has no
-- sent, status or recipient column, on purpose.
--
-- One draft per partner per need: Save draft overwrites it, Discard deletes it (the lead stays a lead).
-- `origin` records whether the text began as an Eadwyn draft the partner accepted (`eadwyn`) or was
-- typed (`manual`); an edit keeps the origin it started from.
CREATE TABLE partner_lead_proposal_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  need_id INTEGER NOT NULL REFERENCES founder_needs(id) ON DELETE CASCADE,
  shape TEXT CHECK (shape IS NULL OR shape IN ('fixed_project', 'retainer', 'time_and_materials')),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  scope TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'eadwyn')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX partner_lead_proposal_drafts_one ON partner_lead_proposal_drafts(partner_id, need_id);
