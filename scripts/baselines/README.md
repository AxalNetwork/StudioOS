# Split guard ledgers

These reviewed records are committed inputs, not generated build output. New
entries require the same review as before the split. Never rewrite another
feature's file to add your own entry.

| Directory | Record |
| --- | --- |
| `auth-inventory/` | One JSON map per route family; see its README for states and seeding. |
| `sql-prepare/` | One JSON map per Worker source file; new interpolation sites still fail. |
| `company-scope/` | One JSON map per route family: every route that reads the selected company, filter or target (D8526). |
