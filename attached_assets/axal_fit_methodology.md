# Axal Fit — Methodology & Build Reference

> Canonical description of how Axal VC scores **fit** for every person who joins the
> network — founders, investors, partners, and mentors/coaches — and how that score
> flows into best-fit matching and the spin-out (venture-risk) assessment.
>
> This document mirrors the **as-built** engine. Every weight, threshold, value, and
> red flag below is reproduced from code; if you change the code, update this doc in
> the same PR. Sources: `cloudflare-worker/src/services/axalFit.ts`,
> `cloudflare-worker/src/services/advisor/banks/fit.ts`,
> `cloudflare-worker/src/services/bestFit.ts`,
> `cloudflare-worker/src/services/ventureRisk.ts`.

---

## 1. Philosophy — a hybrid scorecard

Axal Fit is deliberately **two passes**, not one:

1. **Structured pass (automated).** A short, human-feeling conversation in the
   Personal Advisor collects 0–5 self-ratings. These seed a weighted rubric that
   produces a 0–100 fit score, a band, behavioral-value scores, and red-flag
   probes.
2. **Human pass (the consultation).** When a member books a consultation, the admin
   opens the assembled best-fit report and applies judgment. The structured score
   **orients** the conversation; it never replaces it.

This matches Axal's operating reality — a high-throughput **30-day spin-out engine**
plus a **Strategic Scale** partnership track — where the studio meets many people and
needs a fast, consistent first read before investing human time. The values layer
(Section 5) keeps that speed honest: stewardship and integrity are scored, not
assumed.

---

## 2. Conversational delivery

The scorecard is delivered **one question at a time** inside the existing Personal
Advisor — not as a survey grid.

- Every fit question is a **0–5 `scale`** answer (`input_kind: 'scale'`,
  `validate: 'scale'`). The hint is always: *"Rate 0 (not at all) to 5 (completely)
  — answer honestly, there are no wrong answers."*
- Questions live in `banks/fit.ts` and have IDs `fit.<persona>.<key>`
  (e.g. `fit.founder.rubric.execution_ability`). They are `skip_allowed` and tagged
  `section: 'FIT'`, `page_target: '/dashboard'`.
- Each question carries a **`measures`** map (`FitMeasures` in `questionBank.ts`)
  that tells the write-router what the answer feeds:

  | `measures` field   | Feeds                                             | Store (`measure_kind`) |
  | ------------------ | ------------------------------------------------- | ---------------------- |
  | `rubric_category`  | the persona fit scorecard                          | `rubric`               |
  | `axal_value`       | one of the 5 Axal behavioral values                | `axal_value`           |
  | `skill_axis`       | the 8-axis dashboard skills radar                  | `skill`                |
  | `value_dim`        | the "where you lean" founder spectrum graph        | `value`                |
  | `red_flag`         | `{ key, at_or_below }` — flags when score ≤ N      | (sets `red_flag` col)  |

- The write-router (`writeRouter.ts` → `persistFitAnswer`) fans every `measures`
  answer into the **`axal_fit_responses`** table and then calls
  `axalFit.computeFit` to refresh the snapshot. One conversation simultaneously
  builds the rubric, the radar, the lean graph, and the values profile.

Each persona's bank = **persona rubric + the 5 Axal values + the 8 skill axes + the 5
founder lean spectrums** (`FIT_FOUNDER_BANK`, `FIT_INVESTOR_BANK`,
`FIT_PARTNER_BANK`, `FIT_MENTOR_BANK`; coach reuses the mentor bank).

---

## 3. The four persona rubrics

Each rubric category is scored **0–5** (the mean of its conversational questions).
Weights are **relative** and normalized by their sum at score time. The `look_for`
column is the human-review lens; the prompt is the exact conversational wording.

### 3.1 Founder (8 categories)

