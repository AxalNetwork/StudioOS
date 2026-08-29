# Competitor Analysis & Pitch Deck Reviewer

Two Cloudflare-native features. **No paid third-party APIs** — discovery, crawl,
extraction, and synthesis all run on the Worker with D1 + R2 + Workers AI.

Per `CLAUDE.md`, production is the Cloudflare Worker (`cloudflare-worker/`). New
work lives there first; the SPA (`frontend/`) calls it via `/api/*`. The FastAPI
in `backend/` is Replit-dev-only and is **not** ported for these features.

---

## Competitor Analysis

Routes: `/build/competitors` (SPA) → `/api/competitors/*` (Worker).

**Pipeline** (`services/competitorAnalysis.ts`):
1. Seed candidates from known competitors + startup/project context.
2. Expand with Workers AI (`dd_synthesis` task) — keyword/category reasoning.
3. Crawl each top candidate's public site via the in-house fetch pipeline
   (`services/webFetch.ts`), depth-gated (quick = home/pricing/features/about;
   deep = + blog/news/press/careers).
4. Heuristic relevance scoring (industry / ICP / geo / problem / signal).
5. Workers AI synthesis of the structured report.

Every AI step has a deterministic fallback, so an analysis always returns a
usable result even if the model chain refuses/times out.

**In-house crawl / proxy** (`services/webFetch.ts`):
- SSRF-guarded (`isSafePublicUrl`): http(s) only, blocks localhost / private IP
  ranges / cloud-metadata hosts.
- Byte cap (1.5 MB), 8 s timeout (AbortController), per-user KV rate limit
  (40/min), regex HTML→text normalization, D1 cache
  (`competitor_cached_fetches`, 7-day TTL).
- `POST /api/competitors/fetch` exposes it as a controlled single-URL proxy.

**Endpoints**: `POST /analyze`, `GET /`, `GET /:id`, `PATCH /:id`,
`POST /:id/candidates`, `DELETE /:id/candidates/:cid`, `POST /:id/rerun`,
`POST /:id/refresh`, `DELETE /:id`, `POST /fetch`, `GET /:id/export?format=json|md`.

**Tables** (`sql/competitor_analysis.sql`, mirrored by
`services/competitorSchema.ts`): `competitor_analyses`, `competitor_candidates`,
`competitor_sources`, `competitor_signals`, `competitor_analysis_outputs`,
`competitor_cached_fetches`.

---

## Pitch Deck Reviewer

Routes: `/build/deck-reviewer` (SPA) → `/api/deck-reviewer/*` (Worker).

**Flow** (`services/deckExtract.ts`):
1. Upload PDF/DOC/DOCX/PPTX (≤20 MB) or paste text.
2. Extract via Workers AI **document conversion** (`env.AI.toMarkdown`) —
   Cloudflare-native, includes OCR for scanned PDFs. Graceful fallback to manual
   paste when conversion is unavailable/fails.
3. Map into 12 standard deck sections (heuristic + AI).
4. Generate an honest, investor-style review (score, strengths, weaknesses,
   missing sections, red flags, section suggestions, priority fixes, improved
   wording, "fix first"). Deterministic fallback on model failure.

**Storage & retention**:
- Raw bytes archived in the existing R2 `FILES` bucket under
  `deck-reviews/{user_id}/{uuid}.{ext}` — **private, never served publicly**.
- `raw_retained` tracks the lifecycle; `DELETE /:id/raw` purges the raw file
  after processing while keeping the extracted sections + review. GitHub LFS is
  **not** used for runtime — the app never depends on Pages serving deck files.

**Endpoints**: `POST /upload`, `POST /paste`, `GET /`, `GET /:id`, `PATCH /:id`,
`POST /:id/regenerate`, `DELETE /:id/raw`, `DELETE /:id`,
`GET /:id/export?format=json|md`.

**Tables** (`sql/deck_reviews.sql`, mirrored by
`services/deckReviewSchema.ts`): `deck_reviews`, `deck_review_history`.

---

## Notes / assumptions

- AI runs through the shared router (`services/aiRouter.ts`) under the existing
  `dd_synthesis` task class (Workers AI, budget-capped) — no new model config.
- Schemas self-heal at runtime (lazy `ensure*Schema`) like the rest of the app;
  the `sql/*.sql` files are the canonical migrations to apply on D1.
- Both features reuse the `FILES` R2 bucket and existing KV — no
  `wrangler.toml` binding changes.
- Deck extraction quality depends on Workers AI document conversion being
  enabled on the account; the manual-paste path is the guaranteed fallback.
