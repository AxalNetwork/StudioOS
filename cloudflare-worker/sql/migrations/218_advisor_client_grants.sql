-- 218 — a founder opens their record to a named advisor, and says how far.
--
-- TASK #55. `/research/client-prep` has said the same thing since it existed:
-- half a client brief is already here — the topic and the questions the client
-- wrote when they asked for the session — and the other half is the client's
-- own record, which is CLOSED BY RULE rather than absent. `canAccessFounderResource`
-- admits admin, partner and the owning founder; an advisor matches no branch
-- and falls through to false. There is no table missing. There is a decision
-- missing, and this is it.
--
-- THE SHAPE IS `data_room_grants` (migration 184), WHICH IS THE PRODUCT'S ONLY
-- FOUNDER→OUTSIDER CONTENT GRANT: one project, one named counterparty,
-- revocable, expiring, logged. Copied rather than generalised, because that
-- table's column is `investor_user_id` and its reads are wired into the NDA
-- path; widening it would put the advisor case inside the investor case's
-- blast radius for no gain.
--
-- KEYED ON `users(id)`, NOT ON `advisors(id)`, for the reason migration 206
-- argues at length about cohort assignments: the read is AUTHORISATION, and an
-- advisor who has not yet built a practice profile has no `advisors` row —
-- keying there would make them ungrantable for a reason a founder could never
-- discover.
--
-- FOUR SCOPES, NOT ONE SWITCH. "Open my record to this advisor" is not one
-- decision. Showing them the project record is not the same as showing them
-- the data room, and neither is the same as showing them WHO ELSE the founder
-- has been talking to. A single boolean would force the founder to grant the
-- most sensitive thing in order to grant the least. Each scope is its own
-- column, defaults to off except the project record, and the granting screen
-- names each one in plain words before it is ticked.
--
--   scope_project    the client's own project record — name, sector, stage,
--                    and the metrics they have recorded. This is the half the
--                    brief is missing, so it defaults on.
--   scope_data_room  files the founder staged as 'open'. NDA-visibility files
--                    stay withheld behind `pairwise_ndas` exactly as they are
--                    for an investor: a count, never the names.
--   scope_sessions   the client's sessions with OTHER advisors. The most
--                    sensitive of the four by some distance — it exposes a
--                    founder's advisory relationships across the platform —
--                    so it defaults off and every row it produces is
--                    seam-marked in the brief.
--
-- THE NDA CONVENTION IS A COMMENT, NOT A CONSTRAINT. `pairwise_ndas` says
-- "party_a is ALWAYS the founder, party_b is the investor". The SCHEMA says
-- only `UNIQUE(party_a_user_id, party_b_user_id)`; `getPairwiseNda` is a
-- two-column lookup with no role assertion, `upsertPairwiseNda` asserts none
-- either, and every other reader is symmetric. So the convention is restated
-- as "party_a is the founder, party_b is the counterparty" and the gate works
-- for an advisor unchanged. No migration is needed for that, which is why
-- there is none here.
--
-- REVOKING IS A STATE. Never a delete — the access log points at rows whose
-- grant would be gone, and the founder still needs to read what that advisor
-- opened. Same reasoning as `data_room.ts:502`.
--
-- NO TRANSACTION STATEMENTS. D1's HTTP API rejects BEGIN/COMMIT in a migration
-- file; `scripts/check-sql-migrations.mjs` enforces it.

CREATE TABLE IF NOT EXISTS advisor_client_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    advisor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The founder who opened the door, and the NDA counterparty for the
    -- data-room scope. Kept as its own column rather than joined through
    -- `projects` so the gate is one lookup, as in `data_room_grants`.
    granted_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',   -- active | revoked
    expires_at TEXT,
    scope_project INTEGER NOT NULL DEFAULT 1,
    scope_data_room INTEGER NOT NULL DEFAULT 0,
    scope_sessions INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, advisor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_advisor_client_grants_advisor
    ON advisor_client_grants (advisor_user_id, status);
CREATE INDEX IF NOT EXISTS idx_advisor_client_grants_project
    ON advisor_client_grants (project_id, status);

-- One document, one named advisor.
--
-- The additive change `213_research_library.sql:48-56` pre-authorised: "NO
-- `shared_with` COLUMN, and this is the scope boundary rather than an
-- oversight… adding the share later is an additive change to this table rather
-- than a reshape." A side table rather than a column, because the relation is
-- many-to-many and because a revoked share must survive as a record for the
-- same reason a revoked grant does.
--
-- THIS MUST NEVER WIDEN `searchSemantic`. DECISIONS D37 records the trap:
-- adding `research_doc` to `ALL_ENTITY_TYPES` in `routes/search.ts` would have
-- published every user's private documents to every other user's global search
-- box, "in one line that looks exactly like following the existing pattern".
-- A shared document is resolved BY ID through the row below, never by widening
-- a namespace; `research_search_isolation.test.ts` stays green.
CREATE TABLE IF NOT EXISTS advisor_client_document_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    document_id INTEGER NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
    advisor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',   -- active | revoked
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (document_id, advisor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_advisor_doc_shares_advisor
    ON advisor_client_document_shares (advisor_user_id, status);

-- Who opened what, and when. The founder's own record of an advisor's reading,
-- and the reason a revoke is a state rather than a delete.
CREATE TABLE IF NOT EXISTS advisor_client_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    advisor_user_id INTEGER NOT NULL REFERENCES users(id),
    -- 'open_brief' | 'open_document'
    action TEXT NOT NULL,
    document_id INTEGER REFERENCES research_documents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_advisor_client_access_project
    ON advisor_client_access_log (project_id, created_at DESC);
