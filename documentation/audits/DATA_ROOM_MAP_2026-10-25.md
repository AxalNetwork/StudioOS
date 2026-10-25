# Data room map — 2026-10-25

The owner's Data room canvas (#2456, boards DR1–DR24), read against the code on `origin/main` at `32cd64750d`. This snapshot is true as of that date and is **not maintained**: re-check the code before treating a finding as live. The decision that acts on it is D1101.

## 1. The canvas

`design/incoming/Data Room · Boards.dc.html` holds the board grid, which imports `Raise Data Room Page.dc.html`. Both were decoded with `scripts/read-canvas.mjs`.

| Boards | What they draw |
|---|---|
| DR1 | Home: the Raise module header and rail, the tool's bar and seven tabs, Needs you, coverage, 90 days of activity, who has access, what was added |
| DR2–DR5, DR15 | Files: the tree and table with source, gate, answers and links issued; the file lightbox (DR3, DR3c a connector file); Upload (DR4, DR4s storage left); folder dialogs; making a version current |
| DR6–DR9 | Access by investor (DR6m the matrix); Share and one investor's grant (DR7, DR7i, DR7r); the NDA; Requests (DR9d decline) |
| DR10–DR14 | Activity (light and dark); Checklist; Preview as an investor (DR13e access ended); Eadwyn proposals |
| DR16–DR18 | Co-founder; Admin and Super Admin; no permission (investor, Operating Partner or advisor, explorer) |
| DR19–DR24 | Empty, loading, error and partial, phone, storage near the limit, the moved notices |

## 2. #2456's broken items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | Any admin can read, change and share any venture's room | **Open.** `UNSCOPED_ROLES` is `{admin}` (`services/tenancyScope.ts:64`), and `ownedProject` scopes through `companyScope` (`routes/data_room.ts`) |
| 2 | The demo-day deck says the room is ready without reading it | **Half fixed.** `data_room_ready` now reads `readableRoomFiles` (`services/decks/axalSpinoutDemoDay.ts:1266-1273`). "NDA required" still defaults from the incorporation step |
| 3 | Refused downloads counted as views and opens | **Fixed.** The access view counts `download` only (`FounderRaiseDataRoom.jsx:97`). Eadwyn's reading counts downloads and only grants still in force (`routes/research.ts:3325-3342`) |
| 4 | The access view's matrix says "Granted" for files no one can open | **Fixed.** `fileAccess` calls `accessNow` |
| 5 | The share form tells whether an email has an account | **Fixed.** An unknown address and a grant answer the same 201 (`routes/data_room.ts`) |
| 6 | Delete is one click and permanent | **Open** (`DataRoomPage.jsx`) |
| 7 | Two uploads, two default gates | **Open.** `forms.js` uploads as NDA; the files tool uploads as open unless ticked |
| 8 | Co-founders are locked out | **Open.** The check is `founder_id` only |
| — | A browser `prompt()` names a new folder | **Open** (`DataRoomPage.jsx:560`) |

## 3. What each tab can read today

| Tab | Read | Drawn by D1101 |
|---|---|---|
| Home | `GET /api/cycles/raise/modules/data-room` | The module page as it is: coverage, opens and the Files records, with the tool's tabs |
| Files | `GET /api/data-room/:projectUid` | Every file with its folder, gate, tier, end date and links issued, plus who can open it now (or why nobody can), by `accessNow` |
| Access | the same read | Every grant: in force, ended or revoked; since, until, NDA, committed, and who granted it |
| Activity | the same read | The week's opens, links issued and refusals as three figures, and the last fifty events, each as itself |
| Requests | none: no access-request store | Not read here yet, with the reason |
| Checklist | the module read carries coverage by area only | Not read here yet; coverage is on Home |
| Preview | none: no read runs the investor filter for one grant | Not read here yet |

## 4. What waits, and for what

- **Writes** (upload, gates, share, revoke, delete) stay in today's files tool, `?mode=workspace`, until part 4. The tool links there from Home, Files and Access.
- **New Worker reads:**
  - the founder's own download, and versions with Make current;
  - a grant's folder scope and end date;
  - the preview read;
  - access requests and a founder-sent NDA;
  - the activity read and its export;
  - the checklist read;
  - each file's source.
- **The old pages** (`?mode=workspace`, `?mode=access`, the record page) are retired only after the tool is live, each with a moved notice (DR24).
