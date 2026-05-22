# Deck Autofill — field coverage audit

Task #14. Walks every template-bound field across all 12 deck methods and
records whether the platform actually has somewhere to read that value
from. The auto-fill engine (`cloudflare-worker/src/services/decks/autofill.ts`)
resolves each field's `sources` list in order:

```
project.<col>        → column on the `projects` row
project.derived.<k>  → computed string (ask_line, runway_target)
financials.<k>       → key on `financial_models.computed_json`
captable.<k>         → derived from `cap_table_holders` rows
ai.<hint>            → Workers-AI / OpenAI fallback
```

When every source in the list comes back null the renderer drops the
slide's "—" placeholder, which is what the user sees when a whole slide
fades to dashes.

## projects (columns)

| Source expression           | Status before #14 | Status after #14 | Where the value comes from |
|-----------------------------|-------------------|------------------|----------------------------|
| project.name                | PRESENT           | PRESENT          | Project Builder            |
| project.description         | PRESENT           | PRESENT          | Project Builder            |
| project.sector              | PRESENT           | PRESENT          | Project Builder            |
| project.stage               | PRESENT           | PRESENT          | Project Builder            |
| project.problem_statement   | PRESENT           | PRESENT          | Project Builder            |
| project.solution            | PRESENT           | PRESENT          | Project Builder            |
| project.why_now             | PRESENT           | PRESENT          | Project Builder            |
| project.tam                 | PRESENT           | PRESENT          | Project Builder            |
| project.sam                 | PRESENT           | PRESENT          | Project Builder            |
| project.users_count         | PRESENT           | PRESENT          | Project Builder            |
| project.revenue             | PRESENT           | PRESENT          | Project Builder            |
| project.growth_signals      | PRESENT           | PRESENT          | Project Builder            |
| project.cost_to_mvp         | PRESENT           | PRESENT          | Project Builder            |
| project.funding_needed      | PRESENT           | PRESENT          | Project Builder            |
| project.use_of_funds        | PRESENT           | PRESENT          | Project Builder            |
| **project.tagline**         | MISSING           | **ADDED (069)**  | Advisor `founder.project.tagline` |
| **project.logo_url**        | MISSING           | **ADDED (069)**  | Advisor `founder.project.logo_url` |
| **project.som**             | MISSING           | **ADDED (069)**  | Advisor `founder.project.som_usd` |
| **project.cac**             | MISSING           | **ADDED (069)**  | Advisor `founder.project.cac_usd` |
| **project.gross_margin_pct**| MISSING           | **ADDED (069)**  | Advisor `founder.project.gross_margin_pct` |
| **project.contact_email**   | MISSING           | **ADDED (069)**  | Advisor `founder.project.contact_email` |
| **project.vision**          | MISSING           | **ADDED (069)**  | Advisor `founder.project.vision` |
| **project.traction_summary**| MISSING           | **ADDED (069)**  | Advisor `founder.project.traction_summary` |

## financial_models.computed_json (keys)

All template-bound financial values are read from the existing
`computed_json` blob written by the financial-model engine. No schema
change required — the keys below are produced by
`routes/financials.ts::computeModel()` and surface to the resolver via
`resolveFinancialsSource()`:

| Source expression                 | Status   | Notes |
|-----------------------------------|----------|-------|
| financials.runway_months          | PRESENT  | computed_json |
| financials.avg_monthly_burn       | PRESENT  | computed_json |
| financials.ending_cash            | PRESENT  | computed_json |
| financials.total_revenue_horizon  | PRESENT  | computed_json |
| financials.ltv                    | PRESENT  | computed_json (when LTV inputs filled) |
| financials.ltv_cac_ratio          | PRESENT  | computed_json (when LTV + CAC filled) |
| financials.breakeven_month        | PRESENT  | computed_json (null until break-even reached) |

No ALTER required: every key is JSON, so adding a column would be
redundant. The autofill engine treats a missing key the same as a
missing column (falls through to AI then placeholder).

## cap_table_holders (rows)

| Source expression       | Status  | Derivation |
|-------------------------|---------|------------|
| captable.founders       | PRESENT | rows where `kind ~ /founder/i`, name list |
| captable.holders        | PRESENT | top 8 rows, "Name — pct%" |
| captable.founder_pct    | PRESENT | sum(founder shares) / sum(all shares) |
| captable.total_shares   | PRESENT | sum(shares) |

No ALTER required — every derived value comes from existing columns
(`name`, `shares`, `kind`).

## metrics_snapshots, rounds

Templates do not currently bind to these tables (all financial values
flow through `financial_models.computed_json`). No ALTER required for
the current 12 templates. Reserved for future template growth.

## After-state guarantee

Once migration 069 lands and the advisor banks are extended:

1. Every `project.*` source in every template has either a column to
   read from OR an advisor question that writes to that column.
2. The autofill route persists a slide JSON blob where every field has
   `source: 'data'` whenever the underlying value is set — no slide
   should render entirely as "—" if the founder has answered the
   matching advisor questions.
3. The `cloudflare-worker/test/decks.autofill.test.ts` test asserts
   zero `'—'` placeholders for the YC seed, Series A growth, and
   Series B diligence templates when projects + financial_models +
   cap_table_holders are fully populated.
