# Profiling v2 — spec

**Status:** source of truth for the Profiling v2 programme (Sessions 7–15).
Written by Session 6 on 2026-09-28 against main `8e2120b4e3`; decision
**D356** in `DECISIONS.md`. When a later session's handoff disagrees with this
file, this file wins, and the PR says so. Changing a rule here is a new D
entry, not a silent edit.

**Numbering.** The owner renumbered the programme to Sessions 6–15 on
2026-09-28; this file uses those numbers throughout. An earlier draft called
the same sessions S7–S16. A document or branch that says "S8" for the scoring
engine means Session 7: subtract one.

The owner's two requirements, verbatim:

1. "Develop further the question bank for archetype, skills (based on
   questions but also on tools used on the platform), values within the Axal
   VC ecosystem, and their resulting profiles archetype card page for:
   Founder: Missionary, Rocketeer, Architect, Maverick. Investor: Thesis-Driven
   Backer, Network Amplifier, Hands-On Partner, Disciplined Allocator.
   Partner: Strategic Connector, Embedded Operator, Growth Catalyst, Systems
   Builder. Advisor: Sage Guide, Hands-On Coach, Accountability Anchor, Craft
   Master."
2. "The results for skills, values, and archetype should evolve over time as
   the user uses the platform."

Nothing in this file changed the engine, a bank, a route, a migration or a
page. Session 6 shipped this document, the persona fixture
(`cloudflare-worker/test/fixtures/profiling-v2-personas.json`), a test that
holds the fixture to this file, and a baseline report script.

---

## 1. Owner decisions (2026-09-28)

| # | Question | Decision |
| --- | --- | --- |
| a | Which archetype system is canonical? | **Eadwyn's conversational profiling** (`services/archetypeScoring.ts`, what `/studio` reads) is canonical. The gamified assessment (`assessment_archetypes`, `assessment_results`) stays **read-only as a fallback** for a user with no conversational signal, and is retired in Session 15 when the card page stops reading it. |
| b | Can platform evidence raise a skill score? | **Corroborate first, blend later.** Evidence never moves the displayed skill level in v2; it changes the axis's *state* (§5.2) and its confidence. A blend that can move the level is Session 13's to propose and the owner's to switch on. |
| c | Who appears as a "match" on the card page? | **Archetype types always, plus real members only if they published their archetype.** Today the only publish flag is `assessment_results.published`; the conversational archetype has none, so Session 7 adds one (§8.3) and Session 15 reads it. |
| d | Evolution speed | **As proposed:** answer half-life 12 months, re-ask after 6 months, evidence at full weight for 12 months then fading, hysteresis 14 days with a lead margin. Exact values in §7.0. |
| e | Tell the user when their displayed archetype changes? | **Yes, in-app only** (`notifications_inbox`), once per change, after hysteresis. No email. |

---

## 2. Trait model

### 2.1 Four traits stay

The four behavioural traits stay: **builder, visionary, connector, operator**,
each 0–5 (`ARCHETYPE_TRAITS`). No fifth trait.

Why not add one. The sixteen archetypes the owner named are all describable
in these four. A fifth axis (the candidates were "rigour/analytical" for the
Allocator and "teaching" for the advisor set) would need a fifth centroid
coordinate for all sixteen, twenty more probes in every bank, and a new
radar. It would also invalidate every stored `traits_json` in
`profile_archetypes`, so history would start again from zero. The one pair
that a fifth axis would really separate, Embedded Operator and Systems
Builder, is left close and separated by situational items instead (§2.2, D357).

### 2.2 Centroids

The four archetypes per role, and their coordinates (builder, visionary,
connector, operator):

| Role | Archetype (slug) | Centroid |
| --- | --- | --- |
| Founder | Missionary (`fo_missionary`) | 2, 5, 5, 3 |
| Founder | Rocketeer (`fo_rocketeer`) | 4, 4, 4, 2 |
| Founder | Architect (`fo_architect`) | 5, 2, 2, 5 |
| Founder | Maverick (`fo_maverick`) | 5, 4, 1, 2 |
| Investor | Thesis-Driven Backer (`inv_thesis_backer`) | 2, 5, 2, 4 |
| Investor | Network Amplifier (`inv_network_amplifier`) | 2, 3, 5, 2 |
| Investor | Hands-On Partner (`inv_hands_on_partner`) | 4, 3, 4, 4 |
| Investor | Disciplined Allocator (`inv_disciplined_allocator`) | 1, 3, 2, 5 |
| Partner | Strategic Connector (`pt_strategic_connector`) | 2, 4, 5, 3 |
| Partner | Embedded Operator (`pt_embedded_operator`) | 5, 2, 3, 4 |
| Partner | Growth Catalyst (`pt_growth_catalyst`) | 4, 4, 4, 2 |
| Partner | Systems Builder (`pt_systems_builder`) | 4, 2, 2, 5 (the proposed move to 3, 2, 2, 5 was withdrawn by D357) |
| Advisor | Sage Guide (`mt_sage_guide`) | 2, 5, 4, 3 |
| Advisor | Hands-On Coach (`mt_hands_on_coach`) | 4, 2, 5, 3 |
| Advisor | Accountability Anchor (`mt_accountability_anchor`) | 3, 2, 4, 5 |
| Advisor | Craft Master (`mt_craft_master`) | 5, 3, 2, 4 |

