-- 191 — title, authority and economics are three axes, not one string.
--
-- Migration 191. Applied by scripts/migrate-d1.mjs in numeric order and
-- ledgered in schema_migrations. Additive; adds three nullable columns and
-- backfills nothing.
--
-- WHAT WAS WRONG. `user_company_links` carried one axis: `role_in_company`, a
-- free TEXT string defaulting to 'Member'. Everything a firm knows about a
-- teammate had to be squeezed into it.
--
-- The Team · Authority design is built on the observation that this collapse
-- is the bug. It separates three things that a single string forces to agree:
--
--   TITLE      where someone sits on the ladder — Analyst, Associate, Senior
--              Associate, Vice President, Principal, Venture Partner,
--              Partner/GP — or a non-ladder function (Operating Partner, EIR,
--              LP Relations, Operations, Community, Platform Support).
--
--   AUTHORITY  what they may actually do: VIEW, WORK, FLAG, SPONSOR, VOTE.
--              FLAG is a formal objection that blocks a decision until it is
--              answered — a stop, not a veto. SPONSOR brings a deal to
--              committee and cannot decide it. VOTE is the only level that
--              decides anything.
--
--   ECONOMICS  carry, which tracks neither of the others.
--
-- WHY THEY MUST NOT BE DERIVED FROM EACH OTHER. A Venture Partner SPONSORs but
-- is usually part-time with no GP ownership; a Vice President is senior to an
-- Associate on the ladder and holds the same FLAG; an Operating Partner is a
-- partner by title and VIEW by authority. Deriving authority from title would
-- silently grant or deny power on a rename, which is the one thing an
-- authority model must never do. So the columns are independent, the ladder's
-- authority is a DEFAULT the caller may override, and
-- services/teamAuthority.ts holds the vocabularies.
--
-- CARRY IS BASIS POINTS, INTEGER. 150 = 1.5%. The same argument that makes
-- cents right for money makes bps right for a rate — see migration 187, which
-- stores revenue_share_bps and token_split_bps the same way. 0.015 is not
-- representable in binary floating point any more than $0.15 is, and carry is
-- a number people are paid on.
--
-- `role_in_company` IS NOT DROPPED. Twenty-three production accounts have one,
-- `canEdit()` in routes/company.ts still reads it ('Owner', 'Admin', 'Founder'
-- grant edit rights), and rewriting an access check in the same migration that
-- adds its replacement is how a permissions bug ships. The new columns start
-- NULL and mean "not recorded"; nothing reads them for access control yet.

ALTER TABLE user_company_links ADD COLUMN title TEXT;
ALTER TABLE user_company_links ADD COLUMN authority TEXT;
ALTER TABLE user_company_links ADD COLUMN carry_bps INTEGER;

-- Authority is the axis anything will eventually filter on, and it is low
-- cardinality per company.
CREATE INDEX IF NOT EXISTS idx_uclink_authority
    ON user_company_links(company_id, authority);
