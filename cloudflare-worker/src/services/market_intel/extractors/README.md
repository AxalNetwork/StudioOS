# market_intel/extractors — what is pulled out of a source

Each extractor turns fetched source material into one kind of structured signal.

| File | Extracts |
| --- | --- |
| `sector_heat.ts` | Sector activity level. |
| `demand_supply.ts` | Demand and supply imbalance. |
| `sentiment.ts` | Directional sentiment. |
| `fit_match.ts` | Fit between a venture and a thesis. |
| `thesis_embedding.ts` | Thesis vectors for similarity. |
| `talc_position.ts` | Position on the adoption curve. |
| `partner_compensation.ts` | Partner compensation signals. |
| `shared.ts` | Helpers common to all of them. |
| `index.ts` | The registry. |

## Rules

- Conform to `../extractor_schema.ts`. An extractor returning a shape the
  reducer does not expect drops its output silently.
- **Return nothing rather than a guess.** An extractor that cannot find its
  signal returns empty; a low-confidence value dressed as a finding is worse
  than a gap, because the gap is visible and the guess is not.
- Carry the source through. An extracted value that loses its provenance cannot
  be rendered.
