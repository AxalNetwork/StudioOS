-- 281 — a WHITE-LABEL licence records the brand its operator trades under,
-- and a subsidiary licence does not (D198, H26 step 6 + S11).
--
-- THE TWO CANVASES DISAGREE ABOUT WHO OWNS A BRAND KIT, AND THE LICENCE KIND
-- IS WHAT RESOLVES IT. `Admin · Subsidiary`'s S11 row says `who: 'HQ'` and
-- names a method — `HQ.brandKit()` — that has zero occurrences in this
-- repository; `Admin · Super`'s H26 header says "Unique to this kind · an
-- Axal subsidiary never sees this step". Both are the design of record, and
-- the line that settles them is in the Super canvas's own subsidiary-vs-
-- white-label table: `{ k:'Brand kit', a:'Axal, fixed', w:'Theirs · name,
-- mark, colours, domain' }`. So the owner depends on `territory_licences.kind`
-- — which migration 279 shipped one migration ago, and which is what makes
-- this table buildable at all. A subsidiary's brand is Axal's and fixed, so
-- S11's HQ chip and its Not-recorded state are CORRECT and stay; this table
-- is the white-label half.
--
-- WHY HQ WRITES A KIT IT DOES NOT OWN. A licence is issued before any
-- administrator is named on it — D134 made appointing one an UNNUMBERED tab
-- precisely because a licence can be issued with nobody on it — so at issue
-- time there is no operator to type their own kit. H26's two sentences are
-- both true and are not in tension: HQ CAPTURES the kit, HQ does not APPROVE
-- it. The branch-side editor is filed, not built here; see D198.
--
-- WHAT IS DELIBERATELY ABSENT, each with its reason, because a column nobody
-- reads is the shape this programme has now deleted a dozen times:
--
--   `public_name` — it already exists. It is `territory_licences.brand_name`,
--   and the shipped `licence-brand-kit` block has said so in its own words
--   since the licence console was built: "A separate public-name column does
--   not exist." D198 confirms that sentence rather than adding a second
--   column for one fact.
--
--   `email_from` — H26's kit summary draws `Studio Lyon <hello@app.studiolyon.fr>`
--   INSIDE its preview card, computed from the public name plus the bound
--   host. It is derived, not stored, and a per-licence sender is a mail
--   configuration change rather than a brand column.
--
--   `show_powered_by` — H26 gives it a default (Hidden) and an argument ("a
--   platform credit is an explicit opt-in"), and NOTHING IN THE SHELL RENDERS
--   A PLATFORM CREDIT AT ALL. Measured, not assumed. A stored switch would be
--   a producer with no reader; the block states the stronger claim instead —
--   the credit is hidden because no shell draws one.
--
--   exclusivity against other white-labels — migration 279's header already
--   refused it by name: "it is a SEPARATE flag that nothing stores, and
--   widening the index here would relax a live constraint on the strength of
--   a column that has existed for one migration." That still holds.
--
-- THE MARK IS `mark_r2_key` + `mark_mime`, WHICH IS `articles`' EXACT SHAPE,
-- and the alternative was measured and rejected. `mintDownloadToken`
-- (`services/signedDownload.ts:86`) is ONE-TIME — the `jti` is pre-registered
-- in KV and deleted on consume — and its TTL is hard-clamped to five minutes.
-- That is right for a document download and wrong for an `<img src>` on a page
-- that re-renders: the second render 404s. The house pattern for an image
-- behind a gate is a plain gated R2 stream, and there are four working copies
-- of it (`articles.ts:292`, `admin_telegram.ts:588`, `dd.ts:933`,
-- `founder_validate.ts:1051`). This table stores what that stream needs.
--
-- ONE KIT PER LICENCE. `licence_id UNIQUE` is structural rather than a check
-- in a handler a second writer could forget — the same reason migration 280
-- gave for one host per licence.
--
-- NO `licence_events` VALUE IS ADDED. SQLite cannot ALTER a CHECK, so
-- migration 266 had to REBUILD `licence_events` to admit a single new value.
-- Nothing here needs that: writing a kit is an HQ act on the super-admin write
-- bar and belongs in `admin_audit_log` through `logAdminAction` (D159), which
-- has no CHECK.
--
-- NO BACKFILL, AND NOTHING EXISTING IS TOUCHED. The activation blocker D198
-- adds fires only on `kind = 'white_label'`, and migration 279 defaulted every
-- pre-existing row to `subsidiary` BECAUSE the create path refused white-label
-- outright — so no row that exists today can meet the new condition. That is a
-- structural argument rather than a row count: production's licence ledger
-- cannot be read from the session that wrote this file.
--
-- No BEGIN/COMMIT: D1 rejects transaction control in a migration file (#26).

CREATE TABLE IF NOT EXISTS licence_brand_kits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- One kit per licence in this pass; see the header.
  licence_id INTEGER NOT NULL UNIQUE REFERENCES territory_licences(id) ON DELETE CASCADE,
  -- The R2 object key, and the type to serve it as. Both null until a mark is
  -- uploaded: a kit whose colours are set and whose mark has not arrived yet
  -- is a real and survivable state, which is why the activation blocker asks
  -- for the colours and not for this.
  mark_r2_key TEXT,
  mark_mime TEXT,
  mark_bytes INTEGER,
  -- `#rrggbb` or `#rgb`, lowercased, validated at the boundary by `cleanHex`
  -- from routes/brand.ts — the repo's one hex validator, reused rather than
  -- written a second time. A value that does not match is REFUSED, never
  -- coerced to a default, because a coerced brand colour is a wrong claim
  -- about somebody's brand rather than a missing one.
  primary_hex TEXT,
  accent_hex TEXT,
  updated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The one lookup `hydrate` makes, and the one the activation blocker makes.
CREATE INDEX IF NOT EXISTS idx_licence_brand_kits_licence ON licence_brand_kits(licence_id);
