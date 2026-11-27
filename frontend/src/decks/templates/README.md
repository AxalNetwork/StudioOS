# decks/templates — pitch-deck slide templates

The deck layouts a founder can pick from, plus their per-slide components. The
payload they render comes from
`cloudflare-worker/src/services/decks/spinoutDeckData.ts`.

`scripts/check-deck-templates.mjs` verifies every template is wired, and
`scripts/check-deck-payload-wiring.mjs` verifies every field in the payload
reaches a consumer — a field nothing renders is data collected for nothing, and
a slide reading a field that is not in the payload renders blank.

## The rule

**A deck is shown to investors.** An unanswered field renders an empty state
that prompts the founder to fill it, never a plausible placeholder. This is the
single worst surface in the product for an invented number, and the deck tests
treat it that way.
