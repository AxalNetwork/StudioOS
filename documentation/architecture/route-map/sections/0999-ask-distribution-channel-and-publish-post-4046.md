### Ask on Distribution's channel and Publish to…'s post text (#4046, the owner's call of 2026-11-04)

The last two placements of #3740's Ask coverage, built on today's Distribution screens. When #3722's redesign lands, it moves these buttons and does not re-decide them.

- **Channel name:**
  - Where: Grow › Distribution's Add channel and Edit channel, through the founder form registry (`FILL_FIELDS`: `growth_channels.name`, composition).
  - Key: the channel's uid (`ROW_KEYS`).
  - Runs: `POST /api/ai/rail/run` with `form:channel`. Accept places the name "Not saved" until Save.
- **Post text:**
  - Route: `POST /api/publish/ask` `{ project_id, module, destination_uids[1..5], estimate? }` (`routes/publish.ts`, `services/publishAsk.ts`). One `rail_write` under `draft:publish`, quoted first.
  - Who: the founder `canPublish` allows, for places that pass preview's own rule.
  - What it reads: the module's never-list builder, with team-only figures never read.
  - Writes: no draft, proposal or send.
  - Client: `publishApi.ask`; `PublishAskIntent.jsx` in the Ask panel (D1443). Accept places the text in the sheet's Draft; only the confirm dialog's Send publishes.
  - Refusals: 422 `nothing_to_draft` ("Nothing recorded here yet to draft from. Write your own."), and the publish refusals for who and where.
