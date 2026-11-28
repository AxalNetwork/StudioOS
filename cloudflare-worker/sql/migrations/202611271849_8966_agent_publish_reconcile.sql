-- D8966 (#8966, part of #5569): what the unmounted reconciler read on GitHub when it resolved an `unknown` or abandoned
-- `reserved` publication reservation, and when. Metadata only: ref and PR identities, SHAs and reason codes. Never a
-- credential, a title, a body or patch bytes. Nothing reads or writes these columns until a consumer is wired.
ALTER TABLE agent_publish_requests ADD COLUMN reconcile_evidence_json TEXT;
ALTER TABLE agent_publish_requests ADD COLUMN reconciled_at_ms INTEGER;
