# cloudflare-worker/test/fixtures — recorded and synthetic inputs for the worker tests

Data the tests read, never code under test. Everything here is SYNTHETIC, a public price list
or public official statistics (`eurostat_sbs_7717/`): no real person, venture or credential.

| File | What it is | Read by |
| --- | --- | --- |
| `advisor-scenarios.json` | Advisor conversation scenarios | `advisor.scenarios.test.ts` |
| `profiling-v2-personas.json` | Profiling v2 personas | `profiling_v2_personas_fixture.test.ts` and the profile bank and scoring tests |
| `pitchStoryFixtures.ts` | Full, sparse and conflicting venture records as `readSources` items (D897 §9) | `deck_new_d897.test.ts`, `deck_visuals_d903.test.ts` |
| `pitchReferenceDecks.ts` | Reference decks for the deck design system | `deck_design_system_d898.test.ts` |
| `workers_ai_catalogue.json` | The Workers AI catalogue snapshot (D760) | `ai_catalogue_d760.test.mjs` |
| `workers_ai_pricing_rows_2026-10-31.md` | Workers AI price rows on 2026-10-31 | `ai_catalogue_d760.test.mjs` |
| `fake_ai_recordings.json` | D1511: the fake AI binding's recorded outputs (`../_recorded_ai.mjs`) | `recorded_ai_d1511.test.ts`, `frontend/tests/visual/server.ts` |
| `oneClickVenture.ts` | D1511: a venture whose records fill every card of the one-click deck, written into the migrated schema | `recorded_ai_d1511.test.ts`, `frontend/tests/visual/server.ts` |
| `adversarial_4572/corpus.json` | D4572 (#4572): the versioned adversarial corpus — injection texts, tool-name variants, refused MCP URLs with their reasons, private and public addresses. Add under a new `version`; never edit an entry a test relies on | `agent_tool_boundary_4572.test.ts` |
| `chromiumTaggedDeck.ts` | D1578: a synthetic page printed by Chromium with `tagged: true`, as base64 | `deck_tagged_exports_d1578.test.ts` |
| `ai_gateway_4556.json` | D4556: the AI Gateway slice's price, ZDR, logging and limit facts, each with its Cloudflare page and the date read | `ai_gateway_slice_4556.test.ts` |
| `accounting/` | D5833 (#5833): synthetic QuickBooks Online and Xero balance-sheet and profit-and-loss reports, in each provider's JSON shape, with negative, zero, empty and unreadable cells and two fiscal periods | `financial_statements_5833.test.ts` |
| `fund_facts_7843/` | D7843 (#7843): an invented reviewed manifest of fund statements, its invented list reviews (`reviews.sql`, not a migration) and the SQL `scripts/import-fund-facts.mjs` compiles from them (`compiled.sql`, checked with `--check`) | `research_fund_facts_7843.test.ts` |
| `eurostat_sbs_7717/` | D7717 (#7717): real Eurostat responses, read 2026-11-23 (UTC), trimmed only by removing `extension.annotation`. `j62_micro_de_el_eu27_2021_2022.json` (15:15:55Z): `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw?format=JSON&lang=EN&indic_sbs=ENT_NR&indic_sbs=EMP_NR&indic_sbs=NETTUR_MEUR&nace_r2=J62&size_emp=0-9&geo=DE&geo=EL&geo=EU27_2020&time=2021&time=2022`. `c12_medium_large_2022.json` (15:15:56Z): `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw?format=JSON&lang=EN&indic_sbs=ENT_NR&indic_sbs=EMP_NR&indic_sbs=NETTUR_MEUR&nace_r2=C12&size_emp=50-249&size_emp=GE250&geo=DK&geo=EE&geo=CY&geo=LU&geo=MT&time=2022`. `j62_total_2021.json` (15:15:57Z): `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw?format=JSON&lang=EN&indic_sbs=ENT_NR&indic_sbs=NETTUR_MEUR&nace_r2=J62&size_emp=TOTAL&geo=FR&geo=PT&geo=LU&geo=AL&geo=ME&geo=RS&geo=CH&time=2021`. `not_found_404.json` (15:16:04Z, HTTP 404, untrimmed): `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw_nonexistent?format=JSON&lang=EN`. ALTERED by hand, copies of the J62 micro file: `j62_micro_revised.altered.json` (`updated` set to 2026-10-15T11:00:00+0200, value 3 (DE ENT_NR 2022) 84564 to 84600); `j62_micro_flags_changed.altered.json` (`updated` as above, flag `e` removed from cell 7 (EU27_2020 EMP_NR 2022), flag `p` added to cell 3, `p` label added; no value changed); `j62_micro_geo.altered.json` (geo codes `EL` renamed `XX` and `EU27_2020` renamed `EA20`) | `market_observations_eurostat_sbs_7717.test.ts` |

## Rules

- A fixture is data. Logic a test needs goes in a `_helper` beside the tests.
- Synthetic only: names like "Synthetic Founder", emails under
  `example.invalid`, figures made up.
- A recorded model output names no figure a card would show: code places every
  figure from the records (D897).
