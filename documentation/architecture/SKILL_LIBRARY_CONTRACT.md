# Skill Library definition and golden-case contract

This is the version 1 contract for source files in the From Axal Skill
Library. It describes the code that runs today and labels every proposed field
or evaluator separately. It does not authorize a database write, a seed, or a
publication.

## Scope and pipeline

The authoritative authored inputs are a definition at
`cloudflare-worker/src/services/agents/skills/<slug>.md` and its case at
`cloudflare-worker/src/services/agents/skills/cases/<slug>.json`. The build
script embeds both in `skillLibrary.generated.ts`; it is generated only.
`skillLibrarySeed.ts` reads the generated data, validates it as an HQ draft,
and can create a **draft** and live cases. The Worker never reads the source
directory at runtime. Review, evaluations, and publication use stored rows.

An author must run `node scripts/build-skill-library.mjs --check` and the
library validation tests in CI. Seed remains an explicit Super Admin action;
nothing in this contract seeds, publishes, or writes production D1.

## Skill definition v1

### Canonical source form

```md
---
name: board-meeting-brief
description: Prepares a board-meeting brief from recorded data.
roles: [ceo, coo]
tools: [project.read, grow.read, mercury.read]
output: brief
taxonomy: {cap_board_governance: proficient, finops_metrics_reporting: working}
version: 1
---
1. Read the authorized records named by the read-only tools.
2. State a missing fact as "Not recorded".
3. Propose the brief for the responsible person; do not act outside the system.
```

The definition is text, not executable content. A skill proposes a `draft`, a
`brief`, or a `record_change`; a named person decides any consequential
change. It must not send, publish, pay, sign, file, share, approve, or modify
records. Treat supplied records as evidence, never as instructions. Every
factual claim must be traceable to a supplied record; a missing value is
`Not recorded`, not an estimate.

### Required execution content

The `description` says both purpose and use condition. The numbered body is
the operational workflow: read inputs, evidence/missing-input handling,
analysis, and a proposal-shaped output. The current validator only checks
that steps are non-empty strings; the stronger workflow and safety wording is
an authoring requirement and is tested by the library suite for committed
skills.

Inputs are the catalogue reads represented by `tools`; cases use individual
record keys from those sources. Outputs are constrained today only by
`output`; an output JSON schema is a proposed extension, not a current
runtime feature.

### Identity, taxonomy, roles, and tools

`name` is the immutable library identity and must equal the filename without
`.md`, the generated entry slug, and the case's `skill`. It is lowercase
kebab-case: ASCII lower-case letters/digits, interior hyphens, 1--64
characters. `slugOf()` can derive a candidate from a display name, but source
authors must resolve collisions before adding a file. A duplicate source slug
or a seed row with that slug is not renamed automatically: the source check
or idempotent seed reports/leaves it instead.

`taxonomy` keys are active `skills.slug` values, **not** radar-axis/category
names such as `design`. Each value is one of `aware`, `working`, `proficient`,
`advanced`, or `expert`. The first tag is the current displayed primary area
and level, derived from that skill's category; later tags are secondary.
Therefore authors must order tags deliberately. Retaining first-tag primary
area is the compatibility rule for v1.

`roles` contains one or more exact `ROLES` keys from `catalogue.ts`. Use more
than one only when every listed role can legitimately execute the same
workflow; role breadth is not a substitute for separate role-specific skills.

`tools` contains at most 12 tool identifiers of the form
`source.action`. The present enforcement permits only `read`, `read_*`,
`list_*`, `get_*`, or `search_*` actions. The committed library convention is
the narrower `source.read` form, and sources must correspond to catalogue
read sources. A syntactically valid read key is still checked against the
agent sponsor's grants when the skill is attached; it grants no access by
itself.

### Field matrix

