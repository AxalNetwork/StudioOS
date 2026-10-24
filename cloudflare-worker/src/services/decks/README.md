# services/decks — pitch-deck assembly and export

Builds the deck payload from the venture's real records and renders it.

| File | What it does |
| --- | --- |
| `spinoutDeckData.ts` | Gathers the venture's data into the deck payload. |
| `spinoutDeckOverrides.ts` | Founder edits layered over that payload. |
| `autofill.ts` | Fills slide fields from the payload. |
| `axalSpinoutDemoDay.ts` | The Demo Day deck variant. |
| `deckRoster.ts` | What the Demo Day deck does with the Advisors & Partners roster, in one place (D214): the first `DECK_ROSTER_PROFILES` active rows become the Team & Network slide's profiles, the first `DECK_ROSTER_NAMES` named rows its names list, and every other active row is only counted. The deck and HQ's Content page both call it, so the page cannot mark a row "on the deck" that the deck drops. Imports nothing, so the Content summary does not pull in the deck assembler. |
| `render.ts` | The slide types the export writers share. Its CDN-Tailwind `renderDeckHTML` had no caller and was removed (D901). |
| `offlineHtml.ts` | The HTML export (D901): one self-contained file of a version. The fonts are inline, every image is a `data:` URI, and the CSP is `default-src 'none'`. Its one script is keyboard navigation, admitted by its hash. |
| `pptx.ts` | PowerPoint export. |
| `branding.ts` | Logo, colours, lock-up. |
| `recommend.ts` | Slide-level suggestions. |
| `methods.ts` | Shared helpers. |
| `slideModel.ts` | D898 (#2676): the editor's slide model. The twelve layouts as presets of the 12 × 6 grid, the eight block kinds, the twelve chart types, the audiences and themes; `sanitizeModel` (what every stored read keeps, so an old deck opens), `modelProblems` (why a save is refused) and `contentHash`. A binding is `sources.ts`'s `sanitizeBinding`. |
| `videoLink.ts` | D898, PD8c: a video block's YouTube or Vimeo link, checked with the provider's own oEmbed endpoint before it is placed. Two fixed URLs, no redirect followed, the poster on the provider's image host; behind `GET /api/decks/video-link`. |
| `deckVersionColumns.ts` | D898: migration 539's four `pitch_decks` columns where it has not run, awaited by both runtime creators of the table. Imports nothing, so the advisor's write router can call it. |
| `sources.ts` | D896 (#2675): `DECK_SOURCES`, one read-only adapter per row of #2434's sources table, a fixed slot list, `sourceAndGrade` (the one origin → Source and grade mapping), coverage, snapshot hashes and the binding compare behind `POST /api/decks/:id/refresh`. Writes nothing; no model runs. |

## The rule

**A slide with no data says so.** `scripts/check-deck-payload-wiring.mjs`
asserts every field in the payload reaches a consumer, and the deck tests assert
that an unanswered field renders an empty state rather than a plausible number.
A pitch deck is shown to investors; an invented figure on one is the worst place
in the product for this to go wrong.

D895: founder decks hide internal readiness scores; the Lab assembler keeps them
by default. Ask runway comes only from stored model/Mercury records. AI-written
fields do not count as record coverage. Exports use the venture owner's branding,
and the newest live landing page supplies voice and both logo variants.
