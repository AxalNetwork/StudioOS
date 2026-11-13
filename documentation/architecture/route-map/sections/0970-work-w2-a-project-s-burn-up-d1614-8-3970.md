### Work W2: a project's burn-up (D1614 §8, #3970)

- **Worker:** `GET /api/teams/project/:id/work/burnup?range=2w|1m|3m|max&from=&to=&filter=`, declared on `agent_engine.ts`'s router, with the engine's flag and read gate. Served by `services/agents/workBurnup.ts`.
- **Answer:** `{ available: true, range: { from, to, time_zone }, series }`. Each day is `{ day, scope, completed, open, not_planned, duplicate, completed_by: { person, agent, none } }`; a day before the first item is `{ day, available: false }`. A project with no item answers `{ available: false, range }`.
- **Refusals:** 400 `invalid_range` (an unknown range, half a custom range, from after to, more than 730 days); 403 `not_member`; 404 for an unknown project. A company path has no route: projects only.
- **Client:** `lib/api/work.js` (`workApi.burnup`); `pages/work/workAdapter.js`'s `burnup` goes through it.
