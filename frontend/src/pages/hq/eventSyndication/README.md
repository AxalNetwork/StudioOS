# pages/hq/eventSyndication — Event syndication (D1491, #3725)

HQ › Platform › Event syndication, from the owner's canvas
(`design/incoming/Event Syndication Page.dc.html`, boards SY0–SY8).

| File | What it is |
| --- | --- |
| `syndicationModel.js` | The module's words and rules, pure: the owner-approved channels and what each needs, the status chips, a row's status and sync line, the skip sentences, the log's words, "Not recorded" for an unimported count, the approve button's sentence, the editor's Syndicate to line, the tabs. Tested by `frontend/test/event_syndication_d1491.test.mjs`. |
| `EventSyndicationPage.jsx` | SY1 Channels, SY5 Activity and SY6 Settings at `/admin/platform/event-syndication`, `/log` and `/settings` (Super Admin, `hqOnly`). |

| `SyndicationTabs.jsx` | SY1 connected HQ accounts, SY5 filtered cursor activity and SY6 stored settings. |
| `SyndicationState.jsx` | Shared loading, Unreadable, refusal, field and button treatments. |
| `useSyndicationRead.js` | Guarded reads and retry; stale replies cannot replace a new event's read. |

## Rules

The D1490 core is mounted. Availability comes from its adapter registry; these
screens never register adapters. Only HQ accounts are offered. Luma is removed
from new choices. See D1491 for the current owner decisions and wiring.
