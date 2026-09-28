# Profiling v2

The source of truth for Sessions 7–15. If a later handoff disagrees with this file, this file wins.

Measured on main `8e2120b4e3` (2026-09-28). This session writes the spec, the persona fixture, and the decisions. It does not change scoring, banks, or schema.

## What this programme is

Eadwyn, on `/studio`, already asks a conversational fit bank and draws skills, work values, an archetype, and Axal Fit. The owner asked for three things this programme has to make true:

1. The question banks for archetype, skills, and values grow, skills also from tools the person actually uses, and the archetype card shows the sixteen profiles below.
2. Skills, values, and archetype move as the person keeps using the platform.
3. A profile is recomputed from timestamped inputs. It is never edited by hand.

The sixteen profiles, four per role:

| Role | Archetypes |
| --- | --- |
| Founder | Missionary, Rocketeer, Architect, Maverick |
| Investor | Thesis-Driven Backer, Network Amplifier, Hands-On Partner, Disciplined Allocator |
| Partner | Strategic Connector, Embedded Operator, Growth Catalyst, Systems Builder |
| Advisor | Sage Guide, Hands-On Coach, Accountability Anchor, Craft Master |

Slugs, centroids, and card copy already exist. This programme does not rename them.

## What already exists, and what the handoff had wrong

Two archetype systems are live:

- Conversational: `classifyArchetype` in `archetypeScoring.ts`. Nearest centroid over builder, visionary, connector, operator, each 0–5. Missing traits are skipped. Absence is not zero. Distance is the Euclidean distance divided by the square root of how many traits were answered, so three answers are not punished against four. Ties break by the order of the archetype list.
- The older gamified assessment (`assessment_archetypes`). `ArchetypeCardPage.jsx` at `/studio/archetype` reads `api.bestFit.me()` first and falls back to `assessment.myResults()`.

`classifyArchetypeV2` also already exists. It classifies the same four traits over six centroids: the role's four, plus Scout and Steward. `fitV2Decision.ts` is what reads it. That function is the Fit overlay. It is not this programme's engine. Session 7 must not replace it and must not reuse its name. Session 7 builds a new function beside `classifyArchetype`.

`profile_archetypes` (migration 130) already appends archetype rows: persona, slug, label, traits, confidence, distance, narrative, `computed_at`. Nothing in the product reads that history. Skills, work values, and Axal values do not append. Each keeps one row per user and key (`user_skills`, `user_values`, `axal_values`).

`advisor_answers` is the ledger: one row per answer, with a conversation and a status. `field_sources` keeps only the latest answer per user and question. `classifyArchetype`'s loader reads `field_sources`, so an older answer is invisible to today's score even though the ledger still has it.

A skill answer of 0 writes no `user_skills` row (`writeRouter.ts`: a positive rating only). A missing row is not a recorded zero. A recorded zero lives in the ledger. Session 7 and Session 13 score from the ledger.

Work-value answers are stored as `n * 0.8 - 2` (0 becomes −2, 5 becomes +2) and blended with any survey row at confidence 0.25. Session 14 does not read that blended row. It compares the decay-weighted mean of ledger answers on the 0–5 scale, which is the scale the questions use.

Axal answers are stored as `n / 5` on a 0–1 score. The fixture keeps Axal targets on the 0–5 answer scale.

### Banks, measured

`fit.<persona>.<key>`, section `FIT`, importance low, skippable, 0–5 scale except the illustration question. Module floors in `profilingModules.ts`: skills 5, work values 4, archetype 6, Axal Fit 8. About 23 answers make every module confident. Adaptive selection then stops asking that module.

| Bank | Total | Skills | Work values | Archetype | Axal Fit |
| --- | --- | --- | --- | --- | --- |
| founder | 58 | 7 | 5 | 29 | 17 |
| investor | 54 | 5 | 5 | 29 | 15 |
| partner | 53 | 5 | 4 | 29 | 15 |
| advisor | 55 | 5 | 4 | 29 | 17 |
| coach | 18 | 0 | 0 | 0 | 18 |

Coach is 12 rubric questions plus the 6 Axal values, including ambition. `BANK_SIZE_TARGETS.fitCoach` still says 17 and its comment still says five Axal values. That comment is stale. This session does not edit it. Sessions 9–12 must not treat 17 as the coach bank's size.

Radar axes with no question in that bank today:

| Bank | Axes the bank does not ask |
| --- | --- |
| founder | legal_compliance |
| investor | engineering, design, marketing_brand |
| partner | engineering, design, marketing_brand |
| advisor | engineering, design, legal_compliance |
| coach | all eight |

