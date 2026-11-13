### Connector health Worker contract (D848, #2469)

Every adapted connector implements one contract, `ConnectorAdapter` in `integrations/contract.ts`; GitHub and Stripe adopt it, Mercury once #2468 merges. See `decisions/D848.md`.

| Method and path | Who | Worker | What |
| --- | --- | --- | --- |
| `GET /api/connectors/health` | a signed-in member whose role may manage connections (`ensureRole`) | `routes/connectors_health.ts`, mounted before the connector router | The caller's own connections: `uid`, `provider_key`, `contract` (whether it has an adapter), `pattern`, `company_ids` (enabled `integration_companies` rows for companies the member still belongs to), `health` `{ state, checked_at, error_category }` and `checks`, its last ten, newest first. `companies` groups the connections by company. `state` is `ok`, `degraded`, `expired`, `disconnected` or `error`; `error_category` is `auth`, `rate_limited`, `not_found`, `invalid_input`, `provider_down` or `unknown`. A row that is not `active` or `error`, or holds no credentials, is `disconnected`; one without an adapter answers a null state. A check younger than 15 minutes is answered as kept; an older one is run again, at most five per request, and kept as one `integration_logs` row (`event_type` `health`, its state and category only). Never a token or a provider's message. |