**No centroid moves (D357).** This spec first proposed moving Systems
Builder's builder coordinate from 4 to 3. Embedded Operator and Systems
Builder are 1.73 apart (raw Euclidean), the only pair under 2, and in the
baseline (§9) their personas win by the two thinnest margins (0.34 and
0.27). Session 7 measured the move against the Session 6 personas before
shipping it: it widens Embedded Operator's margin (0.30 → 0.67) but
classifies the Systems Builder persona — builder 4.3, operator 4.6,
connector 2.3, a hands-on person who installs the machinery — as an
Embedded Operator. Nothing in the owner's description makes a Systems
Builder less hands-on, so the move was withdrawn. The pair stays close. The
engine reports a close result as a blend (secondary within
`secondary_margin`), and the partner bank (Session 11) separates it with
situational items, as §3.2 requires for every close pair.

The 2.45 pairs (Thesis-Driven/Allocator, Strategic
Connector/Growth Catalyst, Hands-On Coach/Accountability Anchor) and the
founder pairs (2.65, 3.16) are separated by the new question formats (§3)
rather than by moving the targets.

### 2.3 Scout and Steward are not displayed archetypes

`ARCHETYPES_V2` adds two cross-role archetypes, Scout (1, 5, 4, 1) and
Steward (4, 1, 3, 5), which the handoff did not mention.
`services/fitV2Decision.ts` reads them for its "archetype clarity"
component. They stay an internal signal of the fit decision. The card page
shows only the four per role that the owner named, and the persona fixture's
expectations are over those four.

### 2.4 Coach

Coach shares the advisor archetype set (`ARCHETYPES.coach =
ADVISOR_ARCHETYPES`). **Today a coach can never be classified:** the coach
bank (`fit_coach.ts`, 18 questions) asks no `archetype_trait` question, so
`computeArchetype(…, 'coach')` returns null. Session 12 adds
`archetypeModuleRows('coach')`, with coach-flavoured role probes, to that
bank. Until then the fixture carries no coach personas.

### 2.5 Classification rule (unchanged method)

Nearest centroid over the traits actually answered, with the distance
normalised by the number of traits compared
(`sqrt(Σ(score−centroid)² / n)`). A missing trait is skipped, never read as
0. Ties break by the archetype's order in the set. v2 adds:

- **Secondary archetype:** the runner-up, shown only when
  `runner_up_distance − winner_distance < secondary_margin` (§7.0).
- **Trait score** is the age-weighted mean of the latest answer to each of
  that trait's questions (§7.2), not the flat mean `field_sources` gives
  today.

---

## 3. Question formats

Every fit question keeps its id shape `fit.<persona>.<key>`, its 0–5 range
after scoring, `skip_allowed: true` and `importance: 'low'`. **An id is never
reused.** A question whose wording changes enough to change what it measures
gets a new key, and the old one is retired (see `retired` below).

### 3.1 Data shape

`FitRowSpec` (in `banks/fitShared.ts`) and `FitMeasures` (in
`questionBank.ts`) gain the following fields. Session 7 adds the types and Sessions 8–11
use them:

```ts
interface FitRowSpec {
  key: string;
  prompt: string;
  hint?: string;
  measures: FitMeasures;
  input_kind?: Question['input_kind'];   // 'scale' (default) | 'select' | 'choice' (new)
  options?: string[];                    // select only
  validate?: ValidateKind;
  importance?: Importance;
  // ---- v2 ----
  reverse?: boolean;                     // reverse-keyed scale: scored as 5 − value
  choices?: FitChoice[];                 // situational pick-one; required when input_kind = 'choice'
  reask_prompt?: string;                 // wording when re-asked after ageing (§7.3)
  retired?: { at: string; reason: string; replaced_by?: string };
}

interface FitChoice {
  key: string;                           // stable within the question: 'a' | 'b' | …
  label: string;                         // what the user reads
  loadings: Partial<Record<ArchetypeTrait, number>>; // 0..5 per trait this option speaks to
}

interface FitMeasures {
  // existing: skill_axis, value_dim, axal_value, archetype_trait,
  //           rubric_category, red_flag, archetype_presentation
  archetype_choice?: true;               // v2: the answer's option carries the trait loadings
}
```

