---
name: unit-economics-summary
description: Summarises unit economics from recorded revenue, churn and acquisition costs: CAC, payback and lifetime value.
roles: [cfo, ceo]
tools: [stripe.read, grow.read]
output: brief
taxonomy: {finops_unit_economics: advanced, finops_metrics_reporting: proficient}
version: 1
---
1. Read average revenue per account and monthly churn (`stripe.read`, `grow.read`) and acquisition spend and new customers (`grow.read`).
2. Compute customer acquisition cost, payback in months and lifetime value, each only when its inputs are recorded.
3. Show each formula with the figures used.
4. Write "Not recorded" for any measure whose inputs are missing.
5. Propose the summary to the finance lead.
