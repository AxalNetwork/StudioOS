# Fund data model

## Recommendation

Use **one canonical fund registry with explicit visibility**, then separate the registry from fund vehicles, observations, LP disclosures, confidential commitments, and quarterly reports.

The important boundary is:

- `/research/funds` is a founder's **private research shortlist**. Keep `research_funds` owner-scoped.
- The fund directory is a **shared discovery catalog**. It may contain public and licensed data, but it is not a founder's research judgment.
- `vc_funds` is the current **operational GP fund** model. It already powers GP, LP, capital-call, and report-period workflows and should not be replaced in one release.
- Quarterly reports are **period snapshots**. Once issued, their numbers and narrative must not change under the same period label.

This makes it possible to show real public fund records without copying them into every user's private shortlist, while still supporting confidential LP commitments and GP reporting.

## Current repository model

The repository already has useful pieces:

| Current table | Keep / change | Reason |
|---|---|---|
| `research_funds` | Keep as-is for the founder shortlist | It is owner-scoped and records the founder's own thesis, stage fit, path, pass reason, and notes. |
| `vc_funds` | Keep as the operational compatibility table; extend gradually | It contains GP ownership, fund size, vintage, fees, service providers, and status. |
| `limited_partners` | Keep for actual private commitments; migrate money fields over time | It represents a commitment to a specific operational fund, not a public LP mention. |
| `fund_report_periods` | Keep as the issued-period archive; add typed period metrics | Its immutable `snapshot_json` is valuable for reproducibility, but JSON alone is weak for querying. |
| `fund_distributions` / `fund_capital_calls` | Keep | These are event ledgers and should remain separate from valuation snapshots. |
| `portfolio_positions` | Keep and add historical marks | A current position row cannot reproduce a prior quarter's NAV without a history table. |

Do **not** make `research_funds` the public master table. Doing so would leak founder-specific notes, duplicate every catalog row per user, and make the page's `Researched` count stop meaning what it says.

## Target entities

### 1. `fund_registry`

The canonical logical identity of a manager's fund strategy or fund family. One row can be public or private.

Suggested fields:

- `id`, `uid`, `canonical_name`, `display_name`
- `visibility`: `public | private | restricted`
- `record_type`: `fund_family | strategy | vehicle`
- `manager_organization_id` / `manager_company_id`
- `website`, `hq_country`, `domicile_country`
- `strategy`, `asset_class`, `stage_focus`, `sector_focus_json`, `region_focus_json`
- `status`: `fundraising | active | closed | wound_down | unknown`
- `first_vintage_year`, `latest_vintage_year`
- `created_by_user_id`, `owner_company_id`
- `created_at`, `updated_at`

`visibility` must be explicit. A missing value is not permission to publish.

### 2. `fund_vehicles`

A logical fund is not always the same as a legal vehicle. Store Fund I, a Delaware LP, a Cayman feeder, a parallel vehicle, and an SPV separately.

Suggested fields:

- `id`, `uid`, `fund_registry_id`
- `legal_name`, `vehicle_type`, `jurisdiction`
- `currency`, `vintage_year`, `close_date`, `final_close_date`
- `target_size_cents`, `hard_cap_cents`, `committed_capital_cents`
- `management_fee_bps`, `carried_interest_bps`, `hurdle_rate_bps`
- `gp_entity_id`, `management_company_id`, `fund_admin`, `auditor`, `legal_counsel`, `custodian`
- `visibility`, `owner_company_id`, `status`
- `created_at`, `updated_at`

Use integer cents for money and integer basis points for percentages. Do not use `REAL` dollars for new fields.

A practical compatibility path is to let `vc_funds` represent a vehicle first and add `fund_registry_id` to it. Later, the operational routes can move to `fund_vehicles` without changing the founder directory contract.

### 3. `fund_aliases` and `fund_identifiers`

Public datasets will call the same fund different things. Store aliases instead of relying on fuzzy matching forever.

Suggested fields:

- `fund_registry_id` or `fund_vehicle_id`
- `alias_name`, `normalized_name`
- `identifier_type`: `source_id | website_domain | crunchbase_uuid | harmonic_id | lei | regulatory_id`
- `identifier_value`
- `source_id`, `confidence_bps`, `is_primary`

Unique constraints should be scoped by source and identifier value. Name alone is never a safe identity key.

### 4. `fund_sources`

Every public or private fact should be traceable to a source record.

Suggested fields:

- `id`, `uid`, `source_type`: `official_site | gp_report | regulatory_filing | public_mapping | provider | press_release | lp_disclosure | user_entered`
- `provider_name`, `source_url`, `source_document_id`, `raw_r2_key`
- `retrieved_at`, `source_as_of_date`, `license_note`, `content_hash`
- `import_batch_id`, `confidence_bps`
- `created_by_user_id`, `visibility`

For the current catalog, the two attached public mapping exports should become one versioned import batch with a source row per file. The frontend JSON remains a fast discovery artifact; D1/R2 should become the long-term source of truth when the directory is moved server-side.

### 5. `fund_metric_observations`

