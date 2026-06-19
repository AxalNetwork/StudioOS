# Venture Risk Rating & Management — Design + Replit Build Prompts

Axal VC's implementation of the **"10 Layers of Venture Risk"** framework
(Founder, Market, Competition, Timing, Financing, Marketing, Distribution,
Technology, Product, Hiring). Every layer is a thesis investors must believe,
backed by a **proof signal**. "Every startup begins as a collection of risks;
every funding round is a process of removing them" — so this feature scores how
**derisked** each company is, per layer, from real platform data, and lets the
internal deal team manage that risk.

This document is both the **design spec** and a set of **copy-paste Replit
Agent prompts** to (re)build or extend it. The first version already ships in
this repo — the prompts below mirror that implementation so Replit can
reproduce, port, or extend it safely.

> Audience: internal deal team only (`admin` / `partner` / `investor`). Read is
> open to all three; compute + analyst overrides are `admin` / `partner`.
> Founders never see this surface.

---

## 1. The rating model

- **Per layer** `risk` is `0–100`, **lower = safer** (consistent with the
  existing `founder_risk_profiles.risk_score`). Bands: `low 0–33` ·
  `medium 34–66` · `high 67–100` (emerald / amber / red).
- Each layer carries **proof signals** — `{ key, label, status, value, weight,
  evidence }` where `status ∈ met | partial | missing | unknown`. `unknown`
  (no data source) is visually distinct from `missing` (looked, not there); the
  engine never fabricates a signal.
- **Hybrid scoring**: an *auto* pass derives signals from platform data; a
  sticky *analyst* pass (band / score / status / note per layer) is merged over
  the auto result and persists across recomputes.
- **Aggregate**: `overall_risk = stage-weighted avg(layer risk)`. The UI shows
  a **Derisking Score = 100 − overall_risk** (higher = more derisked) on a
  gauge, plus `derisk_pct` = % of proof signals satisfied across all layers.
- **Stage tilt**: early-stage weights Founder/Market/Product/Timing higher;
  growth-stage weights Distribution/Hiring/Financing/Marketing higher.

Layer score formula (per layer): `risk = 100 × (1 − earned/knownWeight)` where
`earned` sums `weight × (met 1 · partial 0.5 · missing 0)` over non-`unknown`
signals. A fully-unknown layer defaults to `60` (cautious) with low confidence.

---

## 2. Best platform inputs per layer (the proof-signal map)

| # | Layer | Investors must believe | Platform inputs (table.field) |
|---|-------|------------------------|-------------------------------|
| 1 | Founder | This team can execute | `founder_risk_pulls.score`, `founders.experience_years`, `score_snapshots.team_total` |
| 2 | Market | Customers will pay | `projects.revenue` / `users_count`, `projects.tam`, `market_intel_indexes.delta_pct`, `score_snapshots.market_total` |
| 3 | Competition | Can win vs alternatives | `projects.crunchbase_data_json`, `projects.solution`, `score_snapshots.fit_total` |
| 4 | Timing | Market ready now | `projects.why_now`, `market_intel_indexes.delta_pct`, `projects.last_funding_round` |
| 5 | Financing | Can reach next milestone | `projects.total_funding` vs `funding_needed`/`cost_to_mvp`, `rounds`, `financial_models`, `score_snapshots.capital_total` |
| 6 | Marketing | Demand generated repeatably | `metrics_snapshots` (MoM), `projects.growth_signals`, `projects.users_count` |
| 7 | Distribution | Reach at scale | `score_snapshots.distribution_total`/`distribution_virality`, `deals` / `partners` |
| 8 | Technology | Can be built | `score_snapshots.product_total`, `projects.solution`, `documents` |
| 9 | Product | Users want it | `metrics_snapshots.active_users`, `discovery_interviews`, `projects.users_count` |
| 10 | Hiring | Team can scale | `projects.employee_count`, `score_snapshots.team_total`/`team_network` |

---

## 3. Architecture (StudioOS rules — non-negotiable)

Per `CLAUDE.md`: the **Cloudflare Worker is production**. New behaviour lands in
`cloudflare-worker/src/routes/` first; no `/api/*` method is added to
`frontend/src/lib/api.js` without a matching worker mount (`npm run test:drift`
enforces this); D1 schema ships as a numbered idempotent migration mirrored into
`schema.sql`; FastAPI in `backend/` is dev-only and never deployed.

### Data model (migration `114_venture_risk.sql`, mirrored in `schema.sql`)
- `venture_risk_assessments` — snapshot history; latest row per project is
  current. `(project_id, overall_risk, overall_band, derisk_score, derisk_pct,
  layers_json, source, computed_by, created_at)`.
- `venture_risk_overrides` — sticky analyst input per layer.
  `UNIQUE(project_id, layer_key)`; `(band, score, status, note, owner_user_id)`.

### Worker
- `src/services/ventureRisk.ts` — `LAYERS`, `computeVentureRisk(env, id)`,
  `applyOverrides`, `recomputeAggregate`, `bandFromScore`, `serializeAssessment`.
