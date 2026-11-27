### Pitch › Share & analytics: the daily read (D4272, #4272)

- **`deck_slide_analytics.ts`**: `GET /api/decks/:id/analytics/daily?from&to&version&nda=all|yes|no` answers the deck's venture across its versions (`services/decks/shareDaily.ts`):
  - `days`: views per day, NDA against open, with first views;
  - `funnels { nda, open }`: sent → opened → NDA shown → accepted → reached the ask;
  - `dropoff { current, previous }`: seconds per card and the drop after each, on two versions;
  - `versions`.

  The venture's writers only. At most 90 days (422 past it). A value nobody counted is null, never 0. No migration.
- **Frontend:** `deckSlideAnalyticsApi.daily` in `frontend/src/lib/api/deckSlideAnalytics.js`. The tile (ps7) follows P1's tile row (#4274). The Pitch deck module's New link form is retired; `ShareDialog.jsx` is the only link writer's form (D-d).
