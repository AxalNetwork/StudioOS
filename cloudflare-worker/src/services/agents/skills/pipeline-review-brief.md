---
name: pipeline-review-brief
description: Prepares the weekly pipeline review: deals by stage, what moved, what stalled and what has no next step.
roles: [sales, ceo]
tools: [grow.read]
output: brief
taxonomy: {gtm_pipeline_mgmt: proficient, gtm_sales_ops: working}
version: 1
---
1. Read the open deals, their stages, values and last activity (`grow.read`).
2. List the deals that moved stage this week and those with no activity in 14 days.
3. Total the pipeline by stage; a deal with no recorded value counts in the number of deals, not in the total.
4. Write "Not recorded" for a deal with no next step.
5. Propose the brief to the sales lead.
