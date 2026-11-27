# Content queue map — 2026-10-26

This audit reads the owner's "Content queue" canvas (#2383, boards ART1–ART18) against the code on `origin/main` at `4c63c05b6b`. It is a snapshot, true as of that date and **not maintained**. D1290 is the decision that acts on it.

## 1. The canvas

`design/incoming/Content queue · Boards.dc.html` holds the board grid. It imports `Content Queue Page.dc.html` by name, one variant per board.

| Boards | What they draw |
|---|---|
| ART1, ART2 | Pipeline: a board by stage, and a list with search, filters, sort, totals and paging |
| ART3–ART5 | The review drawer: the article as readers see it, paragraph comments, revisions and details |
| ART6 | The action dialogs, each with a reason the author reads |
| ART7, ART8 | Calendar: month, and a week with Move… |
| ART9, ART10 | Authors, and an author's drawer |
| ART11, ART12 | Performance, light and dark |
| ART13–ART17 | Empty, loading, error and partial, the Admin's view, no permission |
| ART18 | Phone |

## 2. What each board can read today

| Board · block | Read | Status on `main` |
|---|---|---|
| ART1, ART2 rows | `GET /api/admin/articles/queue` (`admin_articles.ts`): one status, 50 rows, oldest first, no total | built; counts, total, search, filters, sort, `ready` and `scheduled` stages are not |
| ART3–ART5 drawer | `GET /api/admin/articles/:id`: the article, revisions, comments | built; the rendered body, `approved_by`, who resolved, replies, revision text and featured are not |
| ART6 dialogs | start review, approve, request changes, reject, publish, schedule, unpublish | built; unpublish asks no reason and uses `window.confirm`; nothing stops self-approval |
| ART7, ART8 calendar | none by date range; `publish_at` is not on the queue rows | not built |
| ART9, ART10 authors | `author_name`, `author_role` per article; `article_submission_log` | no authors read |
| ART11, ART12 performance | `articles.views`: one all-time count, cache hits and previews included | no daily store; views per week are Not recorded |
| ART16, ART17 | `isSuperAdminUser`; `hqOnly` on `/admin/content` | built |

## 3. #2383's sixteen findings, re-checked

- **Fixed by D1290:**
  - 11 (notices could not open one article): `/admin/articles/:id` exists, and both review notices link it;
  - 14 (copy): the "edge cache" line is gone, and the page sits under the shared header.
- **Fixed on `main` before this:** 16 (sub-paths would lose the strip). Since D936, `stripFor` and `stripItemFor` own a route's subtree (`lib/hqStrips.js`).
- **Open, each with its part:**
  - D1291: 1, 2, 4 (the queue read);
  - D1292: 6, 7, 8 (who approved, self-approval, edits after submission);
  - D1293: 5, 9, 10 (the drawer's data, featured, unpublish);
  - D1294: 12, 13 (authors, daily views);
  - D1295–D1297: 3 and the boards;
  - D1298: 15 (the stale rail line next door).
