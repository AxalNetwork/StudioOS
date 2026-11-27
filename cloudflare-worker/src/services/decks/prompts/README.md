# Deck prompts

D1519 (#3771, deck v2 A20). Every prompt a deck run sends a model, one file per element and model family, so several models write one deck in one voice and every reply can name the prompt that wrote it.

| File | What it is |
| --- | --- |
| `index.ts` | `REGISTRY` and `promptFor(element, model, voice)`: the model's family file (else `default`), opened with the voice preamble, wrapped in the untrusted-data rule (D1506), named `<element>.<family>@v<version>`, the `prompt_version` a reply carries. |
| `voice.ts` | `HOUSE_VOICE`, `voicePreamble` (with `theme.voice` framed as data), `GLOSSARY` and `glossaryProblems`/`deckGlossary`, and `familyOf` (the family a catalogue id belongs to). |
| `outline.default.ts` | The outline run (`POST /api/decks/outline`). |
| `build.default.ts` | The build run (the one-click words on every card), for a model with no family file. |
| `build.llama.ts`, `build.mistral.ts`, `build.glm.ts` | The build run adapted to one family's habits. Each keeps `build.default.ts`'s template: a family changes how a model is asked, never what. |
| `assist.default.ts` | The per-area text press (`POST /api/decks/:id/cards/:card/assist`). |

## The rule for adding here

A prompt file is `<element>.<family>.ts` and exports exactly `{ version, system, template }`. A family file keeps its element's template. Raise `version` when the words change. Any change here changes the prompts hash, and `.github/workflows/prompt-eval-gate.yml` fails until the element eval is re-run and `node scripts/check-prompt-eval.mjs --write` records the new hash in `documentation/product/ELEMENT_EVAL.md`, or the owner adds the `prompt-eval-waiver` label. No model id is named here: families are read from the catalogue id's vendor (`familyOf`).
