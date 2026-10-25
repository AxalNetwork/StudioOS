# frontend/src/pages/raise/dataroom — the Data room tool

The founder's Data room tool at `/raise/data-room` (D1101, #2456), built to the
owner's "Data room" canvas: `design/incoming/Raise Data Room Page.dc.html` and
`design/incoming/Data Room · Boards.dc.html` (DR1–DR24).

| File | What it is |
|---|---|
| `DataRoomTool.jsx` | The tool's tab bar (`DataRoomTabBar`), Home's tab bar with the line to today's files tool (`DataRoomHomeNav`), and its tab pages (`DataRoomTabPage`): Files, Access and Activity from the founder's room read; Requests, Checklist and Preview say what they wait for. |
| `dataRoomModel.js` | Pure: the addresses, the seven tabs, the words, and every derivation from the room read (who can open each file now, each grant's state, the log and the week's counts). |

## Where the tool lives

The tool is the Data room module, not a page beside it. Home is CycleRoute's
module page, which already draws checklist coverage, who opened the room and
the Files records. The tab words (`/files`, `/access`, `/requests`,
`/activity`, `/checklist`, `/preview`) arrive on the module's record route,
`/raise/:slug/:id`, and CycleRoute draws `DataRoomTabPage` for them instead of
a record (`isDataRoomTab`). A file's own page is still its number, and `/new`
is still Upload. No route is added.

## The rules for adding here

- **One access predicate.** Who can open a file is `dataRoomRead.js`'s
  `accessNow`, the same rule every investor read applies. Never a second one.
- **A link issued is not a read, and a refusal is never an open.** The log
  holds `open_room`, `download` and `blocked`; each is counted as itself.
- **Every row comes from a mounted read.** A read that fails says so where its
  block would be, a refusal is never an empty room, and a value nobody
  recorded says "Not recorded".
- **Writes stay in today's files tool** (`?mode=workspace`) until part 4
  replaces it; this folder writes nothing yet.
