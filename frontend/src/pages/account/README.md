# pages/account — the Account center's sections

`../SettingsPage.jsx` is `/account` and `/account/:section`. It holds the
section list and mounts one section at a time. The sections drawn from the
Account canvas (`ac-*` and `us-*` in `design/canvases/integrated/Ops Page.dc.html`)
live here, one file each:

| File | What it holds |
| --- | --- |
| `AccountCenter.jsx` | The shared kit: the section list (`AccountSectionNav`), `PanelCard`, `FieldRow`, `Switch`, `Chips`, `Outcome`, `LoadingRows`, and `useAccountRead`, which keeps loading, read and unreadable apart (D568) |
| `AccountProfile.jsx` | Profile and identity |
| `AccountDevices.jsx` | The devices registered for push, under Notifications |
| `AccountBilling.jsx` | Billing and orders: the plan line and the orders list |
| `AccountUsage.jsx` | Usage (D642): the AI allowance, the last 30 days, where it went, models and rates, the last run, and storage (U1–U6) |
| `AccountConnectors.jsx` | Connectors (D651): Yours, Discover, the Add menu, the request form and the page states; reads a provider's sign-in return from the address |
| `ConnectorSheet.jsx` | The connector sheet and the connect flow, and `useConnectors`, the catalogue read every connectors surface shares |
| `ConnectToolSheet.jsx` | Build's "Connect a tool" sheet (D651), opened from `../founder/FounderBuildDesk.jsx` |
| `connectorTools.jsx` | The provider tools the sheet opens, moved from the retired Integrations page: the LinkedIn import, HubSpot's pipeline and Salesforce's mapping |
| `AccountFollowing.jsx` | Following |
| `AccountDeveloper.jsx` | Developer, for the one role its routes answer |
| `accountCenterModel.js` | The pure helpers the D568 sections share |
| `usageModel.js` | The Usage section's pure arithmetic and words: amounts, token counts, bytes, and every "Not recorded" rule |
| `connectorsModel.js` | The Connectors rules: categories, status words, search and pages, Discover's sections, the redirect, a sign-in's return, the connect flow's states and Build's groups |
| `AssistantsGroup.jsx` | D668: Connectors' "AI assistants" group, with a setup card per assistant around the one StudioOS server URL, and the grants list with Revoke. `AssistantsSection` mounts it on Connectors over `../../lib/api/assistants.js` |
| `assistantSetup.js` | D668: the server URL, each assistant's setup steps with the vendor page they were written from, and the grant row's words |

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
