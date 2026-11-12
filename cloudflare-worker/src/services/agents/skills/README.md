# `services/agents/skills/` — the "From Axal" skill library (#3953, D1612; #4225, D4225)

HQ skill definitions an agent can be given, ten or more in each of the eight
areas (a skill's area and level are those of its first taxonomy tag), each one SKILL.md file named by its slug, in
the format #3951 fixes:

```
---
name: <slug>
description: <one line>
roles: [<role keys from ../catalogue.ts>]
tools: [<source>.read, …]
output: draft | record_change | brief
taxonomy: {<skills.slug from migration 090>: aware | working | proficient | advanced | expert}
version: 1
---
1. <step>
```

`cases/` holds one golden evaluation case per skill (`cases/<slug>.json`): the
input records, keyed by catalogue read key, and what the proposal must say, must
say is "Not recorded", and must never say. Part D (#3954) runs them.

`scenarios/` holds the qualification scenarios for the first ten skills (#4588,
D4588): 5 to 10 cases per skill, each with a known-correct output and targeted
incorrect outputs. Since D5336 the generator embeds them beside the golden
case and the seed imports each as its own case, by `case_id` + `revision`;
`cases/` stays the one golden case per skill.

## Rules for adding a skill

- **Reads only.** Every tool ends in `.read` and names a source the catalogue
  grants (`READ_KEYS`: `stripe.read` is `stripe.revenue`'s source). A skill
  proposes; no step sends, publishes, approves, pays, signs, files or shares.
- **Never invent a figure.** A figure the skill did not read is written "Not
  recorded", never estimated, never carried over.
- **People by name, never by email.** No address in a skill or a case.
- **Text, not HTML,** under 32 KB. A1 parses it as data and never executes it.
- **One golden case per skill**, plus an optional scenario pack, fed only from
  reads the skill is given; at most 20 cases in all.
- `cloudflare-worker/test/agent_skill_library_d1612.test.ts` checks all of this.

## How the library reaches the store (D4225)

The Worker reads no file at run time. `node scripts/build-skill-library.mjs`
embeds every file here in `../skillLibrary.generated.ts`, which is never edited
by hand and never committed (D5612): it is gitignored, and
`scripts/build-generated.mjs` writes it before every build, typecheck and test.

`POST /api/admin/ai-agents/skills/library/seed { reason }` (Super Admin) creates
each skill not yet in the store as an Axal **draft** with its golden case. It
publishes nothing: each draft goes through D4160's review, evals and publish.
Running it again creates nothing. `skill_library_seed_d4225.test.ts` checks it.