An unasked axis stays "Not recorded" until Session 8 has evidence for it, or a later bank adds a question. It is not drawn as 0.

## Sessions

| Session | Builds | Starts after |
| --- | --- | --- |
| 7 | The profiling engine (pick-one, reverse keys, engine version) and the profile snapshot store | this spec |
| 8 | Skill evidence from platform tools | this spec |
| 9 | Founder question bank | 7 |
| 10 | Investor question bank | 7 |
| 11 | Partner question bank | 7 |
| 12 | Advisor question bank. Coach stays on the advisor set | 7 |
| 13 | Recompute, ageing, re-ask, change events, admin aggregates | 7 and 8 |
| 14 | Archetype card copy for all 16, then values compatibility | copy any time after this spec; values after 9–12 |
| 15 | Archetype card page, two-layer skills radar, evolution timeline | last |

An earlier draft numbered these S7–S16. Use only the numbers in the table. An "S8 scoring engine" in an old note is Session 7.

## Item formats

Session 7 builds these. Sessions 9–12 author items in this shape. Ids stay `fit.<persona>.<key>`. An id is permanent: an answer is stored against it.

### Pick-one situational item

```
input_kind: 'pick_one'
prompt: string
options: 2 to 5 of {
  key: string          // stable, unique inside the item
  label: string        // what Eadwyn shows
  traits: { builder, visionary, connector, operator }   // each 0..5
  skill_axis?: { slug, loading }     // loading 0..5, one axis
  value_dim?: { slug, loading }      // loading 0..5, one dimension
  axal_value?: { slug, loading }     // loading 0..5, one Axal value
}
```

A loading is a number on the same 0–5 scale as a scale answer, in steps of 0.25 (0, 0.25, …, 5). The step is a quarter point because the scale is five points wide and a finer step would be a second scale. An omitted loading is absence. It is not zero. A pick about the mission must not pull engineering to zero.

Two to five options because one option is not a choice and six is a form. Reverse is not allowed on a pick-one. Direction lives in the option loadings. Session 7 rejects a pick-one that also sets `reverse`.

### Reverse-keyed scale item

A scale item may set `reverse: true`. The ledger stores the raw answer, an integer 0–5. The score uses `5 - answer`. The midpoint 2.5 would stay 2.5; integer answers have no midpoint, and 0 swaps with 5. Only scale items can be reverse.

### Retired

`retired: true` means Eadwyn never asks the question again, including the re-ask. Old ledger rows still score. Stopping the score of a retired question is an engine bump that names the id in that version's ignore list. Session 7 ships that list empty. A silent drop would change a profile with no new fact and no version change.

### Re-ask

Optional `reask_prompt` on any item. When the answer is old enough (below), Eadwyn asks that string if it is set. Otherwise Eadwyn asks the template, then the original prompt on the next line:

> It's been a while — is this still true?

The template is one sentence so the voice stays the same. The per-item string replaces the whole message, for a prompt that would not make sense after that sentence. A new answer replaces the latest for scoring. The old row stays in the ledger.

### How several observations combine

For one trait, skill axis, value dimension, or Axal value, the score is the decay-weighted mean of every observation that loads it:

`sum(value × weight) / sum(weight)`

A scale answer contributes `answer`, or `5 - answer` when reversed, with that answer's decay weight. A chosen option contributes each loading it actually carries, with the same decay weight. An omitted loading contributes nothing. If the weight sum is 0, the score is absent.

### engine_version

A positive integer stored on every snapshot.

| Version | Meaning |
| --- | --- |
| 1 | Today's `classifyArchetype`. Rows written before Session 7 have no version; readers treat a missing version as 1. |
| 2 | The first version Session 7 ships, once pick-one and reverse scoring are live. |

Bump the version when the scoring function, the centroids, the loading scale, the decay, the blend weights, or the hysteresis constants change. Adding, retiring, or rewording a question does not bump it: the function of a given set of inputs did not change. A bump is the `engine_bump` trigger below.

## Evolution

A profile is a deterministic function of the ledger, the platform-evidence rows Session 8 writes, and `engine_version`. Same inputs, same profile.

### Decay

Weight of an answer aged `age_days` is `0.5 ** (age_days / 365)`.

The half-life is 365 days so a year-old self-rating still counts half, and a rating from two years ago counts a quarter. A person who answered once and kept the same practice is not erased. A person who changed is not stuck with a two-year-old rating at full strength.

