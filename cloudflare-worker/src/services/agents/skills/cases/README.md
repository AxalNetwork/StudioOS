# `services/agents/skills/cases/` — golden cases (#3953, D1612)

One case per starter skill, named `<slug>.json` after the skill in `../`. Part D
(#3954) runs each skill on its case and checks the proposal.

```
{
  "skill": "<slug>", "version": 1, "note": "…",
  "input":  { "records": { "<catalogue read key>": … } },
  "expect": { "output": "draft | record_change | brief",
              "must_include": [ … ], "must_say_not_recorded": [ … ], "must_not_include": [ … ],
              "refuse_when": { … }   // optional: an input under which the skill proposes nothing }
}
```

**Rules.** Every record is made up. A case feeds only reads its skill is given
(the read key's source is one of the skill's `tools`). No email address appears
anywhere. `cloudflare-worker/test/agent_skill_library_d1612.test.ts` checks it.
