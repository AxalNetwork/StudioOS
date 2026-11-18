### Raise › Overview: stage, primary action, Pitch state and investor activity (D6045, #6045)

- **`cycle_raise.ts`** (over `services/raiseJourney.ts`): `GET /api/cycles/raise/overview?project=` also returns `stage` (Prepare, Build the story, Prepare diligence, Run the raise), `primary_action { key, label, href, rule }` (RA-03; null for staff), the Pitch card's `pitch_state` (`no_deck`, `draft`, `saved`, `reviewed`, `shared`, RA-05) and `investor_activity` (RA-02: pipeline, deck views over 8 weeks, call responses this month, each source with its own read state and freshness). An unreadable source makes what it feeds `{ state: 'unreadable', reason }`, never a guessed stage. Canvas: `Raise v2 Page.dc.html` RA-01 to RA-05 (D4863).
- **Frontend:** none yet; Raise V2 build 2/5 draws it.
