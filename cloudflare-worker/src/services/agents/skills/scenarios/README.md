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
- **Identities are stable.** `case_id` is unique, starts with the slug, and keeps its meaning; changing a case's text bumps its `revision`. `name` is unique too, because the importer dedupes cases by name.
- **Staged is not enforced.** An expectation no assertion can check yet goes in `staged`, with the reason.
- **Not imported yet.** The generator and the seed read `cases/` only. Packaging these into the store waits on #4531 and #4532 (D4588 §3).

`cloudflare-worker/test/skill_scenarios_4588.test.ts` checks all of this.