Do not put AUM, NAV, TVPI, or IRR as one mutable column on `fund_registry` or `vc_funds`. They are time-dependent observations and may have different scopes and bases.

Suggested fields:

- `id`, `fund_registry_id`, nullable `fund_vehicle_id`
- `metric_code`: `aum | committed_capital | called_capital | nav | deployed_capital | distributed_capital | dry_powder | gross_irr | net_irr | gross_tvpi | net_tvpi | dpi | rvpi | lp_count`
- `scope_type`: `manager | fund_family | strategy | vehicle`
- `value_cents` for money metrics, nullable `value_bps` for rates, nullable `value_integer` for counts
- `currency`, `basis`: `reported | estimated | calculated | modeled`
- `as_of_date`, `period_start`, `period_end`
- `source_id`, `confidence_bps`, `is_public`
- `supersedes_observation_id`, `created_at`

Rules:

1. AUM must always carry a scope and an as-of date. “AUM” without those fields is not a usable fact.
2. Missing AUM stays `NULL`; it is not zero.
3. Reported and estimated values must never be blended in the same displayed series without a label.
4. A metric correction inserts a new observation and links `supersedes_observation_id`; it does not rewrite history.
5. A public fund-size field from a mapping export is not automatically AUM. Store it under the metric and basis the source supports, such as `committed_capital` / `reported` or `fund_size` if a separate code is needed.

### 6. Public LP disclosures vs private LP commitments

These are different facts and should be different tables.

#### `fund_lp_disclosures` — public / licensed discovery data

Use this for a named LP appearing on a public page, a reported LP count, or an LP disclosed in a filing.

Suggested fields:

- `fund_registry_id` / `fund_vehicle_id`
- `lp_organization_id` nullable, `lp_name_as_reported`
- `disclosure_type`: `named_lp | lp_count | commitment_amount | allocation_percent`
- `value_cents`, `value_bps`, or `value_integer`, as applicable
- `as_of_date`, `source_id`, `confidence_bps`, `visibility`
- `created_at`, `supersedes_disclosure_id`

Do not infer a commitment amount from a named LP. Do not turn an LP list on a public source into a private account relationship.

#### `limited_partners` — confidential operational commitments

Keep the existing table for an LP's actual commitment to an operational vehicle, including account linkage, KYC state, calls, distributions, and statements. Access must remain GP/admin/LP scoped.

A future cleanup should:

- add `vehicle_id` or rename `fund_id` to make the vehicle level explicit;
- migrate `commitment_amount`, `invested_amount`, and `returns` from `REAL` dollars to integer cents;
- split account identity from operator-entered organization identity where needed;
- retain `user_id` as nullable because an institutional LP may not have an Axal account.

### 7. Quarterly reporting

Use four layers rather than one JSON blob:

#### `fund_reporting_periods`

One row per vehicle and period, with a unique key on `(vehicle_id, period_end)`.

- `period_code`, `period_start`, `period_end`
- `status`: `draft | issued | corrected | void`
- `issued_at`, `issued_by_user_id`, `corrects_period_id`
- `narrative_json` for the GP letter and commentary
- `snapshot_hash`, `report_document_id`, `created_at`, `updated_at`

The existing `fund_report_periods` already follows this principle. Keep it compatible and add a vehicle-level foreign key when the registry split lands.

#### `fund_period_metrics`

Typed, queryable numbers for the period:

- `reporting_period_id`, `metric_code`
- `value_cents`, `value_bps`, or `value_integer`
- `currency`, `basis`, `source_id`
- `created_at`

The issued period's metric rows are immutable. A correction creates a new period that points to the prior one.

#### `fund_lp_period_statements`

One statement per LP commitment and issued period:

- `reporting_period_id`, `limited_partner_id`
- `beginning_nav_cents`, `contributions_cents`, `distributions_cents`
- `ending_nav_cents`, `management_fees_cents`, `carried_interest_cents`
- `ownership_bps`, `dpi_bps`, `tvpi_bps` where the basis supports them
- `statement_document_id`, `delivery_status`, `delivered_at`
- `snapshot_json` for the exact rendered statement inputs

This keeps the GP's fund-level report separate from each LP's confidential statement.

#### `fund_period_deliveries`

If the product needs email/download tracking, keep delivery attempts separate from the report itself:

- `reporting_period_id`, `limited_partner_id`, `channel`
- `status`: `queued | sent | delivered | failed | opened`
- `provider_message_id`, `sent_at`, `opened_at`, `error_code`

## Portfolio valuation history

`portfolio_positions` describes ownership, but quarterly NAV needs historical marks. Add:

### `portfolio_position_marks`

- `portfolio_position_id`, `reporting_period_id`
- `fair_value_cents`, `cost_basis_cents`, `ownership_bps`
- `valuation_method`: `round_price | secondary | gp_estimate | write_down | cost`
- `as_of_date`, `source_id`, `confidence_bps`, `note`

A quarterly report should use the marks belonging to that reporting period, never the current live mark.

## Access model

