# frontend/src/pages/productTesting — "Apply for Product Testing" (D814)

A member's side of product testing: boards D2 and D3 of the "StudioOS · Newsletter and Product testing" prompt (prompt 2 on #2255). The Worker is D812's (`cloudflare-worker/src/routes/testing.ts`), read through `productTestingApi` in `frontend/src/lib/api/productTesting.js`. The partner's and HQ's screens are D815's, not here.

| File | What it is |
| --- | --- |
| `ProductTestingCard.jsx` | D2, the Studio card: "Test new products before they launch", the open count from `GET /api/testing/summary`, a "You're in" badge per pick, and "See programmes". The founder's, investor's, advisor's and operating partner's Studio pages mount it. A role preview draws nothing. |
| `ProductTestingPage.jsx` | D3, `/product-testing`: the Open programmes and My applications tabs (`?tab=`), the programme cards, the application sheet with the required consent, and Withdraw. Desktop and phone, in `RailFrame` with its rail. |
| `productTestingModel.js` | The pure rules both share: why Apply is held, the status pills, what can be withdrawn, and the words for counts, places and dates. |

**The rule for adding here:** a member's product-testing surface only, on D812's routes. No new `/api/*` method: add one to D812's module first, with its Worker route. The tests are `frontend/test/product_testing_d814.test.mjs`.
