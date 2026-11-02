# cloudflare-worker/test/fixtures — recorded and synthetic inputs for the worker tests

Data the tests read, never code under test. Everything here is SYNTHETIC or
a public price list: no real person, venture, figure or credential.

| File | What it is | Read by |
| --- | --- | --- |
| `advisor-scenarios.json` | Advisor conversation scenarios | `advisor.scenarios.test.ts` |
| `profiling-v2-personas.json` | Profiling v2 personas | `profiling_v2_personas_fixture.test.ts` and the profile bank and scoring tests |
| `pitchStoryFixtures.ts` | Full, sparse and conflicting venture records as `readSources` items (D897 §9) | `deck_new_d897.test.ts`, `deck_visuals_d903.test.ts` |
| `pitchReferenceDecks.ts` | Reference decks for the deck design system | `deck_design_system_d898.test.ts` |
| `workers_ai_catalogue.json` | The Workers AI catalogue snapshot (D760) | `ai_catalogue_d760.test.mjs` |
| `workers_ai_pricing_rows_2026-10-31.md` | Workers AI price rows on 2026-10-31 | `ai_catalogue_d760.test.mjs` |
| `fake_ai_recordings.json` | D1511: the fake AI binding's recorded outputs (`../_recorded_ai.mjs`) | `recorded_ai_d1511.test.ts`, `frontend/tests/visual/server.ts` |
| `oneClickVenture.ts` | D1511: a venture whose records fill every card of the one-click deck, written into the migrated schema | `recorded_ai_d1511.test.ts`, `frontend/tests/visual/server.ts` |

## Rules

- A fixture is data. Logic a test needs goes in a `_helper` beside the tests.
- Synthetic only: names like "Synthetic Founder", emails under
  `example.invalid`, figures made up.
- A recorded model output names no figure a card would show: code places every
  figure from the records (D897).
