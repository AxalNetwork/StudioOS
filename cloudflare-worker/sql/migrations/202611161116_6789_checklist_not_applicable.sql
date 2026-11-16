-- D6789 (#6789): a durability checklist item can be marked Not applicable, with
-- who marked it and when. Additive; an item with neither done_at nor
-- not_applicable_at stays open, as before.
ALTER TABLE durability_checklist ADD COLUMN not_applicable_at TEXT;
ALTER TABLE durability_checklist ADD COLUMN not_applicable_by INTEGER REFERENCES users(id);
