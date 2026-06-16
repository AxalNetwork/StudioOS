# Gamified Assessment System — Design Spec

> **One-line:** Replace value/skill *surveys* with short, scenario-driven
> *games* whose every choice is a behavioural signal — and write the result
> into the **canonical taxonomy tables the matching engine already reads**, so
> mentor / co-founder / investor / partner matching lights up with zero changes
> to those consumers.

This document is the authoritative design. It is paired with:
- **Schema** — `cloudflare-worker/sql/migrations/107_assessment_engine.sql` (content) + `108_assessment_play.sql` (per-user play & results).
- **Build prompts** — `design/REPLIT_PROMPTS.md` (Phases A1–A4).

---

## 0. Why this is not a survey

A survey asks *"Rate your risk appetite 1–5."* People answer how they want to
be seen. A game puts them at a fork — *"The demo is Friday and the build has
three rough edges: ship, or slip two weeks?"* — and infers risk appetite from
the **choice**, the **trade-off they accepted**, and **how fast they answered**.

Five design rules make it feel like a game, not a form:

1. **Forced trade-offs, never Likert.** Every prompt costs something. You can't
   max every value; choosing one pole means giving up the other.
2. **No visible "right answer."** Options are loaded toward opposite poles of a
   spectrum; both are legitimate.
3. **Reveal as reward.** You play to *discover yourself* — each chapter fills in
   your radar and ends by unlocking your **Archetype card**.
4. **Motion & scarcity.** Drag-to-rank decks, timed gut-checks, fund-allocation
   sliders — mechanics that are inherently playful.
5. **Progression.** XP, levels, badges, a shareable trading card, and an
   optional "one dilemma a day" streak.

---

## 1. The canonical insight (architecture)

The platform **already** has the destination tables every matcher reads:

| Canonical table | Migration | What it holds |
|---|---|---|
| `user_values` | 094 | `(user_id, dimension_id, score −2..+2, confidence 0..1)` |
| `user_skills` | 091 | `(user_id, skill_id, self_level 0..5)` |
| `investor_profiles` | 009 / 096 | thesis: sectors, stages, anti-thesis, `value_weights_json` |
| `value_dimensions` | 089/090 | 10 Schwartz (unipolar) + 5 founder bipolar spectrums |
| `skill_categories` | 089/090 | the 8 radar axes |

**The game is a new front door onto those same outputs.** On session completion
the worker computes a value vector + skill vector and **UPSERTs them into
`user_values` / `user_skills`** (and `investor_profiles` for the investor
track). The game's own rich record (archetype, badges, latency, confidence)
lives in the new `assessment_results`. Nothing downstream has to change.

```
   ┌─────────────┐   plays    ┌──────────────────┐  computes   ┌───────────────────┐
   │   Player    │──────────▶ │  Assessment Game  │ ──────────▶ │ assessment_results │
   └─────────────┘            │ (107 content +    │             │ (108: card, XP,    │
                              │  108 sessions)    │             │  archetype, badges)│
                              └──────────────────┘             └─────────┬─────────┘
                                                                          │ UPSERT vectors
                                                                          ▼
                                          ┌──────────────────────────────────────────┐
                                          │ user_values · user_skills · investor_*    │  ← matching reads these
                                          └──────────────────────────────────────────┘
```

> **Do NOT invent a parallel values store.** Write to `user_values` /
> `user_skills`. They are the contract.

---

## 2. The six persona tracks

The assessment differs per persona. `track` is a **stable enum, independent of
the `users.role` CHECK** (`admin|founder|partner|investor`) — mentors and
coaches are modelled via the `mentors` table + personas, not a DB role, so they
get their own track without fighting the role constraint. The route layer
resolves a user's eligible track(s) from `role` + persona + the
`mentors`/`partners` records.

