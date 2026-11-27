-- 556 / D990 / #2801: a stable reference per partner profile, part 1 of #2380.
-- Assigned by S21 on #2801, 2026-10-24. Additive and data-preserving.
--
-- `partner_profiles` is keyed by `email` (migration 275's header), so until now
-- the only way to name a profile in an address or a log line was its email.
-- From here each row carries `ref`, such as `pp_7f3a21c04e`: `pp_` and ten
-- lowercase hex characters, random, never derived from the email (a hash of an
-- address would let anyone holding a guess confirm it). The admin page's
-- address is `/admin/partner-profiles/<ref>`, and every log line names the
-- profile by it.
--
-- WHY A TRIGGER. Three writers insert rows — the onboarding chat
-- (routes/profiling.ts), a partner invitation (routes/partner_onboarding.ts)
-- and Eadwyn's profile questions (services/advisor/writeRouter.ts) — and none
-- of them needs to know the reference exists: the trigger fills it on every
-- insert that did not set one. Ten hex characters are 40 bits, so a collision
-- on the unique index below is about one in fifty million at ten thousand
-- rows; it would refuse that one insert rather than give two profiles one
-- address.
--
-- Every existing row gets its reference here. Nothing else changes.

ALTER TABLE partner_profiles ADD COLUMN ref TEXT;

UPDATE partner_profiles SET ref = 'pp_' || lower(hex(randomblob(5))) WHERE ref IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_profiles_ref ON partner_profiles(ref);

CREATE TRIGGER IF NOT EXISTS trg_partner_profiles_ref
AFTER INSERT ON partner_profiles
WHEN NEW.ref IS NULL
BEGIN
  UPDATE partner_profiles SET ref = 'pp_' || lower(hex(randomblob(5))) WHERE rowid = NEW.rowid;
END;
