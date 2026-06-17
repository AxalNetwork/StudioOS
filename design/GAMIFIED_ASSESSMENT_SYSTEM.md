# Gamified Assessment System — Design Spec

> Source of truth for the assessment build phases (Prompt 0 + A1–A4). The
> backend (A1) and frontend (A2/A3) cite the section numbers in this document
> verbatim — **do not renumber sections**. Schema: `cloudflare-worker/sql/migrations/107_assessment_engine.sql`
> (authoring) + `108_assessment_play.sql` (runtime + the `founder_origin_v1`
> reference seed). Canonical taxonomy: `089/090` (skill_categories, skills,
> value_dimensions); per-user write targets: `user_values` (094), `user_skills`
> (091), `investor_profiles` (009/096).

---

## §1 Overview & goals

The assessment replaces a boring multi-page survey with a short, cinematic game
that infers a founder's (or operator's, investor's, partner's, mentor's,
coach's) **values** and **skills** from the *decisions they make*, not from
self-rated Likert scales. One decision per screen, motion and reveal, an
archetype payoff, and a shareable Scout Report card.

Design goals:

- **Decisions over declarations.** Every scored signal comes from a choice with
  a consequence, ideally measured by more than one mechanic so we can detect
  inconsistency and damp over-claiming.
- **Canonical, reusable output.** Results write into the *same* tables the rest
  of the platform already reads — `user_values` and `user_skills` — so co-founder
  / investor / mentor matching improves automatically. Nothing is a private
  silo.
- **Trustworthy.** Computed results are signed with `SCORING_HMAC_SECRET` (§8)
  so a stored result can be verified as engine-produced and untampered.
- **Fun, not a form.** Mobile-first, swipeable, with XP, levels, badges, and an
  archetype identity (§6).

