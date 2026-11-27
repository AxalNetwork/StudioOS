# Ticket ↔ GitHub Issues Sync (Task #9)

Bidirectional sync between StudioOS support tickets and GitHub Issues in
`AxalNetwork/StudioOS`. Runs inside the existing production Worker — no
separate service.

## Architecture

- **Outbound (Platform → GitHub)** — `src/services/githubSync.ts` +
  `src/routes/tickets.ts`. Ticket create/update/assign/comment mirror to the
  linked issue. Every response carries an explicit `github_sync_status`
  (`synced` / `partial` / `failed` / `not_configured` / `not_linked`) — never
  silent.
- **Inbound (GitHub → Platform)** — `src/routes/github.ts`, signature-verified
  webhook at `POST /api/github/webhook`. Pull-based `POST /api/tickets/sync`
  remains the fallback.
- **Comments are GitHub-canonical** — no local comment table. The detail view
  hydrates comments live from the issue; `POST /api/tickets/:id/comments`
  posts straight to GitHub.
- **Mapping store** — `tickets.github_issue_number` / `github_issue_url`
  columns plus the `ticket_sync_events` D1 sidecar (idempotency + audit).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/tickets` | Create ticket → creates labeled GitHub issue |
| PUT | `/api/tickets/:id` | Update status/priority/type/assignee → closes/reopens/relabels/assigns the issue |
| POST | `/api/tickets/:id/comments` | Post a comment to the linked issue (409 if unlinked) |
| GET | `/api/tickets/:id/mapping` | Admin: ticket↔issue linkage + last 20 sync events |
| POST | `/api/tickets/sync` | Pull-based re-sync of all linked tickets |
| POST | `/api/github/webhook` | Inbound `issues` + `issue_comment` events |
| GET | `/api/health` | Includes `github_sync` config presence flags |

## Label mapping

| Local field | GitHub label |
|---|---|
| type `bug` / `feature` / `task` | `bug` / `feature` / `task` |
| priority | `priority:urgent` / `priority:high` / `priority:medium` / `priority:low` (legacy `priority: x` accepted inbound) |
| category (pass-through) | `audit` / `beta-readiness` / `tracking` |
| marker | `support-ticket` (always) |

Unmanaged labels on the issue are preserved when the Worker swaps its own.

## Status mapping

| Local | GitHub |
|---|---|
| `open`, `in_progress` | `open` |
| `resolved` | `closed` / `completed` |
| `closed` | `closed` / `not_planned` |

## Loop prevention & idempotency

1. **Delivery dedup** — every webhook delivery's `X-GitHub-Delivery` GUID is
   `INSERT OR IGNORE`d into `ticket_sync_events` (`event_key = gh:<guid>`);
   replays are acknowledged and dropped.
2. **Source markers** — outbound issue bodies and comments embed
   `<!-- axal-sync:ticket-<id> -->`; inbound comments carrying the marker are
   ignored (they are our own echoes).
3. **Bot actor filter** — set `GITHUB_SYNC_BOT_LOGIN` to the login behind
   `GITHUB_ACCESS_TOKEN` and all events from that actor are dropped.
4. **Absolute writes** — inbound handlers write the full desired state
   (status/priority/type/snapshots), so redelivery and out-of-order events
   are safe.

## Required secrets / vars (Cloudflare)

- `GITHUB_ACCESS_TOKEN` — token with `issues:write` on the repo
- `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` — `AxalNetwork` / `StudioOS`
- `GITHUB_WEBHOOK_SECRET` — shared HMAC secret for `X-Hub-Signature-256`
- `GITHUB_SYNC_BOT_LOGIN` — (recommended) token identity's login
- `ADMIN_GITHUB_LOGINS` — (optional) JSON map of local assignee name/email →
  GitHub login, e.g. `{"kim@axal.vc":"kim-axal"}`. Unmapped assignees skip
  the GitHub assignee call and the PUT response says so.

## Webhook registration

Repo → Settings → Webhooks → Add webhook:

- Payload URL: `https://axal.vc/api/github/webhook`
- Content type: `application/json`
- Secret: value of `GITHUB_WEBHOOK_SECRET`
- Events: **Issues** and **Issue comments**

Unsigned or mis-signed deliveries get 401; irrelevant events get 2xx so
GitHub never retries them.

## Dev backend parity

The FastAPI dev backend accepts the same payloads (`type` validated) but
GitHub calls are stubbed: comment posts return
`{"github_sync_status": "dev-stub"}` and the UI surfaces that message.

## Tests

`cloudflare-worker/test/ticketsGithubSync.test.ts` (in `npm run test:drift`)
pins label mapping both directions, the status matrix + round-trip, the
source marker, validators, and assignee mapping.
