-- 222 — the firm's own half of a client brief, and one attachment table for two zones.
--
-- ══ WHY `research_brief_notes` ══════════════════════════════════════════════
--
-- The `pr2` artboard gives Client prep four chips — `Full brief`, `Ours only`,
-- `Founder-sourced`, `Open items` — and a legend that spells out what the first
-- three are for: "Cyan is theirs, amber is ours." Three of the four have been
-- prose, against one sentence in `partnerZoneFilters.js`:
--
--   "every row in a brief comes from the founder's grant and nothing records a
--    note of the firm's own against a client, so there is no second source to
--    separate out"
--
-- That is exact. `buildRows` in `ClientPrepZone.jsx` emits `source: 'client'` at
-- every one of its five sites and the worker's brief does the same, so `Ours
-- only` matched nothing and `Founder-sourced` matched everything — a filter that
-- selects all or none is prose, not a chip (D51/D53). This is the second source.
--
-- `open` IS THE FOURTH CHIP AND BELONGS ONLY HERE. `Open items` needs a row to
-- be markable as settled or not, and a founder-sourced row cannot be: it is the
-- client's record, quoted, and the firm ticking it off would be editing someone
-- else's fact. So the flag lives on the firm's own note, which is exactly the
-- asymmetry the artboard's legend describes from the other side.
--
-- A NOTE IS SCOPED BY THE GRANT, NOT BY THE READER ALONE. `project_id` names the
-- client and the route checks a live `advisor_client_grants` row before writing:
-- a firm that never held a grant has no business keeping a file on that founder
-- inside this product. The read is owner-scoped as everything else here is.
--
-- ══ WHY `research_attachments`, AND WHY ONE TABLE ═══════════════════════════
--
-- `Attach to proposal` is an op on TWO artboards — `pr2`'s Client prep and
-- `pr3`'s Market — and both were `unbuilt:` for the want of an edge rather than
-- for the want of a proposal. The proposal exists: `quotes` (migration 034) is
-- live and reachable, and `api.myQuotes()` reads it.
--
-- One table because the shape is identical — a thing, a quote, and when — and
-- because this repo carries three copies of one CSV escaper that disagree with
-- each other. `kind` says which zone attached; `ref_key` is whatever that zone
-- identifies its thing by, kept opaque so a third zone needs no migration. That
-- is the same argument `research_zone_drafts` makes one migration earlier.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS research_brief_notes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  -- The reader who wrote it. Every read is `WHERE owner_user_id = ?`.
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The client it is about. A note follows the grant, so when the founder
  -- revokes, the note stops being reachable with the brief it belongs to.
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The artboard's left column — "Still open", "What changed on their side".
  -- Free text: the sections a firm keeps are theirs to name, and a CHECK here
  -- would need a migration every time one of them thinks of another.
  section        TEXT NOT NULL,
  body           TEXT NOT NULL,
  -- `Open items`. 0 is settled, 1 is still open. NOT NULL because "we never
  -- said" and "we settled it" are different facts and a NULL would blur them.
  open           INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "My notes on this client, oldest first" is the only read — oldest first
-- because a brief is read top to bottom and the order a firm wrote its notes in
-- is the order it thought of them.
CREATE INDEX IF NOT EXISTS idx_research_brief_notes_owner
  ON research_brief_notes(owner_user_id, project_id, id);

CREATE TABLE IF NOT EXISTS research_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'brief' | 'reading' today. The zone that attached, kept as text for the
  -- same reason `ai_usage_logs.task` is: a third zone must not need a schema
  -- change to attach something.
  kind           TEXT NOT NULL,
  -- What was attached, in that zone's own terms — a project uid for a brief, a
  -- reading uid for a market figure. Opaque here on purpose.
  ref_key        TEXT NOT NULL,
  quote_id       INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- Attaching the same thing to the same proposal twice is not a second fact.
  UNIQUE (owner_user_id, kind, ref_key, quote_id)
);

-- `Attached to proposals` filters a zone's rows, so the read is by owner and
-- kind and the page joins on `ref_key`.
CREATE INDEX IF NOT EXISTS idx_research_attachments_owner
  ON research_attachments(owner_user_id, kind, ref_key);