| Category | Weight | Look for | Conversational prompt |
| --- | ---: | --- | --- |
| `vision_clarity` | 15 | Can they explain the mission and why now? | "How clearly can you explain your mission and exactly why now is the moment for it?" |
| `execution_ability` | 20 | Shipping speed, focus, follow-through. | "How consistently do you turn intent into shipped progress — speed, focus, follow-through?" |
| `domain_insight` | 15 | Deep understanding of the problem space. | "How deeply do you understand the problem space — better than almost anyone else?" |
| `coachability` | 15 | Can they absorb feedback without losing conviction? | "How readily do you absorb hard feedback without losing your conviction?" |
| `resilience` | 15 | Reaction to setbacks, uncertainty, rejection. | "How well do you hold up under rejection, uncertainty, and setbacks?" |
| `communication` | 10 | Clear, concise, compelling, honest. | "How clear, concise, and honest are you when you communicate?" |
| `team_dynamics` | 10 | Trust, alignment, decision-making. | "How healthy is trust and decision-making within your team?" |
| `values_fit` | 10 | Long-term thinking, stewardship, integrity. | "How much do long-term thinking, stewardship, and integrity guide your choices?" |

### 3.2 Investor (6 categories)

| Category | Weight | Look for | Conversational prompt |
| --- | ---: | --- | --- |
| `thesis_fit` | 20 | Do they understand and support Axal VC's mandate? | "How well does your thesis understand and support Axal's mandate?" |
| `capital_quality` | 15 | Patient, strategically useful, clean capital. | "How patient and strategically useful is the capital you bring?" |
| `governance_style` | 15 | Supportive, not controlling or noisy. | "How supportive (vs. controlling or noisy) are you once invested?" |
| `reputation` | 20 | Other founders' experiences, references. | "How strong is your reputation with the founders who know you best?" |
| `decision_quality` | 15 | Good judgment under uncertainty. | "How good is your judgment under real uncertainty?" |
| `values_fit` | 15 | Long-term orientation, stewardship, fairness. | "How much do long-term orientation, stewardship, and fairness guide your investing?" |

### 3.3 Partner (6 categories)

| Category | Weight | Look for | Conversational prompt |
| --- | ---: | --- | --- |
| `strategic_alignment` | 20 | Do they amplify Axal VC's thesis? | "How directly does what you do amplify Axal's thesis?" |
| `trustworthiness` | 20 | Reliability, transparency, discretion. | "How reliable, transparent, and discreet are you in practice?" |
| `network_quality` | 15 | Access to founders, capital, operators. | "How strong is your access to founders, capital, and operators?" |
| `execution_support` | 15 | Can they actually help move deals forward? | "How much can you actually move deals and projects forward?" |
| `collaboration_style` | 15 | Low ego, responsive, constructive. | "How low-ego, responsive, and constructive are you to work with?" |
| `reputation` | 15 | References, track record, consistency. | "How consistent is your track record and what references say about you?" |

### 3.4 Mentor / Coach (6 categories — shared rubric)

| Category | Weight | Look for | Conversational prompt |
| --- | ---: | --- | --- |
| `domain_expertise` | 25 | Relevant, current, practical knowledge. | "How relevant, current, and practical is your expertise for founders today?" |
| `teaching_ability` | 20 | Can they translate complexity into action? | "How well do you translate complexity into action a founder can take?" |
| `listening` | 15 | Do they diagnose before advising? | "How much do you diagnose and listen before you advise?" |
| `founder_empathy` | 15 | Balanced support, not performative advice. | "How balanced is your support — real, not performative?" |
| `reliability` | 15 | Show up, follow through, respect boundaries. | "How consistently do you show up, follow through, and respect boundaries?" |
| `values_alignment` | 10 | Ethical, constructive, non-extractive. | "How ethical, constructive, and non-extractive is your approach?" |

---

## 4. The 5 Axal behavioral values

Asked of **every** persona, on top of the rubric. Each is scored 0–5 (mean of its
probes); a value's **confidence** is `min(1, n/2)` — two probes reach full confidence.

