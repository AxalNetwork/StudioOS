# Cycle record services (D690)

`types.ts` defines the plain-data `ModuleSpec`, record sections, actions, fields,
and gates. `index.ts` holds the cycle/slug registry and reports whether a cycle
has records. It is empty until a cycle registers its own service. `owned.ts`
checks a record id against its actual store and project before a route reads or
writes it. Validate's existing stores are listed there; later cycles add their
stores with fixed, bound SQL statements.

A record supplies four facts. Each returned section names its `read` or `write`
gate. A declared action exposes its `form` (with T, CH or CK fields) and optional
`confirm` prompt; a file field makes its POST multipart. The route supplies the
default action tone when a spec omits one.

`../cycleActivity.ts` writes scoped activity and reads one record's timeline.
Older activity is only included when a spec declares an `oldRows` matcher.
Nothing rewrites historical activity. Grow (D691, #1698) lists its six stores
in `owned.ts`, and its matchers admit today's Grow rows, which carry no
`project_id`, only under `grow_*` actions (`unscopedActions`), plus a month's
figure logged as `<id>:<month>` (`idPrefixTypes`) and an application's stage
row through its posting (`children`).

`verdict.ts` is Validate's Verdict record (D693, #1703). It is tested through a
registry of its own and joins `RECORD_SPECS` with Validate's service.

To register a module, add its `ModuleSpec` under its cycle and slug in
`index.ts`; add its store to `owned.ts`; set its read and write gates; declare
each section's own gate; and return only the actions the viewer can use. The
route in `../../routes/cycle_records.ts` checks the project, gate and owned row
before invoking the spec. `formOptions` receives every query parameter except
`project` and must bound and bind its own reads. An action that names another
record must declare that reference for an ownership check before it writes.
