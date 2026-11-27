-- D4811 (#4811) part 17 — the cross-border record of an agreement (board
-- CT-15): the seven checks an agreement with a foreign counterparty carries.
-- Keyed by the agreement uid the Contracts desk already uses (a document's
-- uid, an envelope's uuid). An agreement with no row is not marked
-- cross-border. Governing law is whatever was entered, never defaulted to
-- Delaware. While any check is open the Worker refuses to send the agreement
-- for signature (`services/crossBorder.ts`).
--
-- Each review check is open, resolved or not applicable, with a note. The
-- three facts (counterparty jurisdiction, governing law, countries of
-- performance) are resolved when entered. One row per agreement, updated in
-- place; every change is in the admin audit log.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS agreement_cross_border (
  agreement_uid             TEXT PRIMARY KEY CHECK (length(agreement_uid) BETWEEN 1 AND 120),
  counterparty_jurisdiction TEXT CHECK (counterparty_jurisdiction IS NULL OR length(counterparty_jurisdiction) <= 120),
  governing_law             TEXT CHECK (governing_law IS NULL OR length(governing_law) <= 200),
  performance_countries     TEXT CHECK (performance_countries IS NULL OR length(performance_countries) <= 300),
  tax_status                TEXT NOT NULL DEFAULT 'open' CHECK (tax_status IN ('open','resolved','not_applicable')),
  tax_note                  TEXT CHECK (tax_note IS NULL OR length(tax_note) <= 500),
  data_transfer_status      TEXT NOT NULL DEFAULT 'open' CHECK (data_transfer_status IN ('open','resolved','not_applicable')),
  data_transfer_note        TEXT CHECK (data_transfer_note IS NULL OR length(data_transfer_note) <= 500),
  local_counsel_status      TEXT NOT NULL DEFAULT 'open' CHECK (local_counsel_status IN ('open','resolved','not_applicable')),
  local_counsel_note        TEXT CHECK (local_counsel_note IS NULL OR length(local_counsel_note) <= 500),
  sanctions_status          TEXT NOT NULL DEFAULT 'open' CHECK (sanctions_status IN ('open','resolved','not_applicable')),
  sanctions_note            TEXT CHECK (sanctions_note IS NULL OR length(sanctions_note) <= 500),
  updated_by                INTEGER,
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
