# SQL prepare review ledger

Each JSON file is an entry map keyed by interpolation expression, an @ sign,
and the Worker source path. Its filename is encodeURIComponent(source path)
plus the JSON extension. Counts retain the original values.

These interpolations were reviewed when the ledger was written, each reviewed
and none an injection. The gate fails on NEW entries only. Removing a site is
always allowed. Regenerate with node scripts/check-sql-prepare.mjs --write only
after reviewing new expressions; the writer changes only affected files.
Duplicate keys, entries in the wrong file and a restored legacy ledger fail.
