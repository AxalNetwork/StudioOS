# Meta app

`app.ts` reads the shared Meta app credentials from the existing WhatsApp
bindings. OAuth uses trimmed credentials. WhatsApp webhook verification uses
the exact configured secret bytes. Provider-specific Graph API versions and
login configurations belong to the individual providers.
