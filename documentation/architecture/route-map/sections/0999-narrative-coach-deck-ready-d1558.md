### Investor narrative › the coach and "Deck ready to send" (D1558, #3805)

- **`cycle_raise.ts`** (over `services/narrative/coach.ts`):
  - `GET /api/cycles/raise/deck-ready?project=`: computed from the venture's current deck version, free. `state` is `ready`, `not_ready` or `no_deck`. Each row names one area of one card and its `href` opens the editor there (`/raise/pitch/edit?project_id=&card=<uid or place>&area=c1-6r2-4`). An unreadable deck answers 503, never "ready".
  - `POST /api/cycles/raise/narrative/:version/coach?project=`: one `rail_write` run under `review:narrative-coach`, the version's sections against the current deck with every figure masked. Findings with proposals, each kept only when its section, card and area are real and it names no figure. Writes nothing.
- **Frontend:** `narrativeCoachApi` in `frontend/src/lib/api/narrativeCoach.js`; `NarrativeCoach.jsx` beside Story; `PitchEditor.jsx` reads `card` and `area` through `deckLinkModel.js`.
