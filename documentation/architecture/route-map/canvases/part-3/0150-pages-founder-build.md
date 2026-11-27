| Pages · Founder Build | founder | `/build`, `/build/board`, `/build/roadmap`, `/build/kpi` | `FounderBuildDesk`, `FounderBuildBoard`, `FounderBuildRoadmap`, `FounderBuildKPI` | {backend} | UPGRADE | D548 (#1141): Review counts and cards read the stored `review` status with the same anatomy as other tasks. Movement history remains Not recorded (D510). The legacy execution URLs keep their existing editor/redirect behavior. **D661 (#1474):** a founder's `/build` is now the Build cycle overview and `/build/:module` its six module pages (`CycleRoute`, D662's read passed through); `?new=1` opens the create-a-startup form there. `FounderBuildDesk` is retired (deleted), and its four AI bands sit on Product roadmap and Operating systems. **Build canvases landed 2026-11-26 (D8773 to D8776, #8773 to #8776), not built:** the Lovable handoff's outgoing prompt, alias and privacy wording (D8773); account, company and project connector scope with the repair route (D8774); a validated feature through must-have, prototype and test to Pitch evidence (D8775); the Now/Next/Later shortcut and the `/build/roadmap` view it opens (D8776). |

backend:
- `founder_board.ts`
- `pipeline.ts`
- `progress.ts`
