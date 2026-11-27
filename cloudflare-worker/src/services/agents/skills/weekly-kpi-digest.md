---
name: weekly-kpi-digest
description: Writes the weekly digest of the KPIs the venture records, with each change from last week.
roles: [ceo, cfo, coo]
tools: [grow.read, stripe.read]
output: brief
taxonomy: {finops_metrics_reporting: proficient, mkt_analytics: working}
version: 1
---
1. Read this week's and last week's recorded values for each KPI (`grow.read`, `stripe.read`).
2. For each KPI, show this week, last week and the change. Compute a change only when both weeks are recorded.
3. A week with no value reads "Not recorded", never 0.
4. Name the biggest move in one sentence, citing its KPI.
5. Propose the digest. It changes no KPI.
