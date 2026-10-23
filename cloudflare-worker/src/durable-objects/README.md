# Durable Objects

`pipeline-room.ts` and `onboarding-chat.ts` own the existing real-time rooms.
`meeting-bot-run.ts` is B1's serialized owner of bot consent/access checks,
funding, signed events, upload intake and run status.
`meeting-bot-container.ts` is B8's private per-run process host: digest-pinned
image startup, signed HTTP commands, lease/inactivity bounds and durable Stop.
It persists command fingerprints and timing, never the meeting link or keys.

Register each new class in index.ts, repeat its binding/configuration under
production and preview, and append its SQLite DO migration without changing
applied tags. Use doNamespace for namespace selection. Never add a public
container forwarding route. Hosting health is distinct from a successful call.
