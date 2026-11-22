-- D7673 (#7673): role-neutral introduction requests on #7672's canonical directory identities.
-- Additive only. No write to these tables sends a message: outreach is a person's recorded action.
-- Existing quarterly asks (#6261), curated credits (#7064), teammate requests (#7066) and Offer one
-- (#6637) keep their own tables; nothing here reads or moves their quotas.

-- The readiness policy a submission is checked against. Requirements are configurable keys; a later
-- policy is a new version, and a request keeps the snapshot it was submitted under.
CREATE TABLE IF NOT EXISTS network_intro_policies (
  uid TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE CHECK (version >= 1),
  requirements_json TEXT NOT NULL CHECK (json_valid(requirements_json) AND json_type(requirements_json) = 'array'),
  -- NULL: an approval does not expire under this policy. No validity period is assumed.
  validity_days INTEGER CHECK (validity_days IS NULL OR validity_days > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_intro_policies_active ON network_intro_policies(active) WHERE active = 1;
-- The base policy: a shareable professional profile and the capacity the requester asks in.
-- No legal classification, accreditation or identity-document check is part of it.
INSERT OR IGNORE INTO network_intro_policies (uid, version, requirements_json, validity_days, active)
VALUES ('intro-policy-v1', 1, '["professional_profile","capacity"]', NULL, 1);

-- One row per requester and requirement. A change returns it to submitted for review.
CREATE TABLE IF NOT EXISTS network_intro_readiness (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL CHECK (length(requirement_key) BETWEEN 1 AND 64),
  value_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value_json)),
  -- A reference to private evidence held elsewhere, never the evidence itself.
  evidence_ref TEXT CHECK (evidence_ref IS NULL OR length(evidence_ref) <= 300),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  reviewer_user_id INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  valid_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, requirement_key),
  CHECK ((status = 'submitted' AND reviewer_user_id IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (valid_until IS NULL OR status = 'approved')
);
CREATE INDEX IF NOT EXISTS idx_network_intro_readiness_status ON network_intro_readiness(status, updated_at);

-- A person the requester names who is not in the directory yet. Scoped to its creator until an
-- operator resolves it to a directory person or rejects it.
CREATE TABLE IF NOT EXISTS network_intro_provisional_targets (
  uid TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 300),
  organization_text TEXT CHECK (organization_text IS NULL OR length(organization_text) <= 300),
  profile_url TEXT CHECK (profile_url IS NULL OR length(profile_url) <= 500),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'resolved', 'rejected')),
  resolved_entry_uid TEXT REFERENCES network_directory_entries(uid),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((review_status = 'resolved') = (resolved_entry_uid IS NOT NULL)),
  CHECK ((review_status = 'pending') = (reviewed_by IS NULL AND reviewed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_network_intro_provisional_review ON network_intro_provisional_targets(review_status, created_at);

CREATE TABLE IF NOT EXISTS network_intro_requests (
  uid TEXT PRIMARY KEY,
  requester_user_id INTEGER NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  -- The adapter mark: only this service writes here. Other introduction services keep their tables.
  service_type TEXT NOT NULL DEFAULT 'directory_introduction' CHECK (service_type IN ('directory_introduction')),
  target_entry_uid TEXT REFERENCES network_directory_entries(uid),
  target_provisional_uid TEXT REFERENCES network_intro_provisional_targets(uid),
  organization_entry_uid TEXT REFERENCES network_directory_entries(uid),
  purpose TEXT CHECK (purpose IS NULL OR length(purpose) <= 2000),
  -- What an operator may share with the target.
  shareable_brief TEXT CHECK (shareable_brief IS NULL OR length(shareable_brief) <= 4000),
  -- The requester's own notes: never in the operator or target projection.
  private_notes TEXT CHECK (private_notes IS NULL OR length(private_notes) <= 4000),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'readiness_needed', 'submitted', 'in_review',
    'needs_information', 'outreach_ready', 'contacted', 'awaiting_target', 'declined', 'unavailable', 'agreed',
    'introduction_made', 'closed', 'withdrawn')),
  next_actor TEXT NOT NULL DEFAULT 'requester' CHECK (next_actor IN ('requester', 'operator', 'target', 'none')),
  operator_user_id INTEGER REFERENCES users(id),
  policy_uid TEXT REFERENCES network_intro_policies(uid),
  policy_snapshot_json TEXT CHECK (policy_snapshot_json IS NULL OR json_valid(policy_snapshot_json)),
  consent_status TEXT NOT NULL DEFAULT 'not_asked' CHECK (consent_status IN ('not_asked', 'asked', 'granted', 'declined', 'withdrawn')),
  outcome_note TEXT CHECK (outcome_note IS NULL OR length(outcome_note) <= 2000),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  closed_at TEXT,
  UNIQUE (requester_user_id, idempotency_key),
  CHECK (target_entry_uid IS NULL OR target_provisional_uid IS NULL),
  CHECK (target_entry_uid IS NOT NULL OR target_provisional_uid IS NOT NULL OR organization_entry_uid IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_network_intro_requests_requester ON network_intro_requests(requester_user_id, created_at, uid);
CREATE INDEX IF NOT EXISTS idx_network_intro_requests_queue ON network_intro_requests(state, next_actor, created_at, uid);
CREATE INDEX IF NOT EXISTS idx_network_intro_requests_operator ON network_intro_requests(operator_user_id, state);

-- A target is always a directory person; organisation context is always a directory organisation.
CREATE TRIGGER IF NOT EXISTS network_intro_requests_target_kind_insert
BEFORE INSERT ON network_intro_requests
WHEN (NEW.target_entry_uid IS NOT NULL AND (SELECT kind FROM network_directory_entries WHERE uid = NEW.target_entry_uid) IS NOT 'person')
  OR (NEW.organization_entry_uid IS NOT NULL AND (SELECT kind FROM network_directory_entries WHERE uid = NEW.organization_entry_uid) IS NOT 'organization')
BEGIN
  SELECT RAISE(ABORT, 'network_intro_requests.target_entry_uid: target must be a directory person and context a directory organization');
END;
CREATE TRIGGER IF NOT EXISTS network_intro_requests_target_kind_update
BEFORE UPDATE OF target_entry_uid, organization_entry_uid ON network_intro_requests
WHEN (NEW.target_entry_uid IS NOT NULL AND (SELECT kind FROM network_directory_entries WHERE uid = NEW.target_entry_uid) IS NOT 'person')
  OR (NEW.organization_entry_uid IS NOT NULL AND (SELECT kind FROM network_directory_entries WHERE uid = NEW.organization_entry_uid) IS NOT 'organization')
BEGIN
  SELECT RAISE(ABORT, 'network_intro_requests.target_entry_uid: target must be a directory person and context a directory organization');
END;

-- The history of a request. Append-only: a withdrawal or close never erases an earlier event.
CREATE TABLE IF NOT EXISTS network_intro_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_uid TEXT NOT NULL REFERENCES network_intro_requests(uid),
  actor_user_id INTEGER REFERENCES users(id),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('requester', 'operator', 'system')),
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  from_state TEXT,
  to_state TEXT,
  -- requester: shown to the requester and operators; operator: operators only.
  visibility TEXT NOT NULL DEFAULT 'requester' CHECK (visibility IN ('requester', 'operator')),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_network_intro_events_request ON network_intro_events(request_uid, id);
CREATE TRIGGER IF NOT EXISTS network_intro_events_no_update
BEFORE UPDATE ON network_intro_events
BEGIN
  SELECT RAISE(ABORT, 'network_intro_events: events are append-only');
END;
CREATE TRIGGER IF NOT EXISTS network_intro_events_no_delete
BEFORE DELETE ON network_intro_events
BEGIN
  SELECT RAISE(ABORT, 'network_intro_events: events are append-only');
END;

-- An operator's contact with the target. A pending or uncertain attempt is reconciled, never resent blind.
CREATE TABLE IF NOT EXISTS network_intro_contact_attempts (
  uid TEXT PRIMARY KEY,
  request_uid TEXT NOT NULL REFERENCES network_intro_requests(uid),
  operator_user_id INTEGER NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'phone', 'message', 'in_person', 'other')),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending', 'delivered', 'failed', 'uncertain')),
  provider_ref TEXT CHECK (provider_ref IS NULL OR length(provider_ref) <= 200),
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reconciled_at TEXT,
  UNIQUE (request_uid, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_network_intro_contact_attempts_request ON network_intro_contact_attempts(request_uid, attempted_at);
CREATE TRIGGER IF NOT EXISTS network_intro_contact_attempts_no_delete
BEFORE DELETE ON network_intro_contact_attempts
BEGIN
  SELECT RAISE(ABORT, 'network_intro_contact_attempts: contact history is kept');
END;
-- Only the delivery outcome of an unsettled attempt changes; who, when, how and which request never do.
CREATE TRIGGER IF NOT EXISTS network_intro_contact_attempts_settle_only
BEFORE UPDATE ON network_intro_contact_attempts
WHEN OLD.delivery_state NOT IN ('pending', 'uncertain')
  OR NEW.uid IS NOT OLD.uid OR NEW.request_uid IS NOT OLD.request_uid OR NEW.operator_user_id IS NOT OLD.operator_user_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.channel IS NOT OLD.channel OR NEW.attempted_at IS NOT OLD.attempted_at
BEGIN
  SELECT RAISE(ABORT, 'network_intro_contact_attempts: only an unsettled attempt''s delivery outcome may change');
END;
