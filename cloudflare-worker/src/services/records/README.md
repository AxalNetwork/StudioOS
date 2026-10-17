# Cycle record services (D690)

`types.ts` defines the plain-data `ModuleSpec`, record sections, actions, fields,
and gates. `index.ts` holds the cycle/slug registry and reports whether a cycle
has records; a cycle has none until it registers its own service. `owned.ts`
checks a record id against its actual store and project before a route reads or
writes it. Validate's existing stores are listed there; later cycles add their
stores with fixed, bound SQL statements.

A record supplies four facts. Each returned section names its `read` or `write`
gate. A declared action exposes its `form` (with T, CH or CK fields) and optional
`confirm` prompt; a file field makes its POST multipart. The route supplies the
default action tone when a spec omits one.

`build.ts` holds Build's six module specs (D690 S18-B, #1694): one record per
module, as CO:369-374 draws it, read from the venture's own rows. It writes
nothing and declares only link actions (Edit split, Reconnect); the writes come
with #1695. Its sections gate Founding team's Documents and Operating systems'
Sync log and Permissions to writers. Old rows read through each spec's
`oldRows` matcher, one id prefix per spec.

`../cycleActivity.ts` writes scoped activity and reads one record's timeline.
A write that belongs to a module rather than a record logs `entityId: null`, so
no record's history returns it. Its `CREATE_ACTIONS` set is what both the count
and the renderer treat as a record's create row. Older activity is only
included when a spec declares an `oldRows` matcher. Nothing in the Worker
rewrites historical activity; migration 470 is the one-off correction S1 ruled
for the rows #1736 misfiled before its review fixes shipped.

`verdict.ts` is Validate's Verdict record (D693, #1703). It is tested through a
registry of its own and joins `RECORD_SPECS` with Validate's service.

To register a module, add its `ModuleSpec` under its cycle and slug in
`index.ts`; add its store to `owned.ts`; set its read and write gates; declare
each section's own gate; and return only the actions the viewer can use. The
route in `../../routes/cycle_records.ts` checks the project, gate and owned row
before invoking the spec. `formOptions` receives every query parameter except
`project` and must bound and bind its own reads. An action that names another
record must declare that reference for an ownership check before it writes.
