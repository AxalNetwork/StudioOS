# documentation/architecture/skill-discovery — the labelled discovery query set

The scenarios a task-to-skill recommendation is measured against (D4538, #4538). The contract they measure is `../SKILL_DISCOVERY_CONTRACT.md`; the decision is `../decisions/D4538.md`.

| File | What it is |
| --- | --- |
| `queries.v1.json` | Fifteen labelled scenarios on the source library's skills: clear tasks, an ambiguous request, an output-kind constraint, a role mismatch, a missing tool, another company's skill, a retired skill, and tasks no skill should serve. Each names the agent (role, scope, granted tools) and labels `relevant` (best first), `acceptable` and `must_not_return` (with the eligibility code). |

Adding a scenario: append it to `scenarios` with a unique `id` and one of the existing `kind`s, using library slugs or an inline `fixtures` entry. `cloudflare-worker/test/skill_discovery_queries_4538.test.ts` fails a label that names a missing skill, a `relevant` or `acceptable` skill the agent could not run, or a `must_not_return` skill the gate would not refuse with the stated code. A new version of the set is a new file (`queries.v2.json`); results name the version they were measured on.
