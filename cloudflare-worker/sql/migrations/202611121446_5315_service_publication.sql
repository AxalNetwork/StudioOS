-- D5315 part 3: existing active records remain usable in the advisor's
-- practice, but require explicit publication before appearing publicly.
ALTER TABLE advisor_services ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft'
  CHECK (publication_state IN ('draft', 'published', 'hidden'));
