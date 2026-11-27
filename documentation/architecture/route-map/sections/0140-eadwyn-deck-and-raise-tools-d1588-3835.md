## Eadwyn — the deck and raise tools (D1588, #3835)

Deck v2 F9. Worker only: no board draws these. What the write tools leave appears where the founder already decides it: the deck's Ask ("Waiting for you", pd40 and pd15), the deck proposal (Keep or Discard), and Email's drafts. No chat, composer or thread.

| Address | What | Backend |
| --- | --- | --- |
| (none; Eadwyn) | The deck and raise tools this member may use on a venture | `GET /api/eadwyn/deck-tools?project=` (`routes/eadwyn.ts`) |
| (none; Eadwyn) | One call, in the member's own access, through `runEadwynToolCalls` | `POST /api/eadwyn/deck-tools/:name` `{ project, args }` → `{ result }` |
| (none; MCP) | `decks.read_outline`, `raise.prospect_brief`, `raise.qa_prep` (`raise:read`); `decks.propose_area`, `decks.propose_variant`, `raise.draft_follow_up` (`raise:write`, proposals only) | `/mcp` tools (`mcp/tools/decks.ts`, `services/decks/eadwynDeckTools.ts`) |
