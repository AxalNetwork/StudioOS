-- D4424: inbound Axal tools are not outbound custom-server tool grants.
-- Keep their names distinct; NULL retains role/scope defaults, [] denies all.
-- Non-idempotent ALTER; applied once by the migration ledger.
ALTER TABLE team_allowlists ADD COLUMN axal_tools_json TEXT
  CHECK (axal_tools_json IS NULL OR (json_valid(axal_tools_json) AND json_type(axal_tools_json) = 'array'));
