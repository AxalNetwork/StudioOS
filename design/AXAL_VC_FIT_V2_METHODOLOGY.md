# Axal VC Fit & Values v2 — Methodology

> **Status: canonical for Fit v2.** The code is the source of truth; this doc
> explains the *why* and pins the *what*. If they disagree, the code wins —
> fix the doc. Fit **v1** (the conversational per-persona rubric) keeps
> running unchanged and is documented in `attached_assets/axal_fit_methodology.md`;
> v2 is an additive layer on top, not a replacement.

## Source of truth

| Concern | File |
|---|---|
| Values / archetypes / skills libraries, role templates | `cloudflare-worker/src/services/fitRoles.ts` |
| Scoring engine, thresholds, six-outcome rubric, playbooks | `cloudflare-worker/src/services/fitDecision.ts` |
| Question schema extension (`FitV2Spec`), id regex, registries | `cloudflare-worker/src/services/advisor/questionBank.ts` |
| Shared question modules (values/archetypes/skills/validation/context) | `cloudflare-worker/src/services/advisor/banks/fitV2Shared.ts` |
| Per-role banks (+ role rubric add-ons) | `banks/fitV2_{founder,investor,partner,advisor,internal_hire,portfolio_talent}.ts` |
| Answer routing / structured fan-out | `cloudflare-worker/src/services/advisor/writeRouter.ts` (`routeFitV2Answer`) |
| Staged API | `cloudflare-worker/src/routes/fit.ts`, admin: `routes/admin_fit.ts` |
| Tables | `cloudflare-worker/sql/migrations/151_fit_v2.sql` (`fit_sessions`, `fit_decisions`, `fit_reviews`, `fitv2_*` skills seed) |
| Tests that pin this doc's claims | `cloudflare-worker/test/fitDecision.test.ts`, `fitBankV2.test.ts`, `fitRoutes.test.ts`, `writeRouter.fit.test.ts` |

---

## 1. Purpose & use cases

Fit v2 answers a **decision** question, not a personality question: *should
Axal engage this person in this role context — and under what conditions?*

It is built for: founder evaluation · operator/advisor matching · team
design · internal hiring · portfolio-support talent placement · culture
alignment. The same instrument serves the product (staged assessment +
Personal Advisor) and live human conversations (the reviewer guide in §10
and the per-question `signal_notes`/`followup_prompts` are written for an
Axal partner sitting across the table).

### Core principle — three layers, kept separate

| Layer | Question it answers | Measured as | Never used as |
|---|---|---|---|
| **Values** | What do they optimize for? | Distance from the Axal baseline (culture fit) | A skills proxy |
| **Archetypes** | How do they tend to operate? | Preference profile (primary + secondary) | A ranking — no archetype is "better" and archetype **never gates an outcome** |
| **Skills** | What can they reliably execute? | Evidence-capped capability vs a role template (role fit) | A culture proxy |

Measurement → validation → interpretation → action, in that order. The
layers are scored independently and only the decision rubric (§7) combines
them — which is exactly what makes "strong values, weak skills" (conditional
fit) and "strong skills, weak fit" (specialist or misaligned) *different
outputs* instead of one blended number.

### Design inheritances from v1 (kept deliberately)

1. **Behavioral over biographical** — items anchor on concrete behavior.
2. **Calibrated, not absolute** — everything normalizes over *answered*
   weights; missing answers lower coverage/confidence, never the score.
3. **Deterministic and explainable** — no LLM anywhere in the scoring path;
   every number traces to an item response and a template weight.
4. **The engine serves the human** — scores start the partner conversation
   ("Book with Guillaume"); the reviewer layer (§8) records the judgment.

### What v2 adds over v1

Self-report alone is the v1 gap. v2 adds: tradeoffs and situational
judgment (options with keyed loads, so socially-desirable answering has no
gradient to climb) · behavioral-evidence probes (claims without examples are
capped) · reverse-keyed consistency pairs with contradiction detection · a
confidence score that gates the rubric · role templates over 10 priority
skills · the six-outcome decision rubric · a reviewer/override layer · two
staged-only role contexts (internal hire, portfolio talent).

