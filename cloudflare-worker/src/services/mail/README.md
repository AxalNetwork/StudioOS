# Email services (#3547)

Email from the member's own mailbox. Part 1 (D1340, #3548) connects the
mailboxes and sends; part 2 (D1341, #3549) drafts. A draft needs no mailbox,
and mail never goes out on Axal's house token: `../email.ts` stays for system mail.

| File | Purpose |
| --- | --- |
| `accounts.ts` | D1340: `mail_accounts` (migration 647): credentials sealed by `../columnCipher.ts` (the EIN helper) with the row's uid as AAD, the client's view without them, expiry and disconnect; the one-use nonces of a send and an OAuth state (`mail_nonces`). |
| `adapters/` | D1340: one `MailAdapter` per provider: `send`, `verify`, `revoke`, and `listThread` where the account can read. |
| `intents.ts` | D1341: what a draft is for, by relationship: one table, no imports, read by the Worker and by the composer (#3552). |
| `contextPack.ts` | D1341: the records a draft may quote for one person (`kind:id`), each read through its module's own read (`../records/read.ts`) or the founder's own engagement rule; a ref the member cannot read is "Record not found." |
| `blocks.ts` | D1341: live update blocks (KPIs, raise status, project progress, interview insights, the one-liner), computed now under each module's gate; nothing recorded is no block. |
| `drafts.ts` | D1341: the draft request, the prompt (the ticked records and the blocks only), the model's `{subject, body}`, and the member's own `mail_drafts` rows (migration 648). |

The routes are `../../routes/mail_accounts.ts` and `../../routes/mail_drafts.ts`,
both mounted at `/api/mail`. A new provider adds an adapter in `adapters/` and a
row in `adapters/index.ts`. A new person kind goes in `MODULES` in
`contextPack.ts`, with a fixed statement and the module's record spec, and in
`RELATIONSHIP_OF` in `intents.ts`.
