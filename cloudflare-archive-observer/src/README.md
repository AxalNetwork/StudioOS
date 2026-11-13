# Archive metadata plane

`index.ts` is the disabled authenticated receiver. Writer, producer and reader have separate keys; a reader cannot choose an incident's recovery time. `health.ts` stores immutable batch identity, monotonic attempt outcomes and independent marker expectations, then uses only R2 HEAD metadata to verify writes. Generated bindings describe only the disabled candidate configuration; future resource ports remain absent until owner provisioning.

An object timestamp alone is insufficient. A known batch and marker must match object metadata; unverified old expectations stay visible beyond the rolling window. Query failure or a capped inventory is unknown. Open incident state and actual Slack delivery belong to the existing shared authority, not this database. No route accepts a raw archive payload or arbitrary object download.