| Value | Probe (what it measures) | Conversational prompt |
| --- | --- | --- |
| `integrity` | Honesty and consistency between words and actions. | "When something goes wrong on your watch, how consistently do you own it openly rather than smooth it over?" |
| `stewardship` | Long-term thinking; treating capital and people as a trust. | "How much do you weigh long-term consequences — for people, capital, and reputation — over the fastest near-term win?" |
| `curiosity` | Hunger to learn, question, and update. | "How readily do you go looking for evidence that you might be wrong?" |
| `resilience` | Composure and recovery under setbacks. | "After a real setback, how quickly do you recover your footing and keep moving?" |
| `collaboration` | Low ego, builds trust, shares credit. | "How naturally do you share credit and build trust with the people around you?" |

These 5 values are the **new behavioral layer** that feeds the admin scorecard. They
are distinct from the 15-dimension value taxonomy that powers the user-facing
"where you lean" graph (Section 5.2).

---

## 5. Skills radar & values lean

Every persona's bank also includes the shared skill + lean questions so the
conversation populates the dashboard visuals.

### 5.1 Skills radar (8 axes, 0–5)

`product`, `engineering`, `design`, `gtm_sales`, `marketing_brand`, `finance_ops`,
`legal_compliance`, `capital_network`. Example prompt (`product`): *"How strong is
your product instinct — discovery, prioritization, knowing what to build?"* These
render via `components/play/SkillRadar.jsx`.

### 5.2 Values lean (5 founder spectrums)

A 0–5 self-rating maps onto a −2..+2 dimension toward the "high" pole:

| Spectrum (`value_dim`) | Prompt |
| --- | --- |
| `founder_mission_vs_profit` | "How much does a mission you believe in drive you over pure financial return?" |
| `founder_speed_vs_quality` | "When you must choose, how far do you lean toward shipping fast over polishing?" |
| `founder_risk_appetite` | "How much appetite do you have for bold, uncertain bets over safe, known paths?" |
| `founder_growth_vs_sustain` | "How much do you lean toward hyper-growth over sustainable, durable building?" |
| `founder_autonomy_vs_structure` | "How much do you prefer autonomy and flexibility over process and structure?" |

---

## 6. Red flags

Seven behavioral risks. A red flag is **probed inline**: specific questions carry a
`red_flag: { key, at_or_below }` so a low self-rating on a sensitive item is recorded
as a flag for the human reviewer. They never auto-reject; they steer diligence.

| Flag | Meaning | Probed by (score ≤ threshold) |
| --- | --- | --- |
| `overconfidence` | Overconfidence without evidence | founder `coachability` (≤1) |
| `blame_shifting` | Blame-shifting | `integrity` value (≤1) |
| `inconsistent_stories` | Inconsistent stories | surfaced in human review |
| `poor_follow_through` | Poor follow-through | surfaced in human review |
| `ego_over_collaboration` | Ego over collaboration | `collaboration` value & partner `collaboration_style` (≤1) |
| `transactional` | Treating people as transactions | surfaced in human review |
| `weak_ethics` | Weak ethics under pressure | surfaced in human review |

`computeFit` collects the distinct flags raised for the user+persona and attaches
them (and their count) to the score snapshot and narrative.

---

## 7. Scoring & the decision rule

**Total score (0–100).** Only answered categories count, so a partial conversation
still scores on what's known:

```
total = ( Σ_answered [ weight × (score / 5) ] / Σ_answered [ weight ] ) × 100
```

**Bands** (`bandFromScore`, `BAND_LABEL`):

| Score | Band | Label |
| --- | --- | --- |
| ≥ 85 | `strong_yes` | Strong yes |
| 70–84 | `yes_caution` | Yes, with caution |
| 55–69 | `hold` | Hold / more diligence |
| < 55 | `no` | No |

**Signal quality (0–1).** How much to trust the score:

```
signal_quality = 0.6 × coverage + 0.4 × mean(value_confidence)
```

where `coverage` = share of rubric categories answered and each value's confidence is
`min(1, n/2)`.

**Narrative.** `computeFit` auto-writes a one-line read, e.g. *"Yes, with caution for
founder. Strongest: Execution ability, Vision clarity. Develop: Team dynamics,
Communication. Watch: 1 red flag(s)."*

**Final hybrid rule.** The band is a recommendation, not a verdict. The admin combines
**score + band + signal quality + red flags + the consultation conversation** before
acting. A high score with low signal quality means "promising, but talk to them";
a red flag on integrity outranks a strong rubric.

