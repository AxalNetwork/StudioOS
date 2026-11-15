# cloudflare-worker/src/durable-objects

The Worker's own Durable Object classes. Each is named by a `[[durable_objects.bindings]]` entry in
`wrangler.toml` (in the top-level, `[env.production]` and `[env.preview]` tables, with an append-only
`[[migrations]]` tag) and re-exported from `cloudflare-worker/src/index.ts`, because the Workers runtime finds a
class only among the entry's module exports. Each file's header comment says what one instance is and who reaches it.

| File | Class | Binding | One instance per |
| --- | --- | --- | --- |
| `pipeline-room.ts` | `PipelineRoom` | `PIPELINE_ROOM` | pipeline deal |
| `onboarding-chat.ts` | `OnboardingChat` | `ONBOARDING_CHAT` | founder |
| `meeting-bot-run.ts` | `MeetingBotRun` | `MEETING_BOT_RUN` | meeting bot run (D886) |
| `deck-presence.ts` | `DeckPresence` | `DECK_PRESENCE` | deck (D1577) |
| `deck-gen-room.ts` | `DeckGenRoom` | `DECK_GEN_ROOM` | deck's generation runs (D1502) |
| `ai-governor.ts` | `AiGovernor` | `AI_GOVERNOR` | account, and upstream gateway lease (D1502, D5338) |
| `deck-remote.ts` | `DeckRemote` | `DECK_REMOTE` | deck version's phone remote (D1581) |
| `work-graph-lease.ts` | `WorkGraphLease` | `WORK_GRAPH_LEASE` | tenant, company and WorkGraph asset (D5581 part 2) |

The agent engine's objects (`AgentScope`, `ScopeAgent`) live in `cloudflare-worker/src/agents/`.

**Adding one.** A new class is a new file here, a binding and a new migration tag in all three `wrangler.toml`
tables (`scripts/check-wrangler-binding-parity.mjs`, `scripts/check-preview-isolation.mjs`), a row in
`cloudflare-worker/src/services/topology.ts`'s `BINDINGS`, an optional field on `Env` in `types.ts`, and one re-export in `index.ts`
(a frozen hub, D5615, which gives a new class no other home; D5581 part 2 §6 records how its re-export was listed). Add one row at the end of the table
above. Durable state belongs in the object's storage and is written before the call answers; a class that holds only
memory says so in its header.
