# frontend/src/lib/api — one file per new API domain

`../api.js` is the SPA's client for the Worker. It is also the file most likely
to conflict: on `main` from 2 August to 3 October 2026 it changed in 113 of
624 commits, because every new client method landed at the bottom of it. From
D527 on, a **new** API domain gets its own module here instead.

Existing methods stay in `api.js`. 147 tests and scripts read that file by
path, so moving code out of it is a separate decision, not a side effect of
adding a domain.

## Adding a domain

1. Create one module here for the domain, named in camelCase, as
   `communityTasks.js` is. Export the client object the way `api.js` does
   today, and call the Worker through `request` from `api.js`:

   ```js
   import { request } from '../api.js';

   export const communityTasksApi = {
     list: () => request('/community-tasks'),
   };
   ```

   Call `request` only inside method bodies, never at the top level of the
   module: `api.js` re-exports this file, so the two import each other, and a
   top-level call would run before `request` is defined.

2. Add ONE line to the re-export block near the top of `api.js`, between
   `// api-modules:begin` and `// api-modules:end`, in alphabetical order. For
   the module above, it is `export * from './api/communityTasks.js';`.

   The block sits under the imports, away from the end of the file where other
   pull requests append, so two new domains touch two different lines.

3. Pick export names that `api.js` does not already use. With `export *`, a
   name `api.js` declares itself wins and the module's export is silently
   hidden.

## What checks it

`scripts/check-api-drift.mjs` (run by `npm run test:drift`) reads `api.js` and
every module here. A `request()` in a module must match a mounted Worker
route exactly as one in `api.js` must, and the check fails if the re-export
block does not name exactly the files in this folder, one well-formed line
each, in alphabetical order. The rules themselves live in
`scripts/lib/apiModules.mjs` and are tested by
`scripts/lib/apiModules.test.mjs`. The Worker's own drift tests
(`cloudflare-worker/test/api_drift.test.*`) read this folder too.

D647: `contracts.js` calls the mounted admin_contracts publication, guided
preview/send, provider, counted picker, recorded agreement/stat, history and
signed-PDF endpoints. Binary PDFs are returned as authenticated JSON/base64
through the shared request client; callers create and revoke temporary blob URLs.

D652 (#1464): `eadwyn.js` calls `/api/eadwyn`, the Worker AI rail's conversations
and the connectors in them. D701 (#1663) adds `conversationsMine`
(`GET /api/eadwyn/conversations/mine`): the caller's rail conversations and
their one profiling conversation, for the Conversations list on Studio's phone
page.

D699: `companySheet.js` records the signed-in member's last opened company cycle through `PUT /api/company/visits`.

D659 (#1472): `cycleValidate.js` calls `/api/cycles/validate`: the overview,
one module's card and records, the Lab market page's three stored checks, and
the manual writes for migration 440's records. Every call names the project
with `?project=`.

D661 (#1474): `cycles.js` reads the four cycle pages (`/api/cycles/:cycle/overview`
and `/modules/:slug`). `cycleWrites.js` is the write table behind their Add and Edit forms,
a factory over `request` so the contract test can run it against the real Worker
routes; `cycles.js` binds it to the app's client as `cyclesWrite`. Its one
`formOptions(cycle, projectId, slug, query?)` reads a module's form choices from
D690's `GET /api/cycles/:cycle/modules/:slug/form-options?project=N` for every
cycle, `query` (a search's `{ q }`) after `project` (D695 decision 16); it sends
only a known cycle and a module slug's charset.

D696 (#1658): `cyclesApi.record`, `recordActivity` and `recordAction` call
D690’s mounted `/api/cycles/:cycle/modules/:slug/records/:id`, its `/activity`
read and `/actions/:key` POST. All carry `?project=`, activity carries `page`,
path segments are encoded, and an unwired cycle is refused before a request.
JSON action bodies are serialized; multipart `FormData` is passed unchanged.

D693 (#1704): `verdict.js` holds `verdictApi.record`, Record a decision's
`POST /api/cycles/validate/decisions?project=N`. The Decisions table is the
module read and commitments go through the record's action route, so it holds
nothing else.

D653: `roundCalls.js` calls the mounted `/api/round-calls` domain for availability, real planner context, draft/audience, counsel review, send, responses and management. It uses the shared authenticated request client and has no public-token transport.

D684 (#1578): `channels.js` calls `/api/channels` (a member's business
Telegram and WhatsApp: availability, link, connect, disconnect, test, and the
conversation threads with assign, ignore and reply) and the interview meeting
routes under `/api/founder/validate/interviews/:id/meetings` (Zoom and Google
Meet). Every path is written out in full so the drift check reads each one.

D678 (#1552): `publicAiModels.js` reads `GET /api/public/ai-models`, the
router's model table as the public Intelligence page shows it: one row per job,
`{ feature, model, name, provider }`, with no session.

D698 (#1660): `railPrefs.js` reads and writes the Eadwyn AI rail's preferences
on the Worker (`/api/ai/rail-preferences`, migration 465): the assist mode per
rail section and the model picked per section and router task, for the caller
only. A null clears a row. localStorage stays the cache, so a mode or a pick
set on a laptop is in place on a phone after a reload.

D702 (#1664): `profile.js` calls `/api/profile/me`, `/api/profile/venture` (GET
and PATCH) and `/api/profile/preview` (`cloudflare-worker/src/routes/founder_profile.ts`), and the
existing `/api/settings/privacy` with `?project=` for the venture's investor
toggle. Every read is the caller's own, or a venture the caller can write.

D712 (#1777): `fundReporting.js` calls `/api/fund-reporting`, the fund
reporting queue: drafts an Admin builds, reads, prepares, returns, rebuilds,
corrects and exports, and a Super Admin issues. A draft's figures come only
from `read` and `exportCsv`, which the Worker records before it answers; the
list carries none.
