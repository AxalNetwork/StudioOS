### Deck grid health and funnel (D1537, #3786, deck v2 B10)

- **Worker, `routes/admin_deck_grid.ts`** (self-mounting at `/api/admin/ai/deck-grid`, HQ admins only via `requireHqAdmin`; a branch is refused):
  - `GET /api/admin/ai/deck-grid?days=30` → `{ days, rows, budget }`: per element and model, steps, error rate, p95 against its target, cost, fallbacks, drift and eval score (not recorded); the 28-day error budget. `rows` or `budget` is null when it cannot be read.
  - `GET /api/admin/ai/deck-grid/funnel?days=30` → `{ days, generations, quote_conversion, accept_rates, first_share, retention_4w }`, each null when it cannot be read.
  - 400 `invalid_days` outside 1 to 90.
- **Cron:** at :17 each hour on HQ, `noteErrorBudgetAlert` tells each active HQ admin once per hour when the last hour burned a quarter of the error budget (`deck_error_budget_alert`).
- **Frontend:** HQ › Decks › Grid health (`/admin/platform/decks/grid`; `/admin/ai/deck-grid` (retired D2319) redirects there) and Funnel (`/admin/platform/decks/funnel`), `pages/hq/decks/DeckGridTab.jsx`. Client `lib/api/adminDeckGrid.js` (`grid`, `funnel`, and `generation` over D1510's `GET /api/admin/deck-generation`). No canvas draws these pages; they follow the AI models tab (S1, 2026-11-02).
