# frontend/src/pages/network/directory — the shared directory's pieces

Shared by Network › People (D9025, #9025) and the Organizations directory (#9071, D7680). Each reads `/api/network/directory` through `networkDirectoryApi`; none counts rows itself.

| File | What it is |
|---|---|
| `directoryModel.js` | Pure: the address (`q` and the cursor trail `c`), the total and range lines, affiliation statuses, and the plain words for a refused or failed read. |
| `useDirectoryPage.js` | One page of entries for a kind and search: loading, ready, a failed first read, and a later page that failed with the last good page kept. |
| `DirectorySearch.jsx` | The search box, the true total (announced), the Previous and Next pager, and the later-page-failed notice. |
| `PersonSheet.jsx` | The Person Sheet: one person by id, the shared profile with the sourced-not-verified line, and an optional organization context bar. |
| `orgModel.js` | D9071: the organization words: people counts never an unknown 0, one row per distinct person, the status filter, and "Type not recorded" (a firm is never shown as a fund). |
| `usePeopleCounts.js` | D9071: the Worker's distinct-person counts for the organizations on screen. |
| `PersonOverlay.jsx` | The viewer's own saved flag and private note; a support session is refused in plain words. |

## The rules for adding here

- **No contact detail.** The member projection has none, and nothing here asks for one.
- **One sheet.** A page that opens a person opens `PersonSheet`, so the shared profile is the same wherever it opens.
