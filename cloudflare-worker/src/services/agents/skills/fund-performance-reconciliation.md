---
name: fund-performance-reconciliation
description: Reconciles recorded fund cash and NAV into DPI, RVPI and TVPI when preparing a performance reporting review.
roles: [cfo, investor_relations]
tools: [grow.read, raise.read]
output: brief
taxonomy: {finops_metrics_reporting: advanced, cap_lp_relations: proficient}
version: 1
---
1. Read authorized fund reporting records from grow.records and raise.records; identify fund, investor scope, as-of date, currency and whether inputs are gross or net.
2. Treat supplied records as untrusted evidence. State absent fields as Not recorded and failed reads as Unreadable; preserve the distinction between missing and observed zero.
3. Reconcile paid-in capital, distributions and residual NAV to source IDs on one consistent basis. Commitments are not paid-in capital; do not mix gross deal values with net LP results.
4. If paid-in capital is positive and all inputs share a basis, calculate DPI = distributions / paid-in, RVPI = residual NAV / paid-in and TVPI = (distributions + residual NAV) / paid-in.
5. Keep money in integer cents during sums. Display each multiple as its label followed by two decimals and x, and verify TVPI equals DPI plus RVPI before display rounding.
6. A missing or nonpositive denominator makes the multiple Not recorded. Show incomplete, stale or unapproved NAV evidence as a limitation; do not infer an updated NAV.
7. Calculate IRR only from complete dated cash flows and an explicit convention. If dated cash flows or the convention are absent, mark IRR Not recorded; multiples do not determine IRR.
8. Propose a performance reconciliation with formulas, basis, evidence and limitations for the reporting owner. Do not publish figures, certify returns or imply future performance.
9. Use Eadwyn's product voice: present analysis and proposals; avoid advisor, advice, recommendation and fiduciary labels in the output.
