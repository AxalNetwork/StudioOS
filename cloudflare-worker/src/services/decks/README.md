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
| `pptx.ts` | PowerPoint export: one picture per card (the download), the text-only fallback, and `notesPackageParts`, the package both writers share. |
| `pptxEditable.ts` | The editable PowerPoint for Google Slides (D904): every block at its place on the print card, text as text boxes, PNG/JPEG/GIF images and chart shots as pictures, and words for anything that cannot be pictured. |
| `branding.ts` | Logo, colours, lock-up. |
| `recommend.ts` | Slide-level suggestions. |
| `methods.ts` | Shared helpers. |
| `newDeck.ts` | D897 (#2677): New deck, pure. The card catalogue and the three lengths, `numberIn` and `figureRefusal` (a prompt is never a source), the outline from the model or the founder, the run messages (figures as read-only facts), `wordingFromModel` (words that name a number are dropped), and `buildCards`: every figure a bound metric block and `auto` field, an empty slot Not recorded. D897 §9 (#3659): a message per card and the audience's order (`AUDIENCE_EMPHASIS`), `planOf`, and composition by evidence (`chooseLayout`, D898 §8): bound chart series, bound lines, and words that do not fit moved to the notes. |
| `images.ts` | D903 (#2682): the deck's images. What a request may ask for (`askOf`), what is refused before anything runs (`personIn`, `asksForChart`), the prompt FLUX.1 Schnell is given, the overlay's worst-case contrast (`overlayContrast`, 4.5:1) and the balance check before the hold (`balanceRefusal`). |
| `assist.ts` | D899 (#2678): the card tools, pure. Each press's rail option, the text messages, `wordingProblem` (a wording may name only the figures the founder's text already had; a headline none), `chartMessage` (keys and labels, never values) and `chartBlock` (the recorded keys the model named, each series a binding through `sanitizeBinding`). |
| `slideModel.ts` | D898 (#2676): the editor's slide model. The twelve layouts as presets of the 12 × 6 grid, the eight block kinds, the twelve chart types, the audiences and themes; `sanitizeModel` (what every stored read keeps, so an old deck opens), `modelProblems` (why a save is refused) and `contentHash`. A binding is `sources.ts`'s `sanitizeBinding`. |
| `videoLink.ts` | D898, PD8c: a video block's YouTube or Vimeo link, checked with the provider's own oEmbed endpoint before it is placed. Two fixed URLs, no redirect followed, the poster on the provider's image host; behind `GET /api/decks/video-link`. |
| `deckVersionColumns.ts` | D898: migration 539's four `pitch_decks` columns where it has not run, awaited by both runtime creators of the table. Imports nothing, so the advisor's write router can call it. |
| `sources.ts` | D896 (#2675): `DECK_SOURCES`, one read-only adapter per row of #2434's sources table, a fixed slot list, `sourceAndGrade` (the one origin → Source and grade mapping), coverage, snapshot hashes and the binding compare behind `POST /api/decks/:id/refresh`. Writes nothing; no model runs. |
| `designSystem.ts` | D898 §8 (#3658): the design system on main's v1 ids. Theme tokens per theme kind (type scale, colour roles, chart palette, image treatment) with legibility checks and checked brand-kit overrides (`themeTokens`); layout budgets from grid geometry and density caps (`LAYOUT_BUDGETS`, `textCapacity`); what each layout needs and falls back to (`LAYOUT_NEEDS`); the layout a card's evidence earns (`ROLE_LAYOUTS`, `chooseLayout`); and what would overflow at 16:9 (`fitProblems`). Pure. |
| `visuals.ts` | D903 §10 (#3660): visuals from records and Cloudflare only. `recordDiagrams` (the roadmap timeline from Build's objectives, use of funds as a flow by name only, the competitor 2 × 2 from recorded price and depth), `chartTypeFor` (how a bound series reads best), `imageCapability` (the `AI` binding and the model generally available in the catalogue), `artDirection` (one style and palette per deck) and `imagePlan` (the words-only cards an illustration helps; a proposal, never a generation). |
| `diagramModel.ts` | D898 §8.4 (#3658): the optional, versioned `diagram` on a `graphic` block (timeline, flow, cycle, matrix): editable labelled steps, read by `slideModel.ts`. |
| `chartSeries.ts` | D898 group C (#2676): `CHART_SERIES`, the dated series a deck chart plots (Grow's monthly snapshots, Stripe and typed apart; Validate's interviews per week), each with its points, Source, grade and snapshot; `chartFits`, how many each of the twelve chart types can draw and why not. Read by `GET /api/decks/chart-series` and the refresh. Writes nothing; no model runs. |

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
