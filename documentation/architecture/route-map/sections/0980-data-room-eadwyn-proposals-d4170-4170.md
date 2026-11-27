### Data room: Eadwyn's proposals (D4170, #4170)

- **Worker:** `routes/data_room_proposals.ts`, mounted by the route registry at `/api/data-room`, after the room's own router. Served by `services/dataRoomProposals.ts`.
  - `GET /:projectUid/proposals` → `{ proposals: [{ uid, type, status, reason, file, item, folder, would_satisfy, created_at, decided_at, undoable }] }`. These are the caller's own open proposals, plus accepted ones that can still be undone.
  - `POST /:projectUid/proposals/quote` → `{ quote: { hold_microusd, model, confirm_quote } }`.
  - `POST /:projectUid/proposals/run` with `{ confirm_quote }` → `{ proposals, cost }`. Without the current quote it answers 402 `quote_required` with a fresh quote, and nothing runs.
  - `POST /:projectUid/proposals/:uid/accept` → `{ proposal, change }`. Refusals: 409 `not_open`, `proposal_stale` or `would_change_access`; 404 `file_not_found`.
  - `POST /:projectUid/proposals/:uid/dismiss` → `{ proposal }`.
  - `POST /:projectUid/proposals/:uid/undo` → `{ proposal, change }`, for a match or a folder move only. Refusals: 409 `not_undoable` or `proposal_stale`.
- **Who:** the room's owner and its co-founders (`roomProject`, D1103). Anyone else, an admin included, gets 404. The gate is read on every press.
- **Store:** `ai_rail_proposals`, page `Founder · Raise · Data room`, record `data-room:<projectUid>`. The generic decide route can only discard a `dataroom:` proposal.
- **Client:** `lib/api/dataRoom.js`: `proposals`, `proposalsQuote`, `proposalsRun`, `acceptProposal`, `dismissProposal`, `undoProposal`. The page is `pages/raise/dataroom/DataRoomChecklist.jsx`.
