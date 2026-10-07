# frontend/src/components/hqReview — HQ review pieces (D634)

Pieces of three HQ review screens from the Ops canvas
(`design/canvases/integrated/ops-data.js`: `hq-comments`, `hq-dispute`,
`hq-sensitive`). The dispute page itself is `../../pages/hq/DisputePage.jsx`.

| File | What it draws |
| --- | --- |
| `hqReviewCopy.js` | Every sentence the three screens print, the dispute's money, date and status wording, and which Stripe failure a read is. Pure. |
| `ReviewComments.jsx` | An article's review comments, with Delete beside Resolve; the delete is sent only from its confirmation. Mounted by `../../pages/admin/ArticlesQueuePage.jsx`. |
| `SensitiveField.jsx` | One identity field masked until Show, the KYC block of four, and the line that says each showing is logged. Mounted by the KYC and partner-profile windows of `../../pages/AdminPage.jsx`. |

## Rules

- A masked field never receives its clear value from the record read. Show
  calls the field's own Worker route, which logs the showing before it answers.
- A failed read draws Unreadable with "Try again", never an empty list.
- A new sentence goes in `hqReviewCopy.js`, not inline.