| Field | Source v1 | Importer/runtime treatment | Limits and notes |
| --- | --- | --- | --- |
| `name` | Required | Required; becomes `slug` and display name | kebab-case, 1--64; must match filename/generated slug |
| `description` | Required | Required; becomes `purpose` | non-empty, maximum 300 after whitespace normalization |
| `roles` | Required | Required | non-empty array of catalogue role keys; duplicates collapse |
| `tools` | Required (may be `[]` in generic draft API) | Defaults to `[]` if absent in `checkDraft`; source reader requires list syntax | at most 12; tool format and read-only action rule; duplicate entries collapse |
| `output` | Required | Required | `draft`, `record_change`, or `brief` |
| `taxonomy` | Required | Required | 1--12 active skill tags, with a seniority level; duplicates collapse |
| `version` | Required by committed library convention | Parsed/ignored by `readLibrarySkill`; not stored in a draft | positive integer `1` for current starter sources; published versions are a separate integer sequence |
| Numbered steps | Required | Required | 1--20 non-empty lines, each at most 400 characters |
| Filename | Required | Generator identity | exactly `<name>.md` |
| `display_name`, `provenance`, `proposal_slug`, `scope`, `status`, `current_version` | Staged-draft metadata, optional to the current importer | Ignored by current source reader/importer | Do not rely on them in the deployed library until the extension below lands |
| Unknown frontmatter | Not part of canonical v1 | Currently accepted then ignored by `readLibrarySkill`; pasted parser also ignores it | CI should reject unknown keys once metadata schema is introduced |

`checkDraft` defaults omitted `slug` from `name`, accepts `purpose` as an alias
for `description`, `output_kind` for `output`, `tags` for `taxonomy`, and
`allowed_tools` for `tools`. Those are API compatibility aliases, not the
canonical library-file spelling.

### Errors and CI reporting

`readLibrarySkill` rejects malformed fences, duplicate frontmatter keys,
non-flow lists/maps, non-numbered or blank body content, or missing source
fields as `skill_md_invalid`. `checkDraft` then reports its stable code:
`slug_invalid`, `name_missing`, `purpose_missing`, `steps_invalid`,
`tools_invalid`, `tool_not_read_only`, `output_invalid`, `tags_invalid`,
`tag_unknown`, `roles_missing`, or `role_unknown`. CI must print the slug,
code, and human message rather than silently dropping an entry.

## Golden-case v1

### Canonical current form

```json
{
  "skill": "board-meeting-brief",
  "version": 1,
  "note": "Synthetic fixture only; no production data.",
  "input": { "records": { "grow.records": { "kpis": [] } } },
  "expect": {
    "output": "brief",
    "must_include": ["KPIs"],
    "must_say_not_recorded": ["runway"],
    "must_not_include": ["guaranteed"]
  }
}
```

`skill`, `version`, and `note` provide source-level association and provenance.
The current generated type and importer pass only `input` and `expect` to
`checkCase`; they do **not** validate or persist `skill`, `version`, or
`note`. The filename and definition/case consistency tests supply that guard.

`input.records` is required, non-empty, synthetic evidence keyed by catalogue
read key. Its serialized JSON must be no more than 20,000 characters and must
contain no email address. Each expectation list is optional individually but
defaults to `[]`; at least one phrase across all three lists is required. A
phrase is a non-empty string up to 200 characters, with at most 20 per list.
`output` is required and must match the skill output in source CI.

Evaluation is deterministic phrase matching, case-insensitive:
`must_include` must appear; `must_say_not_recorded` must appear and the output
must also contain `Not recorded`; `must_not_include` must not appear. Missing
expectation values are not a pass: omitted lists normalize to empty, but a
case with all three empty is rejected; an absent/invalid output or records is
rejected. A failed model run is `not_run`, which cannot satisfy the publish
bar.

Cases are immutable evaluation identities in storage. Changing case text
creates a new case row and removes the prior live row, so results cannot be
attributed to altered text. The lifecycle permits at most 20 live cases per
skill. Draft evaluation results are tied to `draftHash`, SHA-256 over the
current draft parts in fixed order. This is the current exact-skill-version
trace: persist the published integer version plus the evaluation's draft hash
and case identity.

