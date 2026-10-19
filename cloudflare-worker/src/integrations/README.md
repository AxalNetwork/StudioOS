# integrations — the connector framework

What every third-party connection shares: the registry of providers, how
credentials and OAuth state are kept, which company a connection may write
into, and what each connector delivered to which module. The HTTP surface is
`../routes/integrations.ts` (`/api/connectors`, D650); provider-specific code
lives in `providers/`.

| File | What it does |
| --- | --- |
| `registry.ts` | The single source of truth for providers: `REGISTRY` (one descriptor each: status, tier, auth type, OAuth scopes), `CONNECTOR_METADATA` (category, what it pulls and sends, the modules it feeds, the permission sentences), `registerProvider` / `getProviderImpl`, `IntegrationRow`, `ensureIntegrationsSchema` and `publicDescriptor`, which adds `feed_modules` beside the plain `feeds` strings (D686). |
| `connectorPages.ts` | Each connector's page, as data (D753): tagline, long description, the tools Axal VC runs through it (each with the source fragments of its calls), Eadwyn prompts, maker, service, sign-in, endpoints, added month, links and `verified_on`; Mercury by audience, LinkedIn as a first-party page, and WhatsApp and Telegram as `CHANNEL_PAGES` (D753 C1; `channelPage(key)` for #1878's directory handler). `trustFor`, `pageDescriptor` (by viewer, through `audienceFor`), `connectorPagePath`, `CATEGORY_ORDER`; `FIRST_PARTY_CARDS` (LinkedIn's card facts) and `directoryKeyFor` (a directory request's registry and page key, D753 W2). Read only through `pageDescriptor` and `registry.ts`' one re-export line. It imports only types and `audienceFor` from `./registry`, reads no registry value at its top level (the two form a cycle), and imports no provider or service. `cloudflare-worker/test/connector_pages_d753.test.ts` holds every fact to the code. |
| `moduleLabels.ts` | `MODULE_LABELS` and `MODULE_HREFS`: each fed module's name and the page that shows its data (D686). Its own file because `fed.ts` imports `registry.ts`, so the registry cannot import `fed.ts` back. `moduleHref` answers `null` for an unknown key. |
| `fed.ts` | "Now fed by" (D655): `fedCounts` counts what each connector delivered to each module from `connector_fed_items`, with the module's `href`. A connector that records nothing gets `count: null` and a reason, never 0. With a `projectId`, it counts only that project's rows (D782's Code system). GitHub's Operating systems reads the connection, so it gets `count: null` and its reason. Re-exports `MODULE_LABELS`. |
| `githubFeeds.ts` | D782: what the GitHub connector feeds, as the code builds it. `GITHUB_LANDINGS` lists each kind a sync reads, its module and its store; `GITHUB_READ_BY` lists the modules that read the connection itself. The connector page's claims are held to it, and Operating systems' sync lines are worded from it (`syncArrivals`, `syncErrorWords`). No side effects, so the Build route imports it without registering the provider. |
| `secrets.ts` | Credential encryption over `../services/columnCipher.ts`, with the row's uid in the AAD, and the masked previews the list endpoints show. Never logs plaintext. |
| `oauth.ts` | PKCE pairs, signed state tokens and `consumeOauthState`. The state's `extra` carries per-connect values (the selected company, a Salesforce sandbox flag, the literal `build` return token) so the callback never trusts its query string. |
| `companyScope.ts` | Which providers write project-backed data, and whether a connection is enabled for a company or project. A missing scope row denies the write. |
| `connectorRules.ts` | `hasScopeOverreach` (a grant wider than the request is refused) and the validation of a connector's settings patch. |
| `autopush.ts` | Background pushes started outside the connector routes (a deal's stage change, a new project), logged to `integration_logs` like a user's own push. |
| `refreshLease.ts` | `acquireRefreshLease` and `REFRESH_LEASE_TTL_S`: the KV lease on `<provider>:refresh:<uid>` that serializes one connection's OAuth token refresh, shared by HubSpot, Calendly, Carta, DocuSign and Salesforce (#1903). `release()` deletes the key only for the caller that acquired it. Best-effort: KV is eventually consistent, so the providers keep their D1 re-checks. |

## Who sees a provider

`audienceFor(provider, viewer)` answers `open`, `entity`, `personal` or `none`;
a `none` provider is answered everywhere as if its key did not exist (404
`unknown_provider`). The viewer is `{ role, hq, venture }`, built in one place
per caller (`viewerOf` in `../routes/integrations.ts`, Mercury's own connect).

- **Roles (D710).** `entity_roles` and `personal_roles` — Mercury.
- **The venture audience (D757 §2.11).** `audience_rule: 'venture'` — Zoom —
  makes a provider founder-facing: `personal` for a viewer who can hold a
  venture, `none` for everyone else. `venture` is `canHoldValidateSource` in
  `../routes/_founder_validate_helpers.ts`: an admin, a `founder`, or an active
  Lab member with a `founder_id` whatever their role. `/available`,
  `/directory/:key`, `/connect`, both OAuth starts (before any state is
  written) and the callback all read it. `GET /api/channels` and its
  link and connect routes apply the same rule to Telegram, WhatsApp and Meet.
  An existing connection keeps Disconnect.

Zoom also carries `used_by`, `suggests` (Validate module keys, each in
`moduleLabels.ts`) and `distribution`, read from `ZOOM_APP_AUDIENCE` by
`zoomDistribution` (absent, empty or unknown is `own_account`).

## GitHub's sync (D655, #1906)

`providers/github.ts` lands issues on `roadmap_okrs` and pull requests on
`mvp_features`, each through its `connector_fed_items` row. **A founder's
deletion stands**: a re-sync never re-creates a deleted row, and unlinks its
ledger row (`local_id` NULL), so `fed.ts` counts the item as arrived but not
linked. **A large sync continues on the next run**: each page is one ledger
read and one D1 batch, the run counts its subrequests against
`SYNC_SUBREQUEST_BUDGET` (8,000 of the Worker's 10,000), and at the budget it
stops "Partly synced", keeping a KV cursor so the next Sync starts where it
stopped. `cloudflare-worker/test/github_connector_flow_d751.test.ts` drives the
whole flow against a stubbed GitHub. After the loop, `providers/github/roadmap.ts`
gives Product roadmap its milestone groups and targets, one `roadmap_releases`
row per release through the same ledger, and Shipped marks on evidence only
(D782, #2111). Then `providers/github/mvp.ts` makes each fed must-have follow
its pull request, written only when GitHub's state moves, and records each
release's checks on the must-haves through the ledger (D782, #2112).

## Subfolders

- `providers/` — one file per provider implementation; see its README.
- `mappings/` — field and stage maps for the CRM providers
  (`hubspot_stages.ts`, `salesforce_fields.ts`).

## Adding here

A new provider goes in `providers/` with an entry in `REGISTRY`,
`CONNECTOR_METADATA` **and `CONNECTOR_PAGES`** (every registry entry needs
metadata and a page), with its tools taken from its calls. A new fed module
needs a label and a page in `moduleLabels.ts`. Shared connector logic that is
not one provider's goes in this folder; anything with HTTP belongs in
`../routes/`.

A KV TTL is at least 60 seconds, KV's minimum: a shorter `expirationTtl` makes the `put` throw in production. `cloudflare-worker/test/kv_refresh_lease.test.ts` fails on a literal under 60 anywhere in `cloudflare-worker/src`, and `cloudflare-worker/test/_mem_kv.mjs` refuses one as KV does.
