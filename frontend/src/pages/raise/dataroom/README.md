# frontend/src/pages/raise/dataroom — the Data room tool

The founder's Data room tool at `/raise/data-room` (D1101, #2456), built to the
owner's "Data room" canvas: `design/incoming/Raise Data Room Page.dc.html` and
`design/incoming/Data Room · Boards.dc.html` (DR1–DR24). D1106 (#2986, part 5)
made Files the working tool: Home's blocks, the bulk bar, the file and folder
lightboxes, Upload and the dialogs. D1107 (#2987, part 6) made Access and
Requests the working tool: the matrix, Share, one investor, Revoke, Change,
the NDA, and the access and diligence requests.

| File | What it is |
|---|---|
| `DataRoomTool.jsx` | The tool's tab bar (`DataRoomTabBar`), Home's tab bar and blocks (`DataRoomHomeNav`), and its tab pages (`DataRoomTabPage`): Files, Access, Requests and Activity from the founder's room read; Checklist and Preview say what they wait for; DR18's no-permission board on a refusal. A file's lightbox is drawn over Files. |
| `dataRoomModel.js` | Pure: the addresses, the seven tabs, the words, and every derivation from the room read that Access and Activity draw. |
| `filesModel.js` | Pure (D1106): who can open a file (the investor rule, then each grant's folders), the tree and table, every dialog's words with who gains or loses, the upload queue, storage, and Home's blocks. |
| `DataRoomHome.jsx` | DR1, Home's blocks: the counts, Needs you, who has access, what was added; access requests and the last ninety days say what they wait for. |
| `DataRoomFiles.jsx` | DR2, Files: the folder tree, search, the table and the bulk bar (Move, Set gate, Set end date, Match to checklist, Remove, Clear). |
| `DataRoomFile.jsx` | DR3 and DR15, one file's lightbox at `/raise/data-room/file/<id>`: who can open it now and why, its gate, what it answers, its versions with Make current, and the links issued and refusals. |
| `DataRoomFolders.jsx` | DR5: a folder's lightbox (its NDA switch, Rename, Delete folder) and New folder. |
| `DataRoomUpload.jsx` | DR4 and DR4s: Upload, the sheet at `/raise/data-room/new`, with its queue in states. |
| `accessModel.js` | Pure (D1107): Access's rows and filters, the matrix (every cell through `grantOn`), Share's candidates and what a new grant opens, the NDA's state and what it unlocks, the requests in words, refusals, DR18's words. |
| `DataRoomAccess.jsx` | DR6, DR6m, DR7, DR7i, DR7r, DR8 and DR16b: Access by investor and as the matrix, Share, one investor's lightbox, Change, Revoke, the NDA and its strip, the report shares. |
| `DataRoomRequests.jsx` | DR9 and DR9d: access requests (Share the room, Decline with a note) and the venture's diligence requests (Answer with a file). |
| `DataRoomDialog.jsx` | The one in-page dialog every change opens, and a refusal as one sentence. |

## Where the tool lives

The tool is the Data room module, not a page beside it. Home is CycleRoute's
module page (coverage, opens and the Files records), with `DataRoomHomeNav`'s
tabs and blocks above it. The tab words (`/files`, `/access`, `/requests`,
`/activity`, `/checklist`, `/preview`) arrive on the module's record route,
`/raise/:slug/:id`, and CycleRoute draws `DataRoomTabPage` for them instead of
a record (`isDataRoomTab`). A file's number is still its record page; its
lightbox over Files is `/raise/data-room/file/<id>`, the one route D1106 adds.
`/new` is Upload, drawn by `DataRoomUpload.jsx` instead of the generic form.

## The rules for adding here

- **One access rule.** Who can open a file is `dataRoomRead.js`'s `accessNow`,
  the rule every investor read applies, and then a grant's folders (D1103),
  in `filesModel.js`'s `grantOn`. Never a second rule.
- **Every change is asked first,** in `DataRoomDialog.jsx`, saying what it
  changes and, for a gate, an end date, a move or a folder's NDA, who gains or
  loses the file. Never `prompt()`, `confirm()` or `alert()`.
- **A link issued is not a read, and a refusal is never an open.**
- **Every row comes from a mounted read.** A read that fails says Unreadable
  with Try again where its block would be; one failed block never blanks the
  page; a value nobody recorded says "Not recorded".
- **The owner alone** changes a gate or removes a file; a co-founder moves,
  renames, matches and uploads into a folder's gate (D1103).
- **The owner alone** shares, revokes, changes a grant, sends the NDA and
  answers an access request (D1103, D1104). Share picks one of this venture's
  prospects in Capital relationships; the Worker reads its address (D1107).
