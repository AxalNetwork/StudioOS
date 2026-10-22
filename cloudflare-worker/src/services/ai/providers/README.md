# services/ai/providers — model providers on their own APIs (D851)

Pattern C: a model provider's own inference API, called with the platform's
key and metered on the one AI token ledger. It is never an MCP connection.
Read [D851](../../../../../documentation/architecture/decisions/D851.md) first:
its §1 records what each provider really offers, cited.

| File | What it owns |
| --- | --- |
| `types.ts` | The one adapter shape: `build(apiModel, request, apiKey)` returns the HTTP request; `read(status, body, header)` returns the answer and the provider's reported usage (null when it reported none), or a `ProviderErrorKind`. |
| `anthropic.ts` | Anthropic's Messages API: `x-api-key`, `anthropic-version: 2023-06-01`, the text blocks as the answer, `input_tokens` / cache writes / cache reads / `output_tokens` as the usage, and the error kinds, including the 429 that is the account's spend cap. |
| `index.ts` | `ADAPTERS`, one per `ProviderId` (`../catalogue.ts`). |

**Adding here.** An adapter is pure, as everything in `services/ai/` is: no
`env`, no D1, no hold, no log. `../../aiProviders.ts` holds, calls, settles
and writes the row for every provider. A new provider needs its §1 study in
D851 first, its rows in `PROVIDER_MODELS` with the page and date its prices
were read, a switch that is off unless exactly `'on'`, and its cases in
`test/ai_provider_adapter_d851.test.ts`.
