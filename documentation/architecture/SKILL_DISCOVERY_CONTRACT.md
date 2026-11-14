# Skill discovery: the recommendation contract (D4538, #4538)

This is the request and response a task-to-skill recommendation uses. It describes what the ranker must return, not a built route: no route serves it yet. The decision behind it, and the company-extension model, are in `decisions/D4538.md`. The labelled query set that measures it is in `skill-discovery/queries.v1.json`.

The gate and ranking stages 1 to 3 are built as a pure service, `cloudflare-worker/src/services/agents/skillDiscovery.ts`. Its relevance method and measured numbers are in `decisions/D4538-p4.md`.

Discovery is a **hard eligibility gate first, then ranking**. Eligibility is never a low score: a skill the requesting agent cannot run is never a candidate. Nothing here attaches a skill; attaching stays the existing, separately authorised action (`PUT /api/teams/agents/:uid/skills`, through `attachCheck`).

## Request

```jsonc
{
  "task": "Tell me how many months of runway we have left",   // plain language, 1–500 characters
  "output_kind": "brief",              // optional: 'brief' | 'draft' | 'record_change'
  "agent_uid": "…32 hex…",              // the agent the skill would run on; its role, scope and grants are read server-side
  "taxonomy_focus": ["finance_cash"],   // optional, at most 3 taxonomy slugs
  "workflow_context": null,             // reserved for #4535: a workflow step's identity once it is stable
  "limit": 5                            // 1–10, default 5
}
```

- **Minimum context.** The request carries the task text and the agent's identity, never company records, connector payloads or secrets.
- **Role, scope and grants are read server-side.** The agent's role, its company or project, and its `tool_grants_json` come from the agent row (`agentByUid`), never from the client, so a caller cannot claim tools the agent does not have.
- **Who may ask.** Only someone who can manage the agent (`canManage`, as for changing its skills). Anyone else gets a 404, as for reading another company's agent.

## The eligibility gate

Every catalogue skill is checked against the agent before anything is ranked. These codes are `attachCheck`'s (`services/agents/skillLinks.ts`), plus three discovery adds:

| Code | When | Source |
|---|---|---|
| `not_found` | A draft the caller may not read, or another company's skill | `attachCheck`, the read gate |
| `version_not_published` | No published version | `attachCheck` |
| `skill_retired` | Retired | `attachCheck` |
| `skill_suspended` | Suspended by HQ (D4161, D4534) | `attachCheck` / `skillRunRefusal` |
| `role_mismatch` | The current version does not list the agent's role | `attachCheck` |
| `tool_not_approved` | A tool of the current version is not in the agent's grants, with `{ tool }` | `attachCheck` |
| `output_mismatch` | `output_kind` was asked for, and the skill produces another | discovery |
| `input_unavailable` | #4667 reports the skill's inputs cannot be read for this scope | discovery, once #4667 lands |
| `not_runnable` | #4534's execution contract refuses the skill for this agent | discovery, once wired |

A skill that fails is never in `candidates`. It may be listed in `blocked` with its code, so the operator sees why ("Cash runway snapshot needs Mercury, which this agent is not granted"). Another company's skill is never listed anywhere, not even as blocked: naming it would disclose it.

## Ranking (over eligible skills only)

Stages run in this order. Each reports what it used, and a stage with no source says so instead of contributing a number.

1. **Role and taxonomy fit.** The agent's role among the version's roles (already required by the gate), and the overlap of the version's taxonomy tags with `taxonomy_focus` and the task's inferred areas.
2. **Task relevance.** Semantic match of `task` against the skill's name, purpose and steps.
3. **Input and output compatibility.** The asked-for output kind, and the inputs the skill reads against what the scope records.
4. **Quality evidence.** The release evidence (D4533) and the current version's golden-case results, with their freshness. **Not recorded** until #4533 and #4588 supply them.
5. **Operational evidence.** Measured runs, failure, latency and cost. **Not recorded** until #4536 measures them. Use count is reported as adoption, never as quality.

## Response

```jsonc
{
  "outcome": "recommend",            // 'recommend' | 'ambiguous' | 'no_suitable_skill'
  "candidates": [
    {
      "skill_uid": "…", "name": "Cash runway snapshot", "version": 3,
      "reasons": [
        { "signal": "task", "text": "The task asks for runway; the skill reports runway from recorded balances and burn." },
        { "signal": "role", "text": "Listed for cfo." }
      ],
      "fit": { "role": true, "taxonomy": ["finance_cash"] },
      "missing": [],                  // inputs or tools not available; empty for a candidate (the gate removed the rest)
      "evaluation": { "available": false, "reason": "Release evidence is not read by discovery yet (#4533)." },
      "operational": { "available": false, "reason": "Runs are not measured yet (#4536)." },
      "confidence": "high",          // 'high' | 'medium' | 'low'
      "uncertainty": null             // why, when confidence is not high
    }
  ],
  "blocked": [
    { "skill_uid": "…", "name": "Board meeting brief", "code": "tool_not_approved", "tool": { "key": "compliance.read", "label": "Compliance" } }
  ],
  "clarify": null,                    // on 'ambiguous': the question that would separate the candidates
  "abstain_reason": null              // on 'no_suitable_skill': why, in a sentence
}
```

- **`no_suitable_skill`** is returned when no eligible skill fits the task well enough, and also when the request is for something no read-only skill can do, such as sending an email. It is a result, not an error.
- **`ambiguous`** returns its candidates with `confidence: "low"` and a `clarify` question. It never silently picks one.
- **Exact versions.** `version` is the published version an attach would pin. A recommendation never names a draft.
- **Never shown as zero.** Every evidence block is `{ available: false, reason }` until its source exists.

## Measuring it

`skill-discovery/queries.v1.json` labels each scenario's `relevant` skills (best first), `acceptable` ones, `must_not_return` ones (with their gate code), and abstentions. A ranker is measured on:

- precision@k and recall where labels exist;
- rank of the first relevant skill;
- the **ineligible-recommendation rate**, which must be **zero**: any `must_not_return` skill in `candidates` fails the run;
- abstention quality: `no_suitable_skill` exactly where the label abstains.

The human relevance labels and the deterministic gate are kept apart: `cloudflare-worker/test/skill_discovery_queries_4538.test.ts` checks the labels against the gate, and a ranker's quality is measured against the labels.