---

## 2. Layer 1 — the six Axal values

The five v1 behavioral values (stored per-user in `axal_values`, defined in
`axalFit.ts::VALUE_SPECS`) plus one v2 addition. v1 scoring still reads its
five; only the v2 culture score reads all six.

| Key | Label | Definition | Positive signals | Negative signals |
|---|---|---|---|---|
| `integrity` | Integrity | Does what they said; owns mistakes instead of shifting blame | Names their own decision as the cause before being asked; discloses slippage early | Blame-shaped stories; ownership language only after prompting |
| `stewardship` | Stewardship | Treats capital, people, and reputation as a trust to protect | Talks downside protection unprompted; spends others' budget more carefully than their own | Resources framed as fuel for personal trajectory |
| `curiosity` | Curiosity | Seeks what they don't know; updates on evidence | Can name the counter-argument they're currently testing | "Very open-minded" with no live example |
| `resilience` | Resilience | Recovers from setbacks; keeps execution moving | Has a repeatable recovery routine with artifacts | Recovery depends on rescue or long withdrawal |
| `collaboration` | Collaboration | Builds with others; shares credit; mission over ego | Stories star other people | Every anecdote has one hero |
| `ambition` **(new)** | Compounding Ambition | Plays long games at high standards; durable advantage over quick optics | Concrete multi-year commitments already in motion | Long-term language, short-term behavior |

Why `ambition` (and not `ownership`): v1 `integrity` already covers owning
outcomes (its red-flag probe is literally `blame_shifting`); the genuine gap
in the v1 five was time-horizon and standards. Adding a value required **zero
schema change** — `axal_values.value_key` is unconstrained TEXT — and v1
surfaces simply don't render the sixth key.

**How each value shows up per context** (used when interpreting, not scored):
a founder's `stewardship` reads as burn discipline and investor-update
honesty; an investor's as treating founder trust/valuation power as held in
trust; an operator's as confidentiality across portfolio companies; an
advisor's as flagging conflicts unprompted; a team member's as spending the
company's time like their own.

Item design per value (5 items × 6 values = 30): direct likert (core) ·
indirect likert · tradeoff under pressure (core, also conversational) ·
behavioral-evidence probe (core) · SJT. The three v1 red-flag probes ride the
direct likerts with the identical keys/threshold (`blame_shifting`,
`transactional`, `ego_over_collaboration`, all `at_or_below: 1`); the
integrity tradeoff/SJT concealment options fire `weak_ethics` directly.

---

## 3. Layer 2 — the six operating archetypes

The four v1 trait axes (`archetypeScoring.ts::ARCHETYPE_TRAITS`) plus two v2
additions. Traits are scored 0–5 as *preference*; the classifier is
nearest-centroid over shaped (not one-hot) centroids and reports **primary +
secondary + margin**, never a box.

| Slug | Label | Operates by | Thrives | Risk to watch |
|---|---|---|---|---|
| `builder` | The Builder | Making the thing; prototype-first reasoning | Zero-to-one, ambiguous problems made concrete | Breadth over finish; process allergy |
| `visionary` | The Visionary | Framing the future; leverage points and sequencing | Direction-setting, narrative, fundraising | Analysis/narrative outruns action |
| `connector` | The Connector | People and momentum; selling the future | GTM, partnerships, unblocking socially | Overpromise; follow-through depends on others |
| `operator` | The Operator | Systems, cadence, accountability | Scale, reliability, turning chaos into a machine | Over-process in ambiguity |
| `scout` **(new)** | The Scout | Exploring frontiers; early signal; cross-domain synthesis | Sourcing, new markets, research | Novelty-chasing; weak exploitation |
| `steward` **(new)** | The Steward | Protecting quality, trust, downside | Diligence, governance, craft | Over-caution; veto energy |

Centroids live in `fitDecision.ts::FIT_V2_ARCHETYPES`; classification needs
≥3 answered axes; confidence = `0.6·coverage + 0.4·separation` (the v1
formula). The four v1 direct likerts also carry `measures.archetype_trait`,
so the v1 per-persona classifier keeps getting richer — additively.