Non-goals: this system does not replace the onboarding persona classifier; it
*follows* it (after persona classification we offer "Discover your
{archetype}"). It does not gate access to the platform.

### Data model at a glance

| Concept | Table (migration) | Notes |
|---|---|---|
| Game (one per track) | `assessment_games` (107) | `slug`, `track`, `status`, `version` |
| Chapter | `assessment_chapters` (107) | ordered acts within a game |
| Item (one decision) | `assessment_items` (107) | `mechanic`, `options_json`, `measures_json`, `loads_json`, `config_json` |
| Archetype | `assessment_archetypes` (107) | per-track `centroid_json`, `badge_slug` |
| Badge definition | `assessment_badges` (107) | `kind` = archetype \| milestone \| event |
| Play session | `assessment_sessions` (108) | `public_id`, `status`, resume pointers |
| Response | `assessment_responses` (108) | `response_json`, `latency_ms`, `confidence_wager`; UNIQUE(session,item) |
| Result | `assessment_results` (108) | vectors + `integrity_hash` + `archetype_slug`; UNIQUE(session) |
| XP / level | `user_xp` (108) | `user_id` PRIMARY KEY (side table — never ALTER users) |
| Awarded badge | `user_badges` (108) | UNIQUE(user_id, badge_slug) → idempotent |

---

## §2 Tracks

A **track** is one game (`assessment_games.slug` == `assessment_games.track`).
There are six, one per principal type. Each track scores a track-specific
emphasis of the canonical `value_dimensions` and `skill_categories`, and has its
own archetype set.

| Track slug | Title | `target_role` | Scoring emphasis |
|---|---|---|---|
| `founder_origin_v1` | Founder Origin | `founder` | The 5 founder spectrums (mission/speed/risk/growth/autonomy) + product/GTM/finance/capital skills. **Reference track — seeded in 108.** |
| `operators_path_v1` | Operator's Path | `operator` | Execution & ops skills (finance_ops, product, engineering); Schwartz achievement/security; speed-vs-quality. |
| `thesis_lab_v1` | Thesis Lab | `investor_lp` | Investment thesis (sectors/stages/ticket), risk appetite, conviction; also UPSERTs `investor_profiles`. |
| `partner_playbook_v1` | Partner Playbook | `partner` | BD/partnerships/capital_network skills; collaboration values. |
| `mentor_compass_v1` | Mentor Compass | `mentor` | Domain radar coverage (which of the 8 axes they can mentor), guidance style. |
| `coachs_lens_v1` | Coach's Lens | `coach` | Coaching focus areas + Schwartz benevolence/universalism; style. |

The **five founder spectrums** (bipolar `value_dimensions`, `family='founder'`,
from migration 090) are the backbone of `founder_origin_v1`:

| Dimension slug | pole_low (−2) | pole_high (+2) |
|---|---|---|
| `founder_mission_vs_profit` | Profit-First | Mission-First |
| `founder_speed_vs_quality` | Quality-First | Speed-First |
| `founder_risk_appetite` | Risk-Averse | Risk-Seeking |
| `founder_growth_vs_sustain` | Sustainable | Hyper-Growth |
| `founder_autonomy_vs_structure` | Process & Structure | Autonomy & Flex |

The 10 Schwartz value dimensions (unipolar) and the 8 skill radar axes
(`skill_categories.is_radar_axis=1`: product, engineering, design, gtm_sales,
marketing_brand, finance_ops, legal_compliance, capital_network) are shared
across tracks. **All item loads MUST reference canonical slugs** so results
UPSERT cleanly. Only `founder_origin_v1` is seeded by this task; the other five
tracks are authored in migration `110` (Prompt A4) following the same pattern.

---

## §3 Mechanics

Six mechanics, stored in `assessment_items.mechanic`. The authored content lives
in `options_json` / `config_json`; what a mechanic *measures* lives in
`measures_json` (`{"values":[...slugs],"skills":[...slugs]}`). Each option
carries its own `loads` map of `{canonical_slug: delta}`.

| Mechanic | UX | `options_json` shape | `config_json` | Produces |
|---|---|---|---|---|
| `dilemma` | Two big choice cards, tap to pick, satisfying transition. | `{"options":[{"key,label,loads}]}` | — | one option's loads |
| `card_sort` | Drag the deck, keep top N. | `{"pick_n":N,"cards":[{key,label,loads}]}` | `{"pick_n":N}` | loads of the kept cards (rank-scaled, §4) |
| `sjt` | "Which lever?" situational cards + optional confidence wager slider. | `{"options":[...],"confidence_wager":true}` | `{"seniority_hint":{"skill,self_level}}` | option loads + optional self_level + wager |
| `speed` | Timed binary with a countdown ring; record decision latency. | `{"timer_ms":N,"options":[...]}` | `{"timer_ms":N}` | option loads, latency-weighted (§4) |
| `allocation` | Sliders summing to `total`. | `{"total":T,"buckets":[{key,label,loads}]}` | `{"total":T}` | proportional blend of bucket loads |
| `reflection` | The Scout Report reveal (radar fills in + archetype); optional free-text. | `{"reveal":"scout_report","fields":[...]}` | `{"reveal":true}` | nothing scored (display only) |

`reflection` items are display/affect only — `measures_json` is empty and they
contribute nothing to the vectors.

---

## §4 Scoring model

`services/assessmentScoring.ts` (A1) is a **pure** function:
`responses + item definitions → { valueVector, skillVector, confidence, flags }`.
No I/O. The route layer persists and signs.

### 4.1 Outputs

- **valueVector**: `{ value_dimension_slug: score }`, every score clamped to
  **[−2, +2]** (REAL). Written to `user_values.score` (094).
- **skillVector**: `{ skill_category_axis: level }`, every level clamped to
  **[0, 5]** (REAL). The 8 radar axes; written to `user_skills.self_level` (091,
  rounded/aggregated per skill — see 4.6).
- **confidence**: `{ value_dimension_slug: 0..1 }`. Written to
  `user_values.confidence` (094) and surfaced as `confidence_json` on the result.
- **flags**: array of `{ type, dimension, detail }` — e.g.
  `contradiction`, `low_confidence`, `low_coverage`.

### 4.2 Per-dimension value score

For each value dimension `d`, collect every response whose item
`measures_json.values` contains `d`. Each contributing response yields a signed
delta from the chosen option's `loads[d]` (already authored on the −2..+2
scale). The dimension score is the **mean of the contributing deltas**, clamped
to [−2, +2]. A dimension with no responses is **absent** from the vector (not 0)
— absence ≠ neutrality.

### 4.3 Confidence

`confidence[d]` rises with (a) the **number of independent mechanics** that
measured `d` and (b) **agreement** among them. Baseline: `min(1, n_mechanics /
2)` (one mechanic = 0.5, two+ = capped toward 1). Then multiply by an agreement
factor: if the contributing deltas point the same direction, keep it; if they
disagree (see 4.4), scale it down. Confidence is the basis for down-weighting
over-claims in matching (Prompt A4).

### 4.4 Contradiction check

When a dimension is measured by **≥2 mechanics** and the signed deltas disagree
(opposite signs, or spread beyond a tolerance), emit a
`{type:'contradiction', dimension:d}` flag and **reduce** `confidence[d]`
(e.g. ×0.5). The score itself remains the mean (so a genuine middle reads as
near-0 with low confidence). In `founder_origin_v1`, four of the five spectrums
are deliberately measured by two mechanics so this path is exercisable
(mission: dilemma+sjt; speed: speed+dilemma; risk: dilemma+sjt; growth:
allocation+dilemma).

### 4.5 Mechanic-specific weighting

