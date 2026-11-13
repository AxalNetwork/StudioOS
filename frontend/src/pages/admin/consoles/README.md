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
| `KycConsole.jsx` | KYC / AML queue and its review drawer | the queue, one record on Review |
| `DirectoryConsole.jsx` | Directory | the directory partners |
| `IntegrationKeysConsole.jsx` | Integration keys | the provider keys, each one's callback URL and setup guide, and the OAuth clients set only at deploy |
| `GithubSyncConsole.jsx` | GitHub Sync | the sync settings |
| `PromoCodesConsole.jsx` | Promo codes | the codes, the catalog products |
| `ProductTestingConsole.jsx` | Product testing (D815): partners' programmes waiting for approval with Approve and Send back, every programme by status with Open and Close, and HQ's own programmes with the shared form and Pick screen (`pages/testing/`). Super Admin only | D812's `/api/admin/testing` reads, only for the Super Admin |
| `bankAccountsTabs.js` | D1181 (#2389): Bank accounts' three tabs (Accounts, Cash, History), `tabOf`. `ConsolePages.jsx`'s `BankAccountsPage` draws them | none (pure) |
| `BankCashTab.jsx`, `bankCashModel.js` | D1186 (#3115): Bank accounts › Cash (BNK3, BNK4): the four tiles, cash by entity over 30 days, 90 days or 12 months (a day with no snapshot is a gap, never 0), money in and out by month, the Balances table (Fund admin's `Accounts`, sharing the page's one accounts read) and the door to Reconciliation; each block fails alone. Super Admin only | `GET /api/admin/mercury/accounts`, `/connections`, `/balances`, `/monthly`, and each connected entity's unmatched-credit total |
| `BankHistoryTab.jsx`, `bankHistoryModel.js` | D1186 (#3115): Bank accounts › History (BNK5, BNK8b): every reveal and change, newest first, with search, Event, Entity and Dates; later pages keep the first page's snapshot; a reveal opens to its reason. Super Admin only | `GET /api/admin/bank-accounts/history` |
| `BankAccountsConsole.jsx` | Bank accounts (D708, restyled to L11 by D717; Accounts' tab since D1181; drawn to BNK1 and BNK7 by D1185): Where each payment goes, one card per entity joined to its Mercury (D1184), the accounts Mercury reads that the registry does not hold, unmatched receipts, and one account's lightbox at `/account/:uid`; its entity sheet is `../fundAdmin/MercuryEntitySheet.jsx` (D880). Super Admin only | the masked accounts with their Mercury facts and notice preview, the resolver's coverage, the entity Mercury connections and stored accounts, and each connected entity's unmatched-credit count, only for the Super Admin |
| `BankAccountDialogs.jsx` | D1185 (#3114): Bank accounts' dialogs (BNK6): Add an account, Add from Mercury, Relabel, Change payments, Retire and Reveal, each saying what it changes; they replace D717's inline forms | none (each sends one write, or the reveal) |
| `BankAccountLightbox.jsx` | D1185 (#3114): one account (BNK2): its instructions, payments, notice preview, Mercury balance and series, latest lines and history, each block failing alone | the account's 90-day balance series, its latest Mercury lines and its History rows |
| `bankAccountsModel.js` | D1185 (#3114): Bank accounts' pure rules: the balance and Mercury cells, the accounts not in the registry, the coverage head, what a payments change or a retire makes refuse, the notice preview, the card lines and the rail's sentence | none (pure) |
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
