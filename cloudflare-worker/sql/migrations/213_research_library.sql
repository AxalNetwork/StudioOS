-- 213 — the research library: documents you own, and the reach of Ask over them.
--
-- `/research/library` and `/research/ask` render a "no store behind this yet"
-- card on ALL FOUR licences — 8 of the 16 unbacked zone slots left in the
-- product. This is the store.
--
-- ONE TABLE, and the restraint is the point. The retrieval stack already
-- exists: `services/vectorize.ts` (Workers AI bge-base, 768-dim, cosine, index
-- `axal-search`), the hourly sweep in `index.ts`, and the generic queue
-- consumer `embed_entity` → `embedAndUpsertById`. The extractor exists too —
-- `services/deckExtract.ts` converts PDF/DOC/DOCX/PPTX via `env.AI.toMarkdown`
-- (it OCRs image-only PDFs) and ships `chunkMarkdown()`. Nothing here rebuilds
-- any of that; this migration only records what a document IS.
--
-- THE MODEL IS `data_room_files` (migration 184), NOT `legal_documents`. The
-- latter looks relevant and is not: it is a generated-contract table whose
-- `file_url` column is vestigial — one occurrence in the entire worker, the
-- DDL line that declares it — and whose DDL is created lazily inline in
-- `legalcap.ts` rather than living under `sql/`.
--
-- WHY `chunk_count` EXISTS, since a derived-looking counter deserves the
-- question. Vectorize offers `deleteByIds` and no delete-by-prefix. A document
-- is stored as N chunk vectors, `research_doc:{id}:{0..N-1}`. Without N, a
-- delete cannot name the ids it must remove and every chunk is orphaned in the
-- index — readable by a semantic query after the row is gone. It is not a
-- statistic; it is the only way to clean up.
--
-- NULL IS NOT ZERO, twice over, and both would be lies a page then renders:
--
--   * `chunk_count` NULL means "never successfully indexed". 0 would mean "we
--     indexed it and it had no content", which is a different fact and would
--     also silently skip the delete loop above.
--   * `indexed_at` NULL means "no successful index run". A timestamp of the
--     row's creation would claim Ask can read a document it has never seen.
--
-- `index_state` IS THE COLUMN THIS TABLE EXISTS FOR. The canvas calls the
-- library's last column the most important one, because it is precisely Ask's
-- reach: a document sitting in the list that Ask cannot read is invisible to
-- every question asked upstairs, and the page must say so rather than let a
-- reader assume coverage. Four values, and `index_note` carries the reason in
-- the words a person reads:
--
--   pending      uploaded, embed job enqueued, not yet run
--   indexed      chunk_count vectors exist and Ask can cite them
--   unsupported  `extractDeck` converted nothing from this file type
--   failed       conversion or embedding errored; `index_note` says how
--
-- NO `shared_with` COLUMN, and this is the scope boundary rather than an
-- oversight. The advisor canvas asks for "a client's own shared documents",
-- but a founder cannot push a document to an advisor: `canAccessFounderResource`
-- admits admin, partner and the owning founder, and there is no grant type for
-- an advisor (task #55 — `data_room_grants` is the shape it would copy, but its
-- column is `investor_user_id`). v1 is each user's OWN uploads, the zone says
-- so, and adding the share later is an additive change to this table rather
-- than a reshape.
--
-- NO `text` OR `markdown` COLUMN. The extracted text lives in the vector
-- snippets and the R2 object; a third copy in D1 would be a row that disagrees
-- with the file the first time either is touched.
CREATE TABLE IF NOT EXISTS research_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  -- playbook = the reader's own reusable material; client = material about
  -- someone they work with; document = anything else. Free-text on purpose:
  -- a CHECK here would need a migration every time the canvas adds a filter.
  kind           TEXT NOT NULL DEFAULT 'document',
  r2_key         TEXT NOT NULL,
  content_type   TEXT,
  size_bytes     INTEGER,
  index_state    TEXT NOT NULL DEFAULT 'pending',
  index_note     TEXT,
  chunk_count    INTEGER,
  indexed_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The list read is always "my documents, newest first" — there is no
-- cross-user listing anywhere in this feature, by design.
CREATE INDEX IF NOT EXISTS idx_research_documents_owner
  ON research_documents(owner_user_id, created_at DESC);

-- The sweep in `index.ts` walks each type past a KV watermark ordered by id,
-- and re-indexing asks "which of these are not yet indexed".
CREATE INDEX IF NOT EXISTS idx_research_documents_state
  ON research_documents(index_state, id);
