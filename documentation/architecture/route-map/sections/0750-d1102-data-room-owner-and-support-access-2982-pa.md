### D1102 — data-room owner and support access (#2982, part)

`GET /api/data-room/:projectUid` (`data_room.ts`) returns full details only to the
venture owner. Admins receive `{mode: "summary", read_only: true}` with aggregate
`files`, `folders`, `coverage` and `grants` blocks, each carrying `available`.
There are no file/folder names, investor identities or access rows. The existing
files tool displayed those (since D1109 the tool draws them, `raise/dataroom/DataRoomSummary.jsx`)
counts without owner controls; an unavailable block says “Unreadable” and offers
Try again. Coverage counts recorded checklist tags only.

`POST /api/data-room/:projectUid/support-read` requires an admin and a 1–500
character reason. It refuses an unresolved founder or failed founder-visible
audit insert before reading details, calls `logAdminAction`, and returns
`mode: "support", read_only: true` details for that request. No dedicated support
client/view is claimed in this part. Founder-side mutations and the data-room
cycle-record detail/activity/form-options/actions remain owner-only, even after
a support read. Admin investor grants cannot bypass support auditing via
`/shared` or its download-token route. Existing investor grants retain their
normal NDA/tier checks. An omitted upload visibility now means NDA, matching both
upload forms' defaults.

D1102 part 2 (#2982, migration 608): the Raise cycle's data-room paths
(`cycle_raise.ts`) take the same owner-only rule. `GET /api/cycles/raise/overview`
gives anyone but the room's owner the room summary as its data-room card (counts
and recorded checklist coverage, no names); `GET /modules/data-room` answers an
admin 403 `support_read_required` and anyone else 403; `PUT
/data-room/files/:id/checklist` answers anyone but the owner 403. Every other
Raise path keeps its rule. The demo-day deck's NDA row reads the founder's choice
(`projects.data_room_nda_choice`), else the room's gates, else "Unreadable".
Project detail's Data room section (`/projects/:id`, `ProjectDetail.jsx`) shows
Yes/No radios with "Not chosen yet" while unset, and sends
`data_room_nda_choice` to `PUT /api/projects/:id` only when the founder picks a
different answer.

D1102 follow-up: the owner-approved minimal guard in `dataroom/DataRoomTool.jsx`
also renders the aggregate response on the new Files, Access and Activity tabs,
before any owner-detail derivation. It reuses `AdminRoomSummary` from the files
workspace, preserves Unreadable/Try again, and offers no owner actions. The full
admin/support tab design remains #2987's.

