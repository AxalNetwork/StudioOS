# Mailbox adapters (D1340, #3548)

| File | Purpose |
| --- | --- |
| `types.ts` | `MailAdapter`, the credential shapes, and `AdapterError`: a code and a sentence of ours, never a provider's text. |
| `oauth.ts` | Outlook (Microsoft Graph; `Mail.Send offline_access User.Read`, `Mail.Read` only when asked; rotated refresh tokens) and Gmail behind `MAIL_GMAIL_ENABLED` (`gmail.send` with `openid email`, its own client, revoked at Google). |
| `imap.ts` | IMAP and SMTP with an app password over `cloudflare:sockets`: TLS or STARTTLS only, port 25 refused, verify by SMTP AUTH and IMAP LOGIN with nothing sent. |
| `memberMcp.ts` | D1343: a member's own MCP mail server (a D852 custom connector with a designated send tool): send mints the tool's one-use ticket after the composer's nonce is spent; verify lists the tool against its pinned schema, sending nothing. `mcpMailDeps` is the test seam. |
| `mime.ts` | One plain-text message: header values without line breaks, encoded words, a base64 body. |
| `index.ts` | The adapter for each provider. |

An adapter never logs, stores or returns a secret: it is handed opened
credentials and hands rotated ones back to `../accounts.ts` to seal.
