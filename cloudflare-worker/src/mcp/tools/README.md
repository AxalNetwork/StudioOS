# mcp/tools — the MCP server's tools

| File | What it holds |
| --- | --- |
| `context.ts` | D666's read tools: `list_companies`, `get_validate_context` (Validate's own module records; interviews only counted) and `get_interview_guide` (questions built by code from the open hypotheses and the strongest pain themes) |
| `interviews.ts` | D669's three interview tools: `submit_interview`, `propose_placements` and `structure_with_axalvc` (D1315: `structure_with_studioos` still calls it, unlisted, and stays its stored name) |
| `build.ts` | D846's `get_build_progress` (`build:read`): Product roadmap and Prototype / MVP from their own tables, and what GitHub fed them from the ledger. Listed only while GitHub is connected and switched on for a granted company |
| `connections.ts` | D846's `list_connections` (`connectors:read`): each granted company's connections, as provider, status and last sync. Never a token |
| `channels.ts` | D864's customer-chat tools over the Telegram and WhatsApp inbox (D684): `list_channel_chats` and `get_session_insights` (`validate:read`), `assign_chat_to_interview` (`validate:write`, the inbox's own `assignThread`). State, counts, suggestions and D858 analytics by default. `get_session_insights` 1.1.0 optionally pages stored final transcript segments only for a consented, assigned chat, with speaker labels and available D857 translations. Provider identifiers, phone numbers, credentials and links are redacted; held notes are never fetched |
| `meetings.ts` | D874's call tools over D684's Zoom and Meet refs: `list_meetings` and `get_meeting_transcript` (`validate:read`; a consented, imported call's stored lines, paged, links and meeting ids removed), `summarize_meeting` (`validate:write`; the engine's summary, run once through `aiRouter`'s AI tokens), `extract_action_items` (`validate:write`; D859's extraction over the call, stored as pending proposals with their passages, nothing accepted). Never a join URL, meeting id or passcode |
| `mail.ts` | D1343's Email tools: `mail_context` (`mail:read`, the records Eadwyn may quote to one person, with their dates) and `mail_draft` (`mail:write`, one draft run once through `aiRouter`, kept in Email; nothing is sent) |
| `decks.ts` | D1588's deck and raise tools, all taking the company and refused for anyone but the venture's founders: `decks.read_outline`, `raise.prospect_brief` and `raise.qa_prep` (`raise:read`), and `decks.propose_area`, `decks.propose_variant` and `raise.draft_follow_up` (`raise:write`, `proposes`), which leave a card edit on the deck's Ask, the deck proposal, or an Email draft. None saves a change or sends; no chat or thread tool. Logic in `../../services/decks/eadwynDeckTools.ts` |

## Rules

- **One file per group of tools,** each exporting an array that
  `../server.ts` registers.
- **A tool that takes a company sets `company: true`,** and the server checks
  it against the grant before the tool runs. A tool never reads a company the
  grant does not cover.
- **Every tool says where it comes from (D846):** `source` (`axal`,
  `connector` or `remote_mcp`), `provider` for a connector, a semver
  `version`, and `entitlement` and `requiresConnection` when it needs them. A
  breaking change registers `<name>_v2` beside the old tool.
- **A connector tool reads StudioOS's records, never the provider (D713).**
  No token is read and no request leaves the Worker.

D669: `interviews.ts` adapts the three interview services to the SDK's zod schemas. Every read needs validate:read; every interview tool needs validate:write. All six run through the server's common grant and account gate.
