-- 190 — who administers a territory licence.
--
-- Migration 190. Applied by scripts/migrate-d1.mjs in numeric order and
-- ledgered in schema_migrations. Additive and idempotent; seeds no rows.
--
-- WHAT WAS MISSING. Migration 187 built the licence ledger — who holds a
-- licence, over which territories, on what terms, until when — and was
-- explicit that it was the LEDGER half of the tenancy model and not the
-- SCOPING half. It stands. But there is a third thing, smaller than either,
-- that neither one covered: `territory_licences` names a legal entity, a
-- brand, and a signatory, and it does not name a USER. Nothing anywhere says
-- "this person administers this licence".
--
-- So the question "which licence is this admin's?" had no answer, and the
-- subsidiary admin — a real persona with their own dashboard in the design —
-- was not representable at all. This table is that answer and nothing more.
--
-- WHY THIS IS NOT THE SCOPING HALF, which matters because the repo's standing
-- rule is that tenancy goes through ONE middleware and a half-applied scope is
-- worse than none. Scoping means every ACCOUNT, project, deal and document
-- learns a territory, so that queries filter by it. That is a programme across
-- 151 route files and it is still not attempted here. This says only who may
-- administer a licence — an identity, not a filter. No existing query changes
-- behaviour because this table exists; the one new endpoint reads it directly.
--
-- WHAT THE DASHBOARD STILL CANNOT SHOW, and this is unchanged by 190. The
-- Admin · Subsidiary canvas puts seats USED against seats licensed, and queues
-- of LP applications, referrals and cohort applications scoped to the
-- territory. Every one of those needs account→licence attribution, which is
-- the scoping half. Seats LICENSED is in `licence_seats` and is shown; seats
-- used is reported as unavailable, in the same spirit as the fund analytics
-- rule — an unmeasured number is unknown, and saying so beats inventing it.
--
-- ONE ADMIN MAY HOLD ONE LICENCE, and one licence may have several admins.
-- The UNIQUE index is on user_id alone, not on the pair: a person who
-- administers two territories' licences would make "which licence is this
-- user's?" ambiguous at exactly the moment it must not be, and no such person
-- exists today. Widening it later is a migration; narrowing it would be a
-- data cleanup, so it starts narrow.

CREATE TABLE IF NOT EXISTS licence_admins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'principal' is the named counterparty on the contract; 'delegate' is
    -- someone they have added. Both read the licence; only HQ writes it, so
    -- the distinction is descriptive today and load-bearing when delegation
    -- lands (see the Team · Authority canvas).
    admin_role TEXT NOT NULL DEFAULT 'principal'
               CHECK (admin_role IN ('principal', 'delegate')),
    -- Who at HQ made the assignment, and when. A licence administrator is a
    -- contractual fact; it needs the same audit trail as the licence itself.
    granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- See the header: one licence per user, not one row per pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_admins_user
    ON licence_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_licence_admins_licence
    ON licence_admins(licence_id);