| Track | Game (seeded) | Emphasis | Primary outputs → consumers |
|---|---|---|---|
| `founder_new` | **Founder Origin** | Values (all 5 founder spectrums + Schwartz), **baseline** skill self-claim across 8 axes (low confidence expected), motivation, coachability | Founder Archetype + radar + "gaps to fill" → **mentor & co-founder matching**, Spin-Out Lab |
| `founder_existing` | **Operator's Path** | **Evidence-backed** skills (higher seniority), leadership values, scaling trade-offs, resilience | Refined evidence-weighted radar + leadership archetype + blind spots → **key-hire / co-founder + investor matching**, advisory |
| `investor_lp` | **Thesis Lab** | Risk appetite, sector/stage thesis, conviction style, decision process, liquidity horizon, value-add style | Investor Archetype + thesis vector → `investor_profiles` → **founder↔investor & co-investor matching**, IC fit |
| `partner` | **Partner Playbook** | Domain depth (which of 8 axes they serve), working style, engagement model, responsiveness, client-stage fit | Partner expertise radar + service archetype → **founder↔partner marketplace matching** |
| `mentor` | **Mentor Compass** | Coaching style (directive↔socratic), domain strengths, what they index for in founders, availability | Mentor Archetype + style vector + domain radar → **mentor↔founder matching**, office hours |
| `coach` | **Coach's Lens** | Coaching modality, focus areas (leadership, resilience, communication, conflict, wellbeing), engagement cadence | Coach Archetype + focus profile → **coach↔founder matching**, wellbeing/experts |

> **Mentor vs Coach is a deliberate split.** Mentors offer *domain* expertise
> (the 8 skill axes); coaches offer *personal / leadership / wellbeing*
> development. They match on different signals and feed different surfaces.

---

## 3. Game mechanics (the reusable kit)

Six mechanics, mixed per track. Each maps cleanly to what it measures. All are
content-driven by `assessment_items.mechanic` + `options_json`.

| Mechanic | Player feel | Measures | How it scores |
|---|---|---|---|
| **`dilemma`** — *The Crossroads* | Two/three-way fork, pick one | Values (esp. 5 founder spectrums) | Chosen option's `loads` apply `−2..+2` to named `value_dimensions` |
| **`card_sort`** — *Priorities Draft* | Drag a deck, keep only top *N* | Value priorities (Schwartz) | Rank position scales each card's load; un-kept cards score negative |
| **`sjt`** — *Prove It* | "Which lever do you pull?" | **Skills** (8 axes) + seniority | Option carries an axis `load` + a `seniority_hint` (aware→expert) → `user_skills.self_level` |
| **`speed`** — *Gut Check* | Timed binary, ~6s each | Values, low-deliberation | Same loads as dilemma; scorer **weights fast answers as stronger** revealed preference; latency stored |
| **`allocation`** — *Build the Fund* | Split a fixed budget across buckets | Thesis / priorities (investor, partner) | Allocation % scales each bucket's loads |
| **`reflection`** — *Scout Report* | The reveal: radar fills, archetype named | — (output chapter) | No scoring; renders the result, awards the archetype badge |

### Anti-gaming / integrity (mirror the scoring engine)
The startup-scoring engine is HMAC-signed + anomaly-flagged. The assessment
borrows the ethos so a **published profile vector can be trusted by matching**:

- **Confidence wagering** — optional "how sure are you?" on `sjt` items; stored
  in `assessment_responses.confidence`. Well-calibrated players earn the
  **Calibrated** badge; over-claimers get down-weighted.
- **Contradiction checks** — the same spectrum is probed by ≥2 mechanics
  (e.g. `dilemma` + `speed`). Large disagreement → a `flags_json` entry and a
  lower `confidence_json` for that dimension.
- **Latency floors** — implausibly fast non-speed answers are flagged.
- **Evidence + endorsements corroborate skills** — `sjt` self-claims can be
  backed by `user_skills.evidence_url` and peer `skill_endorsements` (091).
  Matching weights down extreme, un-corroborated self-claims.
- **Integrity hash** — `assessment_results.integrity_hash` = HMAC over the
  canonical result via `SCORING_HMAC_SECRET` (reuse the scoring helper).

---

## 4. Scoring → canonical vectors

