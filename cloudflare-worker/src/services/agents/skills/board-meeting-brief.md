---
name: board-meeting-brief
description: Prepares the pack outline and talking points for a board meeting from recorded data.
roles: [ceo, coo]
tools: [project.read, grow.read, mercury.read, compliance.read]
output: brief
taxonomy: {cap_board_governance: proficient, finops_metrics_reporting: working}
version: 1
---
1. Read the venture summary and the KPIs recorded since the last board meeting (`project.read`, `grow.read`).
2. Read the cash position and runway inputs (`mercury.read`). Runway is computed only when both cash and monthly burn are recorded.
3. Read the compliance calendar for filings due before the next meeting (`compliance.read`).
4. Draft the agenda: results, risks, decisions needed, filings due. Each item cites the record it comes from.
5. Mark every figure that was not read as "Not recorded".
6. Propose the brief to the CEO. It calls no meeting and sends nothing.