### Re-ask

An answer whose age is at least 183 days may be asked again. 183 is half of 365, rounded to an integer a cron can compare. Six calendar months are 181–184 days depending on the months; 183 does not change in February.

Until the person answers, the old answer keeps its decayed weight. The re-ask does not zero it. A retired item is not re-asked.

### Evidence window

Session 8's events carry `occurred_at`. An event younger than 365 days has weight 1. An older event has weight `0.5 ** ((age_days - 365) / 365)`, the same half-life measured from the edge of the year. The lifetime count is stored for the card to show and is not an input to the blend. Skills should describe current practice. A total from 2019 would freeze the radar.

### Skill blend

Per radar axis:

- `self` is the decay-weighted mean of ledger answers on that axis, on the 0–5 scale. Absent when the ledger has none.
- `evidence` is the decay-weighted mean of Session 8's events on that axis, mapped by Session 8 onto 0–5. Absent when there are no events.
- `w_self` is the decay weight of the latest self answer. A fresh answer has weight 1.
- `w_evidence` is `min(1, n / 5)`, where `n` is how many events fall inside the 365-day full-weight window.

Five events earn a full vote because five is the skills confidence floor: the same count that makes a self-rating module confident. One event cannot outvote a fresh self-rating.

`blended = (w_self × self + w_evidence × evidence) / (w_self + w_evidence)` when both weights are above 0. A side with no observations has weight 0 and is left out of the fraction. Both weights 0 means the axis is absent.

What the card shows:

| Self | Evidence | Draw |
| --- | --- | --- |
| present | present | both numbers and the blend |
| present | absent | the self number, labelled "Self-rated only" |
| absent | present | the evidence number, labelled "From platform activity" |
| absent | absent | "Not recorded", and the axis is omitted from the radar |

A missing side is not drawn as 0.

### Material change

A recompute writes a snapshot when any of these is true. Otherwise it writes nothing.

- The displayed archetype slug changes.
- The pending candidate slug changes (see hysteresis).
- Any blended skill changes by 0.5 or more on the 0–5 scale.
- Any work-value mean changes by 0.5 or more on the 0–5 answer scale.
- Any Axal stored score changes by 0.1 or more on the 0–1 scale.
- `engine_version` changes.

0.5 is one step of the answer scale, so noise under a step does not write history. 0.1 is that same step after the existing `/5` store (`0.5 / 5`).

The snapshot is append-only and holds: primary slug, secondary slug, confidence, trait vector, each skill axis (self, evidence, blended — each nullable), work values, Axal values, `engine_version`, and the trigger. Session 7 builds the table. It is a side table keyed by `user_id`. `users` is at the 100-column cap. Session 7 asks for the migration number. This session does not pick one.

### Hysteresis

The displayed archetype changes only when a new leader's `margin` is at least 0.35 and that leader is still the leader at every recompute for 14 days.

`margin` is the field `classifyArchetype` already returns: runner-up distance minus winner distance, in the normalized units (sum of squares divided by the number of traits, then square root). The closest pair, sitting on its own centroid, has margin 0.87 (Embedded Operator against Systems Builder). 0.35 is below that, so a person on a centroid is not flickering, and it is above the exact midpoint of every closest pair, which classifies with margin 0. A tie does not flip the card.

14 days is long enough that one evening of answers cannot flip the card, and short enough that a real change shows up inside a month. During the hold, the snapshot records the candidate as pending and the displayed slug stays.

### Triggers

| Trigger | When |
| --- | --- |
| `answer` | After each saved fit answer. Session 13 hooks the existing answer route. |
| `scheduled` | The nightly cron `0 3 * * *` already in `wrangler.toml`. Session 13 adds the job to that cron. It does not add a cron. |
| `engine_bump` | A batched backfill when `engine_version` changes. |

### Visibility

The person sees their own history. Another person sees only the current published archetype, under the consent rule the card already uses. An admin sees aggregates only, behind the admin gate. No route in this programme returns another person's answers, evidence, or history.

## Values matching

Session 14 builds the comparison. One slug per meaning. Do not invent a second slug for a spectrum that already has one.

The six Axal values are the cross-role match. Every role bank asks all six under the same keys: integrity, stewardship, curiosity, resilience, collaboration, ambition.

Founder spectrums are compared only where the other role already asks that slug:

| Other role | Founder spectrums shared with the founder bank |
| --- | --- |
| Investor | `founder_risk_appetite`, `founder_growth_vs_sustain` |
| Partner | `founder_autonomy_vs_structure` |
| Advisor | none |