On `POST /sessions/:id/complete` the worker (`services/assessmentScoring.ts`):

1. **Aggregate responses.** For each `value_dimensions.slug`, sum the chosen
   options' loads, normalise to `−2..+2`, and compute a `confidence` from
   coverage (how many items hit it) and consistency (contradiction penalty).
   *This is the same shape `user_values` already stores (094).*
2. **Derive skill vector.** For each of the 8 `skill_categories`, take the best
   `sjt` `seniority_hint` + load → a `self_level 0..5`. Map onto the per-skill
   rows the founder claimed (or the axis aggregate when no specific skill).
3. **Assign archetype.** Nearest `assessment_archetypes` centroid (by track) to
   the player's `{value_vector, skill_vector}` (weighted Euclidean / cosine).
   Store `archetype_slug` + `archetype_score`.
4. **Award badges.** Evaluate `badge_catalog.criteria_json` (e.g. *risk_taker*
   if `founder_risk_appetite ≥ +1.5`, *full_radar* if all 8 axes present).
5. **Persist + sign.** Write `assessment_results` (+ `integrity_hash`).
6. **UPSERT canonical.** `user_values` (per dimension), `user_skills` (per
   claimed skill); for `investor_lp`, also patch `investor_profiles`
   (`sector_focus`, `stage_focus`, `value_weights_json`).
7. **Meta-game.** Increment `user_xp` (XP for completion + per-chapter), bump
   level, update streak; insert `user_badges` (idempotent on the UNIQUE).

> **Determinism + integrity:** scoring is pure and reproducible from
> `assessment_responses` + item `loads`, so an admin "re-score" after a content
> fix is safe and the integrity hash re-verifies.

---

## 5. Archetypes & the Profile Card (the payoff)

The headline output is a **named archetype** + a shareable **trading card**
(radar + archetype + top values + top skills + badges). Seeded archetypes:

- **Founder:** The Builder · The Visionary · The Operator · The Hustler · The Scientist
- **Operating founder:** The Captain · The Closer (+ founder set)
- **Investor/LP:** The Conviction Bettor · The Portfolio Architect · The Network Catalyst
- **Partner:** The Specialist · The Swiss Army
- **Mentor:** The Socratic · The Playbook
- **Coach:** The Steadier · The Sharpener

The card is the social object: shareable via the existing **deck-share /
referral** infrastructure (it already tracks share views & conversions),
exportable as PNG, and shown on profiles + at events so networking/matching has
a face. It replaces "survey results you never look at again."

---

## 6. Data model

Defined in migrations **107** (content/config) and **108** (per-user play). Full
DDL there; summary:

**107 — content (admin-authorable, versioned, reference data):**
`assessment_games` · `assessment_chapters` · `assessment_items` ·
`assessment_archetypes` · `badge_catalog`.

**108 — per-user play & results:**
`assessment_sessions` · `assessment_responses` · `assessment_results` ·
`user_xp` (**side table**, `user_id` PK — `users` is at D1's 100-col ALTER
limit) · `user_badges`.

**Writes into existing tables (in code, not schema):** `user_values`,
`user_skills`, `investor_profiles`.

> **Migration hygiene (GOTCHAS):** additive-only, `IF NOT EXISTS` /
> `INSERT OR IGNORE`; carry a lazy bootstrap `ensureAssessmentSchema()` so
> routes self-heal before the migration is applied. **Never `ALTER TABLE
> users`** — `user_xp` is a side table for exactly this reason.

---

## 7. API surface (worker-first)

All under `cloudflare-worker/src/routes/`. **Every method added to
`frontend/src/lib/api.js` must have a matching worker route or `npm run
test:drift` fails.**

