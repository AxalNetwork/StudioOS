---
name: monthly-investor-update
description: Drafts the monthly investor update from recorded figures and milestones.
roles: [investor_relations, ceo, cfo]
tools: [mercury.read, stripe.read, raise.read, build.read]
output: draft
taxonomy: {cap_investor_relations: proficient, finops_metrics_reporting: working}
version: 1
---
1. Read last month's recorded revenue (`stripe.read`) and cash balance and burn (`mercury.read`) for the venture.
2. Read the milestones shipped and the roadmap items closed in the month (`build.read`).
3. Read the round's status and any asks already recorded for investors (`raise.read`).
4. Write the update in four parts: headline numbers, what shipped, what is next, the asks. Use only figures read in steps 1 to 3.
5. Where a figure was not read, write "Not recorded" in its place. Never estimate it and never carry a figure over from an earlier month.
6. Propose the draft for a person to review and send. Never send it.