---

## 8. From fit to matching & the spin-out assessment

The same vectors power two downstream surfaces.

### 8.1 Range of matches (`services/bestFit.ts`)

`loadMatchVectors` merges the canonical `user_skills`/`user_values` stores with the
conversational `axal_fit_responses` skill/value signal, so a member who only did the
advisor conversation still matches. `matchPair` scores a viewer against a candidate:

```
align    = confidenceAdjustedAlignment(viewer.values, candidate.values)   // −1..1
comp     = skillComplementarity(viewer.skills, candidate.skills)          // 0..100
alignPct = ((align + 1) / 2) × 100
match_score = round( 0.5 × alignPct + 0.5 × comp )                        // 0..100
```

with `reasons`, `watch_outs`, and skill `gaps`. Matches are computed for four
counterparty types — **co-founders, investors, partners, mentors/coaches** — as the
member's "range of potential matches." Counts always return; named/contact detail is
`studio`-tier gated for non-bypass roles (the backend still computes the full set so
admin reporting is unaffected).

### 8.2 Spin-out assessment (`services/ventureRisk.ts`)

When the member owns a project, the admin report attaches the **10-layer venture-risk
assessment** (Founder, Market, Competition, Timing, Financing, Marketing,
Distribution, Technology, Product, Hiring). Each layer is 0–100 risk (lower = safer)
with low/medium/high bands; the headline is **Derisk Score = 100 − overall_risk**.
Overall risk is stage-weighted (early tilts Founder/Market/Product; growth tilts
Distribution/Hiring/Financing).

### 8.3 The assembled admin report (`buildReport`)

`GET /api/bestfit/report/:userId` (admin-only, never tier-gated) returns:
`skill_vector`, `value_lean`, the 5 `axal_values`, the per-persona `fit` snapshot,
the range of `matches`, `gaps_to_fill` (weakest skill axes < 2.5 — what a co-founder
or hire should cover), and the `spinout_assessment`. Rendered at **`/admin/best-fit`**
(`AdminBestFitPage.jsx`) with the consultation queue.

---

## 9. Data model reference

Migration `cloudflare-worker/sql/migrations/115_axal_fit.sql` (mirrored in
`schema.sql`):

- **`axal_fit_responses`** — one row per answered question
  (`measure_kind` ∈ rubric/skill/value/axal_value, `measure_key`, `score`,
  `red_flag`). The single source the loaders aggregate.
- **`axal_fit_scores`** — the persisted scorecard snapshot per (user, persona):
  `total_score`, `band`, `rubric_json`, `red_flags_json`, `signal_quality`,
  `narrative_fit`. Latest row is current.
- **`admin_consultation_bookings`** — consultation requests + status
  (`requested`/`confirmed`/`completed`/`declined`/`cancelled`), linked to a report.
- **`axal_fit_reports`** — persisted best-fit report snapshots (precomputed on
  booking so the admin has it ready).

---

## 10. Replit Agent build prompts

Sequenced, copy-paste prompts to rebuild this feature from scratch on Replit. **Each
prompt must respect the architecture guardrails in the appendix** — paste those at the
top of every Replit session.