- `src/routes/venture_risk.ts` (mounted `/api/venture-risk`):
  `GET /portfolio`, `GET /:projectId`, `GET /:projectId/history`,
  `POST /:projectId/compute`, `PUT /:projectId/layer/:layerKey`.

### Frontend
- `lib/api.js`: `getVentureRisk`, `getVentureRiskHistory`, `computeVentureRisk`,
  `setVentureRiskLayer`, `getVentureRiskPortfolio`.
- `components/RiskRadar.jsx` (10-axis recharts radar of derisk),
  `components/RiskLayerCard.jsx` (signals + analyst controls),
  `components/VentureRiskPanel.jsx` (gauge + radar + 10 cards).
- `pages/RiskMatrixPage.jsx` at `/portfolio/risk` (portfolio heatmap).
- Wired into `pages/ProjectDetail.jsx` (gated by `isElevated`) and the
  admin/partner/investor groups in `sidebarConfig.js`.

---

## 4. Replit Agent build prompts (run in order)

Paste each prompt into Replit Agent one at a time; verify before moving on.
Each prompt restates the guardrails so the agent can't drift.

### Prompt 1 — D1 migration
```
In the StudioOS repo, add a new D1 migration
cloudflare-worker/sql/migrations/114_venture_risk.sql with two idempotent
tables (CREATE TABLE/INDEX IF NOT EXISTS):
- venture_risk_assessments(id, uid, project_id FK->projects ON DELETE CASCADE,
  overall_risk REAL, overall_band TEXT, derisk_score REAL, derisk_pct REAL,
  layers_json TEXT, source TEXT, computed_by INTEGER FK->users, created_at) with
  an index on (project_id, created_at DESC).
- venture_risk_overrides(id, project_id FK, layer_key TEXT, band TEXT, score REAL,
  status TEXT default 'open', note TEXT, owner_user_id INTEGER, updated_at,
  UNIQUE(project_id, layer_key)).
Mirror BOTH tables verbatim into cloudflare-worker/sql/schema.sql right after the
score_snapshots indexes. Do NOT touch wrangler.toml.
```

### Prompt 2 — scoring service
```
Create cloudflare-worker/src/services/ventureRisk.ts implementing the 10-layer
"venture risk" hybrid engine. Export: LAYERS (10 layer metadata objects with
key/label/belief/proof in framework order Founder..Hiring), bandFromScore(score)
=> low<=33|medium<=66|high, computeVentureRisk(env, projectId) which loads the
project plus optional signal sources (score_snapshots latest non-sandbox,
founder_risk_pulls, founders, metrics_snapshots last 2, discovery_interviews
count, deals count, documents count, market_intel_indexes by sector,
financial_models count, rounds) — every optional query wrapped so a missing
table degrades to 'unknown' instead of throwing — and returns an assessment
{project_id, project_name, stage, overall_risk, overall_band, derisk_score,
derisk_pct, layers[], source:'auto', saved:false, computed_at:null}. Each layer
has signals[{key,label,status:met|partial|missing|unknown,value,weight,evidence}],
risk 0-100 (lower=safer) via 100*(1-earned/knownWeight) [met 1/partial .5/missing
0; fully-unknown layer => 60], band, confidence, status:'open', overridden:false,
rationale. Overall risk = stage-weighted average (early tilts
Founder/Market/Product/Timing; growth tilts Distribution/Hiring/Financing/
Marketing); derisk_score=100-overall_risk; derisk_pct=100*sumEarned/sumTotalW.
Use the input map in attached_assets/venture_risk_rating.md. Also export
applyOverrides(assessment, overrideRows) (merge sticky per-layer band/score/
status/note, set source='analyst', recompute aggregate), recomputeAggregate, and
serializeAssessment(row). Keep score denominators: market_total/25, team_total/20,
product_total/15, capital_total/15, fit_total/15, distribution_total/10.
```

### Prompt 3 — worker route + mount
```
Create cloudflare-worker/src/routes/venture_risk.ts (Hono, mirroring
routes/founder_risk.ts style). Import requireAuth from ../auth and the service.
Read access admin/partner/investor; writes admin/partner; return c.json(...,403)
otherwise. Endpoints:
  GET  /portfolio            -> latest saved assessment per active project
                                (deleted_at IS NULL), computing a fresh preview
                                for up to 20 un-assessed projects; include a
                                compact layers[] {key,label,band,risk,status}.
  GET  /:projectId           -> latest saved assessment, else a fresh unsaved
                                preview (404 if project missing).
  GET  /:projectId/history   -> last 30 snapshots.
  POST /:projectId/compute   -> compute auto + merge overrides, persist snapshot.
  PUT  /:projectId/layer/:layerKey -> validate layerKey in LAYERS and
                                band/score/status; upsert venture_risk_overrides
                                (ON CONFLICT(project_id,layer_key) DO UPDATE);
                                recompute + persist (source 'analyst').
Then in cloudflare-worker/src/index.ts add `import ventureRiskRoutes from
'./routes/venture_risk';` next to the founder_risk import and
`app.route('/api/venture-risk', ventureRiskRoutes);` next to the founder-risk
mount. Run `cd cloudflare-worker && npx tsc --noEmit` — it must pass.
```

