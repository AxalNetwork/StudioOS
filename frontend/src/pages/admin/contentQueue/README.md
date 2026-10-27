# Content queue · Pipeline (D1295, #3391)

Pipeline of HQ › Content › Content queue (`/admin/articles`), as the owner's canvas draws it (ART1–ART6, ART13–ART17). `../ArticlesQueuePage.jsx` holds the header and the four tabs (D1290) and mounts this folder on the Pipeline tab.

| File | What it is |
|---|---|
| `pipelineModel.js` | Pure rules: the seven stages, each article's wait, the counts, the list's state in the address, the actions each viewer is offered, every dialog's words, paragraph anchors, threads and the line compare |
| `Pipeline.jsx` | The board by stage (ART1) and the list with search, filters, sort, totals and paging (ART2), the count strip, and the empty, loading and failed states (ART13–ART15) |
| `ReviewDrawer.jsx` | One article's review at `/admin/articles/<id>`: Article, Comments, Revisions and Details (ART3–ART5), and the footer's actions |
| `QueueDialog.jsx` | The one in-page dialog every change opens (ART6) |
| `NoPermission.jsx` | What a member who is not an admin sees on a Content queue address (ART17b), drawn by App.jsx's `ROUTE_BOUNDARIES` |

**Adding to it:** every read and change is `adminArticles` in `../../../lib/api.js` (D1291–D1293). A change opens `QueueDialog`, never a browser pop-up, and says what it changes; a reason the author reads is at least 8 characters. A count or a figure that was not read says so, never 0. The Worker decides who may act; `actionsFor` only decides what is offered. Calendar, Authors and Performance are D1296 and D1297's.
