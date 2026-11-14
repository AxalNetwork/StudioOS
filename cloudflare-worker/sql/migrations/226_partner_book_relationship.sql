-- 226 — what a company IS to the firm: client, prospect, or referral source.
--
-- ══ THE ONE COLUMN THE `pn3` TABLE NEEDS AND 224 DID NOT GIVE IT ═══════════
--
-- The Organizations artboard's instrument is `Organization · Relationship ·
-- People known · Engagement sourced · Headcount`, and it is explicit about
-- which of those the book cannot supply: "Headcount, sector and revenue columns
-- are absent rather than estimated — the book holds none of them." It does NOT
-- say that of `Relationship`, and it is right not to: whether Thornbury Capital
-- is a client, a prospect or the firm that keeps sending work is a fact the
-- person entering the contact already knows and would gladly write down. It
-- simply had nowhere to go.
--
-- Without it, three of the artboard's four chips — `Clients`, `Prospects`,
-- `Referral sources` — select nothing on every account, which is D51's
-- canonical failure and the reason a filter that matches all or none is prose
-- rather than a control.
--
-- ══ ON THE CONTACT, AND THAT IS THE POINT OF THE WHOLE PAGE ════════════════
--
-- This is not an organization record. There is no organization table, which is
-- what the empty state says in as many words: "the book stores a company name
-- per contact as text, with no organization record behind it." So the
-- relationship is stored where the company name already is — on the contact —
-- and the roll-up groups by text.
--
-- WHICH MEANS TWO CONTACTS AT ONE COMPANY CAN DISAGREE, and the page must not
-- hide that. It reads `Mixed` and names both values rather than picking the
-- newest or the most common, because a silent tie-break here would be the page
-- inventing a relationship the firm never stated — the same refusal the
-- `Headcount` column makes by staying `Not recorded`.
--
-- ══ NULLABLE, WITH NO DEFAULT ══════════════════════════════════════════════
--
-- A contact added before this column, or added without an answer, has no
-- relationship recorded — not "prospect". Defaulting would fill the column with
-- a value nobody chose and make `Prospects` count every legacy row, which is
-- exactly the absent-read-as-empty failure this product's guards exist for. The
-- cell reads `Not recorded`.
--
-- `ALTER TABLE ADD COLUMN` IS SAFE HERE, and the ordering objection 224 raised
-- about `partner_relationships` does not apply: `partner_book_contacts` is
-- created by migration 224, which is numbered below this one, so it exists
-- before this runs on a fresh build. SQLite accepts a CHECK on an added column
-- (verified against the engine, not assumed); it would refuse UNIQUE or PRIMARY
-- KEY, and this is neither.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

ALTER TABLE partner_book_contacts
  ADD COLUMN relationship TEXT
  CHECK (relationship IS NULL OR relationship IN ('client', 'prospect', 'referral_source'));

-- `Clients`, `Prospects` and `Referral sources` all narrow on this within one
-- firm's book.
CREATE INDEX IF NOT EXISTS idx_partner_book_contacts_relationship
  ON partner_book_contacts(owner_user_id, relationship);
