## HQ › AI agents — the control panel (D4137, #4137)

`/hq/ai-agents` and its sub-paths, Super Admin only (`hqOnly`), from
`design/incoming/HQ AI Agents Page.dc.html` (SA0–SA9). A sidebar row after
Platform.

| Address | Board | Backend today |
| --- | --- | --- |
| `/hq/ai-agents` | SA0 Overview | "Skills published" from `GET /api/teams/skills`; the other tiles wait for H5 (#4163) and read "Not recorded". |
| `/hq/ai-agents/roster`, `/roster/:agent` | SA1, SA2 | None yet: H1 (#4158), after #4117's persona catalogue. |
| `/hq/ai-agents/skills` | SA3 From Axal | `GET /api/teams/skills` (D1612 A1), the `hq` list. Bulk actions, golden cases and review wait for H2 (#4160). |
| `/hq/ai-agents/skills/:skillUid/edit` | SA4 | The skill's read view from the same list; the editor and review wait for H2 (#4160). |
| `/hq/ai-agents/skills/companies` | SA5 | None yet: H3 (#4161). |
| `/hq/ai-agents/operations`, `/spend`, `/audit` | SA7, SA7b, SA8 | None yet: H5 (#4163). Spend links to Platform › AI usage. |
| `/hq/ai-agents/operations/policies` | SA6, SA6b | None yet: H4 (#4162). The kill switch's button stays disabled until the runtime obeys it. |
