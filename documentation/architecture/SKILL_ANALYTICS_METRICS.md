# Skill analytics: the metric dictionary (D4536, #4536)

Every number the skill catalogue shows is defined here: where it is read from, what it is grouped by, its window, its denominator, when it is available and who may read it. A measure with no source is `{ "available": false, "reason": "…" }` and reads **Not recorded**. It is never `0`. An observed zero is `0`.

Two kinds of count are kept apart:
- **Adoption** is which agents pin a skill (`agent_skill_links`).
- **Usage** is what actually ran. Usage is not recorded yet, and adoption never stands in for it.

The proposal acceptance board of #3851 (`services/agents/evaluation.ts`: acceptance, edit and discard rates per role) measures agent proposals. It is not read here, and none of its rates is relabelled as skill quality.

## Where it is served

`GET /api/admin/ai-agents/skills` (Super Admin only, `requireSuperAdmin`) returns `coverage` next to `skills`. It is computed by `services/agents/skillCoverage.ts` from two aggregate reads, a fixed number whatever the catalogue's size or the page asked for.

The counts are always the whole catalogue's: a `?page=` read pages `skills`, never `coverage`. Only the validated filters in § Filters narrow them (D5970). A company's own analytics are not served yet. When they are, they read only that company's rows, behind `canEditAsMember`.

## Catalogue and coverage (served now)

| Metric | Source | Grouping | Window | Denominator | Availability | Scope |
|---|---|---|---|---|---|---|
| `by_scope.{hq,company}.{draft,published,retired}` | `agent_skills.status` | scope, stored status | now | — (counts) | always | HQ; company skills as counts only |
| `by_scope.*.review_requested` | `agent_skill_reviews.status = 'requested'` | scope | now | non-retired skills | always | as above |
| `by_role[].published` | current version's `agent_skill_versions.roles_json` | catalogue role (`ROLES`) | now | published HQ skills with a version | always | HQ |
| `roles_without_published` | as above | role | now | catalogue roles | always | HQ |
| `by_area[].published_primary` | current version's `taxonomy_json[0]` → `skills.category_slug` | radar axis (`RADAR_AXES`) | now | published HQ skills | always | HQ |
| `by_area[].published_any` | every tag of the current version | radar axis | now | published HQ skills | always | HQ |
| `by_area[].coverage` | `published_primary` | radar axis | now | — | `none` at 0, `thin` below `thin_below` (3), else `covered` | HQ |
| `by_tag[].{primary,secondary}` | current version's tags, first or later | taxonomy slug | now | published HQ skills | always | HQ |
| `by_primary_level` | the primary tag's level | proficiency level | now | published HQ skills with a tag | always | HQ |
| `published_untagged` | current version with no tags | — | now | published HQ skills | always | HQ |
| `drafts.total`, `without_cases`, `without_roles`, `without_tags` | `agent_skills` (status `draft`), `agent_skill_cases` (live), `agent_skill_roles`, `agent_skill_tags` | — | now | HQ drafts | always | HQ |
| `drafts.without_current_evaluation` | each draft's required runs under its current evidence (D4533), as the list computes them | — | now | HQ drafts with live cases | full list only; a `?page=` read is `{ available: false }` | HQ |
| `sources.library_files` | `SKILL_LIBRARY` (the generated source library) | — | build | — | always | HQ |
| `sources.source_only` | library slugs with no HQ row | slug | now | library files | always | HQ |
| `sources.seeded`, `seeded_published` | library slugs with an HQ row, and of those, with a published version | — | now | library files | always | HQ |
| `sources.authored_in_store` | HQ rows with no library file | — | now | HQ skills | always | HQ |
| `adoption.links`, `agents` | `agent_skill_links` on HQ skills, agents not `removed` | — | now | — | always; **adoption, not usage** | HQ |
| `adoption.pinned_behind_current` | links whose `version` < the skill's `current_version` | — | now | `adoption.links` | always | HQ |
| `adoption.published_without_links` | published HQ skills no active agent pins | — | now | published HQ skills | always; not "unused", which needs runs | HQ |
| `overlap` | — | — | — | — | `{ available: false }`: suggestions are not computed yet. When they are, they are labelled suggestions, never duplicates | HQ |
| `executions` | — | — | — | — | `{ available: false }` until #4667 gives a reliable run status | HQ |

