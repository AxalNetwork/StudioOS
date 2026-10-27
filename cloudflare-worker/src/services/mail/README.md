# Email services (D1341, #3547)

Eadwyn's email drafts (part 2, #3549). A draft needs no mailbox; sending is
part 1's (#3548).

| File | Purpose |
| --- | --- |
| `intents.ts` | What a draft is for, by relationship: one table, no imports, read by the Worker and by the composer (#3552). |
| `contextPack.ts` | The records a draft may quote for one person (`kind:id`), each read through its module's own read (`../records/read.ts`) or the founder's own engagement rule; a ref the member cannot read is "Record not found." |
| `blocks.ts` | Live update blocks (KPIs, raise status, project progress, interview insights, the one-liner), computed now under each module's gate; nothing recorded is no block. |
| `drafts.ts` | The draft request, the prompt (the ticked records and the blocks only), the model's `{subject, body}`, and the member's own `mail_drafts` rows (migration 648). |

The route is `../../routes/mail_drafts.ts`, mounted at `/api/mail`. Add a
person kind to `MODULES` in `contextPack.ts` with a fixed statement and the
module's record spec, and to `RELATIONSHIP_OF` in `intents.ts`.
