# Profiling & Fit redesign (Task #45)

Redesign of the Axal VC Personal Advisor "Profile & Fit" profiling so it produces
trustworthy Skills / Work-values / Archetype / Axal-Fit / Best-fit results without
forcing users through a giant survey.

## 1. Audit of what existed

The system was already substantial — this was a **deepening**, not a greenfield build.

**Two parallel signal sources feed the Profile & Fit page:**

| Surface (frontend card) | Reads from | Populated by |
| --- | --- | --- |
| Skills radar (`api.radar.me`) | `user_skills` (8 radar axes) | advisor fit answers (`skill_axis`) + gamified track |
| Values (`api.values.getMe`) | `user_values` (15 dims) | advisor fit answers (`value_dim`) + gamified track |
| Archetype (`assessment.myResults`) | `assessment_results` | **gamified track only** |
| Profiling completion (`api.advisor.progress`) | fit-bank coverage | advisor conversation |
| Axal Fit & values (`api.bestFit.me`) | `axal_fit_scores` + `axal_values` | advisor fit answers (`rubric_category`, `axal_value`) |
| Best-fit matches (`api.matches.summary`) | matching service | all of the above |

**Where "0 / 17 answered" and "Archetype missing" came from:**

- The completion card (`/advisor/progress` → `profiling`) counted the raw fit-bank
  size as a flat denominator via `profilingSectionsForBank`. For a mentor the fit
  bank was 17 questions split **2 Skills / 1 Work-value / 14 Axal Fit** — so the card
  read `0 / 17` and split into shallow sub-counts.
- **Skills** had 1–4 tagged questions per role (mentor: 1, all on `product`) — nowhere
  near enough to fill an 8-axis radar.
- **Work values** had 0–5 tagged questions per role (mentor: 0).
- **Archetype was not a profiling module at all.** It depended entirely on the separate
  gamified assessment track, which most conversational users never run — hence
  "Archetype missing…".
- **Axal Fit** was the mature part: a weighted per-persona rubric + 5 Axal behavioral
  values + 7 red-flag probes + banded 0–100 score (`services/axalFit.ts`). Left intact.

Modules were **correctly separated** by `measures` tags (`skill_axis` / `value_dim` /
`rubric_category` / `axal_value`) — just under-populated, and missing archetype.

## 2. New architecture

Keep the proven `Question` + `FitMeasures` schema and the axalFit engine. Add:

1. **A four-module registry** — `services/advisor/profilingModules.ts`. Modules:
   `skills · work_values · archetype · axal_fit`. Each has a confidence **floor**
   (answers needed) and a **targetCoverage** (distinct axes/dims/traits/categories).
2. **A first-class Archetype module** — new `archetype_trait` measure + a nearest-centroid
   classifier (`services/archetypeScoring.ts`) that works from the SAME advisor answers,
   so an archetype appears from the conversation alone (no gamified track required).
3. **Confidence-based completion** replacing the raw count.
4. **An adaptive selector** that skips confident modules and fills coverage gaps.

Everything is layered additively; the fit banks stay out of the manifest/drift guard,
so new questions don't trip CI.

## 3. Data model / schema

- `FitMeasures.archetype_trait?: string` — loads one of the 4 trait axes
  (`builder · visionary · connector · operator`).
- `ProfilingSectionKey` gains `'archetype'`; priority is
  `archetype_trait → skill_axis → value_dim → axal_fit` so a question buckets once.
- New table `profile_archetypes` (migration `130_profile_archetypes.sql`, mirrored by
  `ensureArchetypeSchema` for self-heal) — append-only history, latest row per
  `(user_id, persona)`, storing `archetype_slug/label`, `traits_json`, `confidence`,
  `distance`, `narrative`.
- Archetype answers need **no** new write-router branch: the raw 0–5 score already lands
  in `field_sources` (like rubric probes), and `archetypeScoring` reads it there.

## 4. Scoring & completion logic

**Skills / Work values** — unchanged routing: `skill_axis → user_skills.self_level`,
`value_dim → user_values.score` (0–5 → −2..+2, confidence-blended). The banks now cover
≥5 radar axes and ≥4 value dimensions per role, so the radar/wheel have real shape.

**Archetype** — mean each trait's answered 0–5 scores → a 4-dim vector → nearest centroid
(Euclidean over the *answered* traits, normalized by count; deterministic tie-break).
Confidence = `0.6·coverage + 0.4·separation` (how much of the trait space was seen × how
cleanly the winner beat the runner-up). Per-role archetype sets:
founder reuses `fo_*`; investor `inv_*`; partner `pt_*`; mentor/coach `mt_*`.

**Axal Fit** — unchanged (`scoreRubric` / `bandFromScore` / `detectRedFlags`).

**Completion** — per module: `required = min(floor, questions available)`,
`percent = min(100, answered/required)`, `confident = answered ≥ required`. Overall is
required-weighted and caps each module's contribution so over-answering one can't mask a
neglected one. `complete` ⇔ every applicable module is confident. Admin/unknown → not
applicable. The card now shows e.g. **Skills 3/5 · Work values 0/4 · Archetype 0/3 ·
Axal Fit 2/8** instead of a single fake `0/17`.

## 5. Adaptive follow-up

`selectAdaptiveProfiling(bank, answered)`:

1. Drop questions from modules already confident (no busywork).
2. Prefer questions covering an axis/dim/trait **not yet answered** (fill gaps).
3. Break ties by distance-from-confidence, then stable bank order.

The conversation's LLM re-ranker still owns phrasing/flow; this only trims + prioritizes
the candidate pool. A user answers ~20 questions total to reach full confidence, not 17
and not 200.

## 6. Recommended counts per module (per role)

| Module | Floor (required) | Target coverage | Bank offers (founder / investor / partner / mentor) |
| --- | --- | --- | --- |
| Skills | 5 | ≥5 of 8 radar axes | 7 / 5 / 5 / 5 |
| Work values | 4 | ≥4 dimensions | 5 / 5 / 4 / 4 |
| Archetype | 3 | ≥3 of 4 traits | 4 / 4 / 4 / 4 |
| Axal Fit | 8 | rubric + Axal values | 16 / 14 / 14 / 16 |

Full-confidence effort ≈ **20 answered** for every persona (comparable across roles).
Banks carry headroom above the floor so the adaptive selector always has a gap-filler.

## 7. Best-fit

`best-fit/me` now also returns the conversational `archetype` (+ all personas'), so the
Archetype card renders from the conversation. Matching (`services/bestFit.ts`) already
varies by role/venture type and returns the five counterparty types with privacy teasers;
richer Skills/Values/Archetype vectors improve match quality without exposing private data
(counts + banded teasers stay gated; full list stays tier-gated).

## 8. Extending the bank

Add a row to a `banks/fit_*.ts` with a `measures` tag:
`{ skill_axis }` (Skills), `{ value_dim }` (Work values), `{ archetype_trait }`
(Archetype), or `{ rubric_category | axal_value | red_flag }` (Axal Fit). The module
registry, completion math, adaptive selector, and scoring pick it up automatically —
adjust a module's `floor` in `profilingModules.ts` to change how much is "enough".