Item design (24): 6 direct likerts (core) · 6 indirect likerts · 6
forced-choice pairs (core; each option loads one trait at 4.5 — no "right"
answer) · 6 SJTs (2 core; options load 2–4 traits). The pairs/SJTs are the
conversational slice's backbone precisely because they're preference-keyed:
there is nothing to fake toward.

Role affinity (e.g. founders skew builder/visionary, investors
scout/steward) is **narrative-only** — `FitRoleTemplate.archetypeAffinity`
feeds copy, never thresholds.

---

## 4. Layer 3 — the ten priority skills

Observable capabilities, seeded as `fitv2_*` rows in the existing `skills`
catalog (migration 151; `display_order 901+` keeps them clear of the v1
radar's representative-skill resolution). The 8-axis radar remains the
*domain* view; these ten are the *studio-operating* view.

| Slug | Skill | Domain (radar axis) |
|---|---|---|
| `fitv2_fundraising_narrative` | Fundraising & Capital Narrative | capital_network |
| `fitv2_market_research` | Market Research | product |
| `fitv2_analytical_judgment` | Analytical Judgment | finance_ops |
| `fitv2_product_thinking` | Product Thinking | product |
| `fitv2_sales_relationships` | Sales & Relationship Building | gtm_sales |
| `fitv2_hiring` | Hiring | capital_network |
| `fitv2_execution_management` | Execution Management | finance_ops |
| `fitv2_communication` | Communication | marketing_brand |
| `fitv2_diligence` | Diligence | finance_ops |
| `fitv2_strategic_synthesis` | Strategic Synthesis | product |

**Two tracks per skill — claim and evidence.** Self-ratings (10 likerts,
"anchor on the last 12 months") set the claim; SJT scenario answers and
behavioral-evidence probes set validation. A skill with **no** evidence/SJT
signal is capped at **3.5/5** (`unvalidated_skill_cap`) no matter how high
the self-rating — self-confidence is not competence, by construction.
Recency probes (4, `weight: 0.6`) refine the engine's number without
touching the `user_skills` display row.

Item design (24): 10 self likerts (core) · 5 SJTs (fundraising, sales,
hiring, diligence, execution; 2 core) · 5 evidence probes (product,
analytical, communication, synthesis, research; 2 core) · 4 recency likerts.

---

## 5. Validation layer

Sixteen items that score **nothing directly** — they exist to test the rest.

- **6 reverse-keyed pairs** (`validation_pair` → the direct value item;
  `reverse_scored: true`). After normalization un-reverses them, agreement
  means the pair lands close; `|a − b| ≥ 2` (0–5 scale) is a contradiction.
  ≥2 contradictions fire the v1 `inconsistent_stories` flag. An
  **integrity** contradiction is ethics-class (→ misaligned, §7).
- **3 social-desirability catches** — e.g. claiming "I have never overstated
  anything" under a 5/5 integrity self-rating is itself the signal.
- **3 evidence-consistency probes** — "your highest-rated skill: the single
  best proof a reference could confirm."
- **2 confidence checks** — never score a dimension; recorded for the
  reviewer ("how many of your self-ratings would survive a reference
  check?").
- **2 pressure tradeoffs** — deadline-vs-disclosure, borrow-against-next-
  quarter; concealment options fire `weak_ethics`.

**Evidence quality** is auto-rated 0–2 (`rateEvidenceText`: length gate,
then specificity — numbers/dates/quantities); **3 ("strong / verified") is
reviewer-only**, set per question in the admin panel (§8). Overall evidence
quality feeds the confidence multiplier: `0.4 + 0.6·quality` — a
self-report-only profile cannot exceed 40% of its coverage-implied
confidence.

---

## 6. Scoring architecture

Everything below is pure code in `fitDecision.ts` with the thresholds in one
exported const (`FIT_V2_THRESHOLDS`) so the calibration panel can render
them.

```
normalizeV2Answer   raw string → typed answer + namespaced dimension loads
                    (value:* | trait:* | skill:* | rubric:*); reverse-keyed
                    items are un-reversed HERE, once
computeLayers       fold answered bank → per-dimension weighted means,
                    coverage per module, flags, contradictions, evidence
cultureScore        100 × (1 − Σ w·max(0, baseline − value) / Σ w)
                    · shortfall-only: exceeding the baseline never penalizes
                    · integrity & stewardship double-weighted
                    · weights renormalize over scored values
roleScore           100 × (0.6·Σw·skill/5 + 0.4·Σw·rubric/5), each part
                    normalized over ANSWERED weights (v1 scoreRubric rule);
                    a missing part renormalizes to the other
classifyArchetypeV2 nearest centroid over answered axes (≥3), primary +
                    secondary + margin; confidence 0.6·coverage+0.4·separation
confidenceScore     coverage(0.4 values + 0.3 skills + 0.2 archetypes +
                    0.1 validation) × consistency(1 − 1.5·contradictions/pairs)
                    × evidence(0.4 + 0.6·quality), clamped 0..1
```

**The Axal baseline** (`AXAL_VALUES_BASELINE`): integrity 0.90 · stewardship
0.85 · collaboration 0.80 · curiosity 0.75 · resilience 0.75 · ambition 0.70.
The bar is deliberately asymmetric: the two trust values are both the highest
bars and double-weighted — Axal's stated non-negotiables.

**Anti-gaming properties**: option loads/scores/flags, validation pairs, and
signal notes are stripped from the subject-facing `/api/fit/config` payload;
tradeoffs/SJTs have no visible gradient; contradictions cost confidence;
charisma has no channel (no free-text sentiment ever scores).

**Missing data**: a dimension with zero answered items simply doesn't exist
for scoring (it becomes coverage/confidence loss and possibly an
`insufficient_evidence` outcome) — a thin profile is reported as thin, never
as bad.

---

## 7. The decision rubric — six outcomes

Ordered gates (`decideOutcome`; order is load-bearing):

| # | Gate | Outcome | Criteria (defaults) |
|---|---|---|---|
| 1 | Evidence | `insufficient_evidence` | confidence < 0.35 **or** < 3 scored values **or** skills coverage < 0.4 **or** a layer unscoreable |
| 2 | Ethics/alignment | `misaligned` | culture < 40 **or** `weak_ethics` fired **or** an integrity contradiction |
| 3 | Flag caps | (cap) | 1 non-ethics flag → best possible = conditional; ≥2 → best = low |
| 4 | High | `high_fit` | culture ≥ 75 ∧ role ≥ 75 ∧ confidence ≥ 0.6 ∧ 0 contradictions |
| 5 | Specialist | `specialist_fit` | role ≥ 75 ∧ culture ∈ [40, 60), **or** top-2 weighted skills ≥ 4.5 with breadth < 2.5 ∧ culture ≥ 60 |
| 6 | Conditional | `conditional_fit` | culture ≥ 60 ∧ role ≥ 55 (gaps enumerated), **or** a would-be high fit with confidence < 0.6 |
| 7 | Floor | `low_fit` | everything else |

Every decision ships with its **playbook** (`FIT_OUTCOME_PLAYBOOK`):
definition, recommended next action, recommended environment, and
what-to-validate-next — plus enumerated **gaps** (must-have skills < 3/5,
values > 0.25 below baseline, unresolved contradictions) and a
deterministic narrative. Skills can *never* rescue an ethics failure (gate
2 precedes everything scored), and low confidence can *never* be laundered
into a strong outcome (gate 1 + the confidence condition on gate 4).

Decisions are **append-only** (`fit_decisions`), stamped with
`bank_version`/`engine_version`, and snapshot their own inputs — old
decisions stay interpretable across bank revisions forever.

---

## 8. Role templates & the validation/review layer

### Role templates (`fitRoles.ts::FIT_ROLE_TEMPLATES`)

Six contexts: `founder`, `investor`, `operator` (id prefix `partner`),
`advisor`, and two **staged-only** contexts with no v1 counterpart —
`internal_hire`, `portfolio_talent` (their id prefixes don't match
`FIT_ID_RE`, so the entire v1 pipeline is blind to them by construction).
Each template sets: relative `skillWeights` over the ten skills ·
`mustHaveSkills` (gap-listed below 3/5; everything else is treated as
trainable) · `rubricWeights` over 4 role categories probed by the 8 role
add-on questions · narrative-only `archetypeAffinity`. Role context is
**decoupled from `users.role`** — anyone can assess against any context;
role fit and culture fit are always reported separately.

Highlights: founder must-haves = execution, product thinking, fundraising;
investor = diligence, analytical judgment, synthesis; operator = execution,
sales/relationships; advisor = communication, synthesis; internal hire =
execution, communication; portfolio talent = execution.

### Reviewer layer (`fit_reviews`, admin console → Fit v2 Review tab)

Per (decision, reviewer), upsertable: per-question **evidence ratings**
(0–3; 3 = verified, reviewer-only) · **outcome override** (any of the six,
**reason required**, recorded and surfaced to the subject as the effective
outcome — provenance shown, reason kept private) · **requires-follow-up**
marker · private notes · open/resolved status. Admin can also trigger a
recompute (`computed_by` = the admin) after new conversational answers land.
The subject-facing results endpoint reports `effective_outcome` +
`reviewed` + `requires_followup`, never the notes.

---

## 9. Product structure

### Delivery is dual-mode, one profile

Both surfaces write through the same `writeRouter.routeAnswer` pipeline into
the same stores (`advisor_answers` + `field_sources`), so answers are never
asked twice and the engine scores one raw store regardless of source.

1. **Staged flow** (`/fit`): intro + role picker → Context → Values →
   Operating style → Skills → Consistency & evidence → Review & submit.
   Save-per-stage, server-side resume (`fit_sessions`; the answers anchor to
   a hidden `advisor_conversations` row with `state='fit_v2'`, excluded from
   the dashboard progress ring). Submitting computes + persists the decision.
2. **Conversational** (Personal Advisor): a deliberately small `chat_core`
   slice (~17 items/persona — tradeoffs, forced choices, the ambition and
   scout/steward probes; nothing that duplicates a v1 probe) trails the
   persona bank at `importance:'low'`, exactly like the v1 fit questions.

### Routes & screens

| Surface | Route | Notes |
|---|---|---|
| Staged assessment | `/fit` | all signed-in roles incl. `exploring`; stepper + per-stage progress; review step with unanswered jump-list |
| Results | `/fit/results` | outcome banner + playbook, culture/role gauges, values-vs-baseline bars, archetype primary/secondary, 10 skills with validated badges, watch items, confidence meter with "what raises this" |
| Dashboard card | `ProfileFitSection` → `FitDecisionCard` | compact latest decision; empty state CTA |
| Admin review | `/admin/best-fit` → "Fit v2 Review" tab | queue (latest decision per user × role) + detail (answers with signal notes + evidence stars) + review form + recompute |
| API | `/api/fit/*`, `/api/admin/fit/*` | see `routes/fit.ts` / `routes/admin_fit.ts` headers |

Additive read: `GET /api/best-fit/me` gained `fit_v2.latest_decision`
(nullable); every pre-existing key is untouched.

---

## 10. Reviewer guide (humans reading results)

1. **Read confidence before scores.** Below 0.6, treat scores as a sketch;
   the results screen says what would raise it (coverage, consistency,
   evidence).
2. **Culture and role are different axes on purpose.** High role + low
   culture is a scoping conversation (specialist), not a hiring
   conversation.
3. **Contradictions are conversation openers, not verdicts** — the panel
   shows both paired answers; ask the `followup_prompts` on the flagged
   items. The one exception: integrity pairs, which the engine already
   treats as ethics-class.
4. **Evidence stars are your strongest lever.** Rating a 5/5 claim's proof
   at 0–1 is precisely the "confidence ≠ competence" catch; rating 3
   (verified) is a statement you checked a reference or artifact.
5. **Override freely, but write the reason.** The engine is calibrated to be
   consistent, not omniscient; the recorded reason is what makes the next
   calibration pass possible.
6. **Archetype guides placement, never selection.** Use it for team design
   and scope shape.

## 11. Admin calibration rules (MVP → Phase 2)

MVP ships read-only calibration: outcome distribution, per-question answer
counts, thresholds, and role templates (`GET /api/admin/fit/calibration`).
Calibration discipline: change thresholds only in code
(`FIT_V2_THRESHOLDS`), one at a time, with the reason in the commit;
override-vs-engine disagreement rate per outcome is the primary drift
signal to watch. Phase 2 adds per-item discrimination stats (answer σ,
flag/contradiction fire-rates already counted) and threshold editing with
an audit trail.

## 12. Sample profiles (how outcomes read)

- **The evidenced founder** — values at/above baseline, execution+product
  4.5 validated, consistent pairs, strong evidence → `high_fit`: "move to
  references + work sample."
- **The fluent self-reporter** — all self-ratings 5, no examples, two
  contradictions → skills capped at 3.5, confidence ~0.3 →
  `insufficient_evidence` with a precise list of what to substantiate.
- **The elite specialist** — diligence+synthesis 4.8 validated, culture 52
  (stewardship/collaboration shortfalls) → `specialist_fit`: scope-bound
  engagement, pressure-test collaboration before embedding.
- **The values-aligned developer** — culture 80, execution 2.4 with honest
  evidence → `conditional_fit` with named gaps and a development plan.
- **The concealer** — picks "hold it back one cycle" under a 5/5 integrity
  self-rating → `weak_ethics` + contradiction → `misaligned`, regardless of
  a perfect skills layer.

## 13. Versioning & v1-compat contract

- `FIT_BANK_VERSION` / `FIT_ENGINE_VERSION` (currently `v2.0`) stamp every
  session and decision; revising the bank bumps the version, never rewrites
  history (decisions snapshot their JSON).
- **v1 invariants held by construction and pinned by tests**: v1
  `AXAL_VALUES` stays five; v1 rubric scoring ignores v2 categories; the v1
  archetype classifier filters to its four traits; non-numeric v2 raw values
  are skipped by v1's numeric parser; the profiling-completion card counts
  only v1 fit items; `internal_hire`/`portfolio_talent` ids never match
  `FIT_ID_RE`; v2 items carry v1 `measures` ONLY for numeric trait
  enrichment and red-flag probes.
- Question kinds supported by engine+UI but unused in bank v2.0:
  `rank_order` (renderer, normalizer, and tests exist; author freely in
  v2.1).

## 14. MVP (this build) vs Phase 2

**Shipped now**: migration 151 · six-value/six-archetype/ten-skill model ·
full 105-item bank per role (× 6 roles) with core (~62) and chat (~17)
subsets · deterministic engine + six-outcome rubric + playbooks · staged
flow with save/resume · results screen · dashboard card · conversational
slice · reviewer panel (evidence ratings, overrides, follow-ups) ·
read-only calibration · additive best-fit field · 44 pinned tests.

**Phase 2**: compare-two-profiles view · downloadable PDF report
(`@react-pdf/renderer` already in the repo) · calibration analytics +
threshold editing · candidate-invite token flow for non-users (pattern:
partner onboarding tokens) · reference-check module (evidence rating 3 at
scale) · adaptive LLM follow-ups via the advisor's aiRouter · admin-
initiated assessments · per-answer conversational decision recompute
(currently: staged submit + admin recompute only, to keep the chat path
cheap).

## 15. Maintenance prompts

**Add a question**: add a `FitV2Row` to the right module factory in
`fitV2Shared.ts` (or a role bank's `roleRubricRows`), keep the module counts
in `fitBankV2.test.ts` in sync, run `npm run test:drift`.
**Add a value/trait/skill**: extend the literal in `fitRoles.ts` (+ spec
copy), add items, update `AXAL_VALUES_BASELINE`/centroids/templates, update
the pinning tests — then bump `FIT_BANK_VERSION`.
**Change a threshold**: edit `FIT_V2_THRESHOLDS`, update
`fitDecision.test.ts`'s gate matrix, state the reason in the commit.
**Regenerate this doc**: read the source-of-truth table's files and make
every table above match the code verbatim.
