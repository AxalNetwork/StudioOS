# Due diligence (D1244, #2385)

The tabs of the Due diligence desk under `/admin/due-diligence` and `/due-diligence`, from the owner's canvas "Due diligence" (DDL1–DDL19).

| File | What it is |
|---|---|
| `ddModel.js` | The two bases, the list's tabs and the case's nine tabs, `viewOf` for an address, the risk band's words with "Not scored yet", the decision's words, and the words of every block no read carries yet |
| `DdTabs.jsx` | The list's tabs (Cases, My reviews, Templates), the case's tabs, and the body of each tab that is not drawn yet |

`../AdminDueDiligencePage.jsx` mounts the list tabs, and `../AdminDueDiligenceCasePage.jsx` mounts the case tabs. Overview is today's whole case page.

**Adding to it:** every tab is an address, never `?tab=`. A block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A link stays on the caller's base, so a member never reaches an `/admin/…` address.
