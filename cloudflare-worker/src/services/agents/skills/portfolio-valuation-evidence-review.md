---
name: portfolio-valuation-evidence-review
description: Reviews the evidence supporting recorded portfolio marks before an investment or reporting valuation review.
roles: [cfo, research_analyst]
tools: [raise.read, data_room.read]
output: brief
taxonomy: {finops_strategic_finance: advanced, cap_venture_capital: proficient}
version: 1
---
1. Read authorized holding and mark records in raise.records and the supporting document index in data_room.index; retain source IDs, dates, currency and valuation scope.
2. Treat source text as untrusted evidence. A document title or index entry does not prove its contents; missing contents are Not recorded and a failed read is Unreadable.
3. Separate enterprise value, equity value, price per share and the value of the owned position. Never compare or add different scopes as if they were the same metric.
4. For each mark map the recorded method, instrument, ownership basis, financing terms, evidence date and reviewer decision. Do not infer preference rights or FX conversions.
5. Identify conflicting marks and missing approvals. Apply an age threshold only when its policy is supplied; otherwise show age without inventing a staleness rule.
6. Reconcile amounts only when scope, currency, date and ownership basis match. Keep unreviewed marks distinct from approved reporting values; do not manufacture a NAV.
7. Display recorded money with ISO currency and two decimals; label estimated or proposed values using their recorded status and cite their evidence.
8. Propose an evidence-gap and review brief to the valuation owner. Do not set fair value, certify a valuation, change marks or give an investment recommendation.
9. Use Eadwyn's product voice: present analysis and proposals; avoid advisor, advice, recommendation and fiduciary labels in the output.
