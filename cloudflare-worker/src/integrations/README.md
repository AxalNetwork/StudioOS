# integrations — the connector framework

What every third-party connection shares: the registry of providers, how
credentials and OAuth state are kept, which company a connection may write
into, and what each connector delivered to which module. The HTTP surface is
`../routes/integrations.ts` (`/api/connectors`, D650); provider-specific code
lives in `providers/`.

| File | What it does |
| --- | --- |
| `registry.ts` | The single source of truth for providers: `REGISTRY` (one descriptor each: status, tier, auth type, OAuth scopes), `CONNECTOR_METADATA` (category, what it pulls and sends, the modules it feeds, the permission sentences), `registerProvider` / `getProviderImpl`, `IntegrationRow`, `ensureIntegrationsSchema` and `publicDescriptor`, which adds `feed_modules` beside the plain `feeds` strings (D686). |
| `moduleLabels.ts` | `MODULE_LABELS` and `MODULE_HREFS`: each fed module's name and the page that shows its data (D686). Its own file because `fed.ts` imports `registry.ts`, so the registry cannot import `fed.ts` back. `moduleHref` answers `null` for an unknown key. |
| `fed.ts` | "Now fed by" (D655): `fedCounts` counts what each connector delivered to each module from `connector_fed_items`, with the module's `href`. A connector that records nothing gets `count: null` and a reason, never 0. Re-exports `MODULE_LABELS`. |
| `secrets.ts` | Credential encryption over `../services/columnCipher.ts`, with the row's uid in the AAD, and the masked previews the list endpoints show. Never logs plaintext. |
| `oauth.ts` | PKCE pairs, signed state tokens and `consumeOauthState`. The state's `extra` carries per-connect values (the selected company, a Salesforce sandbox flag, the literal `build` return token) so the callback never trusts its query string. |
| `companyScope.ts` | Which providers write project-backed data, and whether a connection is enabled for a company or project. A missing scope row denies the write. |
| `connectorRules.ts` | `hasScopeOverreach` (a grant wider than the request is refused) and the validation of a connector's settings patch. |
| `autopush.ts` | Background pushes started outside the connector routes (a deal's stage change, a new project), logged to `integration_logs` like a user's own push. |

## Subfolders

- `providers/` — one file per provider implementation; see its README.
- `mappings/` — field and stage maps for the CRM providers
  (`hubspot_stages.ts`, `salesforce_fields.ts`).

## Adding here

A new provider goes in `providers/` with an entry in both `REGISTRY` and
`CONNECTOR_METADATA` (every registry entry needs metadata). A new fed module
needs a label and a page in `moduleLabels.ts`. Shared connector logic that is
not one provider's goes in this folder; anything with HTTP belongs in
`../routes/`.
