# `services/agents/skills/` — the Axal starter skill library (#3953, D1612)

HQ skills an agent can be given, each one SKILL.md file named by its slug, in
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

## Rules for adding a skill

- **Reads only.** Every tool ends in `.read` and names a source the catalogue
  grants (`READ_KEYS`: `stripe.read` is `stripe.revenue`'s source). A skill
  proposes; no step sends, publishes, approves, pays, signs, files or shares.
- **Never invent a figure.** A figure the skill did not read is written "Not
  recorded", never estimated, never carried over.
- **People by name, never by email.** No address in a skill or a case.
- **Text, not HTML,** under 32 KB. A1 parses it as data and never executes it.
- **One case per skill**, fed only from reads the skill is given.
- `cloudflare-worker/test/agent_skill_library_d1612.test.ts` checks all of this.
