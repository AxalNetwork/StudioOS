# pages/account — the Account center's sections

`../SettingsPage.jsx` is `/account` and `/account/:section`. It holds the
section list and mounts one section at a time. Below 1024px a bare `/account`
is the A1m index instead, and each section is its own page (D700). The sections drawn from the
Account canvas (`ac-*` and `us-*` in `design/canvases/integrated/Ops Page.dc.html`)
live here, one file each:

| File | What it holds |
| --- | --- |
| `AccountCenter.jsx` | The shared kit: the section list (`AccountSectionNav`, the `lg` column), `PanelCard`, `FieldRow`, `Switch`, `Chips`, `Outcome`, `LoadingRows`, and `useAccountRead`, which keeps loading, read and unreadable apart (D568). D700: `AccountPhoneIndex`, the A1m index rows, and `AccountPhoneFrame`, a phone's `/account`: the index at bare `/account`, and each section as its own page under a ‹ Back bar |
| `AccountProfile.jsx` | Profile and identity; Company profile reads the sidebar’s selected company and links its Company Settings editor. Signing entity keeps the account’s separate contract details |
| `AccountDevices.jsx` | The devices registered for push, under Notifications |
| `AccountBilling.jsx` | Billing and orders: the plan line and the orders list |
| `AccountUsage.jsx` | Usage (D642): the AI allowance, the last 30 days, where it went, models and rates, the last run, and storage (U1–U6). On a phone, `UsagePhoneView` (A2m, D700) |
| `AccountConnectors.jsx` | Connectors (D651): Yours, Discover, the Add menu, the request form and the page states; reads a provider's sign-in return from the address. On a phone, `ConnectorsPhoneView` (A3m, D700) |
| `ConnectorSheet.jsx` | The connector sheet and the connect flow, and `useConnectors`, the catalogue read every connectors surface shares |
| `ConnectToolSheet.jsx` | Build's "Connect a tool" lightbox (D651, D686 §5.1), at `/build/connect` over the Build page, the cycle overview's primary action in `../cycles/CycleRoute.jsx`. `?tool=<key>` opens one tool where its row would; a sign-in returns to `/build/connect` with `?oauth=` and the venture, and reopens that tool's view. D686 §5.4 (#1597): its rows say what is true, and every path connects for the project's company |
| `GithubSyncSheet.jsx`, `githubSync.js` | GitHub's `sync` view (D686 §5.4): choose the repositories, sync them with the Worker's progress, then the success banner; `githubSync.js` holds its rules (refusals, progress, the banner) |
| `mercuryModel.js` | D715 (#1780): Mercury's words and rows, pure. The four entity rows in order (Holdings, Management, GP, Fund), their state and error words, and the entity sheet's sentences. Also a member's "never", "where it lands" and "how it reads" rows, the personal row's words, and the not-offered sentence; the member words are keyed by role (D752: founder, partner, investor). Imports nothing from `connectorsModel.js` |
| `MercurySheet.jsx` | D715 (#1780): the four Axal entities' Mercury connections, opened from the `mercury` row the Worker serves an HQ admin. One audited read on open; the Super Admin connects, replaces and disconnects, any other admin syncs; a branch admin's sheet reads nothing. `MercuryEntityConnections` is the part #1779's Banking tab reuses, and the sheet's Open Banking link leads there (#1780 decision 12). PR 3 adds a member's own Mercury: `MercuryUsesGroups`, `MercuryLandsGroup` and `MercuryReadsGroup`, which `ConnectorPanel` draws for the personal row instead of the sync groups. PR 3b: `MercuryUsesGroups` reads the uses from `GET /api/mercury/personal/status` (`../../lib/api/mercuryPersonal.js`). D752 (#1891): the `capital_attestation` use row links to the LP workspace's Proof of funds (`ATTESTATION_DOOR`) |
| `connectorTools.jsx` | The provider tools the sheet opens, moved from the retired Integrations page: the LinkedIn import, HubSpot's pipeline and Salesforce's mapping |
| `AccountFollowing.jsx` | Following |
| `AccountDeveloper.jsx` | Developer, for the one role its routes answer |
| `accountCenterModel.js` | The pure helpers the D568 sections share |
| `accountPhone.js` | D700: the phone's pure rules. `ACCOUNT_PHONE_PAGES` (each board's title, sub and section titles, from `Account Mobile Page.dc.html`), the A1m rows with their plan and Following lines, `PATH_TO_SECTION`, and the address rules `accountViewFor` and `accountPathFor` |
| `AccountPhonePage.jsx` | D700: the frame A4m–A10m share: `PHONE_PAGE`, the gutter that takes back the shell's padding; `AccountPhonePage`, a board's bar from `ACCOUNT_PHONE_PAGES` with its rows; and `phonePending`, a section's loading or Unreadable line. The seven pages outside this folder import it |
| `PricingPhone.jsx` | D700: A10m, `/plans-and-pricing` on a phone, with its three reads (the billing status, `/ai-budget/me` and `/ai-budget/top-up`). Apart from `ProductsPage.jsx`, which loads Stripe's key at import |
| `usageModel.js` | The Usage section's pure arithmetic and words: amounts, token counts, bytes, and every "Not recorded" rule |
| `connectorsModel.js` | The Connectors rules: categories, status words, search and pages, Discover's sections, the redirect, a sign-in's return, the connect flow's states and Build's groups |
| `AssistantsGroup.jsx` | D668: Connectors' "AI assistants" group, with a setup card per assistant around the one StudioOS server URL, and the grants list with Revoke. `AssistantsSection` mounts it on Connectors over `../../lib/api/assistants.js` |
| `assistantSetup.js` | D668: the server URL, each assistant's setup steps with the vendor page they were written from, and the grant row's words |
| `ChannelsGroup.jsx` | D684: Connectors' "Customer conversations" group, a card each for Telegram Business, WhatsApp Business, Zoom and Google Meet, mounted on Connectors as `ChannelsSection` over `../../lib/api/channels.js`. An interview's Connect panel draws the same Telegram and WhatsApp cards. Linking Telegram takes both owners (migration 458, #1625): the card draws the claimed account's name and @username as Telegram sent them, where each half stands, and Confirm (`POST /channels/telegram/link/:uid/confirm`), Axal's half |
| `channelsModel.js` | D684: the group's rules: reading `GET /api/channels`, each card's state and words, the Telegram link step, WhatsApp's public signup config, and the meeting cards over the connectors catalogue. No secret name, phone number id or WABA id is ever drawn |
| `whatsappSignup.js` | D684: Meta's WhatsApp Embedded Signup in coexistence mode: the SDK loaded on the click, `FB.login` for a code, and the `WA_EMBEDDED_SIGNUP` message read from a facebook.com origin only |

## Rules

- **A section owns its reads, and a card fails alone.** A read that fails
  makes its own card Unreadable and never empties the page.
- **A missing figure is never a zero.** Draw "Not recorded" or "Not counted"
  with its one-line reason. Put the rule in the section's model file, where a
  test can hold it.
- **Usage belongs to the member.** No read in `AccountUsage.jsx` takes a
  company, so switching company in the sidebar changes nothing on that page.
  `frontend/test/usage_page_d642.test.mjs` holds that.
- **A connector belongs to the member.** No read in the connectors files takes
  a company. A field only D650's `/api/connectors` carries reads "Not recorded"
  until it arrives; `frontend/test/connectors_page_d651.test.mjs` holds both.
- **A phone view is handed its reads.** Each section's phone view takes the
  same reads its desktop makes, as props, and adds no company or venture to
  any of them. `frontend/test/account_phone_d700.test.mjs` holds that.
