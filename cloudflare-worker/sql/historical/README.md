# Historical D1 schema scripts

This folder contains the old loose schema files that once supplemented
`schema.sql`: feature-specific schemas, one-off repairs, backfills, index
passes, and other scripts accumulated before the forward-only migration ledger
was the build path.

`../schema_baseline.sql` is now the production-derived starting schema for a
new database. It supersedes every SQL file in this folder, and numbered files
under `../migrations/` are the only incremental build inputs.

The files here are kept for archaeology only. Nothing builds from them, and
new schema changes must not be added here.