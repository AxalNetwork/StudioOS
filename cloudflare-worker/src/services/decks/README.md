# services/decks — pitch-deck assembly and export

Builds the deck payload from the venture's real records and renders it.

| File | What it does |
| --- | --- |
| `spinoutDeckData.ts` | Gathers the venture's data into the deck payload. |
| `spinoutDeckOverrides.ts` | Founder edits layered over that payload. |
| `autofill.ts` | Fills slide fields from the payload. |
| `axalSpinoutDemoDay.ts` | The Demo Day deck variant. |
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
