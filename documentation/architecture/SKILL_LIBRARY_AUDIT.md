# Skill library: repository, runtime and D1 audit (#4529)

Session 01 of #4528. This is a read-only audit. It changes no code, migration,
generated file, D1 row, permission, publication or production setting.

- **Repository basis:** `main` at `6ee7647cb` (2026-11-07). Every line
  reference below is to that commit.
- **Deployment basis:** not verified in this session. This session had no
  production credentials and made no production reads. A merge to `main`
  ships through `.github/workflows/cloudflare-worker-deploy.yml`, but whether
  a given commit is live, and what rows D1 held, were not read by this audit. Where
  this document says "present", it means present in the repository.
- **Deployed catalogue (D5335, #5335):** the store side is measured by the
  read-only route `GET /api/admin/ai-agents/skills/library/reconcile`. Its
  first production run was read by a Super Admin at 2026-11-13 06:29 UTC.
  The class totals are in §10, under "First production result". They are
  totals and a date only, with no skill content.
- **Companion contract:** `SKILL_LIBRARY_CONTRACT.md` (#4530) is the v1 source
  and golden-case contract. This audit does not restate it; it checks the code
  against it.

## 1. Data flow

```
skills/<slug>.md ─┐                                       (authored source)
cases/<slug>.json ┴─ scripts/build-skill-library.mjs ──► skillLibrary.generated.ts
                                                            (embedded data, never hand-edited)
        POST /api/admin/ai-agents/skills/library/seed  (Super Admin, reason)
                  └─ seedLibrary() ─► agent_skills (scope 'hq', status 'draft')
                                       + agent_skill_tags, agent_skill_roles, agent_skill_cases
  draft edits: PATCH /api/teams/skills/:uid ──► same rows (no history of the draft text)
  review:      POST /:uid/review, /approve, /request-changes ──► agent_skill_reviews (by draft_hash)
  draft evals: POST /:uid/evals ─► runCase() ─► judge() ─► agent_skill_eval_results (by draft_hash)
  publish:     POST /api/teams/skills/:uid/publish | POST /bulk ─► publishDraft()
                 ─► publishRefusal() (HQ only) ─► agent_skill_versions (immutable) + current_version
  attach:      PUT /api/teams/agents/:uid/skills ─► agent_skill_links (agent, skill, version)
  run:         agentRun ─► skillForRun() (pinned version) ─► skillPrompt() ─► run()
                 ─► ai_usage_logs.skill_id / skill_version (tagUsage)
  published evals: POST /evals/published ─► evaluatePublished() or a campaign
                 ─► runCase() ─► judge() ─► agent_skill_version_evals (+ regression alert)
```

## 2. Sources of truth

| Thing | Canonical store | Reference |
| --- | --- | --- |
| Library skill text | `services/agents/skills/<slug>.md` | `scripts/build-skill-library.mjs:35-43` |
| Library golden case | `services/agents/skills/cases/<slug>.json`, one per skill | `build-skill-library.mjs:39-41` (`cases: kase ? [kase] : []`) |
| Generated data | `skillLibrary.generated.ts`, derived; `--check` fails when stale | `build-skill-library.mjs:61-68` |
| HQ draft | `agent_skills` + `agent_skill_tags` + `agent_skill_roles` (mutable; no draft history) | `759_agent_skills.sql:24-47`, `skillPublish.ts:30-38` |
| Draft identity | `draftHash()`: SHA-256 over name, purpose, steps, tools, output, tags, roles | `skillLifecycle.ts:35-39` |
| Draft golden cases | `agent_skill_cases` (a changed case is a new row; the old one gets `removed_at`) | `202611022140_hq_skill_lifecycle.sql:44-57`, `admin_hq_skills.ts:337-350` |
| Published version | `agent_skill_versions` (immutable, `UNIQUE(skill_id, version)`) | `759_agent_skills.sql:51-68`, `skillPublish.ts:62-76` |
| What an agent runs | `agent_skill_links.version` (pinned) | `skillEval.ts:95-117` |
| Draft eval history | `agent_skill_eval_results` (by `draft_hash`, case row, model) | `202611022140_hq_skill_lifecycle.sql:60-73` |
| Published eval history | `agent_skill_version_evals` (by version, `case_key`, model) | `202611022313_agent_skill_runs.sql:18-34` |

The source files are the truth for what the repository proposes. Once seeded,
the D1 draft is the truth for what will be reviewed, and the source file no
longer changes it: `seedLibrary` never rewrites an existing draft's text
(`skillLibrarySeed.ts:107-117`).

## 3. Field survival

| Field | Source | Generated | Seeded draft | Published version | Run prompt |
| --- | --- | --- | --- | --- | --- |
| `name` (slug) | yes | `slug` + `skill_md` | `slug`; display name derived by `nameOfSlug` (`skillLibrarySeed.ts:28`) | `name` | name |
| `description` | yes | in `skill_md` | `purpose` | `purpose` | yes |
| steps | yes | in `skill_md` | `steps_json` | `steps_json`, `skill_md` | yes |
| `tools` | yes | in `skill_md` | `allowed_tools_json` | `allowed_tools_json` | allow-list line |
| `output` | yes | in `skill_md` | `output_kind` | `output_kind` | yes |
| `taxonomy` | yes, map | in `skill_md` | `agent_skill_tags` | `taxonomy_json` | **no** (`skillEval.versionParts` sets `tags: []`, `skillEval.ts:81-86`) |
| `roles` | yes | in `skill_md` | `agent_skill_roles` | `roles_json` | no |
| `version` (source) | yes | in `skill_md` | **dropped** (`readLibrarySkill` ignores it) | own integer sequence | — |
| case `skill`, `version`, `note` | yes | yes | **dropped** (only `input`, `expect` reach `checkCase`, `skillLibrarySeed.ts:85`) | — | — |
| case `refuse_when` | 1 case (`customer-interview-summary.json`) | yes | **dropped** by `checkCase` (`skillLifecycle.ts:68`) | — | — |
| case name | not in source | not in source | always `"<slug>: golden case"` (`skillLibrarySeed.ts:85`) | — | — |

## 4. Validation: one set of rules, three readers

| Reader | Used by | Notes |
| --- | --- | --- |
| `readLibrarySkill` | seed, library list, source tests | strict: `---\n` fences, `key: value` lines, duplicate key refused, every body line `N. step`, flow list/map only (`skillLibrarySeed.ts:47-66`). Accepts unknown keys. Splits the taxonomy map on `,` and `:` with no quoting. |
| `parseSkillMd` | pasted SKILL.md in the editor | looser: CRLF, BOM, quoted scalars, `-`/`*` bullets, block taxonomy list (`skills.ts:184-212`). Different format from the library files. |
| `checkDraft` | every writer (create, patch, publish, seed) | the field rules: slug, name ≤ 80, purpose ≤ 300, 1–20 steps ≤ 400, ≤ 12 read-only tools, output kind, 1–12 active tags with a level, ≥ 1 known role (`skills.ts:89-120`). |
| `checkCase` | seed, case PUT, draft eval, published eval | object shape, ≤ 20,000 chars, **email only** for PII, name ≤ 120, non-empty records, output kind, ≤ 20 phrases of ≤ 200 chars per list, ≥ 1 phrase (`skillLifecycle.ts:51-69`). |

The importer and the interactive path share `checkDraft` and `checkCase`, so
the field rules are one set. The two parsers differ only in accepted syntax.
Neither `checkCase` nor any runtime path checks that a case's record keys are
reads the skill lists. The library test checks it for committed sources only.

## 5. Taxonomy and areas

- A tag is a `skills.slug` with `is_active = 1` (`skillPublish.ts:40-43`); the
  category slugs (`product`, `design`, …) are rows of `skill_categories`, not
  tags. The checked-in seed is migration `090_seed_skills_values_taxonomy.sql`.
- The eight axes are `RADAR_AXES` (`skillsTaxonomySchema.ts:32-41`); a tag's
  axis is its `category_slug` (`skillLinks.ts:124-127`).
- **Resolved by D5334:** the library source view, seed and HQ store list use
  one exported rule: the first tag whose category maps to a radar axis, and
  that tag's own level. A source-wide regression compares all three paths;
  `case-study-draft` mutation-checks the former highest-level inconsistency.

## 6. Evaluation

| | Draft evaluation | Published evaluation |
| --- | --- | --- |
| Entry | `POST /:uid/evals` (`admin_hq_skills.ts:382`) | `POST /evals/published` (`admin_hq_skills.ts:395`), campaigns (D4668) |
| Cases | live `agent_skill_cases` | the shipped starter case (12 slugs, key `starter`, `skillEval.ts:43-76`) + live `agent_skill_cases` (key = uid) |
| Runner | `runCase()` → `run()` pinned model, temperature 0 (`skillLifecycle.ts:86-104`) | same |
| Judge | `judge()` (`skillLifecycle.ts:72-80`) | same |
| Identity | `draft_hash`, case row id, model | version, `case_key`, model |
| Result | `pass` / `fail` / `not_run` (a thrown run, a refusal or no text is `not_run`) | same |
| Gate | `publishRefusal`: a second Super Admin's approval on the current hash, then 9 of 10 over every live case × every model run for this hash; a missing result is `not_run`; nothing run is below the bar (`skillLifecycle.ts:111-175`) | none (monitoring). A regression is a `pass` → `fail` on the same case and model, told to HQ once per skill, version, case and model in 90 days (`skillEval.ts:182-211`) |
| Bounds | ≤ 5 models per press (`admin_hq_skills.ts:69`) | ≤ 20 skills per press (`SKILLS_PER_RUN`, `skillEval.ts:58`); a campaign continues past 20 |

Findings:

1. **The missing-data assertion is not field-specific (defect, #4531).**
   `judge()` passes `must_say_not_recorded: ["runway"]` when "runway" appears
   anywhere and "not recorded" appears anywhere (`skillLifecycle.ts:75-77`).
   Reproduced on the committed `board-meeting-brief` case: the text "There are
   37 paying customers. Delaware franchise tax is on the agenda. Runway is 12
   months. Churn is Not recorded." returns `pass`. Both evaluation paths share
   `judge()`, so both are affected.
2. **Phrase checks are substring checks.** `"37"` passes on "370"; a phrase in
   a hypothetical sentence passes. The judge has no numeric, structural or
   evidence assertion (#4531 scope).
3. **Resolved by D5334:** published evaluation runs once per distinct case
   input/expectation content. A live copy suppresses the shipped starter run;
   a differently named copy is still the same content, while a changed input
   or expectation remains a separate run. Historical rows stay immutable and
   the board folds current duplicate keys to one content/model unit.
4. **Resolved by D5334:** the alert's prior-result read is scoped to the same
   skill version, case and model, matching the board. A v1 pass followed by a
   v2 fail is visible in `GET /:uid/evals/compare`, but is not called a v2
   pass-to-fail alert. A v2 pass followed by a v2 fail still alerts once.
5. **Library case names are not distinct.** Every seeded case is named
   `"<slug>: golden case"`, and the seed treats a same-named case as present
   (`skillLibrarySeed.ts:111-113`). A source with two cases would seed one.
   The generator allows one case file per skill. Multi-case packaging needs a
   stable case identity first (#4532, #4588).
   **Resolved by D5336 (#5336, 2026-11-10).** A case is identified by
   `case_id` + `revision` where its source gives them (the #4588 scenarios),
   and by the unchanged `<slug>#<sha12>` otherwise, through one helper
   (`skillCaseIdentity.ts`). The generator embeds each scenario beside its
   golden case under its own name, the seed records the identity on the row and
   adds only cases whose identity no live case has, and the CI gate fails two
   cases of one identity. The 52 scenarios import as stored cases.

## 7. Gates by scope

| | HQ skill (`scope = 'hq'`) | Company skill |
| --- | --- | --- |
| Who writes | Super Admin (`team_skills.ts:123-124`) | the company's editors (`team_skills.ts:125`) |
| Publish | `checkDraft` + second-admin approval + 9 of 10 | `checkDraft`; clears HQ moderation (`skillPublish.ts:49-76`) |
| Retire | HQ › AI agents with a replacement (`team_skills.ts:381`, `admin_hq_skills.ts:481`) | the company |
| Uniqueness | `UNIQUE(scope, IFNULL(company_id,0), slug)` (`759_agent_skills.sql:48`) | same index, per company |

## 8. Runtime composition

One skill per run. `agentRun` passes at most one `input.skill`
(`agentRun.ts:349`), resolved through `skillForRun` to the agent's pinned
version with six refusals (`skillEval.ts:95-117`). There is no composition or
dependency between skills in the repository.

## 9. Routes

`/api/admin/ai-agents/skills/*` (Super Admin; `admin_hq_skills.ts:1-29`,
mounted through `_registry.ts:80`):

| Route | Line | Frontend client |
| --- | --- | --- |
| `GET /` | 124 | `adminHqSkillsApi.list` |
| `GET /library` | 187 | **missing** |
| `POST /library/seed` | 204 | **missing** |
| `GET /library/reconcile` (D5335, read only) | — | none by design; the screen is #4956 |
| `GET /:uid` | 213 | `get` |
| `GET /:uid/diff` | 252 | `diff` |
| `POST /:uid/review`, `/approve`, `/request-changes` | 272, 324, 325 | `requestReview`, `approve`, `requestChanges` |
| `PUT /:uid/cases` | 329 | `setCases` |
| `POST /:uid/evals` | 382 | `runEvals` |
| `POST /evals/published` | 395 | **missing** |
| `GET /evals/published/campaigns/:uid`, `POST …/cancel` | 442, 449 | **missing** |
| `POST /:uid/retire` | 481 | `retire` |
| `POST /bulk` | 495 | `bulk` |

`/api/teams/skills/*` (members; `team_skills.ts`, mounted at `index.ts:1793`):
`GET /skills` 232, `GET /skills/:uid` 273, `POST /skills` 329,
`PATCH /skills/:uid` 371, `POST /skills/:uid/publish` 408,
`GET /agents/:uid/skills/available` 490, `GET`/`PUT /agents/:uid/skills` 513/520,
cost estimates 611/637, `GET /skills/:uid/agents` 665,
`GET /skills/:uid/assignable` 704, `POST /skills/:uid/assign` 737,
`GET /:scope/:id/coverage` 771. Clients in `frontend/src/lib/api/teamAgents.js`.

## 10. Catalogue reconciliation (repository, synthetic-safe)

Run on the repository with the production reader and validators
(`readLibrarySkill`, `checkLibrary`, `checkCase`, `draftHash`) and the
checked-in taxonomy (migration 090):

| Check | Result |
| --- | --- |
| Source definitions / case files / generated entries | 182 / 182 / 182 |
| Source-only, case-only | 0, 0 |
| Generated slugs and `skill_md` equal to sources | yes |
| `checkLibrary` refused | 0 |
| Case `skill` ≠ filename; case `output` ≠ skill output | 0, 0 |
| Case record key outside the skill's tool sources; not a catalogue read key | 0, 0 |
| Tools not in the `source.read` form | 0 |
| Skills with more than one taxonomy tag | 179 |
| Role breadth: 1 / 2 / 3 roles | 46 / 124 / 12 |
| Unused case fields carried in sources | `refuse_when` (1) |

What this does **not** establish: the D1 side. The persisted catalogue
(seeded drafts, edits since seeding, published versions) can only be compared
by a permitted aggregate read, which this session did not make. "Equal counts"
would not prove equal content in any case; the comparison has to be by
identity and content hash.

### Reconciliation contract (handed to #4532)

Identity is `(scope, company_id, slug)` for a skill and `draft_hash` for its
draft content. A library case is identified by `sha256(JSON.stringify({input,
expect}))` until #4532/#4588 introduce a stable case id.

| Class | Detected by | Proposed disposition |
| --- | --- | --- |
| `exact` | same slug, `draft_hash` and case hashes | none |
| `source_only` | slug in source, not in D1 | seed (existing route, explicit Super Admin action) |
| `persisted_only` | slug in D1 (`scope = 'hq'`), not in source | report; keep. Never delete or rename. |
| `content_drift` | same slug, different `draft_hash` | report the differing fields (`diffParts`). A draft is never overwritten; a repair is a reviewed edit through `PATCH`, with the expected prior hash. |
| `case_drift` | same slug, source case hash not among live case hashes | report. The seed will **not** add it: every library case has the same name, and the seed skips a same-named case (finding 5). A changed case goes in through the reviewed `PUT /:uid/cases`; a historical case is never edited. *Since D5336: a source case is present when a live case has its identity and its content; the seed, run on a draft, adds a case whose identity no live case has, as a new row, and never edits or removes one.* |
| `missing_case` | a skill with no live case | report; below the publish bar by construction |
| `invalid_reference` | `checkLibrary` or `checkCase` refuses | fail CI with the code and message |
| `duplicate_identity` | two sources or two rows for one identity | fail CI; D1 cannot hold it (`759_agent_skills.sql:48`) |

The machine-readable form of each line is:

```json
{ "slug": "board-meeting-brief", "class": "content_drift",
  "source": { "draft_hash": "…", "case_hashes": ["…"] },
  "persisted": { "uid": "…", "status": "draft", "draft_hash": "…", "live_case_hashes": ["…"] },
  "fields": ["steps"], "disposition": "report" }
```

The persisted half needs a read of drafts and cases, which is user content in
the sense of AGENTS.md. Ordinary CI must use local or synthetic D1 fixtures;
a production comparison is a separately authorized, read-only run.

### The read-only preflight (D5335, #5335)

`GET /api/admin/ai-agents/skills/library/reconcile` is that run. It is Super
Admin only and reads HQ scope only. It returns hashes, identities, classes and
totals, never draft or case text, and repairs nothing. Its JSON is also a valid
`check-skill-library.mjs --persisted` manifest. Route shape:
`route-map/sections/0808-hq-skill-library-reconcile-d5335.md`.

#### First production result

The owner opened the route once on production and gave the totals and `read_at` on #5335. Only those are recorded here, never skill content.

| Read at (UTC) | exact | source_only | persisted_only | content_drift | case_drift | missing_case | duplicate_identity | invalid_reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-13 06:29:15 | 0 | 112 | 110 | 70 | 0 | 0 | 0 | 0 |

How to read it:
- **The source has 182 skills.** 112 are not in D1, and 70 are in D1 with different content. None matches exactly.
- **D1 holds 180 HQ rows.** 70 share a slug with a source and 110 share none.
- **Every one of the 180 is a draft at version 0.** No HQ skill has a published version on production, so no agent pin rests on any of them, and no repair reaches a running agent.
- **The 110 `persisted_only` rows** have uids and slugs that appear nowhere in the repository or its history. They were written to D1 outside the source seed. This audit does not say by whom, and does not judge them.
- **`case_drift` and `missing_case` are 0.** Every drifted skill's source case is among its live cases, so the drift is in the definition, not the cases.

#### Each non-exact class: D4532's disposition and its follow-up

Nothing here is repaired by the route or by #5335. A count above zero is acted
on through the route named in the table, by a person.

| Class | D4532 disposition | Follow-up |
| --- | --- | --- |
| `source_only` | seed | The existing Super Admin action `POST /library/seed` (D4225), which adds each skill as a draft with its cases. No new issue is needed. |
| `persisted_only` | report | None needed. The row is kept, never deleted or renamed. A Super Admin decides whether to retire it through `POST /:uid/retire`. |
| `content_drift` | report | A Super Admin compares the draft against its deployed library source (`GET /:uid/diff?from=source&to=draft`). Either the source changes in a PR through the CI gate, or the draft gets a reviewed edit (`PATCH /api/teams/skills/:uid`). The screen that lists the drifted skills is #4956. |
| `case_drift` | report | The seed run on a draft adds a source case whose identity no live case has (D5336). A changed case goes through the reviewed `PUT /:uid/cases`. A historical case is never edited. The screen is #4956. |
| `missing_case` | report | Same route as `case_drift`: `PUT /:uid/cases`, or the seed on a draft. The skill is below the publish bar until then. The screen is #4956. |
| `duplicate_identity` | fail | None needed while the count is 0. D1's unique index (`759_agent_skills.sql:48`) cannot hold two HQ rows of one slug, and the CI gate fails two sources of one. A count above 0 means a new issue for the owner. |
| `invalid_reference` | fail | On production this means the store's taxonomy no longer has a tag that the files use. The fix is a PR to the source or the taxonomy, through the CI gate. None needed while the count is 0. |

#### #5790 production batches

- A signed-in Super Admin reads the current production reconciliation report before seeding. The November 13 row is a baseline. Run the existing seed with an audit reason. It creates absent HQ drafts with their cases and can add missing cases to existing drafts while retaining their definition. Read the reconciliation report again after the batch. If a seed times out, reconcile before retrying.
- Review each persisted-only skill in HQ and record the decision there: keep it as HQ-authored, propose a source PR, or retire it through the existing lifecycle. Retirement requires a valid replacement. Preserve the skill identity. Use a private review record for per-skill decisions.
- For each content drift, use the explicit source comparison. The default comparison for a skill with no published version is draft against draft. Source compare uses the deployed asset and shows definition changes. It does not supply a published evaluation manifest. Apply a reviewed draft edit with the current expected hash, or propose a source PR through the skill-library CI gate. Re-read after each batch.
- Append only the verified production response's UTC read time and class totals to the table above. Keep skill content, identities, hashes and review notes in HQ.

## 11. Tests

Existing suites (run from the repo root with the Worker loader):
`agent_skill_library_d1612`, `skill_library_seed_d4225`,
`skill_library_contract_4530`, `hq_skill_lifecycle_d4160`,
`agent_skill_runs_d1612d`, `skill_eval_campaigns_d4668`,
`skill_enforcement_d4534`, `company_skill_moderation_d4161`,
`team_skills_d1612`, `team_agent_skills_d1612`, `skill_run_cost_d4121`,
`skills_sdk_adapter_4555`; `node scripts/build-skill-library.mjs --check`.

Missing regressions at the audit date: field-specific missing-data (finding
1); substring numbers (finding 2); duplicate case names on multi-case sources
(finding 5); case record keys checked at runtime against the skill's tools.
Findings 3 and 4 now have D5334 regressions.

## 12. Gaps for Sessions 02–10

| Capability | Status | Next |
| --- | --- | --- |
| v1 source contract | present (`SKILL_LIBRARY_CONTRACT.md`) | — |
| Field-specific missing-data assertion | missing | #4531 slice 1 |
| Numeric, structural, evidence assertions | missing | #4531 |
| Model-judged rubric | missing | #4531, after deterministic assertions |
| CI command with per-file errors and a summary | partial (tests and `--check` exist) | #4532 |
| Source ↔ D1 reconciliation | present: #4532 (CI, `--persisted`), D5335 (read-only production route); first production totals recorded 2026-11-13 (§10) | the dispositions in §10 |
| Stable case ids, multi-case sources | present (D5336, #5336) | — |
| Release evidence | unclear | #4533 |
| Campaign traversal past 20 skills | present (D4668) | — |
| Frontend: library list, seed, published evals, campaigns | missing client methods | a UI session |
| Skill composition | missing | out of scope until specified |

Deliverable without a migration: findings 1, 2 and 5 (judge and seed code),
the CI command, the reconciliation report, and the frontend client methods.
Findings 3 and 4 change evaluation semantics and need an owner decision first.

## 13. Do not rebuild

The lifecycle (`skillLifecycle.ts`), the publish path (`skillPublish.ts`),
the seed (`skillLibrarySeed.ts`), the generator, the two evaluation histories
and their tables, campaigns (D4668), the run gate (`skillForRun`), usage
attribution and the HQ routes. Extend them. In particular, there is no case
for a second case table, a second evaluation runner, or a second evaluation
board (#3851 evaluates agent proposals, not skill definitions).
