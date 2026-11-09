# pages/hq/security — Security v2 (D4800, D4801; #4800 to #4803)

The pieces of HQ › Security v2 at `/admin/security`, from the landed canvas
(`design/incoming/Security v2 Page.dc.html` and `Security v2 · Boards.dc.html`,
boards SE01 to SE12, spec boards SEA to SEE; D4803). `../SecurityPage.jsx` is
the host: it makes the page's three reads once, draws the shell and holds the
`workspaces` map. Each workspace that Security v2 rebuilds gets its own file
here; until then its entry in that map holds today's zones for its area.

| File | What it is |
| --- | --- |
| `securityTabs.js` | The workspace registry: the seven workspaces in canvas order (Overview, Events, Access, Privacy, Trust, AI Safety, Resilience), `tabFromSearch` (an unknown `?tab=` opens Overview), `tabHref`, `tabOf`, and `tabAfterKey` (Left and Right wrap, Home and End). The one list of workspaces. |
| `SecurityTabs.jsx` | The switcher: a `nav` of `?tab=` links with `aria-current="page"` and arrow-key movement on desktop and tablet, a 44 px section select on phone, and a mark on a workspace with open findings (shape, count, and "n items need action" as text). |
| `securityStates.js` | The shared state vocabulary (SE02): thirteen states, each with a word, a shape and a description. `securityState(key)` throws on an unknown key; `readFigure(value, { readable })` returns `unavailable` with no text for anything unread, and `measured_zero` for a real 0; `severityOf` orders findings. |
| `StatusBadge.jsx` | Draws one state: shape, word, and the description as visually hidden text. `label` replaces the word on screen and keeps it for screen readers. `ReadValue` draws a count, or Unavailable with Retry, never 0. `StateShape` is the glyph alone. |
| `overviewModel.js` | `buildOverview({ overview, feed })`, pure: Action required (findings, most severe first, each with evidence and one action; a check that could not run is a finding), Checked and clear (measured zeros that ran, with what was read and when), status by area (eight cells, no score), the source count and the tab marks; `recentEvents` (the newest ledger rows in Events' words, D4800 §8) and `namedAdmins` (the administrators without MFA, from `/overview`). Reads only `/overview` and `/governance`. |
| `OverviewWorkspace.jsx` | The Overview workspace in canvas order: `ActionRequiredList`, `CheckedAndClear`, `StatusByArea`, `RecentEvents`, then the evidence sources. |
| `parseUserAgent.js` | D4801. A stored user agent as "Firefox 132 · Windows 10 or 11": browser and major version, and OS, or `null` for each it does not recognise (never a guess). Windows 10 and 11 read as one and macOS has no version, because the string says no more. |
| `accessModel.js` | D4801, pure. `MIN_REASON` (8), `SESSION_BULK_LIMIT` (100), `EMERGENCY_PHRASE`; server times read as UTC and drawn to the second with the zone (`formatUtc`, `formatInZone`, `relativeTo`); Expires as created + `token_hours`; the four session statuses (`SESSION_STATUS`: Current, Active, Expired, Revoked) and `sessionStatus`; `writeAccess` (read-only until step-up, from your own row's factor); the eight results (`RESULTS`) and `resultOfError`; `bulkResult` (per-row Revoked, Already revoked, Not found, No answer). |
| `ActionDialog.jsx` | D4801. The one Scope → Review → Result shell: in-page, a bottom sheet on phone with 48 px buttons, focus moved in, Tab trapped, Esc closes (not while a request is in flight), focus returned to the opener or the table caption. Also `StepIndicator`, `ScopeBox`, `YouAffected`, `ReasonField`. |
| `AccessActions.jsx` | D4801. The five acts in that shell (revoke one, revoke selected, sign out account, end support session, emergency re-authentication): `actionCopy` (exact scope, whether you are affected), `resultTitle`, and the dialog that sends, then draws only what the server answered. |
| `AccessWorkspace.jsx` | D4801. The Access workspace: the sessions table (phone cards from the same rows), View details, select and bulk revoke, the support-sessions table, "What each action reaches", and the emergency card; loading, unreadable, empty and read-only states. It writes through the `onAct` it is given. |
| `eventsModel.js` | D4803, pure. The Events words: `eventLabel` (a human label for each stored action, the raw id kept, an unknown action drawn from its own id), `outcomeState` (Refused, Allowed, Recorded, Live, Ended, Not closed, in the shared vocabulary), `byDay` (UTC day groups), the date ranges and outcomes the server filters on, `feedQuery` (an untouched bar sends nothing), `actorOptions`, `mergePages`. |
| `EventsWorkspace.jsx` | D4803. The Events workspace (SE03, SE11b): the filter bar (search, date range, actor, outcome, source, branch disabled with why), the six quick categories, sources with Retry, the day-grouped table (phone cards from the same rows), Load older on the server's cursor, the event drawer (`EventDrawer`, read-only, raw row behind a disclosure) and "How this is measured". Every filter is the server's. |
| `SourceAvailability.jsx` | "n of n sources read" from the ledger's `sources[]`, with a failed source named and Retry beside the count, and the store names and implementation notes behind Source details. |

Tested by `frontend/test/hq_security_v2_d4800.test.mjs`, `frontend/test/security_overview_recent_4800.test.mjs`, `frontend/test/hq_security_access_d4801.test.mjs` and `frontend/test/security_events_4803.test.mjs`; the zones that stay
in `../SecurityPage.jsx` keep their own tests (`hq_security*.test.mjs`,
`hq_governance_h7.test.mjs`).

## Rules

- **Every status uses the vocabulary.** Draw state with `StatusBadge` and a key from `securityStates.js`; never a colour alone, never a new word. "Not recorded" is retired for new work: say Unavailable, Not instrumented, Unsupported, Measured zero or No data yet.
- **An unread value is never 0.** Use `readFigure` or `ReadValue`. A count of `null` is not a zero, and a failed read is not Healthy.
- **A workspace is a registry entry.** Add or rename a workspace in `securityTabs.js` only; replace its body in `SecurityConsole`'s `workspaces` map (Access is D4801's). Never add a second switch.
- **Every destructive act is an `ActionDialog`.** Scope (exact reach, whether you are affected, its own reason) → Review → Result, and Result only from the server's answer. Use `accessModel.js`'s `RESULTS` words; never a page-level reason field, never `window.confirm`.
- **No figure the Worker does not return.** Where the canvas needs one that no read has, draw Not instrumented or Unavailable and say so in the decision file.
- **No request from these files.** The reads stay in `../SecurityPage.jsx`, so moving between workspaces never re-reads; the writes leave by its `runSessionAct`, passed down as `onAct`.
- Light and dark: every colour class carries its `dark:` pair.
