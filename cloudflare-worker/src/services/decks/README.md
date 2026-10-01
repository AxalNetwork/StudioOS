# services/decks — pitch-deck assembly and export

Builds the deck payload from the venture's real records and renders it.

| File | What it does |
| --- | --- |
| `spinoutDeckData.ts` | Gathers the venture's data into the deck payload. |
| `spinoutDeckOverrides.ts` | Founder edits layered over that payload. |
| `autofill.ts` | Fills slide fields from the payload. |
| `axalSpinoutDemoDay.ts` | The Demo Day deck variant. |
| `deckRoster.ts` | What the Demo Day deck does with the Advisors & Partners roster, in one place (D214): the first `DECK_ROSTER_PROFILES` active rows become the Team & Network slide's profiles, the first `DECK_ROSTER_NAMES` named rows its names list, and every other active row is only counted. The deck and HQ's Content page both call it, so the page cannot mark a row "on the deck" that the deck drops. Imports nothing, so the Content summary does not pull in the deck assembler. |
| `render.ts` | Slide rendering. |
| `pptx.ts` | PowerPoint export. |
| `branding.ts` | Logo, colours, lock-up. |
| `recommend.ts` | Slide-level suggestions. |
| `methods.ts` | Shared helpers. |

## The rule

**A slide with no data says so.** `scripts/check-deck-payload-wiring.mjs`
asserts every field in the payload reaches a consumer, and the deck tests assert
that an unanswered field renders an empty state rather than a plausible number.
A pitch deck is shown to investors; an invented figure on one is the worst place
in the product for this to go wrong.