| Data | Public visitor | Authenticated founder | GP / fund operator | LP | Admin |
|---|---:|---:|---:|---:|---:|
| Public registry metadata | Yes | Yes | Yes | Yes | Yes |
| Public metric observations | Yes, if `is_public=1` | Yes | Yes | Yes | Yes |
| Founder `research_funds` notes | No | Owner only | No | No | Support-gated / audited |
| Private registry metadata | No | Explicit grant only | Owner | Explicit grant only | Yes |
| Public LP disclosures | Yes, if licensed/public | Yes | Yes | Yes | Yes |
| Actual LP commitments | No | No | GP/admin | Own commitment only | Yes |
| Issued quarterly fund report | No | No | GP/admin | Entitled LP only | Yes |
| LP statement | No | No | GP/admin for a named LP | Own statement only | Yes |

Use row-level predicates in the Worker. `visibility = 'public'` is necessary but not sufficient for private data; private rows also need an owner or explicit access grant.

## Import and refresh workflow

1. **Ingest** a source file/provider response into `fund_sources` and `fund_import_batches`.
2. **Normalize** names, websites, countries, stage tags, sector tags, and identifiers.
3. **Match** to `fund_registry` using source identifiers first, website domain second, and normalized name only as a review candidate.
4. **Create observations** for AUM, fund size, ticket range, and other metrics with `source_id`, `as_of_date`, and `basis`.
5. **Review conflicts** instead of overwriting the previous value. The winning record should be explicit.
6. **Publish** only rows and metrics with a public source and acceptable license/visibility.
7. **Expose** the public catalog through a Worker endpoint with pagination and filters. Keep the static JSON as a build-time fallback until that endpoint is live.
8. **Allow Add to research** to create one owner-scoped `research_funds` row with a link to the catalog record; never copy public facts into private notes automatically.

## Recommended plugin stack

| Job | Recommended integration | Why |
|---|---|---|
| Production database, R2 source files, Worker API, scheduled refresh | **Cloudflare / Cloudflare API / Cloudflare Worker Bindings** | Fits the existing D1 + R2 + Worker architecture. Use D1 for normalized records and R2 for raw files/report documents. |
| Commit, review, and deploy source changes | **GitHub** | Already enabled in this task and is the repository/deploy workflow. |
| Private-market discovery and investor enrichment | **Harmonic** | Its listed capability is discovering and enriching companies, people, and investors; it is the closest available connector for a VC/fund discovery layer. |
| Public/regulated financial data cross-checks | **FactSet** or **S&P Global** | Stronger for institutional financial data, company data, and deals than generic scraping. They are not substitutes for private-fund source disclosure. |
| Internal editorial review / controlled source spreadsheet | **Google Workspace** or **Airtable** | Useful as an approval queue or staging surface, not as the production system of record. |
| Public web collection when no structured provider exists | **Firecrawl**, **Apify**, or **Bright Data** | Use only for source discovery/collection, with rate limits, terms compliance, source URLs, retrieval dates, and human review. |
| Storage/query alternative if the product moves off D1 | **Supabase** or **Neon** | Viable Postgres options, but redundant with the current Cloudflare D1 architecture unless there is a deliberate platform migration. |

Do not make FMP, Financial Datasets, or Morningstar the primary provider for a private VC fund directory; their listed capabilities are oriented more toward securities, public-company financials, filings, and investment analytics. They can be useful for public-market cross-checks, not for silently filling private-fund AUM or LP data.

## Phased implementation

### Phase 1 — shipped with the directory

- Keep `research_funds` private.
- Ship the source-backed, deduplicated discovery catalog.
- Let founders explicitly add a catalog row to their own shortlist.
- Show source label, official website, and an honest “verify current terms” note.

### Phase 2 — move the catalog into D1

- Add `fund_registry`, `fund_aliases`, `fund_sources`, and `fund_metric_observations` migrations.
- Add `catalog_fund_id` to `research_funds` as nullable.
- Add an admin-only import route and import audit trail.
- Serve `/research/funds/catalog` from the Worker with pagination and filters.

### Phase 3 — complete private fund operations

- Add vehicle-level identity and link existing `vc_funds` rows.
- Migrate new money fields to cents.
- Add public LP disclosures separately from `limited_partners`.
- Add typed quarterly period metrics and LP statements.
- Add historical portfolio marks before claiming quarter-end NAV, TVPI, DPI, or IRR.

### Phase 4 — provider refresh

- Connect Harmonic or an approved private-market provider for enrichment.
- Add scheduled source refreshes only after the source's license and rate limits are recorded.
- Keep a human review state for identity matches and material metric conflicts.

## Data-quality rules

- Every hardcoded number must have `source_id`, `as_of_date`, and a basis.
- A missing AUM, ticket, LP count, or quarterly metric remains `NULL` / “Not recorded”; never default to zero.
- Fund size, committed capital, NAV, AUM, called capital, and deployed capital are different metrics.
- Public-source LP names do not grant access to private LP records.
- Never publish an LP commitment or quarterly statement because a provider guessed it.
- Use source precision in storage; round only at presentation.
- For investment-analysis surfaces, show the reference date and close with: “This is research and analysis only, not personalized financial advice.”
