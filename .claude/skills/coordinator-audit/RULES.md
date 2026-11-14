# Coordinator audit rules

What `workflow.js` asks for and what `scripts/lib/coordinator.mjs` enforces.
When AGENTS.md and this file disagree, AGENTS.md wins; fix this file.

## Verdicts

| Verdict | Means | What changes |
|---|---|---|
| `close_done` | Every acceptance criterion is on main; for a tracker, every child is closed or its objective is met | Closed as completed, only if the verifier says `safe_to_close` |
| `close_superseded` | Another issue or decision replaced it | Closed as not planned, only if the verifier agrees |
| `release_to_ready` | Labelled blocked or stale, nothing blocks it now | `state:ready`; drops `needs-design` and `needs-decision` |
| `keep_blocked_on_owner` | Only the owner's call or action blocks it | `state:blocked` + `needs-decision`, with a lettered question and a pick |
| `keep_blocked_on_dependency` | A named open issue or PR blocks it | `state:blocked`; the note names the blocker |
| `keep_blocked_on_design` | Waits for a canvas not in `design/incoming/` | `state:blocked` + `needs-design` |
| `needs_status_fix` | Labels contradict the facts | The label change the verifier accepted |
| `split_or_rescope` | Partly done | Child tasks for the unfiled pieces, one comment on the parent |
| `keep_as_is` | Correct and moving | Nothing, and no note unless there is something to add |

"Part of #N" PRs never finish an issue on their own.

## Labels

From AGENTS.md § Task protocol:

- Exactly one `state:` label: `ready`, `in-progress`, `blocked` or `review`. There is no `state:in-review`.
- `needs-decision` and `needs-design` only with `state:blocked`.
- `state:review` only while a PR for the issue is open. Merged work that waits on the owner's live check is `state:blocked` + `needs-decision`.
- Slots are `slot:S01` to `slot:S37` (AGENTS.md § Slots).

Coordinator conventions (D6312; not in AGENTS.md, and AGENTS.md wins if they ever disagree):
- Merged work that waits only on the owner's live check is `state:blocked` + `needs-decision`, not `state:review`.
- A lower-case `slot:s38` or `slot:s39` is folded into the issue's new slot when it moves; never create one.

## Slots (coordinator conventions, D6312)

- `S01` keeps trackers, owner-only steps, design briefs and owner decisions. No build task stays on S01.
- A new build task goes to the least-loaded slot among S02 to S37, never `S18` or `S32` (both carry programmes). Ties go to the lower number.
- Moving an issue that is `state:in-progress` with recent activity needs the owner's word; release only stale claims (no update in 3 days and no open PR).

## Notes

- A note starts with `S1:` and ends with the run marker. It says what was checked (main's sha), what is on main, what is left, what it waits on, the next step, any owner question, and the labels changed.
- Every note was checked by a second agent. A claim the verifier could not support is not posted.
- An issue that moved after the snapshot gets no note in this run.

## Page groups for a full audit

Founder: `/validate` (Overview, problem-discovery, customer-research, ideal-customer-profile, market-intelligence, demand-signals, experiments, verdict), `/build` (Overview, operating-systems, solution-design, prototype-mvp, product-roadmap, founding-team, company-creation), `/raise` (Overview, evidence, capital-relationships and its calls, fundraising-readiness, investor-narrative, pitch, data-room, cap-table, use-of-funds), `/grow` (Overview, reporting, product-improvement, distribution, revenue-and-traction, team-expansion, partner-network, market-expansion, durable-company-building). Three to five pages per group.

Investor: map the investor navigation first (`frontend/src/sidebarConfig.js`, `frontend/src/lib/personaViewModel.js`), then group Deals, the deal page tabs, Portfolio, Funds, Network, Research, Due diligence and the Studio home and Spin-Out Lab investor pages the same way.
