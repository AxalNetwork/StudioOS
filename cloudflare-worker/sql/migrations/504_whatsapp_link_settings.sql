-- 504 — D754 way B (#1939 part 3): where a linked member's WhatsApp recordings go.
--
-- A member's link to Axal's number is an `integrations` row
-- (`provider_key = 'whatsapp_link'`, migration 492). The venture they pick for
-- recordings is kept here, off the shared `integrations` table, which every
-- connector reads (S1 on #1939, 2026-10-19 11:50Z).
--
--   integration_id  the member's `whatsapp_link` row. One choice per link.
--   project_id      the chosen venture; NULL never stored (no row means no
--                   choice). A deleted venture clears it.
--
-- With no row, a recording opens in the member's most recently updated venture
-- (migration 497). A capture copies the venture when it opens, so a later change
-- never moves a recording already sent. Unlinking deletes the row.
--
-- Additive and re-runnable.
CREATE TABLE IF NOT EXISTS whatsapp_link_settings (
  integration_id INTEGER PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
