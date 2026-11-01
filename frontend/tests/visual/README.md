# `frontend/tests/visual/`

D1511 (#3762, deck v2 A18). Visual regression and axe on the Pitch deck
editor, run by `frontend/playwright.visual.config.js` in the pinned container
of `.github/workflows/deck-visual.yml`.

| File | What it is |
|---|---|
| `harness.html`, `harness.jsx` | The real `PitchEditor` (GridStage, CardsStrip, AreaLightbox, InstructionBox, DeckToolbar, DeckMoreMenu, DeckAsk), mounted with its reads stubbed and the fonts from the pinned `@fontsource` packages. No network. |
| `fixture.json` | What the harness reads: the model, every theme the Worker serves, the 17 structures, each aspect's Grid reply and the accepted one-click deck. Built from the Worker's modules by `cloudflare-worker/test/deck_visual_fixture_d1511.test.ts`, which fails when they change. |
| `harnessData.js` | The harness's data for one run, read from `fixture.json`. |
| `deck_editor.visual.spec.js` | The screenshots (17 structures × themes × 2 aspects, and the one-click deck) and the axe checks (light, dark, the keyboard path, the Ask dialog, phone and tablet). |
| `__screenshots__/` | The baselines. CI writes them in the pinned container and commits them; never add one made on a laptop. |

## Rules

- **A baseline comes from CI.** To redraw one on purpose, delete its PNG and
  push; the next run writes it and commits it for review.
- **The fixture follows the Worker.** When a structure, a theme or the build
  changes, regenerate it with `UPDATE_VISUAL_FIXTURE=1` (see the test's header).
- **Nothing reaches a network.** Every read the editor makes is stubbed in
  `harness.jsx`, and the spec refuses any other `/api/` call.