### 3.2 The three archetype formats

| Format | `input_kind` | Stored answer | Contribution to traits |
| --- | --- | --- | --- |
| Scale | `scale` | `'0'`–`'5'` | One value on `measures.archetype_trait`. |
| Reverse-keyed scale | `scale` + `reverse: true` | `'0'`–`'5'` as the user chose it | `5 − value` on `measures.archetype_trait`. The ledger keeps what the user chose. The reversal happens only in scoring. |
| Situational pick-one | `choice` | the option's `key` | Each trait in the chosen option's `loadings` gets that value, as if that trait's question had been answered with it. A trait the option does not load is not touched. |

Rules for authors (Sessions 8–11):

- **Every bank carries at least 2 reverse-keyed probes per trait.** A bank
  of all-positive "how much do you…" items rewards whoever rates everything
  4. The baseline personas were written with a 20% pull towards 3.5 on
  every answer, and that pull is what shrinks the close pairs' margins.
- **Situational items target a close pair.** Each role gets at least one
  pick-one whose options separate its tightest pair (for example
  Thesis-Driven against Allocator: "A deal outside your thesis with a great
  founder…").
- A pick-one option loads at most two traits, each with a value in 0–5.
- `reask_prompt` is required on every archetype question. It reads as a
  check-in, not a retest ("Last spring you said you'd rather build it
  yourself — still true?").
- A retired question is never asked again, including on re-ask. Its old
  answers stay in the ledger. **They keep counting towards the trait until
  they age out** unless `retired.replaced_by` names a question the user has
  since answered.

### 3.3 Where the answer lives

`advisor_answers` is the ledger (one row per conversation and question), and
`field_sources` keeps the latest per `(user_id, question_id)`. v2 scoring
reads the **ledger**, not `field_sources`.

**When an answer was given (D357).** A re-answer within one conversation
upserts the same `advisor_answers` row, and `created_at` kept the time of the
first answer. Migration 363 adds `advisor_answers.answered_at`, which the
route sets on every insert and re-answer. The ledger dates an answer by
`COALESCE(answered_at, created_at)`.

**How the item types are delivered and stored (D357).**
- A pick-one is declared with `input_kind: 'choice'` and reaches the chat as
  a plain `select` over its labels, so the chat needs no new control. The
  route stores the option **key** (`normalizeFitAnswer` accepts the key or
  the exact label, case-insensitively, and refuses anything else).
- A reverse-keyed scale is stored as the person answered it and inverted
  only when the trait is scored.
- Reverse keys are allowed only on `archetype_trait` rows, and pick-ones
  feed archetype traits only. `assertFitRow` fails the build otherwise, so
  the write router's skill, value and Axal-value writes never receive a
  reversed or keyed answer. A bank that needs a reverse-keyed skill or value
  item needs a spec change first.
- `retired` removes a question from `bankFor` (delivery) but keeps it in
  `BANKS`, so its past answers are still found and scored.

---

## 4. Modules and floors

Keep the four modules and their floors (`profilingModules.ts`): skills 5,
work_values 4, archetype 6, axal_fit 8, which makes about 23 answers to
"confident". One addition:

- **The archetype module is confident only when every trait has at least one
  answer** (in addition to the floor of 6). Six answers on one trait tell
  nothing about the other three. Adaptive selection already prefers
  uncovered axes, so this changes the "confident" flag, not the order
  questions are asked in.

Banks grow in Sessions 8–11 (reverse-keyed and situational items), but the floors
do not. A larger bank is headroom for re-asking and adaptivity, not a longer
survey.

---

## 5. Skills

### 5.1 Two layers per radar axis

The radar keeps its 8 axes (`RADAR_AXES`, in its order): product, engineering, design,
gtm_sales, marketing_brand, finance_ops, legal_compliance, capital_network.
Each axis has two layers:

- **Self:** the self-rating 0–5 from the `skill_axis` questions (today
  `user_skills.self_level`). With several questions on one axis, the latest
  answer to each counts, weighted by age (§7.2).
- **Evidence:** platform activity tagged to the axis (§5.3), weighted over
  the evidence window (§7.4).

Axes each bank does not ask about today:

| Role | Axes with no self-rating question |
| --- | --- |
| Founder | legal_compliance |
| Investor | engineering, design, marketing_brand |
| Partner | engineering, design, marketing_brand |
| Advisor | engineering, design, legal_compliance |
| Coach | all eight (no `skill_axis` question) |

Sessions 8–11 decide whether to add a question for each gap. Evidence may fill a
gap anyway, and the axis then reads "Evidence only".

### 5.2 Axis state (decision b: corroborate)

| State | When | Level shown |
| --- | --- | --- |
| `not_recorded` | no self-rating, no evidence | none, drawn as "Not recorded", never as 0 |
| `self_rated_only` | self-rating, evidence weight 0 | self |
| `some_evidence` | self-rating, 0 < evidence weight < `corroborated_at` | self |
| `corroborated` | self-rating, evidence weight ≥ `corroborated_at` | self |
| `evidence_only` | no self-rating, evidence weight > 0 | none. The axis shows the evidence count, not a level. |

Evidence never changes the level in v2. It changes the state, and confidence
rises with it. Session 13 may propose a blend, for example
`self + clamp(evidence_level − self, −1, +1) × w`, behind a switch that is
off by default. The owner turns it on.

### 5.3 The evidence interface (D357)

The history store takes Session 8's numbers without recomputing them:

```ts
recomputeProfile(env, userId, {
  trigger,                                   // 'answer' | 'evidence' | 'scheduled' | 'engine_bump'
  evidence?: (persona) => EvidenceWeights,   // { [radar axis]: weight }
})
```

- An axis's weight is the number §5.2 compares with `corroborated_at`.
- **The default reads `skill_evidence`** (Session 8's store, migration 362):
  per axis, Σ `weighted` × the source's weight in `EVIDENCE_SOURCES`. This is
  the same weighted-action total `evidenceScore` saturates, taken before
  saturation, so three full-weight actions in the window corroborate. The
  store is refreshed by Session 8's nightly pass; the history store never
  runs the 21 source queries itself.
- With no store, no row, or an axis missing from the map, the axis reads
  from the self-rating alone (`self_rated_only`), or `not_recorded` when it
  has none. It is never 0 evidence-as-a-level.
- Snapshots keep §5.2's rule: the level shown is the self-rating. Session 8's
  `blend()` (`partly_corroborated`) is not applied.

### 5.4 Evidence rules (Session 8 details the tool map)

- An evidence event is a **completed, attributable action by the user**, not
  a page view: a session they hosted and the partner marked completed, a
  deliverable they submitted, an action item they ticked, a model they
  built. Each event names one axis, one source (a stable dotted name such as
  `office_hours.session_completed`) and when it happened.
- Evidence is about the user's own activity and never reads another user's
  content. A two-party event (an office-hours session) counts for the party
  whose skill it evidences, as Session 8 decides per source.
- A source counts once per underlying record. Re-saving the same model is
  one event, not ten.
- Lifetime totals are kept for display ("42 sessions hosted"), but only the
  window (§7.4) feeds the state.
- Session 8 published the map below (D318, migration 362). It is the same list as `EVIDENCE_SOURCES` in `skillEvidence.ts`. A test fails if a source key there is missing here. The axis keys stay final.
- **The displayed level follows §5.2.** Evidence changes the state, not the number. D318 first shipped a halfway blend. The follow-up in D318 removed it: `axisState` returns the §5.2 state with the self-rating as the level, and ageing follows §7.4. Session 13 is where a blend can be switched on.

| Role | Source key | What is counted | Axes | Weight |
| --- | --- | --- | --- | --- |
| Founder | `deck_version` | each deck version saved (`pitch_decks.created_by`) | marketing_brand, capital_network | 1 |
| Founder | `brand_site` | each brand site on a project the user founded | marketing_brand, design | 1 |
| Founder | `discovery_interview` | each interview on an own project | gtm_sales, product | 1 |
| Founder | `okr_shipped` | each roadmap objective with `kanban_status = 'done'` | product, engineering | 1 |
| Founder | `financial_model` | each model kept (`financial_models.updated_by`) | finance_ops | 1 |
| Founder | `cap_table_security` | each security the user recorded | legal_compliance, finance_ops | 1 |
| Founder | `esign_sent_completed` | each envelope the user sent that fully signed | legal_compliance | 1 |
| Founder | `esign_signed` | each document the user signed | legal_compliance | 0.5 |
| Founder | `lab_milestone` | each skill milestone below | per milestone | 0.5 |
| Investor | `dd_section_signed_off` | each due-diligence section the user signed off | per section below | 1 |
| Investor | `commitment` | each pending or confirmed commitment | capital_network, finance_ops | 1 |
| Investor | `deal_worked` | each distinct deal the user moved | capital_network | 0.5 |
| Partner | `office_hours_completed` | each completed session on the user's partner profile | specialization | 1 |
| Partner | `office_hours_rated_well` | each session rated 4 or higher | specialization | 0.5 |
| Partner | `office_hours_action_closed` | each action item closed on the user's bookings | specialization | 0.5 |
| Partner | `engagement_milestone` | each milestone on the user's engagements | specialization | 1 |
| Partner | `perk_redeemed` | each redeemed claim on the user's perks | specialization | 0.5 |
| Advisor | `advisor_engagement` | each started engagement on the user's advisor profile | specialization | 1 |
| Advisor | `expert_session_completed` | each completed session on the user's expert profile | specialization | 1 |
| Advisor | `expert_rated_well` | each session rated 4 or higher | specialization | 0.5 |
| Advisor | `guidance_answered` | each cohort question the user answered | specialization | 0.5 |

Partner and advisor sources use the axes the person's own profile names (`partners.specialization`, `advisors.expertise_json`, `experts.categories_json`), matched on whole words. If the profile names no axis, those actions are `unmapped` and are not guessed onto an axis.

Lab milestones that count: `pitch_deck_drafted` (marketing_brand, capital_network); `brand_basics_filled` and `landing_page_created` (marketing_brand, design); `icp_defined`, `discovery_followups_mapped` and `market_research_shared` (gtm_sales, product); `market_sizing_completed` (gtm_sales, finance_ops); `mvp_scoped` (product, engineering); `okrs_created` (product); `incorporation_completed`, `ein_received`, `founder_stock_issued`, `section83b_filed`, `cofounder_agreement_signed` (legal_compliance); `captable_locked` (legal_compliance, finance_ops); `use_of_funds_filled` and `revenue_summary_generated` (finance_ops); `revenue_proof_added` (finance_ops, gtm_sales); `fundraise_ask_locked`, `investor_intros_secured` and `data_room_built` (capital_network). Milestones that only record taking part are not evidence.

Due-diligence sections: `corporate_legal`, `compliance_aml`, `kyb_entity`, `kyc_individual` and `accreditation` are legal_compliance; `financial_health` is finance_ops; `product_tech` is engineering and product; `cyber_posture` is engineering; `market_position` is product; `market_traction` is product and gtm_sales; `founder_integrity` and `reputation_press` are capital_network.

`skill_evidence` (migration 362) stores one row per user, axis and source. `GET /api/skills/me/evidence` is the caller's own read. The nightly pass is `recomputeEvidenceBatch`, on the existing `0 3 * * *` cron when Session 13 wires it.

---

## 6. Values within the Axal ecosystem

Three families, all 0–5 self-ratings today, each stored in one current row
per user and dimension (no history before Session 7):

| Family | Dimensions | Asked of |
| --- | --- | --- |
| Axal values (`axal_values`, 0..1) | integrity, stewardship, curiosity, resilience, collaboration, ambition. v1 `axalFit.ts` scores the first five; v2 `fitV2Decision.ts` scores all six. | every role (`axalValueRows`) |
| Founder spectrums (`user_values`) | mission_vs_profit, speed_vs_quality, risk_appetite, growth_vs_sustain, autonomy_vs_structure | founder (all five); investor asks risk_appetite and growth_vs_sustain; partner asks autonomy_vs_structure |
| Schwartz (`user_values`) | achievement, benevolence, universalism, self_direction | investor: achievement, benevolence, universalism · partner: benevolence, self_direction, universalism · advisor: all four · **founder: none** |

**Compared across roles for matching (Session 14 implements):**

| Founder side | Other side | Why |
| --- | --- | --- |
| all six Axal values | all six Axal values, every role | the ecosystem's shared bar; a red flag on either side is surfaced, never averaged away |
| `founder_risk_appetite` | investor `lean_risk` (the same dimension) | a mismatch here is the commonest failed round |
| `founder_growth_vs_sustain` | investor `values_patience` (the same dimension) | holding period against growth plan |
| `founder_autonomy_vs_structure` | partner `collab_founder_led` (the same dimension) | how much a partner should steer |
| Schwartz: none today | investor, partner and advisor Schwartz dims | **Session 9 adds achievement, benevolence, universalism and self_direction to the founder bank**, so the comparison has two sides. Until then Session 14 compares Schwartz only among investor, partner and advisor. |

Values age like any answer (§7.2) and re-ask like any answer (§7.3).
Evidence does not move a value.

---

## 7. Evolution model

### 7.0 Parameters

These values are the owner's decision d. The persona fixture carries the
same values in `params`, and
`cloudflare-worker/test/profiling_v2_personas_fixture.test.ts` fails if the
two disagree.

| Parameter | Value | Meaning |
| --- | --- | --- |
| `half_life_days` | 365 | An answer's weight halves every 12 months. |
| `reask_after_days` | 182 | An answer this old makes its question re-askable. |
| `evidence_full_days` | 365 | Evidence counts in full for 12 months. |
| `evidence_fade_days` | 365 | After that, evidence fades linearly to 0 over the next 12 months. |
| `hysteresis_days` | 14 | A new archetype must be the computed winner on 14 consecutive days before it is displayed. |
| `lead_margin` | 0.25 | …and must lead the displayed archetype by at least this (normalised distance) on the day it takes over. |
| `secondary_margin` | 0.5 | The runner-up is shown as secondary when it is within this of the winner. |
| `corroborated_at` | 3.0 | Evidence weight at which a self-rated axis reads "corroborated". |

`lead_margin`, `secondary_margin` and `corroborated_at` are this spec's
choices; the owner fixed the four time parameters. Session 7 may recalibrate the
three choices against the baseline (§9) and must record a change as a new D
entry.

### 7.1 A profile is recomputed, never edited

A profile is a deterministic function of:

1. the user's timestamped answers (the `advisor_answers` ledger);
2. their timestamped evidence events (Session 8);
3. the engine version;
4. the evaluation date.

Same inputs give the same profile. Nothing writes a trait, a level or an
archetype directly. **The latest answer to a question at or before the
evaluation date wins.** Older answers stay in the ledger and stop counting
for that question.

### 7.2 Ageing

Each counted answer carries the weight `w = 0.5 ^ (age_days / half_life_days)`.
A trait (or skill axis, or value) is the weighted mean of its questions'
latest answers: `Σ w·v / Σ w`.

Consequence, by design: when every answer on a trait is the same age, ageing
changes nothing, because the weights cancel in the mean. Ageing only matters
when a trait mixes fresh and stale answers. The fresh ones then dominate,
which is the point. It never pulls a score towards 0, and an old answer is
never read as "no answer".

### 7.3 Re-asking

A question is **re-askable** when its latest answer is at least
`reask_after_days` old and the question is not retired. Adaptive selection
(Session 13) offers re-askable questions after uncovered ones, using
`reask_prompt`. A re-answer is a new ledger row. Skipping a re-ask leaves the
old answer counting at its aged weight. Re-askability is a queue signal and
never changes a score by itself.

### 7.4 Evidence window

An event's weight by age: 1 while `age ≤ evidence_full_days`; then
`1 − (age − evidence_full_days) / evidence_fade_days`; 0 from
`evidence_full_days + evidence_fade_days` on. An axis's evidence weight is
the sum over its events and drives the state in §5.2.

### 7.5 Computed and displayed archetype

The **computed** archetype on a day is the nearest centroid (§2.5) over that
day's traits. The **displayed** archetype is what the card, the network and
everything else show, and it follows the computed one under hysteresis. The
daily evaluation is at the nightly cron (§7.8):

1. The first classification ever is displayed immediately.
2. A computed archetype C that differs from the displayed D replaces it on
   the first day d on which (i) C has been the computed winner on each of the
   `hysteresis_days` consecutive days d−13 … d, and (ii)
   `distance(D) − distance(C) ≥ lead_margin` on day d.
3. Otherwise D stays, however many single answers point elsewhere.

Hysteresis makes the displayed archetype depend on the path. It is still
deterministic: it is defined as the result of replaying the daily
evaluations from the first answer. Session 7 may store it in snapshots so as not to
replay, but replay is the definition, and the persona checkpoints were
computed that way.

### 7.6 Snapshots: every material change, nothing else

Every **material** change appends one snapshot (§8.1). A change is
material when any of these differ from the previous snapshot:

- displayed archetype, computed archetype or secondary;
- any trait score by ≥ 0.25;
- any skill axis: self level, or state (§5.2);
- any value or Axal value by ≥ 0.25 (0–5 scale), or ≥ 0.05 on the 0..1
  scale;
- engine version.

A recompute that changes none of these writes nothing. Snapshots are
append-only and never updated or deleted, except under the user's own
account-deletion path.

### 7.7 Notification (decision e)

When the **displayed** archetype changes, one `notifications_inbox` row goes
to that user, in-app only: "Your archetype is now {label}", linking to
`/studio/archetype`. It is not sent for a computed-only change, a secondary
change, or the first classification.

### 7.8 Triggers

| Trigger (`snapshot.trigger`) | When |
| --- | --- |
| `answer` | after each saved `fit.*` answer, for that user |
| `evidence` | the nightly cron (`0 3 * * *`, already in both envs), for users with new evidence or crossing a window edge |
| `scheduled` | the same cron, for users whose hysteresis clock or re-ask state moved |
| `engine_bump` | once per user, batched, when `engine_version` changes (e.g. a changed centroid or scoring rule); hysteresis applies, so nobody's displayed archetype flips overnight |

### 7.9 Visibility

- **A user sees their own history**: snapshots, evidence and re-ask state,
  through `me` routes scoped by the caller's id.
- **Everyone else sees only the current published archetype** (decision c):
  the displayed slug and label, never the trait vector, the history, the
  skills or the values. Unpublished means invisible.
- **Admins see aggregates only** (behind `requireAdmin`): archetype
  distribution per role, change rate, and re-ask response rate. No
  individual timeline.

---

## 8. Data model sketch (migrations are Session 7's and Session 8's)

### 8.1 Profile snapshots

Extending `profile_archetypes` was considered. It is keyed per persona and
holds only the archetype, so a snapshot holding skills and values would need
a second table anyway. A new table, with `profile_archetypes` kept as the
v1 history:

```
profile_snapshots
  id                  INTEGER PRIMARY KEY AUTOINCREMENT
  user_id             INTEGER NOT NULL REFERENCES users(id)
  persona             TEXT NOT NULL            -- FitPersona
  engine_version      TEXT NOT NULL            -- e.g. 'profiling-v2.1'
  trigger_kind        TEXT NOT NULL            -- answer | evidence | scheduled | engine_bump (D357: `trigger` is an SQL keyword)
  displayed_slug      TEXT                     -- NULL until first classification
  computed_slug       TEXT
  secondary_slug      TEXT
  confidence          REAL
  margin              REAL
  traits_json         TEXT                     -- {builder, visionary, connector, operator}, absent keys absent
  skills_json         TEXT                     -- {axis: {self, evidence_weight, state}}
  values_json         TEXT                     -- {dimension: score}
  axal_values_json    TEXT                     -- {value: score}
  hysteresis_json     TEXT                     -- {candidate_slug, since} when a change is pending
  computed_at         TEXT NOT NULL DEFAULT (datetime('now'))
  INDEX (user_id, persona, computed_at)
```

### 8.2 Evidence

```
skill_evidence
  id            INTEGER PRIMARY KEY AUTOINCREMENT
  user_id       INTEGER NOT NULL REFERENCES users(id)
  axis          TEXT NOT NULL            -- RADAR_AXES key
  source        TEXT NOT NULL            -- e.g. 'office_hours.session_completed'
  source_ref    TEXT NOT NULL            -- the underlying record, e.g. 'partner_bookings:123'
  occurred_at   TEXT NOT NULL
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
  UNIQUE (user_id, source, source_ref, axis)   -- one event per record (§5.3)
```

### 8.3 Publishing the conversational archetype

Decision c needs a publish flag on the canonical archetype. Built by D357 as
a side table, `profile_archetype_publish (user_id PRIMARY KEY, published
0|1, updated_at)` (migration 363), rather than a column on `users` or
`user_settings`. No row means not published. The caller sets it through
`PUT /api/profile/archetype-published`. The legacy `assessment_results.published` stays readable for the
fallback (decision a) and is not copied across: publishing is a new consent.

---

## 9. Test personas and baseline

`cloudflare-worker/test/fixtures/profiling-v2-personas.json` holds 22
synthetic people (every name invented, every address `@example.test`):

- **16 archetype personas**, one per archetype. Each answers every scale and
  select question of its role's current bank (880 answers across the sixteen), with a
  20% pull towards 3.5 and item-level jitter, so the answers are not
  centroid copies. `expected.primary` is the archetype the persona was
  written to be.
- **2 blend personas**: Bo Blend (Rocketeer, secondary Maverick) and Bea
  Balance (Thesis-Driven Backer, secondary Disciplined Allocator).
- **4 evolution personas**, each with dated `checkpoints` computed with the
  reference model and §7.0's parameters:
  - `missionary_to_architect` (Eli Evolve): Missionary in January, a partial
    re-answer in April, and a full Architect re-answer on 1 July. The card
    still shows Missionary on 13 July and switches on 14 July.
  - `partner_radar_grows` (Pia Partner): self-ratings never change.
    Office-hour evidence takes finance_ops from `self_rated_only` through
    `some_evidence` to `corroborated` by 1 June 2026. Marketing & brand, an
    axis the partner bank never asks about, reads `evidence_only`. Finance
    fades back to `some_evidence` by December 2027.
  - `investor_flip_flop` (Oscar Oscillate): flips to Hands-On Partner for 7
    days in March and nothing is displayed. Flips again on 1 May and holds,
    and the displayed archetype changes on 14 May.
  - `advisor_ageing` (Aria Ageing): answers everything on 1 September 2025
    and never again. The archetype stays Sage Guide (uniform ageing cancels),
    all 55 questions become re-askable on 2 March 2026, and the gtm evidence
    goes `corroborated` → `some_evidence` → `self_rated_only` as it ages
    past 12 and then 24 months.

**Baseline** (`cloudflare-worker/scripts/profiling-v2-baseline.mjs`, today's
engine, run by Session 6 on main `8e2120b4e3`):

- Today's `computeArchetype` classifies **all 16 archetype personas and both
  blends correctly**, and the v1 runner-up matches the expected secondary on
  both blends.
- On the 29 evolution checkpoints it agrees with the spec's displayed
  archetype on **23**. **All 6 disagreements fall inside a hysteresis
  window**: today's engine has no hysteresis and shows the new archetype the
  day it wins (Eli on 2 and 13 July; Oscar on 6 and 11 March and on 2 and
  13 May).
- The thinnest static margins are Embedded Operator 0.34 and Systems
  Builder 0.27, the close pair §2.2 discusses.

What the baseline does **not** show: the personas were written from the
centroids, so agreement confirms the engine reads them correctly, not that
real users' answers look like this. Session 7 should add harder personas (a heavier
pull towards 3.5, missing traits) once reverse-keyed items exist to test
against.

---

## 10. Routes (sketch; Session 7, Session 8 and Session 13 build them)

| Route | Who | Returns |
| --- | --- | --- |
| `GET /api/profile/history?persona=` | the caller (own only) | snapshots, newest first: displayed, computed, secondary, traits, skills states, values, trigger, engine_version, computed_at |
| `GET /api/skills/me/evidence` | the caller (own only) | per axis: state, evidence weight, lifetime count, the last few events (source, occurred_at) |
| `GET /api/profile/reask` | the caller (own only) | re-askable question ids with `reask_prompt` (read-only peek, like `/advisor/queue`) |
| `PUT /api/profile/archetype-published` | the caller (own only) | `{ published: boolean }` (decision c) |
| `GET /api/admin/profiling/trends` | `requireAdmin` | aggregates only: distribution per role and month, change counts, re-ask response rate; small cells suppressed |

Every `/api/*` method added to `frontend/src/lib/api.js` ships in the same
commit as its mounted Worker route.

---

## 11. The programme

| Session | Builds | After |
| --- | --- | --- |
| Session 6 | This spec, owner decisions, evolution model, test personas | first |
| Session 7 | Archetype scoring engine v2 (ledger reads, ageing, secondary, hysteresis, `engine_version`) + `profile_snapshots` + publish flag + `/profile/history` (D357) | Session 6 |
| Session 8 | Skill evidence from platform tools: `skill_evidence`, the source→axis tool map, the nightly evidence pass, `/skills/me/evidence` | Session 6 |
| Session 9 | Founder question bank v2 (reverse-keyed, situational, `reask_prompt`, Schwartz dims) | Session 7 |
| Session 10 | Investor question bank v2 | Session 7 |
| Session 11 | Partner question bank v2 | Session 7 |
| Session 12 | Advisor / coach question bank v2, including the coach's first archetype probes | Session 7 |
| Session 13 | Evolution loop: recompute triggers, ageing, re-ask queue, change events and notification, admin trends | Session 7, Session 8 |
| Session 14 | Values compatibility across roles (§6) + archetype copy for all 16 + banner audit | copy after Session 6; values after Sessions 8–11 |
| Session 15 | Archetype card page v2: two-layer skills radar, evolution timeline, published-member matches; retires the assessment fallback | last |

Order: Session 6 → (Session 7 ∥ Session 8) → (Session 9 ∥ Session 10 ∥ Session 11 ∥ Session 12) → Session 13 → Session 14 → Session 15. Session 14's
copy half can start any time after Session 6.

---

## 12. What the next sessions must know

- **Two reads of "latest".** `field_sources` is the latest per question
  without ageing. v2 reads the `advisor_answers` ledger with `created_at`.
  Session 7 must not keep scoring from `field_sources`.
- **No history exists for skills or values today.** `user_skills`,
  `user_values` and `axal_values` keep one current row. The first snapshot
  per user is its baseline; nothing earlier can be reconstructed except from
  the ledger.
- **The fixture is the contract.** A session that changes a rule here
  updates the fixture's `params` or checkpoints in the same PR, and says why.
- **Absent is absent.** A missing trait, axis or value is drawn as "Not
  recorded" or "Self-rated only", never as 0, on every page this programme
  touches.
