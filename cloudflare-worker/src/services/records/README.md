# Cycle record services (D690)

`types.ts` defines the plain-data `ModuleSpec`, record sections, actions, fields,
and gates. `index.ts` holds the cycle/slug registry and reports whether a cycle
has records. It is empty until a cycle registers its own service. `owned.ts`
checks a record id against its actual store and project before a route reads or
writes it. Validate's existing stores are listed there; later cycles add their
stores with fixed, bound SQL statements.

`../cycleActivity.ts` writes scoped activity and reads one record's timeline.
Older activity is only included when a spec declares an `oldRows` matcher.
Nothing rewrites historical activity.

To register a module, add its `ModuleSpec` under its cycle and slug in
`index.ts`; add its store to `owned.ts`; set its read and write gates; declare
each section's own gate; and return only the actions the viewer can use. The
route in `../../routes/cycle_records.ts` checks the project, gate and owned row
before invoking the spec. `formOptions` receives every query parameter except
`project` and must bound and bind its own reads. An action that names another
record must declare that reference for an ownership check before it writes.