Schwartz dimensions are not compared to founders. Founders are not asked them, and Session 9 does not add them. The founder spectrums already name the founder values. A new Schwartz item on the founder bank would be a second name for a meaning those spectrums already cover.

Schwartz comparison is among the roles that ask the slug:

| Slug | Roles |
| --- | --- |
| `schwartz_achievement` | investor, advisor |
| `schwartz_benevolence` | investor, partner, advisor |
| `schwartz_universalism` | investor, partner, advisor |
| `schwartz_self_direction` | partner, advisor |

## Close pairs

Raw Euclidean distance over the four centroids, measured against `archetypeScoring.ts`. The centroids do not move. Each one classifies to itself under `classifyArchetype`, with margin 0.87 to 1.87, and the card copy is bound to these slugs. Moving one would reclassify stored answers without an engine bump.

| Pair | Distance | Separating items |
| --- | --- | --- |
| Partner Embedded Operator – Systems Builder | 1.73 | 5 |
| Investor Thesis-Driven Backer – Disciplined Allocator | 2.45 | 3 |
| Partner Strategic Connector – Growth Catalyst | 2.45 | 3 |
| Advisor Hands-On Coach – Accountability Anchor | 2.45 | 3 |
| Founder Missionary – Rocketeer | 2.65 | 3 |
| Investor Network Amplifier – Hands-On Partner | 3.00 | 3 |
| Founder Rocketeer – Maverick | 3.16 | 3 |

Five items for the pair under distance 2. That gap is under 2 on every single trait, so three items cannot move the mean across the 0.35 hysteresis margin when the other answers sit near both centroids. Three items for every farther pair: three answers that differ by 2 points on the separating trait move the mean by more than 0.35.

Sessions 9–12 must include at least that many items whose loadings differ between the two centroids of each pair for that role. The machine-readable copy is `CLOSE_PAIRS` in the persona fixture.

## Personas

`cloudflare-worker/test/fixtures/profiling_v2_personas.ts` exports `PROFILING_V2_PERSONAS`: 16 archetypes and 4 blends.

