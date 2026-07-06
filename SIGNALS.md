# Signals

**Public-market evidence for what to build next.**

Signals is a founder decision-support engine that surfaces founder-actionable
startup opportunities from **public** company data — public companies, markets,
sectors, countries and customer segments. It is **not** a stock/trading
dashboard: no price charts, no candlesticks, no quote endpoints. The lead output
is always "what to build, for whom, where, and why the signal is credible".

One engine, two modes (same data, different ordering + copy):

- **Founder mode** — "What should I build next?"
- **Advisor / Mentor mode** — "What opportunities should I point founders toward?"

## Where it lives (production = Cloudflare Worker)

- **API:** `cloudflare-worker/src/routes/signals.ts` → `/api/signals/*`
- **Engine / ranking / sources / seed:** `cloudflare-worker/src/services/signals/`
- **Schema (D1):** `cloudflare-worker/sql/migrations/136_signals.sql`
- **UI page:** `frontend/src/pages/SignalsPage.jsx` → route `/signals`
- **Components:** `frontend/src/components/signals/` (`SignalCard`,
  `SignalFilterBar`, `SignalEvidencePanel`, `SignalModeToggle`, `SignalKPIStrip`)

## How ranking and source confidence work

The full technical write-up — the normalized data model, the swappable source
adapters, the exact confidence formula and the eight-factor ranking blend — lives
next to the code:

➡️ **[`cloudflare-worker/src/services/signals/README.md`](cloudflare-worker/src/services/signals/README.md)**

In one paragraph: **confidence** (0–100) rewards multiple independent,
high-quality, recent public sources agreeing (a single-source signal is hard-
capped at 55). **Ranking** blends freshness, cross-source agreement, evidence
volume, customer-pain cues, market-cap diversity, sector/geo concentration and
**buildability** — the last of which penalises mega-cap-only stories so the
engine favours *practical, buildable* opportunities over the biggest companies or
the loudest headlines.

## Data sources

Only free / free-tier / public sources by default (SEC EDGAR, public company
profiles, public corporate registries, market-trend context, news RSS, public
hiring velocity). No vendor is hardcoded — each source is a swappable
`SourceAdapter`, and every place a paid provider could slot in is marked
`TODO(premium)` in `services/signals/sources.ts`.

Until live ingestion has run, the engine serves a seeded sample corpus
(`services/signals/seed.ts`) so the page is fully functional day one; it reads D1
first and falls back to the seed automatically.
