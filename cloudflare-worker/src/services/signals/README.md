# Signals — founder decision engine

A decision-support engine that surfaces **founder-actionable startup
opportunities** from **public** company data (public companies, markets,
sectors, countries, customer segments). It is deliberately **not** a stock/
trading dashboard: there are no price charts, candlesticks or quote endpoints.
The lead output is always "what to build next, for whom, where, and why the
signal is credible".

The same engine powers two modes that share one dataset:

- **Founder mode** → "What should I build next?"
- **Advisor / Mentor mode** → "What opportunities should I point founders toward?"

Mode changes ordering and framing copy only — never the underlying data.

## Where things live

```
cloudflare-worker/
├─ src/routes/signals.ts                 # /api/signals/* (Hono router, prod API)
├─ src/services/signals/
│  ├─ types.ts                           # normalized schema + controlled vocabularies
│  ├─ sources.ts                         # source registry + swappable adapters
│  ├─ ranking.ts                         # ranking + confidence engine
│  ├─ seed.ts                            # sample seeded signals + companies
│  ├─ engine.ts                          # load → filter → rank → KPIs → refresh
│  └─ README.md                          # (this file)
└─ sql/migrations/136_signals.sql        # D1 schema (additive, idempotent)

frontend/src/
├─ pages/SignalsPage.jsx                 # the "Signals" dashboard page (/signals)
├─ components/signals/                   # SignalCard, SignalFilterBar,
│                                        # SignalEvidencePanel, SignalModeToggle,
│                                        # SignalKPIStrip
└─ lib/signalsMeta.js                    # shared labels / icons / tones
```

## Data model (normalized)

The nine entities the product asks for map onto the schema like this:

| Entity            | Where it lives                                              |
| ----------------- | ---------------------------------------------------------- |
| Company           | `signal_companies` / `NormalizedCompany`                   |
| Market            | `signals.market_context` JSON / `MarketContext`            |
| Signal            | `signals` / `Signal`                                       |
| EvidenceItem      | `signal_evidence` / `EvidenceItem`                         |
| Source            | `signal_sources` / `SignalSource` (+ in-code registry)     |
| Region            | `REGIONS` vocab + `signals.region` / `.country`            |
| Niche             | `signals.niche` (+ `sector` / `industry`)                  |
| CustomerSegment   | `signals.target_customers` JSON                            |
| BuildOpportunity  | `signals.build_opportunity` JSON / `BuildOpportunity`      |

`signal_company_map` is the many-to-many join for a signal's "representative
public companies". `signal_ingest_runs` is the background-refresh audit trail.

### DB-first, seed fallback

The engine reads from D1 first and **transparently falls back to the in-code
seed corpus** (`seed.ts`) when the tables are missing or empty. This keeps the
`/signals` page fully functional before any ingestion has run, and means no code
change is needed once the tables fill — seed and live rows share one shape.

## Source layer (swappable adapters)

No vendor is hardcoded. Each data family is fronted by a `SourceAdapter`
(`sources.ts`) and the engine only ever talks to the adapter interface, so
swapping a free source for a premium one is a one-file change. Every premium
swap point is marked `TODO(premium)`.

| Source key                  | Kind          | Tier      | Trust | Half-life |
| --------------------------- | ------------- | --------- | ----- | --------- |
| `sec_edgar`                 | filing        | free      | 0.95  | 120d      |
| `company_profile`           | fundamentals  | free-tier | 0.80  | 45d       |
| `registry_opencorporates`   | registry      | free-tier | 0.70  | 180d      |
| `market_context`            | market_data   | free      | 0.55  | 7d        |
| `news_rss`                  | news          | free      | 0.50  | 14d       |
| `hiring_signal`             | hiring        | free      | 0.45  | 21d       |

`quality_weight` (trust) and `freshness_halflife_days` (decay) feed the
confidence score. News is deliberately low-trust so a burst of headlines cannot,
on its own, float a signal to the top.

## Source confidence — how it works

`confidence_score` (0–100) answers **"how credible is this signal?"** A signal is
credible when **multiple independent, high-quality, recent** sources agree:

```
confidence = 100 × ( 0.45 · quality      # evidence-weighted source trust
                   + 0.35 · agreement    # distinct source KINDS corroborating
                   + 0.20 · freshness )  # recency (half-life decay)
```

- **quality** — average source `quality_weight`, weighted by each evidence
  item's weight.
- **agreement** — 1 kind → 0.35, 2 → 0.70, 3 → 0.90, 4+ → 1.00.
- **freshness** — 70% the *freshest* evidence + 30% the *average*, each decayed
  by its source's half-life (`0.5 ^ (age_days / half_life)`).
- **Single-source hard cap:** if only one evidence kind backs a signal, confidence
  can never exceed **55** — it reads as "Early", never "High".

## Ranking — how it works

`rank_score` (0–100) answers **"how worth-surfacing / actionable is this?"** and
is the sort key. It is a weighted blend of eight transparent factors (returned as
a `rank_breakdown` on every card so the UI can show its work):

| Factor                     | Weight | Rewards…                                             |
| -------------------------- | ------ | ---------------------------------------------------- |
| Freshness                  | 0.16   | recent evidence                                      |
| Cross-source agreement     | 0.16   | multiple corroborating source kinds                  |
| Evidence volume            | 0.14   | more (quality-weighted) evidence, diminishing        |
| Customer-pain strength     | 0.13   | filing/earnings/hiring/registry cues of budgeted pain|
| Buildability (practicality)| 0.13   | micro/small/mid-cap anchoring (penalises mega-only)  |
| Market-cap diversity       | 0.12   | supporters spanning several cap bands                |
| Sector repetition          | 0.08   | supporters clustered in the signal's sector          |
| Geographic concentration   | 0.08   | supporters clustered in the signal's region          |

**The ranking deliberately favours practical, buildable opportunities — not the
largest companies or the noisiest headlines.** Two guards enforce this:

1. **Practicality** scores mega-cap-only signals low (`mega → 0.25`,
   `small → 1.0`), so "three trillion-dollar incumbents" never wins by size.
2. **News has the lowest source weight**, and cross-source agreement is weighted
   heavily, so a pile of headlines without filings/earnings/registry corroboration
   cannot float to the top.

Mode only affects the **tie-break**: founder → higher practicality first, advisor
→ higher confidence first.

## API

All endpoints require an authenticated Axal member; `POST /refresh` is admin-only.

| Method & path                | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `GET  /api/signals`          | ranked + filtered signal cards (list view)          |
| `GET  /api/signals/filters`  | available facets + controlled vocabularies          |
| `GET  /api/signals/kpis`     | KPI-strip payload                                   |
| `GET  /api/signals/sources`  | source registry (confidence transparency)           |
| `GET  /api/signals/meta`     | signal-type catalog + rank-weight explanation       |
| `GET  /api/signals/:id`      | one signal's detail (evidence, companies, sources)  |
| `POST /api/signals/refresh`  | background ingestion refresh (admin only)           |

**Filters** (all optional, AND-combined): `region`, `country`, `sector`,
`industry`, `niche`, `market_cap_band`, `employee_band`, `customer_type`,
`maturity_stage`, `type`, `q` (free-text), `mode`, `limit`.

Ranked result sets are cached in KV (`env.RATE_LIMITS`) for 15 min; a refresh
re-stamps `last_refreshed_at` and lets the short-TTL keys expire.

## Extending

- **Add a data provider:** implement a `SourceAdapter` in `sources.ts`, register
  its `SignalSource`, add it to `LIVE_ADAPTERS`. Nothing else changes.
- **Add a signal type:** append to `SIGNAL_TYPES` + `SIGNAL_TYPE_LABELS` in
  `types.ts` and add an icon in `frontend/src/lib/signalsMeta.js`.
- **Add a country/region:** regions are a vocab in `types.ts`; countries are free
  text on each signal, so no schema change is needed to cover a new market.
- **Persist derived signals:** a scheduled Cron would call `runRefresh`, upsert
  normalized companies + derived signals into D1, and cache recomputed rank
  scores. The read path already prefers D1 over seed, so this is drop-in.