Definitions that matter:
- **Published coverage reads the current published version**, the version an attach pins and a run uses. A draft, a retired skill and a version an agent pinned earlier cover nothing.
- **A company skill** is counted by scope and status only. Its slug, roles and tags are not read into the response.
- **`review_requested`** is a requested review. It is not `lifecycleStatus`'s `in_review`, which also needs the request to be on the current evidence. The per-skill `status` in `skills` stays `lifecycleStatus`.

## Published-version evaluation (served now, D4536-p2)

`GET /api/admin/ai-agents/skills` returns `published_evaluation` next to `coverage` (Super Admin only). It is computed by `publishedEvaluation` in `services/agents/skillCoverage.ts` from three reads, whatever the catalogue's size or the page:
- the published HQ skills at their current version, with their live cases;
- the published history;
- the latest campaign.

Like `coverage`, it is the whole catalogue's on a `?page=` read.

Definitions that matter:
- **Source.** Every figure reads `agent_skill_version_evals` only, the published history. The draft history (`agent_skill_eval_results`, by draft and evidence hash) is never read here, so no number blends the two.
- **Scope.** Each published HQ skill (`status = 'published'`, `current_version >= 1`) is read at its **current version**. A retired or draft skill is not in the block.
- **A unit** is a version, a case key and a model. The latest row per unit counts, by `run_at` and then `id`. A unit run again counts once.
- **Expected units** are the version's cases times its required models:
  - the cases are those a run takes (`casesOf`): the starter case unless a live case carries its text, plus each live case;
  - the models are the version's release manifest (`evidence_json.models.required`), else the skill's declared set, else the default set. `models_source` says which.
- **Missing and observed.** A unit with no row is missing. A version with no row at all is not evaluated, and its measures read `{ available: false }`, never 0 of 0. A `not_run` row is recorded; it is counted as `not_run` and is never a pass or a fail.