- **`speed`** — latency weighting: a fast, decisive answer (low `latency_ms`
  relative to `timer_ms`) carries **full** weight; a slow/near-timeout answer is
  **down-weighted** toward 0 (hesitation = weaker signal). A timeout with no
  pick contributes nothing.
- **`card_sort`** — rank scaling: the top-kept card gets full magnitude,
  lower-kept cards a decayed fraction (e.g. rank 1 = 1.0, rank 2 = 0.6 …), so
  *order* matters, not just membership.
- **`sjt`** — `config_json.seniority_hint` maps the chosen option to a skill
  `self_level` (0..5) for `measures_json.skills` (a competence read layered on
  the values read). The optional `confidence_wager` (0..1) modulates that
  response's weight (a confident wager that proves consistent boosts; an
  inconsistent confident wager is penalized).
- **`allocation`** — each bucket's loads contribute **proportionally** to the
  points assigned (e.g. 70/30 split → 0.7×growth loads + 0.3×runway loads).
- **`dilemma`** — the chosen option's loads at full weight.

### 4.6 Skill vector → `user_skills`

Skill loads accumulate onto the 8 radar axes. For writing into `user_skills`
(which is keyed by individual `skills.id`, not the axis), the engine maps each
axis signal to the representative skill(s) the items referenced and UPSERTs
`self_level` (0..5), **never lowering** an existing endorsed/evidenced level
without cause. Reads of the taxonomy come from `skill_categories` / `skills`
(089/090).

### 4.7 `investor_lp` track

`thesis_lab_v1` additionally UPSERTs `investor_profiles` (009/096): inferred
`sectors_json` / `stages_json` / `ticket_*` / `thesis_keywords_json` and
`value_weights_json`, so investor↔founder matching (A4) can use it directly.

---

## §5 Archetypes

Each track defines a small set of archetypes in `assessment_archetypes`, each a
**centroid** (`centroid_json`) in the same `{values:{...}, skills:{...}}` shape
as a result. `assignArchetype(track, vectors)` picks the **nearest centroid by
Euclidean distance** over the shared dimensions (missing dimensions are skipped,
distance normalized by the count compared). Ties break by `display_order`.

`founder_origin_v1` ships four (seeded in 108):

| Archetype slug | Label | Centroid signature |
|---|---|---|
| `fo_missionary` | The Missionary | mission ↑, sustainable, quality-leaning |
| `fo_rocketeer` | The Rocketeer | speed ↑, risk ↑, hyper-growth ↑ |
| `fo_architect` | The Architect | quality ↑↑, structure ↑↑, risk-averse, engineering ↑ |
| `fo_maverick` | The Maverick | autonomy ↑↑, risk ↑, fast/instinct-led |

The assigned archetype is stored on the result (`archetype_slug` /
`archetype_label`) and awards the archetype's `badge_slug` (§6). It drives the
Scout Report identity (§9) and "Discover your {archetype}" CTAs.

---

## §6 XP, levels & badges

- **XP** accrues in `user_xp` (one row per user, `user_id` PRIMARY KEY).
  Completing a game and earning badges add `xp_reward`. **Never ALTER users** —
  this is a side table by design.
- **Level** is derived from cumulative XP by a simple curve in the engine
  (e.g. level = floor(sqrt(xp / 100)) + 1); store the derived `level` on
  `user_xp` for cheap reads.
- **Badges** are defined in `assessment_badges` and awarded into `user_badges`
  with `UNIQUE(user_id, badge_slug)` so awarding is **idempotent** (blind
  `INSERT OR IGNORE`). `kind`:
  - `archetype` — granted when an archetype is assigned (e.g.
    `fo_archetype_missionary`).
  - `milestone` — `first_steps` (first completion), `founder_origin_complete`
    (track completion), streaks.
  - `event` — cross-system, awarded from event check-ins in phase F
    (`source='event'`).
- On `/complete` the engine: bumps `user_xp`, inserts the archetype badge +
  any milestone badges, and records `xp_awarded` on the result.

---

## §7 API

All routes are auth'd (`requireAuth`) and mounted at **`/api/assessment`**
(`app.route('/api/assessment', assessment)`); the admin authoring router mounts
at **`/api/admin/assessment` BEFORE** the catch-all `/api/admin`. Routes call
`ensureAssessmentSchema()` (services/assessmentSchema.ts, shape only) lazily on
first hit. Every method below maps 1:1 to a `frontend/src/lib/api.js`
`assessment.*` method (drift guard).

### 7.1 Player endpoints (`/api/assessment`)

