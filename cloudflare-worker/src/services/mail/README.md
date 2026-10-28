# Email services (D1340, #3547)

The member's own mailboxes (part 1, #3548). Mail always goes from the member's
own mailbox, never Axal's house token: `../email.ts` stays for system mail.

| File | Purpose |
| --- | --- |
| `accounts.ts` | `mail_accounts` (migration 647): credentials sealed by `../columnCipher.ts` (the EIN helper) with the row's uid as AAD, the client's view without them, expiry and disconnect; the one-use nonces of a send and an OAuth state (`mail_nonces`). |
| `adapters/` | One `MailAdapter` per provider: `send`, `verify`, `revoke`, and `listThread` where the account can read. |

The route is `../../routes/mail_accounts.ts`, mounted at `/api/mail`. A new
provider adds an adapter in `adapters/` and a row in `adapters/index.ts`.