| Metric | Source | Grouping | Window | Denominator | Availability | Scope |
|---|---|---|---|---|---|---|
| `history` | — | — | — | — | always `'published'` | HQ |
| `versions.{published,evaluated,unevaluated}` | `agent_skills`, `agent_skill_version_evals` | current version | now | published HQ skills | always | HQ |
| `versions.unevaluated_skills` | as above | skill uid | now | — | always | HQ |
| `results.{pass,fail,not_run}` | latest row per unit, current version | result | all runs on that version | units with a row | `{ available: false }` when no version is evaluated | HQ |
| `required.{units,recorded,missing,versions_incomplete}` | expected units against latest rows | version, case key, model | now | expected units (cases × required models) | always | HQ |
| `required.{model_pairs,models_without_result}` | as above | version, model | now | required models summed over versions | always; a model with no row on any expected case | HQ |
| `regressions.since_previous_run.<outcome>` | latest vs the newest earlier row that ran, same version | case, model | all runs on that version | latest rows, one outcome each (`PairOutcome`) | `{ available: false }` when no version is evaluated | HQ |
| `regressions.since_previous_version.<outcome>` | previous version's latest rows vs current version's (`compareResults`) | case, model | versions N-1 and N | pairs in either version | `{ available: false }` when no evaluated version has a previous one | HQ |
| `regressions.time_to_resolve` | — | — | — | — | always `{ available: false }`: needs the fixing version linked to the regression | HQ |
| `freshness.{newest_run_at,hours_since_newest}` | `run_at` of the latest rows | — | now | evaluated versions | `{ available: false }` when none is evaluated | HQ |
| `freshness.{oldest_last_run_at,hours_since_oldest}` | the oldest of each version's last run | — | now | evaluated versions | as above | HQ |
| `identity.{current_evaluator_version,evaluator_versions}` | `evaluator_version` of the latest rows; `EVALUATOR.version` | — | now | latest rows | as above | HQ |
| `identity.rows_on_current_evaluator`, `rows_on_other_evaluator`, `rows_evaluator_not_recorded`, `rows_case_text_not_recorded` | `evaluator_version`, `case_sha256` | — | now | latest rows | as above | HQ |
| `campaign.{uid,status,started_at,finished_at}` | the latest `agent_skill_eval_campaigns` row | — | that campaign | — | `{ available: false }` when none started or unreadable | HQ |
| `campaign.manifest.{total,done,skipped,pending}` | `agent_skill_eval_campaign_skills.state` | state | that campaign | its manifest | as above | HQ |
| `campaign.published_not_done` | published HQ skills whose current version that campaign did not finish | — | now | published HQ skills | as above | HQ |
| `campaign.full_coverage` | the three above | — | — | — | true only when the campaign is `complete`, nothing is pending and `published_not_done` is 0; a batch is never full coverage (#4668) | HQ |
| `skills[].{skill_uid,version,evaluated}` | per published HQ skill | skill, current version | now | — | always | HQ |
| `skills[].required.{cases,models,models_source,units,recorded,missing[],models_without_result[]}` | expected units | case key, model | now | that version's expected units | always | HQ |
| `skills[].results`, `by_model.<model>` | latest rows | result; model | all runs on that version | that version's units with a row | `{ available: false }` when the version is not evaluated | HQ |
| `skills[].cases[].{case_key,model_id,result,run_at,evaluator_version,case_sha256}` | the latest row per unit | case key, model | — | — | `[]` when not evaluated | HQ |
| `skills[].regressions.{since_previous_run,since_previous_version}` | as the catalogue's, `regressed` only | — | as above | — | `{ available: false }` when not evaluated; `since_previous_version` is null on v1 | HQ |
| `skills[].{last_run_at,hours_since_last_run}` | `run_at` of the latest rows | — | now | — | null when not evaluated | HQ |
| `skills[].identity.{evaluator_versions,on_current_evaluator,evaluator_not_recorded,case_text_not_recorded}` | latest rows | — | now | that version's latest rows | `{ available: false }` when not evaluated | HQ |

When the history cannot be read, the whole block is `{ available: false, reason }`. It is never served as zeros. The proposal evaluation board of #3851 is not read: no query names a proposal table.

## Evaluation quality (defined; served by the existing routes)

These are read where they already exist. They are not repeated in `coverage`, and the two kinds are never blended. The published-version figures are also served across the catalogue, in `published_evaluation` above.

| Metric | Source | Grouping | Denominator | Where |
|---|---|---|---|---|
| Draft pass / total | `agent_skill_eval_results`, latest per case and required model under the current `evidence_hash` | skill, evidence, case, model | live cases × required models | `skills[].golden`, `GET /:uid` |
| Published pass / fail / not_run | `agent_skill_version_evals` | skill, immutable version, case key, model | cases × models run on that version | `GET /:uid/evals/compare` (D4531 slice 3) |
| Regressions | pass turned fail on the same case text, model and evaluator | case, model | comparable pairs (`COMPARABLE`) | the compare report; `POST /evals/published` |
| Evaluation freshness | `last_eval`, `freshness` (D4533) | skill | — | `skills[].last_eval`, `GET /:uid` |
| Evaluator, model set and case set | `evaluator_version`, `case_sha256`, the required models | result row | — | the compare report's `attribution` |

Not recorded yet: time to resolve a regression. It needs the fixing version linked to the regression, and `published_evaluation.regressions.time_to_resolve` says so. Campaign coverage over the whole catalogue is served as `published_evaluation.campaign` (#4668 progress; one batch is never full coverage).

## Execution and usage (deferred)

| Metric | Source when available | Waits on |
|---|---|---|
| Executions by skill, version, model, role, scope and window | `ai_usage_logs.skill_id` / `skill_version` joined to a run record with a status | #4667 (a reliable run status). A usage row alone is not a run |
| Success, failure and refusal rate | the run status above | #4667 |
| Median and p95 latency | run start and end timestamps | #4667 |
| Tokens and actual charge | the usage ledger, in micro-USD as stored | #4667. A missing join is cost unavailable, never an estimate |
| Cost per completed execution | completed runs and their charge, both recorded | #4667 |
| Estimated context per run | `agent_skill_version_costs.context_tokens` | served now as `skills[].tokens_per_run`, labelled an estimate, never actual usage |
| Workflow executions and steps | — | #4535 (a workflow's stable identity) |
| Manual vs scheduled attribution | — | #4534 |

## Quality and maintenance signals (deferred)

These combine the measures above, so each waits on the ones it uses:
- unused skills (runs);
- stale evaluations (freshness, available now per skill);
- rising failure or refusal rates (runs);
- regression recurrence (the regression history);
- high usage with weak evaluation or high cost (runs and charge);
- orphaned dependencies (#4535).

Version adoption lag is served now as `adoption.pinned_behind_current`.

## Filters

Served now (D5970, #5970). `GET /api/admin/ai-agents/skills` takes optional query parameters that narrow `coverage` and `published_evaluation`. They never narrow the paged `skills` list. A read with none of them is the read it was before: same reads, same blocks, and no `filters` key.

| Parameter | Value | Checked against | `coverage` | `published_evaluation` |
|---|---|---|---|---|
| `scope` | `hq` | the only scope this route serves; anything else is `scope_not_served` | yes | yes (already HQ only) |
| `status` | `draft`, `published` or `retired` | `agent_skills.status` | yes | yes (the block holds published skills only, so another status matches nothing) |
| `uid` | 32 lower-case hex characters | format; a well-formed uid with no skill matches nothing | yes | yes |
| `version` | a whole number from 1 | format; matches the skill's **current** version | yes | yes |
| `category` | a radar axis slug (`RADAR_AXES`) | the taxonomy's categories | yes | yes |
| `tag` | a taxonomy skill slug | the active rows of `skills` | yes | yes |
| `role` | a catalogue role key (`ROLES`) | the catalogue | yes | yes |
| `model` | a model id | the model catalogue's chat models, a deprecated one included | no (coverage has no model) | yes |
| `from`, `to` | `YYYY-MM-DD`, UTC, both or neither | real calendar dates, `from` ≤ `to`, at most **366 days** counting both ends | no (coverage is now, not a period) | yes |

How each one matches:
- **Skill terms** (`scope`, `status`, `uid`, `version`, `category`, `tag`, `role`) keep the HQ skills they match. Role, tag and category read the skill's **current published version**, the one coverage counts: a skill matches a role or tag its current version lists, and a category when any tag of that version is in it. A skill with no published version matches none of the three.
- **Model** keeps that model's rows of the published history, and narrows each version's required models to it, so `required` counts that model's units only.
- **The window** is on evaluation `run_at`: from the `from` day's `00:00:00` inclusive to the day after `to` at `00:00:00` exclusive. A row at `to` `23:59:59` is in; a row at the next midnight is out. It is applied in SQL before the latest row per unit is chosen, so the result counted is the latest one **inside** the window. The regression baselines (`prior`, the previous version's rows) are read inside it too. A unit with no row in the window is missing; a version with none is not evaluated.

What a filtered read serves:
- **Counts that were read** are counted over the matched skills only. A filter that matches nothing reads observed zeros, never the unfiltered figures.
- **Measures that need a row** (`results`, `regressions`, `freshness`, `identity`) read `{ available: false }` when no matched version has a row, as they do unfiltered.
- **Measures a filter cannot narrow** read `{ available: false, reason }`:
  - `coverage.by_scope.company`: a company skill's tags and roles are never read, so no filter can match it;
  - `coverage.sources`: the source library files are not filtered;
  - `coverage.drafts.without_current_evaluation`: computed on the unfiltered full list only;
  - `published_evaluation.campaign`: a campaign's progress is the whole catalogue's.
- **`filters`**, beside the blocks, says what was applied: `applied` (each value as given), `window` (`since`, `until`, `days`, `max_days`), and for `coverage`, `published_evaluation` and `skills` the parameters each `applied` and those `not_applicable` to it.

Refusals are `400` with the code in `error` and a sentence in `message`. None falls back to "all".
- `filter_unknown`: a parameter that is not a filter (`page` is allowed).
- `filter_repeated`: a filter given more than once.
- `scope_not_served`, `status_unknown`, `category_unknown`, `tag_unknown`, `role_unknown`, `model_unknown`: a value not in its list. An empty value is unknown too.
- `uid_malformed`, `version_malformed`: a malformed value.
- `window_incomplete`: only one of `from` and `to`.
- `window_malformed`: not a calendar date.
- `window_reversed`: `to` before `from`.
- `window_too_long`: over 366 days.

The number of reads stays fixed: the filters are matched in memory over rows the five reads already return, and the model and window are bound parameters of the history read. No filter adds a read or a per-skill query.

Not yet: a company administrator's read of their own company's analytics (a company scope, checked server-side and never taken from the client), and the filters on the usage measures, which wait on #4667.
