-- 239 — advisor_deliverables: what you sent a client, and whether they opened it.
--
-- WHAT THE ARTBOARD ASKS FOR. `Advisor Detail · Practice.dc.html`'s PR3 frame
-- draws a collection of work products, a card it marks "Version history and
-- open state · only here", and four tiles that are all open receipts —
-- Unopened, Median to open, Never opened. Its blurb is the whole requirement in
-- one line: "Every work product, every version, and whether anyone opened it."
--
-- WHY A NEW TABLE, TABLE BY TABLE. The rule this repo runs on is that a store
-- gets built only after every existing one has been read and found wanting,
-- because an earlier series found five of six "nothing stores this" claims to
-- be false. This time all of them held. Every candidate was read:
--
--   `advisor_client_document_shares` (218) — the right two nouns and the wrong
--   direction. `shared_by_user_id` is the FOUNDER and the row's document must
--   satisfy `owner_user_id IN (…founder…)`, so it can only ever record a
--   founder offering their own file to a named advisor. This zone needs the
--   inverse: the advisor's own work product, and the client's receipt for it.
--
--   `advisor_client_access_log` (218) — not merely pointed the wrong way:
--   structurally incapable. `advisor_user_id` is its ONLY actor column, and its
--   own header calls it "the founder's own record of an advisor's reading". It
--   has no slot in which a client open could be written.
--
--   `research_documents` (213) — fourteen columns and never once ALTERed. No
--   version, no counterparty, no `sent_at`, no `opened_at`. Its `kind` is
--   'playbook' | 'client' | 'document', which labels subject matter rather than
--   naming a client, and `indexed_at` is the Vectorize stamp. 213's own header
--   pre-declares the boundary: "NO `shared_with` COLUMN, and this is the scope
--   boundary rather than an oversight."
--
--   `engagement_deliverables` (208) — EXACTLY the right shape and the wrong
--   licence. `title` / `version` / `sent_at` / `opened_at` / `signed_off_at` is
--   what this zone wants, and its single foreign key is
--   `engagement_id REFERENCES engagements(id)` — the partner licence, which
--   migration 238's header already documents as unreachable from an advisor
--   (`need_id` and `quote_id` NOT NULL, `quote_id` UNIQUE, no advisor column).
--   Every reference to it in the worker is partner-gated, including four in
--   `routes/research.ts` that look reachable and return `[]` for anyone without
--   `users.partner_id`. Its COLUMN DESIGN is copied below; its ownership is not.
--
--   `deliverable_snapshots` / `company_week_status` — the name is the trap.
--   Created lazily in `services/cohortTiming.ts`, keyed
--   `(user_id, cohort_cycle_id, week_number, deliverable_key)`: the FOUNDER's
--   cohort week homework, with no advisor column at all.
--
-- AND ALL TWENTY `advisor_*` TABLES WERE SWEPT, three ways — a column grep, an
-- ALTER grep, and a whole-tree column inventory. Not one carries a version, a
-- sent stamp, an opened stamp, or any work product the advisor owns. The only
-- `version` columns in the schema belong to legal templates, assessment games,
-- pitch decks, quote versions and the partner deliverables above; the only
-- `opened_at` columns to those partner deliverables, referral invites, partner
-- invitations and expert profile views.
--
-- TWO TABLES, BECAUSE A WORK PRODUCT HAS MANY VERSIONS, and the artboard proves
-- it twice over: each list row carries a latest version AND a count ("v4",
-- "4 versions"), and the Version trail card lists four versions of one
-- deliverable with a different note against each. One table grouped by title
-- would break the moment a deliverable is renamed.
--
-- `version` IS AN INTEGER HERE AND IS `TEXT` IN 208, which is the one place this
-- deliberately diverges from the shape it copies. A trail has to be ordered, and
-- 'v10' sorts before 'v2' as text. The artboard's own "v2 draft" is a LABEL
-- rather than an ordinal, so it gets its own column and the number keeps the
-- order.
--
-- EVERY STAMP LIVES ON THE VERSION, NOT ON THE WORK PRODUCT. The artboard's
-- trail marks only v4 "Aug 19 · sent", and its Verwood row reports "Not opened
-- in 4 days" against one version rather than a document. Sending and reading
-- happen to a version; a work product is the thing they happen to.
--
-- `opened_at` IS THE CLIENT'S TO SET, and 208's header states the rule this
-- table inherits: "Only the founder side can truthfully say a thing was read,
-- so a partner-side write to either would be the firm reporting a metric about
-- itself." So no advisor route writes it — the founder side does, through
-- `routes/advisor_grants.ts`, and a test asserts the absence in every advisor
-- handler. A receipt an advisor can set is not a receipt.
--
-- THERE IS NO `state` COLUMN, and that absence is load-bearing. Not started /
-- Sent / Opened is entirely determined by which stamps exist, so storing it
-- would be a second source of truth that drifts the first time a write
-- half-fails — which is precisely the defect that disqualified
-- `investor_introductions` from being read as a ledger (D70): a status column
-- written once by its only INSERT and updated by nothing.
--
-- CHECKS: `version` must be positive, and nothing else here is enumerated. The
-- three stamps are free dates because a deliverable's history is not a state
-- machine — it is a sequence of things that did or did not happen.
--
-- No BEGIN/COMMIT — D1 rejects them.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/239_advisor_deliverables.sql

