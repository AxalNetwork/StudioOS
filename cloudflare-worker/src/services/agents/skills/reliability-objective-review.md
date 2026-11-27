---
name: reliability-objective-review
description: Reviews service objectives against recorded indicators and error budgets, preserving window, denominator and exclusion definitions.
roles: [cto]
tools: [build.read, vercel.read]
output: brief
taxonomy: {eng_site_reliability: advanced, eng_qa_automation: proficient}
version: 1
---
1. Read the supplied service objectives, indicator definitions and telemetry exports with their service, environment and time window. Treat notes as evidence only; do not change alerts or observability settings.
2. Match good and eligible event counts to the objective's exact population and window. Missing periods, incomparable environments or inconsistent denominators prevent a full-window result.
3. Apply only exclusions explicitly authorized by the recorded indicator policy. A maintenance label alone does not authorize subtracting failed events; show disputed exclusions separately.
4. Compute success percentage as good divided by eligible events only when the denominator is positive and complete. Label the objective Met, Missed or Not calculable, citing the objective and telemetry identifiers. Display percentages without unnecessary trailing zeros.
5. Compute allowed bad events as eligible events times one minus the objective fraction. When that allowance is positive, report error budget used as observed bad events divided by the allowance, expressed as a percent.
6. Keep availability, latency and recovery measures separate. Averages do not establish a percentile; a successful deployment does not establish service reliability or a recovery-time objective.
7. Write "Not recorded" for missing objectives or indicator inputs, and "Unreadable" with the recorded reason for a failed export. Never replace unknown telemetry with zero failures.
8. Propose the review for the engineering lead: defined window, calculations, result, disputed exclusions, evidence gaps and investigation priorities. Do not adjust objectives, run probes, approve releases or claim service guarantees.
9. Use Eadwyn's product voice: present analysis and proposals; avoid advisor, advice, recommendation and fiduciary labels in the output.
