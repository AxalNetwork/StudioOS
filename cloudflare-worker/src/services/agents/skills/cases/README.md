# `services/agents/skills/cases/` — golden cases (#3953, D1612)

One case per starter skill, named `<slug>.json` after the skill in `../`. Part D
(#3954) runs each skill on its case and checks the proposal.

```
{
  "skill": "<slug>", "version": 1, "note": "…",
  "input":  { "records": { "<catalogue read key>": … } },
  "expect": { "output": "draft | record_change | brief",
              "must_include": [ … ], "must_say_not_recorded": [ … ], "must_not_include": [ … ],
              "numbers": [ { "metric": "DPI", "value": 0.2, "unit": "x", "tolerance": 0.005 } ],
              "structure": { "sections": [ "Summary", "Risks" ], "ordered": true, "form": "list | table" },
              "evidence": { "cite": [ "<read key>", "<read key>.<key>.<index>" ] },
              "refusal": { "mode": "ask_for_input | decline | not_recorded | none", "subject": "consent" },
              "claims": { "required": [ { "subject": "scheduling", "object": "bottleneck" } ], "forbidden": [ … ] },
              "output_schema": { "format": "json", "schema": { "type": "object", "required": [ … ], "properties": { … } } } }
}
```

`numbers` is optional (#4531). `must_say_not_recorded` is judged per field: the
field and "Not recorded" in the same line, sentence, list item or table row.
`structure`, `evidence`, `refusal`, `claims` and `output_schema` are optional
too (#4531 slice 2, judge version 3; a claim's `because` and `conditional`,
D4531 part 4, judge version 4); each accepts only its documented forms,
and a malformed one refuses the case. A skill whose case asserts citations,
headings or JSON says that form in its own steps: the evaluation prompt does
not. The full rules are in `documentation/architecture/SKILL_LIBRARY_CONTRACT.md`.

**Rules.** Every record is made up. A case feeds only reads its skill is given
(the read key's source is one of the skill's `tools`). No email address appears
anywhere. `cloudflare-worker/test/agent_skill_library_d1612.test.ts` checks it.

`refuse_when` is not part of the case format. It appears in one historical
fixture (`customer-interview-summary.json`), is dropped by `checkCase()`, and
CI warns that it proves nothing. A refusal is asserted with `refusal` instead.
