# Authorization review ledger

Each JSON file is an entry map keyed by METHOD and API path. Its filename is
encodeURIComponent(familyOf(path)) plus the JSON extension. familyOf is the
existing first-two-segment rule in the authorization inventory reader.

Run node scripts/build-auth-inventory.mjs --seed to add missing unknowns as
unreviewed. The writer changes only files whose contents change. A verified
entry still needs an existing test file, and public_by_design needs a reason.
Removed routes, changed reasons, duplicate keys and keys in the wrong file fail
the guard. The directory is checked by check-folder-docs even if its README is
deleted. Review content and states are preserved from the original ledger.
