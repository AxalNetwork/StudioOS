-- 210 — one partner account gets the firm it already belonged to.
--
-- WHAT THIS IS. `requirePartnerProfile` resolves a partner-role user to a firm
-- through `users.partner_id`, and every partner route scopes its reads on
-- `partners.id`. A partner-role user with a NULL `partner_id` reaches no firm,
-- so #431's `NoPartnerProfile` card is what they see instead of a workspace.
-- One active account is in that state and should not be.
--
-- WHY IT IS NOT A BULK FIX, which is the part worth recording. Production has
-- 26 partner-role users: 7 resolve to a firm, 19 do not. That 19 was described
-- in #431's commits and PR body as real people locked out of the product. It is
-- not, and the correction is larger than the count.
--
--   · SEVENTEEN OF THE NINETEEN CANNOT LOG IN AT ALL. `is_active = 0` returns
--     403 "Account is inactive" on every auth path — password
--     (`auth.ts:544`, `:697`, `:1090`), Google (`auth_google.ts:632`), passkey
--     (`auth_passkey.ts:281`), recovery and SMS. An account that never obtains
--     a session never reaches a partner route and never sees the boundary card.
--     Of those seventeen: nine are probe and smoke-test registrations at
--     reserved example domains, one of them at a string that is not a domain at
--     all; four are internal staff; and four are free-mail signups that were
--     deactivated. The last four are the only ones that could be real people,
--     and deactivating an account is a decision somebody already made about
--     them — reversing it is not this migration's business.
--   · ONE OF THE TWO ACTIVE ONES IS ALSO TEST DATA, at a two-letter domain, and
--     is deliberately left alone. The card is the correct answer for an account
--     with no firm, and stays correct for that row. Linking it to something to
--     make the card go away would be inventing the fact the card exists to
--     refuse to invent.
--   · EMAIL DOMAIN CANNOT MAP THE REST, which is why no fallback rescues them:
--     15 of the 18 firms are registered at the same free-mail domain as the
--     users. Matching on it would pair people with firms arbitrarily, and a
--     wrong pairing does not fail closed — it hands one party another party's
--     pipeline, quotes and engagements.
--
-- SO THIS TOUCHES EXACTLY ONE ROW, on a triage the owner confirmed. The
-- account is the partner-side registration of a firm whose founder-side account
-- already holds `partner_id = 9`; same organisation, two addresses, two roles.
-- That was the one case a query could surface and only a person could settle,
-- and it was put to them rather than guessed.
--
-- THE GUARDS ARE THE POINT, not ceremony. The runner is forward-only and this
-- file will also be replayed against dev and preview databases where these ids
-- mean nothing:
--
--   · `partner_id IS NULL` makes a replay a no-op instead of an overwrite, and
--     stops this clobbering a link someone sets by hand before it runs.
--   · `role = 'partner'` and the firm-name check mean a database where id 29 is
--     an unrelated row simply matches nothing. A migration that silently does
--     nothing on the wrong database is correct; one that writes is not.
--
-- No email address is written here on purpose: the guards do not need one, and
-- a migration file is a worse place to keep a person's address than the
-- database already is.
--
-- NOT AN ALTER. `users` sits at D1's 100-column limit, where an ALTER fails
-- with "too many columns" — for an existing column as readily as a new one —
-- and takes the whole deploy with it. This is an UPDATE to an existing column,
-- which is why it is safe on that table at all.

UPDATE users
   SET partner_id = 9
 WHERE id = 29
   AND role = 'partner'
   AND partner_id IS NULL
   AND EXISTS (SELECT 1 FROM partners WHERE id = 9 AND name = 'Oblivira');
