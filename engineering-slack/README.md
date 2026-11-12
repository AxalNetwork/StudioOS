# engineering-slack — independent durable delivery (D5665)

The proposed Worker is disabled and has no routing registry or token. #5668
owns verified workspace/channel IDs, scopes, retention and the canary/cutover.
There is no public enqueue endpoint, file upload API or GitHub mutation client.

| File | Role |
| --- | --- |
| `presentation-v1.mjs` | Whitelisted v1 event/policy input, typed labels, safe links and owner-reviewed registry. |
| `outbox.mjs` | Durable intents, per-channel pacing, hourly/five-minute itemized batches, subject threads and receipts. |
| `transport.mjs` | Fake-injectable Web API transport with workspace/channel/access checks and explicit failure states. |
| `health-adapter.mjs` | D5663 bridge: original logical keys survive; queue acceptance is not delivery acknowledgement. |
| `worker.mjs` | Service-binding publisher and SQLite delivery actor with independent alarms and kill switch. |
| `wrangler.jsonc` | Disabled independent deployment proposal; no provisioned resources or credentials. |

| `relay-v1.mjs` | D5665: read-only source batches to durable intents, then cursor advancement; injected D5666 policy. |
| `restricted-transport-5680.mjs` | D5680: send-time private/internal recipient validation for the restricted publisher port. |