### `routes/assessment.ts` (auth'd)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/assessment/games?track=` | Games available to the caller's track |
| POST | `/api/assessment/sessions` | Start/resume a session for a game |
| GET | `/api/assessment/sessions/:id` | Session state + progress |
| GET | `/api/assessment/sessions/:id/next` | Next item(s) (supports speed-round batching) |
| POST | `/api/assessment/sessions/:id/respond` | Submit a response → XP delta, unlocked badge |
| POST | `/api/assessment/sessions/:id/complete` | Finalise → compute, sign, UPSERT canonical |
| GET | `/api/assessment/results/me` | My profile card (radar, archetype, badges, XP) |
| GET | `/api/assessment/results/:userId` | Another's **published** card (consent-gated) |
| POST | `/api/assessment/results/publish` | Toggle visibility to matching/network |
| GET | `/api/assessment/badges/me` | My badge wall |

### `routes/admin_assessment.ts` (admin — mount **before** `/api/admin`)
CRUD + version + publish `games`/`chapters`/`items`/`archetypes`/`badges`;
preview a game; analytics (completion %, chapter drop-off, archetype
distribution, axis coverage); admin re-score a session.

> **Mount precedence:** like `/api/admin/telegram` & `/api/admin/x`, the
> specific `/api/admin/assessment` router MUST be registered **before** the
> catch-all `/api/admin` in `index.ts`.

---

## 8. Matching integration

No new matching tables — extend the existing engines (`routes/matches.ts`,
`cofounder.ts`, `mentors.ts`, `investor_signals.ts`) to read the canonical
vectors the game now populates:

- **Complementarity (co-founder, key-hire):** cosine *distance* on the skill
  vector — you want a partner whose strong axes are your weak ones.
- **Alignment (values):** Euclidean *closeness* on the founder bipolar
  spectrums + Schwartz priorities (small distance = aligned). Surface the 1–2
  spectrums where they diverge most as a "watch-outs" note.
- **Investor↔founder:** thesis match (`investor_profiles`) × value alignment ×
  stage/sector — already partly built; the game enriches `value_weights_json`.
- **Mentor/coach↔founder:** domain radar overlap (mentor) or focus-area fit
  (coach) × style preference × the founder's declared gaps.

Down-weight extreme self-claims lacking `confidence`, evidence, or endorsement.

---

## 9. Frontend

React 19 + Vite + Tailwind 4 + `recharts` (radar) + `lucide-react`. Add `dark:`
variants (the `check-dark-mode` drift guard enforces this on new files).

| Route | Component | Notes |
|---|---|---|
| `/play` | `AssessmentHubPage` | Pick your track's game; XP/level, badge wall, archetype |
| `/play/:gameSlug` | `AssessmentGamePage` | Full-screen player: card-flip dilemmas, drag card-sort, timed gut-check, allocation sliders, chapter transitions, radar reveal |
| `/play/card` | `ProfileCardPage` | The shareable archetype trading card (PNG export + deck-share) |
| `/admin/assessment` | `AdminAssessmentPage` | Authoring + analytics (admin-gated) |

- **Onboarding integration:** after the persona classifier
  (`/onboarding/chat`), route new users into their track game as the *fun*
  onboarding — it replaces dry forms and produces the matching signal up front.
- **Player UX:** mobile-first, swipeable, one decision per screen, progress
  bar, satisfying micro-rewards (XP pops, badge unlocks), chapter "scout
  report" reveals. No numeric scales on screen — only choices.
- **Reuse:** `useToast`, `useEscapeClose` (modals), `PageExplainer` (headers),
  `recharts` radar, the deck-share CTA for sharing the card.
- **Sidebar:** add a "Discover" / "Play" entry per role in `sidebarConfig.js`.
- **Public teaser:** a "Discover your Founder Archetype" CTA on the landing
  page → registration → game (a growth loop; ties to referral attribution).

---

## 10. Build phases

See `design/REPLIT_PROMPTS.md` Phases **A1–A4**:
- **A1** — apply 107/108; worker `routes/assessment.ts` + `services/assessmentSchema.ts` + `services/assessmentScoring.ts`; `api.js` methods; drift green.
- **A2** — player frontend (hub, game, card) + onboarding hook.
- **A3** — admin authoring + analytics.
- **A4** — matching integration + corroboration weighting + content bank expansion for all six tracks.