Each row has `id`, `role`, `kind` (`archetype` or `blend`), a synthetic `name` and `@example.test` email, `expected_slug`, `secondary_slug` (blends only), `traits`, `skills` (all 8 axes, 0–5), `values` (that role's keys only, 0–5, 5 = pole_high), and `axal` (the six values, 0–5).

An archetype's trait vector is that archetype's centroid. A blend is 0.75 of the primary centroid and 0.25 of the secondary, rounded to two decimals. The blend's expected slug is the primary. Its runner-up under `classifyArchetype` is the secondary. The exact midpoint is a tie (margin 0) and is not used.

| Blend | Primary | Secondary |
| --- | --- | --- |
| `founder.blend` | Missionary | Rocketeer |
| `investor.blend` | Thesis-Driven Backer | Disciplined Allocator |
| `partner.blend` | Embedded Operator | Systems Builder |
| `advisor.blend` | Hands-On Coach | Accountability Anchor |

### From a target to answers

Session 7 tests the engine on the trait vectors directly. Sessions 9–12 test that answering their bank by this rule reproduces `expected_slug`.

For each item in that session's bank:

- Scale item tagged `archetype_trait` T: answer `round(traits[T])`. If `reverse`, answer `5 - round(traits[T])`.
- Pick-one: choose the option whose trait vector is closest to `traits` by Euclidean distance. A tie takes the first option.
- Skill item: answer `skills[skill_axis]`, rounded to an integer 0–5. A 0 is a real ledger answer. Today's write router still stores no `user_skills` row for 0.
- Value item: answer `values[value_dim]` when that key is on the persona. If the bank asks a slug the persona does not carry, the test fails: the bank grew a dimension the fixture does not know.
- Axal item: answer `axal[axal_value]`.
- Several items on the same trait or axis: each is answered with that same target. The target is the mean the engine should recover.
- An item with no tag the persona carries is skipped.

## Skill evidence, skeleton only

Session 8 names the tables and events. This list only names the tool that can count, because that route exists today.

| Axis | Tool |
| --- | --- |
| product | `/build` and `/build/discovery` |
| engineering | no tool records this today. The axis stays self-rated only. Do not borrow design or product events. |
| design | `/build/brand` (the brand builder). Not `/spinout-lab/brand`, which is the Lab tool. |
| gtm_sales | `/grow/customers` |
| marketing_brand | `/grow/brand` |
| capital_network | `/raise/capital` and `/network` |
| finance_ops | `/build/metrics` and `/build/financials` |
| legal_compliance | `/raise/legal-engine` |

## Coach

Coach keeps sharing the advisor archetype set, as `ARCHETYPES.coach` already does. Coach has no archetype questions (measured: 0), no studio role, and is asked inside the advisor conversation. A second centroid set would classify the same person twice. Session 12 does not build a coach archetype bank.

## Owner decisions

Adopted 2026-09-28. The owner sent this session as the work to carry out, and the brief's recommendations are the decisions below, so Sessions 7–15 are not waiting on an open question. A later note from the owner replaces a row. Until then, these are the values.

| # | Question | Options | Decision | Why |
| --- | --- | --- | --- | --- |
| 1 | Loading scale for a pick-one | 0–5 in 0.25 steps, or a separate −1..+1 scale | 0–5 in steps of 0.25 | Same space as a scale answer, so they average. An omitted loading is absence. |
| 2 | How picks and scales combine | sum, max, or decay-weighted mean | decay-weighted mean | One fresh answer and one old answer must not count the same. |
| 3 | Reverse formula | `5 - x`, or a sign flip around 2.5 stored differently | `5 - x` on the stored 0–5 answer | Swaps the poles. The raw answer stays in the ledger. |
| 4 | Retired answers | drop them, or keep scoring them | keep scoring them | Dropping them changes a profile with no new fact. An ignore list requires an engine bump. |
| 5 | Re-ask copy | one template, or per-item only | template, with optional `reask_prompt` | One sentence of voice, and an escape when the original prompt would not fit. |
| 6 | engine_version form | integer, or a date string | positive integer; missing means 1; Session 7 ships 2 | Dates collide when two changes land the same day. |
| 7 | When the version bumps | any bank edit, or only a change to the function | only a change to the function, centroids, scales, decay, blend weights, or hysteresis | A new question does not change the score of the answers already given. |
| 8 | Decay half-life | 6 months, 12 months, 24 months | 365 days | A year-old rating still counts half. |
| 9 | Re-ask threshold | 90 days, 183 days, 365 days | 183 days | Half the half-life, as an integer. |
| 10 | Evidence window | lifetime, or 365 days full and then the same half-life | 365 days at weight 1, then the half-life | Skills should describe current practice. Lifetime is display only. |
| 11 | Evidence vote | equal to self, or capped by event count | `min(1, n / 5)` inside the year | Five is the skills confidence floor. One event cannot outvote a fresh self-rating. |
| 12 | Material skill or value change | any float change, or 0.5 on the 0–5 scale | 0.5 on 0–5; 0.1 on stored Axal 0–1 | One step of the answer scale. |
| 13 | Hysteresis | none, or margin 0.35 for 14 days | margin at least 0.35, held 14 days | The closest on-centroid margin is 0.87. A midpoint tie is margin 0 and must not flip the card. |
| 14 | Cron | a new cron, or the existing `0 3 * * *` | the existing cron | It already runs nightly. Session 13 adds a job. |
| 15 | Who sees history | everyone, or the person plus admin aggregates | the person sees their own; others see the published archetype only; admins see aggregates | Matches the consent rule and the admin gate. |
| 16 | Centroids | keep, or move the 1.73 pair apart | keep | They already separate, and the card copy is bound to the slugs. |
| 17 | Separating items | 3 for every pair, or 5 for the pair under distance 2 | 5 under distance 2, otherwise 3 | The 1.73 pair is under 2 on every trait. |
| 18 | Cross-role values | all dimensions, or shared slugs only | six Axal values for every role; founder spectrums only where the other bank already asks that slug; Schwartz not against founders | One slug per meaning. Session 9 does not add Schwartz to founders. |
| 19 | Coach archetypes | a coach set, or the advisor set | the advisor set | Coach has no archetype items and is asked inside the advisor conversation. |
| 20 | Blend shape | the midpoint, or 0.75 toward the primary | 0.75 toward the primary | The midpoint classifies with margin 0. |

## What Session 7 must not break

- `classifyArchetype` stays. The persona test runs it on these targets.
- `classifyArchetypeV2` stays the Fit overlay (Scout, Steward). The new engine gets a new name.
- A 0 skill answer still must not create a phantom `user_skills` row. The ledger is where the zero lives.
- No `|| 0` and no `?? 0` on a skill, a value, or a trait. Absence is "Not recorded", "Self-rated only", or "From platform activity".
