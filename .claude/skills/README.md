# .claude/skills — project skills for agent sessions

Each folder is one skill: a `SKILL.md` whose front matter says when to use it,
plus the files it reads. Claude Code loads them for sessions in this repository.

| Skill | For | Code it runs |
|---|---|---|
| `coordinator-audit/` | Session 1's backlog audit: triage, verified notes and labels, closes, new tasks, the weekly delta (D6312) | `scripts/coordinator.mjs`, `scripts/lib/coordinator.mjs`, `coordinator-audit/workflow.js` |
| `land-canvas/` | Committing an owner-approved Claude Design canvas into `design/incoming/` and releasing the issues that waited on it (D6312) | `scripts/land-canvas.mjs` |
| `design-brief/` | Turning a `needs-design` issue into a copy-paste Claude Design prompt grounded in what the platform records (D6312) | none |

A skill describes how to do a job here; the rules it follows still live in
`AGENTS.md` and `CLAUDE.md`, and win when they disagree. A skill never merges,
approves, force-pushes or edits `main`.
