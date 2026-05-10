# Provider implementations

One file per provider. Each module:

1. Imports the shared `ProviderImpl` interface from `../registry`.
2. Implements `connect`, plus any of `sync`, `push`, `webhook`,
   `disconnect`, `buildAuthorizeUrl` it supports.
3. Calls `registerProvider({ key: '<provider_key>', ...impl })` at module
   top-level so the route layer picks it up.
4. Flips its registry entry's `status` from `'coming_soon'` to `'live'`
   or `'beta'` in `../registry.ts`.

The module is then imported once from the worker entry point
(`cloudflare-worker/src/index.ts`) so its top-level `registerProvider`
call runs at boot.

## Downstream tasks landing here

- Task #2 — `hubspot.ts`
- Task #3 — `calendly.ts`
- Task #4 — `salesforce.ts`
- Task #5 — `carta.ts`
- Task #6 — `slack.ts`
- Task #7 — `docusign.ts`
- Task #8 — `crunchbase.ts`
- Task #9 — `affinity.ts`

## Credential handling

Never log raw credentials. Return them from `connect()` as a plain
object — the route layer encrypts and persists via
`integrations/secrets.ts` (column cipher + AAD scoped to the row's uid).

## OAuth providers

Use `integrations/oauth.ts` `buildPkce()` inside your
`buildAuthorizeUrl` so the verifier is bound to the signed state. The
callback handler in `routes/integrations.ts` will hand the verifier back
to your `connect()` via `input.config.pkce_verifier`.
