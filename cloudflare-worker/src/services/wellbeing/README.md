# Wellbeing services

`match.ts` ranks directory experts, `slots.ts` builds bookable availability,
and `bookings.ts` handles payments, calendar mirroring and booking notices.
`seedExperts.ts` keeps development samples apart from real experts.
`resourceFiles.ts` defines the library-file types and private storage keys.

D1043's `expertReview.ts` manages expert credentials and decisions, separate
from members' encrypted wellbeing check-ins. Migration 577 stores the current
decision, private credential-file metadata and the decision trail. Credential
edits or file changes remove verification and advance the review version.
Verifying requires an explicit credentials check and the version checked.
The route layer keeps verification/restoration behind the branch-suspension
gate; takedowns remain available. Review reads require Admin, with another
admin's credentials restricted to Super Admin. File reads require ownership
or the same review permission; the bucket key is never returned.

`reflectionPeriods.ts` (D7118) is the member-local day, week and month a
reflection belongs to, and the rules a write's period must meet.
`storageReview.ts` (D7118 part 4) says how a row's answers are held at rest
(encrypted, plaintext, unreadable) without keeping a value: the member's
earlier check-ins carry it, and the Super Admin's storage review counts it.
`recommend.ts` (D7119) holds the kinds of support, what a consented topic may
suggest (never therapy, dietetics or spiritual guidance), the "Why this?"
reasons, and the two reads the routes share: a member's preferences, and their
topics only while consent covers them.
Group sessions (D7120) live in `../../routes/wellbeing_group_sessions.ts`; the
suggestion rule for them, `recommendSessions`, is in `recommend.ts`.
