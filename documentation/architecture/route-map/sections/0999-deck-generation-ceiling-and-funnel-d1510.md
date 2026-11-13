### Deck generation: the daily ceiling everywhere, HQ alerts, run points, the funnel and the accept rate (D1510, #3761)

The rules live in `services/decks/observability.ts`. The ceiling is D1540's owner-set `DECK_DAILY_CEILING_MICROUSD` (`services/decks/runQuotes.ts`). Unset means off, and HQ reads it as "Not set".

- **Ceiling.** A run that would take today's deck spend past the ceiling is refused 429 `deck_ceiling_reached` with "Generation is paused for today. Manual editing still works.", before any hold. It now covers:
  - `admitDeckRun` (`services/decks/genRooms.ts`): area runs (`POST /api/decks/:id/areas`), the whole-deck build (`deck_build`), `POST …/areas/batches/:uid/retry-failed` and any later autopilot run. A replay of a run already admitted is answered as before.
  - `POST /api/decks/:id/images` and `POST /api/decks/:id/images/replace-all`.
  - `POST /api/decks/:id/cards/:card/assist`.
  - Still, from D1540: `/outline`, `/generate` and `/proposals/:id/regenerate-card`.
- **HQ alerts.** At 50% and 80% of the ceiling, each active HQ admin gets one in-app notice and one email (type `deck_ceiling_alert`), once per UTC day each. The check runs when a run is admitted and when one ends.
- **Analytics Engine** (`ANALYTICS`, dataset `studioos_metrics`), ids and codes only, in the dataset's layout: blob1 is the kind (never a path, so the traffic readers skip it) and blob6 is the branch (`branchOf(env)` or `hq`).
  - **`deck:run`**: one point per finished run, from the driver that closed it. Blobs: kind, class, end state, runtime, run uid, branch, deck id, venture id. Doubles: hold, charge, steps, done, failed, seconds.
  - **`deck:funnel`**: one point per event. Blobs: kind, event, deck id, venture id, proposal id, branch, `one_click`. The events:
    - `structure_change`: `PUT /api/decks/:id` when a kept card's structure changed;
    - `share`: every link `createShareLink` makes;
    - `build`: `POST /api/decks/generate`;
    - `accept_all`: `keep-slides` saving every card;
    - `accept_all_present`: the same save with `present: true`.
- **HQ read.**

| Route | Who | Answer |
| --- | --- | --- |
| `GET /api/admin/deck-generation?days=30` | an HQ admin (`requireHqAdmin`; a branch is refused) | `{ ceiling: { ceiling_microusd, spent_today_microusd, percent, paused }, alert_thresholds: [50, 80], days, accept_rates: [{ element, model, model_label, proposals, decided, accepted, accepted_all, discarded, regenerated, accept_rate, first_result_seconds }] }`. `ceiling_microusd` is null when not set; a figure that cannot be read is null, never 0. `days` runs from 1 to 365, else 400 `invalid_days`. Counts only: no founder, title or words. |

- **Accept rate:** accepted (Accept or Accept all) over decided (accepted, discarded, superseded or expired), per element and the model its area ran on (null for a records element). It reads A3's `deck_area_proposals` (#3764, D1512), and the model and timings come from the run's steps.
- **Client:** none here. The page already draws the refusal through `refusalOf`, and B10 (#3786) draws HQ's read. `OneClickBuild.jsx` sends `present: true` with Accept all and present.
