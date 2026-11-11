### Deck v2 operations: the Grid runbook (D1547, #3792)

No new route. These are the routes HQ uses to run the deck builder's generation path; `documentation/operations/DECK_GRID.md` gives the steps, and `cloudflare-worker/test/deck_grid_runbook_d1547.test.ts` runs its SQL.

- **Switch off a model:**
  - Screen: HQ › Decks › AI models (`/admin/platform/decks/models`).
  - Route: `PUT /api/admin/ai/element-models` (`routes/admin_ai_element_models.ts`, Super Admin, D4251).
- **Refund a batch:**
  - Screen: HQ › AI allowances (`/admin/platform/allowances`).
  - Routes: `POST /api/ai-budget/reviews/:uid/refund` and `POST /api/ai-budget/members/:userId/adjustments` (`routes/ai_budget.ts`, Super Admin, D755).
- **Unstick a batch:**
  - Routes: `POST /api/decks/areas/batches/:uid/cancel` and `/retry-failed` (`routes/deck_batches.ts`, the starter only).
  - When those are not enough, the runbook's D1 statements.
- **Purge an image:**
  - Route: `GET /api/decks/images/:uid/file` (`routes/deck_images.ts`) answers 404 once the row is `discarded`.
  - The R2 object in `studioos-files` is deleted with wrangler.
