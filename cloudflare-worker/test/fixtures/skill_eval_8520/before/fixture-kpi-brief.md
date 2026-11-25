---
name: fixture-kpi-brief
description: A synthetic skill for D8520's fixture; it briefs two recorded KPIs.
roles: [ceo]
tools: [grow.read, stripe.read]
output: brief
taxonomy: {finops_metrics_reporting: working}
version: 1
---
1. Read the recorded KPIs (`grow.read`) and the recorded revenue (`stripe.read`).
2. A KPI with no value reads "Not recorded", never 0.
3. Propose the brief. It changes no record.
