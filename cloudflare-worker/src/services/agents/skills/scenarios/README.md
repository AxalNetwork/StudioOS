# `services/agents/skills/scenarios/` — qualification scenarios (#4588, D4588)

One pack per skill, `<slug>.json`, for the ten skills #4588 qualifies. Each
pack holds 5 to 10 scenarios chosen for that skill's failure modes: complete
evidence, missing or stale inputs, contradictory records, a task-specific edge
case and an instruction embedded in the evidence.

```
{
  "skill": "<slug>", "pack_revision": 1, "note": "…",
  "scenarios": [{
    "case_id": "<slug>-<scenario>", "revision": 1,
    "name": "<unique case name>", "covers": "<what this scenario tests>",
    "input":  { "records": { "<catalogue read key>": … } },
    "expect": { …the golden-case expect, as the golden cases define it… },
    "outputs": {
      "correct":   "<an output that must pass>",
      "incorrect": [{ "targets": "<the assertion it must fail>", "edit": [["<text in correct>", "<replacement>"]] }]
    },
    "staged": [{ "assertion": "…", "reason": "…" }]
  }]
}
```

An incorrect output is the correct one with its `edit`s applied (each edit's
text occurs exactly once), or a whole `text`. It must fail, and `judge()`'s
detail must name its `targets`.

## Rules

- **Every record is made up.** No email address, no real person or company.
- **Declared reads only.** A case's read keys are catalogue reads its skill's `tools` grant.
- **Every assertion is caught.** Each assertion in `expect` has at least one incorrect output that fails on it.
- **Identities are stable.** `case_id` is unique, starts with the slug, and keeps its meaning; changing a case's text bumps its `revision`. The stored case's identity is `<case_id>:r<revision>` (D5336). `name` is unique too, and is the stored case's name.
- **Staged is not enforced.** An expectation no assertion can check yet goes in `staged`, with the reason.
- **Imported as cases (D5336).** The generator embeds each scenario beside the skill's golden case; the seed adds it to the skill's draft as its own case when no live case has its identity, and never edits one. A skill holds at most 20 live cases, so a pack holds at most 19.

`cloudflare-worker/test/skill_scenarios_4588.test.ts` and the CI gate (`scripts/check-skill-library.mjs`, rules in `skillScenarios.ts`) check all of this; `skill_case_identity_5336.test.ts` follows every scenario from this folder to a stored case.
