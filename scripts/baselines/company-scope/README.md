# Company-scope ledger (D8526)

Each JSON file is an entry map keyed by METHOD and API path. Its filename is
encodeURIComponent of the path's first two segments plus the JSON extension, as in the
authorization ledger next to it.

Every mounted Worker route that reads the selected company (`X-Company-Id`,
`resolveActiveCompany`, `activeCompanyFor`) has one entry, `{ "kind": "filter" }`
or `{ "kind": "target" }`. A target names a record or writes; its own check must
authorize the record, and the selection may only narrow it.

`node scripts/build-company-scope-inventory.mjs --check` fails on a route that
reads the selection with no entry, an entry for a route that no longer does, a
kind that changed, and a target with no check of its own. Run `--seed` to add a
new route only after checking that the selection narrows and never grants.
