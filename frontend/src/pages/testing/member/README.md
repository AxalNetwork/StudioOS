# frontend/src/pages/testing/member — product testing, the member's side (D1337)

A member joins the Product tester pool once; an Admin decides; an active tester applies to open programmes and may withdraw (D1335, TST10 option C). There is no page or menu entry of its own: the card and lists draw on Studio, and every detail opens in the shared right Sheet (`../../../ui/Sheet.jsx`, D1317). The Worker is D1336 (`cloudflare-worker/src/routes/testing.ts`).

| File | What it is |
| --- | --- |
| `testerModel.js` | Pure rules: the card's six states (PT-M1), a programme's row (PT-M2), an application's pill, line and whether Withdraw is offered (PT-M3), which sheet an Inbox notice opens (PT-M4), dates in words. |
| `TesterSheets.jsx` | The four sheets: Become a Product tester, the member's place in the pool (with Leave), an open programme (with Apply), and one application (with Withdraw behind its confirm). |
| `ProductTestingStudio.jsx` | The Studio section, mounted under each member's Studio home (`../../Dashboard.jsx`) and on `../../ExploringDashboard.jsx`. Three reads, three blocks; an Admin sees nothing. |
| `InboxTesting.jsx` | `useInboxTesting`: the Inbox's testing notices open their sheet in place, and an open application's notice carries Withdraw (`../../InboxPage.jsx`). |

**The rule for adding here:** no email and no other tester's name, ever. Every change asks first, in place. A failed read says "Could not be read" in its own block. The data comes from `lib/api/productTesting.js`; add no `/api/*` method here.
