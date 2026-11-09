# Skill analytics: the metric dictionary (D4536, #4536)

Every number the skill catalogue shows is defined here: where it is read from, what it is grouped by, its window, its denominator, when it is available and who may read it. A measure with no source is `{ "available": false, "reason": "…" }` and reads **Not recorded**. It is never `0`. An observed zero is `0`.

Two kinds of count are kept apart:
- **Adoption** is which agents pin a skill (`agent_skill_links`).
- **Usage** is what actually ran. Usage is not recorded yet, and adoption never stands in for it.

The proposal acceptance board of #3851 (`services/agents/evaluation.ts`: acceptance, edit and discard rates per role) measures agent proposals. It is not read here, and none of its rates is relabelled as skill quality.

## Where it is served

`GET /api/admin/ai-agents/skills` (Super Admin only, `requireSuperAdmin`) returns `coverage` next to `skills`. It is computed by `services/agents/skillCoverage.ts` from two aggregate reads, a fixed number whatever the catalogue's size or the page asked for.

The counts are always the whole catalogue's: a `?page=` read pages `skills`, never `coverage`. A company's own analytics are not served yet. When they are, they read only that company's rows, behind `canEditAsMember`.

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

## Evaluation quality (defined; served by the existing routes)

These are read where they already exist. They are not repeated in `coverage`, and the two kinds are never blended.

| Metric | Source | Grouping | Denominator | Where |
|---|---|---|---|---|
| Draft pass / total | `agent_skill_eval_results`, latest per case and required model under the current `evidence_hash` | skill, evidence, case, model | live cases × required models | `skills[].golden`, `GET /:uid` |
| Published pass / fail / not_run | `agent_skill_version_evals` | skill, immutable version, case key, model | cases × models run on that version | `GET /:uid/evals/compare` (D4531 slice 3) |
| Regressions | pass turned fail on the same case text, model and evaluator | case, model | comparable pairs (`COMPARABLE`) | the compare report; `POST /evals/published` |
| Evaluation freshness | `last_eval`, `freshness` (D4533) | skill | — | `skills[].last_eval`, `GET /:uid` |
| Evaluator, model set and case set | `evaluator_version`, `case_sha256`, the required models | result row | — | the compare report's `attribution` |

Not recorded yet: time to resolve a regression (it needs the fixing version linked to the regression), and campaign coverage over the whole catalogue (#4668 progress; one batch is never full coverage).

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

The served block takes no filters yet; it is the whole catalogue now. When the usage measures land, the issue's filters apply to them:
- a bounded date range;
- taxonomy category and tag;
- role;
- scope (HQ, or a company the caller administers, checked server-side and never taken from the client);
- status, skill uid and version;
- model.
