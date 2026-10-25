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