D1091 (#2956, partial foundation): `/api/connectors/google-workspace` mounts `routes/google_workspace.ts` for `GET /picker-config?project=`, `GET /files?project=`, `POST /files`, `PUT /files/:uid/mapping`, `DELETE /files/:uid` (Stop using) and `POST /files/:uid/preview`. Calendar mounts `POST /api/calendar/google/workspace-files/connect`. All refuse support sessions; file routes re-check venture access and company enablement. The D753 `google_workspace` directory entry stays Coming soon while GW1/GW2/GW7/GW8 await approved design; no new screen ships.

D1094 (#2959, Google Workspace part 5): `routes/cycle_raise.ts` gains `POST /api/cycles/raise/google/sync?project=` (a Slides deck → a pending deck-version proposal; chosen Drive files → data-room copies, a Google file exported to PDF, replaced only on a new `modifiedTime`; Calendar events → "last met" proposals by a prospect's firm domain), `POST /api/cycles/raise/google/proposals/:id/accept` and `/dismiss`, and `DELETE /api/cycles/raise/google/facts/:id` (a copy; a re-sync never copies it again). Each passes `scope()`, then part 2's gates (`workspaceContext`: no support session, a writer of the venture, the member's own connection enabled for its company). The Pitch deck, Data room and Capital relationships reads carry `parts.google` for that member; it fails on its own. No page mounts it yet: `FromGoogle.jsx` (D1314) is not on `main`.
D1095 (#2960, Worker part): `/api/cycles/grow` adds `POST /google/sync` (`part`: `sheets`, `calendar` or both), `GET /google/:slug?project=` (`revenue-and-traction`, `durable-company-building`), `POST /google/proposals/:id/accept` and `/dismiss`, and `DELETE /google/facts/:id` (`routes/cycle_grow.ts`, `services/google/growFeeds.ts`). A mapped metrics Sheet lands `project_metrics` rows with `source = 'google_sheets'` (new users, CAC, LTV, headcount, NRR only; never a Stripe or Mercury column, edits answer 409 `sheet_figure_locked`, latest-row reads skip them). A `#board` or `#filing` Calendar event becomes a proposal that Accept writes as an obligation with `source = 'google_calendar'`. The From Google section is drawn by the page part (D1095 §7, `cycles/GrowFromGoogle.jsx`).

D1092 (#2957): `/api/cycles/validate` adds `POST /google/sync`, `POST /google/forms/:uid/preview` (stores nothing), `POST /google/proposals/:id/accept` and `/dismiss`, and `DELETE /google/facts/:id`, each with `?project=`; Customer research, Demand and urgency signals and Experiments read `parts.from_google`. The SPA draws it with `cycles/ValidateFromGoogle.jsx` on those three modules (`/validate/customer-research`, `/validate/demand-signals`, `/validate/experiments`).
UPDATE D1091 part 2 (#2956): `GET /api/connectors/google-workspace/mine` lists the caller's own chosen files across ventures (with `venture_name`) and the connection state and Google email; it refuses support sessions and returns no token. `/account/connectors/google_workspace` now carries GW1/GW2/GW8 (`GoogleWorkspaceFiles.jsx`). `FromGoogle.jsx` (GW3/GW7) and `MapColumnsDialog.jsx` (GW4) wait for the module feeds to mount them. The registry row stays Coming soon.
D1093 (#2958, part 4 of #2402): `/api/cycles/build/google` mounts `routes/build_google.ts`, ahead of the Build cycle's routes, for `GET /?project=` (From Google: the venture's chosen files, pending proposals and the roadmap items this connection owns), `POST /sync` (reads chosen spec Docs into Solution design proposals and mapped roadmap Sheets into Product roadmap, under `fedOwnership.ts`'s one-owner rule), and `POST /proposals/:id/accept` and `…/dismiss`. Part 2's scope check; never a support session. The client is `lib/api/googleWorkspaceBuild.js`. UPDATE 2026-10-27 (D1093 part two): `pages/cycles/BuildFromGoogle.jsx` calls it from Build's `google` lines on Solution design (spec Doc proposals, Accept and Dismiss) and Product roadmap (the owned items, Sync, and Map columns through `MapColumnsDialog` with the Worker's letter shape).

D1326 (#3487, part 3 of #2431): `/api/ai/rail` mounts `routes/rail_run.ts` for `POST /run`, the `form` handler (a stream of `meta`, `guard` and `done` that stores proposals only), and `/api/fills` adds `POST /record`, `POST /rows/accept` and `POST /:id/undo`. Every write is the member's own, in their own session, on a venture they may write.

D1596 (#3869): `POST /api/ai/rail/run` takes a second handler, `sessions:block` (page `Advisor · Practice · Sessions`, `input.days` 1–60, default 14). It branches before the form path, calls no model, quotes nothing and holds nothing (`meta { model: null, hold_microusd: 0 }`). It reads only the caller's own open slots and four calendar readers, and files `ai_rail_proposals` rows only (`record_ref advisor:<id>`), never the slot table. It refuses `404 unknown_page`, then `403 no_profile` (an Explorer, or no advisor profile) and `403 support_session_refused`, before any read. Accepting a card uses the existing `POST /api/advisors/me/slots/block`.

D1420 (#3864): `POST /api/ai/rail/run` takes a third handler, `studio:layout`, on the member's /studio rail key (`Founder · Studio`, `Investor · Home`, `Operating Partner · Home`; Advisor has none). Refused before any quote or hold: an Explorer with no Studio (403 `no_profile`), a support session (403 `support_session_refused`), an admin (403 `read_only_preview`), `studioProfile`'s refusals, another page (404 `unknown_page`). The `studio_layout` task ("Arrange your Studio", listed by `GET /api/ai/pricing`) reads the layout and its revision, the catalogue and a founder's Lab week and readiness tier; `meta` carries the hold before the run. Kept `add`/`remove`/`resize`/`move` ops are `ai_rail_proposals` rows with `base_revision`; dropped ones are named by title and why. It never writes `studio_layouts`: Accept saves through `PUT /api/studio/layout`. Offered as the Ask chip "Arrange my Studio for this stage" on `GET /api/ai/rail?page=`.

D1329 (#3490, part 6 of #2431): the same five routes also take a record that is not a venture's, by its own scope (`services/fills/scopes.ts`): an advisor's service, a partner's status report, an event and its agenda, a publication and an IC memo. Such a request names `record` (its id) or, for an Add form, `parent` (an engagement, an event; the advisor's own profile is never named), never `project`, and its reply carries `project: null` and `scope`. Each table keeps its own route's write check; a reader and a support session get marks and no trigger; an Explorer is refused `no_profile`. The venture's requests and replies are unchanged. The pages (D1329 §7) reach them through `frontend/src/ui/useScopedFill.jsx`; a publication's sheet also offers H20's waiting summary draft.

D1133 (#3013): Pricing’s in-place checkout sheet uses D1049’s held-plan read and retries it independently. Worker `/api/billing/alerts/:id/pay` and `/update-card` prepare only the caller’s failed renewal, behind a fresh TOTP. D1054 owns the still-unbuilt app-wide banner; D1051’s #2902 contract now includes recorded post-payment changes.

D1051 (#2902): `/api/billing/checkout/quote`, `/checkout/start` and `GET /checkout/status?ref=` mount `routes/billing_checkout.ts` ahead of `billing.ts`. Quote is read only; start makes one incomplete subscription for a new subscriber, or changes a held plan behind TOTP and step-up (an upgrade now and prorated, a downgrade by schedule at the period end); status answers only the caller's own ref. No screen calls them yet (#2905).

D1135 (#3015): Company Settings' existing Leave company confirmation now posts
`/api/company/:uid/leave` through the switcher's shared action. It removes the
membership and clears a departed active selection. Explorers have no Add a new
company control in the switcher. `POST /api/projects/:id/restore` is a founder's
owner-only undo within 30 days and available plan space; no new page is added.

D1123 (#3003), migration 602: an admin records a past interview's outcome (`POST /api/admin/cohort/applications/:id/interview/outcome`, held or missed, once; "Record what happened" on `/applications/:id`), and `/overview`'s `interviewed` counts held interviews while each week's `reached` reads the ledger the scheduler writes at every deadline and decision, Not recorded where coverage is missing. The funnel's foot says "Interviewed [n] · [x]% of applied". D1123 (#3003): SL6 reads Messages/History from `/api/admin/cohort/activity?cohort=YYYY-MM` and capacity from `GET /api/admin/cohort/cohorts/:cohort/capacity`. Formation sends the D946 Lab/all scope to both desks; Users admits through D945’s structured route and in-page dialog. The Lab crumb names `/admin/programs` directly. Branch grant and member refusal cards follow SL16e/SL19a.

D1176 (#3103): Worker `/api/cycles/raise/use-of-funds` now serves GET `/plan`, scenario CRUD and make-base, `/compare`, milestone CRUD and hire edits; the existing module PUT and record drawer share its Base dual writer. The retained `/api/financials/:projectId` save logs `forecast_saved`. Clients are in `useOfFunds.js`. No page change is claimed; #3104/#3105 draw these reads.