### Prompt 0 — Fix the onboarding chatbot
> The onboarding chatbot in `cloudflare-worker/src/routes/profiling.ts` feels broken.
> Route its `/chat` turn through the shared AI router on a **dedicated, non-gateway**
> task class (so a misconfigured `advisor-ongoing` AI Gateway can't dead-end it), and
> in `services/aiRouter.ts` (a) retry the same model un-gatewayed when a gatewayed
> call fails, and (b) parse `result`/`response`/`choices[].message.content` response
> shapes before falling back to empty. Add `test/aiRouter.bugfix.test.ts` covering the
> gateway-bypass retry and the response-shape parsing. Keep `degraded:true` graceful
> fallback. Run `npm run test:drift`.

### Prompt 1 — Data model + scoring engine
> Add idempotent migration `sql/migrations/115_axal_fit.sql` (+ `schema.sql` mirror)
> with `axal_fit_responses`, `axal_fit_scores`, `admin_consultation_bookings`,
> `axal_fit_reports`. Add `services/axalFit.ts` encoding the four persona rubrics with
> the weights in this doc, the 5 Axal values, the 7 red flags, the 0–100 weighted
> score, the bands (≥85/70/55), `signal_quality`, and `narrative_fit`. Add
> `test/axalFit.test.ts` asserting rubric totals, bands, and red-flag collection.

### Prompt 2 — Conversational delivery in the Personal Advisor
> Add `input_kind: 'scale'` (+ a `scale` validator) and a `measures` map
> (`FitMeasures`) to `services/advisor/questionBank.ts`. Add `services/advisor/banks/
> fit.ts` with the per-persona banks (rubric + 5 values + 8 skills + 5 lean spectrums)
> using the exact prompts in this doc; register them and add `BANK_SIZE_TARGETS`. In
> `writeRouter.ts`, fan every `measures` answer into `axal_fit_responses` and call
> `computeFit`. Render the 0–5 control in the advisor chat UI. Run `npm run test:drift`
> (the advisor scenario suite allows `axal_fit_responses` as a per-persona target).

### Prompt 3 — Dashboard surfacing (all roles)
> Add `GET /api/advisor/fit` returning the assembled profile (skill vector, value
> lean, the 5 Axal values, fit score + band, completion %, match summary); detail
> tier-gated, summary always returns. Add `components/profile/` cards (skills radar via
> `play/SkillRadar.jsx`, values lean, matches, a "Book with Guillaume" CTA) and wire a
> "Your Profile & Fit" section into `Dashboard.jsx`. **Add the `api.js` method only with
> its worker mount** or the drift test fails.

### Prompt 4 — Range of matches
> Add `services/bestFit.ts` + `GET /api/bestfit/matches` computing top-N matches across
> co-founder/investor/partner/mentor using `services/matchingVectors.ts`
> (`loadUserVectors`, `confidenceAdjustedAlignment`, `skillComplementarity`,
> `computeWatchOuts`). Free → counts + one teaser; full detail → `ensureTier('studio')`.

### Prompt 5 — Admin best-fit report + consultation booking
> Add `POST /api/bestfit/consult` (precompute + store the report on booking),
> `GET /api/bestfit/consultations` (admin queue), `POST /api/bestfit/consultations/:id/
> status`, and `GET /api/bestfit/report/:userId` (`requireAdmin`, never tier-gated) that
> assembles skills/values/axal-values, the per-persona fit, the range of matches with
> reasons, `gaps_to_fill`, and the 10-layer spin-out assessment from
> `services/ventureRisk.ts`. Build `pages/AdminBestFitPage.jsx` (queue + report) at
> `/admin/best-fit`, admin-guarded, in the sidebar.

### Prompt 6 — Methodology doc
> Write `attached_assets/axal_fit_methodology.md` (this file) mirroring the engine
> exactly, and keep it in sync with `axalFit.ts` + `banks/fit.ts` in any future PR.

---

## Appendix — Architecture guardrails (paste at the top of every Replit prompt)

From `CLAUDE.md` (the canonical architecture doc):

- **The Cloudflare Worker is production** (`axal.vc/api/*`). Implement every new
  feature as a **worker route in `cloudflare-worker/src/routes/` first**, mounted in
  `src/index.ts`.
- **Do not add an `/api/*` method to `frontend/src/lib/api.js` without a matching
  worker route.** `npm run test:drift` enforces this on every PR.
- **D1 (`studioos-db`) is the canonical store.** Schema changes are **numbered,
  idempotent** migrations in `cloudflare-worker/sql/migrations/` applied via
  `wrangler d1 execute`, with the same change mirrored into `sql/schema.sql`.
- **Never modify `wrangler.toml`'s `main` field.** The FastAPI in `backend/` is
  Replit-dev-only and is **never deployed** (Workers don't run Python).
- Keep `npm run test:drift` (drift checks + worker tests + `tsc --noEmit`) and
  `cd frontend && npm run build` green at every stage.