| Method & path | Purpose |
|---|---|
| `GET /games` | List published games (the caller's track first). |
| `POST /sessions` | Start (or resume) a session for a `gameSlug` → `{ public_id }`. |
| `GET /sessions/:id` | Session state (status, progress, current pointers). |
| `GET /sessions/:id/next` | The next item to render (mechanic + options), or `done`. |
| `POST /sessions/:id/respond` | Submit one answer `{ itemId, response, latencyMs?, confidenceWager? }`. Idempotent upsert (UNIQUE session,item). |
| `POST /sessions/:id/complete` | Compute → persist result → UPSERT user_values/user_skills (+investor_profiles) → bump user_xp → award badges. Idempotent (UNIQUE session). |
| `GET /results/me` | The caller's latest result per track (vectors, archetype, flags). |
| `GET /results/:userId` | Another user's result — **consent-gated** (only if `assessment_results.published=1`). |
| `POST /results/publish` | Toggle consent to share the caller's result (`published`). |
| `GET /badges/me` | The caller's `user_badges` + `user_xp` (level/xp). |

### 7.2 Admin endpoints (`/api/admin/assessment`, `requireAdmin`)

CRUD + version + publish/archive for `games / chapters / items / archetypes /
badges`; **preview** a game (plays without writing results); **analytics**
(completion %, per-chapter drop-off, archetype distribution per track, 8-axis
coverage, median latency); **admin re-score** a session.

### 7.3 Completion side-effects (the `/complete` contract)

1. Compute vectors (§4) from `assessment_responses`.
2. Insert one `assessment_results` row with `value_vector_json`,
   `skill_vector_json`, `confidence_json`, `flags_json`, `archetype_slug`,
   `integrity_hash` (§8). Idempotent on `UNIQUE(session_id)`.
3. UPSERT `user_values` (per dimension: score + confidence) and `user_skills`
   (per skill: self_level), and `investor_profiles` for `thesis_lab_v1`.
4. Bump `user_xp`; `INSERT OR IGNORE` `user_badges` (archetype + milestones).

---

## §8 Integrity & result signing

Every computed result is signed so a stored/served result can be proven
engine-produced and untampered — mirroring the existing score-integrity helper
`services/scoreIntegrity.ts` (`signScore` / `verifyScoreHash`, HMAC-SHA256 via
`crypto.subtle`).

- Add a parallel helper in `services/assessmentScoring.ts`:
  `signResult(env, canonical) → hash` and `verifyResult(env, result) → bool`,
  keyed on **`env.SCORING_HMAC_SECRET`** (hard-required in prod; falls back to
  `JWT_SECRET` only in non-prod, exactly like `scoreIntegrity.ts`).
- The signed **canonical** payload is the deterministic serialization of
  `{ userId, sessionId, track, valueVector, skillVector, archetypeSlug,
  integrityVersion }` with **sorted keys** (so JSON ordering can't change the
  hash). Store the result in `assessment_results.integrity_hash` with
  `integrity_version` pinning the algorithm.
- `GET /results/*` may include a `verified: true|false` field computed via
  `verifyResult`. Admin re-score recomputes and re-signs.

---

## §9 Player UI

Spec for Prompt A2. **No survey look** — one decision per screen, motion,
reveal. React 19 + Vite + Tailwind 4 + react-router 7; all new components carry
`dark:` variants; mobile-first and swipeable. Reuse `useToast`,
`useEscapeClose` (modals), `PageExplainer` (page headers), `recharts` (radar),
`lucide-react` (icons). No new data-fetching lib — `useEffect`/`useState` +
`api.js`.

### 9.1 Pages

- **`/play` → AssessmentHubPage**: the caller's track game, an XP/level bar, the
  badge wall, the current archetype card, and a "Play / Continue" CTA.
- **`/play/:gameSlug` → AssessmentGamePage**: the full-screen player. Renders
  per mechanic:
  - `dilemma` → two big choice cards, tap to pick, satisfying transition.
  - `card_sort` → drag the deck, keep top `config.pick_n`.
  - `sjt` → "which lever?" cards + optional confidence-wager slider.
  - `speed` → timed binary with a countdown ring (`config.timer_ms`), record
    latency and send it on `/respond`.
  - `allocation` → sliders summing to `config.total`.
  - `reflection` → the **Scout Report reveal**: the `recharts` radar fills in +
    the archetype card.
  A chapter progress bar; XP pops + badge-unlock toasts (`useToast`).
- **`/play/card` → ProfileCardPage**: the shareable archetype **trading card**
  (radar + archetype + top values + top skills + badges), with **PNG export**
  and the existing deck-share CTA.

### 9.2 Integration & motion

After onboarding persona classification, offer **"Discover your {archetype}"**
that routes into the track game — don't force it; make it the fun path. Each
answer advances with motion; the final reflection step animates the radar
filling axis-by-axis before revealing the archetype and any new badges.

Acceptance (A2): a new founder plays `founder_origin_v1` end-to-end on mobile,
watches their radar fill, gets an archetype + badge, and views/shares the card.
