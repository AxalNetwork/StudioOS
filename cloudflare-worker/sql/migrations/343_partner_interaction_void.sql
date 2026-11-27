-- D513 — void a recorded touch on the investor relationship book.
-- Migration 338 is applied and is not edited. These columns and checks are new.

ALTER TABLE partner_interactions ADD COLUMN voided_at TEXT;
ALTER TABLE partner_interactions ADD COLUMN voided_by INTEGER;

DROP INDEX IF EXISTS idx_prem_rel;

-- `done` is only 0 or 1. A CHECK cannot be added to an applied table, so the
-- same rule is a trigger on insert and update.
CREATE TRIGGER IF NOT EXISTS partner_reminders_done_ok_ins
BEFORE INSERT ON partner_reminders
FOR EACH ROW WHEN NEW.done NOT IN (0, 1)
BEGIN SELECT RAISE(ABORT, 'done'); END;

CREATE TRIGGER IF NOT EXISTS partner_reminders_done_ok_upd
BEFORE UPDATE ON partner_reminders
FOR EACH ROW WHEN NEW.done NOT IN (0, 1)
BEGIN SELECT RAISE(ABORT, 'done'); END;

CREATE TRIGGER IF NOT EXISTS partner_interactions_kind_ok
BEFORE INSERT ON partner_interactions
FOR EACH ROW WHEN NEW.kind IS NULL OR length(NEW.kind) = 0 OR length(NEW.kind) > 40
BEGIN SELECT RAISE(ABORT, 'kind'); END;
