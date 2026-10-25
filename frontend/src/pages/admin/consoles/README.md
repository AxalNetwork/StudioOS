# pages/admin/consoles — one file per Admin Console tool

Each console lives here, in its own file, and reads only its own data (D648).
The Admin Console shell that mounted one at a time is retired (D938, #2743):
`../ConsolePages.jsx` mounts each console at its own address under the shared
header, and `/admin?tab=` forwards there (`../LegacyContractsRedirect.jsx`).
D1122 retired the unused Legal console and its dedicated tests; Contracts has
its own routed desk and tests.

| File | Console | Reads |
| --- | --- | --- |
| `UsersConsole.jsx` | Users: the account directory, role picker, support sessions, the account drawer | the users list, trust scores |
| `PartnerProfilesConsole.jsx` | Partner Profiles and the profile review drawer. Since D989 the tab forwards to `/admin/partner-profiles` (`../profiles/`), which opens this file's `ProfileReviewModal` | the profiles list |
| `KycConsole.jsx` | KYC / AML queue and its review drawer | the queue, one record on Review |
| `PersonasConsole.jsx` | Personas. Since D997 the tab forwards to `/admin/persona-segments` (`../segments/`), whose Overview embeds `PersonasPanel` until its part 8 | the persona list |
| `DirectoryConsole.jsx` | Directory | the directory partners |
| `IntegrationKeysConsole.jsx` | Integration keys | the provider keys, each one's callback URL and setup guide, and the OAuth clients set only at deploy |
| `GithubSyncConsole.jsx` | GitHub Sync | the sync settings |
| `PromoCodesConsole.jsx` | Promo codes | the codes, the catalog products |
| `ProductTestingConsole.jsx` | Product testing (D815): partners' programmes waiting for approval with Approve and Send back, every programme by status with Open and Close, and HQ's own programmes with the shared form and Pick screen (`pages/testing/`). Super Admin only | D812's `/api/admin/testing` reads, only for the Super Admin |
| `bankAccountsTabs.js` | D1181 (#2389): Bank accounts' three tabs (Accounts, Cash, History), `tabOf`, and the words of the blocks with no read yet. `ConsolePages.jsx`'s `BankAccountsPage` draws them | none (pure) |
| `BankAccountsConsole.jsx` | Bank accounts (D708, restyled to L11 by D717; Accounts' tab since D1181): one card per entity with its Mercury state, unmatched receipts, what a notice refuses, Add and Reveal dialogs; its entity sheet is `../fundAdmin/MercuryEntitySheet.jsx` (D880). Super Admin only | the masked accounts and the resolver's coverage, the entity Mercury connections and each connected entity's unmatched-credit count, only for the Super Admin |
| `BillingConsole.jsx` | Billing (refunds, disputes) | disputes, on Load |
| `WellbeingConsole.jsx` | Wellbeing experts roster | the experts |
| `shared.jsx` | the pieces more than one console draws: `ROLE_BADGES`, `Field`, `KV`, `fmtDate`, `ConsoleUnreadable`, `CONSOLE_LOADING` | — |

Spin-Out Lab and Advisors & Partners were already their own components
(`../AdminSpinoutLab.jsx`, `../AdminNetworkProfiles.jsx`), and have their own
pages (D937, D972).

## Rules

- **A console reads its own data and nothing else.** Opening one tab must not
  fetch another console's rows; `frontend/test/admin_consoles_d648.test.mjs`
  renders each tab and fails on any other read.
- **A failed read is said, not drawn as empty.** Every console draws
  `ConsoleUnreadable` ("… could not be read", with Try again) when its read
  fails, never the empty list.
- **Mount a console alone where only one is needed.** HQ · Accounts mounts
  `UsersConsole`. Contracts (`/admin/contracts`, D647) does not mount
  `LegalPanel`: it renders its own desk, `../contracts/ContractsDesk.jsx`,
  and the old `/admin?tab=legal` link redirects there with a "has moved" notice.
- **Tests read the consoles through `frontend/test/_adminConsoles.mjs`**, which
  lists every file here; a new console file is added to that list and to the
  `COMPOSED` table in `admin_route_reachability.test.mjs`.