CREATE TABLE IF NOT EXISTS advisor_deliverables (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT    NOT NULL UNIQUE,
  advisor_id      INTEGER NOT NULL REFERENCES advisors(id),
  -- The contract this work is under, when there is one. NULLABLE because a
  -- deliverable can precede the paperwork — the same call migration 238 makes
  -- about a client's account, and for the same reason.
  engagement_id   INTEGER REFERENCES advisor_engagements(id),
  -- The client, as a NAME. Denormalised from the engagement on purpose, exactly
  -- as 238 keeps `client_name` NOT NULL beside a nullable user: the board has to
  -- render a row whether or not a contract or an account exists behind it.
  client_name     TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS advisor_deliverable_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT    NOT NULL UNIQUE,
  deliverable_id  INTEGER NOT NULL REFERENCES advisor_deliverables(id),
  -- The ordinal, and the reason this is an INTEGER — see the header.
  version         INTEGER NOT NULL CHECK (version > 0),
  -- What the advisor calls it: the artboard's "v2 draft". A label, never the
  -- order.
  label           TEXT,
  -- The trail's "what" line — "Two-tier structure, annual prepay added". This
  -- is what makes a version trail worth drawing rather than a list of numbers.
  summary         TEXT,
  link_url        TEXT,
  -- SENT is the advisor's. OPENED and SIGNED OFF are the client's, and no
  -- advisor route writes either.
  sent_at         TEXT,
  opened_at       TEXT,
  signed_off_at   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- One row per ordinal. The route reads MAX(version) and adds one, so this is
  -- what turns a lost race into an error rather than two silent "v3"s.
  UNIQUE (deliverable_id, version)
);

-- The zone's own read: one advisor's work products, most recently touched first.
CREATE INDEX IF NOT EXISTS idx_advisor_deliverables_advisor
  ON advisor_deliverables(advisor_id, updated_at DESC);
-- The join back to the contract, for the client column and the "By client" view.
CREATE INDEX IF NOT EXISTS idx_advisor_deliverables_engagement
  ON advisor_deliverables(engagement_id);
-- The trail, and the MAX(version) the add-a-version route reads before writing.
CREATE INDEX IF NOT EXISTS idx_advisor_deliverable_versions_deliverable
  ON advisor_deliverable_versions(deliverable_id, version DESC);
-- The receipt sweep behind three of the four tiles: what went out, newest
-- first, so Unopened / Median to open / Never opened do not scan the unsent.
CREATE INDEX IF NOT EXISTS idx_advisor_deliverable_versions_sent
  ON advisor_deliverable_versions(sent_at DESC);