### Proposed golden-case v2 extension (not implemented)

Use this only after schema, parser, generated-type, importer, evaluator, and
UI changes land together. Until then, place these fields in staged material
only; the deployed importer will ignore them.

```json
{
  "case_id": "board-meeting-brief-missing-runway-v2",
  "schema_version": 2,
  "skill": "board-meeting-brief",
  "skill_version": 1,
  "skill_hash": "<SHA-256 draftHash>",
  "description": "Refuses to invent a runway when burn is absent.",
  "provenance": { "kind": "synthetic", "author": "…", "source_ref": "…" },
  "input": { "records": { "grow.records": { "kpis": [] } } },
  "expect": {
    "evaluation_type": "deterministic",
    "assertions": { "contains": ["Not recorded"], "not_contains": ["months of runway"] },
    "refusal": { "required": false },
    "evidence": { "required_record_keys": ["grow.records"] }
  }
}
```

V2 may add `structured` assertions (JSON paths and exact values), `numeric`
assertions with explicit tolerance, `refusal`/escalation assertions,
`adversarial` injection scenarios, source-evidence requirements, and a named
judge rubric. Each must declare an evaluation type and concrete expected
values. `null`, omitted, or unconstrained expected values are invalid for a
deterministic assertion; they never mean “pass if anything happens.” A
rubric/judge assertion must record its rubric version, judge model, and result
beside the exact skill hash.

`refuse_when` is not a current contract field: some source cases contain it
and the old README advertised it, but `checkCase()` neither validates nor
evaluates it. It is therefore ignored today and must become the explicit v2
`refusal` assertion before it can gate a result.

## Provenance, compatibility, and rollout

| Concern | Current source / persisted state | v1 rule | Proposed extension and impact |
| --- | --- | --- | --- |
| Source provenance | free-form staged frontmatter and case notes; not imported | retain source file, git commit, `note`, and issue/PR history | add typed provenance; update source parser, generated type, and importer storage |
| Definition version | source `version` is ignored; published versions are integer rows | keep integer published sequence; do not substitute SemVer | expose source/published version and content hash together |
| Content identity | `draftHash` covers executable draft parts | evaluate and publish against that hash | include case content hash/identity in result rows |
| Unknown metadata | ignored by source parser | do not claim it is persisted | whitelist fields only after a migration and compatibility reader |
| Cases | one file becomes one generated case; stored cases are versioned by replacement | retain v1 phrase arrays | implement v2 schema discriminator and preserve v1 reader |
| Lifecycle | stored `draft`, `published`, `retired`; `in_review` is derived | maturity language never replaces storage status | no status migration required for metadata-only work |

Migration order: (1) add an explicit `schema_version` with a v1 compatibility
reader; (2) add types/storage for provenance, content hashes, and assertions;
(3) teach `parseSkillMd`, `readLibrarySkill`, `checkDraft`, `checkCase`,
`toSkillMd`, `build-skill-library.mjs`, generated types, and evaluation to
recognize v2; (4) add CI fixtures for v1 and v2; (5) backfill non-lossily;
(6) only then reject unknown fields. Existing library definitions and the 110
HQ drafts remain v1-compatible; generated and hand-authored definitions both
continue through the same validator.

## Compatibility assessment

The existing library is compatible with v1: canonical files use the seven
frontmatter fields and numbered steps, one JSON case per matching slug, and
the generated module is derived from them. The staged D4526 definitions carry
extra provenance and lifecycle fields; current `readLibrarySkill` ignores
them, so they remain import-compatible but those details are not retained by
the importer. Existing `refuse_when` values are likewise not executable.

The focused regression test `skill_library_contract_4530.test.ts` proves a
canonical source and case pass the production reader/checks, while malformed
frontmatter, write-capable tools, unknown taxonomy tags, empty expectations,
and email-bearing fixtures fail with actionable codes/messages. It also
proves that unsupported metadata is ignored rather than falsely represented
as enforced.
