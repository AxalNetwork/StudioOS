# Cycle record services (D690)

`types.ts` defines the plain-data `ModuleSpec`, record sections, actions, fields,
and gates. `index.ts` holds the cycle/slug registry and reports whether a cycle
has records. Validate registers `validate.ts` (D690, #1692), Build `build.ts` (D690,
#1694) and Raise `raise.ts` (D691, #1699); every other cycle has none until it
registers its own service. `owned.ts`
checks a record id against its actual store and project before a route reads or
writes it. Validate's existing stores are listed there; later cycles add their
stores with fixed, bound SQL statements.

A record supplies four facts, and may carry its row's `uid`. Each returned
section names its `read` or `write` gate; a section with `when` is drawn only
for the ids it accepts. A declared action exposes its `form` (with T, CH or CK fields) and optional
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

Grow (D691, #1698) lists its six stores in `owned.ts`, and its matchers admit
today's Grow rows, which carry no
`project_id`, only under `grow_*` actions (`unscopedActions`), plus a month's
figure logged as `<id>:<month>` (`idPrefixTypes`) and an application's stage
row through its posting (`children`).

`validate.ts` holds Validate's six module specs (D690, #1692), as CO:362-367
draws them: a pain group, an interview, a segment, a competitor, a demand record
(`signal-`, `revenue-` or `waitlist-`, one id space in `owned.ts`'s
`demand_records`) and a hypothesis. Its actions call the writers the module's
PATCH and POST routes call, and its `formOptions` serve the Add forms. An
interview's Transcript, placements, Cost and Session sections are a writer's,
and a quote with no consent reaches anyone else as withheld.

`verdict.ts` is Validate's Verdict record (D693, #1703). It is tested through a
registry of its own and joins `RECORD_SPECS` with Validate's service.

To register a module, add its `ModuleSpec` under its cycle and slug in
`index.ts`; add its store to `owned.ts`; set its read and write gates; declare
each section's own gate; and return only the actions the viewer can use. The
route in `../../routes/cycle_records.ts` checks the project, gate and owned row
before invoking the spec. `formOptions` receives every query parameter except
`project` and must bound and bind its own reads. An action that names another
record must declare that reference for an ownership check before it writes.