### Prompt 4 — frontend API client
```
In frontend/src/lib/api.js, just after the founder-risk block, add (matching the
new worker mounts so npm run test:drift stays green):
  getVentureRisk(projectId) -> GET /venture-risk/:projectId
  getVentureRiskHistory(projectId) -> GET /venture-risk/:projectId/history
  computeVentureRisk(projectId) -> POST /venture-risk/:projectId/compute
  setVentureRiskLayer(projectId, layerKey, data) -> PUT /venture-risk/:projectId/layer/:layerKey
  getVentureRiskPortfolio() -> GET /venture-risk/portfolio
```

### Prompt 5 — React components
```
Create three components in frontend/src/components (Tailwind + lucide-react,
dark-mode aware, emerald/amber/red bands like FounderRiskBadge):
- RiskRadar.jsx: a 10-axis recharts radar of derisk (100-risk), domain [0,100],
  mirroring components/play/SkillRadar.jsx.
- RiskLayerCard.jsx: one layer — number badge, label, italic belief, band pill
  with risk number, the proof-signal checklist (met=CheckCircle2 green / partial=
  CircleDashed amber / missing=XCircle red / unknown=HelpCircle gray, with the
  evidence value + source tooltip), rationale + "% data" confidence, and (when
  canManage) an inline analyst editor: band select, risk 0-100 input, status
  select (open/mitigating/cleared), note textarea, Save -> onSave(layerKey,data).
- VentureRiskPanel.jsx: loads api.getVentureRisk(projectId); renders an overall
  Derisking Score gauge (SVG ring like TrustScoreBadge, coloured by band: low=
  emerald), overall band + derisk_pct + "N/10 cleared" + computed/preview stamp,
  a Recompute button (admin/partner -> api.computeVentureRisk), the RiskRadar,
  and a 2-col grid of RiskLayerCards. saveLayer calls api.setVentureRiskLayer and
  setData(result). Read role via useAuth from ../hooks/useAuthSync; canManage =
  admin|partner.
```

### Prompt 6 — wire ProjectDetail
```
In frontend/src/pages/ProjectDetail.jsx import VentureRiskPanel and render
`{isElevated && <VentureRiskPanel projectId={id} />}` right before the Documents
card. (isElevated already exists on the page = admin/partner/investor/mentor.)
```

### Prompt 7 — portfolio matrix page + nav
```
Create frontend/src/pages/RiskMatrixPage.jsx: calls api.getVentureRiskPortfolio()
and renders a heatmap table (companies x 10 layers). Cells coloured by band show
the layer risk number; a "Derisk" column shows derisk_score; rows link to
/projects/:id; sortable by derisk score or name; legend + "not assessed"/
"preview" markers; horizontal scroll. In frontend/src/App.jsx add a lazy import
and `<Route path="/portfolio/risk" element={guard(['admin','partner','investor'],
<RiskMatrixPage />)} />` next to /portfolio/coverage. In
frontend/src/sidebarConfig.js add a `{ to: '/portfolio/risk', icon: ShieldAlert,
label: 'Risk Matrix' }` item to the admin, partner, and investor groups (import
ShieldAlert from lucide-react).
```

### Prompt 8 — tests + verify
```
Add cloudflare-worker/test/venture_risk.test.ts (node:test + node:sqlite D1
adapter like test/events.test.ts) covering: bandFromScore boundaries; compute
returns 10 layers with valid bands; a well-evidenced project scores lower
overall_risk than an empty one; applyOverrides lowers the layer+aggregate and
sets source='analyst'; serializeAssessment round-trips. Register it in the
root package.json "test:drift" strip-types test list. Then run, from repo root:
`npm run test:drift` and `cd frontend && npm run build` — both must pass.
```

### Prompt 9 (optional) — FastAPI dev parity
```
OPTIONAL dev-only convenience (never deployed; the worker is production). Add
backend/app/api/routes/venture_risk.py mirroring the worker endpoints over
SQLModel, and mirror the two tables in backend/app/models/migrations.py, so the
Replit FastAPI dev server answers /api/venture-risk/* during local iteration.
Skip if you only run against the worker.
```

---

## 5. Verification checklist
1. `npx wrangler d1 execute studioos-db --local --file=cloudflare-worker/sql/migrations/114_venture_risk.sql`
2. `cd cloudflare-worker && npx tsc --noEmit`
3. `npm run test:drift` (drift + the new venture_risk test)
4. `cd frontend && npm run build`
5. Manual: open a project → risk panel (gauge + radar + 10 cards) → **Recompute**
   → edit a layer's band/note → reload shows the override stuck → open
   `/portfolio/risk` for the heatmap.

## 6. Out of scope (v1)
Founder-facing derisking view; external enrichment beyond what's already synced
(Crunchbase/PitchBook); scheduled recompute cron. The aggregate uses post-
override layer scores, while `derisk_pct` reflects auto evidence only — by
design (judgment vs evidence are tracked separately).
