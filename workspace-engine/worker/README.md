# Private preview host

`controller.ts` contains the persisted lifecycle with injected provider, clock, CAS store and authorized broker. `executor.ts` implements the shared adapter and obtains a separate audience-bound ticket for each operation. `index.ts` binds it to a SQLite-backed Durable Object and the current Container exec API. HTTP requests always receive 404; only private service RPC can reach the controller.

One DO identity covers a tenant/run/attempt/generation. Persisted provisioning plus a hard alarm precedes VM start. Replayed create never starts a second VM. The host refuses unknown capacity/residency/image provenance through the shared eligibility/broker gate. Status/cancel/cleanup require current scoped control authorization even when new admission is disabled. Cleanup failure stays unknown and schedules another alarm; it is never counted as zero capacity.

The main broker integration must implement current task/agent role checks, grant redemption, budget reservation/reconciliation, trusted image facts, scoped object upload and idempotent signed manifest acceptance. No production allow-all adapter or in-memory authority belongs here. Durable state contains only spec/status/refs; no checkout, changed file bytes or command output is stored in the DO.
