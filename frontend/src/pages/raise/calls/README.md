# frontend/src/pages/raise/calls — Calls for Capital

D1221 (#2458), built to the owner's canvas: `design/incoming/Calls for Capital Page.dc.html` and `design/incoming/Calls for Capital · Boards.dc.html` (CLS1–CLS15).

| File | What it is |
|---|---|
| `callsModel.js` | Pure: the addresses, a call's state words and row (amounts Indicated, never committed), the page's state from `parts.calls`, the seven readiness items, and the waits. |
| `CallsTab.jsx` | The page Raise's "Calls" tab opens: off (CLS1), the list (CLS2), empty (CLS3) and unreadable. Drawn by `../caprel/CapRelTool.jsx` for the `calls` tab word. |

## Where it lives

- `/raise/capital-relationships/calls`: this page, Capital relationships' Calls tab.
- `/raise/capital-relationships/calls/:uid`: one call (`../../founder/RaiseCallPage.jsx`), the one route `App.jsx` adds. A sent call draws its page; a draft opens the new-call sheet on it (D1224, #3223), and `callHref` sends both here.

## The rules for adding here

- **A call's amounts are Indicated, never committed** (D653).
- **Nothing here switches calls on.** `ROUND_CALLS_ENABLED` stays `"false"` until the owner records counsel's answer on #1008 item 19.
- **Every block draws a mounted read** or says "Not read here yet" with its reason, never a zero.
