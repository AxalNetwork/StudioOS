-- D5944 (#5944): advisory WIP limits for a partner firm's negotiation lanes.
CREATE TABLE IF NOT EXISTS partner_negotiation_wip_limits (
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('scoping', 'terms', 'legal', 'ready_to_sign')),
  wip_limit INTEGER NOT NULL CHECK (typeof(wip_limit) = 'integer' AND wip_limit BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (partner_id, stage)
);
