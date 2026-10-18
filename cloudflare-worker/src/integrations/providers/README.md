# Provider implementations

One file per provider. Each module:

1. Imports the shared `ProviderImpl` interface from `../registry`.
2. Implements `connect`, plus any of `sync`, `push`, `webhook`,
   `disconnect`, `buildAuthorizeUrl` it supports.
3. Calls `registerProvider({ key: '<provider_key>', ...impl })` at module
   top-level so the route layer picks it up.
4. Flips its registry entry's `status` from `'coming_soon'` to `'live'`
   or `'beta'` in `../registry.ts`, and its page entry in
   `../connectorPages.ts`: tagline, description, the tools its calls make,
   and prompts only if Eadwyn reads it. `cloudflare-worker/test/connector_pages_d753.test.ts`
   fails until every request that writes is named by a tool (D753).

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
- D655 (#1467) — `github.ts`: a GitHub App's read-only user authorization; issues to Product roadmap, pull requests to Prototype / MVP, releases recorded with no store. Its first ledger writer (`connector_fed_items`, migration 445).
- D684 (#1577) — Zoom is a registry provider (`zoom`) whose implementation is
  NOT in this folder: it lives with the other interview channels in
  `cloudflare-worker/src/services/channels/zoom.ts`, which calls
  `registerProvider` at module load and is imported by
  `cloudflare-worker/src/routes/founder_validate_meetings.ts`.
- D710 (#1775) — Mercury's HQ entity connection is NOT made here: a Super
  Admin adds it per Axal organization, kept in its own store and synced
  read-only by `cloudflare-worker/src/services/mercury/`, behind
  `cloudflare-worker/src/routes/admin_mercury.ts`.
- D713 (#1778) — `mercury.ts` is a member's own Mercury, for founders and
  partners (`personal_roles`). It registers `connect` and nothing else: no
  sync, push, webhook, preview or action. Connect takes a Read Only token,
  refuses each failure with its own `ConnectRefusal` (a support session, a
  webhook secret, a write scope, an Axal entity's organization), and is read
  on demand by `cloudflare-worker/src/services/mercuryPersonal.ts`. Decision
  3's entity check lives here, so both share it.

## Credential handling

Never log raw credentials. Return them from `connect()` as a plain
object — the route layer encrypts and persists via
`cloudflare-worker/src/integrations/secrets.ts` (column cipher + AAD scoped to the row's uid).

## OAuth providers

Use `cloudflare-worker/src/integrations/oauth.ts` `buildPkce()` inside your
`buildAuthorizeUrl` so the verifier is bound to the signed state. The
callback handler in `cloudflare-worker/src/routes/integrations.ts` will hand the verifier back
to your `connect()` via `input.config.pkce_verifier`.
