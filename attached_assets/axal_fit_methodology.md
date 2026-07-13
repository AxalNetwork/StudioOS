# Axal Fit — Methodology

> **Fit v2 exists.** The three-layer decision methodology (Values /
> Archetypes / Skills → six-outcome rubric, staged `/fit` flow, reviewer
> overrides) is documented in `design/AXAL_VC_FIT_V2_METHODOLOGY.md` and
> implemented in `services/fitDecision.ts` + `services/fitRoles.ts`. It is
> an ADDITIVE layer: everything in THIS document keeps running unchanged.

> **Status: canonical & code-verified.** Every weight, threshold, band, value,
> skill axis, spectrum, and red flag in this document is reproduced verbatim
> from the as-built engine. This is the human-readable companion to the scoring
> code — it explains *why* Axal Fit works the way it does, but the code is the
> source of truth. If this doc and the code ever disagree, the code wins and
> this doc is wrong; fix the doc (see [Maintenance](#13-maintenance--copy-paste-replit-prompts)).
>
> **Documentation only — no application code is touched by this file.**

## Source of truth

Every number below was cross-checked against these files. Read them, not the
quoted numbers in any planning document, when maintaining Axal Fit:

| Concern | File |
|---|---|
| Rubrics, weights, bands, Axal values, red flags, scoring math | `cloudflare-worker/src/services/axalFit.ts` |
| Question schema, `FitMeasures`, `bankFor`, `fitMeasuresIndex`, id regex | `cloudflare-worker/src/services/advisor/questionBank.ts` |
| Shared fit-bank builder + the 5 Axal value questions | `cloudflare-worker/src/services/advisor/banks/fitShared.ts` |
| Per-persona fit question banks | `cloudflare-worker/src/services/advisor/banks/fit_{founder,investor,partner,mentor,coach}.ts` |
| 8 skill radar axes + founder value spectrums (schema) | `cloudflare-worker/src/services/skillsTaxonomySchema.ts` |
| Founder value spectrum seed (pole labels) | `cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql` |

---

## 1. Overview & philosophy

Axal Fit answers one question for every person in the network: **how well does
this person fit a given role** — founder, investor, partner, mentor, or coach —
**and where are the gaps and the warning signs?**

It is built on three principles:

1. **Behavioral over biographical.** Fit is scored from how a person *behaves*
   (ownership, coachability, follow-through, stewardship) rather than from a CV.
   Each signal is a self-rating on a 0–5 scale against a concrete behavior.
2. **Calibrated, not absolute.** A partially-answered profile still produces a
   meaningful, comparable score, because the rubric is normalized over the
   categories actually answered. A thin profile scores honestly *and* reports
   low coverage, rather than being unfairly dragged toward zero.
3. **Deterministic and explainable.** Given the same answers, the engine always
   produces the same score, band, narrative, and red flags. No LLM is in the
   scoring path. Every number can be traced back to a weighted rubric category.

### The hybrid model

Axal Fit is deliberately a **hybrid of structured self-rating and human
review**, not an automated verdict:

- **Structured self-rated scorecard (the engine).** The Personal Advisor asks
  behavioral questions conversationally; answers (0–5) flow into a weighted
  rubric that yields a 0–100 score, a band, a coverage figure, a signal-quality
  figure, a deterministic narrative, and any fired red flags.
- **Human consultation review (the judgment).** The score is a *starting point
  for a conversation*, not the decision. The admin Best-Fit console surfaces the
  full scorecard for an Axal partner to review, and members can "Book with
  Guillaume" to talk it through. Self-ratings are signal; the human applies
  judgment, weighs the red flags, and decides.

The engine's job is to make the human review faster, fairer, and more
consistent — never to replace it.

---

## 2. Conversational delivery

Fit questions are not a separate quiz. They ride **inside the Personal Advisor
conversation**, one question per turn, in a human tone.

### Delivery rules (from `fitShared.ts::buildFitBank`)

Every fit question is built with these fixed properties:

- `input_kind: 'scale'`, `validate: 'scale'` — a single 0–5 rating per turn.
- `section: 'FIT'`.
- `importance: 'low'` — fit questions intentionally **trail** the persona's
  onboarding questions, so they never crowd out higher-priority profiling.
- `skip_allowed: true` — any question can be skipped (it then counts as
  unanswered and is excluded from the rubric denominator).
- `page_target: '/dashboard'`, `doc_anchor: 'getting-started/personas'`.
- Default hint (`SCALE_HINT`): *"No wrong answers — rate 0 (not at all) to 5
  (completely)."* A few questions override the hint to anchor the poles of a
  spectrum (e.g. *"0 = quality-first, 5 = speed-first."*).

The "no wrong answers" framing is deliberate: honest self-rating is more useful
than performed perfection, and the red-flag probes only fire at the very bottom
of the scale (see §11).

### The `fit.<persona>.<key>` ID scheme

Every fit question's id follows the pattern **`fit.<FitPersona>.<key>`**, e.g.
`fit.founder.coach_feedback` or `fit.coach.listen_deep`.

The persona that a question scores against is parsed from this **id prefix**,
not from the advisor `Question.persona` field. The regex (in `questionBank.ts`)
is:

```
FIT_ID_RE = /^fit\.(founder|investor|partner|mentor|coach)\./
```

This indirection exists for one reason: **coach has no advisor role of its
own.** Coach fit questions are delivered inside the *mentor* conversation
(`Question.persona = 'mentor'`) but keep the `fit.coach.*` prefix, so they are
scored against the coach rubric without inventing a new advisor persona.

`fitMeasuresIndex()` walks every registered bank, keeps only questions whose id
matches `FIT_ID_RE`, and returns `{ question_id, persona, measures }` for each —
this flat index is what the scoring engine and the write-router consume.

### `FitPersona` vs. advisor `Persona`

`FitPersona = 'founder' | 'investor' | 'partner' | 'mentor' | 'coach'`. It adds
`coach` and drops `admin`/`unknown` relative to the advisor `Persona` enum.

### Which banks each persona sees (`bankFor`)

| Advisor persona | Fit banks appended to the conversation |
|---|---|
| `founder` | `fitFounder` |
| `investor` | `fitInvestor` |
| `partner` | `fitPartner` |
| `mentor` | `fitMentor` **and** `fitCoach` |

(The founder also gets either the new-founder spin-out bank or the
existing-founder bank ahead of `fitFounder`, depending on whether the Spin-Out
Lab is active — but that ordering is onboarding, not fit.)

### The `measures` tag

Each fit question carries a `measures` map that tells the engine and the
write-router what the 0–5 answer feeds. All keys are optional; a question can
feed several at once.

| `measures` key | Routes to | Consumed by |
|---|---|---|
| `rubric_category` | a category in `RUBRICS[persona]` | `axalFit.ts` (the fit score) |
| `axal_value` | one of the 5 Axal values → `axal_values` | write-router → `axalFit.ts` |
| `skill_axis` | a radar-axis slug → `user_skills` | write-router (skills radar) |
| `value_dim` | a value-dimension slug → `user_values` | write-router (values lean) |
| `red_flag` | `{ key, at_or_below }` | `axalFit.ts::detectRedFlags` |

---

## 3. The scoring engine

All scoring lives in the **pure core** of `axalFit.ts` (no auth, no DB), wrapped
by a thin DB-aware orchestrator that loads answers and persists the result.

### 3.1 Per-category aggregation

A rubric category can be probed by more than one question. The per-category
0–5 score is the **mean of the answered questions** tagged with that
`rubric_category`. Unanswered (or skipped) questions are simply absent.

### 3.2 Rubric score (`scoreRubric`)

Weights in each rubric are **relative**, normalized by the sum of the weights of
the *answered* categories:

```
total_score = Σ( weight × score/5 ) over ANSWERED categories
              ─────────────────────────────────────────────  × 100
                       Σ( weight ) over ANSWERED categories
```

- Unanswered categories are **excluded from the denominator** — they do not drag
  the score down — but they are reported with `answered: false`.
- Because weights are relative, a rubric's weights do **not** need to sum to
  100. (The founder rubric sums to 110; the others sum to 100. This is correct
  and intentional — see §7.)

```
coverage = Σ( answered weights ) / Σ( all rubric weights )    (0..1)
```

### 3.3 Signal quality (`signalQuality`)

How much to trust the score, blending breadth of answers with the confidence of
the Axal-value signals:

```
signal_quality = clamp01( 0.6 × coverage + 0.4 × mean_value_confidence )
```

`mean_value_confidence` is `AVG(confidence)` across the user's stored Axal
values (0 when none recorded).

### 3.4 Bands (`bandFromScore`)

| Band key | Threshold (0–100) | Label (`BAND_LABEL`) |
|---|---|---|
| `strong_yes` | `score >= 85` | Strong yes |
| `yes_caution` | `score >= 70` | Yes, with caution |
| `hold` | `score >= 55` | Hold — more diligence |
| `no` | `score < 55` | No |

### 3.5 Red-flag detection (`detectRedFlags`)

A red flag fires when an **answered** probe's 0–5 score is **at or below** that
probe's `at_or_below` threshold. Every red-flag probe in every bank uses
`at_or_below: 1`, so a flag fires only on a self-rating of **0 or 1**. Flags are
returned in the canonical `RED_FLAGS` order, de-duplicated.

### 3.6 Narrative (`narrativeFit`)

A deterministic, one-paragraph summary (no LLM). If nothing is answered it
returns a "not enough signal yet" nudge back to the advisor. Otherwise it states
the band, score, and coverage; names the **top-2** answered categories as
strengths; names the **bottom-2** as watch-items (only when `total_score < 85`);
and appends any red flags.

### 3.7 Result shape & rounding (`computeFit` → `FitResult`)

`total_score` is rounded to **one decimal place**. `signal_quality`,
`coverage`, and `mean_confidence` are 0..1 values rounded to **0.01**.
`computeFit` appends a history row to `axal_fit_scores` only when called with
`{ persist: true }`; `recomputeUserFit` is the normal after-answer path that
does so. `loadLatestFit` / `loadAllLatestFit` read the most recent row per
persona.

---

## 4. Personas & rubrics — orientation

There are **five** fit personas but **four distinct rubrics**: mentor and coach
**share one rubric** (`MENTOR_COACH_RUBRIC`). The sections below reproduce each
rubric's categories and weights verbatim, pair every category with its "look
for" and its conversational prompt(s), and note which red flags each persona can
trigger.

---

## 5. Founder rubric

Weights sum to **110** (relative — normalized at score time).

| Category | Weight | What we look for |
|---|---:|---|
| `vision_clarity` | 15 | A crisp, one-sentence future and a credible "why now". |
| `execution_ability` | 20 | Turning plans into shipped progress; ruthless prioritization. |
| `domain_insight` | 15 | Earned, non-obvious insight and closeness to the customer. |
| `coachability` | 15 | Updating on strong arguments; actively seeking help. |
| `resilience` | 15 | Holding the team steady through setbacks; sustainable pace. |
| `communication` | 10 | Making complex ideas land; persuading talent to say yes. |
| `team_dynamics` | 10 | Attracting people better than you; handling hard conflict. |
| `values_fit` | 10 | Mission drive and an ethical line that holds under pressure. |

**Conversational prompts** (`fit_founder.ts`, ids `fit.founder.<key>`):

- **vision_clarity**
  - *vision_north_star* — "How clearly can you state, in one sentence, the future your company is trying to create?"
  - *vision_why_now* — "How well can you explain why now is the right moment for this — not five years ago, not five years from now?"
- **execution_ability**
  - *exec_ship_rate* — "Over the last month, how consistently did you turn plans into shipped, visible progress?" *(also skill `product`; red flag `poor_follow_through`)*
  - *exec_prioritization* — "How disciplined are you at cutting good ideas to protect the one that matters most this week?"
- **domain_insight**
  - *domain_edge* — "How much non-obvious, earned insight do you have about this specific market?"
  - *domain_customer_proximity* — "How close are you to the people who feel this problem most acutely?" *(also skill `gtm_sales`)*
- **coachability**
  - *coach_feedback* — "When someone challenges your plan with a strong argument, how readily do you change course?" *(red flag `overconfidence`)*
  - *coach_seek_help* — "How proactively do you seek out mentors and advisors for the things you are weakest at?"
- **resilience**
  - *resilience_setbacks* — "How well do you keep the team steady and moving when a launch or a raise falls through?"
  - *resilience_stamina* — "How sustainable is your pace — could you hold this intensity for years, not just months?"
- **communication**
  - *comm_clarity* — "How clearly do you get a complex idea across to someone hearing it for the first time?" *(also skill `marketing_brand`)*
  - *comm_persuasion* — "How effectively do you get talented people to say yes — to join, to invest, or to partner?" *(also skill `capital_network`)*
- **team_dynamics**
  - *team_attract* — "How strong is your track record of attracting people who are better than you at their craft?"
  - *team_conflict* — "How well do you handle hard disagreements with a co-founder or a key early hire?"
- **values_fit**
  - *values_mission* — "How much is this driven by a mission you would pursue even if the financial upside were smaller?" *(also spectrum `founder_mission_vs_profit`)*
  - *values_ethics* — "Under real pressure to hit a number, how firmly do you hold an ethical line?" *(red flag `weak_ethics`)*

**Founder value-lean spectrum questions** (feed the values lean, not the rubric):
*lean_speed* (`founder_speed_vs_quality`), *lean_risk* (`founder_risk_appetite`),
*lean_growth* (`founder_growth_vs_sustain`), *lean_autonomy*
(`founder_autonomy_vs_structure`). See §10.

**Red flags reachable:** `poor_follow_through`, `overconfidence`, `weak_ethics`,
plus the three from the shared Axal-value probes (§9/§11).

---

## 6. Investor rubric

Weights sum to **100**.

| Category | Weight | What we look for |
|---|---:|---|
| `thesis_fit` | 20 | A sharp, repeatable thesis and conviction to lead. |
| `capital_quality` | 15 | Dependable dry powder and reliable follow-on. |
| `governance_style` | 15 | Real boardroom value; letting founders run the company. |
| `reputation` | 20 | Strong references even from founders who struggled; good conduct under stress. |
| `decision_quality` | 15 | Rigorous diligence and consistent reasoning. |
| `values_fit` | 15 | Optimizing for company health and patient building. |

**Conversational prompts** (`fit_investor.ts`, ids `fit.investor.<key>`):

- **thesis_fit** — *thesis_focus* "How sharply defined is the thesis you invest against — the kind of company you back over and over?"; *thesis_conviction* "How willing are you to lead a round on conviction before the rest of the market agrees?"
- **capital_quality** — *capital_dry_powder* "How dependable is your capital — do you have the reserves to actually deploy when you commit?" *(skill `capital_network`)*; *capital_followon* "How reliably do you support winners with follow-on capital in later rounds?" *(skill `finance_ops`)*
- **governance_style** — *gov_board_value* "How much real value do you add in the board room beyond the cheque?"; *gov_founder_respect* "How well do you let founders run their company rather than steering from the back seat?" *(red flag `ego_over_collaboration`)*
- **reputation** — *rep_references* "If a founder called three people you backed who struggled, how strong would your reference be?"; *rep_conduct* "How consistently do you behave well when a deal goes sideways and incentives get tense?" *(red flag `weak_ethics`)*
- **decision_quality** — *decision_diligence* "How rigorous is your diligence — do you do the work to understand what you are backing?"; *decision_consistency* "How consistent are the reasons you give for a decision before and after the outcome is known?" *(red flag `inconsistent_stories`)*
- **values_fit** — *values_alignment* "How much do you optimise for the long-term health of the company over your own near-term return?"; *values_patience* "How patient are you with durable, sustainable building versus pushing for aggressive growth?" *(spectrum `founder_growth_vs_sustain`)*

**Value-lean spectrum question:** *lean_risk* — "How comfortable are you backing
earlier, riskier bets versus waiting for more proof?" (`founder_risk_appetite`).

**Red flags reachable:** `ego_over_collaboration`, `weak_ethics`,
`inconsistent_stories`, plus the three shared Axal-value probes.

---

## 7. Partner rubric (operating partner)

Weights sum to **100**.

| Category | Weight | What we look for |
|---|---:|---|
| `strategic_alignment` | 20 | Overlap with what the studio builds; tailored, not one-size, support. |
| `trustworthiness` | 20 | Deliverables that land on time; careful confidentiality. |
| `network_quality` | 15 | Deep, relevant network that is actually activated. |
| `execution_support` | 15 | Hands-on work alongside founders with realistic bandwidth. |
| `collaboration_style` | 15 | Collaborating without needing to be the most important person in the room. |
| `reputation` | 15 | A track record of companies glad they worked with you; long-term, not transactional. |

**Conversational prompts** (`fit_partner.ts`, ids `fit.partner.<key>`):

- **strategic_alignment** — *strat_thesis* "How closely does your own focus overlap with the kinds of companies the studio builds?"; *strat_portfolio_fit* "How well do you tailor your support to where a company actually is, rather than a one-size playbook?"
- **trustworthiness** — *trust_reliability* "When you commit to a deliverable for a portfolio company, how reliably does it land on time?" *(red flag `poor_follow_through`)*; *trust_confidentiality* "How carefully do you protect sensitive information shared with you across companies?" *(red flag `weak_ethics`)*
- **network_quality** — *network_depth* "How deep and relevant is the network you can open up for the companies you support?" *(skill `capital_network`)*; *network_activation* "How readily do you actually make warm introductions rather than just promising them?"
- **execution_support** — *exec_hands_on* "How willing are you to roll up your sleeves and do the work alongside a founder, not just advise?" *(skill `gtm_sales`)*; *exec_bandwidth* "How realistic is the bandwidth you can give each company you take on?"
- **collaboration_style** — *collab_style* "How well do you collaborate without needing to be the most important person in the room?" *(red flag `ego_over_collaboration`)*; *collab_founder_led* "How comfortable are you letting the founder lead while you support from beside them?" *(spectrum `founder_autonomy_vs_structure`)*
- **reputation** — *rep_track_record* "How strong is your track record of companies that are glad they worked with you?"; *rep_conduct* "How consistently do you treat relationships as long-term rather than purely transactional?" *(red flag `transactional`)*

**Red flags reachable:** `poor_follow_through`, `weak_ethics`,
`ego_over_collaboration`, `transactional`, plus the three shared Axal-value probes.

---

## 8. Mentor & Coach rubric (shared)

Mentor and coach are scored against the **same** rubric (`MENTOR_COACH_RUBRIC`,
weights sum to **100**) but have **separate question banks**. Coach questions
are delivered inside the mentor conversation (see §2).

| Category | Weight | What we look for |
|---|---:|---|
| `domain_expertise` | 25 | Deep, current expertise (mentor) / a repeatable, broad method (coach). |
| `teaching_ability` | 20 | Making hard concepts click; reusable frameworks and accountability. |
| `listening` | 15 | Asking before telling; hearing what isn't said. |
| `founder_empathy` | 15 | Understanding the emotional reality and pressure of building. |
| `reliability` | 15 | Showing up prepared, with a dependable cadence and healthy boundaries. |
| `values_alignment` | 10 | Serving the founder's goals; surfacing conflicts; staying ethical. |

**Mentor prompts** (`fit_mentor.ts`, ids `fit.mentor.<key>`):

- **domain_expertise** — *domain_depth* "How deep is your earned expertise in the areas founders come to you for?"; *domain_recency* "How current is that expertise — are you close to how the work is done today, not a decade ago?" *(skill `product`)*
- **teaching_ability** — *teach_clarity* "How well do you make a hard concept click for someone who is new to it?"; *teach_frameworks* "How effectively do you give founders reusable frameworks rather than one-off answers?"
- **listening** — *listen_questions* "How often do you ask questions to understand before offering your view?"; *listen_patience* "How well do you resist jumping straight to your own answer before a founder finishes?" *(red flag `overconfidence`)*
- **founder_empathy** — *empathy_walked* "How well do you understand the emotional reality of building, not just the tactics?"; *empathy_pressure* "How attuned are you to when a founder needs support versus a push?"
- **reliability** — *reliable_showup* "How reliably do you show up for the sessions and commitments you make to founders?" *(red flag `poor_follow_through`)*; *reliable_prep* "How well do you come prepared rather than winging each conversation?"
- **values_alignment** — *values_align* "How much do you mentor to genuinely help the founder rather than to advance your own interests?"; *values_conflicts* "How openly do you flag conflicts of interest instead of letting them sit unsaid?" *(red flag `transactional`)*

**Coach prompts** (`fit_coach.ts`, ids `fit.coach.<key>`):

- **domain_expertise** — *domain_method* "How well-developed is your coaching method — a repeatable way you help people grow?"; *domain_breadth* "How broad is the range of founder situations you can coach across with confidence?"
- **teaching_ability** — *teach_actionable* "How consistently do founders leave a session with something concrete they can act on?"; *teach_accountability* "How effectively do you hold founders accountable to what they said they would do?"
- **listening** — *listen_deep* "How well do you hear what a founder is not saying, not just their words?"; *listen_nonjudgmental* "How safe do founders feel being honest with you about what is really going wrong?"
- **founder_empathy** — *empathy_founder* "How deeply do you understand the isolation and pressure of being a founder?"; *empathy_holding* "How well do you hold space for a founder in a genuinely hard moment?"
- **reliability** — *reliable_consistency* "How consistent and dependable is the cadence you keep with the people you coach?" *(red flag `poor_follow_through`)*; *reliable_boundaries* "How well do you keep clear, healthy boundaries while still being available?"
- **values_alignment** — *values_align* "How much do you coach toward the founder’s own goals rather than the outcome you would pick?"; *values_ethics* "How firmly do you keep the coaching relationship ethical and free of hidden agendas?" *(red flag `weak_ethics`)*

**Red flags reachable (mentor):** `overconfidence`, `poor_follow_through`,
`transactional`, plus shared Axal-value probes.
**Red flags reachable (coach):** `poor_follow_through`, `weak_ethics`, plus
shared Axal-value probes.

---

## 9. The 5 Axal behavioral values

Asked of **every** persona via `axalValueRows()` (ids `fit.<persona>.axal_*`).
These feed `axal_values` (score + confidence) and the `mean_confidence` term of
signal quality. Three of the five carry a red-flag probe.

| Key | Label | What it means | Probe wording | Red flag (fires at ≤ 1) |
|---|---|---|---|---|
| `integrity` | Integrity | Does what they said they would; owns mistakes instead of shifting blame. | "When something goes wrong on your watch, how fully do you own it instead of pointing to circumstances or other people?" | `blame_shifting` |
| `stewardship` | Stewardship | Treats capital, people, and reputation as a trust to protect, not extract. | "How much do you treat other people's money, time, and trust as something to protect rather than something to spend?" | `transactional` |
| `curiosity` | Curiosity | Seeks out what they do not know; updates beliefs on new evidence. | "How actively do you go looking for evidence that you might be wrong?" | — |
| `resilience` | Resilience | Recovers from setbacks and keeps execution moving under pressure. | "After a genuine setback, how quickly do you recover and get execution moving again?" | — |
| `collaboration` | Collaboration | Builds with others; shares credit; puts the mission ahead of ego. | "How readily do you share credit and put the mission ahead of being the one who is right?" | `ego_over_collaboration` |

> Note: the Axal value `resilience` (a behavioral self-rating stored in
> `axal_values`) is distinct from the founder rubric category `resilience`
> (scored from the founder bank's resilience questions). Same word, two
> different signals.

---

## 10. Skills radar & values lean

Fit questions also enrich two existing profile surfaces by tagging answers with
`skill_axis` (→ skills radar) and `value_dim` (→ values lean).

### 10.1 The 8-axis skills radar (`RADAR_AXES`)

Canonical, stable join slugs — never rename one.

| Slug | Label |
|---|---|
| `product` | Product |
| `engineering` | Engineering |
| `design` | Design |
| `gtm_sales` | GTM / Sales |
| `marketing_brand` | Marketing / Brand |
| `finance_ops` | Finance / Ops |
| `legal_compliance` | Legal / Compliance |
| `capital_network` | Capital / Network |

Skill axes touched by fit questions: `product`, `gtm_sales`, `marketing_brand`,
`capital_network`, `finance_ops`. The remaining axes (`engineering`, `design`,
`legal_compliance`) are populated from the broader assessment, not the fit banks.

### 10.2 Founder value-lean spectrums (`value_dimensions`, family = `founder`)

The values lean is a 15-dimension model (10 Schwartz + 5 founder). Fit questions
touch only the **5 founder bipolar spectrums** below. Each is authored so a
self-rating of **5 = `pole_high`** and **0 = `pole_low`**.

| Slug | Label | `pole_low` (0) | `pole_high` (5) |
|---|---|---|---|
| `founder_mission_vs_profit` | Mission vs. Profit | Profit-First | Mission-First |
| `founder_speed_vs_quality` | Speed vs. Quality | Quality-First | Speed-First |
| `founder_risk_appetite` | Risk Appetite | Risk-Averse | Risk-Seeking |
| `founder_growth_vs_sustain` | Growth vs. Sustainability | Sustainable | Hyper-Growth |
| `founder_autonomy_vs_structure` | Autonomy vs. Structure | Process & Structure | Autonomy & Flex |

These are **descriptive**, not scored as "good" or "bad" — they describe a
founder's working style for matching, not for ranking.

---

## 11. The red-flag set

Seven red flags (`RED_FLAGS`), each surfaced when an **answered** probe scores
**at or below 1** (every probe uses `at_or_below: 1`). Flags appear on the
scorecard and in the narrative; they are inputs to the human review, not an
automatic disqualification.

| Key | Label | What it signals | Probed by |
|---|---|---|---|
| `overconfidence` | Overconfidence | Certainty out of proportion to evidence; low coachability. | founder `coach_feedback`; mentor `listen_patience` |
| `blame_shifting` | Blame-shifting | Attributes failures to others or circumstance; weak ownership. | Axal `integrity` (all personas) |
| `inconsistent_stories` | Inconsistent stories | Narrative shifts across the conversation; signals unreliability. | investor `decision_consistency` |
| `poor_follow_through` | Poor follow-through | Starts more than they finish; commitments do not land. | founder `exec_ship_rate`; partner `trust_reliability`; mentor `reliable_showup`; coach `reliable_consistency` |
| `ego_over_collaboration` | Ego over collaboration | Prioritizes personal credit over the team or mission. | investor `gov_founder_respect`; partner `collab_style`; Axal `collaboration` (all) |
| `transactional` | Transactional | Relationships framed purely as exchange; low stewardship. | Axal `stewardship` (all); partner `rep_conduct`; mentor `values_conflicts` |
| `weak_ethics` | Weak ethics | Comfortable cutting ethical corners under pressure. | founder `values_ethics`; investor `rep_conduct`; partner `trust_confidentiality`; coach `values_ethics` |

---

## 12. Data flow & persistence

1. The advisor serves a fit question; the user rates 0–5.
2. The advisor route records the raw 0–5 score into
   `field_sources.evidence_text` (read back by `loadAnsweredScores`). The
   write-router fans the same answer out per `measures`: `axal_value` →
   `axal_values` (score = raw/5), `skill_axis` → `user_skills` (self_level =
   raw), `value_dim` → `user_values` (raw 0..5 mapped to −2..+2, confidence-blended).
3. After each answer batch, `recomputeUserFit` runs `computeFit` for every
   persona the user has answered fit questions for and appends a row to
   `axal_fit_scores` (best-effort — it never throws into the answer response).
4. `loadLatestFit` / `loadAllLatestFit` return the most recent row per persona
   for the dashboard self-view and the admin report; `loadAxalValues` returns
   the 5 Axal values (always all five, zero-filled when unrecorded).

---

## 13. Maintenance — copy-paste Replit prompts

Paste any of these into the Replit Agent to re-run or extend the methodology.
**Every one of them must end by re-running the cross-check (§14).** This doc is
pure documentation; changing scores means changing code in `axalFit.ts` and/or
the fit banks, then regenerating this doc to match.

**A. Regenerate this document from the current engine.**
> Read `cloudflare-worker/src/services/axalFit.ts`, `questionBank.ts`, the five
> `banks/fit_*.ts` files, `fitShared.ts`, `skillsTaxonomySchema.ts`, and the
> founder value-dimension seed in `sql/migrations/090_seed_skills_values_taxonomy.sql`.
> Rewrite `attached_assets/axal_fit_methodology.md` so every rubric category,
> weight, band threshold, Axal value, skill axis, value spectrum, and red flag
> matches the code verbatim. Do not change any application code.

**B. Add or re-weight a rubric category.**
> In `cloudflare-worker/src/services/axalFit.ts`, update the relevant `RUBRICS`
> entry (or `MENTOR_COACH_RUBRIC`). Weights are relative, so they need not sum
> to 100. Add at least one fit question in the matching `banks/fit_*.ts` whose
> `measures.rubric_category` equals the new category key, or the category will
> always read as unanswered. Then regenerate this doc (prompt A) and run the
> drift check.

**C. Add a new fit question.**
> In the correct `banks/fit_*.ts`, add a `{ key, prompt, measures }` row. Keep
> the id implied by `fit.<persona>.<key>`. Tag `measures` with the
> `rubric_category` it scores, plus any `skill_axis` / `value_dim` / `red_flag`
> it should also feed. Then regenerate this doc and run the drift check.

**D. Add or change a red flag.**
> Add the key to `RED_FLAGS` in `axalFit.ts` and a matching `RED_FLAG_SPECS`
> entry (label + description). Attach `red_flag: { key, at_or_below: 1 }` to the
> probe question(s) in the relevant bank(s). Regenerate this doc and run the
> drift check.

**E. Change a band threshold or the signal-quality blend.**
> Edit `bandFromScore` (thresholds) or `signalQuality` (the 0.6/0.4 blend) in
> `axalFit.ts`. These are load-bearing for every existing score — confirm the
> intent before changing, update the unit tests, regenerate this doc, and run
> the drift check.

---

## 14. Cross-check checklist

Run this list against the code every time this doc is edited. If any line fails,
the doc is wrong, not the code.

- [ ] Bands: `strong_yes` ≥ 85, `yes_caution` ≥ 70, `hold` ≥ 55, else `no` — and the four labels — match `bandFromScore` / `BAND_LABEL`.
- [ ] Founder rubric weights (vision_clarity 15, execution_ability 20, domain_insight 15, coachability 15, resilience 15, communication 10, team_dynamics 10, values_fit 10) match `RUBRICS.founder`.
- [ ] Investor rubric weights (thesis_fit 20, capital_quality 15, governance_style 15, reputation 20, decision_quality 15, values_fit 15) match `RUBRICS.investor`.
- [ ] Partner rubric weights (strategic_alignment 20, trustworthiness 20, network_quality 15, execution_support 15, collaboration_style 15, reputation 15) match `RUBRICS.partner`.
- [ ] Mentor/coach rubric weights (domain_expertise 25, teaching_ability 20, listening 15, founder_empathy 15, reliability 15, values_alignment 10) match `MENTOR_COACH_RUBRIC`, and `RUBRICS.mentor === RUBRICS.coach`.
- [ ] Signal-quality blend is `0.6 × coverage + 0.4 × mean_confidence`, clamped 0..1.
- [ ] The 5 Axal value keys and their probe wording / red-flag mappings match `AXAL_VALUES`, `VALUE_SPECS`, and `axalValueRows()`.
- [ ] The 7 red-flag keys + labels match `RED_FLAGS` / `RED_FLAG_SPECS`, and every probe uses `at_or_below: 1`.
- [ ] The 8 radar axis slugs/labels match `RADAR_AXES`.
- [ ] The 5 founder spectrum slugs + pole labels match migration 090.
- [ ] The id scheme regex `FIT_ID_RE` and the `bankFor` persona→bank mapping match `questionBank.ts`.
- [ ] No application code was modified by the doc update.
