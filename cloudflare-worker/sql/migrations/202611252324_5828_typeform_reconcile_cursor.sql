-- D5828 part 4 (#5828) — where a Typeform deletion-reconcile pass stopped.
--
-- Additive only: one nullable column. `reconcileTypeformDeletions` checks a
-- bounded number of held response ids per run (explicit
-- `included_response_ids` lookups) and records here the last
-- `typeform_responses.id` whose lookup resolved, so the next run continues
-- after it instead of re-reading the same first ids. NULL means the next run
-- starts a new pass at the beginning. It holds a local row id only: never a
-- Typeform response id, a token or any respondent data.
ALTER TABLE typeform_form_syncs ADD COLUMN reconcile_after_id INTEGER;
